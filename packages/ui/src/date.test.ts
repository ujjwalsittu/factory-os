import { describe, expect, it } from 'vitest';
import { formatDateIndian, parseDateIndian } from './date';

describe('Indian date format', () => {
  it('formats ISO dates as DD-MM-YYYY and ignores anything else', () => {
    expect(formatDateIndian('2026-10-13')).toBe('13-10-2026');
    expect(formatDateIndian('')).toBe('');
    expect(formatDateIndian('13-10-2026')).toBe('');
  });

  it('reads DD-MM-YYYY with -, / or . and pasted ISO dates', () => {
    expect(parseDateIndian('13-10-2026')).toBe('2026-10-13');
    expect(parseDateIndian('1/4/2026')).toBe('2026-04-01');
    expect(parseDateIndian('31.03.2027')).toBe('2027-03-31');
    expect(parseDateIndian(' 2026-10-13 ')).toBe('2026-10-13');
  });

  it('returns empty for an empty field and null for text that is not a real date', () => {
    expect(parseDateIndian('  ')).toBe('');
    expect(parseDateIndian('31-02-2026')).toBeNull();
    expect(parseDateIndian('29-02-2027')).toBeNull();
    expect(parseDateIndian('29-02-2028')).toBe('2028-02-29');
    expect(parseDateIndian('10/13/2026')).toBeNull();
    expect(parseDateIndian('13-10-26')).toBeNull();
    expect(parseDateIndian('soon')).toBeNull();
  });
});
