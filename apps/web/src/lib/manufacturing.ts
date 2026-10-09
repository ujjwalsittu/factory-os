import type { BadgeTone } from '@factoryos/ui';

export type WorkOrderStatus = 'draft' | 'released' | 'completed' | 'cancelled';
export type BomStatus = 'draft' | 'active' | 'obsolete';
export type JobCardStatus = 'running' | 'paused' | 'completed' | 'cancelled';

export const WO_STATUS: Record<WorkOrderStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  released: { label: 'Released', tone: 'info' },
  completed: { label: 'Closed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};
export const BOM_STATUS: Record<BomStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  active: { label: 'Active', tone: 'success' },
  obsolete: { label: 'Obsolete', tone: 'warning' },
};
export const CARD_STATUS: Record<JobCardStatus, { label: string; tone: BadgeTone }> = {
  running: { label: 'Running', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Done', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};
export const MOVEMENT_LABEL: Record<string, string> = {
  production_issue: 'Issue',
  production_return: 'Return',
  production_output: 'Output',
};
export const PAUSE_REASONS = ['Tool change', 'Setup / fixturing', 'Waiting for material', 'Waiting for inspection', 'Machine breakdown', 'Break', 'Other'];

export interface WorkCentre {
  id: string;
  code: string;
  name: string;
  hourlyRate: string;
  /** Null = the entity's default calendar (decision 049). */
  calendarId?: string | null;
  isActive: boolean;
  machines: { id: string; code: string; name: string; isActive: boolean; workCentreId: string }[];
}

export interface BomRow {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  revision: string;
  quantity: string;
  status: BomStatus;
  isDefault: boolean;
  materials: number;
  operations: number;
}

export interface BomDetail {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemRevision: string | null;
  uom: string;
  revision: string;
  quantity: string;
  status: BomStatus;
  isDefault: boolean;
  remarks: string | null;
  materials: { id: string; lineNo: number; itemId: string; itemCode: string; itemName: string; tracking: string; uom: string; qty: string; backflush: boolean; remarks: string | null }[];
  operations: { id: string; seq: number; name: string; workCentreId: string | null; workCentreCode: string | null; workCentreName: string | null; hourlyRate: string | null; outsourced: boolean; supplierId: string | null; supplierName: string | null; setupMinutes: string; runMinutesPerUnit: string; leadDays?: number | null; instructions: string | null }[];
}

export interface WorkOrderRow {
  id: string;
  number: string | null;
  status: WorkOrderStatus;
  itemCode: string;
  itemName: string;
  revision: string;
  plannedQty: string;
  producedQty: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  priority?: number;
  scheduledFinish?: string | null;
  salesOrder: string | null;
  wip: string;
}

export interface JobCard {
  id: string;
  workOrderId: string;
  operationId: string;
  operatorId: string;
  operator: string;
  status: JobCardStatus;
  seq: number;
  operation: string;
  number: string | null;
  machine: string | null;
  workCentre: string;
  goodQty: string | null;
  reworkQty: string | null;
  scrapQty: string | null;
  minutes: string;
  hourlyRate: string | null;
  value: string | null;
  startedAt: string;
  completedAt: string | null;
  pauseReason: string | null;
  cancelReason: string | null;
}

export interface Movement {
  id: string;
  number: string | null;
  purpose: 'production_issue' | 'production_return' | 'production_output';
  status: 'draft' | 'submitted' | 'cancelled';
  postingDate: string;
  backflush: boolean;
  cancelReason: string | null;
  lines: { itemId: string; itemCode: string; itemName: string; qty: string; value: string | null; rate: string | null; batchId: string | null; batchNo: string | null; heatNo: string | null; warehouse: string | null }[];
}

export interface WorkOrderDetail {
  id: string;
  number: string | null;
  status: WorkOrderStatus;
  itemId: string;
  itemCode: string;
  itemName: string;
  tracking: string;
  uom: string;
  /** Null on rework orders, which have no BOM (decision 048). */
  bomId: string | null;
  reworkOfNcrId?: string | null;
  /** 1 = highest … 5 (decision 049). */
  priority?: number;
  scheduledFinish?: string | null;
  revision: string;
  plannedQty: string;
  producedQty: string;
  sourceWarehouseId: string;
  targetWarehouseId: string;
  sourceWarehouse: string;
  targetWarehouse: string;
  salesOrder: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  remarks: string | null;
  completedOn: string | null;
  cancelReason: string | null;
  materials: { id: string | null; itemId: string; itemCode: string; itemName: string; tracking: string; uom: string; qtyPerUnit: string | null; requiredQty: string | null; issuedQty: string; backflush: boolean }[];
  operations: { id: string; seq: number; name: string; workCentre: string | null; hourlyRate: string | null; plannedMinutes: string; actualMinutes: string; goodQty: string; instructions: string | null; outsourced: boolean; supplierId: string | null; supplier: string | null; leadDays?: number | null }[];
  jobCards: JobCard[];
  movements: Movement[];
  asBuilt: { assemblyBatchId: string; assemblyNo: string; componentBatchId: string; componentNo: string }[];
  cost: { material: string; absorbed: string; jobWork: string; output: string; variance: string; wip: string; unitCost: string | null };
}

export interface Availability {
  itemId: string;
  warehouseId: string;
  warehouse: string;
  batchId: string | null;
  batchNo: string | null;
  heatNo: string | null;
  expiryDate: string | null;
  kind: 'lot' | 'serial' | 'remnant' | null;
  lengthMm: string | null;
  qty: string;
}

export interface ShopFloor {
  operations: { operationId: string; seq: number; name: string; plannedMinutes: string; instructions: string | null; workCentreId: string; workCentre: string; workOrderId: string; number: string; itemCode: string; itemName: string; plannedQty: string; producedQty: string; goodQty: string; scheduledMachineId: string | null; scheduledStart: string | null; scheduledEnd: string | null }[];
  openCards: JobCard[];
  mine: JobCard | null;
  machines: { id: string; code: string; name: string; workCentreId: string }[];
}

export interface Trace {
  batch: { id: string; batchNo: string; heatNo: string | null; itemCode: string; itemName: string };
  backward: { workOrders: TraceRow[]; consumed: TraceRow[] };
  forward: { workOrders: TraceRow[]; produced: TraceRow[] };
}
export interface TraceRow {
  workOrderId: string;
  number: string;
  batchId: string | null;
  batchNo: string | null;
  heatNo: string | null;
  itemCode: string;
  itemName: string;
  qty: string;
}

/** "1 h 25 min" from minutes. */
export function formatMinutes(minutes: string | null | undefined): string {
  const m = Math.round(Number(minutes ?? 0));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
