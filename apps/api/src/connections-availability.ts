import type { Tx } from './db.js';

export interface IcalConflictBlock {
  id: string;
  unit_id: string;
  property_id: string;
  from: string;
  to: string;
  kind: 'block';
  state: 'active';
  external_conflict: true;
}

/** A rejected external allocation still closes its entire known interval to new sales.
 * These barriers may overlap existing reservations, so they cannot be stored as ordinary
 * allocations under the exclusion constraint. Call under the unit lock when selling. */
export async function icalConflictBlocks(tx: Tx, organizationId: string, unitIds: string[], from?: string, to?: string): Promise<IcalConflictBlock[]> {
  if (!unitIds.length) return [];
  return (await tx.query<IcalConflictBlock>(`SELECT DISTINCT sc.id,cm.unit_id,u.property_id,
    io.from_date::text AS "from",io.to_date::text AS "to",'block'::text AS kind,'active'::text AS state,true AS external_conflict
    FROM ical_occupancies io
    JOIN sync_conflicts sc ON sc.organization_id=io.organization_id AND sc.connection_id=io.connection_id
      AND sc.dedupe_key='ICAL_OCCUPANCY_OVERLAP:'||io.event_key AND sc.kind='ICAL_OCCUPANCY_OVERLAP' AND sc.state='open'
    JOIN connection_mappings cm ON cm.organization_id=io.organization_id AND cm.connection_id=io.connection_id
    JOIN units u ON u.organization_id=cm.organization_id AND u.id=cm.unit_id
    WHERE io.organization_id=$1 AND cm.unit_id=ANY($2::uuid[])
      AND ($3::date IS NULL OR io.to_date>$3) AND ($4::date IS NULL OR io.from_date<$4)`,
  [organizationId, unitIds, from ?? null, to ?? null])).rows;
}
