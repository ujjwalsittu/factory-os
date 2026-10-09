import { describe, expect, it } from 'vitest';
import { addYears, allocateOldestFirst, deadlineState, itc04Period, jobWorkDueBy, maxExtendedDueBy } from './job-work.js';

describe('job work deadlines (Sec 143)', () => {
  it('gives inputs one year and capital goods three', () => {
    expect(jobWorkDueBy('2026-10-09', 'input', false)).toBe('2027-10-09');
    expect(jobWorkDueBy('2026-10-09', 'capital_good', false)).toBe('2029-10-09');
  });
  it('exempts capital-goods tools but never inputs', () => {
    expect(jobWorkDueBy('2026-10-09', 'capital_good', true)).toBeNull();
    expect(jobWorkDueBy('2026-10-09', 'input', true)).toBe('2027-10-09');
  });
  it('moves 29 February back to 28 February', () => {
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2028-02-29', 4)).toBe('2032-02-29');
  });
  it('caps extensions at one more year for inputs and two for capital goods', () => {
    expect(maxExtendedDueBy('2027-10-09', 'input')).toBe('2028-10-09');
    expect(maxExtendedDueBy('2029-10-09', 'capital_good')).toBe('2031-10-09');
  });
  it('flags amber 30 days out and red after the deadline day', () => {
    expect(deadlineState('2027-10-09', '2027-09-08')).toBe('open');
    expect(deadlineState('2027-10-09', '2027-09-09')).toBe('due_soon');
    expect(deadlineState('2027-10-09', '2027-10-09')).toBe('due_soon');
    expect(deadlineState('2027-10-09', '2027-10-10')).toBe('overdue');
    expect(deadlineState(null, '2099-01-01')).toBe('open');
  });
});

describe('ITC-04 period (rule 45(3))', () => {
  it('splits half-yearly at 1 April and 1 October, due on the 25th of the next month', () => {
    expect(itc04Period('2026-10-09', 'half_yearly')).toEqual({ label: '2026-27 H2', from: '2026-10-01', to: '2027-03-31', due: '2027-04-25' });
    expect(itc04Period('2026-09-30', 'half_yearly')).toEqual({ label: '2026-27 H1', from: '2026-04-01', to: '2026-09-30', due: '2026-10-25' });
    expect(itc04Period('2027-02-01', 'half_yearly').label).toBe('2026-27 H2');
  });
  it('uses the financial year when annual', () => {
    expect(itc04Period('2027-03-31', 'annual')).toEqual({ label: '2026-27', from: '2026-04-01', to: '2027-03-31', due: '2027-04-25' });
  });
});

describe('allocateOldestFirst', () => {
  const lines = [
    { id: 'a', open: '2.5' },
    { id: 'b', open: '0' },
    { id: 'c', open: '4' },
  ];
  it('consumes the oldest open lines first, exactly', () => {
    expect(allocateOldestFirst('3', lines)).toEqual([
      { id: 'a', qty: '2.500000' },
      { id: 'c', qty: '0.500000' },
    ]);
  });
  it('refuses more than is open', () => {
    expect(() => allocateOldestFirst('6.6', lines)).toThrow(/Only 6.500000 is open/);
    expect(() => allocateOldestFirst('0', lines)).toThrow();
  });
});
