import { invariant } from './errors.js';
import { icalIdentity, type ConnectionScope, type IcalEvent, type IcalSnapshot } from './ical.js';

export type VersionOrder = 'newer' | 'older' | 'same' | 'unknown';
export function compareExternalVersions(incoming: { sequence: number | null; stamp: string | null }, current: { sequence: number | null; stamp: string | null }): VersionOrder {
  if (incoming.sequence !== null && current.sequence !== null) return incoming.sequence > current.sequence ? 'newer' : incoming.sequence < current.sequence ? 'older' : 'same';
  if (incoming.stamp && current.stamp) return incoming.stamp > current.stamp ? 'newer' : incoming.stamp < current.stamp ? 'older' : 'same';
  return 'unknown';
}
export interface IcalTrackedEvent { key: string; event: IcalEvent; active: boolean; missingSnapshots: number }
export interface IcalSyncState { scope: ConnectionScope; pollVersion: number; events: IcalTrackedEvent[] }
export interface IcalChange { kind: 'upsert' | 'remove'; key: string; event: IcalEvent; reason: 'snapshot' | 'explicit_cancel' | 'transparent' | 'missing_twice' }
export interface IcalConflict { key: string; kind: 'same_version_changed' | 'unknown_order'; current: IcalEvent; incoming: IcalEvent }
export interface IcalReconciliation { state: IcalSyncState; changes: IcalChange[]; conflicts: IcalConflict[]; ignoredStale: string[]; duplicatePoll: boolean }
/** Persist state, allocation changes, conflicts and resulting outbox together under a per-connection DB lock. */
export function reconcileIcalSnapshot(
  scope: ConnectionScope, previous: IcalSyncState | null, snapshot: IcalSnapshot,
  pollVersion: number, policy: { disappearanceSnapshots?: number; allowUnversionedUpdates?: boolean } = {},
): IcalReconciliation {
  invariant(snapshot.complete === true, 'INCOMPLETE_ICAL_SNAPSHOT');
  invariant(Number.isSafeInteger(pollVersion) && pollVersion > 0, 'INVALID_POLL_VERSION');
  if (previous) invariant(previous.scope.tenantId === scope.tenantId && previous.scope.connectionId === scope.connectionId && previous.scope.calendarId === scope.calendarId, 'ICAL_SCOPE_MISMATCH');
  const threshold = policy.disappearanceSnapshots ?? 2;
  invariant(Number.isSafeInteger(threshold) && threshold >= 2, 'UNSAFE_DISAPPEARANCE_POLICY');
  if (previous && pollVersion <= previous.pollVersion) return { state: structuredClone(previous), changes: [], conflicts: [], ignoredStale: [], duplicatePoll: true };
  const changes: IcalChange[] = [], conflicts: IcalConflict[] = [], ignoredStale: string[] = [];
  const records = new Map((previous?.events ?? []).map(row => [row.key, structuredClone(row)]));
  for (const row of records.values()) invariant(row.key === icalIdentity(scope, row.event.uid, row.event.recurrenceId), 'ICAL_STATE_IDENTITY_MISMATCH');
  const seen = new Set<string>();
  for (const event of snapshot.events) {
    const key = icalIdentity(scope, event.uid, event.recurrenceId);
    invariant(!seen.has(key), 'DUPLICATE_SNAPSHOT_EVENT'); seen.add(key);
    const current = records.get(key);
    if (current) {
      current.missingSnapshots = 0;
      const order = compareExternalVersions(event, current.event);
      if (order === 'older') { ignoredStale.push(key); continue; }
      if (event.fingerprint !== current.event.fingerprint && (order === 'same' || (order === 'unknown' && !policy.allowUnversionedUpdates))) {
        conflicts.push({ key, kind: order === 'same' ? 'same_version_changed' : 'unknown_order', current: current.event, incoming: event }); continue;
      }
      // A tombstone removed by two snapshots cannot be revived by an old unchanged replay.
      if (!current.active && event.status === 'busy' && order !== 'newer' && !policy.allowUnversionedUpdates) { ignoredStale.push(key); continue; }
    }
    const active = event.status === 'busy';
    if (active && (!current?.active || current.event.fingerprint !== event.fingerprint)) changes.push({ kind: 'upsert', key, event, reason: 'snapshot' });
    else if (!active && current?.active) changes.push({ kind: 'remove', key, event, reason: event.status === 'cancelled' ? 'explicit_cancel' : 'transparent' });
    records.set(key, { key, event, active, missingSnapshots: 0 });
  }
  for (const row of records.values()) {
    if (seen.has(row.key) || !row.active) continue;
    row.missingSnapshots++;
    if (row.missingSnapshots >= threshold) {
      row.active = false;
      changes.push({ kind: 'remove', key: row.key, event: row.event, reason: 'missing_twice' });
    }
  }
  return { state: { scope: { ...scope }, pollVersion, events: [...records.values()] }, changes, conflicts, ignoredStale, duplicatePoll: false };
}
