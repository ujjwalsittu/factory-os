import { describe, expect, it } from 'vitest';
import { machineTimeline, meterAgrees, occupiedMinutes, type StateEvent } from './metering.js';

const t0 = Date.parse('2026-10-12T04:00:00Z');
const at = (min: number) => new Date(t0 + min * 60_000);
const HB = 60_000;
/** A heartbeat every minute in the given state, from `a` to `b` minutes. */
const beats = (a: number, b: number, state: StateEvent['state']): StateEvent[] => Array.from({ length: b - a }, (_, i) => ({ at: at(a + i), state }));

describe('machine metering (decision 063)', () => {
  it('turns heartbeats into merged state segments', () => {
    const ev = [...beats(-5, 30, 'idle'), ...beats(30, 90, 'running'), ...beats(90, 120, 'idle')];
    const seg = machineTimeline(ev, at(0), at(120), HB);
    expect(seg.map((s) => [s.state, (s.to.getTime() - s.from.getTime()) / 60_000])).toEqual([
      ['idle', 30],
      ['running', 60],
      ['idle', 30],
    ]);
    expect(occupiedMinutes(seg)).toEqual({ minutes: 120, covered: true });
  });

  it('excludes off and maintenance from occupied time', () => {
    const ev = [...beats(0, 20, 'off'), ...beats(20, 50, 'running'), ...beats(50, 60, 'maintenance')];
    expect(occupiedMinutes(machineTimeline(ev, at(0), at(60), HB))).toEqual({ minutes: 30, covered: true });
  });

  it('marks a gap longer than 3 heartbeats unknown after one heartbeat of grace', () => {
    const ev = [...beats(0, 10, 'running'), ...beats(40, 60, 'running')];
    const seg = machineTimeline(ev, at(0), at(60), HB);
    expect(seg.find((s) => s.state === 'unknown')).toEqual({ from: at(10), to: at(40), state: 'unknown' });
    expect(occupiedMinutes(seg)).toEqual({ minutes: 30, covered: false });
  });

  it('tolerates gaps up to 3 heartbeats', () => {
    const ev: StateEvent[] = [
      { at: at(0), state: 'running' },
      { at: at(3), state: 'running' },
      { at: at(6), state: 'idle' },
    ];
    expect(occupiedMinutes(machineTimeline(ev, at(0), at(8), HB))).toEqual({ minutes: 8, covered: true });
  });

  it('is unknown before the first event and when nothing was received', () => {
    expect(occupiedMinutes(machineTimeline([], at(0), at(30), HB))).toEqual({ minutes: 0, covered: false });
    const late = machineTimeline(beats(10, 30, 'running'), at(0), at(30), HB);
    expect(late[0]).toEqual({ from: at(0), to: at(10), state: 'unknown' });
  });

  it('takes the state at the window start from the last earlier event', () => {
    const ev = beats(-3, 15, 'setup');
    expect(occupiedMinutes(machineTimeline(ev, at(0), at(15), HB))).toEqual({ minutes: 15, covered: true });
  });

  it('applies the meter within 10% of the timer when covered', () => {
    expect(meterAgrees(110, 100, true)).toBe(true);
    expect(meterAgrees(90, 100, true)).toBe(true);
    expect(meterAgrees(111, 100, true)).toBe(false);
    expect(meterAgrees(100, 100, false)).toBe(false);
    expect(meterAgrees(0, 0, true)).toBe(true);
    expect(meterAgrees(3, 0, true)).toBe(false);
  });
});
