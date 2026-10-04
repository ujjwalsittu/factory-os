import { describe, expect, it } from 'vitest';
import { gstinCheckChar, isValidPan, validateGstin } from './gstin.js';

// Build valid samples from the algorithm so tests don't depend on real taxpayers.
const make = (first14: string) => first14 + gstinCheckChar(first14);

describe('validateGstin', () => {
  it('accepts a well-formed GSTIN and extracts state and PAN', () => {
    const g = make('27AAACA1234B1Z');
    const r = validateGstin(g.toLowerCase());
    expect(r).toEqual({ valid: true, gstin: g, stateCode: '27', stateName: 'Maharashtra', pan: 'AAACA1234B' });
  });
  it('matches the published GSTN checksum example', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
  });
  it('rejects a wrong check digit', () => {
    const g = make('27AAACA1234B1Z');
    const bad = g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A');
    expect(validateGstin(bad)).toMatchObject({ valid: false });
  });
  it('rejects bad format and unknown state', () => {
    expect(validateGstin('XYZ')).toMatchObject({ valid: false });
    expect(validateGstin(make('25AAACA1234B1Z'))).toMatchObject({ valid: false, reason: 'Unknown state code 25' });
  });
  it('validates PAN', () => {
    expect(isValidPan('aaaca1234b')).toBe(true);
    expect(isValidPan('AAAC1234B')).toBe(false);
  });
});
