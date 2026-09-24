import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import type {Config} from './config.js';
import {requireActor,requireCsrf} from './auth.js';
import {one,withIdentity,withTenant} from './db.js';
import {problem} from './problem.js';
import {audit,idempotent,inOrganization} from './tenant.js';

const id=z.uuid();
const orgBody=z.object({display_name:z.string().trim().min(2).max(120),timezone:z.string().min(3).max(100).default('Europe/Moscow'),currency:z.literal('RUB').default('RUB')}).strict();
const orgPatch=orgBody.partial().extend({legal_name:z.string().trim().max(200).nullable().optional()}).strict();
function orgDto(row:Record<string,unknown>){return row;}
export async function registerOrganizations(app:FastifyInstance,pool:pg.Pool,config:Config):Promise<void>{
  app.get('/api/v1/organizations',async req=>{
    const actor=await requireActor(req,pool);
    return withIdentity(pool,actor.id,async tx=>{
      const result=await tx.query(`SELECT o.id,o.display_name,o.legal_name,o.timezone,o.currency,o.state,o.version,m.role
        FROM organizations o JOIN memberships m ON m.organization_id=o.id
        WHERE m.user_id=$1 AND m.status='active' ORDER BY o.created_at DESC`,[actor.id]);
      return {items:result.rows.map(orgDto)};
    });
  });
  app.post('/api/v1/organizations',async req=>{
    const actor=await requireActor(req,pool);requireCsrf(req,config,actor);
    const input=orgBody.parse(req.body);const key=req.headers['idempotency-key'];
    if(typeof key!=='string'||key.length<16||key.length>128)problem(400,'IDEMPOTENCY_KEY_REQUIRED','Нужен ключ безопасного повтора действия');
    const hash=createHash('sha256').update(JSON.stringify(input)).digest();const newId=randomUUID();
    return withTenant(pool,newId,actor.id,async tx=>{
      await tx.query(`INSERT INTO onboarding_requests(user_id,key,request_hash,organization_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[actor.id,key,hash,newId]);
      const request=await one<{request_hash:Buffer;organization_id:string}>(tx,'SELECT request_hash,organization_id FROM onboarding_requests WHERE user_id=$1 AND key=$2 FOR UPDATE',[actor.id,key]);
      if(!request)throw new Error('Onboarding request missing');
      if(!request.request_hash.equals(hash))problem(409,'IDEMPOTENCY_KEY_REUSED','Ключ уже использован с другими данными');
      if(request.organization_id!==newId){
        // The idempotency record belongs to an existing organization. This transaction
        // has a different tenant setting, so return only the ID already bound to actor.
        return {id:request.organization_id};
      }
      const org=await one<{id:string;display_name:string;timezone:string;currency:string;version:number}>(tx,
        'INSERT INTO organizations(id,display_name,timezone,currency) VALUES($1,$2,$3,$4) RETURNING id,display_name,timezone,currency,version',[newId,input.display_name,input.timezone,input.currency]);
      await tx.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[newId,actor.id]);
      await tx.query("INSERT INTO subscriptions(organization_id,state,trial_ends_at,grace_ends_at) VALUES($1,'trial',now()+interval '14 days',now()+interval '21 days')",[newId]);
      await tx.query("INSERT INTO rate_plans(organization_id,name) VALUES($1,'Базовый тариф')",[newId]);
      return org;
    });
  });
  app.get('/api/v1/organizations/:orgId',async req=>{
    const {orgId}=z.object({orgId:id}).parse(req.params);
    return inOrganization(req,pool,config,orgId,'org.read',async ({tx,member})=>{
      const row=await one(tx,`SELECT o.id,o.display_name,o.legal_name,o.timezone,o.currency,o.state,o.version,
        s.state AS subscription_state,s.trial_ends_at,s.paid_through,s.grace_ends_at FROM organizations o
        JOIN subscriptions s ON s.organization_id=o.id WHERE o.id=$1`,[orgId]);
      if(!row)problem(404,'RESOURCE_NOT_FOUND','Организация не найдена');return {...row,role:member.role};
    });
  });
  app.patch('/api/v1/organizations/:orgId',async req=>{
    const {orgId}=z.object({orgId:id}).parse(req.params),input=orgPatch.parse(req.body);
    return inOrganization(req,pool,config,orgId,'org.manage',async context=>idempotent(context,req,'organization.update',async()=>{
      const value=req.headers['if-match'];const match=Number(typeof value==='string'?/^"?(\d+)"?$/.exec(value)?.[1]:NaN);if(!Number.isSafeInteger(match)||match<1)problem(428,'VERSION_REQUIRED','Передайте актуальную версию организации');
      const row=await one(context.tx,`UPDATE organizations SET display_name=COALESCE($3,display_name),timezone=COALESCE($4,timezone),
        legal_name=CASE WHEN $5::boolean THEN $6 ELSE legal_name END,version=version+1,updated_at=now()
        WHERE id=$1 AND version=$2 RETURNING id,display_name,timezone,legal_name,currency,version`,
        [orgId,match,input.display_name??null,input.timezone??null,'legal_name' in input,input.legal_name??null]);
      if(!row)problem(412,'VERSION_CHANGED','Данные изменились. Обновите страницу');
      await audit(context,'organization.updated','organization',orgId,undefined,{fields:Object.keys(input)});return row;
    }),{write:true});
  });
}
