import {createHash} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {nightDates,stayRange,parseMinor} from '@keycalendar/domain';
import type {Config} from './config.js';
import {one} from './db.js';
import {problem} from './problem.js';
import {assertProperty,audit,idempotent,inOrganization,outbox,type TenantContext} from './tenant.js';

const id=z.uuid();const orgParam=z.object({orgId:id});
const clockTime=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
function validIanaTimezone(value:string):boolean{
  if(!(value==='UTC'||/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(value)))return false;
  try{new Intl.DateTimeFormat('en-US',{timeZone:value});return true;}
  catch{return false;}
}
const propertyBody=z.object({
  name:z.string().trim().min(1).max(150),
  timezone:z.string().trim().min(3).max(100).refine(validIanaTimezone,'Укажите действительный часовой пояс IANA'),
  checkin_time:clockTime,
  checkin_time_end:clockTime.optional(),
  checkout_time_start:clockTime.optional(),
  checkout_time:clockTime,
  address_private:z.string().max(500).optional()
}).strict().superRefine((input,context)=>{
  if(input.checkin_time_end && input.checkin_time_end<=input.checkin_time)
    context.addIssue({code:'custom',path:['checkin_time_end'],message:'Конец окна заезда должен быть позже его начала'});
  if(input.checkout_time_start && input.checkout_time_start>=input.checkout_time)
    context.addIssue({code:'custom',path:['checkout_time_start'],message:'Начало окна выезда должно быть раньше его конца'});
});
const unitBody=z.object({name:z.string().trim().min(1).max(120),capacity:z.coerce.number().int().min(1).max(100).optional(),capacity_adults:z.coerce.number().int().min(1).max(100).optional(),capacity_children:z.coerce.number().int().min(0).max(100).default(0),base_rate_minor:z.string().regex(/^\d+$/).default('0'),category_id:id.optional()}).strict();
const guestBody=z.object({display_name:z.string().trim().min(1).max(150),email:z.email().optional(),phone:z.string().max(50).optional(),note:z.string().max(3000).optional(),legal_basis:z.enum(['contract','consent']).default('contract')}).strict();
const rateInput=z.object({unit_ids:z.array(id).min(1).max(50),rate_plan_id:id,from:z.iso.date(),to:z.iso.date(),amount_minor:z.string().regex(/^\d+$/),reason:z.string().max(500).optional()}).strict();
function stable(value:unknown):unknown{
  if(Array.isArray(value))return value.map(stable);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)]));
  return value;
}
function hash(input:unknown){return createHash('sha256').update(JSON.stringify(stable(input))).digest();}
function scopeSql(c:TenantContext,field='property_id'):{sql:string;params:unknown[]}{return c.propertyIds?{sql:` AND ${field}=ANY($2::uuid[])`,params:[c.organizationId,c.propertyIds]}:{sql:'',params:[c.organizationId]};}
async function rateSnapshot(c:TenantContext,input:z.infer<typeof rateInput>):Promise<unknown[]>{
  const rows=await c.tx.query<{unit_id:string;stay_date:string;price_minor:string;version:number}>(
    `SELECT unit_id,stay_date::text,price_minor::text,version FROM rate_days WHERE organization_id=$1 AND rate_plan_id=$2
     AND unit_id=ANY($3::uuid[]) AND stay_date>=$4 AND stay_date<$5 ORDER BY unit_id,stay_date`,
    [c.organizationId,input.rate_plan_id,input.unit_ids,input.from,input.to]);
  const units=await c.tx.query<{id:string;version:number;property_id:string}>(`SELECT id,version,property_id FROM units WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND state='active' ORDER BY id FOR UPDATE`,[c.organizationId,input.unit_ids]);
  if(units.rows.length!==input.unit_ids.length)problem(422,'UNIT_UNAVAILABLE','Один из номеров недоступен');
  units.rows.forEach(u=>assertProperty(c,u.property_id));
  return [...units.rows.map(u=>['unit',u.id,u.version]),...rows.rows.map(r=>['day',r.unit_id,r.stay_date,r.price_minor,r.version])];
}
export async function registerInventory(app:FastifyInstance,pool:pg.Pool,config:Config):Promise<void>{
  app.get('/api/v1/organizations/:orgId/properties',async req=>{
    const {orgId}=orgParam.parse(req.params);return inOrganization(req,pool,config,orgId,'inventory.read',async c=>{
      const s=scopeSql(c,'p.id');const rows=await c.tx.query(`SELECT p.id,p.name,p.timezone,p.checkin_time::text,p.checkin_time_end::text,
        p.checkout_time_start::text,p.checkout_time::text,p.version,p.created_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'state',u.state,'capacity',u.capacity_adults+u.capacity_children,
          'capacity_adults',u.capacity_adults,'capacity_children',u.capacity_children,'base_rate_minor',u.base_rate_minor::text,'currency',u.currency,'version',u.version) ORDER BY u.name)
          FROM units u WHERE u.organization_id=p.organization_id AND u.property_id=p.id AND u.state<>'archived'),'[]'::jsonb) AS units
        FROM properties p WHERE p.organization_id=$1 AND p.archived_at IS NULL ${s.sql} ORDER BY p.created_at DESC LIMIT 100`,s.params);
      return {items:rows.rows};
    },{scope:true});
  });
  app.post('/api/v1/organizations/:orgId/properties',async req=>{
    const {orgId}=orgParam.parse(req.params),input=propertyBody.parse(req.body);
    return inOrganization(req,pool,config,orgId,'inventory.write',c=>idempotent(c,req,'property.create',async()=>{
      const row=await one(c.tx,`INSERT INTO properties(organization_id,name,timezone,checkin_time,checkin_time_end,checkout_time_start,checkout_time,address_private)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id,name,timezone,checkin_time::text,checkin_time_end::text,checkout_time_start::text,checkout_time::text,version`,
        [orgId,input.name,input.timezone,input.checkin_time,input.checkin_time_end??null,input.checkout_time_start??null,input.checkout_time,input.address_private??null]);
      await audit(c,'property.created','property',(row as {id:string}).id);return row;
    }),{write:true});
  });
  app.get('/api/v1/organizations/:orgId/properties/:propertyId',async req=>{
    const {orgId,propertyId}=z.object({orgId:id,propertyId:id}).parse(req.params);
    return inOrganization(req,pool,config,orgId,'inventory.read',async c=>{
      assertProperty(c,propertyId);const row=await one(c.tx,'SELECT id,name,timezone,address_private,checkin_time::text,checkin_time_end::text,checkout_time_start::text,checkout_time::text,version FROM properties WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',[orgId,propertyId]);
      if(!row)problem(404,'RESOURCE_NOT_FOUND','Объект не найден');const units=await c.tx.query('SELECT id,name,state,capacity_adults,capacity_children,base_rate_minor::text,currency,version FROM units WHERE organization_id=$1 AND property_id=$2 AND state<>\'archived\' ORDER BY name',[orgId,propertyId]);return {...row,units:units.rows};
    },{scope:true});
  });
  app.post('/api/v1/organizations/:orgId/properties/:propertyId/units',async req=>{
    const {orgId,propertyId}=z.object({orgId:id,propertyId:id}).parse(req.params),input=unitBody.parse(req.body);
    parseMinor(input.base_rate_minor);
    return inOrganization(req,pool,config,orgId,'inventory.write',c=>idempotent(c,req,'unit.create',async()=>{
      assertProperty(c,propertyId);const property=await one<{id:string}>(c.tx,'SELECT id FROM properties WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',[orgId,propertyId]);if(!property)problem(404,'RESOURCE_NOT_FOUND','Объект не найден');
      const row=await one(c.tx,`INSERT INTO units(organization_id,property_id,category_id,name,capacity_adults,capacity_children,base_rate_minor)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,property_id,name,state,capacity_adults,capacity_children,base_rate_minor::text,currency,version`,
        [orgId,propertyId,input.category_id??null,input.name,input.capacity_adults??input.capacity??2,input.capacity_children,input.base_rate_minor]);
      await audit(c,'unit.created','unit',(row as {id:string}).id);return row;
    }),{write:true,scope:true});
  });
  app.get('/api/v1/organizations/:orgId/units',async req=>{
    const {orgId}=orgParam.parse(req.params);return inOrganization(req,pool,config,orgId,'inventory.read',async c=>{
      const s=scopeSql(c);const result=await c.tx.query(`SELECT id,property_id,category_id,name,state,capacity_adults,capacity_children,
        base_rate_minor::text,currency,version FROM units WHERE organization_id=$1 AND state<>'archived' ${s.sql} ORDER BY name LIMIT 500`,s.params);return {items:result.rows};
    },{scope:true});
  });
  app.get('/api/v1/organizations/:orgId/guests',async req=>{
    const {orgId}=orgParam.parse(req.params);const q=z.object({q:z.string().trim().max(100).optional()}).parse(req.query);
    return inOrganization(req,pool,config,orgId,'guests.read',async c=>{
      const rows=await c.tx.query(`SELECT g.id,g.display_name,g.email,g.phone,g.note,g.legal_basis,g.version,g.created_at
        FROM guests g WHERE g.organization_id=$1 AND ($2::text IS NULL OR g.display_name ILIKE $2)
        AND ($3::uuid[] IS NULL OR EXISTS (
          SELECT 1 FROM reservations r JOIN reservation_stays s ON s.organization_id=r.organization_id AND s.reservation_id=r.id
          JOIN units u ON u.organization_id=s.organization_id AND u.id=s.unit_id
          WHERE r.organization_id=g.organization_id AND r.guest_id=g.id AND u.property_id=ANY($3::uuid[])))
        ORDER BY g.created_at DESC LIMIT 100`,[orgId,q.q?`%${q.q}%`:null,c.propertyIds]);return {items:rows.rows};
    },{scope:true});
  });
  app.post('/api/v1/organizations/:orgId/guests',async req=>{
    const {orgId}=orgParam.parse(req.params),input=guestBody.parse(req.body);
    return inOrganization(req,pool,config,orgId,'guests.write',c=>idempotent(c,req,'guest.create',async()=>{
      if(c.propertyIds?.length===0)problem(403,'ACCESS_DENIED','Нет доступа к объектам');
      const row=await one(c.tx,`INSERT INTO guests(organization_id,display_name,email,phone,note,legal_basis) VALUES($1,$2,$3,$4,$5,$6)
        RETURNING id,display_name,email,phone,note,legal_basis,version`,[orgId,input.display_name,input.email??null,input.phone??null,input.note??null,input.legal_basis]);
      await audit(c,'guest.created','guest',(row as {id:string}).id);return row;
    }),{write:true,scope:true});
  });
  app.get('/api/v1/organizations/:orgId/guests/:guestId',async req=>{
    const {orgId,guestId}=z.object({orgId:id,guestId:id}).parse(req.params);
    return inOrganization(req,pool,config,orgId,'guests.read',async c=>{const row=await one(c.tx,`SELECT g.id,g.display_name,g.email,g.phone,g.note,g.legal_basis,g.version
      FROM guests g WHERE g.organization_id=$1 AND g.id=$2 AND ($3::uuid[] IS NULL OR EXISTS (
        SELECT 1 FROM reservations r JOIN reservation_stays s ON s.organization_id=r.organization_id AND s.reservation_id=r.id
        JOIN units u ON u.organization_id=s.organization_id AND u.id=s.unit_id
        WHERE r.organization_id=g.organization_id AND r.guest_id=g.id AND u.property_id=ANY($3::uuid[])))`,[orgId,guestId,c.propertyIds]);if(!row)problem(404,'RESOURCE_NOT_FOUND','Гость не найден');return row;},{scope:true});
  });
  app.get('/api/v1/organizations/:orgId/rate-plans',async req=>{
    const {orgId}=orgParam.parse(req.params);return inOrganization(req,pool,config,orgId,'rates.read',async c=>({items:(await c.tx.query('SELECT id,name,cancellation_policy,version,active FROM rate_plans WHERE organization_id=$1 ORDER BY name',[orgId])).rows}));
  });
  app.get('/api/v1/organizations/:orgId/rates',async req=>{
    const {orgId}=orgParam.parse(req.params),q=z.object({from:z.iso.date().optional(),to:z.iso.date().optional()}).parse(req.query);
    return inOrganization(req,pool,config,orgId,'rates.read',async c=>{
      const s=scopeSql(c,'u.property_id');const rows=await c.tx.query(`SELECT d.id,d.rate_plan_id,d.unit_id,d.stay_date::text,d.price_minor::text,d.min_nights,d.max_nights,d.stop_sell,d.version
        FROM rate_days d JOIN units u ON u.id=d.unit_id AND u.organization_id=d.organization_id
        WHERE d.organization_id=$1 ${s.sql} AND ($${s.params.length+1}::date IS NULL OR d.stay_date >= $${s.params.length+1})
        AND ($${s.params.length+2}::date IS NULL OR d.stay_date < $${s.params.length+2}) ORDER BY d.stay_date LIMIT 2000`,[...s.params,q.from??null,q.to??null]);return {items:rows.rows};
    },{scope:true});
  });
  app.post('/api/v1/organizations/:orgId/rates/preview',async req=>{
    const {orgId}=orgParam.parse(req.params),input=rateInput.parse(req.body);const dates=nightDates(stayRange(input.from,input.to));
    if(dates.length>366||new Set(input.unit_ids).size!==input.unit_ids.length)problem(422,'BUSINESS_RULE_FAILED','Некорректный диапазон или повторяющиеся номера');
    if(parseMinor(input.amount_minor)<0n)problem(422,'BUSINESS_RULE_FAILED','Цена должна быть неотрицательной');
    return inOrganization(req,pool,config,orgId,'rates.write',c=>idempotent(c,req,'rates.preview',async()=>{
      const plan=await one(c.tx,'SELECT id FROM rate_plans WHERE organization_id=$1 AND id=$2 AND active=true',[orgId,input.rate_plan_id]);if(!plan)problem(404,'RESOURCE_NOT_FOUND','Тариф не найден');
      const snapshot=await rateSnapshot(c,input),digest=hash({input,snapshot});
      const row=await one<{id:string;expires_at:string}>(c.tx,`INSERT INTO rate_change_previews(organization_id,actor_id,input_hash,input,rate_snapshot,expires_at)
        VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes') RETURNING id,expires_at`,[orgId,c.actor.id,digest,JSON.stringify(input),JSON.stringify(snapshot)]);
      return {preview_id:row?.id,input_hash:digest.toString('hex'),expires_at:row?.expires_at,unit_count:input.unit_ids.length,night_count:dates.length,change_count:dates.length*input.unit_ids.length,amount_minor:input.amount_minor,currency:'RUB'};
    }),{write:true,scope:true});
  });
  app.post('/api/v1/organizations/:orgId/rates/commit',async req=>{
    const {orgId}=orgParam.parse(req.params),input=z.object({preview_id:id,input_hash:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(3).max(500)}).strict().parse(req.body);
    return inOrganization(req,pool,config,orgId,'rates.write',c=>idempotent(c,req,'rates.commit',async()=>{
      const row=await one<{input: z.infer<typeof rateInput>;input_hash:Buffer;rate_snapshot:unknown[];committed_at:string|null}>(c.tx,
        'SELECT input,input_hash,rate_snapshot,committed_at FROM rate_change_previews WHERE organization_id=$1 AND id=$2 AND actor_id=$3 AND expires_at>now() FOR UPDATE',[orgId,input.preview_id,c.actor.id]);
      if(!row||row.committed_at)problem(412,'PREVIEW_CHANGED','Предпросмотр устарел');
      if(row.input_hash.toString('hex')!==input.input_hash)problem(412,'PREVIEW_CHANGED','Предпросмотр устарел');
      const current=await rateSnapshot(c,row.input);if(!hash({input:row.input,snapshot:current}).equals(row.input_hash))problem(412,'PREVIEW_CHANGED','Цены изменились. Повторите расчёт');
      const dates=nightDates(stayRange(row.input.from,row.input.to));
      for(const unitId of row.input.unit_ids)for(const day of dates){
        await c.tx.query(`INSERT INTO rate_days(organization_id,rate_plan_id,unit_id,stay_date,price_minor) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(organization_id,rate_plan_id,unit_id,stay_date) DO UPDATE SET price_minor=EXCLUDED.price_minor,version=rate_days.version+1`,
          [orgId,row.input.rate_plan_id,unitId,day,row.input.amount_minor]);
      }
      await c.tx.query('UPDATE rate_change_previews SET committed_at=now() WHERE organization_id=$1 AND id=$2',[orgId,input.preview_id]);
      const plan=await one<{version:number}>(c.tx,'UPDATE rate_plans SET version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING version',[orgId,row.input.rate_plan_id]);
      await audit(c,'rates.committed','rate_plan',row.input.rate_plan_id,input.reason,{unit_count:row.input.unit_ids.length,night_count:dates.length});
      await outbox(c,'rate_plan',row.input.rate_plan_id,plan!.version,'rates.changed',{unit_ids:row.input.unit_ids,from:row.input.from,to:row.input.to});
      return {committed:true,change_count:row.input.unit_ids.length*dates.length};
    }),{write:true,scope:true});
  });
}
