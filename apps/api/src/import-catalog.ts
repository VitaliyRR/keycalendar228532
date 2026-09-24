import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import type pg from 'pg';
import {one,withTenant,type Tx} from './db.js';

const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOT_ID=/^[0-9]{1,20}$/;
const MAX_CATALOG_BYTES=8*1024*1024;
const MAX_CARDS_BYTES=32*1024*1024;
const MAX_MANIFEST_BYTES=1024*1024;
const INVENTORY_SHEET='inventory-ui';
const SOURCE_NAME='RealtyCalendar inventory UI JSON / sheet:'+
  createHash('sha256').update(INVENTORY_SHEET).digest('hex').slice(0,16);
const CARDS_SHEET='properties-full-ui';
const CARDS_SOURCE_NAME='RealtyCalendar full property UI JSONL / sheet:'+
  createHash('sha256').update(CARDS_SHEET).digest('hex').slice(0,16);
const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');

export class CatalogImportError extends Error{
  constructor(readonly code:string){super(code);this.name='CatalogImportError';}
}

type SourceLot={source_lot_id:string;display_name:string;channels:unknown[]};
type ReviewedLot={
  source_lot_id:string;
  source_name_sha256:string;
  identity_verification:'verified'|'pending';
  timezone:string|null;
  checkin_time:string|null;
  checkin_time_end:string|null;
  checkout_time_start:string|null;
  checkout_time:string|null;
  stay_rules_evidence_ref:string|null;
  stay_rules_snapshot_sha256:string|null;
  source_card_label_sha256:string|null;
  timezone_verification_ref:string|null;
};
type ReviewManifest={
  format:'realtycalendar-catalog-shells-v1';
  review_status:'candidate_only_not_owner_approved'|'owner_approved';
  organization_id:string;
  source_sha256:string;
  card_source_sha256:string;
  verified_by:string;
  verified_at:string;
  expected_object_count:number;
  lots:ReviewedLot[];
};
type CatalogInput={lots:SourceLot[];checksum:string};
type CardEvidence={lotId:string;labelHash:string;rulesHash:string;
  checkinStart:string;checkinEnd:string;checkoutStart:string;checkoutEnd:string;
  evidenceRef:string};
type CardsInput={cards:Map<string,CardEvidence>;checksum:string;count:number};
type LoadedReview={manifest:ReviewManifest;checksum:string};
type RowPlan={source:SourceLot;review:ReviewedLot;approvalHash:string;ready:boolean};

export type CatalogImportOptions={
  pool:pg.Pool;
  organizationId:string;
  actorId:string;
  inventoryPath:string;
  propertyCardsPath?:string;
  reviewManifestPath?:string;
  mode:'preview'|'apply';
  // Isolated rollback-only integration tests may supply their own transaction.
  transaction?:Tx;
};
export type CatalogImportReport={
  mode:'preview'|'applied';
  source_rows:number;
  ready_rows:number;
  pending_rows:number;
  name_conflicts:number;
  new_properties:number;
  existing_properties:number;
};

function object(value:unknown):value is Record<string,unknown>{
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function validTime(value:unknown):value is string{
  if(typeof value!=='string'||!/^\d{2}:\d{2}$/.test(value))return false;
  const hour=Number(value.slice(0,2)),minute=Number(value.slice(3));
  return hour<=23&&minute<=59;
}
function validIanaTimezone(value:unknown):value is string{
  if(typeof value!=='string'||value.length>100||
    !(value==='UTC'||/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/.test(value)))return false;
  try{new Intl.DateTimeFormat('en-US',{timeZone:value});return true;}
  catch{return false;}
}
function validReference(value:unknown):value is string{
  return typeof value==='string'&&value.trim()===value&&value.length>=8&&value.length<=300;
}
async function loadBoundedJson(path:string,maxBytes:number,errorCode:string):Promise<{bytes:Buffer;value:unknown}>{
  const info=await stat(path);
  if(!info.isFile()||info.size<1||info.size>maxBytes)throw new CatalogImportError(errorCode);
  const bytes=await readFile(path);
  if(bytes.length!==info.size||bytes.length>maxBytes)throw new CatalogImportError(errorCode);
  try{return {bytes,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};}
  catch{throw new CatalogImportError(errorCode);}
}
async function loadInventory(path:string):Promise<CatalogInput>{
  const {bytes,value}=await loadBoundedJson(path,MAX_CATALOG_BYTES,'INVENTORY_INVALID_FILE');
  if(!object(value)||!Array.isArray(value.objects)||value.objects.length<1||
    value.objects.length>1000)throw new CatalogImportError('INVENTORY_INVALID_SHAPE');
  const seen=new Set<string>(),seenNames=new Set<string>();
  const lots:SourceLot[]=[];
  for(const raw of value.objects){
    if(!object(raw)||typeof raw.source_lot_id!=='string'||
      !LOT_ID.test(raw.source_lot_id)||seen.has(raw.source_lot_id)||
      typeof raw.display_name!=='string'||raw.display_name.length<1||
      raw.display_name.length>150||raw.display_name.trim()!==raw.display_name||
      seenNames.has(raw.display_name)||
      !Array.isArray(raw.channels))throw new CatalogImportError('INVENTORY_INVALID_LOT');
    seen.add(raw.source_lot_id);
    seenNames.add(raw.display_name);
    lots.push({source_lot_id:raw.source_lot_id,display_name:raw.display_name,channels:raw.channels});
  }
  return {lots,checksum:sha256(bytes)};
}
function selectedTimes(lines:string[]):string[]{
  const result:string[]=[];
  for(const line of lines){
    if(!line.includes('[selected]'))continue;
    const times=line.match(/\b\d{2}:\d{2}\b/g);
    if(times?.length===1&&validTime(times[0]))result.push(times[0]);
  }
  return result;
}
function cardWindows(snapshot:string):[string,string,string,string]{
  const lines=snapshot.split(/\r?\n/);
  const arrival=lines.findIndex(line=>line.toLocaleLowerCase('ru').includes('заезд'));
  const departure=lines.findIndex(line=>line.toLocaleLowerCase('ru').includes('выезд'));
  if(arrival<0||departure<=arrival)throw new CatalogImportError('CARD_WINDOW_INVALID');
  const checkin=selectedTimes(lines.slice(arrival+1,departure));
  const checkout=selectedTimes(lines.slice(departure+1));
  if(checkin.length!==2||checkout.length!==2||
    checkin[0]!>checkin[1]!||checkout[0]!>checkout[1]!)
    throw new CatalogImportError('CARD_WINDOW_INVALID');
  return [checkin[0]!,checkin[1]!,checkout[0]!,checkout[1]!];
}
async function loadCards(path:string):Promise<CardsInput>{
  const info=await stat(path);
  if(!info.isFile()||info.size<1||info.size>MAX_CARDS_BYTES)
    throw new CatalogImportError('CARDS_INVALID_FILE');
  const bytes=await readFile(path);
  if(bytes.length!==info.size||bytes.length>MAX_CARDS_BYTES)
    throw new CatalogImportError('CARDS_INVALID_FILE');
  let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{throw new CatalogImportError('CARDS_INVALID_FILE');}
  const lines=text.trimEnd().split(/\r?\n/);
  if(lines.length<1||lines.length>1000)throw new CatalogImportError('CARDS_INVALID_SHAPE');
  const cards=new Map<string,CardEvidence>();
  for(let index=0;index<lines.length;index++){
    let value:unknown;
    try{value=JSON.parse(lines[index]!);}catch{throw new CatalogImportError('CARDS_INVALID_JSON');}
    if(!object(value)||typeof value.lot_id!=='string'||!LOT_ID.test(value.lot_id)||
      cards.has(value.lot_id)||typeof value.label!=='string'||
      !Array.isArray(value.sections))throw new CatalogImportError('CARD_INVALID_SHAPE');
    const rules=value.sections.filter(section=>object(section)&&section.section==='rules');
    if(rules.length!==1||typeof rules[0]?.snapshot!=='string')
      throw new CatalogImportError('CARD_RULES_MISSING');
    const snapshot=rules[0].snapshot as string;
    const [checkinStart,checkinEnd,checkoutStart,checkoutEnd]=cardWindows(snapshot);
    const rulesHash=sha256(snapshot);
    cards.set(value.lot_id,{lotId:value.lot_id,labelHash:sha256(value.label),rulesHash,
      checkinStart,checkinEnd,checkoutStart,checkoutEnd,
      evidenceRef:`properties-full-ui.jsonl:line:${index+1}:rules:sha256:${rulesHash}`});
  }
  return {cards,checksum:sha256(bytes),count:cards.size};
}
async function loadReview(path:string):Promise<LoadedReview>{
  const {bytes,value}=await loadBoundedJson(path,MAX_MANIFEST_BYTES,'REVIEW_MANIFEST_INVALID_FILE');
  if(!object(value)||value.format!=='realtycalendar-catalog-shells-v1'||
    !['candidate_only_not_owner_approved','owner_approved'].includes(String(value.review_status))||
    typeof value.organization_id!=='string'||!UUID.test(value.organization_id)||
    typeof value.source_sha256!=='string'||!HASH.test(value.source_sha256)||
    typeof value.card_source_sha256!=='string'||!HASH.test(value.card_source_sha256)||
    typeof value.verified_by!=='string'||!UUID.test(value.verified_by)||
    typeof value.verified_at!=='string'||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.verified_at)||
    !Number.isFinite(Date.parse(value.verified_at))||
    Date.parse(value.verified_at)>Date.now()+5*60_000||
    !Number.isSafeInteger(value.expected_object_count)||
    Number(value.expected_object_count)<1||
    !Array.isArray(value.lots)||value.lots.length!==value.expected_object_count)
    throw new CatalogImportError('REVIEW_MANIFEST_INVALID_SHAPE');
  const seen=new Set<string>();
  for(const lot of value.lots){
    if(!object(lot)||typeof lot.source_lot_id!=='string'||
      !LOT_ID.test(lot.source_lot_id)||seen.has(lot.source_lot_id)||
      typeof lot.source_name_sha256!=='string'||!HASH.test(lot.source_name_sha256)||
      !['verified','pending'].includes(String(lot.identity_verification))||
      !['timezone','checkin_time','checkin_time_end','checkout_time_start',
        'checkout_time','stay_rules_evidence_ref','stay_rules_snapshot_sha256',
        'source_card_label_sha256','timezone_verification_ref'].every(key=>
        lot[key]===null||typeof lot[key]==='string'))
      throw new CatalogImportError('REVIEW_MANIFEST_INVALID_LOT');
    seen.add(lot.source_lot_id);
  }
  return {manifest:value as ReviewManifest,checksum:sha256(bytes)};
}
function planRows(inventory:CatalogInput,cards:CardsInput|null,review:LoadedReview|null,
  organizationId:string,actorId:string):RowPlan[]{
  if(cards&&(cards.count!==inventory.lots.length||
    inventory.lots.some(source=>!cards.cards.has(source.source_lot_id))))
    throw new CatalogImportError('CARD_CATALOG_COVERAGE_MISMATCH');
  if(!review)return inventory.lots.map(source=>({source,
    review:{source_lot_id:source.source_lot_id,source_name_sha256:sha256(source.display_name),
      identity_verification:'pending',timezone:null,checkin_time:null,checkin_time_end:null,
      checkout_time_start:null,checkout_time:null,stay_rules_evidence_ref:null,
      stay_rules_snapshot_sha256:null,source_card_label_sha256:null,
      timezone_verification_ref:null},
    approvalHash:'',ready:false}));
  const manifest=review.manifest;
  if(manifest.source_sha256!==inventory.checksum||manifest.organization_id!==organizationId||
    manifest.verified_by!==actorId||manifest.expected_object_count!==inventory.lots.length)
    throw new CatalogImportError('REVIEW_MANIFEST_SCOPE_MISMATCH');
  if(cards&&(manifest.card_source_sha256!==cards.checksum||
    cards.count!==inventory.lots.length))
    throw new CatalogImportError('CARD_CATALOG_COVERAGE_MISMATCH');
  const byId=new Map(manifest.lots.map(lot=>[lot.source_lot_id,lot]));
  return inventory.lots.map(source=>{
    const lot=byId.get(source.source_lot_id);
    if(!lot||lot.source_name_sha256!==sha256(source.display_name))
      throw new CatalogImportError('REVIEW_MANIFEST_LOT_MISMATCH');
    const card=cards?.cards.get(source.source_lot_id);
    if(cards&&!card)throw new CatalogImportError('CARD_CATALOG_COVERAGE_MISMATCH');
    if(card){
      if(lot.source_card_label_sha256!==card.labelHash||
        lot.stay_rules_snapshot_sha256!==card.rulesHash||
        lot.stay_rules_evidence_ref!==card.evidenceRef)
        throw new CatalogImportError('CARD_REVIEW_MISMATCH');
      for(const [field,sourceValue] of [
        ['checkin_time',card.checkinStart],['checkin_time_end',card.checkinEnd],
        ['checkout_time_start',card.checkoutStart],['checkout_time',card.checkoutEnd]
      ] as const){
        if(lot[field]!==null&&lot[field]!==sourceValue)
          throw new CatalogImportError('CARD_REVIEW_MISMATCH');
      }
    }
    const ready=lot.identity_verification==='verified'&&validIanaTimezone(lot.timezone)&&
      !!card&&validTime(lot.checkin_time)&&validTime(lot.checkin_time_end)&&
      validTime(lot.checkout_time_start)&&validTime(lot.checkout_time)&&
      validReference(lot.stay_rules_evidence_ref)&&HASH.test(lot.stay_rules_snapshot_sha256??'')&&
      validReference(lot.timezone_verification_ref);
    const approvalHash=ready?sha256(JSON.stringify({source_lot_id:lot.source_lot_id,
      source_name_sha256:lot.source_name_sha256,timezone:lot.timezone,
      checkin_time:lot.checkin_time,checkin_time_end:lot.checkin_time_end,
      checkout_time_start:lot.checkout_time_start,checkout_time:lot.checkout_time,
      stay_rules_snapshot_sha256:lot.stay_rules_snapshot_sha256,
      stay_rules_evidence_ref:lot.stay_rules_evidence_ref,
      timezone_verification_ref:lot.timezone_verification_ref})):'';
    return {source,review:lot,approvalHash,ready};
  });
}

export async function importCatalog(options:CatalogImportOptions):Promise<CatalogImportReport>{
  const {pool,organizationId,actorId}=options;
  if(!UUID.test(organizationId)||!UUID.test(actorId))throw new CatalogImportError('INVALID_ID');
  if(options.mode!=='preview'&&options.mode!=='apply')throw new CatalogImportError('INVALID_MODE');
  if(options.mode==='apply'&&!options.reviewManifestPath)
    throw new CatalogImportError('VERIFIED_MANIFEST_REQUIRED');
  if(options.mode==='apply'&&!options.propertyCardsPath)
    throw new CatalogImportError('PROPERTY_CARDS_REQUIRED');
  const inventory=await loadInventory(options.inventoryPath);
  const cards=options.propertyCardsPath?await loadCards(options.propertyCardsPath):null;
  const review=options.reviewManifestPath?await loadReview(options.reviewManifestPath):null;
  const plans=planRows(inventory,cards,review,organizationId,actorId);
  const ready=plans.filter(row=>row.ready);
  const pending=plans.length-ready.length;
  if(options.mode==='apply'&&review?.manifest.review_status!=='owner_approved')
    throw new CatalogImportError('REVIEW_APPROVAL_REQUIRED');
  // A partial live catalog could mislead users into believing its inventory is
  // complete. All source lots must be verified before any Property is written.
  if(options.mode==='apply'&&pending)throw new CatalogImportError('CATALOG_REVIEW_INCOMPLETE');
  const role=await pool.query<{rolsuper:boolean;rolbypassrls:boolean}>(
    'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  if(role.rows[0]?.rolsuper!==false||role.rows[0]?.rolbypassrls!==false)
    throw new CatalogImportError('RLS_RUNTIME_ROLE_REQUIRED');

  const run=async(tx:Tx):Promise<CatalogImportReport>=>{
    const context=await one<{organization_id:string|null}>(tx,
      "SELECT nullif(current_setting('app.organization_id',true),'') AS organization_id");
    if(context?.organization_id!==organizationId)
      throw new CatalogImportError('TENANT_CONTEXT_MISMATCH');
    const member=await one<{role:string}>(tx,
      "SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active' FOR SHARE",
      [organizationId,actorId]);
    if(!member||!['owner','admin'].includes(member.role))
      throw new CatalogImportError('IMPORT_ACCESS_DENIED');
    const organization=await one<{state:string}>(tx,
      'SELECT state FROM organizations WHERE id=$1 FOR SHARE',[organizationId]);
    if(organization?.state!=='active')throw new CatalogImportError('ORGANIZATION_UNAVAILABLE');
    if(options.mode==='apply'){
      const fields=await one<{column_count:number}>(tx,
        `SELECT count(*)::int AS column_count FROM information_schema.columns
         WHERE table_schema='public' AND table_name='properties'
           AND column_name IN ('checkin_time_end','checkout_time_start')`);
      if(fields?.column_count!==2)throw new CatalogImportError('PROPERTY_WINDOW_SCHEMA_REQUIRED');
      const subscription=await one<{state:string;grace_ends_at:Date|null}>(tx,
        'SELECT state,grace_ends_at FROM subscriptions WHERE organization_id=$1 FOR SHARE',
        [organizationId]);
      if(subscription?.state==='read_only'||
        (subscription?.state==='grace'&&subscription.grace_ends_at!==null&&
          subscription.grace_ends_at.getTime()<Date.now()))
        throw new CatalogImportError('SUBSCRIPTION_READ_ONLY');
    }
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[
      `keycalendar-catalog:${organizationId}:RealtyCalendar`]);
    const batch=await one<{id:string;row_count:number}>(tx,
      `SELECT id,row_count FROM import_batches WHERE organization_id=$1 AND source_name=$2
         AND source_checksum=$3 AND state='staged_evidence'
         AND summary->>'stage_format'='realtycalendar-inventory-ui-v1' FOR SHARE`,
      [organizationId,SOURCE_NAME,inventory.checksum]);
    if(!batch||batch.row_count!==plans.length)
      throw new CatalogImportError('STAGED_INVENTORY_REQUIRED');
    const evidenceCount=await one<{count:number;first:number|null;last:number|null;
      distinct_rows:number}>(tx,
      `SELECT count(*)::int AS count,min(source_row_number) AS first,
         max(source_row_number) AS last,count(DISTINCT source_row_number)::int AS distinct_rows
       FROM import_records
       WHERE organization_id=$1 AND batch_id=$2`,[organizationId,batch.id]);
    if(evidenceCount?.count!==plans.length||evidenceCount.first!==1||
      evidenceCount.last!==plans.length||evidenceCount.distinct_rows!==plans.length)
      throw new CatalogImportError('STAGED_INVENTORY_REQUIRED');
    if(cards){
      const cardBatch=await one<{id:string;row_count:number}>(tx,
        `SELECT id,row_count FROM import_batches WHERE organization_id=$1 AND source_name=$2
           AND source_checksum=$3 AND state='staged_evidence'
           AND summary->>'stage_format'='realtycalendar-properties-full-ui-v1' FOR SHARE`,
        [organizationId,CARDS_SOURCE_NAME,cards.checksum]);
      if(!cardBatch||cardBatch.row_count!==cards.count)
        throw new CatalogImportError('STAGED_PROPERTY_CARDS_REQUIRED');
      const cardRecords=await one<{count:number;first:number|null;last:number|null;
        distinct_rows:number}>(tx,
        `SELECT count(*)::int AS count,min(source_row_number) AS first,
           max(source_row_number) AS last,count(DISTINCT source_row_number)::int AS distinct_rows
         FROM import_records WHERE organization_id=$1 AND batch_id=$2`,
        [organizationId,cardBatch.id]);
      if(cardRecords?.count!==cards.count||cardRecords.first!==1||
        cardRecords.last!==cards.count||cardRecords.distinct_rows!==cards.count)
        throw new CatalogImportError('STAGED_PROPERTY_CARDS_REQUIRED');
    }
    const priorResult=await tx.query<{source_lot_id:string;property_id:string;
      source_checksum:string;source_name_sha256:string;approval_sha256:string;
      review_manifest_sha256:string;
      archived_at:Date|null}>(
      `SELECT m.source_lot_id,m.property_id,m.source_checksum,m.source_name_sha256,
         m.approval_sha256,m.review_manifest_sha256,p.archived_at
       FROM catalog_property_mappings m JOIN properties p
         ON p.organization_id=m.organization_id AND p.id=m.property_id
       WHERE m.organization_id=$1 AND m.source_system='RealtyCalendar'`,[organizationId]);
    const prior=new Map(priorResult.rows.map(row=>[row.source_lot_id,row]));
    let existing=0,nameConflicts=0;
    for(const row of ready){
      const mapped=prior.get(row.source.source_lot_id);
      if(mapped){
        if(mapped.source_checksum!==inventory.checksum||
          mapped.source_name_sha256!==row.review.source_name_sha256||
          mapped.approval_sha256!==row.approvalHash||
          mapped.review_manifest_sha256!==review?.checksum||mapped.archived_at!==null)
          throw new CatalogImportError('EXISTING_MAPPING_MISMATCH');
        existing++;
      }else{
        const collision=await one<{id:string}>(tx,
          'SELECT id FROM properties WHERE organization_id=$1 AND name=$2 AND archived_at IS NULL LIMIT 1',
          [organizationId,row.source.display_name]);
        if(collision)nameConflicts++;
      }
    }
    const report:CatalogImportReport={mode:options.mode==='apply'?'applied':'preview',
      source_rows:plans.length,ready_rows:ready.length,pending_rows:pending,
      name_conflicts:nameConflicts,new_properties:ready.length-existing-nameConflicts,
      existing_properties:existing};
    if(options.mode==='preview')return report;
    if(nameConflicts)throw new CatalogImportError('PROPERTY_NAME_COLLISION');
    if(!review)throw new CatalogImportError('VERIFIED_MANIFEST_REQUIRED');
    for(const row of ready){
      if(prior.has(row.source.source_lot_id))continue;
      const property=await one<{id:string}>(tx,
        `INSERT INTO properties(organization_id,name,timezone,checkin_time,
           checkin_time_end,checkout_time_start,checkout_time)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [organizationId,row.source.display_name,row.review.timezone,
          row.review.checkin_time,row.review.checkin_time_end,
          row.review.checkout_time_start,row.review.checkout_time]);
      if(!property)throw new CatalogImportError('PROPERTY_CREATE_FAILED');
      const mapping=await one<{id:string}>(tx,
        `INSERT INTO catalog_property_mappings(organization_id,source_system,source_lot_id,
           property_id,batch_id,source_checksum,source_name_sha256,approval_sha256,
           review_manifest_sha256,reviewed_by,reviewed_at)
         VALUES($1,'RealtyCalendar',$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [organizationId,row.source.source_lot_id,property.id,batch.id,inventory.checksum,
          row.review.source_name_sha256,row.approvalHash,review.checksum,actorId,
          review.manifest.verified_at]);
      await tx.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,resource_type,resource_id,
           reason,safe_diff) VALUES($1,$2,'property.catalog_imported','property',$3,$4,$5::jsonb)`,
        [organizationId,actorId,property.id,'Verified RealtyCalendar catalog shell',
          JSON.stringify({mapping_id:mapping?.id,source_checksum:inventory.checksum})]);
    }
    // A changed on-disk snapshot invalidates the whole transaction.
    const reread=await readFile(options.inventoryPath);
    if(sha256(reread)!==inventory.checksum)throw new CatalogImportError('INVENTORY_CHANGED');
    if(options.propertyCardsPath){
      const rereadCards=await readFile(options.propertyCardsPath);
      if(sha256(rereadCards)!==cards?.checksum)
        throw new CatalogImportError('CARDS_CHANGED');
    }
    if(options.reviewManifestPath){
      const rereadReview=await readFile(options.reviewManifestPath);
      if(sha256(rereadReview)!==review.checksum)
        throw new CatalogImportError('REVIEW_MANIFEST_CHANGED');
    }
    return report;
  };
  return options.transaction?run(options.transaction):withTenant(pool,organizationId,actorId,run);
}
