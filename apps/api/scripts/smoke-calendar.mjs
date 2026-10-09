// Working calendars and machine downtime (decision 049): shifts, overnight and overlap rules, holidays, the default
// calendar, work centre calendars, and machine blocks with their overlap rule.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-calendar.mjs
import assert from 'node:assert/strict';
import { Client } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Calendar');
const fail = async (method, path, body, status, label, pattern) => {
  const r = await c.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const week = (start, end, days = [1, 2, 3, 4, 5, 6]) => days.map((weekday) => ({ weekday, start, end }));

let view = await c.req('GET', '/manufacturing/schedule');
assert.equal(view.calendarMissing, true);
await fail('POST', '/manufacturing/schedule/run', {}, 400, 'scheduling needs a calendar first', /working calendar first/);

await fail('POST', '/manufacturing/calendars', { name: 'Bad', shifts: [{ weekday: 1, start: '22:00', end: '07:00' }, { weekday: 2, start: '06:00', end: '14:00' }] }, 400, 'a night shift running into the morning shift overlaps', /Mon 22:00–07:00 and Tue 06:00–14:00 overlap/);
await fail('POST', '/manufacturing/calendars', { name: 'Bad', shifts: [{ weekday: 1, start: '6:00', end: '14:00' }] }, 400, 'times are HH:MM', /HH:MM/);
await fail('POST', '/manufacturing/calendars', { name: 'Bad', timeZone: 'Mars/Olympus', shifts: week('06:00', '14:00') }, 400, 'the time zone must exist', /Unknown time zone/);
await fail('POST', '/manufacturing/calendars', { name: 'Bad', shifts: week('06:00', '14:00'), holidays: [{ date: '2026-10-20', name: 'Diwali' }, { date: '2026-10-20', name: 'Again' }] }, 400, 'a holiday date only once', /listed twice/);

const two = await c.req('POST', '/manufacturing/calendars', { name: 'Two shifts', shifts: [...week('06:00', '14:00'), ...week('14:00', '22:00')], holidays: [{ date: '2026-10-20', name: 'Diwali' }] }, 201);
assert.equal(two.isDefault, true);
assert.equal(two.timeZone, 'Asia/Kolkata');
ok('the first calendar becomes the default, in IST');
const three = await c.req('POST', '/manufacturing/calendars', { name: 'Three shifts', shifts: [...week('06:00', '14:00'), ...week('14:00', '22:00'), ...week('22:00', '06:00')] }, 201);
assert.equal(three.isDefault, false);
ok('a night shift ending at the morning shift is accepted');
await fail('POST', '/manufacturing/calendars', { name: 'Two shifts', shifts: week('06:00', '14:00') }, 409, 'calendar names are unique', /already exists/);
await fail('PUT', `/manufacturing/calendars/${two.id}`, { name: 'Two shifts', isDefault: false, shifts: week('06:00', '14:00') }, 400, 'the default can only move to another calendar', /another calendar the default/);

const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC cell', hourlyRate: '1800', calendarId: three.id }, 201);
assert.equal(cnc.calendarId, three.id);
await c.req('POST', '/manufacturing/work-centres', { code: 'GRIND', name: 'Grinding', hourlyRate: '900' }, 201);
let cals = await c.req('GET', '/manufacturing/calendars');
assert.deepEqual(cals.find((x) => x.id === three.id).workCentres, ['CNC']);
assert.deepEqual(cals.find((x) => x.id === two.id).workCentres, ['GRIND']);
assert.deepEqual(cals.find((x) => x.id === two.id).holidays, [{ date: '2026-10-20', name: 'Diwali' }]);
ok('CNC runs three shifts; grinding follows the default calendar');
await fail('POST', '/manufacturing/work-centres', { code: 'EDM', name: 'EDM', hourlyRate: '900', calendarId: '00000000-0000-4000-8000-000000000000' }, 400, 'a work centre names a calendar of this entity', /Unknown calendar/);
await fail('PUT', `/manufacturing/calendars/${three.id}`, { name: 'Three shifts', isActive: false, shifts: week('06:00', '14:00') }, 409, 'a calendar in use stays active', /CNC uses this calendar/);

await c.req('PUT', `/manufacturing/calendars/${three.id}`, { name: 'Three shifts', isDefault: true, shifts: [...week('06:00', '14:00'), ...week('14:00', '22:00'), ...week('22:00', '06:00')] });
cals = await c.req('GET', '/manufacturing/calendars');
assert.deepEqual(cals.filter((x) => x.isDefault).map((x) => x.name), ['Three shifts']);
ok('making another calendar the default moves the flag');

const m1 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'VMC-1', name: 'Vertical machining centre 1' }, 201);
const t0 = new Date('2026-11-02T04:30:00Z');
const plus = (h) => new Date(t0.getTime() + h * 3600e3).toISOString();
await fail('POST', '/manufacturing/machine-blocks', { machineId: m1.id, kind: 'maintenance', startsAt: plus(2), endsAt: plus(1), reason: 'Spindle service' }, 400, 'downtime ends after it starts', /end is before the start/);
await fail('POST', '/manufacturing/machine-blocks', { machineId: m1.id, kind: 'booking', startsAt: plus(0), endsAt: plus(1), reason: 'MaaS' }, 400, 'bookings are reserved for MaaS (Phase 3)');
const b1 = await c.req('POST', '/manufacturing/machine-blocks', { machineId: m1.id, kind: 'maintenance', startsAt: plus(0), endsAt: plus(4), reason: 'Spindle service' }, 201);
await fail('POST', '/manufacturing/machine-blocks', { machineId: m1.id, kind: 'breakdown', startsAt: plus(3), endsAt: plus(5), reason: 'Coolant pump' }, 409, 'downtime on one machine doesn’t overlap', /Overlaps other downtime/);
await c.req('POST', '/manufacturing/machine-blocks', { machineId: m1.id, kind: 'breakdown', startsAt: plus(4), endsAt: plus(5), reason: 'Coolant pump' }, 201);
ok('back-to-back downtime is fine');
await c.req('PUT', `/manufacturing/machine-blocks/${b1.id}`, { machineId: m1.id, kind: 'maintenance', startsAt: plus(0), endsAt: plus(3), reason: 'Spindle service (shortened)' });
let blocks = await c.req('GET', `/manufacturing/machine-blocks?machineId=${m1.id}`);
assert.deepEqual(blocks.map((b) => [b.reason, b.machineCode]), [['Spindle service (shortened)', 'VMC-1'], ['Coolant pump', 'VMC-1']]);
await c.req('DELETE', `/manufacturing/machine-blocks/${b1.id}`);
blocks = await c.req('GET', `/manufacturing/machine-blocks?from=${plus(-1)}&to=${plus(10)}`);
assert.equal(blocks.length, 1);
ok('downtime is edited and removed');

view = await c.req('GET', '/manufacturing/schedule');
assert.equal(view.calendarMissing, false);
assert.deepEqual(view.machines.map((m) => [m.code, m.calendarId]), [['VMC-1', three.id]]);
ok('the schedule sees the machine on its centre’s calendar');

console.log(`\nCalendar smoke passed (${c.checks} request checks).`);
