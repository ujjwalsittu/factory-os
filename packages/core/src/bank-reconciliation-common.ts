import { Dec } from './decimal.js';
/** Exact DB-compatible decimal; never silently round imported evidence. */
export function bankMoney(value: string): Dec {
  if (!/^-?\d{1,18}(?:\.\d{1,6})?$/.test(value)) throw new Error('Invalid money precision or format');
  return Dec.of(value);
}
export function bankDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date format');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date');
  return value;
}
