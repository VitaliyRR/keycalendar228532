import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {buildQuote,nightDates,parseMinor,planAllocation,stayRange,buildCancellationPreview,transitionReservation,type CancellationPreviewInput,type FinancialEvent,type Quote} from '@keycalendar/domain';
import type {Config} from './config.js';
import {one} from './db.js';
import {problem} from './problem.js';
import {assertProperty,audit,idempotent,inOrganization,outbox,type TenantContext} from './tenant.js';
import {postFinancial,reservationFinancialEvents} from './finance-core.js';
import {icalConflictBlocks} from './connections-availability.js';

const id=z.uuid();const date=z.iso.date();const orgParam=z.object({orgId:id});
const quoteBody=z.object({unit_id:id,checkin:date,checkout:date,adults:z.coerce.number().int().min(1).max(100),children:z.coerce.number().int().min(0).max(100).default(0),rate_plan_id:id.optional(),source:z.string().max(50).default('direct')}).strict();
const reservationBody=quoteBody.omit({rate_plan_id:true}).extend({guest_id:id.optional(),guest_name:z.string().trim().min(1).max(160).optional(),status:z.enum(['request','confirmed']).default('request'),quote_id:id.optional()}).strict();
const moveBody=z.object({unit_id:id,checkin:date,checkout:date,quote_id:id,reason:z.string().trim().min(3).max(500)}).strict();
const blockBody=z.object({unit_id:id,from:date,to:date,reason:z.string().trim().min(3).max(500)}).strict();
function digest(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function localDate(instant:string,timeZone:string):string{const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));const value=(name:string)=>parts.find(p=>p.type===name)?.value??'';return `${value('year')}-${value('month')}-${value('day')}`;}
function version(header:unknown):number{const match=typeof header==='string'?/^"?(\d+)"?$/.exec(header):null;const n=Number(match?.[1]);if(!Number.isSafeInteger(n)||n<1)problem(428,'VERSION_REQUIRED','Передайте актуальную версию записи');return n;}
type UnitRow={id:string;property_id:string;category_id:string|null;base_rate_minor:string;currency:string;capacity_adults:number;capacity_children:number;version:number;state:string};
async function unitForUpdate(c:TenantContext,unitId:string):Promise<UnitRow>{
  const row=await one<UnitRow>(c.tx,`SELECT id,property_id,category_id,base_rate_minor::text,currency,capacity_adults,capacity_children,version,state
    FROM units WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[c.organizationId,unitId]);
  if(!row||row.state!=='active')problem(404,'UNIT_UNAVAILABLE','Номер недоступен');assertProperty(c,row.property_id);return row;
}
async function price(c:TenantContext,input:z.infer<typeof quoteBody>,quoteId:string):Promise<Quote>{
  const range=stayRange(input.checkin,input.checkout),dates=nightDates(range);if(dates.length>366)problem(422,'INVALID_RANGE','Период не может превышать 366 ночей');
  const unit=await unitForUpdate(c,input.unit_id);
  if(input.adults>unit.capacity_adults||input.children>unit.capacity_children)problem(422,'CAPACITY_EXCEEDED','Превышена вместимость номера');
  const plan=input.rate_plan_id?await one<{id:string;version:number}>(c.tx,'SELECT id,version FROM rate_plans WHERE organization_id=$1 AND id=$2 AND active=true',[c.organizationId,input.rate_plan_id]):await one<{id:string;version:number}>(c.tx,'SELECT id,version FROM rate_plans WHERE organization_id=$1 AND active=true ORDER BY name,id LIMIT 1',[c.organizationId]);
  if(!plan)problem(422,'RATE_UNAVAILABLE','Для организации нет действующего тарифа');
  const rows=await c.tx.query<{stay_date:string;price_minor:string;min_nights:number|null;max_nights:number|null;stop_sell:boolean;version:number}>(
    `SELECT stay_date::text,price_minor::text,min_nights,max_nights,stop_sell,version FROM rate_days
     WHERE organization_id=$1 AND rate_plan_id=$2 AND unit_id=$3 AND stay_date>=$4 AND stay_date<$5 ORDER BY stay_date`,[c.organizationId,plan.id,unit.id,input.checkin,input.checkout]);
  const byDay=new Map(rows.rows.map(r=>[r.stay_date,r]));
  const rateVersionHash=digest({unit:[unit.id,unit.version,unit.base_rate_minor],plan:[plan.id,plan.version],days:rows.rows});
  return buildQuote({id:quoteId,ratePlanId:plan.id,rateVersionHash,unitId:unit.id,stay:range,currency:unit.currency,source:input.source,expiresAt:new Date(Date.now()+10*60_000).toISOString(),nights:dates.map(day=>{
    const override=byDay.get(day);return {date:day,base:{ruleId:`unit:${unit.id}:base`,version:unit.version,amountMinor:unit.base_rate_minor},
      ...(override?{dayOverride:{ruleId:`rate:${plan.id}:${day}`,version:override.version,amountMinor:override.price_minor},stopSell:override.stop_sell,
        ...(override.min_nights?{minStay:override.min_nights}:{}),...(override.max_nights?{maxStay:override.max_nights}:{})}:{})};
  })});
}
function quoteDto(quote:Quote){return {id:quote.id,rate_plan_id:quote.ratePlanId,unit_id:quote.unitId,checkin:quote.stay.from,checkout:quote.stay.to,total_minor:quote.totalMinor,currency:quote.currency,expires_at:quote.expiresAt,
  lines:quote.lines.map(line=>({date:line.date,kind:line.kind,description:line.description,total_minor:line.totalMinor,rule_id:line.ruleId,rule_version:line.ruleVersion}))};}
async function verifiedQuote(c:TenantContext,input:z.infer<typeof quoteBody>,quoteId:string):Promise<{row:{id:string;total_minor:string;currency:string;lines:Quote['lines'];rate_plan_id:string};fresh:Quote}>{
  const row=await one<{id:string;total_minor:string;currency:string;lines:Quote['lines'];rate_plan_id:string;rate_version_hash:string;input_hash:Buffer}>(c.tx,
    `SELECT id,total_minor::text,currency,lines,rate_plan_id,rate_version_hash,input_hash FROM quotes WHERE organization_id=$1 AND id=$2 AND unit_id=$3
     AND checkin=$4 AND checkout=$5 AND adults=$6 AND children=$7 AND expires_at>now() FOR UPDATE`,
    [c.organizationId,quoteId,input.unit_id,input.checkin,input.checkout,input.adults,input.children]);
  if(!row)problem(412,'QUOTE_EXPIRED','Расчёт цены устарел. Рассчитайте снова');
  const fresh=await price(c,{...input,rate_plan_id:row.rate_plan_id},quoteId);
  if(row.rate_version_hash!==fresh.rateVersionHash||row.total_minor!==fresh.totalMinor||row.currency!==fresh.currency||!row.input_hash.equals(Buffer.from(digest({unit_id:input.unit_id,checkin:input.checkin,checkout:input.checkout,adults:input.adults,children:input.children,source:input.source}),'hex')))
    problem(412,'QUOTE_CHANGED','Цена или условия изменились. Рассчитайте снова');
  return {row,fresh};
}
async function allocate(c:TenantContext,reservationId:string,unitId:string,from:string,to:string,replaceIds:string[]=[]):Promise<void>{
  await unitForUpdate(c,unitId);
  if((await icalConflictBlocks(c.tx,c.organizationId,[unitId],from,to)).length)problem(409,'AVAILABILITY_CONFLICT','Известная внешняя занятость требует разрешения конфликта');
  await c.tx.query("UPDATE availability_allocations SET state='released' WHERE organization_id=$1 AND kind='hold' AND state='active' AND expires_at<=now() AND unit_id=$2",[c.organizationId,unitId]);
  const rows=await c.tx.query<{id:string;unit_id:string;kind:'reservation'|'block'|'hold';checkin:string;checkout:string;state:string;expires_at:string|null}>(
    `SELECT id,unit_id,kind,checkin::text,checkout::text,state,expires_at FROM availability_allocations
     WHERE organization_id=$1 AND unit_id=$2 AND state='active' AND daterange(checkin,checkout,'[)') && daterange($3::date,$4::date,'[)') FOR UPDATE`,[c.organizationId,unitId,from,to]);
  const existing=rows.rows.map(r=>({id:r.id,organizationId:c.organizationId,resourceId:r.unit_id,range:stayRange(r.checkin,r.checkout),active:r.state==='active',kind:r.kind,...(r.expires_at?{holdExpiresAt:new Date(r.expires_at).toISOString()}:{})}));
  const plan=planAllocation([{organizationId:c.organizationId,unitId,resourceIds:[unitId],stay:stayRange(from,to),kind:'reservation'}],existing,{at:new Date().toISOString(),replaceAllocationIds:replaceIds.filter(id=>existing.some(e=>e.id===id))});
  if(!plan.ok)problem(409,'AVAILABILITY_CONFLICT','Даты уже заняты');
  if(replaceIds.length)await c.tx.query("UPDATE availability_allocations SET state='released' WHERE organization_id=$1 AND reservation_id=$2 AND id=ANY($3::uuid[])",[c.organizationId,reservationId,replaceIds]);
  await c.tx.query(`INSERT INTO availability_allocations(organization_id,unit_id,reservation_id,kind,checkin,checkout) VALUES($1,$2,$3,'reservation',$4,$5)`,[c.organizationId,unitId,reservationId,from,to]);
}
async function reservationDto(c:TenantContext,reservationId:string){
  const row=await one<{id:string;reference:string;guest_id:string|null;guest_display_name:string|null;status:string;source:string;total_minor:string;currency:string;sync_state:string;version:number;archived_at:string|null;created_at:string;updated_at:string}>(c.tx,
    `SELECT id,reference,guest_id,guest_display_name,status,source,total_minor::text,currency,sync_state,version,archived_at,created_at,updated_at
     FROM reservations WHERE organization_id=$1 AND id=$2`,[c.organizationId,reservationId]);if(!row)problem(404,'RESOURCE_NOT_FOUND','Бронь не найдена');
  const stays=(await c.tx.query<{unit_id:string;checkin:string;checkout:string;adults:number;children:number;property_id:string}>(
    `SELECT s.unit_id,s.checkin::text,s.checkout::text,s.adults,s.children,u.property_id FROM reservation_stays s JOIN units u ON u.id=s.unit_id AND u.organization_id=s.organization_id
     WHERE s.organization_id=$1 AND s.reservation_id=$2 ORDER BY s.checkin`,[c.organizationId,reservationId])).rows;
  if(c.propertyIds&&stays.some(s=>!c.propertyIds!.includes(s.property_id)))problem(404,'RESOURCE_NOT_FOUND','Бронь не найдена');
  const payments=await c.tx.query<{paid:string}>(`SELECT (COALESCE((SELECT SUM(amount_minor) FROM payments WHERE organization_id=$1 AND reservation_id=$2 AND kind='stay' AND state='succeeded'),0)
    - COALESCE((SELECT SUM(f.amount_minor) FROM refunds f JOIN payments p ON p.id=f.payment_id AND p.organization_id=f.organization_id
      WHERE f.organization_id=$1 AND p.reservation_id=$2 AND f.state='succeeded'),0))::text AS paid`,[c.organizationId,reservationId]);
  const deposits=await c.tx.query<{held:string}>(`SELECT COALESCE(SUM(captured_minor-returned_minor-retained_minor),0)::text AS held FROM deposits WHERE organization_id=$1 AND reservation_id=$2`,[c.organizationId,reservationId]);
  const guest=row.guest_id?await one<{id:string;display_name:string}>(c.tx,'SELECT id,display_name FROM guests WHERE organization_id=$1 AND id=$2',[c.organizationId,row.guest_id]):null;
  return {...row,stays:stays.map(({property_id,...stay})=>stay),guest,guest_name:row.guest_display_name,paid_minor:payments.rows[0]?.paid??'0',deposit_held_minor:deposits.rows[0]?.held??'0'};
}
async function chargeQuote(c:TenantContext,reservationId:string,quote:Quote):Promise<void>{
  const nights=new Map<string,bigint>();for(const line of quote.lines){if(line.kind==='service')continue;const day=line.date!;nights.set(day,(nights.get(day)??0n)+parseMinor(line.totalMinor));}
  for(const [day,amount] of nights){if(amount<=0n)continue;const charge=await one<{id:string}>(c.tx,`INSERT INTO charges(organization_id,reservation_id,kind,amount_minor,currency,service_date,description)
    VALUES($1,$2,'night',$3,$4,$5,$6) RETURNING id`,[c.organizationId,reservationId,amount.toString(),quote.currency,day,`Проживание ${day}`]);
    await postFinancial(c,'charge',charge!.id,'lodging_charge',amount.toString(),quote.currency);
  }
  for(const line of quote.lines.filter(l=>l.kind==='service'&&parseMinor(l.totalMinor)>0n)){
    const charge=await one<{id:string}>(c.tx,`INSERT INTO charges(organization_id,reservation_id,kind,amount_minor,currency,service_date,description)
      VALUES($1,$2,'service',$3,$4,$5,$6) RETURNING id`,[c.organizationId,reservationId,line.totalMinor,quote.currency,line.date??null,line.description]);
    await postFinancial(c,'charge',charge!.id,'service_charge',line.totalMinor,quote.currency);
  }
}
async function cancellationInput(c:TenantContext,res:{id:string;version:number;currency:string},effectiveAt:string):Promise<CancellationPreviewInput>{
  const events:FinancialEvent[]=await reservationFinancialEvents(c,res.id,res.currency);
  const charges=await c.tx.query<{id:string;kind:string;amount_minor:string;service_date:string|null;already_credited:string}>(
    `SELECT c.id,c.kind,c.amount_minor::text,c.service_date::text,COALESCE((SELECT -SUM(n.amount_minor) FROM charges n
      WHERE n.organization_id=c.organization_id AND n.original_charge_id=c.id),0)::text AS already_credited
     FROM charges c WHERE c.organization_id=$1 AND c.reservation_id=$2 AND c.amount_minor>0 ORDER BY c.id`,[c.organizationId,res.id]);
  const property=await one<{timezone:string}>(c.tx,`SELECT p.timezone FROM reservation_stays s JOIN units u ON u.id=s.unit_id AND u.organization_id=s.organization_id
    JOIN properties p ON p.id=u.property_id AND p.organization_id=u.organization_id WHERE s.organization_id=$1 AND s.reservation_id=$2 LIMIT 1`,[c.organizationId,res.id]);
  const currentDay=localDate(effectiveAt,property?.timezone??'Europe/Moscow');const cancellableCharges=[];
  for(const charge of charges.rows){if(charge.kind==='fee')continue;
    const recognized=charge.service_date&&charge.service_date<currentDay?BigInt(charge.amount_minor):0n;
    const remaining=BigInt(charge.amount_minor)-recognized-BigInt(charge.already_credited);
    if(remaining>0n)cancellableCharges.push({chargeEventId:charge.id,amountMinor:remaining.toString(),recognizedMinor:recognized.toString(),alreadyCreditedMinor:charge.already_credited,reason:'Отмена проживания'});
  }
  const counts=await c.tx.query<{charges:number;payments:number;refunds:number;deposits:number}>(`SELECT
    (SELECT COUNT(*)::int FROM charges WHERE organization_id=$1 AND reservation_id=$2) AS charges,
    (SELECT COUNT(*)::int FROM payments WHERE organization_id=$1 AND reservation_id=$2) AS payments,
    (SELECT COUNT(*)::int FROM refunds f JOIN payments p ON p.id=f.payment_id AND p.organization_id=f.organization_id WHERE f.organization_id=$1 AND p.reservation_id=$2) AS refunds,
    (SELECT COUNT(*)::int FROM deposits WHERE organization_id=$1 AND reservation_id=$2) AS deposits`,[c.organizationId,res.id]);
  const n=counts.rows[0]!;
  return {reservationId:res.id,reservationVersion:res.version,chargeVersion:n.charges,paymentVersion:n.payments,refundVersion:n.refunds,depositVersion:n.deposits,
    effectiveAt,currency:res.currency,events,cancellableCharges,policy:{version:'free-v1',kind:'free'}};
}
export async function registerReservations(app:FastifyInstance,pool:pg.Pool,config:Config):Promise<void>{
  app.post('/api/v1/organizations/:orgId/quotes',async req=>{
    const {orgId}=orgParam.parse(req.params),input=quoteBody.parse(req.body);
    return inOrganization(req,pool,config,orgId,'rates.read',c=>idempotent(c,req,'quote.create',async()=>{
      const quote=await price(c,input,randomUUID());const row=await one(c.tx,`INSERT INTO quotes(id,organization_id,unit_id,rate_plan_id,checkin,checkout,adults,children,currency,total_minor,lines,input_hash,rate_version_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,[quote.id,orgId,input.unit_id,quote.ratePlanId,input.checkin,input.checkout,input.adults,input.children,quote.currency,quote.totalMinor,JSON.stringify(quote.lines),Buffer.from(digest({unit_id:input.unit_id,checkin:input.checkin,checkout:input.checkout,adults:input.adults,children:input.children,source:input.source}),'hex'),quote.rateVersionHash,quote.expiresAt]);
      return quoteDto(quote);
    }),{write:true,scope:true});
  });
  app.get('/api/v1/organizations/:orgId/reservations',async req=>{
    const {orgId}=orgParam.parse(req.params),q=z.object({status:z.string().optional(),date:date.optional()}).parse(req.query);
    return inOrganization(req,pool,config,orgId,'reservations.read',async c=>{
      const rows=await c.tx.query<{id:string}>(`SELECT DISTINCT r.id,r.created_at FROM reservations r JOIN reservation_stays s ON s.reservation_id=r.id AND s.organization_id=r.organization_id
        JOIN units u ON u.id=s.unit_id AND u.organization_id=r.organization_id WHERE r.organization_id=$1 AND ($2::text IS NULL OR r.status=$2)
        AND ($3::date IS NULL OR s.checkin=$3 OR s.checkout=$3) AND ($4::uuid[] IS NULL OR u.property_id=ANY($4))
        ORDER BY r.created_at DESC LIMIT 100`,[orgId,q.status??null,q.date??null,c.propertyIds]);
      return {items:await Promise.all(rows.rows.map(r=>reservationDto(c,r.id)))};
    },{scope:true});
  });
  app.get('/api/v1/organizations/:orgId/reservations/:reservationId',async req=>{
    const {orgId,reservationId}=z.object({orgId:id,reservationId:id}).parse(req.params);
    return inOrganization(req,pool,config,orgId,'reservations.read',c=>reservationDto(c,reservationId),{scope:true});
  });
  app.post('/api/v1/organizations/:orgId/reservations',async req=>{
    const {orgId}=orgParam.parse(req.params),input=reservationBody.parse(req.body);const range=stayRange(input.checkin,input.checkout);
    if(nightDates(range).length>366||(!input.guest_id&&!input.guest_name))problem(422,'BUSINESS_RULE_FAILED','Укажите гостя и период до 366 ночей');
    return inOrganization(req,pool,config,orgId,'reservations.write',c=>idempotent(c,req,'reservation.create',async()=>{
      const unit=await unitForUpdate(c,input.unit_id);if(input.adults>unit.capacity_adults||input.children>unit.capacity_children)problem(422,'CAPACITY_EXCEEDED','Превышена вместимость номера');
      if(input.guest_id){const guest=await one(c.tx,'SELECT id FROM guests WHERE organization_id=$1 AND id=$2',[orgId,input.guest_id]);if(!guest)problem(404,'RESOURCE_NOT_FOUND','Гость не найден');}
      const confirmed=input.status==='confirmed';let quote:Quote|undefined;
      if(confirmed){if(!input.quote_id)problem(422,'QUOTE_REQUIRED','Подтверждение требует свежий расчёт');quote=(await verifiedQuote(c,input,input.quote_id)).fresh;}
      const reservationId=randomUUID(),reference=`KC-${reservationId.slice(0,8).toUpperCase()}`;
      await c.tx.query(`INSERT INTO reservations(id,organization_id,reference,guest_id,guest_display_name,status,source,accepted_quote_id,total_minor,currency,sync_state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[reservationId,orgId,reference,input.guest_id??null,input.guest_name??null,input.status,input.source,confirmed?input.quote_id:null,quote?.totalMinor??'0',unit.currency,'local_only']);
      await c.tx.query(`INSERT INTO reservation_stays(organization_id,reservation_id,unit_id,checkin,checkout,adults,children) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [orgId,reservationId,input.unit_id,input.checkin,input.checkout,input.adults,input.children]);
      if(confirmed){await allocate(c,reservationId,input.unit_id,input.checkin,input.checkout);await chargeQuote(c,reservationId,quote!);await outbox(c,'reservation',reservationId,1,'reservation.confirmed',{reservation_id:reservationId});}
      await audit(c,'reservation.created','reservation',reservationId,undefined,{status:input.status});return reservationDto(c,reservationId);
    }),{write:true,scope:true});
  });
  app.patch('/api/v1/organizations/:orgId/reservations/:reservationId',async req=>{
    const {orgId,reservationId}=z.object({orgId:id,reservationId:id}).parse(req.params),input=moveBody.parse(req.body),expected=version(req.headers['if-match']);
    return inOrganization(req,pool,config,orgId,'reservations.write',c=>idempotent(c,req,'reservation.move',async()=>{
      const res=await one<{id:string;version:number;status:string;currency:string;source:string}>(c.tx,'SELECT id,version,status,currency,source FROM reservations WHERE organization_id=$1 AND id=$2 FOR UPDATE',[orgId,reservationId]);
      if(!res)problem(404,'RESOURCE_NOT_FOUND','Бронь не найдена');if(res.version!==expected)problem(412,'VERSION_CHANGED','Бронь изменилась. Обновите страницу');
      if(!['request','confirmed'].includes(res.status))problem(422,'INVALID_STATE','Сейчас нельзя изменить проживание');
      const old=await one<{id:string;unit_id:string;property_id:string;adults:number;children:number;checkin:string;timezone:string}>(c.tx,`SELECT s.id,s.unit_id,u.property_id,s.adults,s.children,s.checkin::text,p.timezone FROM reservation_stays s JOIN units u ON u.id=s.unit_id AND u.organization_id=s.organization_id
        JOIN properties p ON p.id=u.property_id AND p.organization_id=u.organization_id WHERE s.organization_id=$1 AND s.reservation_id=$2 FOR UPDATE OF s`,[orgId,reservationId]);
      if(!old)problem(404,'RESOURCE_NOT_FOUND','Проживание не найдено');assertProperty(c,old.property_id);
      if(old.checkin<=localDate(new Date().toISOString(),old.timezone))problem(422,'STAY_ALREADY_STARTED','Изменение проживание после даты заезда требует отдельного расчёта');
      const quote=(await verifiedQuote(c,{unit_id:input.unit_id,checkin:input.checkin,checkout:input.checkout,adults:old.adults,children:old.children,source:res.source},input.quote_id)).fresh;
      if(res.status==='confirmed'){
        const allocations=await c.tx.query<{id:string}>("SELECT id FROM availability_allocations WHERE organization_id=$1 AND reservation_id=$2 AND state='active' FOR UPDATE",[orgId,reservationId]);
        const ids=allocations.rows.map(r=>r.id);
        await c.tx.query("UPDATE availability_allocations SET state='released' WHERE organization_id=$1 AND reservation_id=$2 AND state='active'",[orgId,reservationId]);
        await allocate(c,reservationId,input.unit_id,input.checkin,input.checkout,ids);
      }
      await c.tx.query('UPDATE reservation_stays SET unit_id=$3,checkin=$4,checkout=$5 WHERE organization_id=$1 AND id=$2',[orgId,old.id,input.unit_id,input.checkin,input.checkout]);
      const confirmed=res.status==='confirmed';
      const row=await one<{version:number}>(c.tx,`UPDATE reservations SET accepted_quote_id=$3,total_minor=$4,version=version+1,updated_at=now(),sync_state=$5
        WHERE organization_id=$1 AND id=$2 RETURNING version`,[orgId,reservationId,confirmed?input.quote_id:null,confirmed?quote.totalMinor:'0','local_only']);
      if(confirmed){
        // A request has no sale or debt. Only confirmed reservations post charges.
        const oldCharges=await c.tx.query<{id:string;amount_minor:string;kind:string;service_date:string|null}>(`SELECT id,amount_minor::text,kind,service_date::text FROM charges WHERE organization_id=$1 AND reservation_id=$2 AND amount_minor>0 FOR UPDATE`,[orgId,reservationId]);
        for(const charge of oldCharges.rows){const credited=await one<{amount:string}>(c.tx,'SELECT COALESCE(-SUM(amount_minor),0)::text AS amount FROM charges WHERE organization_id=$1 AND original_charge_id=$2',[orgId,charge.id]);const remaining=BigInt(charge.amount_minor)-BigInt(credited?.amount??'0');if(remaining<=0n)continue;
          const credit=await one<{id:string}>(c.tx,`INSERT INTO charges(organization_id,reservation_id,original_charge_id,kind,amount_minor,currency,service_date,description)
            VALUES($1,$2,$3,'credit_note',$4,$5,$6,'Изменение проживания') RETURNING id`,[orgId,reservationId,charge.id,(-remaining).toString(),res.currency,charge.service_date]);
          await postFinancial(c,'charge',credit!.id,charge.kind==='service'?'service_credit_note':'lodging_credit_note',remaining.toString(),res.currency);
        }
        await chargeQuote(c,reservationId,quote);
      }
      await audit(c,'reservation.moved','reservation',reservationId,input.reason,{unit_id:input.unit_id,checkin:input.checkin,checkout:input.checkout});
      if(confirmed)await outbox(c,'reservation',reservationId,row!.version,'reservation.changed',{reservation_id:reservationId});return reservationDto(c,reservationId);
    }),{write:true,scope:true});
  });
  app.post('/api/v1/organizations/:orgId/reservations/:reservationId/financial-preview',async req=>{
    const {orgId,reservationId}=z.object({orgId:id,reservationId:id}).parse(req.params);
    z.object({action:z.literal('cancel')}).strict().parse(req.body);
    return inOrganization(req,pool,config,orgId,'reservations.cancel',c=>idempotent(c,req,'reservation.financial-preview',async()=>{
      const res=await one<{id:string;version:number;currency:string;status:string}>(c.tx,'SELECT id,version,currency,status FROM reservations WHERE organization_id=$1 AND id=$2 FOR SHARE',[orgId,reservationId]);
      if(!res)problem(404,'RESOURCE_NOT_FOUND','Бронь не найдена');await reservationDto(c,reservationId);
      if(!['request','confirmed'].includes(res.status))problem(422,'INVALID_STATE','Эту бронь нельзя отменить');
      const effectiveAt=new Date().toISOString(),preview=buildCancellationPreview(await cancellationInput(c,res,effectiveAt));
      const row=await one<{id:string;expires_at:string}>(c.tx,`INSERT INTO cancellation_previews(organization_id,reservation_id,actor_id,reservation_version,preview_hash,preview,effective_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes') RETURNING id,expires_at`,
        [orgId,reservationId,c.actor.id,res.version,preview.hash,JSON.stringify(preview),effectiveAt]);
      return {preview_id:row!.id,preview_hash:preview.hash,id:row!.id,hash:preview.hash,new_total_minor:preview.newChargesMinor,paid_minor:preview.newCreditedPaymentsMinor,
        balance_minor:preview.newBalanceMinor,refundable_minor:preview.availableRefundMinor,fee_minor:preview.feeMinor,deposit_liability_minor:preview.depositLiabilityMinor,
        currency:res.currency,expires_at:row!.expires_at,summary:'Стоимость после отмены и доступный возврат рассчитаны. Фактический возврат оформляется отдельно.'};
    }),{write:true,scope:true});
  });
  app.post('/api/v1/organizations/:orgId/reservations/:reservationId/cancel',async req=>{
    const {orgId,reservationId}=z.object({orgId:id,reservationId:id}).parse(req.params);
    const input=z.object({preview_id:id,preview_hash:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(3).max(500)}).strict().parse(req.body),expected=version(req.headers['if-match']);
    return inOrganization(req,pool,config,orgId,'reservations.cancel',c=>idempotent(c,req,'reservation.cancel',async()=>{
      const res=await one<{id:string;version:number;currency:string;status:string}>(c.tx,'SELECT id,version,currency,status FROM reservations WHERE organization_id=$1 AND id=$2 FOR UPDATE',[orgId,reservationId]);
      if(!res)problem(404,'RESOURCE_NOT_FOUND','Бронь не найдена');await reservationDto(c,reservationId);
      if(res.version!==expected)problem(412,'VERSION_CHANGED','Бронь изменилась. Обновите страницу');
      const stored=await one<{preview_hash:string;preview:ReturnType<typeof buildCancellationPreview>;effective_at:string}>(c.tx,`SELECT preview_hash,preview,effective_at FROM cancellation_previews
        WHERE organization_id=$1 AND reservation_id=$2 AND id=$3 AND actor_id=$4 AND reservation_version=$5 AND used_at IS NULL AND expires_at>now() FOR UPDATE`,
        [orgId,reservationId,input.preview_id,c.actor.id,expected]);
      if(!stored||stored.preview_hash!==input.preview_hash)problem(412,'PREVIEW_CHANGED','Предпросмотр отмены устарел');
      const fresh=buildCancellationPreview(await cancellationInput(c,res,new Date(stored.effective_at).toISOString()));
      if(fresh.hash!==stored.preview_hash)problem(412,'PREVIEW_CHANGED','Деньги или условия изменились. Рассчитайте отмену снова');
      const next=transitionReservation({status:res.status==='request'?'draft':res.status as 'confirmed',version:res.version},{command:'cancel',expectedVersion:res.version,at:new Date().toISOString(),cancellationPreviewVerified:true});
      for(const line of fresh.creditNotes){const original=await one<{kind:string;service_date:string|null}>(c.tx,'SELECT kind,service_date::text FROM charges WHERE organization_id=$1 AND id=$2',[orgId,line.chargeEventId]);
        const credit=await one<{id:string}>(c.tx,`INSERT INTO charges(organization_id,reservation_id,original_charge_id,kind,amount_minor,currency,service_date,description)
          VALUES($1,$2,$3,'credit_note',$4,$5,$6,$7) RETURNING id`,[orgId,reservationId,line.chargeEventId,(-BigInt(line.amountMinor)).toString(),res.currency,original?.service_date??null,input.reason]);
        await postFinancial(c,'charge',credit!.id,original?.kind==='service'?'service_credit_note':'lodging_credit_note',line.amountMinor,res.currency);
      }
      if(BigInt(fresh.feeMinor)>0n){const charge=await one<{id:string}>(c.tx,"INSERT INTO charges(organization_id,reservation_id,kind,amount_minor,currency,description) VALUES($1,$2,'fee',$3,$4,$5) RETURNING id",[orgId,reservationId,fresh.feeMinor,res.currency,'Сбор за отмену']);await postFinancial(c,'charge',charge!.id,'fee_charge',fresh.feeMinor,res.currency);}
      await c.tx.query("UPDATE availability_allocations SET state='released' WHERE organization_id=$1 AND reservation_id=$2 AND state='active'",[orgId,reservationId]);
      await c.tx.query("UPDATE reservations SET status='cancelled',total_minor=$3,version=$4,sync_state='local_only',updated_at=now() WHERE organization_id=$1 AND id=$2",[orgId,reservationId,fresh.newChargesMinor,next.version]);
      await c.tx.query('UPDATE cancellation_previews SET used_at=now() WHERE organization_id=$1 AND id=$2',[orgId,input.preview_id]);
      await audit(c,'reservation.cancelled','reservation',reservationId,input.reason,{preview_hash:fresh.hash});
      await outbox(c,'reservation',reservationId,next.version,'reservation.cancelled',{reservation_id:reservationId});return reservationDto(c,reservationId);
    }),{write:true,scope:true});
  });
  app.get('/api/v1/organizations/:orgId/calendar',async req=>{
    const {orgId}=orgParam.parse(req.params),q=z.object({from:date,to:date}).parse(req.query);const range=stayRange(q.from,q.to);if(nightDates(range).length>90)problem(422,'INVALID_RANGE','Календарь доступен на 90 дней');
    return inOrganization(req,pool,config,orgId,'reservations.read',async c=>{
      const units=(await c.tx.query(`SELECT u.id,u.property_id,p.name AS property_name,u.name,u.state,u.capacity_adults+u.capacity_children AS capacity,u.base_rate_minor::text
        FROM units u JOIN properties p ON p.id=u.property_id AND p.organization_id=u.organization_id WHERE u.organization_id=$1 AND u.state<>'archived'
        AND ($2::uuid[] IS NULL OR u.property_id=ANY($2)) ORDER BY p.name,u.name LIMIT 1000`,[orgId,c.propertyIds])).rows;
      const ids=units.map(u=>u.id);if(!ids.length)return {units:[],reservations:[],blocks:[],as_of:new Date().toISOString()};
      const reservations=await c.tx.query<{id:string}>(`SELECT DISTINCT r.id FROM reservations r JOIN reservation_stays s ON s.reservation_id=r.id AND s.organization_id=r.organization_id
        WHERE r.organization_id=$1 AND s.unit_id=ANY($2::uuid[]) AND s.checkin<$4 AND s.checkout>$3 AND r.archived_at IS NULL`,[orgId,ids,q.from,q.to]);
      const blocks=(await c.tx.query(`SELECT id,unit_id,checkin::text AS "from",checkout::text AS "to",kind FROM availability_allocations
         WHERE organization_id=$1 AND unit_id=ANY($2::uuid[]) AND kind='block' AND state='active' AND checkin<$4 AND checkout>$3`,[orgId,ids,q.from,q.to])).rows;
      blocks.push(...await icalConflictBlocks(c.tx,orgId,ids,q.from,q.to));
      return {units,reservations:await Promise.all(reservations.rows.map(r=>reservationDto(c,r.id))),blocks,as_of:new Date().toISOString()};
    },{scope:true});
  });
  app.get('/api/v1/organizations/:orgId/availability-blocks',async req=>{
    const {orgId}=orgParam.parse(req.params);return inOrganization(req,pool,config,orgId,'inventory.read',async c=>{
      const items=(await c.tx.query(`SELECT a.id,a.unit_id,a.checkin::text AS "from",a.checkout::text AS "to",a.state,a.kind,u.property_id
       FROM availability_allocations a JOIN units u ON u.id=a.unit_id AND u.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.kind='block'
       AND ($2::uuid[] IS NULL OR u.property_id=ANY($2)) ORDER BY a.created_at DESC LIMIT 100`,[orgId,c.propertyIds])).rows;
      const units=await c.tx.query<{id:string}>('SELECT id FROM units WHERE organization_id=$1 AND ($2::uuid[] IS NULL OR property_id=ANY($2))',[orgId,c.propertyIds]);
      items.push(...await icalConflictBlocks(c.tx,orgId,units.rows.map(unit=>unit.id)));
      return {items};
    },{scope:true});
  });
  app.post('/api/v1/organizations/:orgId/availability-blocks',async req=>{
    const {orgId}=orgParam.parse(req.params),input=blockBody.parse(req.body);stayRange(input.from,input.to);
    return inOrganization(req,pool,config,orgId,'inventory.write',c=>idempotent(c,req,'block.create',async()=>{
      await unitForUpdate(c,input.unit_id);const conflicts=await c.tx.query(`SELECT id FROM availability_allocations WHERE organization_id=$1 AND unit_id=$2 AND state='active'
        AND daterange(checkin,checkout,'[)') && daterange($3::date,$4::date,'[)') LIMIT 1`,[orgId,input.unit_id,input.from,input.to]);
      if(conflicts.rowCount)problem(409,'AVAILABILITY_CONFLICT','Даты уже заняты');
      const row=await one(c.tx,`INSERT INTO availability_allocations(organization_id,unit_id,kind,checkin,checkout) VALUES($1,$2,'block',$3,$4)
        RETURNING id,unit_id,kind,checkin::text AS "from",checkout::text AS "to",state`,[orgId,input.unit_id,input.from,input.to]);
      await audit(c,'availability.blocked','availability_allocation',(row as {id:string}).id,input.reason);return row;
    }),{write:true,scope:true});
  });
}
