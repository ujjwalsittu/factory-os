/**
 * Machine maintenance (decision 066): running hours from a tap's timeline, when a preventive plan falls due (calendar
 * and/or running hours, whichever first), and breakdown reliability figures (MTBF, MTTR, availability).
 */
import type { Segment } from './metering.js';

const DAY = 86400_000;

/** Minutes the machine was `running` in the given timeline segments (decision 063). */
export function meteredRunningMinutes(segments: Segment[]): number {
  let ms = 0;
  for (const s of segments) if (s.state === 'running') ms += s.to.getTime() - s.from.getTime();
  return Math.round(ms / 60_000);
}

export interface PlanInterval {
  everyDays: number | null;
  everyRunHours: number | null;
  /** Due-soon warning for the calendar interval. */
  leadDays: number;
}

export interface PlanBaseline {
  lastDoneAt: Date;
  /** Running hours since the baseline (since lastDoneAt). */
  runHoursSince: number;
}

export type DueStatus = 'ok' | 'due_soon' | 'overdue';

export interface PlanDue {
  status: DueStatus;
  /** Calendar due date, when the plan has a calendar interval. */
  dueAt: Date | null;
  /** Running hours left before due (negative when past), when the plan has a running-hours interval. */
  hoursLeft: number | null;
  /** What makes it due or due soon: the earlier of the two. */
  by: 'calendar' | 'hours' | null;
}

const RANK: Record<DueStatus, number> = { ok: 0, due_soon: 1, overdue: 2 };

/**
 * Whichever interval comes first decides. Calendar: overdue on or after the due date, due soon within the lead days.
 * Running hours: overdue at or past the interval, due soon within the last 10 % of it.
 */
export function planDue(p: PlanInterval, b: PlanBaseline, now: Date): PlanDue {
  if (p.everyDays == null && p.everyRunHours == null) throw new Error('A plan needs a calendar or running-hours interval');
  let calendar: DueStatus | null = null;
  let dueAt: Date | null = null;
  if (p.everyDays != null) {
    dueAt = new Date(b.lastDoneAt.getTime() + p.everyDays * DAY);
    calendar = now >= dueAt ? 'overdue' : now.getTime() >= dueAt.getTime() - p.leadDays * DAY ? 'due_soon' : 'ok';
  }
  let hours: DueStatus | null = null;
  let hoursLeft: number | null = null;
  if (p.everyRunHours != null) {
    hoursLeft = Math.round((p.everyRunHours - b.runHoursSince) * 10) / 10;
    hours = hoursLeft <= 0 ? 'overdue' : hoursLeft <= p.everyRunHours * 0.1 ? 'due_soon' : 'ok';
  }
  const c = calendar ?? 'ok';
  const h = hours ?? 'ok';
  const status = RANK[c] >= RANK[h] ? c : h;
  const by = status === 'ok' ? null : RANK[c] >= RANK[h] && calendar ? 'calendar' : 'hours';
  return { status, dueAt, hoursLeft, by };
}

export interface Breakdown {
  failedAt: Date;
  /** Null while still down. */
  restoredAt: Date | null;
}

export interface Reliability {
  breakdowns: number;
  /** Total breakdown downtime inside the period, in hours. */
  downtimeHours: number;
  /** Mean time to repair over breakdowns restored in the period, in hours; null with none. */
  mttrHours: number | null;
  /** Running hours in the period divided by breakdowns; null with none. */
  mtbfHours: number | null;
  /** Share of the planned time the machine was not down: (planned − downtime) / planned; null without planned time. */
  availability: number | null;
}

/**
 * Reliability of one machine over [from, to). Breakdowns count when they started in the period; downtime is clipped
 * to it; a breakdown still open counts as down until `to`.
 */
export function reliability(breakdowns: Breakdown[], from: Date, to: Date, runHours: number, plannedHours: number): Reliability {
  const inPeriod = breakdowns.filter((b) => b.failedAt >= from && b.failedAt < to);
  let downMs = 0;
  for (const b of breakdowns) {
    const s = Math.max(b.failedAt.getTime(), from.getTime());
    const e = Math.min((b.restoredAt ?? to).getTime(), to.getTime());
    if (e > s) downMs += e - s;
  }
  const restored = inPeriod.filter((b) => b.restoredAt);
  const round = (n: number) => Math.round(n * 100) / 100;
  const downtimeHours = round(downMs / 3600_000);
  return {
    breakdowns: inPeriod.length,
    downtimeHours,
    mttrHours: restored.length ? round(restored.reduce((s, b) => s + (b.restoredAt!.getTime() - b.failedAt.getTime()), 0) / restored.length / 3600_000) : null,
    mtbfHours: inPeriod.length ? round(runHours / inPeriod.length) : null,
    availability: plannedHours > 0 ? Math.max(0, round((plannedHours - downtimeHours) / plannedHours)) : null,
  };
}
