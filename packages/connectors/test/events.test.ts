import test from 'node:test';
import assert from 'node:assert/strict';
import { processInboxEvent, dispatchOutbox, eventIdempotencyKey, outboxIdempotencyKey, classifyDelivery, authorizeFieldUpdate, getConnector, CONNECTOR_REGISTRY, requireConnectorCapability, type ConnectorEvent, type InboxStore, type InboxTransaction, type InboxReceipt, type AggregateCursor, type ConnectorConflict, type EventScope, type OutboxCommand, type OutboxStore, type OutboxDisposition } from '../src/index.js';

interface Tx extends InboxTransaction { effects: string[] }
/** Test fixture only: transaction clone proves processor commits effects and receipt together. */
class MemoryInbox implements InboxStore<Tx> {
  receipts = new Map<string, InboxReceipt>(); cursors = new Map<string, AggregateCursor>(); conflicts: ConnectorConflict[] = []; effects: string[] = [];
  private tail: Promise<void> = Promise.resolve();
  async transaction<T>(scope: EventScope & { aggregateType: string; aggregateId: string }, work: (tx: Tx) => Promise<T>): Promise<T> {
    const waiting = this.tail; let release!: () => void; this.tail = new Promise(resolve => { release = resolve; }); await waiting;
    const receipts = structuredClone(this.receipts), cursors = structuredClone(this.cursors), conflicts = structuredClone(this.conflicts), effects = [...this.effects];
    const key = JSON.stringify(scope);
    try {
      const result = await work({ effects,
        getReceipt: async key => receipts.get(key) ?? null,
        putReceipt: async receipt => { assert.ok(!receipts.has(receipt.key)); receipts.set(receipt.key, receipt); },
        getCursor: async () => cursors.get(key) ?? null,
        putCursor: async cursor => { cursors.set(key, cursor); },
        recordConflict: async conflict => { conflicts.push(conflict); },
      });
      this.receipts = receipts; this.cursors = cursors; this.conflicts = conflicts; this.effects = effects; return result;
    } finally { release(); }
  }
}
const event = (changes: Partial<ConnectorEvent> = {}): ConnectorEvent => ({
  tenantId: 'tenant-a', connectionId: 'connection-a', eventId: 'event-a', type: 'reservation.confirmed.v1', schemaVersion: 1,
  aggregateType: 'reservation', aggregateId: 'external-a', aggregateVersion: 1, providerUpdatedAt: '2026-09-24T00:00:00Z',
  occurredAt: '2026-09-24T00:00:00Z', correlationId: 'correlation-a', verified: true, snapshot: true, data: { from: '2026-10-10', to: '2026-10-12' }, ...changes,
});
const apply = async (tx: Tx, input: ConnectorEvent) => { tx.effects.push(input.tenantId + ':' + input.eventId); return { kind: 'applied' as const }; };

test('concurrent duplicate deliveries produce one transactional business effect; tenant identities differ', async () => {
  const store = new MemoryInbox();
  const results = await Promise.all(Array.from({ length: 20 }, () => processInboxEvent(store, event(), apply)));
  assert.equal(results.filter(r => r.status === 'applied').length, 1); assert.equal(store.effects.length, 1);
  await processInboxEvent(store, event({ tenantId: 'tenant-b' }), apply);
  assert.equal(store.effects.length, 2); assert.notEqual(eventIdempotencyKey(event()), eventIdempotencyKey(event({ tenantId: 'tenant-b' })));
});
test('domain failure rolls back receipt/cursor/effect so retry can succeed', async () => {
  const store = new MemoryInbox();
  await assert.rejects(processInboxEvent(store, event(), async tx => { tx.effects.push('rollback'); throw Error('synthetic failure'); }));
  assert.equal(store.effects.length, 0); assert.equal(store.receipts.size, 0);
  assert.equal((await processInboxEvent(store, event(), apply)).status, 'applied');
});
test('same event ID with another entity or payload becomes conflict instead of overwrite', async () => {
  const store = new MemoryInbox(); await processInboxEvent(store, event(), apply);
  const result = await processInboxEvent(store, event({ aggregateId: 'external-b' }), apply);
  assert.equal(result.code, 'EVENT_ID_REUSED'); assert.equal(store.effects.length, 1);
});
test('old events are stale; gaps require snapshot; same-version mutations conflict', async () => {
  const store = new MemoryInbox(); await processInboxEvent(store, event({ aggregateVersion: 5 }), apply);
  assert.equal((await processInboxEvent(store, event({ eventId: 'old', aggregateVersion: 4 }), apply)).status, 'stale');
  assert.equal((await processInboxEvent(store, event({ eventId: 'gap', aggregateVersion: 7, snapshot: false }), apply)).code, 'EVENT_VERSION_GAP');
  assert.equal((await processInboxEvent(store, event({ eventId: 'changed', aggregateVersion: 5, data: { status: 'cancelled' } }), apply)).code, 'SAME_VERSION_CHANGED');
  assert.equal((await processInboxEvent(store, event({ eventId: 'current', aggregateVersion: 7, snapshot: true }), apply)).status, 'applied');
  assert.equal(store.effects.length, 2);
});
test('unknown schema/unverified event never reaches domain; missing order requires reconciliation', async () => {
  const store = new MemoryInbox();
  assert.equal((await processInboxEvent(store, event({ verified: false }), apply)).status, 'quarantined');
  assert.equal((await processInboxEvent(store, event({ eventId: 'major', schemaVersion: 2 }), apply)).status, 'quarantined');
  assert.equal(store.effects.length, 0);
  await processInboxEvent(store, event({ eventId: 'plain', aggregateVersion: null, providerUpdatedAt: null }), apply);
  assert.equal((await processInboxEvent(store, event({ eventId: 'no-order', aggregateVersion: null, providerUpdatedAt: null, data: { to: '2026-10-15' } }), apply)).status, 'reconciliation_required');
});
test('verified booking conflict is retained and advances source cursor without overwriting another booking', async () => {
  const store = new MemoryInbox();
  const result = await processInboxEvent(store, event(), async tx => { tx.effects.push('external-fact-retained'); return { kind: 'conflict', code: 'BOOKING_OVERLAP' }; });
  assert.equal(result.status, 'conflict'); assert.equal(store.conflicts[0]?.code, 'BOOKING_OVERLAP'); assert.equal(store.cursors.size, 1);
});
test('a first delta from the middle of provider history requires a full snapshot', async () => {
  const store = new MemoryInbox();
  const result = await processInboxEvent(store, event({ snapshot: false, aggregateVersion: 42 }), apply);
  assert.equal(result.code, 'INITIAL_SNAPSHOT_REQUIRED'); assert.equal(store.effects.length, 0); assert.equal(store.cursors.size, 0);
});

const command = (changes: Partial<OutboxCommand> = {}): OutboxCommand => ({ tenantId: 'tenant-a', connectionId: 'connection-a', id: 'out-a', entityId: 'unit-a', operation: 'availability.snapshot', desiredVersion: 2, correlationId: 'correlation-a', attempts: 0, payload: { available: 0 }, effect: 'snapshot', uncertain: false, ...changes });
function outbox(cmd = command(), desiredVersion = cmd.desiredVersion) {
  const calls: string[] = []; const results: OutboxDisposition[] = [];
  const store: OutboxStore = {
    claim: async () => ({ command: cmd, leaseToken: 'fencing-token', desiredVersion }),
    markAttemptStarted: async () => { calls.push('durable-start'); },
    finish: async (_, result) => { results.push(result); calls.push('durable-finish'); },
  };
  return { store, calls, results };
}
test('outbox persists attempt before network and suppresses obsolete availability snapshot', async () => {
  const a = outbox();
  await dispatchOutbox(a.store, command(), 'out-a', { supportsIdempotency: true, send: async () => { a.calls.push('send'); return { kind: 'acknowledged' }; } });
  assert.deepEqual(a.calls, ['durable-start', 'send', 'durable-finish']);
  const b = outbox(command(), 3);
  const result = await dispatchOutbox(b.store, command(), 'out-a', { supportsIdempotency: true, send: async () => { throw Error('must not call'); } });
  assert.equal(result?.state, 'superseded'); assert.deepEqual(b.calls, ['durable-finish']);
});
test('uncertain financial effects reconcile first and are never blindly repeated', async () => {
  const cmd = command({ uncertain: true, effect: 'non_idempotent', operation: 'refund' }); const a = outbox(cmd); let sends = 0;
  const result = await dispatchOutbox(a.store, cmd, cmd.id, { supportsIdempotency: false, send: async () => { sends++; return { kind: 'acknowledged' }; } });
  assert.equal(result?.state, 'reconciliation_required'); assert.equal(sends, 0);
  const b = outbox(cmd);
  await dispatchOutbox(b.store, cmd, cmd.id, { supportsIdempotency: false, reconcile: async () => ({ kind: 'acknowledged' }), send: async () => { sends++; return { kind: 'acknowledged' }; } });
  assert.equal(sends, 0); assert.equal(b.results[0]?.state, 'acknowledged');
  const c = outbox(command({ effect: 'non_idempotent' }));
  assert.equal((await dispatchOutbox(c.store, command(), 'out-a', { supportsIdempotency: false, send: async () => ({ kind: 'http_error', status: 503 }) }))?.state, 'reconciliation_required');
});
test('auth, conflict, retry-after, poison and exhausted attempts get distinct dispositions', () => {
  const now = new Date('2026-09-24T00:00:00Z');
  assert.equal(classifyDelivery({ kind: 'http_error', status: 401 }, command(), now).state, 'reauth_required');
  assert.equal(classifyDelivery({ kind: 'http_error', status: 409 }, command(), now).state, 'conflict');
  assert.equal(classifyDelivery({ kind: 'http_error', status: 422 }, command(), now).state, 'dead_letter');
  const limited = classifyDelivery({ kind: 'http_error', status: 429, retryAfterMs: 90_000 }, command(), now, () => 0);
  assert.deepEqual(limited, { state: 'retry', code: 'TRANSIENT_PROVIDER_ERROR', nextAttemptAt: '2026-09-24T00:01:30.000Z' });
  assert.equal(classifyDelivery({ kind: 'http_error', status: 503 }, command({ attempts: 6 }), now).state, 'dead_letter');
  assert.notEqual(outboxIdempotencyKey(command()), outboxIdempotencyKey(command({ tenantId: 'tenant-b' })));
});
test('capabilities distinguish working generic iCal from unapproved partner adapters and fiscal profiles', () => {
  assert.equal(CONNECTOR_REGISTRY.length, 75);
  assert.equal(requireConnectorCapability('INT-ICAL', 'occupancyImport').implementation, 'ical_available');
  assert.equal(getConnector('INT-KVARTIRKA-ICAL')?.capabilities.rateWrite, false);
  for (const id of ['INT-AVITO', 'INT-SUTOCHNO']) {
    assert.equal(getConnector(id)?.implementation, 'partner_access_pending');
    assert.throws(() => requireConnectorCapability(id, 'reservationImport'), /PARTNER_ACCESS_PENDING/);
  }
  assert.equal(CONNECTOR_REGISTRY.filter(x => x.implementation === 'fiscal_profile_pending').length, 15);
  assert.equal(CONNECTOR_REGISTRY.some(x => x.productionReady), false);
});
test('authority rejects wrong writer, premature cutover and masked guest overwrite', () => {
  assert.equal(authorizeFieldUpdate('managerNote', 'channel'), 'conflict');
  assert.equal(authorizeFieldUpdate('rates', 'keycalendar'), 'conflict');
  assert.equal(authorizeFieldUpdate('rates', 'keycalendar', { writerCutover: true, mappedWritable: true }), 'allow');
  assert.equal(authorizeFieldUpdate('guestContact', 'channel', { emptyOrMasked: true, currentOwner: 'manual' }), 'ignore');
  assert.equal(authorizeFieldUpdate('guestContact', 'channel', { currentOwner: 'manual' }), 'conflict');
});
