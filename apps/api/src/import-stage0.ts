import {createCipheriv,createHash,randomBytes} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import type pg from 'pg';
import {one,withTenant,type Tx} from './db.js';

const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_COLUMNS=['Объект','Заезд','Выезд','Контакты','Примечания','Гостей','Сумма','Источник','Менеджер'] as const;
const MAX_FILE_BYTES=256*1024*1024;
const MAX_MANIFEST_BYTES=1024*1024;
const MAX_LINE_BYTES=256*1024;
const MAX_ROWS=200_000;
const SOURCE_NAMES={bookings:'RealtyCalendar bookings SpreadsheetML 2003',
  clients:'RealtyCalendar clients XLSX',expenses:'RealtyCalendar expenses XLSX',
  payments_ui:'RealtyCalendar payments UI JSONL',inventory_ui:'RealtyCalendar inventory UI JSON',
  deposits_ui:'RealtyCalendar deposits UI JSON',settings_ui:'RealtyCalendar settings UI JSONL',
  properties_full_ui:'RealtyCalendar full property UI JSONL',
  active_booking_cards_ui:'RealtyCalendar active booking cards UI JSONL',
  booking_card_facts_ui:'RealtyCalendar booking card facts UI JSONL',
  booking_pages_ui:'RealtyCalendar booking pages UI JSONL',
  property_edit_links_ui:'RealtyCalendar property edit links UI JSONL'} as const;
export type EvidenceDataset=keyof typeof SOURCE_NAMES;
const STAGE_FORMAT:Record<EvidenceDataset,string>={bookings:'realtycalendar-bookings-v1',
  clients:'realtycalendar-clients-v1',expenses:'realtycalendar-expenses-v1',
  payments_ui:'realtycalendar-payments-ui-v1',inventory_ui:'realtycalendar-inventory-ui-v1',
  deposits_ui:'realtycalendar-deposits-ui-v1',settings_ui:'realtycalendar-settings-ui-v1',
  properties_full_ui:'realtycalendar-properties-full-ui-v1',
  active_booking_cards_ui:'realtycalendar-active-booking-cards-ui-v1',
  booking_card_facts_ui:'realtycalendar-booking-card-facts-ui-v1',
  booking_pages_ui:'realtycalendar-booking-pages-ui-v1',
  property_edit_links_ui:'realtycalendar-property-edit-links-ui-v1'};

export class StageError extends Error {
  constructor(readonly code:string){super(code);this.name='StageError';}
}

type Json=string|number|boolean|null|Json[]|{[key:string]:Json};
type StageRow={
  source_file_sha256:string;
  source_row_number:number;
  [key:string]:Json;
};
type RowMeta={locator:string;hash:string;rowNumber:number};
type Manifest={sha256:string;dataset?:string;worksheet_names?:string[];
  row_count_by_sheet?:Record<string,number>;column_count_by_sheet?:Record<string,number>;
  data_row_count?:number};

export type StageOptions={
  pool:pg.Pool;
  organizationId:string;
  actorId:string;
  manifestPath:string;
  originalPath:string;
  jsonlPath:string;
  dataset?:EvidenceDataset;
  worksheet?:string;
  dryRun:boolean;
  encryptionKey?:Buffer;
  // Caller-owned transaction is used by isolated rollback-only integration tests.
  transaction?:Tx;
};
export type StageReport={mode:'dry-run'|'staged';batch_id:string|null;rows:number;new_rows:number;unchanged_rows:number};

function isObject(value:unknown):value is Record<string,unknown>{
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function canonical(value:Json):string{
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(isObject(value))return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>JSON.stringify(key)+':'+canonical(item as Json)).join(',')+'}';
  return JSON.stringify(value);
}
function sha256(value:string|Buffer):string{return createHash('sha256').update(value).digest('hex');}
function validateJson(value:unknown,depth=0):asserts value is Json{
  if(depth>20)throw new StageError('ROW_NESTING_LIMIT');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'&&Number.isFinite(value))return;
  if(Array.isArray(value)){for(const item of value)validateJson(item,depth+1);return;}
  if(isObject(value)){for(const item of Object.values(value))validateJson(item,depth+1);return;}
  throw new StageError('ROW_INVALID_JSON_VALUE');
}
function sourceDateOrder(value:unknown):number|null{
  if(typeof value!=='string')return null;
  const parts=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if(!parts)return null;
  const day=Number(parts[1]),month=Number(parts[2]),year=Number(parts[3]);
  if(year<1900||year>2100||month<1||month>12)return null;
  const days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,
    31,30,31,30,31,31,30,31,30,31];
  if(day<1||day>days[month-1]!)return null;
  return year*10_000+month*100+day;
}
function validateRow(value:unknown,sourceChecksum:string,dataset:EvidenceDataset,
  worksheet:string,expectedColumns?:number,physicalLine?:number):StageRow{
  if(!isObject(value))throw new StageError('ROW_INVALID_SHAPE');
  validateJson(value);
  if(dataset==='payments_ui'||dataset==='settings_ui'||dataset==='properties_full_ui'||
    dataset==='active_booking_cards_ui'||dataset==='booking_card_facts_ui'||dataset==='booking_pages_ui'||
    dataset==='property_edit_links_ui'){
    if(!physicalLine)throw new StageError('ROW_INVALID_NUMBER');
    if(dataset==='payments_ui'&&(!Number.isSafeInteger(value.row_index)||typeof value.approved!=='boolean'||
      (value.booking_href!==null&&typeof value.booking_href!=='string')||!Array.isArray(value.cells)||
      value.cells.length!==7||value.cells.some(cell=>typeof cell!=='string')))
      throw new StageError('ROW_INVALID_PAYMENT_EVIDENCE');
    if(dataset==='settings_ui'&&(typeof value.route!=='string'||typeof value.label!=='string'||
      typeof value.snapshot!=='string'))throw new StageError('ROW_INVALID_SETTINGS_EVIDENCE');
    if(dataset==='properties_full_ui'&&(typeof value.lot_id!=='string'||
      typeof value.label!=='string'||!Array.isArray(value.sections)||value.sections.length!==8||
      value.sections.some(section=>!isObject(section)||typeof section.section!=='string'||
        !(typeof section.snapshot==='string'||
          (section.section==='photos'&&section.snapshot===null&&
            section.capture_method==='css_gallery_dom'&&
            Array.isArray(section.gallery)&&section.gallery.length>0))||
        (section.images!==undefined&&!Array.isArray(section.images)))))
      throw new StageError('ROW_INVALID_PROPERTY_EVIDENCE');
    if((dataset==='active_booking_cards_ui'||dataset==='booking_pages_ui')&&
      (!Number.isSafeInteger(value.page)||!Number.isSafeInteger(value.index)||
        typeof value.href!=='string'||!Array.isArray(value.cells)||value.cells.length!==9||
        value.cells.some(cell=>typeof cell!=='string')))
      throw new StageError('ROW_INVALID_BOOKING_UI_EVIDENCE');
    if(dataset==='active_booking_cards_ui'&&
      (typeof value.status!=='string'||typeof value.info!=='string'||
        typeof value.history!=='string'))
      throw new StageError('ROW_INVALID_BOOKING_CARD_EVIDENCE');
    if(dataset==='booking_card_facts_ui'){
      const begin=sourceDateOrder(value.begin),end=sourceDateOrder(value.end);
      if(typeof value.href!=='string'||!/^\/event_calendars\/[1-9]\d*$/.test(value.href)||
        typeof value.source_lot_id!=='string'||!/^\d+$/.test(value.source_lot_id)||
        typeof value.lot_in_current_inventory!=='boolean'||
        typeof value.status!=='string'||!value.status.trim()||
        begin===null||end===null||end<=begin||
        typeof value.info!=='string'||!value.info.trim()||
        typeof value.history!=='string'||!value.history.trim()||
        (value.target_reservation_id!==undefined&&value.target_reservation_id!==null))
        throw new StageError('ROW_INVALID_BOOKING_CARD_FACT_EVIDENCE');
    }
    if(dataset==='property_edit_links_ui'&&
      (!Number.isSafeInteger(value.index)||typeof value.label!=='string'||
        (value.href!==null&&typeof value.href!=='string')))
      throw new StageError('ROW_INVALID_PROPERTY_LINK_EVIDENCE');
    return {source_file_sha256:sourceChecksum,source_row_number:physicalLine,
      source_worksheet:worksheet,raw:value as Json};
  }
  if(value.source_file_sha256!==sourceChecksum)throw new StageError('ROW_SOURCE_HASH_MISMATCH');
  if(!Number.isSafeInteger(value.source_row_number)||Number(value.source_row_number)<1)
    throw new StageError('ROW_INVALID_NUMBER');
  if(dataset==='bookings'){
    if(typeof value.staging_row_id!=='string'||value.staging_row_id.length<1||value.staging_row_id.length>256)
      throw new StageError('ROW_INVALID_ID');
    if(!isObject(value.source_values)||Object.keys(value.source_values).length!==SOURCE_COLUMNS.length||
      SOURCE_COLUMNS.some(column=>!Object.hasOwn(value.source_values as object,column)))
      throw new StageError('ROW_COLUMNS_MISMATCH');
    for(const field of Object.values(value.source_values)){
      if(field!==null&&typeof field!=='string'&&typeof field!=='number')throw new StageError('ROW_INVALID_CELL');
    }
  }else if(dataset==='clients'||dataset==='expenses'){
    if(typeof value.evidence_row_id!=='string'||
      value.evidence_row_id!==locator(sourceChecksum,worksheet,Number(value.source_row_number)))
      throw new StageError('ROW_INVALID_ID');
    if(value.source_worksheet!==worksheet)throw new StageError('ROW_WORKSHEET_MISMATCH');
    if(!Number.isSafeInteger(expectedColumns)||!Array.isArray(value.source_columns)||
      !Array.isArray(value.cells)||value.source_columns.length!==expectedColumns||
      value.cells.length!==expectedColumns)throw new StageError('ROW_COLUMNS_MISMATCH');
    for(const cell of [...value.source_columns,...value.cells]){
      if(!isObject(cell)||!Object.hasOwn(cell,'value')||
        (cell.value!==null&&typeof cell.value!=='string'))throw new StageError('ROW_INVALID_CELL');
    }
  }else if(dataset==='inventory_ui'){
    if(value.source_worksheet!==worksheet||!isObject(value.raw_object)||
      !Object.hasOwn(value.raw_object,'source_lot_id')||
      !Object.hasOwn(value.raw_object,'display_name')||
      !Object.hasOwn(value.raw_object,'channels'))
      throw new StageError('ROW_INVALID_INVENTORY_EVIDENCE');
  }else if(dataset==='deposits_ui'){
    if(value.source_worksheet!==worksheet||!Number.isSafeInteger(value.source_section_index)||
      !isObject(value.raw)||!Number.isSafeInteger(value.raw.row_index)||
      !Array.isArray(value.raw.cells)||value.raw.cells.length!==4||
      value.raw.cells.some(cell=>typeof cell!=='string'))
      throw new StageError('ROW_INVALID_DEPOSIT_EVIDENCE');
  }
  if(value.target_reservation_id!==undefined&&value.target_reservation_id!==null)
    throw new StageError('ROW_ALREADY_TARGETED');
  return value as StageRow;
}
async function hashRegularFile(path:string,maxBytes:number):Promise<string>{
  const info=await stat(path);
  if(!info.isFile()||info.size>maxBytes)throw new StageError('FILE_SIZE_OR_TYPE');
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}
async function loadManifest(path:string):Promise<Manifest>{
  const info=await stat(path);
  if(!info.isFile()||info.size>MAX_MANIFEST_BYTES)throw new StageError('MANIFEST_SIZE_OR_TYPE');
  let value:unknown;
  try{value=JSON.parse(await readFile(path,'utf8'));}catch{throw new StageError('MANIFEST_INVALID_JSON');}
  if(!isObject(value)||typeof value.sha256!=='string'||!HASH.test(value.sha256))
    throw new StageError('MANIFEST_INVALID_HASH');
  if(value.worksheet_names!==undefined&&(!Array.isArray(value.worksheet_names)||
    value.worksheet_names.some(item=>typeof item!=='string'||item.length<1||item.length>128)))
    throw new StageError('MANIFEST_INVALID_WORKSHEETS');
  if(value.row_count_by_sheet!==undefined&&(!isObject(value.row_count_by_sheet)||
    Object.values(value.row_count_by_sheet).some(count=>!Number.isSafeInteger(count)||Number(count)<0)))
    throw new StageError('MANIFEST_INVALID_COUNTS');
  if(value.column_count_by_sheet!==undefined&&(!isObject(value.column_count_by_sheet)||
    Object.values(value.column_count_by_sheet).some(count=>!Number.isSafeInteger(count)||Number(count)<1)))
    throw new StageError('MANIFEST_INVALID_COUNTS');
  if(value.data_row_count!==undefined&&(!Number.isSafeInteger(value.data_row_count)||Number(value.data_row_count)<0))
    throw new StageError('MANIFEST_INVALID_COUNTS');
  return value as Manifest;
}
function selectWorksheet(manifest:Manifest,requested?:string):string{
  const names=manifest.worksheet_names;
  if(requested){
    if(requested.length>128||names&& !names.includes(requested))throw new StageError('WORKSHEET_NOT_IN_MANIFEST');
    return requested;
  }
  if(!names||names.length!==1)throw new StageError('WORKSHEET_REQUIRED');
  return names[0]!;
}
async function* readRows(path:string,sourceChecksum:string,dataset:EvidenceDataset,
  worksheet:string,expectedColumns?:number):AsyncGenerator<StageRow>{
  if(dataset==='inventory_ui'||dataset==='deposits_ui'){
    const info=await stat(path);
    if(info.size>8*1024*1024)throw new StageError('INVENTORY_SIZE_LIMIT');
    let document:unknown;
    try{document=JSON.parse(await readFile(path,'utf8'));}catch{throw new StageError('ROW_INVALID_JSON');}
    if(!isObject(document))throw new StageError('SOURCE_JSON_INVALID_SHAPE');
    validateJson(document);
    if(dataset==='inventory_ui'){
      if(!Array.isArray(document.objects))throw new StageError('INVENTORY_INVALID_SHAPE');
      for(let index=0;index<document.objects.length;index++){
        const row={source_file_sha256:sourceChecksum,source_row_number:index+1,
          source_worksheet:worksheet,source_capture_date:document.capture_date??null,
          source_scope:document.scope??null,raw_object:document.objects[index]};
        yield validateRow(row,sourceChecksum,dataset,worksheet,expectedColumns);
      }
    }else{
      if(!Array.isArray(document.sections))throw new StageError('DEPOSITS_INVALID_SHAPE');
      let physicalRow=0;
      for(let sectionIndex=0;sectionIndex<document.sections.length;sectionIndex++){
        const section=document.sections[sectionIndex];
        if(!isObject(section)||!Array.isArray(section.rows))throw new StageError('DEPOSITS_INVALID_SHAPE');
        for(const raw of section.rows){
          physicalRow++;
          const row={source_file_sha256:sourceChecksum,source_row_number:physicalRow,
            source_worksheet:worksheet,source_section_index:sectionIndex+1,
            source_section_label:section.section_label??null,source_table_index:section.table_index??null,
            source_collected_at:document.collected_at??null,source_url:document.source_url??null,raw};
          yield validateRow(row,sourceChecksum,dataset,worksheet,expectedColumns);
        }
      }
    }
    return;
  }
  const stream=createReadStream(path,{highWaterMark:64*1024});
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let pending=Buffer.alloc(0);
  let physicalLine=0;
  const parse=(bytes:Buffer):StageRow=>{
    physicalLine++;
    if(bytes.length>MAX_LINE_BYTES)throw new StageError('ROW_SIZE_LIMIT');
    let line:string;
    try{line=decoder.decode(bytes);}catch{throw new StageError('ROW_INVALID_UTF8');}
    if(line.trim()==='')throw new StageError('ROW_EMPTY_LINE');
    let value:unknown;
    try{value=JSON.parse(line);}catch{throw new StageError('ROW_INVALID_JSON');}
    return validateRow(value,sourceChecksum,dataset,worksheet,expectedColumns,physicalLine);
  };
  try{
    for await(const chunk of stream){
      const bytes=chunk as Buffer;
      let start=0;
      for(let newline=bytes.indexOf(10,start);newline>=0;newline=bytes.indexOf(10,start)){
        const piece=bytes.subarray(start,newline);
        if(pending.length+piece.length>MAX_LINE_BYTES)throw new StageError('ROW_SIZE_LIMIT');
        const line=pending.length?Buffer.concat([pending,piece]):piece;
        yield parse(line.length&&line[line.length-1]===13?line.subarray(0,-1):line);
        pending=Buffer.alloc(0);
        start=newline+1;
      }
      const rest=bytes.subarray(start);
      if(pending.length+rest.length>MAX_LINE_BYTES)throw new StageError('ROW_SIZE_LIMIT');
      pending=pending.length?Buffer.concat([pending,rest]):Buffer.from(rest);
    }
    if(pending.length)yield parse(pending);
  }finally{stream.destroy();}
}
function locator(checksum:string,worksheet:string,rowNumber:number):string{
  // The locator is stable for this immutable snapshot, without exposing the
  // worksheet label or any guest field in an index or API response.
  return sha256(`${checksum}\u0000${worksheet}\u0000${rowNumber}`);
}
function encryptRow(key:Buffer,row:StageRow,aad:string):{nonce:Buffer;ciphertext:Buffer;tag:Buffer}{
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,nonce);
  cipher.setAAD(Buffer.from(aad,'utf8'));
  const ciphertext=Buffer.concat([cipher.update(canonical(row)),cipher.final()]);
  return {nonce,ciphertext,tag:cipher.getAuthTag()};
}

export async function stageSnapshot(options:StageOptions):Promise<StageReport>{
  const {pool,organizationId,actorId}=options;
  const dataset=options.dataset??'bookings';
  if(!UUID.test(organizationId)||!UUID.test(actorId))throw new StageError('INVALID_ID');
  if(!options.dryRun&&(!options.encryptionKey||options.encryptionKey.length!==32))
    throw new StageError('ENCRYPTION_KEY_REQUIRED');
  const manifest=await loadManifest(options.manifestPath);
  if(dataset!=='bookings'&&manifest.dataset!==STAGE_FORMAT[dataset])
    throw new StageError('MANIFEST_DATASET_MISMATCH');
  const worksheet=selectWorksheet(manifest,options.worksheet);
  const expectedColumns=manifest.column_count_by_sheet?.[worksheet];
  const requiredColumns=dataset==='clients'?4:dataset==='expenses'?6:dataset==='payments_ui'?7:
    dataset==='deposits_ui'?4:
    dataset==='active_booking_cards_ui'||dataset==='booking_pages_ui'?9:null;
  if(requiredColumns!==null&&expectedColumns!==requiredColumns)
    throw new StageError('MANIFEST_COLUMN_COUNT_MISMATCH');
  const sourceName=`${SOURCE_NAMES[dataset]} / sheet:${sha256(worksheet).slice(0,16)}`;
  const originalHash=await hashRegularFile(options.originalPath,MAX_FILE_BYTES);
  if(originalHash!==manifest.sha256)throw new StageError('ORIGINAL_HASH_MISMATCH');
  const jsonlHash=await hashRegularFile(options.jsonlPath,MAX_FILE_BYTES);
  const meta:RowMeta[]=[];
  const seen=new Set<number>();
  for await(const row of readRows(options.jsonlPath,manifest.sha256,dataset,worksheet,expectedColumns)){
    if(meta.length>=MAX_ROWS)throw new StageError('ROW_COUNT_LIMIT');
    if(seen.has(row.source_row_number))throw new StageError('DUPLICATE_SOURCE_ROW');
    seen.add(row.source_row_number);
    meta.push({locator:locator(manifest.sha256,worksheet,row.source_row_number),
      hash:sha256(canonical(row)),rowNumber:row.source_row_number});
  }
  if(meta.length===0)throw new StageError('EMPTY_SNAPSHOT');
  const expectedCount=manifest.row_count_by_sheet?.[worksheet]??
    (dataset==='bookings'?manifest.data_row_count:undefined);
  if(expectedCount!==undefined&&meta.length!==expectedCount)throw new StageError('MANIFEST_ROW_COUNT_MISMATCH');
  // A second hash guards against an input file changing between preflight and
  // the transaction. Any failure rolls the entire batch back.
  if(await hashRegularFile(options.jsonlPath,MAX_FILE_BYTES)!==jsonlHash)
    throw new StageError('SNAPSHOT_CHANGED');

  const role=await pool.query<{rolsuper:boolean;rolbypassrls:boolean}>(
    'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  if(role.rows[0]?.rolsuper!==false||role.rows[0]?.rolbypassrls!==false)
    throw new StageError('RLS_RUNTIME_ROLE_REQUIRED');

  const run=async(tx:Tx):Promise<StageReport>=>{
    const member=await one<{role:string}>(tx,
      "SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND status='active' FOR SHARE",
      [organizationId,actorId]);
    if(!member||!['owner','admin'].includes(member.role))throw new StageError('IMPORT_ACCESS_DENIED');
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[
      `keycalendar-stage0:${organizationId}:${manifest.sha256}`]);
    const prior=await one<{id:string;state:string;row_count:number|null;summary:Record<string,unknown>}>(tx,
      `SELECT id,state,row_count,summary FROM import_batches
       WHERE organization_id=$1 AND source_name=$2 AND source_checksum=$3 FOR UPDATE`,
      [organizationId,sourceName,manifest.sha256]);
    if(prior&&(prior.state!=='staged_evidence'||prior.row_count!==meta.length||
      prior.summary?.stage_format!==STAGE_FORMAT[dataset]||prior.summary?.staging_sha256!==jsonlHash))
      throw new StageError('BATCH_SNAPSHOT_MISMATCH');
    const existing=new Map<string,string>();
    if(prior){
      const rows=await tx.query<{source_locator:string;row_hash:string}>(
        'SELECT source_locator,row_hash FROM import_records WHERE organization_id=$1 AND batch_id=$2',
        [organizationId,prior.id]);
      for(const row of rows.rows)existing.set(row.source_locator,row.row_hash);
    }
    const proposed=new Map(meta.map(row=>[row.locator,row.hash]));
    for(const [key,hash] of existing){
      if(proposed.get(key)!==hash)throw new StageError('EXISTING_ROW_MISMATCH');
    }
    const newRows=meta.length-existing.size;
    if(options.dryRun)return {mode:'dry-run',batch_id:prior?.id??null,
      rows:meta.length,new_rows:newRows,unchanged_rows:existing.size};

    const batch=prior??await one<{id:string}>(tx,
      `INSERT INTO import_batches(organization_id,state,source_name,source_checksum,row_count,summary)
       VALUES($1,'staged_evidence',$2,$3,$4,$5::jsonb) RETURNING id`,
      [organizationId,sourceName,manifest.sha256,meta.length,JSON.stringify({
        stage_format:STAGE_FORMAT[dataset],staging_sha256:jsonlHash,
        missing_datasets:dataset==='bookings'
          ?['reservation_ids','reservation_statuses','currency','payments','refunds','deposits','external_ids']
          :dataset==='clients'?['stable_client_ids','duplicate_review']
          :dataset==='expenses'?['expense_ids','currency','payment_evidence','duplicate_review']
          :dataset==='payments_ui'?['stable_payment_ids','provider_status','refund_links','currency_semantics']
          :dataset==='inventory_ui'?['property_mapping','full_property_settings','inventory_history']
          :dataset==='deposits_ui'?['stable_deposit_ids','settlement_evidence','source_status_semantics']
          :dataset==='settings_ui'?['settings_verification','credential_rotation','capability_approval']
          :dataset==='active_booking_cards_ui'?['stable_reservation_ids','status_semantics','financial_reconciliation']
          :dataset==='booking_card_facts_ui'?['status_semantics','financial_reconciliation','historical_completeness']
          :dataset==='booking_pages_ui'?['stable_reservation_ids','page_coverage','status_semantics']
          :dataset==='property_edit_links_ui'?['stable_property_mapping','full_property_settings']
          :['property_mapping','media_policy','rates_semantics','history_completeness'],
        quarantine_count:meta.length
      })]);
    if(!batch)throw new StageError('BATCH_CREATE_FAILED');
    let index=0;
    for await(const row of readRows(options.jsonlPath,manifest.sha256,dataset,worksheet,expectedColumns)){
      const expected=meta[index++];
      if(!expected||row.source_row_number!==expected.rowNumber||sha256(canonical(row))!==expected.hash)
        throw new StageError('SNAPSHOT_CHANGED');
      if(existing.has(expected.locator))continue;
      const encrypted=encryptRow(options.encryptionKey!,row,
        `${organizationId}\u0000${batch.id}\u0000${expected.locator}\u0000${expected.hash}`);
      await tx.query(
        `INSERT INTO import_records(organization_id,batch_id,source_checksum,source_locator,
           source_row_number,row_hash,payload_nonce,payload_ciphertext,payload_tag)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [organizationId,batch.id,manifest.sha256,expected.locator,expected.rowNumber,
          expected.hash,encrypted.nonce,encrypted.ciphertext,encrypted.tag]);
    }
    if(index!==meta.length||await hashRegularFile(options.jsonlPath,MAX_FILE_BYTES)!==jsonlHash)
      throw new StageError('SNAPSHOT_CHANGED');
    return {mode:'staged',batch_id:batch.id,rows:meta.length,new_rows:newRows,
      unchanged_rows:existing.size};
  };
  return options.transaction?run(options.transaction):withTenant(pool,organizationId,actorId,run);
}
