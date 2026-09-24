import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {parseMinor,availableRefundMinor} from '@keycalendar/domain';
import type {Config} from './config.js';
import {one} from './db.js';
import {problem} from './problem.js';
import {assertProperty,audit,idempotent,inOrganization,type TenantContext} from './tenant.js';
import {postFinancial,reservationFinancialEvents} from './finance-core.js';

const id=z.uuid(),date=z.iso.date(),orgParam=z.object({orgId:id});
const positive=z.string().regex(/^[1-9]\d*$/).refine(v=>parseMinor(v)>0n);
const manualPayment=z.object({reservation_id:id,amount_minor:positive,currency:z.literal('RUB'),method:z.enum(['cash','bank_transfer','other']),kind:z.enum(['stay','deposit']).default('stay'),occurred_at:z.iso.datetime({offset:true}),evidence_ref:z.string().trim().min(3).max(500)}).strict();
const manualRefund=z.object({payment_id:id,amount_minor:positive,currency:z.literal('RUB'),reason:z.string().trim().min(3).max(500),evidence_ref:z.string().trim().min(3).max(500)}).strict();
async function reservationAccess(c:TenantContext,reservationId:string){
  const row=await one<{id:string;currency:string;property_id:string;status:string}>(c.tx,`SELECT r.id,r.currency,u.property_id,r.status FROM reservations r
    JOIN reservation_stays s ON s.organization_id=r.organization_id AND s.reservation_id=r.id
    JOIN units u ON u.organization_id=s.organization_id AND u.id=s.unit_id WHERE r.organization_id=$1 AND r.id=$2 FOR UPDATE OF r`,[c.organizationId,reservationId]);
  if(!row)problem(404,'RESOURCE_NOT_FOUND','Бронь не найдена');assertProperty(c,row.property_id);return row;
}
export async function registerFinance(app:FastifyInstance,pool:pg.Pool,config:Config):Promise<void>{
  app.get('/api/v1/organizations/:orgId/payments',async req=>{
    const {orgId}=orgParam.parse(req.params);return inOrganization(req,pool,config,orgId,'finance.read',async c=>({items:(await c.tx.query(`SELECT p.id,p.reservation_id,p.kind,p.amount_minor::text,p.currency,p.state AS status,p.method,p.evidence_ref,p.created_at
      FROM payments p JOIN reservation_stays s ON s.reservation_id=p.reservation_id AND s.organization_id=p.organization_id
      JOIN units u ON u.id=s.unit_id AND u.organization_id=s.organization_id WHERE p.organization_id=$1 AND ($2::uuid[] IS NULL OR u.property_id=ANY($2))
      ORDER BY p.created_at DESC LIMIT 200`,[orgId,c.propertyIds])).rows}),{scope:true});
  });
  app.post('/api/v1/organizations/:orgId/payments/manual',async req=>{
    const {orgId}=orgParam.parse(req.params),input=manualPayment.parse(req.body);
    return inOrganization(req,pool,config,orgId,'finance.write',c=>idempotent(c,req,'payment.manual',async()=>{
      const res=await reservationAccess(c,input.reservation_id);if(res.currency!==input.currency)problem(422,'CURRENCY_MISMATCH','Валюта не совпадает с бронью');
      const row=await one<{id:string;reservation_id:string;amount_minor:string;currency:string;kind:string;state:string;method:string;created_at:string}>(c.tx,`INSERT INTO payments(organization_id,reservation_id,provider,kind,amount_minor,currency,state,method,evidence_ref,created_by,settled_at)
        VALUES($1,$2,'manual',$3,$4,$5,'succeeded',$6,$7,$8,$9) RETURNING id,reservation_id,amount_minor::text,currency,kind,state,method,created_at`,
        [orgId,input.reservation_id,input.kind,input.amount_minor,input.currency,input.method,input.evidence_ref,c.actor.id,input.occurred_at]);
      if(input.kind==='stay')await postFinancial(c,'payment',row!.id,'payment_capture',input.amount_minor,input.currency);
      else{
        const deposit=await one<{id:string}>(c.tx,`INSERT INTO deposits(organization_id,reservation_id,payment_id,mode,state,captured_minor,currency,evidence_ref)
          VALUES($1,$2,$3,'manual_capture','captured',$4,$5,$6) RETURNING id`,[orgId,input.reservation_id,row!.id,input.amount_minor,input.currency,input.evidence_ref]);
        const action=await one<{id:string}>(c.tx,`INSERT INTO deposit_actions(organization_id,deposit_id,kind,amount_minor,evidence_ref,created_by)
          VALUES($1,$2,'capture',$3,$4,$5) RETURNING id`,[orgId,deposit!.id,input.amount_minor,input.evidence_ref,c.actor.id]);
        await postFinancial(c,'deposit_action',action!.id,'deposit_capture',input.amount_minor,input.currency);
      }
      await audit(c,'payment.manual_recorded','payment',row!.id,input.evidence_ref,{kind:input.kind,amount_minor:input.amount_minor});
      return {...row,status:row!.state};
    }),{write:true,scope:true});
  });
  app.get('/api/v1/organizations/:orgId/refunds',async req=>{
    const {orgId}=orgParam.parse(req.params);return inOrganization(req,pool,config,orgId,'finance.read',async c=>({items:(await c.tx.query(`SELECT f.id,f.payment_id,f.amount_minor::text,f.currency,f.state AS status,f.reason,f.created_at
      FROM refunds f JOIN payments p ON p.id=f.payment_id AND p.organization_id=f.organization_id
      JOIN reservation_stays s ON s.reservation_id=p.reservation_id AND s.organization_id=p.organization_id
      JOIN units u ON u.id=s.unit_id AND u.organization_id=s.organization_id WHERE f.organization_id=$1 AND ($2::uuid[] IS NULL OR u.property_id=ANY($2))
      ORDER BY f.created_at DESC LIMIT 200`,[orgId,c.propertyIds])).rows}),{scope:true});
  });
  app.post('/api/v1/organizations/:orgId/refunds/manual',async req=>{
    const {orgId}=orgParam.parse(req.params),input=manualRefund.parse(req.body);
    return inOrganization(req,pool,config,orgId,'finance.refund',c=>idempotent(c,req,'refund.manual',async()=>{
      const payment=await one<{id:string;reservation_id:string;kind:string;state:string;currency:string}>(c.tx,
        'SELECT id,reservation_id,kind,state,currency FROM payments WHERE organization_id=$1 AND id=$2 FOR UPDATE',[orgId,input.payment_id]);
      if(!payment||payment.state!=='succeeded'||payment.kind!=='stay')problem(404,'RESOURCE_NOT_FOUND','Подтверждённый платёж не найден');
      await reservationAccess(c,payment.reservation_id);if(payment.currency!==input.currency)problem(422,'CURRENCY_MISMATCH','Валюта не совпадает');
      const events=await reservationFinancialEvents(c,payment.reservation_id,input.currency);
      if(parseMinor(input.amount_minor)>parseMinor(availableRefundMinor(events,input.currency,input.payment_id)))problem(422,'REFUND_EXCEEDS_AVAILABLE','Сумма превышает доступный остаток платежа');
      const row=await one<{id:string;amount_minor:string;currency:string;state:string}>(c.tx,`INSERT INTO refunds(organization_id,payment_id,amount_minor,currency,state,reason,provider_ref)
        VALUES($1,$2,$3,$4,'succeeded',$5,$6) RETURNING id,amount_minor::text,currency,state`,[orgId,input.payment_id,input.amount_minor,input.currency,input.reason,input.evidence_ref]);
      await postFinancial(c,'refund',row!.id,'payment_refund',input.amount_minor,input.currency,input.payment_id);
      await audit(c,'refund.manual_recorded','refund',row!.id,input.reason,{payment_id:input.payment_id,amount_minor:input.amount_minor});return {...row,status:row!.state};
    }),{write:true,scope:true});
  });
  app.get('/api/v1/organizations/:orgId/deposits',async req=>{
    const {orgId}=orgParam.parse(req.params);return inOrganization(req,pool,config,orgId,'finance.read',async c=>({items:(await c.tx.query(`SELECT d.id,d.reservation_id,d.mode,d.state,d.authorized_minor::text,d.captured_minor::text,d.returned_minor::text,d.retained_minor::text,d.currency,d.version,d.created_at
      FROM deposits d JOIN reservation_stays s ON s.reservation_id=d.reservation_id AND s.organization_id=d.organization_id
      JOIN units u ON u.id=s.unit_id AND u.organization_id=s.organization_id WHERE d.organization_id=$1 AND ($2::uuid[] IS NULL OR u.property_id=ANY($2))
      ORDER BY d.created_at DESC LIMIT 200`,[orgId,c.propertyIds])).rows}),{scope:true});
  });
  app.post('/api/v1/organizations/:orgId/deposits/:depositId/decisions',async req=>{
    const {orgId,depositId}=z.object({orgId:id,depositId:id}).parse(req.params);
    const input=z.object({kind:z.enum(['return','retain']),amount_minor:positive,evidence_ref:z.string().trim().min(3).max(500),reason:z.string().trim().min(3).max(500)}).strict().parse(req.body);
    return inOrganization(req,pool,config,orgId,'finance.refund',c=>idempotent(c,req,'deposit.decision',async()=>{
      const deposit=await one<{id:string;reservation_id:string;captured_minor:string;returned_minor:string;retained_minor:string;currency:string;version:number}>(c.tx,
        `SELECT id,reservation_id,captured_minor::text,returned_minor::text,retained_minor::text,currency,version FROM deposits
         WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[orgId,depositId]);if(!deposit)problem(404,'RESOURCE_NOT_FOUND','Залог не найден');await reservationAccess(c,deposit.reservation_id);
      const available=BigInt(deposit.captured_minor)-BigInt(deposit.returned_minor)-BigInt(deposit.retained_minor);
      if(BigInt(input.amount_minor)>available)problem(422,'REFUND_EXCEEDS_AVAILABLE','Сумма превышает остаток залога');
      const column=input.kind==='return'?'returned_minor':'retained_minor';
      const row=await one<{version:number;state:string}>(c.tx,`UPDATE deposits SET ${column}=${column}+$3,version=version+1,
        state=CASE WHEN captured_minor=returned_minor+retained_minor+$3 THEN 'closed' ELSE 'partial' END
        WHERE organization_id=$1 AND id=$2 RETURNING version,state`,[orgId,depositId,input.amount_minor]);
      const action=await one<{id:string}>(c.tx,`INSERT INTO deposit_actions(organization_id,deposit_id,kind,amount_minor,evidence_ref,created_by)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[orgId,depositId,input.kind,input.amount_minor,input.evidence_ref,c.actor.id]);
      await postFinancial(c,'deposit_action',action!.id,input.kind==='return'?'deposit_return':'deposit_retain',input.amount_minor,deposit.currency);
      await audit(c,`deposit.${input.kind}`,'deposit',depositId,input.reason,{amount_minor:input.amount_minor});return {id:depositId,version:row!.version,state:row!.state};
    }),{write:true,scope:true});
  });
  app.get('/api/v1/organizations/:orgId/expenses',async req=>{
    const {orgId}=orgParam.parse(req.params);return inOrganization(req,pool,config,orgId,'finance.read',async c=>({items:(await c.tx.query(`SELECT id,property_id,amount_minor::text,currency,category,description,incurred_on::text,created_at FROM expenses
      WHERE organization_id=$1 AND ($2::uuid[] IS NULL OR property_id=ANY($2)) ORDER BY incurred_on DESC LIMIT 200`,[orgId,c.propertyIds])).rows}),{scope:true});
  });
  app.post('/api/v1/organizations/:orgId/expenses',async req=>{
    const {orgId}=orgParam.parse(req.params),input=z.object({property_id:id,amount_minor:positive,currency:z.literal('RUB'),category:z.string().trim().min(1).max(100),description:z.string().trim().min(1).max(500),incurred_on:date}).strict().parse(req.body);
    return inOrganization(req,pool,config,orgId,'finance.write',c=>idempotent(c,req,'expense.create',async()=>{
      assertProperty(c,input.property_id);const property=await one(c.tx,'SELECT id FROM properties WHERE organization_id=$1 AND id=$2',[orgId,input.property_id]);if(!property)problem(404,'RESOURCE_NOT_FOUND','Объект не найден');
      const row=await one(c.tx,`INSERT INTO expenses(organization_id,property_id,amount_minor,currency,category,description,incurred_on,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,property_id,amount_minor::text,currency,category,description,incurred_on::text`,
        [orgId,input.property_id,input.amount_minor,input.currency,input.category,input.description,input.incurred_on,c.actor.id]);
      await audit(c,'expense.created','expense',(row as {id:string}).id);return row;
    }),{write:true,scope:true});
  });
  app.get('/api/v1/organizations/:orgId/ledger',async req=>{
    const {orgId}=orgParam.parse(req.params);return inOrganization(req,pool,config,orgId,'finance.global',async c=>({items:(await c.tx.query(`SELECT e.id,e.source_type,e.source_id,e.currency,e.posted_at,e.description,
      jsonb_agg(jsonb_build_object('account',l.account,'debit_minor',l.debit_minor::text,'credit_minor',l.credit_minor::text) ORDER BY l.id) AS lines
      FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id AND l.organization_id=e.organization_id WHERE e.organization_id=$1
      GROUP BY e.id ORDER BY e.posted_at DESC LIMIT 200`,[orgId])).rows}));
  });
  app.post('/api/v1/organizations/:orgId/reports',async req=>{
    const {orgId}=orgParam.parse(req.params),input=z.object({report_type:z.enum(['finance','sources']),from:date,to:date,property_ids:z.array(id).max(100).default([]),accounting_method:z.enum(['accrual','cash']).default('accrual')}).strict().parse(req.body);
    if(input.from>input.to)problem(422,'INVALID_RANGE','Начало периода позже окончания');
    const span=(Date.parse(input.to)-Date.parse(input.from))/86_400_000+1;if(span>366)problem(422,'INVALID_RANGE','Отчёт доступен на период до года');
    return inOrganization(req,pool,config,orgId,'reports.read',async c=>{
      const propertyIds=input.property_ids.length?input.property_ids:c.propertyIds;
      if(propertyIds&&c.propertyIds&&propertyIds.some(id=>!c.propertyIds!.includes(id)))problem(403,'ACCESS_DENIED','Объект недоступен');
      const known=propertyIds?.length?await c.tx.query('SELECT id FROM properties WHERE organization_id=$1 AND id=ANY($2::uuid[])',[orgId,propertyIds]):null;
      if(propertyIds?.length&&known?.rows.length!==propertyIds.length)problem(404,'RESOURCE_NOT_FOUND','Объект не найден');
      const scope=propertyIds??null;
      if(input.report_type==='sources'){
        const result=await c.tx.query<{source:string;bookings:string;amount_minor:string}>(`SELECT r.source,COUNT(DISTINCT r.id)::text AS bookings,COALESCE(SUM(r.total_minor),0)::text AS amount_minor
          FROM reservations r JOIN reservation_stays s ON s.reservation_id=r.id AND s.organization_id=r.organization_id
          JOIN units u ON u.id=s.unit_id AND u.organization_id=s.organization_id WHERE r.organization_id=$1 AND r.created_at::date BETWEEN $2 AND $3
          AND ($4::uuid[] IS NULL OR u.property_id=ANY($4)) GROUP BY r.source ORDER BY bookings DESC`,[orgId,input.from,input.to,scope]);
        return {state:'complete',from:input.from,to:input.to,accounting_method:input.accounting_method,metrics:result.rows.map(r=>({name:r.source,value:`${r.bookings} броней · ${r.amount_minor} коп.`}))};
      }
      const revenue=await one<{amount:string}>(c.tx,input.accounting_method==='cash'?`SELECT COALESCE(SUM(p.amount_minor),0)::text AS amount FROM payments p
        JOIN reservation_stays s ON s.reservation_id=p.reservation_id AND s.organization_id=p.organization_id JOIN units u ON u.id=s.unit_id AND u.organization_id=s.organization_id
        WHERE p.organization_id=$1 AND p.state='succeeded' AND p.kind='stay' AND p.settled_at::date BETWEEN $2 AND $3 AND ($4::uuid[] IS NULL OR u.property_id=ANY($4))`:
        `SELECT COALESCE(SUM(c.amount_minor),0)::text AS amount FROM charges c JOIN reservation_stays s ON s.reservation_id=c.reservation_id AND s.organization_id=c.organization_id
        JOIN units u ON u.id=s.unit_id AND u.organization_id=s.organization_id WHERE c.organization_id=$1 AND c.service_date BETWEEN $2 AND $3 AND ($4::uuid[] IS NULL OR u.property_id=ANY($4))`,[orgId,input.from,input.to,scope]);
      const unitCount=await one<{count:number}>(c.tx,"SELECT COUNT(*)::int AS count FROM units WHERE organization_id=$1 AND state='active' AND ($2::uuid[] IS NULL OR property_id=ANY($2))",[orgId,scope]);
      const occupied=await one<{nights:string}>(c.tx,`SELECT COALESCE(SUM(LEAST(s.checkout,$3::date+1)-GREATEST(s.checkin,$2::date)),0)::text AS nights FROM reservation_stays s
        JOIN reservations r ON r.id=s.reservation_id AND r.organization_id=s.organization_id JOIN units u ON u.id=s.unit_id AND u.organization_id=s.organization_id
        WHERE s.organization_id=$1 AND s.checkin<=$3 AND s.checkout>$2 AND r.status IN ('confirmed','checked_in','checked_out')
        AND ($4::uuid[] IS NULL OR u.property_id=ANY($4))`,[orgId,input.from,input.to,scope]);
      const expenses=await one<{amount:string}>(c.tx,'SELECT COALESCE(SUM(amount_minor),0)::text AS amount FROM expenses WHERE organization_id=$1 AND incurred_on BETWEEN $2 AND $3 AND ($4::uuid[] IS NULL OR property_id=ANY($4))',[orgId,input.from,input.to,scope]);
      const capacity=(unitCount?.count??0)*span,used=BigInt(occupied?.nights??'0');const occupancy=capacity?`${Number(used)*100/capacity}%`:'—';
      return {state:'complete',from:input.from,to:input.to,accounting_method:input.accounting_method,metrics:[
        {name:input.accounting_method==='cash'?'Поступления':'Начисления',value:`${revenue?.amount??'0'} коп.`},
        {name:'Расходы',value:`${expenses?.amount??'0'} коп.`},{name:'Проданные ночи',value:used.toString()},{name:'Загрузка',value:occupancy}]};
    },{scope:true});
  });
}
