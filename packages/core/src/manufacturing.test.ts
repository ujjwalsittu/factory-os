import { describe, expect, it } from 'vitest';
import { absorptionValue, nextJobCardState, outputValue, runningMinutes, scaleBomQty } from './manufacturing.js';

describe('outputValue', () => {
  it('takes the proportional share for a partial output', () => {
    expect(outputValue({ wipBalance: '1000', outputQty: '3', plannedQty: '10', producedQty: '0' })).toBe('300.000000');
  });
  it('takes the whole balance when the planned quantity is reached', () => {
    expect(outputValue({ wipBalance: '700', outputQty: '7', plannedQty: '10', producedQty: '3' })).toBe('700.000000');
  });
  it('takes the whole remaining balance on over-production', () => {
    expect(outputValue({ wipBalance: '50', outputQty: '2', plannedQty: '10', producedQty: '10' })).toBe('50.000000');
  });
  it('is zero when nothing is left in WIP', () => {
    expect(outputValue({ wipBalance: '0', outputQty: '1', plannedQty: '10', producedQty: '0' })).toBe('0.000000');
  });
  it('splits a balance that does not divide evenly without losing a paisa', () => {
    const first = outputValue({ wipBalance: '100', outputQty: '1', plannedQty: '3', producedQty: '0' });
    expect(first).toBe('33.333333');
    const second = outputValue({ wipBalance: '66.666667', outputQty: '2', plannedQty: '3', producedQty: '1' });
    expect(second).toBe('66.666667');
  });
  it('refuses a non-positive quantity', () => {
    expect(() => outputValue({ wipBalance: '1', outputQty: '0', plannedQty: '1', producedQty: '0' })).toThrow();
  });
});

describe('scaleBomQty', () => {
  it('scales per BOM quantity to the planned quantity', () => {
    expect(scaleBomQty('2.5', '1', '40')).toBe('100.000000');
    expect(scaleBomQty('1', '3', '1')).toBe('0.333333');
    expect(scaleBomQty('0.340', '1', '12')).toBe('4.080000');
  });
});

describe('absorptionValue', () => {
  it('values minutes at the hourly rate', () => {
    expect(absorptionValue('90', '1200')).toBe('1800.000000');
    expect(absorptionValue('1', '1000')).toBe('16.666667');
  });
});

describe('job card time', () => {
  it('follows start → pause → resume → stop', () => {
    expect(nextJobCardState('open', 'start')).toBe('running');
    expect(nextJobCardState('running', 'pause')).toBe('paused');
    expect(nextJobCardState('paused', 'resume')).toBe('running');
    expect(nextJobCardState('paused', 'stop')).toBe('completed');
    expect(() => nextJobCardState('open', 'stop')).toThrow(/can only start/);
    expect(() => nextJobCardState('completed', 'start')).toThrow(/already completed/);
  });
  it('counts only running intervals', () => {
    const t = (m: number) => new Date(Date.UTC(2026, 9, 7, 9, m));
    const events = [
      { kind: 'start' as const, at: t(0) },
      { kind: 'pause' as const, at: t(25) },
      { kind: 'resume' as const, at: t(40) },
      { kind: 'stop' as const, at: t(55) },
    ];
    expect(runningMinutes(events)).toBe('40.000000');
  });
  it('counts a running card up to now', () => {
    const start = new Date(Date.UTC(2026, 9, 7, 9, 0));
    expect(runningMinutes([{ kind: 'start', at: start }], new Date(start.getTime() + 90_000))).toBe('1.500000');
  });
});
