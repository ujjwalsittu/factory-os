import { allocateProportion } from './accounting.js';
import { Dec } from './decimal.js';

export type SettlementDirection = 'receipt' | 'payment';
const amount = /^\d+(?:\.\d{1,6})?$/;
function value(input: string): Dec {
  if (!amount.test(input)) throw new Error('Nonnegative amount with at most six decimal places required');
  return Dec.of(input);
}

/** Clear carrying value proportionally; the last allocation takes the exact residual. */
export function consumeCarryingValue(openAmount: string, carryingInr: string, allocatedAmount: string): string {
  const open = value(openAmount), carrying = value(carryingInr), allocated = value(allocatedAmount);
  if (!open.gt('0') || !allocated.gt('0') || allocated.gt(open))
    throw new Error('Allocation must be positive and within the open balance');
  return allocated.eq(open) ? carrying.toString() : allocateProportion(carrying.toString(), allocated.toString(), open.toString());
}

/** Positive is realized FX expense; negative is realized FX income. */
export function settlementDifference(direction: SettlementDirection, cashInr: string, carryingInr: string): string {
  const cash = value(cashInr), carrying = value(carryingInr);
  return (direction === 'payment' ? cash.sub(carrying) : carrying.sub(cash)).toString();
}
