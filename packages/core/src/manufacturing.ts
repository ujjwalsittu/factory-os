// Manufacturing arithmetic (decision 044): actual costing of work orders, job-card time and BOM scaling.
import { allocateProportion } from './accounting.js';
import { Dec } from './decimal.js';

/**
 * Value of an output receipt. Each output takes its share of what is still in WIP for the quantity
 * still to make; the output that reaches (or passes) the planned quantity takes the whole balance.
 */
export function outputValue(input: { wipBalance: string; outputQty: string; plannedQty: string; producedQty: string }): string {
  const wip = Dec.of(input.wipBalance);
  const q = Dec.of(input.outputQty);
  if (!q.gt(Dec.ZERO)) throw new Error('Output quantity must be positive');
  if (!wip.gt(Dec.ZERO)) return Dec.ZERO.toString();
  const remaining = Dec.of(input.plannedQty).sub(input.producedQty);
  if (!remaining.gt(q)) return wip.toString();
  return Dec.min(wip, Dec.of(allocateProportion(wip.toString(), q.toString(), remaining.toString()))).toString();
}

/** Material for `plannedQty` from a BOM line given per `bomQty` made. */
export function scaleBomQty(lineQty: string, bomQty: string, plannedQty: string): string {
  const b = Dec.of(bomQty);
  if (!b.gt(Dec.ZERO)) throw new Error('BOM quantity must be positive');
  // One rounding at the end: line × planned / bom, all at 6 places.
  const n = Dec.of(lineQty).raw * Dec.of(plannedQty).raw;
  const q = (n + b.raw / 2n) / b.raw;
  return Dec.of(q).div('1000000').toString();
}

/** Cost absorbed into WIP by a job card: minutes / 60 × hourly rate. */
export function absorptionValue(minutes: string, hourlyRate: string): string {
  const n = Dec.of(minutes).raw * Dec.of(hourlyRate).raw;
  const d = 60n * 1_000_000n;
  return Dec.of((n + d / 2n) / d).div('1000000').toString();
}

export type JobCardEventKind = 'start' | 'pause' | 'resume' | 'stop';
export type JobCardState = 'open' | 'running' | 'paused' | 'completed';

const NEXT: Record<JobCardState, Partial<Record<JobCardEventKind, JobCardState>>> = {
  open: { start: 'running' },
  running: { pause: 'paused', stop: 'completed' },
  paused: { resume: 'running', stop: 'completed' },
  completed: {},
};

/** The state after an event, or an error naming what is allowed. */
export function nextJobCardState(state: JobCardState, kind: JobCardEventKind): JobCardState {
  const next = NEXT[state][kind];
  if (!next) {
    const allowed = Object.keys(NEXT[state]);
    throw new Error(allowed.length ? `A ${state} job card can only ${allowed.join(' or ')}` : 'This job card is already completed');
  }
  return next;
}

/** Running minutes (6 places) between start/resume and pause/stop; a card still running counts up to `now`. */
export function runningMinutes(events: readonly { kind: JobCardEventKind; at: Date | string }[], now: Date = new Date()): string {
  let total = 0n;
  let since: number | null = null;
  for (const e of events) {
    const t = new Date(e.at).getTime();
    if (e.kind === 'start' || e.kind === 'resume') since = t;
    else if (since !== null) {
      total += BigInt(Math.max(0, t - since));
      since = null;
    }
  }
  if (since !== null) total += BigInt(Math.max(0, now.getTime() - since));
  // Milliseconds → minutes with 6 places, rounded half up.
  const micro = (total * 1_000_000n + 30_000n) / 60_000n;
  return Dec.of(micro).div('1000000').toString();
}

/** Splits a value equally over `count` units at 6 places; the last unit takes the exact remainder. */
export function splitEqually(total: string, count: number): string[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('Count must be a positive whole number');
  const t = Dec.of(total);
  const each = t.div(String(count));
  const out = Array.from({ length: count - 1 }, () => each.toString());
  out.push(t.sub(each.mul(String(count - 1))).toString());
  return out;
}

/** Serial number from an item prefix and a running number, e.g. BRK-000041 (decision 046). */
export function formatSerial(prefix: string, value: number, width = 6): string {
  if (!Number.isInteger(value) || value < 1) throw new Error('Serial counter must be a positive whole number');
  const p = prefix.trim().toUpperCase();
  return `${p}${p && !/[-/]$/.test(p) ? '-' : ''}${String(value).padStart(width, '0')}`;
}

/** True when a quantity is a whole number of units (serial-tracked items move in whole units). */
export function isWholeUnits(qty: string): boolean {
  const q = Dec.of(qty);
  return q.gt('0') && q.raw % 1_000_000n === 0n;
}
