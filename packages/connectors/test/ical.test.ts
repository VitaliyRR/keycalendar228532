import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, parseIcal, serializeIcal, escapeIcalText, unescapeIcalText, foldIcalLine, icalIdentity, reconcileIcalSnapshot, rangesOverlap, type ConnectionScope } from '../src/index.js';

const scope: ConnectionScope = { tenantId: 'tenant-a', connectionId: 'connection-a', calendarId: 'unit-a' };
const wrap = (event: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${event}END:VCALENDAR\r\n`;
const event = (extra = '', from = '20261010', to = '20261012', seq = 1) => `BEGIN:VEVENT\r\nUID:event-a\r\nSEQUENCE:${seq}\r\nDTSTART;VALUE=DATE:${from}\r\nDTEND;VALUE=DATE:${to}\r\n${extra}END:VEVENT\r\n`;
const parse = (text: string) => parseIcal(text, { timeZone: 'Europe/Moscow' });

test('date-only occupancy is half-open across month, leap year, adjacent stays', () => {
  const [actual] = parse(wrap(event('', '20260228', '20260302'))).events;
  assert.equal(actual?.from, '2026-02-28'); assert.equal(actual?.to, '2026-03-02');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(rangesOverlap({ from: '2026-10-10', to: '2026-10-12' }, { from: '2026-10-12', to: '2026-10-13' }), false);
  assert.throws(() => parse(wrap(event('', '20260230', '20260302'))), /INVALID_DATE/);
  assert.throws(() => parse(wrap(event('', '20261012', '20261012'))), /INVALID_HALF_OPEN_RANGE/);
});
test('date-only event without DTEND means one day; timed zero duration is rejected', () => {
  const result = parse(wrap('BEGIN:VEVENT\nUID:one\nDTSTART;VALUE=DATE:20261231\nEND:VEVENT\n'));
  assert.equal(result.events[0]?.to, '2027-01-01');
  assert.throws(() => parse(wrap('BEGIN:VEVENT\nUID:one\nDTSTART:20261010T120000Z\nEND:VEVENT\n')), /INVALID_TIME_INTERVAL/);
});
test('UTC and IANA times become dates in property timezone, independent of machine timezone', () => {
  const utc = parse(wrap('BEGIN:VEVENT\nUID:utc\nDTSTART:20261009T230000Z\nDTEND:20261011T230000Z\nEND:VEVENT\n')).events[0]!;
  assert.equal(utc.from, '2026-10-10'); assert.equal(utc.to, '2026-10-12');
  const local = parse(wrap('BEGIN:VEVENT\nUID:local\nDTSTART;TZID=Europe/Moscow:20261010T140000\nDTEND;TZID=Europe/Moscow:20261012T110000\nEND:VEVENT\n')).events[0]!;
  assert.equal(local.startInstant, '2026-10-10T11:00:00.000Z');
  const floating = parse(wrap('BEGIN:VEVENT\nUID:floating\nDTSTART:20261010T140000\nDTEND:20261012T110000\nEND:VEVENT\n')).events[0]!;
  assert.equal(floating.startInstant, local.startInstant);
});
test('DST gaps and ambiguous folds reject the whole snapshot', () => {
  const timed = (start: string, end: string) => wrap(`BEGIN:VEVENT\nUID:dst\nDTSTART;TZID=America/New_York:${start}\nDTEND;TZID=America/New_York:${end}\nEND:VEVENT\n`);
  assert.throws(() => parse(timed('20260308T023000', '20260309T110000')), /NONEXISTENT_LOCAL_TIME/);
  assert.throws(() => parse(timed('20261101T013000', '20261102T110000')), /AMBIGUOUS_LOCAL_TIME/);
  const normal = parseIcal(timed('20260307T140000', '20260309T110000'), { timeZone: 'America/New_York' }).events[0]!;
  assert.equal(normal.from, '2026-03-07'); assert.equal(normal.to, '2026-03-09');
});
test('folding is UTF8 byte aware; text escaping cannot inject content lines', () => {
  const text = 'Гость, текст; \\ строка\r\nBEGIN:VEVENT';
  assert.equal(unescapeIcalText(escapeIcalText(text)), text.replace('\r\n', '\n'));
  const line = 'SUMMARY:' + escapeIcalText(text.repeat(20));
  const folded = foldIcalLine(line);
  assert.ok(folded.split('\r\n').every(value => Buffer.byteLength(value) <= 75));
  assert.equal(folded.replace(/\r\n /g, ''), line);
  assert.throws(() => foldIcalLine('UID:bad\r\nEND:VEVENT'), /INVALID_CONTENT_LINE/);
});
test('UID dedupe handles identical duplicates and rejects collision before returning events', () => {
  assert.equal(parse(wrap(event() + event())).events.length, 1);
  assert.throws(() => parse(wrap(event() + event('', '20261010', '20261013'))), /CONFLICTING_ICAL_UID/);
  assert.notEqual(icalIdentity(scope, 'same'), icalIdentity({ ...scope, tenantId: 'tenant-b' }, 'same'));
  assert.notEqual(icalIdentity(scope, 'same'), icalIdentity(scope, 'same', 'D:2026-10-10'));
});
test('truncation, recurrence, nested active components and malformed fields fail closed', () => {
  for (const source of ['', wrap(event()).replace('END:VCALENDAR', ''), wrap(event('RRULE:FREQ=DAILY\n')), wrap(event('BEGIN:VALARM\nEND:VALARM\n')), wrap(event('SEQUENCE:2\n'))]) assert.throws(() => parse(source));
  assert.throws(() => parseIcal(wrap(event()), { timeZone: 'Europe/Moscow', maxBytes: 20 }), /ICAL_TOO_LARGE/);
  assert.throws(() => parseIcal(wrap(event() + event().replace('event-a', 'event-b')), { timeZone: 'Europe/Moscow', maxEvents: 1 }), /TOO_MANY_ICAL_EVENTS/);
});
test('export uses stable scoped UIDs and contains no imported feed events or guest data', () => {
  const rows = [{ id: 'reservation-internal', from: '2026-10-10', to: '2026-10-12', version: 1, origin: 'local' as const }, { id: 'imported', from: '2026-10-15', to: '2026-10-17', version: 1, origin: 'ical' as const }];
  const options = { scope, origin: 'export_origin_a', generatedAt: new Date('2026-09-24T00:00:00Z') };
  const output = serializeIcal(rows, options);
  assert.equal(parse(output).events.length, 1); assert.ok(!output.includes('reservation-internal')); assert.ok(!output.includes('imported'));
  assert.equal(parseIcal(output, { timeZone: 'Europe/Moscow', ownOrigin: options.origin }).events.length, 0);
  assert.equal(parse(output).events[0]?.uid, parse(serializeIcal(rows, { ...options, generatedAt: new Date('2026-09-25T00:00:00Z') })).events[0]?.uid);
});
test('disappearance needs two new full snapshots; failed/duplicate polls never release occupancy', () => {
  const initial = reconcileIcalSnapshot(scope, null, parse(wrap(event())), 1);
  assert.equal(initial.changes[0]?.kind, 'upsert');
  const first = reconcileIcalSnapshot(scope, initial.state, parse(wrap('')), 2);
  assert.equal(first.changes.length, 0); assert.equal(first.state.events[0]?.active, true);
  const duplicate = reconcileIcalSnapshot(scope, first.state, parse(wrap('')), 2);
  assert.equal(duplicate.duplicatePoll, true); assert.equal(duplicate.state.events[0]?.missingSnapshots, 1);
  const removed = reconcileIcalSnapshot(scope, duplicate.state, parse(wrap('')), 3);
  assert.equal(removed.changes[0]?.reason, 'missing_twice');
  const staleReappearance = reconcileIcalSnapshot(scope, removed.state, parse(wrap(event())), 4);
  assert.equal(staleReappearance.changes.length, 0); assert.equal(staleReappearance.state.events[0]?.active, false);
  assert.throws(() => reconcileIcalSnapshot({ ...scope, tenantId: 'other' }, initial.state, parse(wrap('')), 2), /ICAL_SCOPE_MISMATCH/);
});
test('old and same-version changes do not overwrite; explicit cancellation uses newer sequence', () => {
  const initial = reconcileIcalSnapshot(scope, null, parse(wrap(event('', '20261010', '20261012', 2))), 1);
  const old = reconcileIcalSnapshot(scope, initial.state, parse(wrap(event('', '20261010', '20261013', 1))), 2);
  assert.equal(old.ignoredStale.length, 1); assert.equal(old.state.events[0]?.event.to, '2026-10-12');
  const same = reconcileIcalSnapshot(scope, old.state, parse(wrap(event('', '20261010', '20261013', 2))), 3);
  assert.equal(same.conflicts[0]?.kind, 'same_version_changed');
  const cancel = parse(wrap('BEGIN:VEVENT\nUID:event-a\nSEQUENCE:3\nSTATUS:CANCELLED\nEND:VEVENT\n'));
  const result = reconcileIcalSnapshot(scope, same.state, cancel, 4);
  assert.equal(result.changes[0]?.reason, 'explicit_cancel'); assert.equal(result.state.events[0]?.active, false);
});
