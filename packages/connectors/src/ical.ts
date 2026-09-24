import { createHash } from 'node:crypto';
import { addDays, dateInZone, localDate, validateRange, validateTimeZone, wallTimeToEpoch, type LocalDate } from './dates.js';
import { invariant } from './errors.js';

export interface ConnectionScope { tenantId: string; connectionId: string; calendarId: string }
export interface IcalEvent {
  uid: string;
  recurrenceId: string | null;
  sequence: number | null;
  stamp: string | null;
  status: 'busy' | 'cancelled' | 'free';
  from: LocalDate | null;
  to: LocalDate | null;
  startInstant: string | null;
  endInstant: string | null;
  fingerprint: string;
  origin: string | null;
}
export interface IcalSnapshot { events: IcalEvent[]; contentHash: string; complete: true }
export interface IcalParseOptions { timeZone: string; maxBytes?: number; maxEvents?: number; ownOrigin?: string }
interface Property { name: string; parameters: Record<string, string>; value: string }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function icalIdentity(scope: ConnectionScope, uid: string, recurrenceId: string | null = null): string {
  invariant(scope.tenantId && scope.connectionId && scope.calendarId && uid, 'INVALID_ICAL_IDENTITY');
  return hash(JSON.stringify([scope.tenantId, scope.connectionId, scope.calendarId, uid, recurrenceId]));
}
export function escapeIcalText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
export function unescapeIcalText(text: string): string {
  return text.replace(/\\([nN,;\\])/g, (_, c: string) => c.toLowerCase() === 'n' ? '\n' : c);
}
export function foldIcalLine(line: string): string {
  invariant(!/[\r\n]/.test(line), 'INVALID_CONTENT_LINE');
  const result: string[] = []; let part = ''; let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 75) { result.push(part); part = ' '; bytes = 1; }
    part += character; bytes += size;
  }
  result.push(part);
  return result.join('\r\n');
}
function parseProperty(line: string): Property {
  let quoted = false; let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    if (line[i] === ':' && !quoted) { colon = i; break; }
  }
  invariant(colon > 0 && !quoted, 'INVALID_CONTENT_LINE');
  const tokens = line.slice(0, colon).match(/(?:[^;\"]|"[^"]*")+/g) ?? [];
  const name = tokens.shift()?.toUpperCase() ?? '';
  invariant(/^[A-Z0-9-]+$/.test(name), 'INVALID_PROPERTY_NAME');
  const parameters: Record<string, string> = {};
  for (const token of tokens) {
    const equals = token.indexOf('=');
    invariant(equals > 0, 'INVALID_PROPERTY_PARAMETER');
    const key = token.slice(0, equals).toUpperCase();
    invariant(!Object.hasOwn(parameters, key), 'DUPLICATE_PROPERTY_PARAMETER');
    const value = token.slice(equals + 1);
    parameters[key] = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
  return { name, parameters, value: line.slice(colon + 1) };
}
function singleton(properties: Property[], name: string): Property | undefined {
  const found = properties.filter(p => p.name === name);
  invariant(found.length <= 1, 'DUPLICATE_EVENT_PROPERTY');
  return found[0];
}
function parseDateProperty(property: Property, zone: string): { date: string; epoch: number | null; kind: 'date' | 'time'; canonical: string } {
  const value = property.value;
  const dateOnly = property.parameters.VALUE?.toUpperCase() === 'DATE';
  if (dateOnly) {
    invariant(/^\d{8}$/.test(value) && !property.parameters.TZID, 'INVALID_DATE_PROPERTY');
    const date = localDate(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
    return { date, epoch: null, kind: 'date', canonical: 'D:' + date };
  }
  invariant(!property.parameters.VALUE || property.parameters.VALUE.toUpperCase() === 'DATE-TIME', 'UNSUPPORTED_DATE_VALUE');
  invariant(/^\d{8}T\d{6}Z?$/.test(value), 'INVALID_DATE_TIME');
  const utc = value.endsWith('Z');
  invariant(!(utc && property.parameters.TZID), 'INVALID_UTC_TZID');
  const parts = [value.slice(0, 4), value.slice(4, 6), value.slice(6, 8), value.slice(9, 11), value.slice(11, 13), value.slice(13, 15)].map(Number);
  const epoch = wallTimeToEpoch(parts, utc ? 'UTC' : (property.parameters.TZID ?? zone));
  return { date: dateInZone(epoch, zone), epoch, kind: 'time', canonical: 'T:' + new Date(epoch).toISOString() };
}
function eventFromProperties(properties: Property[], zone: string): IcalEvent {
  invariant(!properties.some(p => ['RRULE', 'RDATE', 'EXDATE', 'EXRULE', 'DURATION'].includes(p.name)), 'UNSUPPORTED_ICAL_RECURRENCE_OR_DURATION');
  const uid = unescapeIcalText(singleton(properties, 'UID')?.value ?? '');
  invariant(uid.length > 0 && uid.length <= 1024 && !/[\r\n\x00-\x1f]/.test(uid), 'INVALID_ICAL_UID');
  const sequenceText = singleton(properties, 'SEQUENCE')?.value;
  invariant(sequenceText === undefined || /^\d{1,10}$/.test(sequenceText), 'INVALID_SEQUENCE');
  const sequence = sequenceText === undefined ? null : Number(sequenceText);
  invariant(sequence === null || sequence <= 2147483647, 'INVALID_SEQUENCE');
  const stampProperty = singleton(properties, 'DTSTAMP');
  if (stampProperty) invariant(stampProperty.value.endsWith('Z'), 'INVALID_DTSTAMP');
  const stamp = stampProperty ? new Date(parseDateProperty(stampProperty, 'UTC').epoch!).toISOString() : null;
  const statusProperty = singleton(properties, 'STATUS')?.value.toUpperCase();
  invariant(!statusProperty || ['CONFIRMED', 'TENTATIVE', 'CANCELLED'].includes(statusProperty), 'UNSUPPORTED_EVENT_STATUS');
  const transparency = singleton(properties, 'TRANSP')?.value.toUpperCase();
  invariant(!transparency || ['OPAQUE', 'TRANSPARENT'].includes(transparency), 'INVALID_TRANSPARENCY');
  const status: IcalEvent['status'] = statusProperty === 'CANCELLED' ? 'cancelled' : transparency === 'TRANSPARENT' ? 'free' : 'busy';
  const recurrenceProperty = singleton(properties, 'RECURRENCE-ID');
  invariant(!recurrenceProperty?.parameters.RANGE, 'UNSUPPORTED_RECURRENCE_RANGE');
  const recurrenceId = recurrenceProperty ? parseDateProperty(recurrenceProperty, zone).canonical : null;
  const startProperty = singleton(properties, 'DTSTART');
  const endProperty = singleton(properties, 'DTEND');
  invariant(status !== 'busy' || startProperty, 'MISSING_DTSTART');
  invariant(!endProperty || startProperty, 'MISSING_DTSTART');
  let from: string | null = null; let to: string | null = null;
  let startInstant: string | null = null; let endInstant: string | null = null;
  if (startProperty) {
    const start = parseDateProperty(startProperty, zone);
    const end = endProperty ? parseDateProperty(endProperty, zone) : null;
    invariant(!end || start.kind === end.kind, 'MISMATCHED_DATE_TYPES');
    from = start.date;
    if (start.kind === 'date') to = end?.date ?? addDays(from, 1);
    else {
      invariant(end && end.epoch !== null && start.epoch !== null && end.epoch > start.epoch, 'INVALID_TIME_INTERVAL');
      startInstant = new Date(start.epoch).toISOString(); endInstant = new Date(end.epoch).toISOString();
      // Occupancy feed dates are stay dates. Same-day timed events have no defensible night mapping.
      to = end.date;
      invariant(from < to, 'TIMED_EVENT_HAS_NO_NIGHTS');
    }
    validateRange(from, to);
  }
  const origin = singleton(properties, 'X-KEYCALENDAR-ORIGIN')?.value ?? null;
  const value = { uid, recurrenceId, sequence, stamp, status, from, to, startInstant, endInstant, origin };
  return { ...value, fingerprint: hash(JSON.stringify({ ...value, sequence: undefined, stamp: undefined })) };
}

/** Entire feed validates before any event is returned. An empty/truncated HTTP body is never a successful snapshot. */
export function parseIcal(text: string, options: IcalParseOptions): IcalSnapshot {
  validateTimeZone(options.timeZone);
  invariant(Buffer.byteLength(text, 'utf8') <= (options.maxBytes ?? 2_000_000), 'ICAL_TOO_LARGE');
  invariant(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) && !/\r(?!\n)/.test(text), 'INVALID_ICAL_CONTROL');
  const rawLines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of rawLines) {
    if (/^[ \t]/.test(line)) { invariant(lines.length > 0, 'INVALID_ICAL_FOLD'); lines[lines.length - 1] += line.slice(1); }
    else if (line) lines.push(line);
  }
  invariant(lines[0]?.toUpperCase() === 'BEGIN:VCALENDAR' && lines.at(-1)?.toUpperCase() === 'END:VCALENDAR', 'INCOMPLETE_ICAL');
  const calendarProperties: Property[] = []; let current: Property[] | null = null; const events: IcalEvent[] = [];
  for (const line of lines.slice(1, -1)) {
    const property = parseProperty(line);
    if (property.name === 'BEGIN') {
      invariant(!current && property.value.toUpperCase() === 'VEVENT', 'UNSUPPORTED_ICAL_COMPONENT');
      current = [];
    } else if (property.name === 'END') {
      invariant(current && property.value.toUpperCase() === 'VEVENT', 'INVALID_ICAL_NESTING');
      events.push(eventFromProperties(current, options.timeZone)); current = null;
      invariant(events.length <= (options.maxEvents ?? 10_000), 'TOO_MANY_ICAL_EVENTS');
    } else (current ?? calendarProperties).push(property);
  }
  invariant(!current, 'INCOMPLETE_ICAL');
  invariant(singleton(calendarProperties, 'VERSION')?.value === '2.0', 'UNSUPPORTED_ICAL_VERSION');
  const method = singleton(calendarProperties, 'METHOD')?.value.toUpperCase();
  invariant(!method || method === 'PUBLISH', 'UNSUPPORTED_ICAL_METHOD');
  const unique = new Map<string, IcalEvent>();
  for (const event of events) {
    const key = JSON.stringify([event.uid, event.recurrenceId]);
    const previous = unique.get(key);
    invariant(!previous || JSON.stringify(previous) === JSON.stringify(event), 'CONFLICTING_ICAL_UID');
    unique.set(key, event);
  }
  const retained = [...unique.values()].filter(e => !options.ownOrigin || e.origin !== options.ownOrigin);
  return { events: retained, contentHash: hash(text), complete: true };
}

export interface ExportOccupancy { id: string; from: LocalDate; to: LocalDate; version: number; origin: 'local' | 'api' | 'ical'; cancelled?: boolean }
export interface IcalExportOptions { scope: ConnectionScope; origin: string; generatedAt: Date }
/** No SUMMARY input: exported calendars contain neither guest data nor arbitrary user content. */
export function serializeIcal(occupancies: readonly ExportOccupancy[], options: IcalExportOptions): string {
  invariant(/^[A-Za-z0-9_-]{8,128}$/.test(options.origin), 'INVALID_EXPORT_ORIGIN');
  invariant(Number.isFinite(options.generatedAt.getTime()), 'INVALID_EXPORT_TIMESTAMP');
  const stamp = options.generatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KeyCalendar//Occupancy 1.0//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const seen = new Set<string>();
  for (const item of [...occupancies].sort((a, b) => a.id.localeCompare(b.id))) {
    if (item.origin === 'ical') continue; // Never circulate imported feed events, even if a provider strips X-properties.
    invariant(item.id && !seen.has(item.id), 'DUPLICATE_EXPORT_ID'); seen.add(item.id);
    validateRange(item.from, item.to);
    invariant(Number.isInteger(item.version) && item.version >= 0 && item.version <= 2147483647, 'INVALID_SEQUENCE');
    const uid = icalIdentity(options.scope, item.id) + '@keycalendar';
    lines.push('BEGIN:VEVENT', 'UID:' + escapeIcalText(uid), 'DTSTAMP:' + stamp, 'SEQUENCE:' + item.version,
      'DTSTART;VALUE=DATE:' + item.from.replaceAll('-', ''), 'DTEND;VALUE=DATE:' + item.to.replaceAll('-', ''),
      'STATUS:' + (item.cancelled ? 'CANCELLED' : 'CONFIRMED'), 'TRANSP:OPAQUE', 'SUMMARY:Занято',
      'X-KEYCALENDAR-ORIGIN:' + options.origin, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcalLine).join('\r\n') + '\r\n';
}
