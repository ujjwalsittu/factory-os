import { describe, expect, it } from 'vitest';
import { boardLabel, loadsAt, MSL_FLOOR_HOURS, pasteEventsAllowed, pasteState, reelClock, reelEventsAllowed, zplLabel } from './smt.js';

const t0 = Date.parse('2026-10-12T04:00:00Z');
const at = (h: number) => new Date(t0 + h * 3600_000);

describe('MSL floor-life clock (decision 065)', () => {
  it('runs while open, pauses in the dry cabinet and expires at the floor life', () => {
    const ev = [
      { kind: 'opened' as const, at: at(0) },
      { kind: 'cabinet_in' as const, at: at(100) },
      { kind: 'cabinet_out' as const, at: at(200) },
    ];
    expect(reelClock('3', ev, at(250))).toMatchObject({ phase: 'open', usedMinutes: 150 * 60, floorMinutes: 168 * 60, remainingMinutes: 18 * 60, needsBake: false });
    expect(reelClock('3', ev.slice(0, 2), at(500))).toMatchObject({ phase: 'cabinet', usedMinutes: 100 * 60, needsBake: false });
    expect(reelClock('3', ev, at(268))).toMatchObject({ remainingMinutes: 0, needsBake: true });
  });

  it('a bake resets the clock; resealing stops it', () => {
    const ev = [
      { kind: 'opened' as const, at: at(0) },
      { kind: 'resealed' as const, at: at(70) },
      { kind: 'opened' as const, at: at(500) },
    ];
    expect(reelClock('4', ev, at(502))).toMatchObject({ usedMinutes: 72 * 60, needsBake: true });
    const baked = [...ev, { kind: 'baked' as const, at: at(503) }, { kind: 'opened' as const, at: at(520) }];
    expect(reelClock('4', baked, at(530))).toMatchObject({ phase: 'open', usedMinutes: 600, needsBake: false });
  });

  it('MSL 1 and parts without a level never expire; MSL 6 needs a bake first and uses its label time', () => {
    const ev = [{ kind: 'opened' as const, at: at(0) }];
    expect(reelClock('1', ev, at(1e5))).toMatchObject({ floorMinutes: null, remainingMinutes: null, needsBake: false });
    expect(reelClock(null, ev, at(1e5)).needsBake).toBe(false);
    expect(reelClock('6', [], at(0), 6)).toMatchObject({ needsBake: true, floorMinutes: 360 });
    expect(reelClock('6', [{ kind: 'baked', at: at(0) }, { kind: 'opened', at: at(1) }], at(5), 6)).toMatchObject({ needsBake: false, remainingMinutes: 120 });
    expect(MSL_FLOOR_HOURS['2a']).toBe(672);
  });

  it('allows events by phase, and an empty reel takes none', () => {
    expect(reelEventsAllowed('sealed')).toContain('opened');
    expect(reelEventsAllowed('sealed')).not.toContain('cabinet_in');
    expect(reelEventsAllowed('cabinet')).toEqual(['cabinet_out', 'baked', 'empty']);
    expect(reelEventsAllowed('empty')).toEqual([]);
    expect(reelClock('3', [{ kind: 'opened', at: at(0) }, { kind: 'empty', at: at(500) }], at(600)).needsBake).toBe(false);
  });
});

describe('solder paste (decision 065)', () => {
  const rules = { thawMinutes: 240, openHours: 24, expiryDate: '2026-10-20' };
  it('thaws, is ready, opens and runs out of open time', () => {
    expect(pasteState([], at(0), rules)).toMatchObject({ phase: 'cold', usable: false });
    const out = [{ kind: 'out_of_fridge' as const, at: at(0) }];
    expect(pasteState(out, at(3), rules)).toMatchObject({ phase: 'thawing', usable: false, readyAt: at(4) });
    expect(pasteState(out, at(4), rules)).toMatchObject({ phase: 'ready', usable: true });
    const opened = [...out, { kind: 'opened' as const, at: at(5) }];
    expect(pasteState(opened, at(28), rules)).toMatchObject({ phase: 'open', usable: true, openUntil: at(29) });
    expect(pasteState(opened, at(29), rules)).toMatchObject({ phase: 'over_open_time', usable: false });
  });

  it('back in the fridge restarts the thaw; expiry is the end of the day in India', () => {
    const ev = [{ kind: 'out_of_fridge' as const, at: at(0) }, { kind: 'back_in_fridge' as const, at: at(1) }];
    expect(pasteState(ev, at(10), rules).phase).toBe('cold');
    const ready = [{ kind: 'out_of_fridge' as const, at: at(0) }];
    expect(pasteState(ready, new Date('2026-10-20T18:29:00Z'), rules).phase).toBe('ready');
    expect(pasteState(ready, new Date('2026-10-20T18:30:00Z'), rules)).toMatchObject({ phase: 'expired', usable: false });
    expect(pasteEventsAllowed('open')).toEqual(['empty']);
    expect(pasteEventsAllowed('ready')).toContain('back_in_fridge');
  });
});

describe('feeder setup at placement (decision 065)', () => {
  it('a panel sees the reels loaded when it was placed', () => {
    const loads = [
      { slot: 'F1', containerId: 'r1', loadedAt: at(0), unloadedAt: at(5) },
      { slot: 'F1', containerId: 'r2', loadedAt: at(5), unloadedAt: null },
      { slot: 'F2', containerId: 'r3', loadedAt: at(2), unloadedAt: null },
    ];
    expect(loadsAt(loads, at(1)).map((l) => l.containerId)).toEqual(['r1']);
    expect(loadsAt(loads, at(5)).map((l) => l.containerId)).toEqual(['r2', 'r3']); // a splice at 5: the new reel
    expect(loadsAt(loads, at(4.99)).map((l) => l.containerId)).toEqual(['r1', 'r3']);
  });
});

describe('ZPL labels (decision 065)', () => {
  const size = { dpi: 203, widthMm: 50, heightMm: 25 };
  it('prints a DataMatrix of the code and the text lines', () => {
    const z = zplLabel('P-WO-0001-001', ['P-WO-0001-001', 'WO-0001 · 4 boards'], size, 2);
    expect(z.startsWith('^XA')).toBe(true);
    expect(z.endsWith('^XZ')).toBe(true);
    expect(z).toContain('^PW400');
    expect(z).toContain('^LL200');
    expect(z).toContain('^BXN,3,200^FH_^FDP-WO-0001-001^FS');
    expect(z).toContain('^PQ2');
  });

  it("escapes characters that would end a field or start a command", () => {
    const z = zplLabel('A^XZ~B_C', ['x^y'], size);
    expect(z).toContain('^FDA_5EXZ_7EB_5FC^FS');
    expect(z).toContain('^FDx_5Ey^FS');
    expect(z.match(/\^XZ/g)).toHaveLength(1);
  });

  it('scales to the printer and keeps the text on the label', () => {
    const z = boardLabel({ serial: 'PCBA-000123', item: 'PCBA-OBC', revision: 'B' }, { dpi: 300, widthMm: 20, heightMm: 10 });
    expect(z).toContain('^BXN,4,200');
    expect(z).toContain('PCBA-OBC rev B');
    const many = zplLabel('X', ['1', '2', '3', '4', '5', '6', '7'], { dpi: 203, widthMm: 30, heightMm: 8 });
    expect(many.match(/\^A0N/g)!.length).toBeLessThan(5);
  });
});
