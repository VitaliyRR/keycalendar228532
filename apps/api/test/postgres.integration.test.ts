import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import type {FastifyRequest} from 'fastify';
import {withTenant,type Tx} from '../src/db.js';
import {idempotent,type TenantContext} from '../src/tenant.js';
import {createApp} from '../src/app.js';
import type {Config} from '../src/config.js';
import {postFinancial} from '../src/finance-core.js';

// An isolated migrated database using the non-BYPASSRLS runtime role is required.
// A configured but unavailable/misconfigured database is a test failure, never a skip.
const testDatabaseUrl=process.env.TEST_DATABASE_URL;

interface Fixture {
  organizationId:string;
  userId:string;
  propertyId:string;
  unitId:string;
}

async function createFixture(pool:pg.Pool):Promise<Fixture> {
  const organizationId=randomUUID(),userId=randomUUID(),propertyId=randomUUID(),unitId=randomUUID();
  await pool.query('INSERT INTO users(id,email,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())',
    [userId,`kc-test-${userId}@example.test`,'Synthetic test user','synthetic-test-hash']);
  try{
    await withTenant(pool,organizationId,userId,async tx=>{
      await tx.query('INSERT INTO organizations(id,display_name) VALUES($1,$2)',[organizationId,`Synthetic ${organizationId}`]);
      await tx.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[organizationId,userId]);
      await tx.query("INSERT INTO subscriptions(organization_id,state,trial_ends_at) VALUES($1,'trial',now()+interval '14 days')",[organizationId]);
      await tx.query('INSERT INTO properties(id,organization_id,name) VALUES($1,$2,$3)',[propertyId,organizationId,'Synthetic property']);
      await tx.query('INSERT INTO units(id,organization_id,property_id,name,base_rate_minor) VALUES($1,$2,$3,$4,$5)',[unitId,organizationId,propertyId,'Synthetic unit','10000']);
    });
  }catch(error){await pool.query('DELETE FROM users WHERE id=$1',[userId]);throw error;}
  return {organizationId,userId,propertyId,unitId};
}

async function cleanupFixture(pool:pg.Pool,fixture:Fixture):Promise<void> {
  await withTenant(pool,fixture.organizationId,fixture.userId,async tx=>{
    for(const table of [
      'journal_lines','journal_entries','deposit_actions','ical_occupancies','ical_sync_states',
      'connection_mappings','inbox_events','sync_conflicts','outbox_events','audit_events',
      'notifications','tasks','import_batches','rate_change_previews','expenses',
      'availability_allocations','reservation_stays','refunds','deposits','payments',
      'charges','cancellation_previews','reservations','quotes','rate_days','guests',
      'idempotency_records','property_grants','units','unit_categories','properties',
      'connections','rate_plans','subscriptions','invitations','memberships',
    ]){
      await tx.query(`DELETE FROM ${table} WHERE organization_id=$1`,[fixture.organizationId]);
    }
    await tx.query('DELETE FROM organizations WHERE id=$1',[fixture.organizationId]);
  });
  await pool.query('DELETE FROM users WHERE id=$1',[fixture.userId]);
}

function tenantContext(tx:Tx,fixture:Fixture):TenantContext {
  return {
    tx,organizationId:fixture.organizationId,propertyIds:null,
    actor:{id:fixture.userId,email:'synthetic@example.test',display_name:'Synthetic',session_id:'synthetic',auth_level:'mfa',session_token:'synthetic'},
    member:{id:fixture.userId,organization_id:fixture.organizationId,role:'owner',status:'active',permissions:[],version:1},
  };
}

function request(key:string,body:unknown):FastifyRequest {
  return {headers:{'idempotency-key':key},body} as unknown as FastifyRequest;
}

async function syntheticSession(pool:pg.Pool,userId:string,csrfSecret:string):Promise<{cookie:string;csrf:string}> {
  const token=randomUUID()+randomUUID();
  const csrf=createHmac('sha256',csrfSecret).update(token).digest('base64url');
  await pool.query("INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [userId,createHash('sha256').update(token).digest(),createHash('sha256').update(csrf).digest()]);
  return {cookie:`kc_session=${token}`,csrf};
}

if(!testDatabaseUrl){
  test('PostgreSQL integration: TEST_DATABASE_URL is required', {skip:'TEST_DATABASE_URL is absent'},()=>{});
}else{
  test('PostgreSQL RLS, concurrent booking, idempotency and tenant boundaries', {timeout:180_000},async t=>{
    const pool=new pg.Pool({connectionString:testDatabaseUrl,max:20,statement_timeout:30_000,connectionTimeoutMillis:60_000});
    const fixtures:Fixture[]=[];
    try{
      const role=await pool.query<{rolsuper:boolean;rolbypassrls:boolean}>(
        'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
      assert.equal(role.rows.length,1,'runtime role must exist');
      assert.equal(role.rows[0]?.rolsuper,false,'TEST_DATABASE_URL must use a non-superuser role');
      assert.equal(role.rows[0]?.rolbypassrls,false,'TEST_DATABASE_URL must use a role without BYPASSRLS');
      const policies=await pool.query<{relname:string;relrowsecurity:boolean;relforcerowsecurity:boolean}>(
        `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
         AND c.relname=ANY($1::text[])`,[['organizations','memberships','properties','units','reservations','availability_allocations','idempotency_records']]);
      assert.equal(policies.rows.length,7,'apply core migrations to isolated test database first');
      for(const policy of policies.rows){assert.equal(policy.relrowsecurity,true,`${policy.relname} must have RLS`);assert.equal(policy.relforcerowsecurity,true,`${policy.relname} must FORCE RLS`);}
      const first=await createFixture(pool);fixtures.push(first);
      const second=await createFixture(pool);fixtures.push(second);

      await t.test('RLS hides another organization, including from a user with two memberships',async()=>{
        await withTenant(pool,second.organizationId,second.userId,tx=>tx.query(
          "INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'viewer')",[second.organizationId,first.userId]));
        await withTenant(pool,first.organizationId,first.userId,async tx=>{
          const own=await tx.query('SELECT id FROM properties');
          assert.deepEqual(own.rows.map(row=>row.id),[first.propertyId]);
          const foreign=await tx.query('SELECT id FROM properties WHERE id=$1',[second.propertyId]);
          assert.equal(foreign.rowCount,0);
          const update=await tx.query("UPDATE properties SET name='should not change' WHERE id=$1 RETURNING id",[second.propertyId]);
          assert.equal(update.rowCount,0);
          await tx.query('SAVEPOINT reject_foreign_insert');
          await assert.rejects(tx.query('INSERT INTO properties(organization_id,name) VALUES($1,$2)',[second.organizationId,'Cross-tenant']),error=>{
            assert.equal((error as {code?:string}).code,'42501');return true;
          });
          await tx.query('ROLLBACK TO SAVEPOINT reject_foreign_insert');
        });
      });

      await t.test('pooled connection loses tenant context after commit and composite FK rejects foreign parent',async()=>{
        await withTenant(pool,first.organizationId,first.userId,async tx=>{
          const visible=await tx.query('SELECT id FROM units WHERE id=$1',[first.unitId]);
          assert.equal(visible.rowCount,1);
          await tx.query('SAVEPOINT reject_foreign_parent');
          await assert.rejects(tx.query('INSERT INTO units(organization_id,property_id,name) VALUES($1,$2,$3)',
            [first.organizationId,second.propertyId,'Wrong parent']),error=>{
            assert.equal((error as {code?:string}).code,'23503');return true;
          });
          await tx.query('ROLLBACK TO SAVEPOINT reject_foreign_parent');
        });
        const withoutContext=await pool.query('SELECT id FROM properties WHERE id=$1',[first.propertyId]);
        assert.equal(withoutContext.rowCount,0,'SET LOCAL context must not leak across requests');
      });

      await t.test('journal rejects an unbalanced posted entry at commit',async()=>{
        await assert.rejects(withTenant(pool,first.organizationId,first.userId,async tx=>{
          const entry=await tx.query<{id:string}>(`INSERT INTO journal_entries(organization_id,source_type,source_id,currency,description)
            VALUES($1,'synthetic', $2,'RUB','Unbalanced test') RETURNING id`,[first.organizationId,randomUUID()]);
          await tx.query(`INSERT INTO journal_lines(organization_id,entry_id,account,debit_minor,credit_minor)
            VALUES($1,$2,'receivable',100,0)`, [first.organizationId,entry.rows[0]!.id]);
        }),error=>{assert.equal((error as {code?:string}).code,'23514');return true;});
      });

      await t.test('HTTP routes enforce membership, property scope, CSRF and foreign unit boundaries',async()=>{
        const config:Config={NODE_ENV:'test',HOST:'127.0.0.1',PORT:3001,DATABASE_URL:testDatabaseUrl,
          WEB_ORIGIN:'http://127.0.0.1:5173',SESSION_COOKIE_SECURE:'false',CSRF_SECRET:'synthetic-secret-used-only-for-db-integration-tests',EMAIL_DELIVERY:'disabled'};
        const app=await createApp(pool,config);
        try{
          const firstSession=await syntheticSession(pool,first.userId,config.CSRF_SECRET);
          const secondSession=await syntheticSession(pool,second.userId,config.CSRF_SECRET);
          const own=await app.inject({method:'GET',url:`/api/v1/organizations/${first.organizationId}/properties`,headers:{cookie:firstSession.cookie}});
          assert.equal(own.statusCode,200);
          assert.deepEqual(own.json().items.map((item:{id:string})=>item.id),[first.propertyId]);
          const organizations=await app.inject({method:'GET',url:'/api/v1/organizations',headers:{cookie:firstSession.cookie}});
          assert.equal(organizations.statusCode,200);
          assert.deepEqual(new Set(organizations.json().items.map((item:{id:string})=>item.id)),new Set([first.organizationId,second.organizationId]),
            'organization list must include active memberships even without tenant context');
          const foreignOrg=await app.inject({method:'GET',url:`/api/v1/organizations/${first.organizationId}/properties`,headers:{cookie:secondSession.cookie}});
          assert.equal(foreignOrg.statusCode,404,'a nonmember cannot read another organization');
          const scoped=await app.inject({method:'GET',url:`/api/v1/organizations/${second.organizationId}/properties`,headers:{cookie:firstSession.cookie}});
          assert.equal(scoped.statusCode,200);
          assert.deepEqual(scoped.json().items,[],'a viewer with no property grant sees no units');
          const foreignProperty=await app.inject({method:'GET',url:`/api/v1/organizations/${first.organizationId}/properties/${second.propertyId}`,headers:{cookie:firstSession.cookie}});
          assert.equal(foreignProperty.statusCode,404);
          const noCsrf=await app.inject({method:'POST',url:`/api/v1/organizations/${first.organizationId}/availability-blocks`,headers:{cookie:firstSession.cookie,'idempotency-key':randomUUID()},payload:{unit_id:first.unitId,from:'2031-11-01',to:'2031-11-02',reason:'Synthetic block'}});
          assert.equal(noCsrf.statusCode,403);
          assert.equal(noCsrf.json().code,'CSRF_FAILED');
          const wrongUnit=await app.inject({method:'POST',url:`/api/v1/organizations/${first.organizationId}/availability-blocks`,headers:{cookie:firstSession.cookie,'x-csrf-token':firstSession.csrf,'idempotency-key':randomUUID()},payload:{unit_id:second.unitId,from:'2031-11-01',to:'2031-11-02',reason:'Synthetic block'}});
          assert.equal(wrongUnit.statusCode,404);
          const financialReservationId=await withTenant(pool,first.organizationId,first.userId,async tx=>{
            const c=tenantContext(tx,first);
            const reservation=await tx.query<{id:string}>(
              "INSERT INTO reservations(organization_id,reference,status,source,total_minor,currency) VALUES($1,$2,'confirmed','direct',10000,'RUB') RETURNING id",
              [first.organizationId,`F-${randomUUID()}`]);
            const reservationId=reservation.rows[0]!.id;
            await tx.query('INSERT INTO reservation_stays(organization_id,reservation_id,unit_id,checkin,checkout) VALUES($1,$2,$3,$4,$5)',
              [first.organizationId,reservationId,first.unitId,'2031-12-01','2031-12-03']);
            await tx.query("INSERT INTO availability_allocations(organization_id,unit_id,reservation_id,kind,checkin,checkout) VALUES($1,$2,$3,'reservation',$4,$5)",
              [first.organizationId,first.unitId,reservationId,'2031-12-01','2031-12-03']);
            const charge=await tx.query<{id:string}>(
              "INSERT INTO charges(organization_id,reservation_id,kind,amount_minor,currency,service_date,description) VALUES($1,$2,'night',10000,'RUB','2031-12-01','Synthetic stay') RETURNING id",
              [first.organizationId,reservationId]);
            await postFinancial(c,'charge',charge.rows[0]!.id,'lodging_charge','10000','RUB');
            const payment=await tx.query<{id:string}>(
              "INSERT INTO payments(organization_id,reservation_id,provider,kind,amount_minor,currency,state,method) VALUES($1,$2,'manual','stay',6000,'RUB','succeeded','cash') RETURNING id",
              [first.organizationId,reservationId]);
            await postFinancial(c,'payment',payment.rows[0]!.id,'payment_capture','6000','RUB');
            const refund=await tx.query<{id:string}>(
              "INSERT INTO refunds(organization_id,payment_id,amount_minor,currency,state,reason) VALUES($1,$2,1000,'RUB','succeeded','Synthetic refund') RETURNING id",
              [first.organizationId,payment.rows[0]!.id]);
            await postFinancial(c,'refund',refund.rows[0]!.id,'payment_refund','1000','RUB',payment.rows[0]!.id);
            return reservationId;
          });
          const detail=await app.inject({method:'GET',url:`/api/v1/organizations/${first.organizationId}/reservations/${financialReservationId}`,headers:{cookie:firstSession.cookie}});
          assert.equal(detail.statusCode,200);
          assert.equal(detail.json().paid_minor,'5000','successful refund must reduce credited stay payment');
        }finally{await app.close();}
      });

      await t.test('property stay windows round-trip and reject inverted boundaries',async()=>{
        const config:Config={NODE_ENV:'test',HOST:'127.0.0.1',PORT:3001,DATABASE_URL:testDatabaseUrl,
          WEB_ORIGIN:'http://127.0.0.1:5173',SESSION_COOKIE_SECURE:'false',CSRF_SECRET:'synthetic-secret-used-only-for-db-integration-tests',EMAIL_DELIVERY:'disabled'};
        const app=await createApp(pool,config);
        try{
          const session=await syntheticSession(pool,first.userId,config.CSRF_SECRET);
          const url=`/api/v1/organizations/${first.organizationId}/properties`;
          const headers={cookie:session.cookie,'x-csrf-token':session.csrf,'idempotency-key':randomUUID()};
          const created=await app.inject({method:'POST',url,headers,payload:{
            name:'Synthetic windowed property',timezone:'Europe/Volgograd',
            checkin_time:'14:00',checkin_time_end:'22:00',checkout_time_start:'09:00',checkout_time:'12:00'
          }});
          assert.equal(created.statusCode,200);
          const detail=await app.inject({method:'GET',url:`${url}/${created.json().id}`,headers:{cookie:session.cookie}});
          assert.equal(detail.statusCode,200);
          assert.deepEqual([
            detail.json().checkin_time,detail.json().checkin_time_end,
            detail.json().checkout_time_start,detail.json().checkout_time
          ],['14:00:00','22:00:00','09:00:00','12:00:00']);
          const list=await app.inject({method:'GET',url,headers:{cookie:session.cookie}});
          assert.equal(list.statusCode,200);
          const listed=list.json().items.find((item:{id:string})=>item.id===created.json().id);
          assert.equal(listed.checkin_time_end,'22:00:00');
          assert.equal(listed.checkout_time_start,'09:00:00');
          const legacy=await app.inject({method:'GET',url:`${url}/${first.propertyId}`,headers:{cookie:session.cookie}});
          assert.equal(legacy.statusCode,200);
          assert.equal(legacy.json().checkin_time_end,null);
          assert.equal(legacy.json().checkout_time_start,null);
          const missingTimezone=await app.inject({method:'POST',url,
            headers:{...headers,'idempotency-key':randomUUID()},
            payload:{name:'Timezone omitted',checkin_time:'14:00',checkout_time:'12:00'}});
          assert.equal(missingTimezone.statusCode,422);
          const missingTimes=await app.inject({method:'POST',url,
            headers:{...headers,'idempotency-key':randomUUID()},
            payload:{name:'Stay times omitted',timezone:'Europe/Volgograd'}});
          assert.equal(missingTimes.statusCode,422);
          for(const invalid of [
            {checkin_time:'14:00',checkin_time_end:'13:00',checkout_time:'12:00'},
            {checkin_time:'14:00',checkout_time:'12:00',checkout_time_start:'13:00'},
            {checkin_time:'14:00',checkout_time:'12:00',timezone:'Mars/Olympus_Mons'}
          ]){
            const response=await app.inject({method:'POST',url,headers:{...headers,'idempotency-key':randomUUID()},
              payload:{name:'Invalid synthetic window',timezone:'Europe/Volgograd',...invalid}});
            assert.equal(response.statusCode,422);
          }
          await withTenant(pool,first.organizationId,first.userId,async tx=>{
            await tx.query('SAVEPOINT reject_inverted_window');
            await assert.rejects(tx.query(`INSERT INTO properties(organization_id,name,checkin_time,checkin_time_end)
              VALUES($1,'Inverted SQL window','14:00','13:00')`,[first.organizationId]),error=>{
              assert.equal((error as {code?:string}).code,'23514');return true;
            });
            await tx.query('ROLLBACK TO SAVEPOINT reject_inverted_window');
          });
        }finally{await app.close();}
      });

      await t.test('guest contacts require a linked reservation in a granted property',async()=>{
        const config:Config={NODE_ENV:'test',HOST:'127.0.0.1',PORT:3001,DATABASE_URL:testDatabaseUrl,
          WEB_ORIGIN:'http://127.0.0.1:5173',SESSION_COOKIE_SECURE:'false',CSRF_SECRET:'synthetic-secret-used-only-for-db-integration-tests',EMAIL_DELIVERY:'disabled'};
        const guestId=await withTenant(pool,second.organizationId,second.userId,async tx=>{
          const membership=await tx.query<{id:string}>("UPDATE memberships SET role='manager',version=version+1 WHERE organization_id=$1 AND user_id=$2 RETURNING id",[second.organizationId,first.userId]);
          assert.equal(membership.rowCount,1);
          const guest=await tx.query<{id:string}>("INSERT INTO guests(organization_id,display_name,email,phone) VALUES($1,'Scoped guest','private@example.test','+70000000000') RETURNING id",[second.organizationId]);
          const reservation=await tx.query<{id:string}>("INSERT INTO reservations(organization_id,reference,guest_id,status,source) VALUES($1,$2,$3,'request','direct') RETURNING id",[second.organizationId,`S-${randomUUID()}`,guest.rows[0]!.id]);
          await tx.query('INSERT INTO reservation_stays(organization_id,reservation_id,unit_id,checkin,checkout) VALUES($1,$2,$3,$4,$5)',[second.organizationId,reservation.rows[0]!.id,second.unitId,'2033-01-01','2033-01-03']);
          return guest.rows[0]!.id;
        });
        const app=await createApp(pool,config);
        try{
          const session=await syntheticSession(pool,first.userId,config.CSRF_SECRET);
          const base=`/api/v1/organizations/${second.organizationId}/guests`;
          const denied=await app.inject({method:'GET',url:base,headers:{cookie:session.cookie}});
          assert.equal(denied.statusCode,200);assert.deepEqual(denied.json().items,[]);
          const hidden=await app.inject({method:'GET',url:`${base}/${guestId}`,headers:{cookie:session.cookie}});
          assert.equal(hidden.statusCode,404);
          await withTenant(pool,second.organizationId,second.userId,async tx=>{
            await tx.query('INSERT INTO property_grants(organization_id,membership_id,property_id) SELECT organization_id,id,$3 FROM memberships WHERE organization_id=$1 AND user_id=$2',[second.organizationId,first.userId,second.propertyId]);
          });
          const allowed=await app.inject({method:'GET',url:base,headers:{cookie:session.cookie}});
          assert.equal(allowed.statusCode,200);assert.deepEqual(allowed.json().items.map((item:{id:string})=>item.id),[guestId]);
          const detail=await app.inject({method:'GET',url:`${base}/${guestId}`,headers:{cookie:session.cookie}});
          assert.equal(detail.statusCode,200);assert.equal(detail.json().email,'private@example.test');
        }finally{await app.close();}
      });

      await t.test('two overlapping confirmations yield one allocation; checkout boundary remains available',async()=>{
        const attempt=async(reference:string)=>withTenant(pool,first.organizationId,first.userId,async tx=>{
          const reservation=await tx.query<{id:string}>(
            "INSERT INTO reservations(organization_id,reference,status,source) VALUES($1,$2,'confirmed','direct') RETURNING id",
            [first.organizationId,reference]);
          await tx.query(`INSERT INTO availability_allocations(organization_id,unit_id,reservation_id,kind,checkin,checkout)
            VALUES($1,$2,$3,'reservation',$4,$5)`, [first.organizationId,first.unitId,reservation.rows[0]!.id,'2031-10-01','2031-10-04']);
          return reservation.rows[0]!.id;
        });
        const results=await Promise.allSettled([attempt(`T-${randomUUID()}`),attempt(`T-${randomUUID()}`)]);
        assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
        const rejected=results.find(result=>result.status==='rejected');
        assert.equal((rejected as PromiseRejectedResult | undefined)?.reason?.code,'23P01','exclusion constraint must reject the loser');
        const active=await withTenant(pool,first.organizationId,first.userId,tx=>tx.query(
          "SELECT id FROM availability_allocations WHERE organization_id=$1 AND unit_id=$2 AND state='active' AND daterange(checkin,checkout,'[)') && daterange($3::date,$4::date,'[)')",
          [first.organizationId,first.unitId,'2031-10-01','2031-10-04']));
        assert.equal(active.rowCount,1);
        await withTenant(pool,first.organizationId,first.userId,tx=>tx.query(
          "INSERT INTO availability_allocations(organization_id,unit_id,kind,checkin,checkout) VALUES($1,$2,'block',$3,$4)",
          [first.organizationId,first.unitId,'2031-10-04','2031-10-05']));
      });

      await t.test('G1: 100 simultaneous attempts for one unit yield exactly one active allocation', {timeout:120_000},async()=>{
        const checkin='2032-02-01',checkout='2032-02-04',runId=randomUUID().slice(0,8);
        const attempt=(index:number)=>withTenant(pool,first.organizationId,first.userId,async tx=>{
          const reservation=await tx.query<{id:string}>(
            "INSERT INTO reservations(organization_id,reference,status,source) VALUES($1,$2,'confirmed','direct') RETURNING id",
            [first.organizationId,`G1-${runId}-${index}`]);
          await tx.query('INSERT INTO reservation_stays(organization_id,reservation_id,unit_id,checkin,checkout) VALUES($1,$2,$3,$4,$5)',
            [first.organizationId,reservation.rows[0]!.id,first.unitId,checkin,checkout]);
          await tx.query(`INSERT INTO availability_allocations(organization_id,unit_id,reservation_id,kind,checkin,checkout)
            VALUES($1,$2,$3,'reservation',$4,$5)`,
            [first.organizationId,first.unitId,reservation.rows[0]!.id,checkin,checkout]);
          return reservation.rows[0]!.id;
        });
        let releaseStart:()=>void=()=>{};
        const start=new Promise<void>(resolve=>{releaseStart=resolve;});
        const batch=Promise.allSettled(Array.from({length:100},(_,index)=>(async()=>{await start;return attempt(index);})()));
        releaseStart();
        const results=await batch;
        const winners=results.filter((result):result is PromiseFulfilledResult<string>=>result.status==='fulfilled');
        const losers=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected');
        assert.equal(winners.length,1,'exactly one transaction must confirm the unit');
        assert.equal(losers.length,99);
        assert.ok(losers.every(result=>(result.reason as {code?:string})?.code==='23P01'),
          'every losing attempt must be rejected by the no_double_booking exclusion constraint');
        const persisted=await withTenant(pool,first.organizationId,first.userId,async tx=>{
          const allocations=await tx.query<{reservation_id:string}>(
            "SELECT reservation_id FROM availability_allocations WHERE organization_id=$1 AND unit_id=$2 AND state='active' AND daterange(checkin,checkout,'[)') && daterange($3::date,$4::date,'[)')",
            [first.organizationId,first.unitId,checkin,checkout]);
          const reservations=await tx.query<{id:string}>(
            'SELECT id FROM reservations WHERE organization_id=$1 AND reference LIKE $2',
            [first.organizationId,`G1-${runId}-%`]);
          return {allocations:allocations.rows,reservations:reservations.rows};
        });
        assert.equal(persisted.allocations.length,1,'the database must contain one active allocation in the tested range');
        assert.deepEqual(persisted.reservations.map(row=>row.id),[winners[0]!.value],
          'rejected transactions must roll back their reservation rows');
        assert.equal(persisted.allocations[0]!.reservation_id,winners[0]!.value);
      });

      await t.test('idempotency returns the same result and rejects reuse with a different body',async()=>{
        const key=`same-${randomUUID()}`;
        let executed=0;
        const run=(body:unknown,k=key)=>withTenant(pool,first.organizationId,first.userId,tx=>
          idempotent(tenantContext(tx,first),request(k,body),'property.create',async()=>{
            executed++;
            const row=await tx.query<{id:string}>('INSERT INTO properties(organization_id,name) VALUES($1,$2) RETURNING id',
              [first.organizationId,'Created once']);
            return {id:row.rows[0]!.id};
          }));
        const initial=await run({name:'Created once',metadata:{b:2,a:1}});
        const repeat=await run({metadata:{a:1,b:2},name:'Created once'});
        assert.deepEqual(repeat,initial);
        assert.equal(executed,1);
        await assert.rejects(run({name:'Different'}),error=>{
          assert.equal((error as {code?:string}).code,'IDEMPOTENCY_KEY_REUSED');return true;
        });
        const concurrentKey=`concurrent-${randomUUID()}`;
        const concurrent=await Promise.all([run({name:'Concurrent'},concurrentKey),run({name:'Concurrent'},concurrentKey)]);
        assert.deepEqual(concurrent[0],concurrent[1]);
        assert.equal(executed,2,'only one execution for the concurrent duplicate');
        const records=await withTenant(pool,first.organizationId,first.userId,tx=>tx.query(
          'SELECT operation,key,response_body FROM idempotency_records WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=ANY($4::text[])',
          [first.organizationId,first.userId,'property.create',[key,concurrentKey]]));
        assert.equal(records.rowCount,2);
      });
    }finally{
      const failures:unknown[]=[];
      for(const fixture of fixtures.reverse()){
        try{await cleanupFixture(pool,fixture);}catch(error){failures.push(error);}
      }
      await pool.end();
      if(failures.length)throw new AggregateError(failures,'Test fixture cleanup failed');
    }
  });
}
