// Decision 066: maintenance plans, orders, breakdowns and reports, shared by the maintenance pages, the machine page
// and the shop floor.
import type { BadgeTone } from '@factoryos/ui';

export interface PlanDue {
  status: 'ok' | 'due_soon' | 'overdue';
  dueAt: string | null;
  hoursLeft: number | null;
  by: 'calendar' | 'hours' | null;
  runHoursSince: number;
  runHoursSource: 'tap' | 'job_cards';
  openOrder: { id: string; number: string } | null;
}

export interface PlanItem {
  id: string;
  lineNo: number;
  text: string;
  unit: string | null;
  min: string | null;
  max: string | null;
  spareItemId: string | null;
  spareQty: string | null;
  spareCode: string | null;
}

export interface Plan {
  id: string;
  machineId: string;
  machineCode: string;
  machineName: string;
  name: string;
  instructions: string | null;
  everyDays: number | null;
  everyRunHours: number | null;
  leadDays: number;
  plannedMinutes: number;
  lastDoneAt: string;
  isActive: boolean;
  due: PlanDue;
  items?: PlanItem[];
}

export type OrderStatus = 'open' | 'in_progress' | 'done' | 'verified' | 'cancelled';

export interface OrderRow {
  id: string;
  number: string;
  kind: 'preventive' | 'breakdown';
  status: OrderStatus;
  machineId: string;
  machineCode: string;
  machineName: string;
  critical: boolean;
  planId: string | null;
  title: string;
  scheduledStart: string | null;
  symptom: string | null;
  failedAt: string | null;
  startedAt: string | null;
  doneAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface OrderDetail extends OrderRow {
  cause: string | null;
  action: string | null;
  cancelReason: string | null;
  doneBy: string | null;
  reportedByName: string | null;
  doneByName: string | null;
  verifiedByName: string | null;
  checklist: (PlanItem & { result: { reading: string | null; note: string | null; doneAt: string; by: string | null; outside: boolean } | null })[];
  labour: { id: string; technician: string; minutes: number; rate: string; cost: string; note: string | null; createdAt: string }[];
  spares: { id: string; number: string | null; status: string; postedAt: string | null; lines: { itemCode: string; itemName: string; qty: string; value: string | null; uom: string }[] }[];
  cost: { spares: string; labour: string; total: string };
  needsVerification: boolean;
}

export interface Reliability {
  machineId: string;
  machineCode: string;
  machineName: string;
  critical: boolean;
  breakdowns: number;
  downtimeHours: number;
  mttrHours: number | null;
  mtbfHours: number | null;
  availability: number | null;
  runHours: number;
  runHoursSource: 'tap' | 'job_cards';
  preventive: number;
  sparesCost: string;
  labourCost: string;
}

export interface MachineMaintenance {
  machine: { id: string; code: string; name: string; critical: boolean };
  plans: Plan[];
  open: OrderRow[];
  history: OrderRow[];
  alarmSince: string | null;
  last90Days: Reliability | null;
}

export const DUE_LABEL: Record<PlanDue['status'], [string, BadgeTone]> = {
  overdue: ['Overdue', 'danger'],
  due_soon: ['Due soon', 'warning'],
  ok: ['OK', 'success'],
};

export const STATUS_LABEL: Record<OrderStatus, [string, BadgeTone]> = {
  open: ['Open', 'info'],
  in_progress: ['In progress', 'warning'],
  done: ['Done', 'success'],
  verified: ['Verified', 'success'],
  cancelled: ['Cancelled', 'neutral'],
};

/** "every 90 days or 500 h" */
export const intervalLabel = (p: Pick<Plan, 'everyDays' | 'everyRunHours'>) =>
  [p.everyDays ? `every ${p.everyDays} days` : null, p.everyRunHours ? `${p.everyDays ? '' : 'every '}${p.everyRunHours} running hours` : null].filter(Boolean).join(' or ');

/** Drop trailing zeros of a numeric column for display (0.0050 → 0.005). */
export const trimNum = (v: string | null) => (v == null ? null : v.includes('.') ? v.replace(/\.?0+$/, '') : v);

export const limitsLabel = (i: Pick<PlanItem, 'min' | 'max' | 'unit'>) =>
  i.min != null && i.max != null ? `${trimNum(i.min)}–${trimNum(i.max)} ${i.unit ?? ''}` : i.min != null ? `≥ ${trimNum(i.min)} ${i.unit ?? ''}` : i.max != null ? `≤ ${trimNum(i.max)} ${i.unit ?? ''}` : i.unit ? `reading in ${i.unit}` : null;
