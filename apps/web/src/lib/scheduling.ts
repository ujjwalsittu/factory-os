// Finite capacity scheduling (decision 049).

export const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface Shift {
  weekday: number;
  start: string;
  end: string;
  name?: string | null;
}

export interface Calendar {
  id: string;
  name: string;
  timeZone: string;
  isDefault: boolean;
  isActive: boolean;
  shifts: Shift[];
  holidays: { date: string; name: string }[];
  workCentres: string[];
}

export interface MachineBlock {
  id: string;
  machineId: string;
  machineCode?: string;
  machineName?: string;
  kind: 'maintenance' | 'breakdown' | 'booking';
  startsAt: string;
  endsAt: string;
  reason: string;
}

export interface Bar {
  operationId: string;
  workOrderId: string;
  number: string;
  itemCode: string;
  itemName: string;
  seq: number;
  name: string;
  qty: string;
  priority: number;
  machineId: string | null;
  startsAt: string;
  endsAt: string;
  pinned: boolean;
  running: boolean;
  dueAt: string | null;
  late: boolean;
  noMaterial: boolean;
  conflict: boolean;
}

export interface ScheduleView {
  run: { id: string; runAt: string; placed: number; unscheduled: number; late: number; conflicts: number; horizonEnd: string } | null;
  stale: boolean;
  calendarMissing: boolean;
  timeZone: string;
  machines: { id: string; code: string; name: string; workCentreId: string; workCentre: string; calendarId: string }[];
  working: Record<string, { start: string; end: string }[]>;
  blocks: MachineBlock[];
  bars: Bar[];
  unscheduled: { operationId: string; reason: string; seq?: number; name?: string; workOrderId?: string; number?: string }[];
  conflicts: { operationId: string; reason: string; seq?: number; name?: string; workOrderId?: string; number?: string }[];
  late: { id: string; number: string; itemCode: string; scheduledFinish: string; dueAt: string; priority: number }[];
}

export interface OutOfSequence {
  id: string;
  reason: string;
  startedAt: string;
  operator: string;
  machine: string | null;
  number: string;
  workOrderId: string;
  seq: number;
  operation: string;
}

export const BLOCK_KIND: Record<MachineBlock['kind'], string> = { maintenance: 'Maintenance', breakdown: 'Breakdown', booking: 'Booking' };

/** Token-based colours for work orders, picked by a stable hash of the id. */
const PALETTE = [
  'bg-accent-soft border-accent',
  'bg-info-soft border-info',
  'bg-success-soft border-success',
  'bg-warning-soft border-warning',
] as const;
export function barColour(workOrderId: string) {
  let h = 0;
  for (const ch of workOrderId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export const PRIORITY = [
  ['1', '1 · Highest'],
  ['2', '2 · High'],
  ['3', '3 · Normal'],
  ['4', '4 · Low'],
  ['5', '5 · Lowest'],
] as const;
