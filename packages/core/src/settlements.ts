import { allocateProportion } from './accounting.js';
import { Dec } from './decimal.js';

export type SettlementDirection = 'receipt' | 'payment';

/**
 * INR carrying value consumed when `allocatedAmount` (document currency) settles part of a bill that still has
 * `openAmount` open, carried at `carryingInr`. Rounds once; the final allocation takes the exact remainder, so
 * repeated partial settlements never leave or overdraw a residual.
 */
export function consumeCarryingValue(openAmount: string, carryingInr: string, allocatedAmount: string): string {
  const open = Dec.of(openAmount);
  const allocated = Dec.of(allocatedAmount);
  if (!allocated.gt('0')) throw new Error('Allocated amount must be positive');
  if (allocated.gt(open)) throw new Error('Allocation exceeds the open amount');
  if (Dec.of(carryingInr).lt('0')) throw new Error('Carrying value cannot be negative');
  if (allocated.eq(open)) return Dec.of(carryingInr).toFixed(6);
  return allocateProportion(carryingInr, allocatedAmount, openAmount);
}

/**
 * Exchange difference between the cash moved (INR at the settlement rate) and the carrying value it clears.
 * Positive = expense (loss, debit FX); negative = income (gain, credit FX).
 */
export function settlementDifference(direction: SettlementDirection, cashInr: string, carryingInr: string): string {
  const cash = Dec.of(cashInr);
  const carrying = Dec.of(carryingInr);
  return (direction === 'receipt' ? carrying.sub(cash) : cash.sub(carrying)).toFixed(6);
}
