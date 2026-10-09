import { Dec } from './decimal.js';
import { addYears } from './job-work.js';

/** Quality rules (decision 048). */

/** A measured value passes when it lies within the inclusive limits; a missing limit is unbounded on that side. */
export function withinLimits(measured: string, lower: string | null, upper: string | null): boolean {
  const m = Dec.of(measured);
  if (lower !== null && m.lt(lower)) return false;
  if (upper !== null && m.gt(upper)) return false;
  return true;
}

export type GaugeStatus = 'in_service' | 'out_of_service' | 'failed';

/** Why a gauge can't be used on `today`, or null when it can. A due date is still in calibration on that day. */
export function gaugeBlock(g: { code: string; status: GaugeStatus; dueDate: string | null }, today: string): string | null {
  if (g.status === 'failed') return `Gauge ${g.code} failed calibration`;
  if (g.status === 'out_of_service') return `Gauge ${g.code} is out of service`;
  if (!g.dueDate) return `Gauge ${g.code} has no calibration record`;
  if (today > g.dueDate) return `Gauge ${g.code} was due for calibration on ${g.dueDate}`;
  return null;
}

/** ISO date plus whole days. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type FaiReason = 'first_build' | 'revision_change' | 'process_change' | 'lapse';

/**
 * AS9102 triggers for an item flagged `requires_fai`: no approved FAI yet, none for the current revision, a
 * process change since the last one, or more than two years since the last approval. Null = not required.
 */
export function faiRequirement(input: {
  requiresFai: boolean;
  processChange: boolean;
  revision: string | null;
  approved: { revision: string | null; approvedOn: string }[];
  today: string;
}): FaiReason | null {
  if (!input.requiresFai) return null;
  if (!input.approved.length) return 'first_build';
  const forRevision = input.approved.filter((a) => (a.revision ?? '') === (input.revision ?? ''));
  if (!forRevision.length) return 'revision_change';
  if (input.processChange) return 'process_change';
  const last = forRevision.map((a) => a.approvedOn).sort().at(-1)!;
  if (input.today > addYears(last, 2)) return 'lapse';
  return null;
}

/** Inspection outcome from the accepted and rejected quantities; together they must cover the lot exactly. */
export function inspectionOutcome(qty: string, accepted: string, rejected: string): 'pass' | 'fail' | 'partial' {
  const a = Dec.of(accepted);
  const r = Dec.of(rejected);
  if (a.lt('0') || r.lt('0')) throw new Error('Quantities cannot be negative');
  if (!a.add(r).eq(qty)) throw new Error(`Accepted and rejected must add up to ${Dec.of(qty).toString().replace(/\.?0+$/, '')}`);
  if (r.isZero()) return 'pass';
  if (a.isZero()) return 'fail';
  return 'partial';
}
