import {createHash} from 'node:crypto';
import type {FastifyRequest} from 'fastify';
import type pg from 'pg';
import type {Config} from './config.js';
import {requireActor,requireCsrf,type Actor} from './auth.js';
import {withTenant,type Tx,one} from './db.js';
import {problem} from './problem.js';

export type Role='owner'|'admin'|'manager'|'accountant'|'housekeeper'|'viewer';
export type Membership={id:string;organization_id:string;role:Role;status:string;permissions:string[];version:number};
export type TenantContext={tx:Tx;actor:Actor;member:Membership;organizationId:string;propertyIds:string[]|null};
const permissionRoles:Record<string,Role[]>={
  'org.read':['owner','admin','manager','accountant','housekeeper','viewer'],
  'org.manage':['owner'],
  'inventory.read':['owner','admin','manager','accountant','viewer'],
  'inventory.write':['owner','admin','manager'],
  'rates.read':['owner','admin','manager','accountant','viewer'],
  'rates.write':['owner','admin','manager'],
  'reservations.read':['owner','admin','manager','accountant','viewer'],
  'reservations.write':['owner','admin','manager'],
  'reservations.cancel':['owner','admin','manager'],
  'guests.read':['owner','admin','manager','accountant'],
  'guests.write':['owner','admin','manager'],
  'finance.read':['owner','admin','accountant'],
  'finance.global':['owner','admin'],
  'finance.write':['owner','admin','accountant'],
  'finance.refund':['owner','admin','accountant'],
  'reports.read':['owner','admin','manager','accountant'],
  'integration.read':['owner','admin','manager'],
  'integration.manage':['owner','admin'],
  'tasks.read':['owner','admin','manager','housekeeper'],
  'tasks.write':['owner','admin','manager'],
  'staff.read':['owner','admin'],
  'staff.manage':['owner','admin'],
  'billing.read':['owner','admin','accountant'],
  'billing.manage':['owner'],
  'import.read':['owner','admin'],
  'import.write':['owner','admin'],
  'audit.read':['owner','admin']
};
export function can(member:Membership,permission:string):boolean{
  const roles=permissionRoles[permission];return !!roles?.includes(member.role)||member.permissions.includes(permission);
}
export async function inOrganization<T>(req:FastifyRequest,pool:pg.Pool,config:Config,organizationId:string,permission:string,fn:(context:TenantContext)=>Promise<T>,opts:{write?:boolean;scope?:boolean}={}):Promise<T>{
  const actor=await requireActor(req,pool);if(opts.write)requireCsrf(req,config,actor);
  return withTenant(pool,organizationId,actor.id,async tx=>{
    const member=await one<Membership>(tx,`SELECT id,organization_id,role,status,permissions,version FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active' ${opts.write?'FOR SHARE':''}`,[organizationId,actor.id]);
    if(!member)problem(404,'RESOURCE_NOT_FOUND','Запись недоступна или удалена');
    if(!can(member,permission))problem(403,'ACCESS_DENIED','Недостаточно прав');
    if(opts.write){
      const state=await one<{state:string;grace_ends_at:string|null}>(tx,'SELECT state,grace_ends_at FROM subscriptions WHERE organization_id=$1',[organizationId]);
      if(state?.state==='read_only'||(state?.state==='grace'&&state.grace_ends_at&&Date.parse(state.grace_ends_at)<Date.now()))problem(403,'SUBSCRIPTION_READ_ONLY','Подписка ограничена: доступен просмотр и экспорт');
    }
    let propertyIds:string[]|null=null;
    if(opts.scope && !['owner','admin'].includes(member.role)){
      const rows=await tx.query<{property_id:string}>('SELECT property_id FROM property_grants WHERE organization_id=$1 AND membership_id=$2',[organizationId,member.id]);propertyIds=rows.rows.map(r=>r.property_id);
    }
    return fn({tx,actor,member,organizationId,propertyIds});
  });
}
export function assertProperty(context:TenantContext,propertyId:string):void{
  if(context.propertyIds && !context.propertyIds.includes(propertyId))problem(404,'RESOURCE_NOT_FOUND','Запись недоступна или удалена');
}
function canonical(value:unknown):string{
  if(value===undefined)return 'null';
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
export async function idempotent<T>(context:TenantContext,req:FastifyRequest,operation:string,run:()=>Promise<T>):Promise<T>{
  const key=req.headers['idempotency-key'];if(typeof key!=='string'||key.length<16||key.length>128)problem(400,'IDEMPOTENCY_KEY_REQUIRED','Нужен ключ безопасного повтора действия');
  // A cached response may contain guest or financial data. Bind it to the
  // current membership and property grants so revoked access cannot replay it.
  const hash=createHash('sha256').update(canonical({method:req.method,path:req.url,ifMatch:req.headers['if-match']??null,body:req.body??null,
    authorization:{membershipId:context.member.id,role:context.member.role,permissions:[...context.member.permissions].sort(),version:context.member.version,propertyIds:context.propertyIds?.slice().sort()??null}})).digest();const {tx,organizationId,actor}=context;
  await tx.query(`INSERT INTO idempotency_records(organization_id,actor_id,operation,key,request_hash)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[organizationId,actor.id,operation,key,hash]);
  const row=await one<{request_hash:Buffer;response_body:T|null}>(tx,`SELECT request_hash,response_body FROM idempotency_records WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4 FOR UPDATE`,[organizationId,actor.id,operation,key]);
  if(!row)throw new Error('Idempotency record missing');
  if(!row.request_hash.equals(hash))problem(409,'IDEMPOTENCY_KEY_REUSED','Ключ уже использован с другими данными');
  if(row.response_body!==null)return row.response_body;
  const result=await run();
  await tx.query('UPDATE idempotency_records SET response_status=200,response_body=$5::jsonb WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4',[organizationId,actor.id,operation,key,JSON.stringify(result)]);
  return result;
}
export async function audit(context:TenantContext,action:string,resourceType:string,resourceId:string|null,reason?:string,safeDiff:Record<string,unknown>={}):Promise<void>{
  await context.tx.query('INSERT INTO audit_events(organization_id,actor_id,action,resource_type,resource_id,reason,safe_diff) VALUES($1,$2,$3,$4,$5,$6,$7)',[context.organizationId,context.actor.id,action,resourceType,resourceId,reason??null,JSON.stringify(safeDiff)]);
}
export async function outbox(context:TenantContext,aggregateType:string,aggregateId:string,version:number,kind:string,payload:Record<string,unknown>):Promise<void>{
  await context.tx.query('INSERT INTO outbox_events(organization_id,aggregate_type,aggregate_id,aggregate_version,kind,payload) VALUES($1,$2,$3,$4,$5,$6)',[context.organizationId,aggregateType,aggregateId,version,kind,JSON.stringify(payload)]);
}
