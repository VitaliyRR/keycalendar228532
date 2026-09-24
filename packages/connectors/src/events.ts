import { createHash } from 'node:crypto';
import { ConnectorError, invariant } from './errors.js';

export interface EventScope { tenantId: string; connectionId: string }
export interface ConnectorEvent<T = Record<string, unknown>> extends EventScope {
  eventId: string; type: string; schemaVersion: number; aggregateType: string; aggregateId: string;
  aggregateVersion: number | null; providerUpdatedAt: string | null; occurredAt: string;
  correlationId: string; verified: boolean; snapshot: boolean; data: T;
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { invariant(Number.isFinite(value), 'NON_JSON_EVENT_DATA'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  invariant(typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'NON_JSON_EVENT_DATA');
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
}
export function semanticHash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function eventIdempotencyKey(event: Pick<ConnectorEvent, 'tenantId' | 'connectionId' | 'eventId'>): string {
  return semanticHash([event.tenantId, event.connectionId, event.eventId]);
}
export function outboxIdempotencyKey(command: Pick<OutboxCommand, 'tenantId' | 'connectionId' | 'entityId' | 'operation' | 'desiredVersion' | 'range'>): string {
  return semanticHash([command.tenantId, command.connectionId, command.entityId, command.operation, command.desiredVersion, command.range ?? null]);
}
export type InboxStatus = 'applied' | 'stale' | 'quarantined' | 'conflict' | 'reconciliation_required';
export interface InboxReceipt { key: string; payloadHash: string; status: InboxStatus; code: string; processedAt: string }
export interface AggregateCursor { version: number | null; providerUpdatedAt: string | null; payloadHash: string }
export interface ConnectorConflict { code: string; eventKey: string; aggregateId: string; correlationId: string }
export interface InboxTransaction {
  getReceipt(key: string): Promise<InboxReceipt | null>;
  putReceipt(receipt: InboxReceipt): Promise<void>;
  getCursor(): Promise<AggregateCursor | null>;
  putCursor(cursor: AggregateCursor): Promise<void>;
  recordConflict(conflict: ConnectorConflict): Promise<void>;
}
export interface InboxStore<Tx extends InboxTransaction = InboxTransaction> {
  /** SERIALIZABLE/row lock plus unique(tenant,connection,event_key). Callback changes commit/rollback atomically. */
  transaction<T>(scope: EventScope & { aggregateType: string; aggregateId: string }, work: (tx: Tx) => Promise<T>): Promise<T>;
}
export type InboxApply<Tx, Data> = (tx: Tx, event: ConnectorEvent<Data>) => Promise<{ kind: 'applied' } | { kind: 'conflict'; code: string }>;
export interface InboxResult { status: InboxStatus | 'duplicate'; code: string; key: string }
function validateEvent(event: ConnectorEvent<unknown>): void {
  for (const value of [event.tenantId, event.connectionId, event.eventId, event.aggregateId, event.aggregateType, event.type, event.correlationId]) invariant(typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value), 'INVALID_EVENT_IDENTITY');
  invariant(Number.isInteger(event.schemaVersion) && event.schemaVersion > 0, 'INVALID_EVENT_SCHEMA');
  invariant(event.aggregateVersion === null || (Number.isSafeInteger(event.aggregateVersion) && event.aggregateVersion >= 0), 'INVALID_EVENT_VERSION');
  for (const value of [event.occurredAt, event.providerUpdatedAt].filter(v => v !== null)) invariant(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value)), 'INVALID_EVENT_TIME');
}
/** No external calls in apply: domain fact, allocation/conflict and resulting outbox belong in this same DB transaction. */
export async function processInboxEvent<Tx extends InboxTransaction, Data>(store: InboxStore<Tx>, event: ConnectorEvent<Data>, apply: InboxApply<Tx, Data>, now = new Date()): Promise<InboxResult> {
  validateEvent(event);
  const key = eventIdempotencyKey(event);
  const payloadHash = semanticHash({ type: event.type, schemaVersion: event.schemaVersion, aggregateType: event.aggregateType, aggregateId: event.aggregateId, version: event.aggregateVersion, updatedAt: event.providerUpdatedAt, data: event.data });
  return store.transaction({ tenantId: event.tenantId, connectionId: event.connectionId, aggregateType: event.aggregateType, aggregateId: event.aggregateId }, async tx => {
    const receipt = await tx.getReceipt(key);
    const conflict = async (code: string) => tx.recordConflict({ code, eventKey: key, aggregateId: event.aggregateId, correlationId: event.correlationId });
    if (receipt) {
      if (receipt.payloadHash !== payloadHash) { await conflict('EVENT_ID_REUSED'); return { status: 'conflict', code: 'EVENT_ID_REUSED', key }; }
      return { status: 'duplicate', code: receipt.code, key };
    }
    const finish = async (status: InboxStatus, code: string): Promise<InboxResult> => {
      await tx.putReceipt({ key, payloadHash, status, code, processedAt: now.toISOString() });
      return { status, code, key };
    };
    if (!event.verified) return finish('quarantined', 'UNVERIFIED_EVENT');
    if (event.schemaVersion !== 1) return finish('quarantined', 'UNSUPPORTED_EVENT_SCHEMA');
    const current = await tx.getCursor();
    if (!current && !event.snapshot && event.aggregateVersion !== 1) return finish('reconciliation_required', 'INITIAL_SNAPSHOT_REQUIRED');
    if (current) {
      if (event.aggregateVersion !== null && current.version !== null) {
        if (event.aggregateVersion < current.version) return finish('stale', 'OLDER_PROVIDER_VERSION');
        if (event.aggregateVersion === current.version) {
          if (current.payloadHash === payloadHash) return finish('stale', 'VERSION_ALREADY_APPLIED');
          await conflict('SAME_VERSION_CHANGED'); return finish('conflict', 'SAME_VERSION_CHANGED');
        }
        if (!event.snapshot && event.aggregateVersion > current.version + 1) return finish('reconciliation_required', 'EVENT_VERSION_GAP');
      } else if (event.providerUpdatedAt && current.providerUpdatedAt) {
        const delta = Date.parse(event.providerUpdatedAt) - Date.parse(current.providerUpdatedAt);
        if (delta < 0) return finish('stale', 'OLDER_PROVIDER_TIMESTAMP');
        if (delta === 0 && current.payloadHash !== payloadHash) { await conflict('SAME_TIMESTAMP_CHANGED'); return finish('conflict', 'SAME_TIMESTAMP_CHANGED'); }
        if (delta === 0) return finish('stale', 'SNAPSHOT_ALREADY_APPLIED');
        if (!event.snapshot) return finish('reconciliation_required', 'AUTHORITATIVE_SNAPSHOT_REQUIRED');
      } else if (current.payloadHash === payloadHash) return finish('stale', 'CONTENT_ALREADY_APPLIED');
      else return finish('reconciliation_required', 'PROVIDER_ORDER_UNKNOWN');
    }
    const result = await apply(tx, event);
    await tx.putCursor({ version: event.aggregateVersion, providerUpdatedAt: event.providerUpdatedAt, payloadHash });
    if (result.kind === 'conflict') { await conflict(result.code); return finish('conflict', result.code); }
    return finish('applied', 'APPLIED');
  });
}

export type AuthorityField = 'externalBookingStatus' | 'contractedPrice' | 'commission' | 'availability' | 'rates' | 'restrictions' | 'payment' | 'managerNote' | 'guestContact';
export type AuthorityActor = 'channel' | 'keycalendar' | 'payment_provider' | 'manual';
export const AUTHORITY_MATRIX: Readonly<Record<AuthorityField, { owner: AuthorityActor | 'provenance'; rule: string }>> = Object.freeze({
  externalBookingStatus: { owner: 'channel', rule: 'Preserve verified external fact; cancellation after check-in becomes a conflict.' },
  contractedPrice: { owner: 'channel', rule: 'Accepted OTA quote is immutable; local adjustment is separate.' },
  commission: { owner: 'channel', rule: 'Preserve commission and reconcile against provider statement.' },
  availability: { owner: 'keycalendar', rule: 'Only mapped inventory after writer cutover; protect allocation transactionally.' },
  rates: { owner: 'keycalendar', rule: 'Only mapped writable capability after writer cutover.' },
  restrictions: { owner: 'keycalendar', rule: 'No silent approximation of unsupported restrictions.' },
  payment: { owner: 'payment_provider', rule: 'Verify final provider state; redirect never proves payment.' },
  managerNote: { owner: 'keycalendar', rule: 'Inbound events never overwrite local note.' },
  guestContact: { owner: 'provenance', rule: 'Keep field provenance; masked or empty values cannot erase known contacts.' },
});
export function authorizeFieldUpdate(field: AuthorityField, actor: AuthorityActor, options: { writerCutover?: boolean; mappedWritable?: boolean; emptyOrMasked?: boolean; currentOwner?: AuthorityActor } = {}): 'allow' | 'ignore' | 'conflict' {
  if (field === 'guestContact') {
    if (options.emptyOrMasked) return 'ignore';
    return !options.currentOwner || options.currentOwner === actor || actor === 'manual' ? 'allow' : 'conflict';
  }
  if (AUTHORITY_MATRIX[field].owner !== actor) return 'conflict';
  if (['availability', 'rates', 'restrictions'].includes(field) && !(options.writerCutover && options.mappedWritable)) return 'conflict';
  return 'allow';
}

export interface OutboxCommand extends EventScope {
  id: string; entityId: string; operation: string; desiredVersion: number; range?: { from: string; to: string };
  correlationId: string; attempts: number; payload: Record<string, unknown>;
  effect: 'snapshot' | 'non_idempotent'; uncertain: boolean;
}
export type DeliveryResult =
  | { kind: 'acknowledged'; providerReference?: string }
  | { kind: 'http_error'; status: number; retryAfterMs?: number }
  | { kind: 'unknown' }
  | { kind: 'not_applied' };
export interface OutboundAdapter {
  /** May be true only if the provider contract guarantees the supplied idempotency key. */
  supportsIdempotency: boolean;
  send(command: OutboxCommand, idempotencyKey: string): Promise<DeliveryResult>;
  reconcile?(command: OutboxCommand, idempotencyKey: string): Promise<DeliveryResult>;
}
export type OutboxDisposition =
  | { state: 'acknowledged' | 'superseded' | 'dead_letter' | 'reauth_required' | 'conflict' | 'reconciliation_required'; code: string }
  | { state: 'retry'; code: string; nextAttemptAt: string };
export interface OutboxLease { command: OutboxCommand; leaseToken: string; desiredVersion: number }
export interface OutboxStore {
  /** Atomically claim due work; fence by lease token and serialize (connection,entity,operation). */
  claim(scope: EventScope, commandId: string, now: Date): Promise<OutboxLease | null>;
  /** Fenced durable marker BEFORE network call: expired started leases must reappear with uncertain=true. */
  markAttemptStarted(lease: OutboxLease, idempotencyKey: string, now: Date): Promise<void>;
  finish(lease: OutboxLease, disposition: OutboxDisposition, now: Date): Promise<void>;
}
export function retryDelayMs(attempt: number, random = Math.random, retryAfterMs = 0): number | null {
  invariant(Number.isInteger(attempt) && attempt >= 0 && Number.isFinite(retryAfterMs) && retryAfterMs >= 0, 'INVALID_RETRY_POLICY');
  const schedule = [5_000, 30_000, 120_000, 600_000, 1_800_000, 7_200_000];
  const base = schedule[attempt]; if (base === undefined) return null;
  const sample = random(); invariant(sample >= 0 && sample <= 1, 'INVALID_RANDOM_SOURCE');
  return Math.max(Math.round(base * (0.8 + sample * 0.4)), retryAfterMs);
}
export function classifyDelivery(result: DeliveryResult, command: OutboxCommand, now: Date, random = Math.random): OutboxDisposition {
  if (result.kind === 'acknowledged') return { state: 'acknowledged', code: 'ACKNOWLEDGED' };
  if (result.kind === 'unknown') return { state: 'reconciliation_required', code: 'DELIVERY_RESULT_UNKNOWN' };
  if (result.kind === 'not_applied') return { state: 'reconciliation_required', code: 'PROVIDER_NOT_APPLIED' };
  if (result.status === 401 || result.status === 403) return { state: 'reauth_required', code: 'PROVIDER_AUTH_REQUIRED' };
  if (result.status === 409) return { state: 'conflict', code: 'PROVIDER_VERSION_CONFLICT' };
  if (result.status === 429 || result.status >= 500) {
    const delay = retryDelayMs(command.attempts, random, result.retryAfterMs ?? 0);
    return delay === null ? { state: 'dead_letter', code: 'RETRY_EXHAUSTED' } : { state: 'retry', code: 'TRANSIENT_PROVIDER_ERROR', nextAttemptAt: new Date(now.getTime() + delay).toISOString() };
  }
  return { state: 'dead_letter', code: 'PROVIDER_VALIDATION_FAILED' };
}
export async function dispatchOutbox(store: OutboxStore, scope: EventScope, commandId: string, adapter: OutboundAdapter, now = new Date(), random = Math.random): Promise<OutboxDisposition | null> {
  const lease = await store.claim(scope, commandId, now); if (!lease) return null;
  const command = lease.command;
  invariant(command.tenantId === scope.tenantId && command.connectionId === scope.connectionId && command.id === commandId, 'OUTBOX_SCOPE_MISMATCH');
  invariant(Number.isSafeInteger(command.desiredVersion) && command.desiredVersion >= 0, 'INVALID_DESIRED_VERSION');
  invariant(Number.isSafeInteger(command.attempts) && command.attempts >= 0, 'INVALID_ATTEMPT_COUNT');
  invariant(Number.isSafeInteger(lease.desiredVersion) && lease.desiredVersion >= command.desiredVersion, 'INVALID_OUTBOX_HEAD_VERSION');
  const key = outboxIdempotencyKey(command);
  if (command.effect === 'snapshot' && command.desiredVersion < lease.desiredVersion) {
    const disposition = { state: 'superseded', code: 'NEWER_SNAPSHOT_EXISTS' } as const;
    await store.finish(lease, disposition, now); return disposition;
  }
  await store.markAttemptStarted(lease, key, now);
  let result: DeliveryResult;
  try {
    if (command.uncertain) {
      if (adapter.reconcile) {
        result = await adapter.reconcile(command, key);
        if (result.kind === 'not_applied') result = await adapter.send(command, key);
      } else if (adapter.supportsIdempotency) result = await adapter.send(command, key);
      else result = { kind: 'unknown' };
    } else result = await adapter.send(command, key);
  } catch { result = { kind: 'unknown' }; }
  // A 5xx may occur after a financial side effect. Reconcile instead of retrying such writes blindly.
  if (command.effect === 'non_idempotent' && !adapter.supportsIdempotency && result.kind === 'http_error' && result.status >= 500) result = { kind: 'unknown' };
  const disposition = classifyDelivery(result, command, now, random);
  await store.finish(lease, disposition, now);
  return disposition;
}
/** Minimal redacted diagnostic metadata; does not expose external IDs, payloads or feed URLs. */
export function connectorLogContext(event: Pick<ConnectorEvent, 'tenantId' | 'connectionId' | 'eventId' | 'correlationId'>): Record<string, string> {
  return { tenantRef: semanticHash(event.tenantId).slice(0, 16), connectionRef: semanticHash(event.connectionId).slice(0, 16), eventRef: eventIdempotencyKey(event), correlationId: event.correlationId };
}
export function assertAdapterAvailable(available: boolean): void { if (!available) throw new ConnectorError('PARTNER_ACCESS_PENDING'); }
