import {randomUUID} from 'node:crypto';
import {createFinancialEvent,financialTotals,type FinancialEvent,type FinancialEventKind} from '@keycalendar/domain';
import type {TenantContext} from './tenant.js';

export async function postFinancial(c:TenantContext,sourceType:string,sourceId:string,kind:FinancialEventKind,amountMinor:string,currency:string,relatedPaymentId?:string):Promise<void>{
  if(BigInt(amountMinor)===0n)return;
  const event=createFinancialEvent({id:sourceId,sourceKey:`${sourceType}:${sourceId}`,kind,status:'succeeded',amountMinor,currency,at:new Date().toISOString(),...(relatedPaymentId?{relatedPaymentId}:{})});
  const entry=event.entry!;const id=randomUUID();
  await c.tx.query(`INSERT INTO journal_entries(id,organization_id,source_type,source_id,currency,description)
    VALUES($1,$2,$3,$4,$5,$6)`,[id,c.organizationId,sourceType,sourceId,currency,kind]);
  for(const line of entry.lines)await c.tx.query(`INSERT INTO journal_lines(organization_id,entry_id,account,debit_minor,credit_minor) VALUES($1,$2,$3,$4,$5)`,
    [c.organizationId,id,line.account,line.side==='debit'?line.amountMinor:'0',line.side==='credit'?line.amountMinor:'0']);
}
export async function reservationFinancialEvents(c:TenantContext,reservationId:string,currency:string):Promise<FinancialEvent[]>{
  const events:FinancialEvent[]=[];
  const charges=await c.tx.query<{id:string;kind:string;amount_minor:string;created_at:string;original_kind:string|null}>(
    `SELECT charge.id,charge.kind,charge.amount_minor::text,charge.created_at,original.kind AS original_kind
      FROM charges charge LEFT JOIN charges original ON original.organization_id=charge.organization_id AND original.id=charge.original_charge_id
      WHERE charge.organization_id=$1 AND charge.reservation_id=$2 ORDER BY charge.created_at,charge.id`,[c.organizationId,reservationId]);
  for(const charge of charges.rows){const amount=BigInt(charge.amount_minor);if(amount===0n)continue;
    const kind:FinancialEventKind=amount<0n?(charge.original_kind==='service'?'service_credit_note':'lodging_credit_note'):charge.kind==='fee'?'fee_charge':charge.kind==='service'?'service_charge':'lodging_charge';
    events.push(createFinancialEvent({id:charge.id,sourceKey:`charge:${charge.id}`,kind,status:'succeeded',amountMinor:(amount<0n?-amount:amount).toString(),currency,at:new Date(charge.created_at).toISOString()}));
  }
  const payments=await c.tx.query<{id:string;amount_minor:string;state:string;created_at:string}>(
    `SELECT id,amount_minor::text,state,created_at FROM payments WHERE organization_id=$1 AND reservation_id=$2 AND kind='stay' ORDER BY created_at,id`,[c.organizationId,reservationId]);
  for(const payment of payments.rows)events.push(createFinancialEvent({id:payment.id,sourceKey:`payment:${payment.id}`,kind:'payment_capture',status:payment.state==='succeeded'?'succeeded':payment.state==='failed'?'failed':'pending',amountMinor:payment.amount_minor,currency,at:new Date(payment.created_at).toISOString()}));
  const refunds=await c.tx.query<{id:string;payment_id:string;amount_minor:string;state:string;created_at:string}>(
    `SELECT r.id,r.payment_id,r.amount_minor::text,r.state,r.created_at FROM refunds r JOIN payments p ON p.id=r.payment_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 AND p.reservation_id=$2 ORDER BY r.created_at,r.id`,[c.organizationId,reservationId]);
  for(const refund of refunds.rows)events.push(createFinancialEvent({id:refund.id,sourceKey:`refund:${refund.id}`,kind:'payment_refund',status:refund.state==='succeeded'?'succeeded':refund.state==='failed'?'failed':'pending',amountMinor:refund.amount_minor,currency,at:new Date(refund.created_at).toISOString(),relatedPaymentId:refund.payment_id}));
  const deposits=await c.tx.query<{id:string;captured_minor:string;returned_minor:string;retained_minor:string;created_at:string}>(
    `SELECT id,captured_minor::text,returned_minor::text,retained_minor::text,created_at FROM deposits WHERE organization_id=$1 AND reservation_id=$2 ORDER BY created_at,id`,[c.organizationId,reservationId]);
  for(const deposit of deposits.rows){const at=new Date(deposit.created_at).toISOString();
    for(const [suffix,kind,amount] of [['capture','deposit_capture',deposit.captured_minor],['return','deposit_return',deposit.returned_minor],['retain','deposit_retain',deposit.retained_minor]] as const)
      if(BigInt(amount)>0n)events.push(createFinancialEvent({id:`${deposit.id}:${suffix}`,sourceKey:`deposit:${deposit.id}:${suffix}`,kind,status:'succeeded',amountMinor:amount,currency,at}));
  }
  // The immutable journal is the accounting source; this event projection is used
  // to calculate the current balance and to check cancellation/refund limits.
  financialTotals(events,currency);
  return events;
}
