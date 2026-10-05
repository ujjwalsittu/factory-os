import { Dec } from './decimal.js';
import { describe, expect, it } from 'vitest';
import * as accounting from './index.js';
// Removing exact validation, immutable reversal, or the FX split breaks these tests.
const debit = (amount: string) => ({
  accountId: 'asset',
  debit: amount,
  credit: '0',
});
const credit = (amount: string) => ({
  accountId: 'liability',
  debit: '0',
  credit: amount,
});
describe('accounting', () => {
  it('balances exact six-decimal amounts', () => {
    expect(accounting.assertBalanced).toBeTypeOf('function');
    expect(() =>
      accounting.assertBalanced([debit('100.000001'), credit('100.000001')]),
    ).not.toThrow();
    expect(() =>
      accounting.assertBalanced([debit('100.000001'), credit('100.000000')]),
    ).toThrow(/balance/i);
  });
  it.each(['-1', '0', '1.0000001', 'NaN', '1e3'])(
    'rejects invalid positive line %s',
    (amount) => {
      expect(accounting.assertBalanced).toBeTypeOf('function');
      expect(() =>
        accounting.assertBalanced([debit(amount), credit(amount)]),
      ).toThrow();
    },
  );
  it('rejects both sides, empty accounts, empty and one-line journals', () => {
    expect(accounting.assertBalanced).toBeTypeOf('function');
    for (const lines of [
      [],
      [debit('1')],
      [{ accountId: 'a', debit: '1', credit: '1' }],
      [{ ...debit('1'), accountId: '' }, credit('1')],
    ])
      expect(() => accounting.assertBalanced(lines)).toThrow();
  });
  it('reverses without changing accounts or references', () => {
    expect(accounting.reverseLines).toBeTypeOf('function');
    const lines = [
      { ...debit('1.234567'), partyId: 'p', billReference: 'INV-1' },
      credit('1.234567'),
    ];
    const original = structuredClone(lines);
    const reversed = accounting.reverseLines(lines);
    expect(reversed[0]).toEqual({
      ...lines[0],
      debit: '0',
      credit: '1.234567',
    });
    expect(accounting.reverseLines(reversed)).toEqual(original);
    expect(lines).toEqual(original);
  });
  it('separates price and FX variance exactly', () => {
    expect(accounting.purchaseVariance).toBeTypeOf('function');
    expect(
      accounting.purchaseVariance({
        qty: '2',
        poRate: '10',
        invoiceRate: '12',
        poExchangeRate: '80',
        invoiceExchangeRate: '85',
      }),
    ).toEqual({ price: '320.000000', forex: '120.000000' });
    expect(
      accounting.purchaseVariance({
        qty: '2',
        poRate: '12',
        invoiceRate: '10',
        poExchangeRate: '85',
        invoiceExchangeRate: '80',
      }),
    ).toEqual({ price: '-340.000000', forex: '-100.000000' });
  });
});

describe('acquisition cost', () => {
  it('capitalizes only actual remaining-layer value and expenses consumed share', () => {
    expect(accounting.splitAcquisitionCost).toBeTypeOf('function');
    expect(
      accounting.splitAcquisitionCost({
        amount: '100',
        quantity: '10',
        remaining: '6',
        oldRate: '10',
      }),
    ).toEqual({
      newRate: '20.000000',
      inventory: '60.000000',
      consumed: '40.000000',
      rounding: '0.000000',
    });
    expect(
      accounting.splitAcquisitionCost({
        amount: '100',
        quantity: '10',
        remaining: '0',
        oldRate: '10',
      }),
    ).toEqual({
      newRate: '10.000000',
      inventory: '0.000000',
      consumed: '100.000000',
      rounding: '0.000000',
    });
  });
  it('separates rounding residual from consumption and refuses impossible allocations', () => {
    expect(accounting.splitAcquisitionCost).toBeTypeOf('function');
    expect(
      accounting.splitAcquisitionCost({
        amount: '0.01',
        quantity: '3',
        remaining: '3',
        oldRate: '1',
      }),
    ).toEqual({
      newRate: '1.003333',
      inventory: '0.009999',
      consumed: '0.000000',
      rounding: '0.000001',
    });
    expect(() =>
      accounting.splitAcquisitionCost({
        amount: '-1',
        quantity: '10',
        remaining: '6',
        oldRate: '1',
      }),
    ).toThrow();
    expect(() =>
      accounting.splitAcquisitionCost({
        amount: '1',
        quantity: '10',
        remaining: '11',
        oldRate: '1',
      }),
    ).toThrow();
  });
});

it('never disguises rate precision as consumed acquisition cost', () => {
  const split = accounting.splitAcquisitionCost({
    amount: '0.01',
    quantity: '15000',
    remaining: '15000',
    oldRate: '0.000004',
  });
  expect(Dec.of(split.inventory).gt('0.01')).toBe(false);
  expect(split.consumed).toBe('0.000000');
  expect(split).toHaveProperty('rounding');
});
