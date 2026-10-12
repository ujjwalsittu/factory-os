/**
 * Machine-hour metering (decision 063). A machine's state events become intervals: each event's state lasts until the
 * next event, unless the gap is longer than 3 heartbeats; then the state is kept for one heartbeat and the rest is
 * unknown. Occupied time is everything known except off and maintenance; a window is covered when nothing is unknown.
 */
export type MachineState = 'off' | 'idle' | 'setup' | 'running' | 'alarm' | 'maintenance';
export interface StateEvent {
  at: Date;
  state: MachineState;
}
export interface Segment {
  from: Date;
  to: Date;
  state: MachineState | 'unknown';
}

const NOT_OCCUPIED: ReadonlySet<MachineState> = new Set(['off', 'maintenance']);

/**
 * Segments covering [from, to). `events` are sorted by time and may start before `from` (the last earlier event gives
 * the state at `from`); `heartbeatMs` is the tap's heartbeat.
 */
export function machineTimeline(events: StateEvent[], from: Date, to: Date, heartbeatMs: number): Segment[] {
  if (to <= from) return [];
  const out: Segment[] = [];
  const push = (a: number, b: number, state: Segment['state']) => {
    const s = Math.max(a, from.getTime());
    const e = Math.min(b, to.getTime());
    if (e <= s) return;
    const last = out.at(-1);
    if (last && last.state === state && last.to.getTime() === s) last.to = new Date(e);
    else out.push({ from: new Date(s), to: new Date(e), state });
  };
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = sorted[0];
  if (!first || first.at.getTime() > from.getTime()) push(from.getTime(), first ? first.at.getTime() : to.getTime(), 'unknown');
  sorted.forEach((ev, i) => {
    const start = ev.at.getTime();
    const next = sorted[i + 1]?.at.getTime() ?? to.getTime();
    if (next - start <= 3 * heartbeatMs) push(start, next, ev.state);
    else {
      push(start, start + heartbeatMs, ev.state);
      push(start + heartbeatMs, next, 'unknown');
    }
  });
  return out;
}

/** Occupied minutes (rounded) and whether the meter covered the whole window. */
export function occupiedMinutes(segments: Segment[]) {
  let ms = 0;
  let covered = true;
  for (const s of segments) {
    const d = s.to.getTime() - s.from.getTime();
    if (s.state === 'unknown') covered = false;
    else if (!NOT_OCCUPIED.has(s.state)) ms += d;
  }
  return { minutes: Math.round(ms / 60_000), covered };
}

/** Decision 063: metered minutes replace the timer automatically when covered and within 10% of it. */
export function meterAgrees(meteredMinutes: number, timerMinutes: number, covered: boolean) {
  if (!covered) return false;
  if (timerMinutes <= 0) return meteredMinutes === 0;
  return Math.abs(meteredMinutes - timerMinutes) <= 0.1 * timerMinutes;
}
