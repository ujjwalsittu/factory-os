import { describe, expect, it } from 'vitest';
import { allocate, type CalendarSpec, localParts, schedule, type SchedOrder, subtract, workingIntervals, zonedEpochMinutes } from './scheduling.js';

const IST = 'Asia/Kolkata';
const at = (date: string, time: string) => zonedEpochMinutes(date, time, IST);
// 2026-10-12 is a Monday.
const twoShifts: CalendarSpec = {
  timeZone: IST,
  shifts: [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
    { weekday, start: '06:00', end: '14:00' },
    { weekday, start: '14:00', end: '22:00' },
  ]),
  holidays: [],
};

describe('zoned time', () => {
  it('converts IST wall-clock time to UTC and back', () => {
    expect(new Date(at('2026-10-12', '06:00') * 60000).toISOString()).toBe('2026-10-12T00:30:00.000Z');
    expect(localParts(at('2026-10-12', '06:00'), IST)).toMatchObject({ date: '2026-10-12', hour: 6, minute: 0, weekday: 1 });
  });
});

describe('workingIntervals', () => {
  it('merges back-to-back shifts and skips Sunday', () => {
    const w = workingIntervals(twoShifts, at('2026-10-10', '00:00'), at('2026-10-13', '00:00'));
    expect(w).toEqual([
      { start: at('2026-10-10', '06:00'), end: at('2026-10-10', '22:00') },
      { start: at('2026-10-12', '06:00'), end: at('2026-10-12', '22:00') },
    ]);
  });
  it('runs a night shift past midnight and keeps it on its starting day', () => {
    const night: CalendarSpec = { timeZone: IST, shifts: [{ weekday: 1, start: '22:00', end: '06:00' }], holidays: [] };
    const w = workingIntervals(night, at('2026-10-12', '00:00'), at('2026-10-14', '00:00'));
    expect(w).toEqual([{ start: at('2026-10-12', '22:00'), end: at('2026-10-13', '06:00') }]);
  });
  it('includes the tail of a night shift that started before the window', () => {
    const night: CalendarSpec = { timeZone: IST, shifts: [{ weekday: 1, start: '22:00', end: '06:00' }], holidays: [] };
    expect(workingIntervals(night, at('2026-10-13', '02:00'), at('2026-10-14', '00:00'))).toEqual([{ start: at('2026-10-13', '02:00'), end: at('2026-10-13', '06:00') }]);
  });
  it('skips holidays', () => {
    const w = workingIntervals({ ...twoShifts, holidays: ['2026-10-12'] }, at('2026-10-12', '00:00'), at('2026-10-13', '23:59'));
    expect(w).toEqual([{ start: at('2026-10-13', '06:00'), end: at('2026-10-13', '22:00') }]);
  });
});

describe('allocate and subtract', () => {
  const free = [
    { start: 100, end: 160 },
    { start: 200, end: 260 },
  ];
  it('spans a break and reports the segments used', () => {
    expect(allocate(free, 130, 50)).toEqual({ start: 130, end: 220, segments: [{ start: 130, end: 160 }, { start: 200, end: 220 }] });
  });
  it('returns null when the free time runs out', () => {
    expect(allocate(free, 0, 121)).toBeNull();
  });
  it('rounds fractional minutes up', () => {
    expect(allocate(free, 100, 10.2)?.end).toBe(111);
  });
  it('removes taken time', () => {
    expect(subtract(free, [{ start: 120, end: 210 }])).toEqual([{ start: 100, end: 120 }, { start: 210, end: 260 }]);
  });
});

describe('schedule', () => {
  const now = at('2026-10-12', '06:00');
  const horizon = at('2026-10-31', '00:00');
  const cal = workingIntervals(twoShifts, now, horizon);
  const machines = [
    { id: 'M1', workCentreId: 'CNC', free: cal },
    { id: 'M2', workCentreId: 'CNC', free: cal },
    { id: 'G1', workCentreId: 'GRIND', free: cal },
  ];
  const order = (id: string, extra: Partial<SchedOrder>, ops: SchedOrder['ops']): SchedOrder => ({ id, priority: 3, dueAt: null, releasedAt: 0, earliestStart: null, ops, ...extra });

  it('runs operations in sequence and uses the second machine when the first is busy', () => {
    const r = schedule({
      now,
      machines,
      orders: [
        order('A', { priority: 1 }, [
          { id: 'A10', seq: 10, workCentreId: 'CNC', outsourced: false, minutes: 600 },
          { id: 'A20', seq: 20, workCentreId: 'GRIND', outsourced: false, minutes: 60 },
        ]),
        order('B', { priority: 2 }, [{ id: 'B10', seq: 10, workCentreId: 'CNC', outsourced: false, minutes: 120 }]),
      ],
    });
    const p = Object.fromEntries(r.placements.map((x) => [x.opId, x]));
    expect(p.A10).toMatchObject({ machineId: 'M1', start: now, end: now + 600 });
    expect(p.A20).toMatchObject({ machineId: 'G1', start: now + 600, end: now + 660 });
    expect(p.B10).toMatchObject({ machineId: 'M2', start: now, end: now + 120 });
  });

  it('orders by priority, then due date, then release', () => {
    const op = (id: string) => [{ id, seq: 10, workCentreId: 'GRIND', outsourced: false, minutes: 60 }];
    const r = schedule({
      now,
      machines,
      orders: [order('late-due', { dueAt: now + 9000, releasedAt: 1 }, op('X')), order('no-due', { releasedAt: 0 }, op('Y')), order('soon-due', { dueAt: now + 100, releasedAt: 2 }, op('Z')), order('urgent', { priority: 1, releasedAt: 3 }, op('W'))],
    });
    const starts = Object.fromEntries(r.placements.map((x) => [x.opId, x.start - now]));
    expect(starts).toEqual({ W: 0, Z: 60, X: 120, Y: 180 });
  });

  it('carries work over a shift end and flags a late order', () => {
    const r = schedule({ now: at('2026-10-12', '21:00'), machines: [{ id: 'G1', workCentreId: 'GRIND', free: cal }], orders: [order('A', { dueAt: at('2026-10-12', '23:59') }, [{ id: 'A10', seq: 10, workCentreId: 'GRIND', outsourced: false, minutes: 120 }])] });
    expect(r.placements[0]).toMatchObject({ start: at('2026-10-12', '21:00'), end: at('2026-10-13', '07:00') });
    expect(r.orders[0]).toMatchObject({ late: true });
  });

  it('keeps pinned work fixed, schedules around it and reports a sequence conflict', () => {
    const r = schedule({
      now,
      machines: [{ id: 'G1', workCentreId: 'GRIND', free: cal }],
      orders: [
        order('A', {}, [
          { id: 'A10', seq: 10, workCentreId: 'GRIND', outsourced: false, minutes: 120 },
          { id: 'A20', seq: 20, workCentreId: 'GRIND', outsourced: false, minutes: 60, pinned: { machineId: 'G1', start: now + 60, end: now + 120 } },
        ]),
      ],
    });
    const p = Object.fromEntries(r.placements.map((x) => [x.opId, x]));
    expect(p.A20).toMatchObject({ start: now + 60, pinned: true });
    expect(p.A10).toMatchObject({ start: now, end: now + 180 });
    expect(r.conflicts).toEqual([{ opId: 'A20', orderId: 'A', reason: expect.stringMatching(/predecessor/) }]);
  });

  it('anchors a running job card and gives an overrun a short grace', () => {
    const r = schedule({
      now,
      machines: [{ id: 'G1', workCentreId: 'GRIND', free: cal }],
      orders: [
        order('A', {}, [
          { id: 'A10', seq: 10, workCentreId: 'GRIND', outsourced: false, minutes: 0, running: { machineId: 'G1', start: now - 300 } },
          { id: 'A20', seq: 20, workCentreId: 'GRIND', outsourced: false, minutes: 30 },
        ]),
      ],
    });
    const p = Object.fromEntries(r.placements.map((x) => [x.opId, x]));
    expect(p.A10).toMatchObject({ start: now - 300, end: now + 15, running: true });
    expect(p.A20).toMatchObject({ start: now + 15, end: now + 45 });
  });

  it('takes outsourced lead days off-machine', () => {
    const r = schedule({
      now,
      machines,
      orders: [
        order('A', {}, [
          { id: 'A10', seq: 10, workCentreId: null, outsourced: true, minutes: 0, leadDays: 3 },
          { id: 'A20', seq: 20, workCentreId: 'GRIND', outsourced: false, minutes: 60 },
        ]),
      ],
    });
    const p = Object.fromEntries(r.placements.map((x) => [x.opId, x]));
    expect(p.A10).toMatchObject({ machineId: null, start: now, end: now + 3 * 1440 });
    expect(p.A20!.start).toBe(now + 3 * 1440);
  });

  it('lists operations it cannot place, and the ones after them', () => {
    const r = schedule({
      now,
      machines,
      orders: [
        order('A', {}, [
          { id: 'A10', seq: 10, workCentreId: 'EDM', outsourced: false, minutes: 60 },
          { id: 'A20', seq: 20, workCentreId: 'GRIND', outsourced: false, minutes: 60 },
        ]),
      ],
    });
    expect(r.unscheduled.map((u) => [u.opId, u.reason])).toEqual([
      ['A10', 'No active machine in the work centre'],
      ['A20', 'A previous operation could not be scheduled'],
    ]);
    expect(r.orders[0]).toMatchObject({ finish: null, late: false });
  });

  it('skips operations with nothing left to do', () => {
    const r = schedule({ now, machines, orders: [order('A', {}, [{ id: 'A10', seq: 10, workCentreId: 'GRIND', outsourced: false, minutes: 0 }])] });
    expect(r.placements).toEqual([]);
  });
});
