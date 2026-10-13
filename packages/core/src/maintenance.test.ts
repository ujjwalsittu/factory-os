import { describe, expect, it } from 'vitest';
import { meteredRunningMinutes, planDue, reliability } from './maintenance.js';

const t0 = Date.parse('2026-07-01T00:00:00Z');
const d = (days: number) => new Date(t0 + days * 86400_000);
const h = (hours: number) => new Date(t0 + hours * 3600_000);

describe('preventive plans fall due (decision 066)', () => {
  it('by calendar, with a due-soon window', () => {
    const p = { everyDays: 90, everyRunHours: null, leadDays: 7 };
    const b = { lastDoneAt: d(0), runHoursSince: 0 };
    expect(planDue(p, b, d(80))).toMatchObject({ status: 'ok', by: null });
    expect(planDue(p, b, d(84))).toMatchObject({ status: 'due_soon', by: 'calendar', dueAt: d(90) });
    expect(planDue(p, b, d(90))).toMatchObject({ status: 'overdue', by: 'calendar' });
  });

  it('by running hours, due soon in the last 10 %', () => {
    const p = { everyDays: null, everyRunHours: 500, leadDays: 7 };
    expect(planDue(p, { lastDoneAt: d(0), runHoursSince: 440 }, d(1))).toMatchObject({ status: 'ok', hoursLeft: 60 });
    expect(planDue(p, { lastDoneAt: d(0), runHoursSince: 455 }, d(1))).toMatchObject({ status: 'due_soon', by: 'hours', hoursLeft: 45 });
    expect(planDue(p, { lastDoneAt: d(0), runHoursSince: 512.3 }, d(1))).toMatchObject({ status: 'overdue', by: 'hours', hoursLeft: -12.3 });
  });

  it('whichever comes first', () => {
    const p = { everyDays: 180, everyRunHours: 500, leadDays: 7 };
    expect(planDue(p, { lastDoneAt: d(0), runHoursSince: 600 }, d(30))).toMatchObject({ status: 'overdue', by: 'hours' });
    expect(planDue(p, { lastDoneAt: d(0), runHoursSince: 50 }, d(181))).toMatchObject({ status: 'overdue', by: 'calendar' });
    expect(planDue(p, { lastDoneAt: d(0), runHoursSince: 460 }, d(175))).toMatchObject({ status: 'due_soon' });
    expect(() => planDue({ everyDays: null, everyRunHours: null, leadDays: 0 }, { lastDoneAt: d(0), runHoursSince: 0 }, d(1))).toThrow();
  });
});

describe('running hours from the tap (decision 066)', () => {
  it('counts only running segments', () => {
    expect(
      meteredRunningMinutes([
        { from: h(0), to: h(2), state: 'running' },
        { from: h(2), to: h(3), state: 'idle' },
        { from: h(3), to: h(3.5), state: 'running' },
        { from: h(3.5), to: h(5), state: 'unknown' },
      ]),
    ).toBe(150);
  });
});

describe('reliability (decision 066)', () => {
  it('MTTR, MTBF, downtime and availability over a period', () => {
    const r = reliability(
      [
        { failedAt: h(10), restoredAt: h(14) },
        { failedAt: h(100), restoredAt: h(102) },
        { failedAt: h(-5), restoredAt: h(1) }, // started before the period: downtime clipped, not counted
      ],
      h(0),
      h(168),
      120,
      160,
    );
    expect(r).toEqual({ breakdowns: 2, downtimeHours: 7, mttrHours: 3, mtbfHours: 60, availability: 0.96 });
  });

  it('an open breakdown counts as down until the end; no breakdowns gives no MTTR or MTBF', () => {
    const r = reliability([{ failedAt: h(160), restoredAt: null }], h(0), h(168), 100, 160);
    expect(r).toMatchObject({ breakdowns: 1, downtimeHours: 8, mttrHours: null, mtbfHours: 100, availability: 0.95 });
    expect(reliability([], h(0), h(168), 100, 0)).toEqual({ breakdowns: 0, downtimeHours: 0, mttrHours: null, mtbfHours: null, availability: null });
  });
});
