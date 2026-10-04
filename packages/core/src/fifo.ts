import { Dec } from './decimal.js';

/** A FIFO cost layer: stock received at one rate that hasn't been consumed yet. */
export interface FifoLayer {
  id: string;
  /** Remaining quantity in the layer (stock UoM). */
  qty: Dec;
  /** Cost per unit. */
  rate: Dec;
}

export interface FifoConsumption {
  layerId: string;
  qty: Dec;
  rate: Dec;
  value: Dec;
}

export class InsufficientStockError extends Error {
  constructor(
    readonly requested: Dec,
    readonly available: Dec,
  ) {
    super(`Insufficient stock: requested ${requested.toFixed(3)}, available ${available.toFixed(3)}`);
  }
}

/**
 * Consume `qty` from layers in the given order (oldest first; the caller orders them).
 * Pure: returns what was consumed and does not mutate the input (decision 018: FIFO).
 */
export function consumeFifo(layers: readonly FifoLayer[], qty: Dec): { consumed: FifoConsumption[]; value: Dec } {
  if (!qty.gt(Dec.ZERO)) throw new Error('Quantity to consume must be positive');
  const available = layers.reduce((s, l) => s.add(l.qty), Dec.ZERO);
  if (available.lt(qty)) throw new InsufficientStockError(qty, available);

  const consumed: FifoConsumption[] = [];
  let remaining = qty;
  let value = Dec.ZERO;
  for (const layer of layers) {
    if (remaining.isZero()) break;
    if (!layer.qty.gt(Dec.ZERO)) continue;
    const take = Dec.min(layer.qty, remaining);
    const v = take.mul(layer.rate);
    consumed.push({ layerId: layer.id, qty: take, rate: layer.rate, value: v });
    value = value.add(v);
    remaining = remaining.sub(take);
  }
  return { consumed, value };
}

/** Weighted average rate of a consumption (for display on the issue line). */
export function averageRate(value: Dec, qty: Dec): Dec {
  return qty.isZero() ? Dec.ZERO : value.div(qty);
}
