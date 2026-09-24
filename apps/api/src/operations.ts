import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import type {Config} from './config.js';
import {one} from './db.js';
import {problem} from './problem.js';
import {assertProperty,audit,can,idempotent,inOrganization,type TenantContext} from './tenant.js';

const id=z.uuid();
const orgParams=z.object({orgId:id});
const taskParams=z.object({orgId:id,taskId:id});
const importParams=z.object({orgId:id,batchId:id});
const taskInput=z.object({
  type:z.enum(['cleaning','maintenance','purchase','guest_action']),
  unit_id:id,
  due_at:z.iso.datetime({offset:true}),
  description:z.string().trim().min(3).max(500),
}).strict();
const emptyBody=z.object({}).strict();

function expectedVersion(header:unknown):number {
  const match=typeof header==='string'?/^"?(\d+)"?$/.exec(header):null;
  const version=Number(match?.[1]);
  if(!Number.isSafeInteger(version)||version<1)problem(428,'VERSION_REQUIRED','Передайте актуальную версию задачи');
  return version;
}

function taskScope(c:TenantContext,alias='t'):{sql:string;params:unknown[]} {
  if(c.member.role==='housekeeper')return {sql:` AND ${alias}.assignee_id=$2`,params:[c.organizationId,c.actor.id]};
  if(c.propertyIds)return {sql:` AND ${alias}.property_id=ANY($2::uuid[])`,params:[c.organizationId,c.propertyIds]};
  return {sql:'',params:[c.organizationId]};
}

export async function registerOperations(app:FastifyInstance,pool:pg.Pool,config:Config):Promise<void> {
  app.get('/api/v1/organizations/:orgId/tasks',async req=>{
    const {orgId}=orgParams.parse(req.params);
    const q=z.object({state:z.enum(['open','assigned','in_progress','review','done','cancelled']).optional()}).parse(req.query);
    return inOrganization(req,pool,config,orgId,'tasks.read',async c=>{
      const scope=taskScope(c);
      const rows=await c.tx.query(`SELECT t.id,t.property_id,t.unit_id,t.reservation_id,t.assignee_id,t.kind AS type,
        t.title,t.title AS description,t.due_at,t.state,t.version,t.created_at,u.name AS unit_name,p.name AS property_name
        FROM tasks t JOIN properties p ON p.organization_id=t.organization_id AND p.id=t.property_id
        LEFT JOIN units u ON u.organization_id=t.organization_id AND u.id=t.unit_id
        WHERE t.organization_id=$1 ${scope.sql} AND ($${scope.params.length+1}::text IS NULL OR t.state=$${scope.params.length+1})
        ORDER BY t.due_at ASC NULLS LAST,t.created_at DESC,t.id LIMIT 100`,[...scope.params,q.state??null]);
      return {items:rows.rows};
    },{scope:true});
  });

  app.post('/api/v1/organizations/:orgId/tasks',async req=>{
    const {orgId}=orgParams.parse(req.params),input=taskInput.parse(req.body);
    return inOrganization(req,pool,config,orgId,'tasks.write',c=>idempotent(c,req,'task.create',async()=>{
      const propertyScope=c.propertyIds?' AND property_id=ANY($3::uuid[])':'';
      const unit=await one<{property_id:string}>(c.tx,`SELECT property_id FROM units WHERE organization_id=$1 AND id=$2 AND state='active'${propertyScope} FOR SHARE`,
        c.propertyIds?[orgId,input.unit_id,c.propertyIds]:[orgId,input.unit_id]);
      if(!unit)problem(404,'RESOURCE_NOT_FOUND','Номер не найден');
      assertProperty(c,unit.property_id);
      const row=await one(c.tx,`INSERT INTO tasks(organization_id,property_id,unit_id,kind,title,due_at)
        VALUES($1,$2,$3,$4,$5,$6)
        RETURNING id,property_id,unit_id,kind AS type,title,title AS description,due_at,state,version,created_at`,
        [orgId,unit.property_id,input.unit_id,input.type,input.description,input.due_at]);
      await audit(c,'task.created','task',(row as {id:string}).id,undefined,{type:input.type,unit_id:input.unit_id});
      return row;
    }),{write:true,scope:true});
  });

  app.post('/api/v1/organizations/:orgId/tasks/:taskId/complete',async req=>{
    const {orgId,taskId}=taskParams.parse(req.params),version=expectedVersion(req.headers['if-match']);
    emptyBody.parse(req.body??{});
    return inOrganization(req,pool,config,orgId,'tasks.read',async c=>{
      if(c.member.role!=='housekeeper'&&!can(c.member,'tasks.write'))problem(403,'ACCESS_DENIED','Недостаточно прав');
      return idempotent(c,req,'task.complete',async()=>{
        const scope=taskScope(c);
        const row=await one<{id:string;property_id:string;assignee_id:string|null;state:string;version:number;kind:string}>(c.tx,
          `SELECT t.id,t.property_id,t.assignee_id,t.state,t.version,t.kind FROM tasks t
           WHERE t.organization_id=$1 AND t.id=$${scope.params.length+1} ${scope.sql} FOR UPDATE`,
          [...scope.params,taskId]);
        if(!row)problem(404,'RESOURCE_NOT_FOUND','Задача не найдена');
        if(c.member.role!=='housekeeper')assertProperty(c,row.property_id);
        if(row.version!==version)problem(412,'VERSION_CHANGED','Задача изменилась. Обновите список');
        if(row.state==='done'||row.state==='cancelled')problem(422,'INVALID_STATE','Задача уже завершена или отменена');
        if(c.member.role==='housekeeper'&&row.state==='review')problem(422,'INVALID_STATE','Задача уже ожидает проверки');
        const next=c.member.role==='housekeeper'?'review':'done';
        const updated=await one(c.tx,`UPDATE tasks SET state=$3,version=version+1 WHERE organization_id=$1 AND id=$2
          RETURNING id,property_id,unit_id,kind AS type,title,title AS description,due_at,state,version,created_at`,
          [orgId,taskId,next]);
        await audit(c,next==='review'?'task.submitted_for_review':'task.completed','task',taskId,undefined,{state:next});
        return updated;
      });
    },{write:true,scope:true});
  });

  app.get('/api/v1/organizations/:orgId/staff',async req=>{
    const {orgId}=orgParams.parse(req.params);
    return inOrganization(req,pool,config,orgId,'staff.read',async c=>{
      const rows=await c.tx.query<{id:string;name:string;email:string;role:string;permissions:string[];state:string;property_names:string[]}>(
        `SELECT m.id,u.display_name AS name,u.email::text AS email,m.role,m.permissions,m.status AS state,
          COALESCE(ARRAY(SELECT p.name FROM property_grants g JOIN properties p ON p.organization_id=g.organization_id AND p.id=g.property_id
            WHERE g.organization_id=m.organization_id AND g.membership_id=m.id ORDER BY p.name),ARRAY[]::text[]) AS property_names
         FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.status<>'revoked'
         ORDER BY CASE WHEN m.role='owner' THEN 0 ELSE 1 END,u.display_name,m.id LIMIT 100`,[orgId]);
      return {items:rows.rows.map(({property_names,...row})=>({...row,scope:['owner','admin'].includes(row.role)?'Все объекты':property_names.length?property_names.join(', '):'Нет назначенных объектов'}))};
    });
  });

  app.get('/api/v1/organizations/:orgId/subscription',async req=>{
    const {orgId}=orgParams.parse(req.params);
    return inOrganization(req,pool,config,orgId,'billing.read',async c=>{
      const row=await one<{id:string;state:string;trial_ends_at:string|null;paid_through:string|null;grace_ends_at:string|null;version:number;plan_code:string|null;plan_version:number|null;active_unit_limit:number|null;active_member_limit:number|null;monthly_price_minor:string|null;used_units:number;used_members:number}>(c.tx,
        `SELECT s.id,s.state,s.trial_ends_at,s.paid_through,s.grace_ends_at,s.version,
          p.code AS plan_code,p.version AS plan_version,p.active_unit_limit,p.active_member_limit,p.monthly_price_minor::text,
          (SELECT COUNT(*)::int FROM units u WHERE u.organization_id=s.organization_id AND u.state='active') AS used_units,
          (SELECT COUNT(*)::int FROM memberships m WHERE m.organization_id=s.organization_id AND m.status='active') AS used_members
         FROM subscriptions s LEFT JOIN subscription_plans p ON p.id=s.plan_id WHERE s.organization_id=$1`,[orgId]);
      if(!row)problem(404,'RESOURCE_NOT_FOUND','Подписка не найдена');
      return {...row,status:row.state,plan_code:row.plan_code??'trial_unconfigured',enabled_features:[],plan_configured:row.plan_code!==null};
    });
  });

  app.get('/api/v1/organizations/:orgId/notifications',async req=>{
    const {orgId}=orgParams.parse(req.params);
    return inOrganization(req,pool,config,orgId,'org.read',async c=>{
      const rows=await c.tx.query(`SELECT id,kind,safe_title AS title,state,created_at FROM notifications
        WHERE organization_id=$1 AND user_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100`,[orgId,c.actor.id]);
      return {items:rows.rows};
    });
  });

  app.get('/api/v1/organizations/:orgId/audit',async req=>{
    const {orgId}=orgParams.parse(req.params);
    return inOrganization(req,pool,config,orgId,'audit.read',async c=>{
      const rows=await c.tx.query(`SELECT e.id,e.action,e.resource_type,e.resource_id,e.reason,e.safe_diff,e.occurred_at,
        u.display_name AS actor_name FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id
        WHERE e.organization_id=$1 ORDER BY e.occurred_at DESC,e.id DESC LIMIT 100`,[orgId]);
      return {items:rows.rows};
    });
  });

  app.get('/api/v1/organizations/:orgId/import-batches',async req=>{
    const {orgId}=orgParams.parse(req.params);
    return inOrganization(req,pool,config,orgId,'import.read',async c=>{
      const rows=await c.tx.query<{id:string;state:string;source_name:string;source_checksum:string;row_count:number|null;summary:Record<string,unknown>;created_at:string}>(
        `SELECT id,state,source_name,source_checksum,row_count,summary,created_at FROM import_batches
         WHERE organization_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,[orgId]);
      return {items:rows.rows.map(row=>({id:row.id,state:row.state,source_name:row.source_name,source_row_count:row.row_count,
        quarantine_count:typeof row.summary?.quarantine_count==='number'?row.summary.quarantine_count:null,
        missing_datasets:Array.isArray(row.summary?.missing_datasets)?row.summary.missing_datasets.filter((item):item is string=>typeof item==='string'):[],
        created_at:row.created_at}))};
    });
  });

  app.post('/api/v1/organizations/:orgId/imports/:batchId/validate',async req=>{
    const {orgId,batchId}=importParams.parse(req.params);
    emptyBody.parse(req.body??{});
    return inOrganization(req,pool,config,orgId,'import.write',c=>idempotent(c,req,'import.validate',async()=>{
      const batch=await one<{id:string;state:string}>(c.tx,'SELECT id,state FROM import_batches WHERE organization_id=$1 AND id=$2 FOR SHARE',[orgId,batchId]);
      if(!batch)problem(404,'RESOURCE_NOT_FOUND','Пакет импорта не найден');
      problem(409,'IMPORT_SOURCE_UNAVAILABLE','Приватный файл пакета не подтверждён; проверка не запускалась');
    }),{write:true});
  });
}
