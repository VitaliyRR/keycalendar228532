import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  ConnectorError, dateInZone, fetchIcalFeed, parseIcal, reconcileIcalSnapshot,
  type IcalSyncState, type IcalSnapshot, type FeedFetchResult,
} from '@keycalendar/connectors';
import type { Config } from './config.js';
import { one, withTenant, type Tx } from './db.js';
import { decryptConnectionFeed } from './connections.js';

export interface PollIdentity { organizationId: string; connectionId: string; actorId: string }
export type PollResult = { status: 'skipped' | 'stale' | 'healthy' | 'conflict' | 'degraded' | 'reauth_required'; applied: number; conflicts: number; error_code?: string };
type Lease = {
  id: string; secret_ciphertext: string; poll_interval_seconds: number; poll_version: string;
  version: number; poll_lease_token: string; unit_id: string; timezone: string;
  state: IcalSyncState | null; etag: string | null; last_modified: string | null;
};
type ExistingOccupancy = {
  event_key: string; allocation_id: string | null; allocation_state: string | null;
  actual_from: string | null; actual_to: string | null;
};
type Fetcher = typeof fetchIcalFeed;

async function conflict(tx: Tx, identity: PollIdentity, kind: string, key: string, summary: string): Promise<void> {
  await tx.query(`INSERT INTO sync_conflicts(organization_id,connection_id,kind,dedupe_key,safe_summary)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,connection_id,dedupe_key) WHERE dedupe_key IS NOT NULL AND state='open' DO NOTHING`,
    [identity.organizationId, identity.connectionId, kind, `${kind}:${key}`, summary]);
}
async function closeAllocationConflict(tx: Tx, identity: PollIdentity, key: string): Promise<void> {
  await tx.query(`UPDATE sync_conflicts SET state='resolved',decision='authoritative_calendar_no_longer_conflicts',resolved_at=now()
    WHERE organization_id=$1 AND connection_id=$2 AND dedupe_key=$3 AND state='open'`, [identity.organizationId, identity.connectionId, `ICAL_OCCUPANCY_OVERLAP:${key}`]);
}

async function claim(pool: pg.Pool, identity: PollIdentity): Promise<Lease | null> {
  return withTenant(pool, identity.organizationId, identity.actorId, async tx => {
    const connection = await one<{ id: string; secret_ciphertext: string | null }>(tx, `SELECT id,secret_ciphertext FROM connections
      WHERE organization_id=$1 AND id=$2 AND created_by=$3 AND mechanism='ical' AND secret_ciphertext IS NOT NULL
      AND status IN ('verification_pending','healthy','degraded','conflict')
      AND (next_poll_at IS NULL OR next_poll_at<=now()) AND (poll_lease_until IS NULL OR poll_lease_until<now())
      FOR UPDATE SKIP LOCKED`, [identity.organizationId, identity.connectionId, identity.actorId]);
    if (!connection) return null;
    const mappings = (await tx.query<{ unit_id: string; timezone: string }>(`SELECT cm.unit_id,p.timezone FROM connection_mappings cm
      JOIN units u ON u.organization_id=cm.organization_id AND u.id=cm.unit_id JOIN properties p ON p.organization_id=u.organization_id AND p.id=u.property_id
      WHERE cm.organization_id=$1 AND cm.connection_id=$2 AND u.state='active' AND p.archived_at IS NULL`, [identity.organizationId, identity.connectionId])).rows;
    if (mappings.length !== 1) {
      await tx.query(`UPDATE connections SET status='degraded',last_error_code='ICAL_MAPPING_REQUIRED',next_poll_at=now()+interval '15 minutes',last_attempt_at=now() WHERE organization_id=$1 AND id=$2`, [identity.organizationId, identity.connectionId]);
      return null;
    }
    const row = await one<Omit<Lease, 'unit_id' | 'timezone' | 'state' | 'etag' | 'last_modified'>>(tx, `UPDATE connections
      SET poll_version=poll_version+1,poll_lease_token=$3,poll_lease_until=now()+interval '90 seconds',last_attempt_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING id,secret_ciphertext,poll_interval_seconds,poll_version::text,version,poll_lease_token`,
      [identity.organizationId, identity.connectionId, randomUUID()]);
    const saved = await one<{ state: IcalSyncState | null; etag: string | null; last_modified: string | null }>(tx, 'SELECT state,etag,last_modified FROM ical_sync_states WHERE organization_id=$1 AND connection_id=$2', [identity.organizationId, identity.connectionId]);
    return { ...row!, ...mappings[0]!, state: saved?.state?.scope ? saved.state : null, etag: saved?.etag ?? null, last_modified: saved?.last_modified ?? null };
  });
}

/** Iterate desired active state too: a previously conflicting event must be retried after local occupancy changes. */
async function applyOccupancy(tx: Tx, identity: PollIdentity, lease: Lease, desired: IcalSyncState): Promise<number> {
  const unit = await one<{ id: string; timezone: string }>(tx, `SELECT u.id,p.timezone FROM units u JOIN properties p ON p.organization_id=u.organization_id AND p.id=u.property_id
    WHERE u.organization_id=$1 AND u.id=$2 AND u.state='active' AND p.archived_at IS NULL FOR UPDATE OF u`, [identity.organizationId, lease.unit_id]);
  if (!unit || unit.timezone !== lease.timezone) throw new ConnectorError('ICAL_MAPPING_CHANGED');
  const mapping = await one(tx, 'SELECT id FROM connection_mappings WHERE organization_id=$1 AND connection_id=$2 AND unit_id=$3 FOR SHARE', [identity.organizationId, identity.connectionId, lease.unit_id]);
  if (!mapping) throw new ConnectorError('ICAL_MAPPING_CHANGED');
  const existing = new Map((await tx.query<ExistingOccupancy>(`SELECT io.event_key,io.allocation_id,a.state AS allocation_state,a.checkin::text AS actual_from,a.checkout::text AS actual_to
    FROM ical_occupancies io LEFT JOIN availability_allocations a ON a.organization_id=io.organization_id AND a.id=io.allocation_id
    WHERE io.organization_id=$1 AND io.connection_id=$2`, [identity.organizationId, identity.connectionId])).rows.map(row => [row.event_key, row]));
  const today = dateInZone(Date.now(), lease.timezone); let applied = 0;
  // Expired holds are released under the same unit lock used by reservation commands.
  applied += (await tx.query(`UPDATE availability_allocations SET state='released' WHERE organization_id=$1 AND unit_id=$2 AND kind='hold' AND state='active' AND expires_at<=now()`, [identity.organizationId, lease.unit_id])).rowCount ?? 0;
  for (const record of [...desired.events].sort((a, b) => Number(a.active) - Number(b.active))) {
    const prior = existing.get(record.key), event = record.event;
    if (!record.active) {
      if (prior?.allocation_id && prior.allocation_state === 'active') {
        if (prior.actual_from! <= today && prior.actual_to! > today) {
          await conflict(tx, identity, 'ICAL_LATE_CANCELLATION', record.key, 'Календарь освободил уже начавшийся интервал. Проверьте фактическое проживание; занятость сохранена.');
          continue;
        }
        await tx.query(`UPDATE availability_allocations SET state='released' WHERE organization_id=$1 AND id=$2 AND kind='block'`, [identity.organizationId, prior.allocation_id]);
        applied++;
      }
      await closeAllocationConflict(tx, identity, record.key);
      continue;
    }
    if (!event.from || !event.to) throw new ConnectorError('ICAL_INVALID_DESIRED_STATE');
    if (prior?.allocation_id && prior.allocation_state === 'active' && prior.actual_from === event.from && prior.actual_to === event.to) continue;
    const collision = await one(tx, `SELECT id FROM availability_allocations WHERE organization_id=$1 AND unit_id=$2 AND state='active'
      AND ($3::uuid IS NULL OR id<>$3) AND daterange(checkin,checkout,'[)') && daterange($4::date,$5::date,'[)') LIMIT 1`,
      [identity.organizationId, lease.unit_id, prior?.allocation_id ?? null, event.from, event.to]);
    if (collision) {
      // Save external fact but retain existing allocation; never delete another reservation to make room.
      await tx.query(`INSERT INTO ical_occupancies(organization_id,connection_id,event_key,allocation_id,from_date,to_date)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,connection_id,event_key) DO UPDATE SET from_date=EXCLUDED.from_date,to_date=EXCLUDED.to_date`,
        [identity.organizationId, identity.connectionId, record.key, prior?.allocation_id ?? null, event.from, event.to]);
      await conflict(tx, identity, 'ICAL_OCCUPANCY_OVERLAP', record.key, 'Внешняя занятость пересекается с существующим размещением. Внешний факт сохранён; требуется решение сотрудника.');
      continue;
    }
    const allocationId = prior?.allocation_id ?? randomUUID();
    if (prior?.allocation_id) await tx.query(`UPDATE availability_allocations SET checkin=$3,checkout=$4,state='active' WHERE organization_id=$1 AND id=$2 AND kind='block'`, [identity.organizationId, allocationId, event.from, event.to]);
    else await tx.query(`INSERT INTO availability_allocations(id,organization_id,unit_id,kind,checkin,checkout) VALUES($1,$2,$3,'block',$4,$5)`, [allocationId, identity.organizationId, lease.unit_id, event.from, event.to]);
    await tx.query(`INSERT INTO ical_occupancies(organization_id,connection_id,event_key,allocation_id,from_date,to_date)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,connection_id,event_key) DO UPDATE SET allocation_id=EXCLUDED.allocation_id,from_date=EXCLUDED.from_date,to_date=EXCLUDED.to_date`,
      [identity.organizationId, identity.connectionId, record.key, allocationId, event.from, event.to]);
    await closeAllocationConflict(tx, identity, record.key); applied++;
  }
  return applied;
}

async function commitSnapshot(pool: pg.Pool, identity: PollIdentity, lease: Lease, response: FeedFetchResult, snapshot: IcalSnapshot | null): Promise<PollResult> {
  return withTenant(pool, identity.organizationId, identity.actorId, async tx => {
    const connection = await one<{ version: number }>(tx, `SELECT version FROM connections WHERE organization_id=$1 AND id=$2 AND poll_lease_token=$3 AND poll_lease_until>now() AND version=$4 FOR UPDATE`,
      [identity.organizationId, identity.connectionId, lease.poll_lease_token, lease.version]);
    if (!connection) return { status: 'stale', applied: 0, conflicts: 0 };
    const scope = { tenantId: identity.organizationId, connectionId: identity.connectionId, calendarId: lease.unit_id };
    const pollVersion = Number(lease.poll_version);
    if (!Number.isSafeInteger(pollVersion)) throw new ConnectorError('ICAL_POLL_VERSION_OVERFLOW');
    if (!snapshot && !lease.state) throw new ConnectorError('ICAL_UNEXPECTED_NOT_MODIFIED');
    const plan = snapshot ? reconcileIcalSnapshot(scope, lease.state, snapshot, pollVersion) : null;
    const desired = plan?.state ?? lease.state!;
    for (const item of plan?.conflicts ?? []) await conflict(tx, identity, 'ICAL_EVENT_VERSION_CONFLICT', item.key, 'Изменение внешнего события не подтверждено новой версией. Предыдущая занятость сохранена.');
    const applied = await applyOccupancy(tx, identity, lease, desired);
    await tx.query(`INSERT INTO ical_sync_states(organization_id,connection_id,state,etag,last_modified)
      VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(organization_id,connection_id) DO UPDATE SET state=EXCLUDED.state,etag=EXCLUDED.etag,last_modified=EXCLUDED.last_modified,updated_at=now()`,
      [identity.organizationId, identity.connectionId, JSON.stringify(desired), response.status === 'ok' ? response.etag : lease.etag, response.status === 'ok' ? response.lastModified : lease.last_modified]);
    const conflicts = Number((await one<{ count: string }>(tx, `SELECT count(*)::text AS count FROM sync_conflicts WHERE organization_id=$1 AND connection_id=$2 AND state='open'`, [identity.organizationId, identity.connectionId]))?.count ?? 0);
    const status = conflicts ? 'conflict' : 'healthy';
    await tx.query(`INSERT INTO inbox_events(organization_id,connection_id,external_event_key,payload_ref,state,processed_at)
      VALUES($1,$2,$3,$4,'applied',now()) ON CONFLICT(organization_id,connection_id,external_event_key) DO NOTHING`,
      [identity.organizationId, identity.connectionId, `ical-poll:${pollVersion}`, `ical-state:${identity.connectionId}:${pollVersion}`]);
    await tx.query(`UPDATE connections SET status=$4,last_success_at=now(),last_error_code=NULL,poll_lease_token=NULL,poll_lease_until=NULL,
      next_poll_at=now()+make_interval(secs=>poll_interval_seconds),version=version+1 WHERE organization_id=$1 AND id=$2 AND poll_lease_token=$3`,
      [identity.organizationId, identity.connectionId, lease.poll_lease_token, status]);
    if (applied || conflicts) await tx.query(`INSERT INTO outbox_events(organization_id,aggregate_type,aggregate_id,aggregate_version,kind,payload)
      VALUES($1,'connection',$2,$3,'integration.occupancy_observed',$4::jsonb) ON CONFLICT DO NOTHING`,
      [identity.organizationId, identity.connectionId, lease.version + 1, JSON.stringify({ connection_id: identity.connectionId, unit_id: lease.unit_id, applied, conflicts, received_external_facts: true })]);
    await tx.query(`INSERT INTO audit_events(organization_id,actor_id,action,resource_type,resource_id,safe_diff)
      VALUES($1,$2,'connection.ical_polled','connection',$3,$4::jsonb)`, [identity.organizationId, identity.actorId, identity.connectionId, JSON.stringify({ status, applied, conflicts, full_snapshot: !!snapshot })]);
    return { status, applied, conflicts };
  });
}

/** Trusted worker entry point; caller supplies a due connection + its created_by user within that tenant. No automatic loop. */
export async function pollIcalConnection(pool: pg.Pool, config: Config, identity: PollIdentity, options: { fetcher?: Fetcher } = {}): Promise<PollResult> {
  const lease = await claim(pool, identity);
  if (!lease) return { status: 'skipped', applied: 0, conflicts: 0 };
  try {
    const url = decryptConnectionFeed(lease.secret_ciphertext, config, identity.organizationId, identity.connectionId);
    // A pending disappearance needs another full body; an endless sequence of304 must not prevent confirmation.
    const conditional = lease.state && !lease.state.events.some(event => event.active && event.missingSnapshots > 0);
    const response = await (options.fetcher ?? fetchIcalFeed)(url, {
      ...(conditional && lease.etag ? { etag: lease.etag } : {}), ...(conditional && lease.last_modified ? { lastModified: lease.last_modified } : {}),
    });
    const snapshot = response.status === 'ok' ? parseIcal(response.text, { timeZone: lease.timezone }) : null;
    return await commitSnapshot(pool, identity, lease, response, snapshot);
  } catch (error) {
    const safeError = error instanceof ConnectorError ? error : new ConnectorError('ICAL_POLL_FAILED', true);
    const status = safeError.code === 'FEED_REAUTH_REQUIRED' ? 'reauth_required' : 'degraded';
    const delay = Math.max(lease.poll_interval_seconds, Math.ceil((safeError.retryAfterMs ?? 0) / 1000));
    const updated = await withTenant(pool, identity.organizationId, identity.actorId, async tx => {
      const result = await tx.query(`UPDATE connections SET status=$4,last_error_code=$5,poll_lease_token=NULL,poll_lease_until=NULL,
        next_poll_at=now()+make_interval(secs=>$6),version=version+1 WHERE organization_id=$1 AND id=$2 AND poll_lease_token=$3 AND version=$7`,
        [identity.organizationId, identity.connectionId, lease.poll_lease_token, status, safeError.code, delay, lease.version]);
      return !!result.rowCount;
    });
    if (!updated) return { status: 'stale', applied: 0, conflicts: 0 };
    return { status, applied: 0, conflicts: 0, error_code: safeError.code };
  }
}
