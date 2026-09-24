import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {stageSnapshot,StageError} from '../src/import-stage0.js';

const testDatabaseUrl=process.env.TEST_DATABASE_URL;
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');

if(!testDatabaseUrl){
  test('stage-0 import: TEST_DATABASE_URL is required',{skip:'TEST_DATABASE_URL is absent'},()=>{});
}else{
  test('stage-0 evidence is idempotent, tenant-scoped and hash-checked',{timeout:60_000},async()=>{
    const pool=new pg.Pool({connectionString:testDatabaseUrl,max:3,statement_timeout:30_000});
    const tx=await pool.connect();
    const directory=await mkdtemp(join(tmpdir(),'kc-stage0-test-'));
    try{
      const originalPath=join(directory,'synthetic.xls');
      const manifestPath=join(directory,'manifest.json');
      const jsonlPath=join(directory,'bookings-staging.jsonl');
      const original='<Workbook><Worksheet>Synthetic only</Worksheet></Workbook>';
      const sourceChecksum=hash(original);
      const sourceValues={
        'Объект':'Synthetic unit','Заезд':'2026-10-01','Выезд':'2026-10-03',
        'Контакты':'Synthetic guest','Примечания':null,'Гостей':'2','Сумма':'100.00',
        'Источник':'Synthetic source','Менеджер':null
      };
      const row={staging_row_id:'synthetic-row-1',source_file_sha256:sourceChecksum,
        source_row_number:2,source_values:sourceValues,source_reservation_id:null,
        target_reservation_id:null,review_status:'unreviewed',currency:null,
        reservation_status:null,payment_history:null,warnings:[]};
      await writeFile(originalPath,original,{mode:0o600});
      await writeFile(manifestPath,JSON.stringify({sha256:sourceChecksum,
        worksheet_names:['Synthetic'],row_count_by_sheet:{Synthetic:1}}),{mode:0o600});
      await writeFile(jsonlPath,JSON.stringify(row)+'\n',{mode:0o600});

      const orgA=randomUUID(),orgB=randomUUID(),actorA=randomUUID(),actorB=randomUUID();
      await tx.query('BEGIN');
      await tx.query('INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
        [actorA,`stage-${actorA}@example.test`,'Synthetic owner','synthetic-hash',
          actorB,`stage-${actorB}@example.test`,'Synthetic owner B','synthetic-hash']);
      await tx.query("SELECT set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true)",[orgA,actorA]);
      await tx.query('INSERT INTO organizations(id,display_name) VALUES($1,$2)',[orgA,'Synthetic A']);
      await tx.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[orgA,actorA]);
      await tx.query("SELECT set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true)",[orgB,actorB]);
      await tx.query('INSERT INTO organizations(id,display_name) VALUES($1,$2)',[orgB,'Synthetic B']);
      await tx.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[orgB,actorB]);

      const key=randomBytes(32);
      const base={pool,transaction:tx,organizationId:orgA,actorId:actorA,
        manifestPath,originalPath,jsonlPath,encryptionKey:key};
      await tx.query("SELECT set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true)",[orgA,actorA]);
      const preview=await stageSnapshot({...base,dryRun:true});
      assert.deepEqual([preview.mode,preview.rows,preview.new_rows,preview.unchanged_rows,preview.batch_id],
        ['dry-run',1,1,0,null]);
      assert.equal((await tx.query('SELECT count(*)::int AS n FROM import_batches')).rows[0]?.n,0);

      const first=await stageSnapshot({...base,dryRun:false});
      assert.deepEqual([first.mode,first.rows,first.new_rows,first.unchanged_rows],['staged',1,1,0]);
      assert.ok(first.batch_id);
      const second=await stageSnapshot({...base,dryRun:false});
      assert.deepEqual([second.batch_id,second.new_rows,second.unchanged_rows],[first.batch_id,0,1]);
      const record=await tx.query<{payload_ciphertext:Buffer;row_hash:string;source_checksum:string}>(
        'SELECT payload_ciphertext,row_hash,source_checksum FROM import_records WHERE organization_id=$1',[orgA]);
      assert.equal(record.rowCount,1);
      assert.equal(record.rows[0]?.source_checksum,sourceChecksum);
      assert.match(record.rows[0]!.row_hash,/^[a-f0-9]{64}$/);
      assert.equal(record.rows[0]!.payload_ciphertext.includes(Buffer.from('Synthetic guest')),false);
      for(const table of ['reservations','payments','outbox_events','availability_allocations','journal_entries']){
        assert.equal((await tx.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n,0,table);
      }

      for(const [dataset,columnCount] of [['clients',4],['expenses',6]] as const){
        const source=join(directory,`${dataset}.xlsx`);
        const manifest=join(directory,`${dataset}-manifest.json`);
        const staged=join(directory,`${dataset}-evidence.jsonl`);
        const sourceText=`Synthetic ${dataset} workbook`;
        const checksum=hash(sourceText);
        const labels=Array.from({length:columnCount},(_,index)=>({type:'s',value:`Column ${index+1}`,number_format:'General'}));
        const cells=Array.from({length:columnCount},(_,index)=>({type:'s',value:`Synthetic ${index+1}`,number_format:'General'}));
        const rows=[2,3].map(number=>({evidence_row_id:hash(`${checksum}\u0000Synthetic\u0000${number}`),
          source_file_sha256:checksum,source_worksheet:'Synthetic',source_row_number:number,
          source_columns:labels,cells}));
        await writeFile(source,sourceText,{mode:0o600});
        await writeFile(manifest,JSON.stringify({dataset:`realtycalendar-${dataset}-v1`,sha256:checksum,
          worksheet_names:['Synthetic'],row_count_by_sheet:{Synthetic:2},
          column_count_by_sheet:{Synthetic:columnCount}}),{mode:0o600});
        await writeFile(staged,rows.map(item=>JSON.stringify(item)).join('\n')+'\n',{mode:0o600});
        const input={...base,dataset,originalPath:source,manifestPath:manifest,jsonlPath:staged};
        const dry=await stageSnapshot({...input,dryRun:true});
        assert.equal(dry.new_rows,2);
        const stagedReport=await stageSnapshot({...input,dryRun:false});
        assert.equal(stagedReport.new_rows,2);
        const replay=await stageSnapshot({...input,dryRun:false});
        assert.equal(replay.new_rows,0);
        const preserved=await tx.query<{n:number}>(
          'SELECT count(*)::int AS n FROM import_records WHERE organization_id=$1 AND batch_id=$2',
          [orgA,stagedReport.batch_id]);
        assert.equal(preserved.rows[0]?.n,2,`${dataset} duplicates remain separate physical rows`);
      }

      const rawCases=[
        {dataset:'payments_ui' as const,name:'payments-2023.jsonl',sheet:'year-2023',
          body:[1,2].map(index=>JSON.stringify({row_index:index,approved:true,booking_href:null,
            cells:Array(7).fill('Synthetic payment evidence')})).join('\n')+'\n',rows:2,columns:7},
        {dataset:'payments_ui' as const,name:'payments-2024.jsonl',sheet:'year-2024',
          body:JSON.stringify({row_index:1,approved:false,booking_href:null,
            cells:Array(7).fill('Synthetic second year')})+'\n',rows:1,columns:7},
        {dataset:'inventory_ui' as const,name:'inventory-ui.json',sheet:'inventory-ui',
          body:JSON.stringify({capture_date:'2026-09-24',scope:'synthetic',objects:[
            {source_lot_id:'SYN-1',display_name:'Synthetic unit',channels:[]},
            {source_lot_id:'SYN-2',display_name:'Synthetic unit',channels:[]}
          ]}),rows:2,columns:null},
        {dataset:'deposits_ui' as const,name:'deposits-ui.json',sheet:'deposits-ui',
          body:JSON.stringify({collected_at:'2026-09-24',source_url:'synthetic',sections:[
            {section_label:'Synthetic A',table_index:1,rows:[{row_index:1,cells:Array(4).fill('Synthetic')}]},
            {section_label:'Synthetic B',table_index:2,rows:[{row_index:1,cells:Array(4).fill('Synthetic')}]}
          ]}),rows:2,columns:4},
        {dataset:'settings_ui' as const,name:'settings-ui.jsonl',sheet:'settings-ui',
          body:JSON.stringify({route:'synthetic',label:'Synthetic',snapshot:'Synthetic only'})+'\n',
          rows:1,columns:null},
        {dataset:'properties_full_ui' as const,name:'properties-full-ui.jsonl',sheet:'properties-full-ui',
          body:JSON.stringify({lot_id:'SYN-1',label:'Synthetic property',
            sections:Array.from({length:8},(_,index)=>({section:`section-${index+1}`,
              snapshot:'Synthetic only',images:[]}))})+'\n',rows:1,columns:null},
        {dataset:'active_booking_cards_ui' as const,name:'active-booking-cards.jsonl',
          sheet:'active-booking-cards-ui',body:JSON.stringify({page:1,index:1,href:'/synthetic',
            cells:Array(9).fill('Synthetic'),status:'Synthetic',info:'Synthetic',
            history:'Synthetic'})+'\n',rows:1,columns:9},
        {dataset:'booking_pages_ui' as const,name:'booking-ui-pages.jsonl',
          sheet:'booking-pages-ui',body:JSON.stringify({page:1,index:1,href:'/synthetic',
            cells:Array(9).fill('Synthetic')})+'\n',rows:1,columns:9},
        {dataset:'property_edit_links_ui' as const,name:'property-edit-links.jsonl',
          sheet:'property-edit-links-ui',body:JSON.stringify({index:0,label:'Synthetic',
            href:null})+'\n',rows:1,columns:null}
      ];
      for(const entry of rawCases){
        const source=join(directory,entry.name);
        const manifest=join(directory,`${entry.name}.manifest.json`);
        const checksum=hash(entry.body);
        await writeFile(source,entry.body,{mode:0o600});
        await writeFile(manifest,JSON.stringify({
          dataset:`realtycalendar-${entry.dataset.replaceAll('_','-')}-v1`,sha256:checksum,
          worksheet_names:[entry.sheet],row_count_by_sheet:{[entry.sheet]:entry.rows},
          ...(entry.columns?{column_count_by_sheet:{[entry.sheet]:entry.columns}}:{})
        }),{mode:0o600});
        const input={...base,dataset:entry.dataset,originalPath:source,manifestPath:manifest,jsonlPath:source};
        const dry=await stageSnapshot({...input,dryRun:true});
        assert.equal(dry.new_rows,entry.rows);
        const firstRaw=await stageSnapshot({...input,dryRun:false});
        assert.equal(firstRaw.new_rows,entry.rows);
        const replay=await stageSnapshot({...input,dryRun:false});
        assert.equal(replay.new_rows,0);
        const preserved=await tx.query<{n:number}>(
          'SELECT count(*)::int AS n FROM import_records WHERE organization_id=$1 AND batch_id=$2',
          [orgA,firstRaw.batch_id]);
        assert.equal(preserved.rows[0]?.n,entry.rows,entry.dataset);
      }
      for(const table of ['reservations','payments','outbox_events','availability_allocations','journal_entries','deposits','expenses']){
        assert.equal((await tx.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n,0,table);
      }

      await tx.query("SELECT set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true)",[orgB,actorB]);
      assert.equal((await tx.query('SELECT count(*)::int AS n FROM import_records')).rows[0]?.n,0);
      assert.equal((await tx.query('SELECT count(*)::int AS n FROM import_batches')).rows[0]?.n,0);
      await assert.rejects(stageSnapshot({...base,actorId:actorB,dryRun:true}),error=>{
        assert.equal((error as StageError).code,'IMPORT_ACCESS_DENIED');return true;
      });

      await tx.query("SELECT set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true)",[orgA,actorA]);
      await writeFile(jsonlPath,JSON.stringify({...row,source_file_sha256:'0'.repeat(64)})+'\n');
      await assert.rejects(stageSnapshot({...base,dryRun:true}),error=>{
        assert.equal((error as StageError).code,'ROW_SOURCE_HASH_MISMATCH');return true;
      });
      await writeFile(jsonlPath,JSON.stringify(row)+'\n');
      await writeFile(originalPath,original+'tampered');
      await assert.rejects(stageSnapshot({...base,dryRun:true}),error=>{
        assert.equal((error as StageError).code,'ORIGINAL_HASH_MISMATCH');return true;
      });
      await tx.query('ROLLBACK');
    }finally{
      try{await tx.query('ROLLBACK');}catch{/* already closed */}
      tx.release();await pool.end();
      const resolved=await realpath(directory),root=await realpath(tmpdir());
      if(!resolved.startsWith(root+sep)||!resolved.split(sep).at(-1)?.startsWith('kc-stage0-test-'))
        throw new Error('Unexpected temporary test directory');
      await rm(resolved,{recursive:true,force:true});
    }
  });
}
