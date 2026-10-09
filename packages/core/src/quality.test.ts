import { describe, expect, it } from 'vitest';
import { faiRequirement, gaugeBlock, inspectionOutcome, withinLimits } from './quality.js';

describe('withinLimits', () => {
  it('is inclusive at both limits and open on a missing one', () => {
    expect(withinLimits('10.02', '9.98', '10.02')).toBe(true);
    expect(withinLimits('10.021', '9.98', '10.02')).toBe(false);
    expect(withinLimits('9.979', '9.98', null)).toBe(false);
    expect(withinLimits('1000', null, null)).toBe(true);
  });
});

describe('gaugeBlock', () => {
  const g = { code: 'MIC-01', status: 'in_service' as const, dueDate: '2026-10-09' };
  it('allows a gauge on its due date and refuses the day after', () => {
    expect(gaugeBlock(g, '2026-10-09')).toBeNull();
    expect(gaugeBlock(g, '2026-10-10')).toMatch(/was due/);
  });
  it('refuses failed, out-of-service and never-calibrated gauges', () => {
    expect(gaugeBlock({ ...g, status: 'failed' }, '2026-01-01')).toMatch(/failed/);
    expect(gaugeBlock({ ...g, status: 'out_of_service' }, '2026-01-01')).toMatch(/out of service/);
    expect(gaugeBlock({ ...g, dueDate: null }, '2026-01-01')).toMatch(/no calibration/);
  });
});

describe('faiRequirement (AS9102 triggers)', () => {
  const base = { requiresFai: true, processChange: false, revision: 'C', approved: [] as { revision: string | null; approvedOn: string }[], today: '2026-10-09' };
  it('is not required unless the item asks for it', () => expect(faiRequirement({ ...base, requiresFai: false })).toBeNull());
  it('first build, revision change, process change and two-year lapse', () => {
    expect(faiRequirement(base)).toBe('first_build');
    expect(faiRequirement({ ...base, approved: [{ revision: 'B', approvedOn: '2026-01-01' }] })).toBe('revision_change');
    expect(faiRequirement({ ...base, processChange: true, approved: [{ revision: 'C', approvedOn: '2026-01-01' }] })).toBe('process_change');
    expect(faiRequirement({ ...base, approved: [{ revision: 'C', approvedOn: '2024-10-08' }] })).toBe('lapse');
    expect(faiRequirement({ ...base, approved: [{ revision: 'C', approvedOn: '2024-10-09' }] })).toBeNull();
  });
});

describe('inspectionOutcome', () => {
  it('pass, fail and partial, covering the lot exactly', () => {
    expect(inspectionOutcome('5', '5', '0')).toBe('pass');
    expect(inspectionOutcome('5', '0', '5')).toBe('fail');
    expect(inspectionOutcome('5', '3', '2')).toBe('partial');
    expect(() => inspectionOutcome('5', '3', '1')).toThrow(/add up to 5/);
  });
});
