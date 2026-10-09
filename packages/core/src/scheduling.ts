/**
 * Finite capacity scheduling (decision 049). Pure: the API loads calendars, blocks and open work, calls
 * `schedule`, and stores the placements.
 *
 * Time is in whole **epoch minutes** (UTC). Calendars are written in local wall-clock time and expanded with
 * the calendar's IANA time zone. Durations are rounded up to whole minutes.
 */

export interface Interval {
  start: number;
  end: number;
}

/** One weekly shift. `weekday` 1 = Monday … 7 = Sunday. An `end` at or before `start` runs past midnight and belongs to the day it starts. */
export interface Shift {
  weekday: number;
  start: string;
  end: string;
}

export interface CalendarSpec {
  timeZone: string;
  shifts: Shift[];
  /** ISO dates on which no shift starts. */
  holidays: string[];
}

export const toEpochMinutes = (d: Date | string | number) => Math.floor(new Date(d).getTime() / 60000);
export const fromEpochMinutes = (m: number) => new Date(m * 60000);

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    fmtCache.set(timeZone, f);
  }
  return f;
}

/** Local wall-clock parts of an instant in `timeZone`. */
export function localParts(epochMinutes: number, timeZone: string) {
  const p = Object.fromEntries(fmt(timeZone).formatToParts(fromEpochMinutes(epochMinutes)).map((x) => [x.type, x.value]));
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday!) + 1;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday };
}

/** The instant at local `date` `time` in `timeZone` (exact for zones without DST; the second pass settles DST edges). */
export function zonedEpochMinutes(date: string, time: string, timeZone: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi) / 60000;
  const offset = (at: number) => {
    const l = localParts(at, timeZone);
    const [ly, lm, ld] = l.date.split('-').map(Number) as [number, number, number];
    return Date.UTC(ly, lm - 1, ld, l.hour, l.minute) / 60000 - at;
  };
  let t = wall - offset(wall);
  t = wall - offset(t);
  return t;
}

const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isoWeekday = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const hm = (t: string) => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Sorts and merges touching or overlapping intervals; drops empty ones. */
export function normalize(xs: Interval[]): Interval[] {
  const s = xs.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

/** Working time of a calendar between `from` and `to`, clipped to that window. */
export function workingIntervals(cal: CalendarSpec, from: number, to: number): Interval[] {
  if (to <= from) return [];
  const holidays = new Set(cal.holidays);
  const out: Interval[] = [];
  // Start a day early so a shift that began yesterday evening and runs past midnight is included.
  let day = addDaysIso(localParts(from, cal.timeZone).date, -1);
  const lastDay = localParts(to, cal.timeZone).date;
  while (day <= lastDay) {
    if (!holidays.has(day)) {
      const wd = isoWeekday(day);
      for (const sh of cal.shifts) {
        if (sh.weekday !== wd) continue;
        const start = zonedEpochMinutes(day, sh.start, cal.timeZone);
        const length = (hm(sh.end) - hm(sh.start) + 1440) % 1440 || 1440;
        out.push({ start: Math.max(start, from), end: Math.min(start + length, to) });
      }
    }
    day = addDaysIso(day, 1);
  }
  return normalize(out);
}

/** `free` minus every interval in `taken`. */
export function subtract(free: Interval[], taken: Interval[]): Interval[] {
  let out = normalize(free);
  for (const t of normalize(taken)) {
    const next: Interval[] = [];
    for (const f of out) {
      if (t.end <= f.start || t.start >= f.end) next.push(f);
      else {
        if (t.start > f.start) next.push({ start: f.start, end: t.start });
        if (t.end < f.end) next.push({ start: t.end, end: f.end });
      }
    }
    out = next;
  }
  return out;
}

/**
 * Places `minutes` of work into `free` starting no earlier than `earliest`, continuing across breaks.
 * Returns the segments used, or null when the free time runs out first. Zero minutes occupy nothing.
 */
export function allocate(free: Interval[], earliest: number, minutes: number): { start: number; end: number; segments: Interval[] } | null {
  let left = Math.ceil(minutes);
  if (left <= 0) {
    const first = free.find((f) => f.end > earliest);
    if (!first) return null;
    const at = Math.max(first.start, earliest);
    return { start: at, end: at, segments: [] };
  }
  const segments: Interval[] = [];
  for (const f of free) {
    if (f.end <= earliest) continue;
    const s = Math.max(f.start, earliest);
    const take = Math.min(f.end - s, left);
    segments.push({ start: s, end: s + take });
    left -= take;
    if (left === 0) return { start: segments[0]!.start, end: s + take, segments };
  }
  return null;
}

export interface SchedOp {
  id: string;
  seq: number;
  /** Null only for outsourced operations. */
  workCentreId: string | null;
  outsourced: boolean;
  /** Setup + run minutes still to do. */
  minutes: number;
  /** Outsourced: calendar days at the job worker. */
  leadDays?: number;
  /** Outsourced pieces already sent: the lead time counts from here. */
  sentAt?: number | null;
  /** Placed by a planner and kept on re-run. */
  pinned?: { machineId: string; start: number; end: number } | null;
  /** A running or paused job card: anchored on its machine from its actual start. */
  running?: { machineId: string; start: number } | null;
}

export interface SchedOrder {
  id: string;
  /** 1 = highest … 5. */
  priority: number;
  /** End of the due day, as an instant; null = no due date. */
  dueAt: number | null;
  releasedAt: number;
  /** The work order's own planned start, if any. */
  earliestStart: number | null;
  ops: SchedOp[];
}

export interface SchedMachine {
  id: string;
  workCentreId: string;
  /** Working time minus blocks over the horizon. */
  free: Interval[];
}

export interface Placement {
  opId: string;
  orderId: string;
  machineId: string | null;
  start: number;
  end: number;
  pinned: boolean;
  running: boolean;
}

export interface ScheduleResult {
  placements: Placement[];
  unscheduled: { opId: string; orderId: string; reason: string }[];
  /** Pinned operations that start before the previous operation finishes. */
  conflicts: { opId: string; orderId: string; reason: string }[];
  orders: { orderId: string; finish: number | null; late: boolean }[];
}

/** Grace added to an overrunning job card so its successors move. */
export const OVERRUN_MINUTES = 15;

/**
 * Forward finite scheduling: pinned and running operations first, as fixed; then work orders by priority, due
 * date (none last) and release time, each operation in sequence on the machine of its work centre where it
 * finishes earliest (ties to the machine listed first). Outsourced operations take their lead time off-machine.
 */
export function schedule(input: { now: number; orders: SchedOrder[]; machines: SchedMachine[] }): ScheduleResult {
  const { now } = input;
  const free = new Map(input.machines.map((m) => [m.id, normalize(m.free)]));
  const byCentre = new Map<string, string[]>();
  for (const m of input.machines) byCentre.set(m.workCentreId, [...(byCentre.get(m.workCentreId) ?? []), m.id]);
  const result: ScheduleResult = { placements: [], unscheduled: [], conflicts: [], orders: [] };
  const fixedEnd = new Map<string, Placement>();

  // 1. Fixed work reserves its machine time before anything else is placed.
  for (const o of input.orders)
    for (const op of o.ops) {
      if (op.running && free.has(op.running.machineId)) {
        // The rest of its work from now; when it has already run over its plan, a short grace instead.
        const f = free.get(op.running.machineId)!;
        const a = op.minutes > 0 ? allocate(f, now, op.minutes) : null;
        const taken = a ? a.segments : [{ start: now, end: now + (op.minutes > 0 ? Math.ceil(op.minutes) : OVERRUN_MINUTES) }];
        const end = taken[taken.length - 1]!.end;
        free.set(op.running.machineId, subtract(f, taken));
        fixedEnd.set(op.id, { opId: op.id, orderId: o.id, machineId: op.running.machineId, start: op.running.start, end, pinned: false, running: true });
      } else if (op.pinned && free.has(op.pinned.machineId)) {
        free.set(op.pinned.machineId, subtract(free.get(op.pinned.machineId)!, [{ start: op.pinned.start, end: op.pinned.end }]));
        fixedEnd.set(op.id, { opId: op.id, orderId: o.id, machineId: op.pinned.machineId, start: op.pinned.start, end: op.pinned.end, pinned: true, running: false });
      }
    }

  const orders = [...input.orders].sort((a, b) => a.priority - b.priority || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.releasedAt - b.releasedAt);
  for (const o of orders) {
    let cursor = Math.max(now, o.earliestStart ?? now);
    let finish: number | null = null;
    let blocked: string | null = null;
    for (const op of [...o.ops].sort((a, b) => a.seq - b.seq)) {
      const fixed = fixedEnd.get(op.id);
      if (fixed) {
        if (fixed.pinned && fixed.start < cursor) result.conflicts.push({ opId: op.id, orderId: o.id, reason: `Starts before operation ${op.seq}'s predecessor finishes` });
        result.placements.push(fixed);
        cursor = Math.max(cursor, fixed.end);
        finish = cursor;
        continue;
      }
      if (blocked) {
        result.unscheduled.push({ opId: op.id, orderId: o.id, reason: blocked });
        continue;
      }
      if (op.minutes <= 0 && !op.outsourced) continue;
      if (op.outsourced) {
        const start = op.sentAt ?? cursor;
        const end = Math.max(start + Math.round((op.leadDays ?? 7) * 1440), cursor);
        result.placements.push({ opId: op.id, orderId: o.id, machineId: null, start, end, pinned: false, running: false });
        cursor = end;
        finish = end;
        continue;
      }
      const machines = op.workCentreId ? (byCentre.get(op.workCentreId) ?? []) : [];
      if (!machines.length) {
        result.unscheduled.push({ opId: op.id, orderId: o.id, reason: 'No active machine in the work centre' });
        blocked = 'A previous operation could not be scheduled';
        continue;
      }
      let best: { machineId: string; a: NonNullable<ReturnType<typeof allocate>> } | null = null;
      for (const id of machines) {
        const a = allocate(free.get(id)!, cursor, op.minutes);
        if (a && (!best || a.end < best.a.end)) best = { machineId: id, a };
      }
      if (!best) {
        result.unscheduled.push({ opId: op.id, orderId: o.id, reason: 'No working time left within the horizon' });
        blocked = 'A previous operation could not be scheduled';
        continue;
      }
      free.set(best.machineId, subtract(free.get(best.machineId)!, best.a.segments));
      result.placements.push({ opId: op.id, orderId: o.id, machineId: best.machineId, start: best.a.start, end: best.a.end, pinned: false, running: false });
      cursor = best.a.end;
      finish = cursor;
    }
    result.orders.push({ orderId: o.id, finish: blocked ? null : finish, late: !blocked && finish !== null && o.dueAt !== null && finish > o.dueAt });
  }
  return result;
}

/** The first pair of shifts that overlap within the week (night shifts wrap into the next day, Sunday into Monday), or null. */
export function overlappingShifts(shifts: Shift[]): [Shift, Shift] | null {
  const week = 7 * 1440;
  const spans = shifts.map((s) => {
    const start = (s.weekday - 1) * 1440 + hm(s.start);
    return { s, start, end: start + ((hm(s.end) - hm(s.start) + 1440) % 1440 || 1440) };
  });
  for (let i = 0; i < spans.length; i++)
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i]!;
      const b = spans[j]!;
      // Compare b against a and against a shifted by a week either way, for the Sunday-night wrap.
      if ([-week, 0, week].some((k) => b.start < a.end + k && a.start + k < b.end)) return [a.s, b.s];
    }
  return null;
}
