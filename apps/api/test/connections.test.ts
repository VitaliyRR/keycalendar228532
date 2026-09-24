import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import pg from 'pg';
import { addDays, ConnectorError, type FeedFetchResult } from '@keycalendar/connectors';
import { registerConnections, encryptConnectionFeed, decryptConnectionFeed } from '../src/connections.js';
import { pollIcalConnection } from '../src/connections-worker.js';
import { registerReservations } from '../src/reservations.js';
import { withTenant } from '../src/db.js';
import { sendProblem } from '../src/problem.js';
import type { Config } from '../src/config.js';

test('connection encryption binds randomized ciphertext to organization and connection', () => {
  const config = { CONNECTION_SECRET_KEY: randomBytes(32).toString('hex') };
  const organizationId = randomUUID(), connectionId = randomUUID(), url = 'https://calendar.example.com/feed.ics?key=synthetic';
  const first = encryptConnectionFeed(url, config, organizationId, connectionId), second = encryptConnectionFeed(url, config, organizationId, connectionId);
  assert.notEqual(first, second); assert.ok(!first.includes('synthetic'));
  assert.equal(decryptConnectionFeed(first, config, organizationId, connectionId), url);
  assert.throws(() => decryptConnectionFeed(first, config, randomUUID(), connectionId), /CONNECTION_SECRET_UNREADABLE/);
  assert.throws(() => decryptConnectionFeed(first, config, organizationId, randomUUID()), /CONNECTION_SECRET_UNREADABLE/);
  const parts = first.split('.'); parts[3] = Buffer.from('tampered-synthetic').toString('base64url');
  assert.throws(() => decryptConnectionFeed(parts.join('.'), config, organizationId, connectionId), /CONNECTION_SECRET_UNREADABLE/);
  assert.throws(() => encryptConnectionFeed(url, {}, organizationId, connectionId), /CONNECTION_SECRET_CONFIGURATION/);
  assert.throws(() => encryptConnectionFeed('https://127.0.0.1/feed', config, organizationId, connectionId), /UNSAFE_FEED_ADDRESS/);
});

interface Fixture { organizationId: string; userId: string; propertyId: string; unitId: string; cookie: string; csrf: string }
async function fixture(pool: pg.Pool, config: Config): Promise<Fixture> {
  const organizationId = randomUUID(), userId = randomUUID(), propertyId = randomUUID(), unitId = randomUUID(), token = randomUUID() + randomUUID();
  await pool.query(`INSERT INTO users(id,email,display_name,password_hash,email_verified_at) VALUES($1,$2,'Synthetic connector owner','synthetic-unused-hash',now())`, [userId, `connector-${userId}@example.test`]);
  await withTenant(pool, organizationId, userId, async tx => {
    await tx.query(`INSERT INTO organizations(id,display_name) VALUES($1,'Synthetic connector organization')`, [organizationId]);
    await tx.query(`INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'owner')`, [organizationId, userId]);
    await tx.query(`INSERT INTO subscriptions(organization_id,state,trial_ends_at) VALUES($1,'trial',now()+interval '14 days')`, [organizationId]);
    await tx.query(`INSERT INTO properties(id,organization_id,name) VALUES($1,$2,'Synthetic feed property')`, [propertyId, organizationId]);
    await tx.query(`INSERT INTO units(id,organization_id,property_id,name) VALUES($1,$2,$3,'Synthetic feed unit')`, [unitId, organizationId, propertyId]);
    await tx.query(`INSERT INTO rate_plans(organization_id,name) VALUES($1,'Synthetic connector rate')`, [organizationId]);
  });
  const csrf = createHmac('sha256', config.CSRF_SECRET).update(token).digest('base64url');
  await pool.query(`INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')`,
    [userId, createHash('sha256').update(token).digest(), createHash('sha256').update(csrf).digest()]);
  return { organizationId, userId, propertyId, unitId, cookie: `kc_session=${token}`, csrf };
}
async function cleanup(pool: pg.Pool, value: Fixture): Promise<void> {
  await withTenant(pool, value.organizationId, value.userId, async tx => {
    for (const table of ['sync_conflicts', 'ical_occupancies', 'ical_sync_states', 'connection_mappings', 'inbox_events', 'connections', 'idempotency_records', 'audit_events', 'outbox_events', 'availability_allocations', 'cancellation_previews', 'charges', 'reservation_stays', 'reservations', 'quotes', 'rate_plans', 'units', 'properties', 'subscriptions', 'memberships']) {
      await tx.query(`DELETE FROM ${table} WHERE organization_id=$1`, [value.organizationId]);
    }
    await tx.query('DELETE FROM organizations WHERE id=$1', [value.organizationId]);
  });
  await pool.query('DELETE FROM users WHERE id=$1', [value.userId]);
}
const database = process.env.TEST_DATABASE_URL;
if (!database) {
  test('connector PostgreSQL tests require an isolated migrated TEST_DATABASE_URL', { skip: 'TEST_DATABASE_URL is absent' }, () => {});
} else {
  test('PostgreSQL connections: secret boundary, UID dedupe, occupancy conflict, cancellation and RLS', { timeout: 180_000 }, async t => {
    const pool = new pg.Pool({ connectionString: database, max: 5, statement_timeout: 15_000 });
    const config: Config = { NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 3001, DATABASE_URL: database,
      WEB_ORIGIN: 'http://127.0.0.1:5173', SESSION_COOKIE_SECURE: 'false', CSRF_SECRET: randomBytes(32).toString('hex'),
      CONNECTION_SECRET_KEY: randomBytes(32).toString('hex'), EMAIL_DELIVERY: 'disabled' };
    const app = Fastify({ logger: false });
    await app.register(cookie); app.setErrorHandler(sendProblem); await registerConnections(app, pool, config); await registerReservations(app, pool, config);
    const fixtures: Fixture[] = [];
    try {
      const role = (await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
      assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
      const first = await fixture(pool, config); fixtures.push(first);
      const second = await fixture(pool, config); fixtures.push(second);
      const base = `/api/v1/organizations/${first.organizationId}`;
      const url = `https://calendar.example.com/feed.ics?key=synthetic-private-${randomUUID()}`;
      const headers = { cookie: first.cookie, 'x-csrf-token': first.csrf, 'idempotency-key': randomUUID() };
      let connectionId = '';
      await t.test('create is idempotent, performs no network and never exposes the saved URL', async () => {
        const input = { service_code: 'INT-ICAL', display_name: 'Synthetic iCal', unit_id: first.unitId, feed_url: url };
        const created = await app.inject({ method: 'POST', url: base + '/connections/ical', headers, payload: input });
        assert.equal(created.statusCode, 200, created.body); connectionId = created.json().id;
        assert.equal(created.json().status, 'verification_pending'); assert.equal(created.json().has_secret, true); assert.ok(!created.body.includes('synthetic-private'));
        const repeat = await app.inject({ method: 'POST', url: base + '/connections/ical', headers, payload: input });
        assert.equal(repeat.statusCode, 200); assert.equal(repeat.json().id, connectionId);
        for (const suffix of ['/connections', '/connections/ical', `/connections/${connectionId}`]) {
          const read = await app.inject({ method: 'GET', url: base + suffix, headers: { cookie: first.cookie } });
          assert.equal(read.statusCode, 200); assert.ok(!read.body.includes('synthetic-private')); assert.ok(!read.body.includes('secret_ciphertext'));
        }
        await withTenant(pool, first.organizationId, first.userId, async tx => {
          const row = (await tx.query('SELECT secret_ciphertext,secret_ref FROM connections WHERE id=$1', [connectionId])).rows[0];
          assert.equal(decryptConnectionFeed(row.secret_ciphertext, config, first.organizationId, connectionId), url);
          assert.ok(!row.secret_ciphertext.includes('synthetic-private')); assert.equal(row.secret_ref, null);
          const audit = (await tx.query('SELECT safe_diff::text FROM audit_events WHERE resource_id=$1', [connectionId])).rows;
          assert.ok(!JSON.stringify(audit).includes('synthetic-private'));
          const replay = (await tx.query('SELECT response_body::text FROM idempotency_records WHERE organization_id=$1', [first.organizationId])).rows;
          assert.ok(!JSON.stringify(replay).includes('synthetic-private'));
        });
      });
      await t.test('cross-tenant access, foreign mapping, CSRF and unsafe literal addresses are rejected', async () => {
        assert.equal((await app.inject({ method: 'GET', url: `${base}/connections/${connectionId}`, headers: { cookie: second.cookie } })).statusCode, 404);
        const bad = { display_name: 'Bad', unit_id: first.unitId, feed_url: 'https://127.0.0.1/feed' };
        assert.equal((await app.inject({ method: 'POST', url: base + '/connections/ical', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: bad })).statusCode, 422);
        assert.equal((await app.inject({ method: 'POST', url: base + '/connections/ical', headers: { cookie: first.cookie, 'idempotency-key': randomUUID() }, payload: { ...bad, feed_url: url } })).statusCode, 403);
        assert.equal((await app.inject({ method: 'POST', url: base + '/connections/ical', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { ...bad, feed_url: url, unit_id: second.unitId } })).statusCode, 404);
        await withTenant(pool, second.organizationId, second.userId, async tx => assert.equal((await tx.query('SELECT id FROM connections WHERE id=$1', [connectionId])).rowCount, 0));
        assert.equal((await pool.query('SELECT id FROM connections WHERE id=$1', [connectionId])).rowCount, 0, 'RLS requires tenant context');
      });
      await t.test('runtime scanner returns due routing IDs under FORCE RLS without granting direct cross-tenant reads', async () => {
        const scanned = await pool.query('SELECT * FROM public.pending_ical_connections($1)', [20]);
        assert.ok(scanned.rows.some(row => row.connection_id === connectionId), 'worker must discover due connections without a tenant context');
        assert.deepEqual(Object.keys(scanned.rows[0]!).sort(), ['actor_id', 'connection_id', 'organization_id']);
        const guard = await pool.connect();
        try {
          await guard.query('BEGIN');
          const owner = (await guard.query("SELECT current_user=pg_get_userbyid(proowner) AS is_function_owner FROM pg_proc WHERE oid='public.pending_ical_connections(integer)'::regprocedure")).rows[0];
          assert.equal(owner.is_function_owner, false, 'the runtime role must not own the privileged scanner');
          assert.equal((await guard.query('SELECT id FROM connections WHERE id=$1', [connectionId])).rowCount, 0, 'runtime connections queries stay tenant scoped');
          await guard.query('ROLLBACK');
          assert.equal((await guard.query('SELECT id FROM connections WHERE id=$1', [connectionId])).rowCount, 0, 'the function must not leave a tenant bypass on the pooled connection');
        } finally { await guard.query('ROLLBACK'); guard.release(); }
      });
      await t.test('Avito remains access_required; registry does not advertise working partner APIs', async () => {
        const created = await app.inject({ method: 'POST', url: base + '/connections', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { service_code: 'INT-AVITO', display_name: 'Synthetic pending Avito', unit_id: first.unitId } });
        assert.equal(created.statusCode, 200); assert.equal(created.json().status, 'access_required'); assert.equal(created.json().has_secret, false);
        const registry = await app.inject({ method: 'GET', url: base + '/connections/capabilities', headers: { cookie: first.cookie } });
        assert.equal(registry.statusCode, 200); assert.equal(registry.json().items.length, 75);
        assert.equal(registry.json().items.find((entry: { id: string }) => entry.id === 'INT-AVITO').capabilities.reservationImport, false);
      });
      const identity = { organizationId: first.organizationId, connectionId, actorId: first.userId };
      const start = addDays(new Date().toISOString().slice(0, 10), 60), end = addDays(start, 2), movedStart = addDays(start, 5), movedEnd = addDays(start, 7);
      const blockId = randomUUID();
      const vevent = (from: string, to: string, sequence = 1) => `BEGIN:VEVENT\r\nUID:synthetic-stable-event\r\nSEQUENCE:${sequence}\r\nDTSTART;VALUE=DATE:${from.replaceAll('-', '')}\r\nDTEND;VALUE=DATE:${to.replaceAll('-', '')}\r\nEND:VEVENT\r\n`;
      const feed = (events: string): FeedFetchResult => ({ status: 'ok', text: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}END:VCALENDAR\r\n`, etag: '"synthetic-version"', lastModified: null, fetchedAt: new Date().toISOString() });
      const due = () => withTenant(pool, first.organizationId, first.userId, tx => tx.query('UPDATE connections SET next_poll_at=now()-interval \'1 second\' WHERE id=$1', [connectionId]));
      await t.test('two identical UID entries and repeated polls allocate exactly once', async () => {
        const result = await pollIcalConnection(pool, config, identity, { fetcher: async () => feed(vevent(start, end) + vevent(start, end)) });
        assert.equal(result.status, 'healthy'); assert.equal(result.applied, 1);
        await due(); const repeat = await pollIcalConnection(pool, config, identity, { fetcher: async () => feed(vevent(start, end)) });
        assert.equal(repeat.applied, 0);
        await withTenant(pool, first.organizationId, first.userId, async tx => assert.equal((await tx.query(`SELECT id FROM availability_allocations WHERE unit_id=$1 AND kind='block' AND state='active'`, [first.unitId])).rowCount, 1));
      });
      await t.test('overlap preserves previous allocation and external fact, then reconciles after conflict clears', async () => {
        await withTenant(pool, first.organizationId, first.userId, tx => tx.query(`INSERT INTO availability_allocations(id,organization_id,unit_id,kind,checkin,checkout) VALUES($1,$2,$3,'block',$4,$5)`, [blockId, first.organizationId, first.unitId, movedStart, movedEnd]));
        await due(); const result = await pollIcalConnection(pool, config, identity, { fetcher: async () => feed(vevent(movedStart, movedEnd, 2)) });
        assert.equal(result.status, 'conflict'); assert.equal(result.applied, 0);
        const conflicts = await app.inject({ method: 'GET', url: base + '/sync-conflicts', headers: { cookie: first.cookie } });
        assert.equal(conflicts.statusCode, 200); assert.equal(conflicts.json().items[0].kind, 'ICAL_OCCUPANCY_OVERLAP'); assert.ok(!conflicts.body.includes('synthetic-private'));
        await withTenant(pool, first.organizationId, first.userId, async tx => {
          const row = (await tx.query(`SELECT io.from_date::text,a.checkin::text FROM ical_occupancies io JOIN availability_allocations a ON a.id=io.allocation_id AND a.organization_id=io.organization_id WHERE io.connection_id=$1`, [connectionId])).rows[0];
          assert.equal(row.from_date, movedStart); assert.equal(row.checkin, start);
          await tx.query(`UPDATE availability_allocations SET state='released' WHERE id=$1`, [blockId]);
        });
        await due(); const recovered = await pollIcalConnection(pool, config, identity, { fetcher: async () => ({ status: 'not_modified', fetchedAt: new Date().toISOString() }) });
        assert.equal(recovered.status, 'healthy'); assert.equal(recovered.applied, 1);
      });
      await t.test('partial external overlap closes the full interval to new sales and appears in availability until cancellation', async () => {
        const partial = await fixture(pool, config); fixtures.push(partial);
        const partialBase = `/api/v1/organizations/${partial.organizationId}`;
        const writeHeaders = () => ({ cookie: partial.cookie, 'x-csrf-token': partial.csrf, 'idempotency-key': randomUUID() });
        const from = addDays(start, 100), to = addDays(from, 10), localFrom = addDays(from, 3), localTo = addDays(from, 4);
        const inputFor = (checkin: string, checkout: string) => ({ unit_id: partial.unitId, checkin, checkout, adults: 1, children: 0, source: 'direct' });
        const quoteFor = async (checkin: string, checkout: string) => {
          const response = await app.inject({ method: 'POST', url: partialBase + '/quotes', headers: writeHeaders(), payload: inputFor(checkin, checkout) });
          assert.equal(response.statusCode, 200, response.body); return response.json().id as string;
        };
        const book = (checkin: string, checkout: string, quote_id: string) => app.inject({ method: 'POST', url: partialBase + '/reservations', headers: writeHeaders(), payload: { ...inputFor(checkin, checkout), quote_id, status: 'confirmed', guest_name: 'Synthetic interval guest' } });
        const local = await book(localFrom, localTo, await quoteFor(localFrom, localTo));
        assert.equal(local.statusCode, 200, local.body);
        const created = await app.inject({ method: 'POST', url: partialBase + '/connections/ical', headers: writeHeaders(), payload: { unit_id: partial.unitId, display_name: 'Synthetic partial overlap', feed_url: url } });
        assert.equal(created.statusCode, 200, created.body);
        const partialId = created.json().id as string, partialIdentity = { organizationId: partial.organizationId, connectionId: partialId, actorId: partial.userId };
        const observed = await pollIcalConnection(pool, config, partialIdentity, { fetcher: async () => feed(vevent(from, to)) });
        assert.equal(observed.status, 'conflict');
        const calendar = await app.inject({ method: 'GET', url: `${partialBase}/calendar?from=${from}&to=${to}`, headers: { cookie: partial.cookie } });
        assert.equal(calendar.statusCode, 200, calendar.body);
        assert.ok(calendar.json().blocks.some((block: { external_conflict?: boolean; from: string; to: string }) => block.external_conflict && block.from === from && block.to === to));
        const availability = await app.inject({ method: 'GET', url: partialBase + '/availability-blocks', headers: { cookie: partial.cookie } });
        assert.equal(availability.statusCode, 200, availability.body);
        assert.ok(availability.json().items.some((block: { external_conflict?: boolean }) => block.external_conflict));
        const freeFrom = addDays(from, 6), freeTo = addDays(from, 7), deniedQuote = await quoteFor(freeFrom, freeTo);
        const denied = await book(freeFrom, freeTo, deniedQuote);
        assert.equal(denied.statusCode, 409, denied.body); assert.equal(denied.json().code, 'AVAILABILITY_CONFLICT');
        await withTenant(pool, partial.organizationId, partial.userId, async tx => {
          const saved = (await tx.query('SELECT status FROM reservations WHERE id=$1', [local.json().id])).rows[0];
          assert.equal(saved.status, 'confirmed');
          assert.equal((await tx.query("SELECT id FROM availability_allocations WHERE reservation_id=$1 AND state='active' AND checkin=$2 AND checkout=$3", [local.json().id, localFrom, localTo])).rowCount, 1);
          assert.equal((await tx.query('SELECT id FROM reservations WHERE organization_id=$1', [partial.organizationId])).rowCount, 1, 'rejected sale has no partial reservation');
        });
        const afterEnd = await book(to, addDays(to, 1), await quoteFor(to, addDays(to, 1)));
        assert.equal(afterEnd.statusCode, 200, afterEnd.body);
        await withTenant(pool, partial.organizationId, partial.userId, tx => tx.query("UPDATE connections SET next_poll_at=now()-interval '1 second' WHERE id=$1", [partialId]));
        const cancelled = await pollIcalConnection(pool, config, partialIdentity, { fetcher: async () => feed('BEGIN:VEVENT\r\nUID:synthetic-stable-event\r\nSEQUENCE:2\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\n') });
        assert.equal(cancelled.status, 'healthy');
        const released = await book(freeFrom, freeTo, deniedQuote);
        assert.equal(released.statusCode, 200, released.body);
      });
      await t.test('network failure does not release dates; disappearance forces two complete bodies', async () => {
        await due(); assert.equal((await pollIcalConnection(pool, config, identity, { fetcher: async () => feed('') })).applied, 0);
        await due(); const failed = await pollIcalConnection(pool, config, identity, { fetcher: async () => { throw new ConnectorError('FEED_NETWORK_ERROR', true); } });
        assert.equal(failed.status, 'degraded');
        await withTenant(pool, first.organizationId, first.userId, async tx => assert.equal((await tx.query(`SELECT id FROM availability_allocations WHERE unit_id=$1 AND state='active'`, [first.unitId])).rowCount, 1));
        await due(); const removed = await pollIcalConnection(pool, config, identity, { fetcher: async (_, options) => { assert.equal(options?.etag, undefined); return feed(''); } });
        assert.equal(removed.applied, 1);
        await withTenant(pool, first.organizationId, first.userId, async tx => assert.equal((await tx.query(`SELECT id FROM availability_allocations WHERE unit_id=$1 AND state='active'`, [first.unitId])).rowCount, 0));
      });
      await t.test('live lease excludes another worker and expired old result cannot overwrite a new poll', async () => {
        await due(); let startFetch!: () => void; let finishFetch!: () => void;
        const started = new Promise<void>(resolve => { startFetch = resolve; });
        const finish = new Promise<void>(resolve => { finishFetch = resolve; });
        const oldPoll = pollIcalConnection(pool, config, identity, { fetcher: async () => { startFetch(); await finish; return feed(vevent(start, end, 5)); } });
        await started;
        try {
          const busy = await pollIcalConnection(pool, config, identity, { fetcher: async () => { throw Error('a live lease must prevent fetch'); } });
          assert.equal(busy.status, 'skipped');
          await withTenant(pool, first.organizationId, first.userId, tx => tx.query(`UPDATE connections SET poll_lease_until=now()-interval '1 second',next_poll_at=now()-interval '1 second' WHERE id=$1`, [connectionId]));
          assert.equal((await pollIcalConnection(pool, config, identity, { fetcher: async () => feed('') })).status, 'healthy');
        } finally { finishFetch(); }
        assert.equal((await oldPoll).status, 'stale');
        await withTenant(pool, first.organizationId, first.userId, async tx => assert.equal((await tx.query(`SELECT id FROM availability_allocations WHERE unit_id=$1 AND state='active'`, [first.unitId])).rowCount, 0));
      });
      await t.test('cancellation of an already started stay raises conflict and preserves occupied dates', async () => {
        const today = new Date().toISOString().slice(0, 10), tomorrow = addDays(today, 2);
        await due(); assert.equal((await pollIcalConnection(pool, config, identity, { fetcher: async () => feed(vevent(today, tomorrow, 10)) })).applied, 1);
        await due(); const cancelled = await pollIcalConnection(pool, config, identity, { fetcher: async () => feed('BEGIN:VEVENT\r\nUID:synthetic-stable-event\r\nSEQUENCE:11\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\n') });
        assert.equal(cancelled.status, 'conflict'); assert.equal(cancelled.applied, 0);
        await withTenant(pool, first.organizationId, first.userId, async tx => {
          assert.equal((await tx.query(`SELECT id FROM availability_allocations WHERE unit_id=$1 AND state='active'`, [first.unitId])).rowCount, 1);
          assert.equal((await tx.query(`SELECT id FROM sync_conflicts WHERE connection_id=$1 AND kind='ICAL_LATE_CANCELLATION' AND state='open'`, [connectionId])).rowCount, 1);
        });
      });
    } finally {
      await app.close();
      try { for (const value of fixtures.reverse()) await cleanup(pool, value); }
      finally { await pool.end(); }
    }
  });
}
