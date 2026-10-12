// Decision 065: SMT line types and helpers shared by the SMT page, the batch page and Plant → Devices.
import type { BadgeTone } from '@factoryos/ui';

export interface ContainerStatus {
  phase: string;
  blocked: string | null;
  clock: { phase: string; usedMinutes: number; floorMinutes: number | null; remainingMinutes: number | null; needsBake: boolean } | null;
  paste: { phase: string; readyAt: string | null; openUntil: string | null; usable: boolean } | null;
  allowed: string[];
}

export interface ContainerRow {
  id: string;
  kind: 'reel' | 'paste';
  code: string;
  itemCode: string;
  itemName: string;
  batchNo: string;
  mslLevel: string | null;
  qty: string;
  status: ContainerStatus;
  load: { slot: string; workOrder: string | null; machine: string } | null;
}

export interface ContainerDetail extends ContainerRow {
  itemId: string;
  batchId: string;
  supplierBatchNo: string | null;
  expiryDate: string | null;
  events: { id: string; kind: string; at: string; note: string | null }[];
  boards: TraceBoard[];
}

export interface TraceBoard {
  serialNo: string;
  batchId: string | null;
  scrapped: boolean;
  panel: string;
  workOrder: string | null;
  placedAt: string;
  via: string;
}

export interface SmtSetup {
  workOrder: { id: string; number: string | null; status: string; itemCode: string; itemName: string; revision: string | null; plannedQty: string; producedQty: string; boardsPerPanel: number | null; serialTracked: boolean };
  materials: { itemId: string; code: string; name: string; mslLevel: string | null; requiredQty: string; loaded: string[] }[];
  loads: { id: string; machineId: string; machine: string; slot: string; loadedAt: string; container: { id: string; code: string; kind: 'reel' | 'paste'; itemId: string; itemCode: string; batchNo: string; status: ContainerStatus } }[];
  panels: { id: string; code: string; seq: number; placedAt: string | null; depaneledAt: string | null; boards: { id: string; position: number; serialNo: string; batchId: string | null; scrappedAt: string | null; scrapReason: string | null }[] }[];
  counts: { boards: number; waiting: number; output: number; scrapped: number };
}

export interface BoardTrace {
  serialNo: string;
  position: number;
  batchId: string | null;
  scrappedAt: string | null;
  scrapReason: string | null;
  workOrder: { id: string; number: string | null } | undefined;
  panel: { id: string; code: string; placedAt: string | null; depaneledAt: string | null; machine: string | null };
  reels: { slot: string; loadedAt: string; unloadedAt: string | null; container: { id: string; code: string; kind: 'reel' | 'paste' }; itemCode: string; itemName: string; batchId: string; batchNo: string; supplierBatchNo: string | null; mslLevel: string | null; atPlacement: ContainerStatus }[];
}

export interface LabelPrinter {
  id: string;
  edgeId: string;
  edgeCode: string;
  code: string;
  name: string;
  host: string;
  port: number;
  dpi: number;
  widthMm: number;
  heightMm: number;
  status: 'active' | 'retired';
}

export interface PrintJobRow {
  id: string;
  kind: string;
  label: string;
  status: 'queued' | 'sent' | 'printed' | 'failed';
  attempts: number;
  error: string | null;
  createdAt: string;
  printedAt: string | null;
  printer: string;
}

export const EVENT_LABEL: Record<string, string> = {
  opened: 'Opened',
  cabinet_in: 'Into dry cabinet',
  cabinet_out: 'Out of dry cabinet',
  baked: 'Baked',
  resealed: 'Resealed',
  empty: 'Empty',
  out_of_fridge: 'Out of fridge',
  back_in_fridge: 'Back in fridge',
};

export const PHASE: Record<string, { label: string; tone: BadgeTone }> = {
  sealed: { label: 'Sealed', tone: 'neutral' },
  open: { label: 'Open', tone: 'accent' },
  cabinet: { label: 'Dry cabinet', tone: 'neutral' },
  empty: { label: 'Empty', tone: 'neutral' },
  cold: { label: 'In fridge', tone: 'neutral' },
  thawing: { label: 'Thawing', tone: 'warning' },
  ready: { label: 'Ready', tone: 'success' },
  over_open_time: { label: 'Open too long', tone: 'danger' },
  expired: { label: 'Expired', tone: 'danger' },
};

export const JOB_TONE: Record<PrintJobRow['status'], BadgeTone> = { queued: 'neutral', sent: 'accent', printed: 'success', failed: 'danger' };

export function minutes(m: number) {
  if (m >= 48 * 60) return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
  if (m >= 60) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  return `${m} min`;
}

/** Floor life left, paste readiness or the blocker, in a few words. */
export function timeLeft(s: ContainerStatus, now = Date.now()): string | null {
  if (s.blocked) return s.blocked;
  if (s.clock?.remainingMinutes != null) return `${minutes(s.clock.remainingMinutes)} floor life left`;
  if (s.paste?.openUntil) return `${minutes(Math.max(0, Math.round((Date.parse(s.paste.openUntil) - now) / 60_000)))} open time left`;
  return null;
}

/** Under 4 hours of floor life or open time: shown in amber. */
export function nearlyOut(s: ContainerStatus, now = Date.now()) {
  if (s.clock?.remainingMinutes != null) return s.clock.remainingMinutes < 240;
  if (s.paste?.openUntil) return Date.parse(s.paste.openUntil) - now < 4 * 3600_000;
  return false;
}
