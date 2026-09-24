import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {CatalogImportError,importCatalog} from '../src/import-catalog.js';

const testDatabaseUrl=process.env.TEST_DATABASE_URL;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const sourceName='RealtyCalendar inventory UI JSON / sheet:'+hash('inventory-ui').slice(0,16);
const cardsSourceName='RealtyCalendar full property UI JSONL / sheet:'+
  hash('properties-full-ui').slice(0,16);

if(!testDatabaseUrl){
  test('catalog shell import: TEST_DATABASE_URL is required',
    {skip:'TEST_DATABASE_URL is absent'},()=>{});
}else{
  test('catalog shells require verified values, preserve lot mappings and stay tenant-scoped',
    {timeout:60_000},async()=>{
      const pool=new pg.Pool({connectionString:testDatabaseUrl,max:3,statement_timeout:30_000});
      const tx=await pool.connect();
      const directory=await mkdtemp(join(tmpdir(),'kc-catalog-test-'));
      try{
        const inventoryPath=join(directory,'inventory-ui.json');
        const propertyCardsPath=join(directory,'properties-full-ui.jsonl');
        const reviewManifestPath=join(directory,'catalog-review.json');
        const candidateManifestPath=join(directory,'catalog-candidate.json');
        const pendingManifestPath=join(directory,'catalog-pending.json');
        const changedManifestPath=join(directory,'catalog-changed.json');
        const objects=[
          {source_lot_id:'1001',display_name:'Synthetic Loft A',channels:[]},
          {source_lot_id:'1002',display_name:'Synthetic Loft B',channels:[]}
        ];
        const inventoryText=JSON.stringify({capture_date:'2026-09-24',scope:'synthetic',objects});
        const checksum=hash(inventoryText);
        await writeFile(inventoryPath,inventoryText,{mode:0o600});
        const rulesSnapshot=[
          '- text: Время заезда','- option "14:00" [selected]',
          '- option "22:00" [selected]','- text: Время выезда',
          '- option "09:00" [selected]','- option "12:00" [selected]'
        ].join('\n');
        const rulesHash=hash(rulesSnapshot);
        const cardsText=objects.map(item=>JSON.stringify({lot_id:item.source_lot_id,
          label:item.display_name,sections:[{section:'rules',snapshot:rulesSnapshot}]})).join('\n')+'\n';
        const cardsChecksum=hash(cardsText);
        await writeFile(propertyCardsPath,cardsText,{mode:0o600});
        const orgA=randomUUID(),orgB=randomUUID(),actorA=randomUUID(),actorB=randomUUID();
        const reviewLots=objects.map((item,index)=>({source_lot_id:item.source_lot_id,
          source_name_sha256:hash(item.display_name),identity_verification:'verified',
          timezone:'Europe/Moscow',checkin_time:'14:00',checkin_time_end:'22:00',
          checkout_time_start:'09:00',checkout_time:'12:00',
          stay_rules_evidence_ref:`properties-full-ui.jsonl:line:${index+1}:rules:sha256:${rulesHash}`,
          stay_rules_snapshot_sha256:rulesHash,
          source_card_label_sha256:hash(item.display_name),
          timezone_verification_ref:`synthetic-owner-${item.source_lot_id}`}));
        const review={format:'realtycalendar-catalog-shells-v1',review_status:'owner_approved',organization_id:orgA,
          source_sha256:checksum,card_source_sha256:cardsChecksum,
          verified_by:actorA,verified_at:new Date().toISOString(),
          expected_object_count:objects.length,lots:reviewLots};
        await writeFile(reviewManifestPath,JSON.stringify(review),{mode:0o600});
        await writeFile(candidateManifestPath,JSON.stringify({...review,
          review_status:'candidate_only_not_owner_approved'}),{mode:0o600});
        await writeFile(pendingManifestPath,JSON.stringify({...review,lots:[reviewLots[0],
          {...reviewLots[1],timezone:null,timezone_verification_ref:null}]}),{mode:0o600});
        await writeFile(changedManifestPath,JSON.stringify({...review,lots:[reviewLots[0],
          {...reviewLots[1],source_name_sha256:hash('Changed name')}]}),{mode:0o600});

        await tx.query('BEGIN');
        await tx.query('INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
          [actorA,`catalog-${actorA}@example.test`,'Synthetic owner','synthetic-hash',
            actorB,`catalog-${actorB}@example.test`,'Synthetic other owner','synthetic-hash']);
        await tx.query("SELECT set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true)",[orgA,actorA]);
        await tx.query('INSERT INTO organizations(id,display_name) VALUES($1,$2)',[orgA,'Synthetic A']);
        await tx.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[orgA,actorA]);
        await tx.query("SELECT set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true)",[orgB,actorB]);
        await tx.query('INSERT INTO organizations(id,display_name) VALUES($1,$2)',[orgB,'Synthetic B']);
        await tx.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[orgB,actorB]);
        await tx.query("SELECT set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true)",[orgA,actorA]);
        const batch=(await tx.query<{id:string}>(
          `INSERT INTO import_batches(organization_id,state,source_name,source_checksum,row_count,summary)
           VALUES($1,'staged_evidence',$2,$3,$4,$5::jsonb) RETURNING id`,
          [orgA,sourceName,checksum,objects.length,
            JSON.stringify({stage_format:'realtycalendar-inventory-ui-v1'})])).rows[0]!;
        for(let index=0;index<objects.length;index++){
          await tx.query(
            `INSERT INTO import_records(organization_id,batch_id,source_checksum,source_locator,
               source_row_number,row_hash,payload_nonce,payload_ciphertext,payload_tag)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [orgA,batch.id,checksum,hash(`synthetic-locator-${index}`),index+1,
              hash(`synthetic-row-${index}`),randomBytes(12),Buffer.from('synthetic'),randomBytes(16)]);
        }
        const cardBatch=(await tx.query<{id:string}>(
          `INSERT INTO import_batches(organization_id,state,source_name,source_checksum,row_count,summary)
           VALUES($1,'staged_evidence',$2,$3,$4,$5::jsonb) RETURNING id`,
          [orgA,cardsSourceName,cardsChecksum,objects.length,
            JSON.stringify({stage_format:'realtycalendar-properties-full-ui-v1'})])).rows[0]!;
        for(let index=0;index<objects.length;index++){
          await tx.query(
            `INSERT INTO import_records(organization_id,batch_id,source_checksum,source_locator,
               source_row_number,row_hash,payload_nonce,payload_ciphertext,payload_tag)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [orgA,cardBatch.id,cardsChecksum,hash(`synthetic-card-locator-${index}`),
              index+1,hash(`synthetic-card-row-${index}`),randomBytes(12),
              Buffer.from('synthetic'),randomBytes(16)]);
        }
        const base={pool,transaction:tx,organizationId:orgA,actorId:actorA,
          inventoryPath,propertyCardsPath};
        const noManifest=await importCatalog({...base,mode:'preview'});
        assert.deepEqual([noManifest.source_rows,noManifest.ready_rows,noManifest.pending_rows],
          [2,0,2]);
        await assert.rejects(importCatalog({...base,mode:'apply',
          reviewManifestPath:candidateManifestPath}),error=>{
          assert.equal((error as CatalogImportError).code,'REVIEW_APPROVAL_REQUIRED');return true;
        });
        const partial=await importCatalog({...base,mode:'preview',
          reviewManifestPath:pendingManifestPath});
        assert.deepEqual([partial.ready_rows,partial.pending_rows,partial.new_properties],[1,1,1]);
        await assert.rejects(importCatalog({...base,mode:'apply',
          reviewManifestPath:pendingManifestPath}),error=>{
          assert.equal((error as CatalogImportError).code,'CATALOG_REVIEW_INCOMPLETE');return true;
        });
        assert.equal((await tx.query('SELECT count(*)::int n FROM properties')).rows[0]?.n,0);
        await assert.rejects(importCatalog({...base,mode:'preview',
          reviewManifestPath:changedManifestPath}),error=>{
          assert.equal((error as CatalogImportError).code,'REVIEW_MANIFEST_LOT_MISMATCH');return true;
        });

        await tx.query("INSERT INTO subscriptions(organization_id,state) VALUES($1,'read_only')",[orgA]);
        await assert.rejects(importCatalog({...base,mode:'apply',reviewManifestPath}),error=>{
          assert.equal((error as CatalogImportError).code,'SUBSCRIPTION_READ_ONLY');return true;
        });
        assert.equal((await tx.query('SELECT count(*)::int n FROM properties')).rows[0]?.n,0);
        await tx.query("UPDATE subscriptions SET state='trial' WHERE organization_id=$1",[orgA]);

        const first=await importCatalog({...base,mode:'apply',reviewManifestPath});
        assert.deepEqual([first.new_properties,first.existing_properties,first.pending_rows],[2,0,0]);
        const replay=await importCatalog({...base,mode:'apply',reviewManifestPath});
        assert.deepEqual([replay.new_properties,replay.existing_properties],[0,2]);
        const rows=await tx.query<{source_lot_id:string;property_id:string;timezone:string;
          checkin_time:string;checkin_time_end:string;checkout_time_start:string;
          checkout_time:string}>(
          `SELECT m.source_lot_id,m.property_id,p.timezone,p.checkin_time::text,
             p.checkin_time_end::text,p.checkout_time_start::text,p.checkout_time::text
           FROM catalog_property_mappings m JOIN properties p
             ON p.organization_id=m.organization_id AND p.id=m.property_id
           WHERE m.organization_id=$1 ORDER BY m.source_lot_id`,[orgA]);
        assert.deepEqual(rows.rows.map(row=>row.source_lot_id),['1001','1002']);
        assert.notEqual(rows.rows[0]?.property_id,rows.rows[1]?.property_id);
        assert.ok(rows.rows.every(row=>row.timezone==='Europe/Moscow'&&
          row.checkin_time==='14:00:00'&&row.checkin_time_end==='22:00:00'&&
          row.checkout_time_start==='09:00:00'&&row.checkout_time==='12:00:00'));
        for(const table of ['units','reservations','payments','outbox_events',
          'availability_allocations','journal_entries','connections']){
          assert.equal((await tx.query(`SELECT count(*)::int n FROM ${table}`)).rows[0]?.n,0,table);
        }
        assert.equal((await tx.query("SELECT count(*)::int n FROM audit_events WHERE action='property.catalog_imported'")).rows[0]?.n,2);

        await tx.query("SELECT set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true)",[orgB,actorB]);
        assert.equal((await tx.query('SELECT count(*)::int n FROM catalog_property_mappings')).rows[0]?.n,0);
        await tx.query("SELECT set_config('app.organization_id',$1,true),set_config('app.user_id',$2,true)",[orgA,actorB]);
        await assert.rejects(importCatalog({...base,actorId:actorB,mode:'preview'}),error=>{
          assert.equal((error as CatalogImportError).code,'IMPORT_ACCESS_DENIED');return true;
        });
        await tx.query('ROLLBACK');
      }finally{
        try{await tx.query('ROLLBACK');}catch{/* already closed */}
        tx.release();await pool.end();
        const resolved=await realpath(directory),root=await realpath(tmpdir());
        if(!resolved.startsWith(root+sep)||!resolved.split(sep).at(-1)?.startsWith('kc-catalog-test-'))
          throw new Error('Unexpected temporary test directory');
        await rm(resolved,{recursive:true,force:true});
      }
    });
}
