import { invariant, ConnectorError } from './errors.js';

export type LocalDate = string;
export function localDate(value: string): LocalDate {
  invariant(/^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID_DATE');
  const parsed = new Date(value + 'T00:00:00Z');
  invariant(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= '1900-01-01', 'INVALID_DATE');
  return value;
}
export function addDays(date: LocalDate, count: number): LocalDate {
  const value = new Date(localDate(date) + 'T00:00:00Z');
  invariant(Number.isSafeInteger(count), 'INVALID_DAY_COUNT');
  value.setUTCDate(value.getUTCDate() + count);
  return localDate(value.toISOString().slice(0, 10));
}
export function validateRange(from: LocalDate, to: LocalDate): void {
  invariant(localDate(from) < localDate(to), 'INVALID_HALF_OPEN_RANGE');
}
export function rangesOverlap(a: { from: LocalDate; to: LocalDate }, b: { from: LocalDate; to: LocalDate }): boolean {
  validateRange(a.from, a.to); validateRange(b.from, b.to);
  return a.from < b.to && b.from < a.to;
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  const cached = formatters.get(zone); if (cached) return cached;
  let value: Intl.DateTimeFormat;
  try { value = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }); } catch { throw new ConnectorError('UNSUPPORTED_TIME_ZONE'); }
  if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!);
  formatters.set(zone, value); return value;
}
export function validateTimeZone(zone: string): void { formatter(zone); }
export function zonedParts(epoch: number, zone: string): number[] {
  const parts = formatter(zone).formatToParts(epoch);
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map(k => Number(parts.find(p => p.type === k)?.value));
}
export function dateInZone(epoch: number, zone: string): LocalDate {
  const [y, m, d] = zonedParts(epoch, zone);
  return localDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
}
/** Reject DST gaps and folds rather than silently choosing a different occupancy interval. */
export function wallTimeToEpoch(parts: number[], zone: string): number {
  validateTimeZone(zone);
  const [y, m, d, h, min, sec] = parts as [number, number, number, number, number, number];
  invariant(h < 24 && min < 60 && sec < 60, 'INVALID_TIME');
  localDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  const wall = Date.UTC(y, m - 1, d, h, min, sec);
  const offsets = new Set<number>();
  // Sampling across both sides of a transition captures historical half-hour/hour changes.
  for (const delta of [-172800000, -86400000, 0, 86400000, 172800000]) {
    const probe = wall + delta;
    const p = zonedParts(probe, zone) as [number, number, number, number, number, number];
    offsets.add(Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) - probe);
  }
  const candidates = [...offsets].map(offset => wall - offset)
    .filter(epoch => zonedParts(epoch, zone).every((value, i) => value === parts[i]));
  invariant(candidates.length === 1, candidates.length ? 'AMBIGUOUS_LOCAL_TIME' : 'NONEXISTENT_LOCAL_TIME');
  return candidates[0]!;
}
