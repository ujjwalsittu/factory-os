import type { BadgeTone } from '@factoryos/ui';

/** Quality (decision 048). */
export type Stage = 'incoming' | 'in_process' | 'final';
export const STAGE: Record<Stage, string> = { incoming: 'Incoming', in_process: 'In-process', final: 'Final' };

export const OUTCOME: Record<'pass' | 'fail' | 'partial', { label: string; tone: BadgeTone }> = {
  pass: { label: 'Pass', tone: 'success' },
  partial: { label: 'Partial', tone: 'warning' },
  fail: { label: 'Fail', tone: 'danger' },
};

export const NCR_STATUS: Record<'open' | 'dispositioned' | 'closed' | 'cancelled', { label: string; tone: BadgeTone }> = {
  open: { label: 'Open', tone: 'warning' },
  dispositioned: { label: 'Dispositioned', tone: 'info' },
  closed: { label: 'Closed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const DISPOSITION: Record<Disposition['kind'], string> = {
  use_as_is: 'Use as is',
  rework: 'Rework',
  repair: 'Repair',
  scrap: 'Scrap',
  return_to_vendor: 'Return to vendor',
};

export const FAI_STATUS: Record<'draft' | 'submitted' | 'approved' | 'rejected', { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Awaiting approval', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export const FAI_REASON: Record<'first_build' | 'revision_change' | 'process_change' | 'lapse', string> = {
  first_build: 'First build',
  revision_change: 'New revision',
  process_change: 'Process change',
  lapse: 'Two years since the last FAI',
};

export interface Characteristic {
  id: string;
  lineNo: number;
  balloon: string | null;
  description: string;
  kind: 'dimension' | 'visual' | 'functional' | 'document';
  nominal: string | null;
  lowerLimit: string | null;
  upperLimit: string | null;
  unit: string | null;
  method: string | null;
  isKey: boolean;
  sampleSize: number | null;
  samples?: number;
}

export interface PlanRow {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  stage: Stage;
  operationSeq: number | null;
  revision: string;
  status: 'draft' | 'active' | 'obsolete';
}
export interface PlanDetail extends PlanRow {
  remarks: string | null;
  itemRevision: string | null;
  characteristics: Characteristic[];
}

export interface Gauge {
  id: string;
  code: string;
  description: string;
  type: string | null;
  location: string | null;
  intervalDays: number;
  lastCalibrated: string | null;
  dueDate: string | null;
  status: 'in_service' | 'out_of_service' | 'failed';
  usable?: boolean;
  block?: string | null;
}
export interface GaugeDetail extends Gauge {
  events: { id: string; calibratedOn: string; result: 'pass' | 'adjusted' | 'fail'; agency: string | null; certificateNo: string | null; nextDue: string | null; note: string | null }[];
}

export interface InspectionRow {
  id: string;
  number: string | null;
  stage: Stage;
  status: 'draft' | 'submitted' | 'cancelled';
  itemCode: string;
  itemName: string;
  batchNo: string | null;
  workOrder: string | null;
  qty: string;
  outcome: 'pass' | 'fail' | 'partial' | null;
  sourceType: string;
  createdAt: string;
}
export interface Measurement {
  id: string;
  characteristicId: string | null;
  description: string | null;
  sampleNo: number;
  measured: string | null;
  pass: boolean;
  gaugeId: string | null;
  note: string | null;
}
export interface InspectionDetail extends InspectionRow {
  itemId: string;
  itemRevision: string | null;
  uom: string;
  plan: { id: string; revision: string } | null;
  holdWarehouse: string | null;
  acceptWarehouse: string | null;
  qtyAccepted: string;
  qtyRejected: string;
  remarks: string | null;
  characteristics: Characteristic[];
  results: Measurement[];
  ncr: { id: string; number: string } | null;
  /** The purchase receipt a receipt inspection came from (decision 052). */
  receipt: { id: string; number: string; supplier: string | null } | null;
}

export interface Disposition {
  id: string;
  lineNo: number;
  kind: 'use_as_is' | 'rework' | 'repair' | 'scrap' | 'return_to_vendor';
  qty: string;
  status: 'proposed' | 'approved' | 'posted' | 'cancelled';
  concessionRef: string | null;
  wasteCategory: string | null;
  note: string | null;
  workOrderId: string | null;
  reworkOrder: string | null;
  returnClaimId: string | null;
  stockEntryId: string | null;
}
export interface NcrRow {
  id: string;
  number: string | null;
  status: keyof typeof NCR_STATUS;
  itemCode: string;
  itemName: string;
  batchNo: string | null;
  qty: string;
  description: string;
  createdAt: string;
}
export interface NcrDetail extends NcrRow {
  itemId: string;
  uom: string;
  mrbWarehouseId: string | null;
  workOrder: string | null;
  inspection: string | null;
  inspectionRecordId: string | null;
  cancelReason: string | null;
  dispositions: Disposition[];
}

export interface FaiRow {
  id: string;
  number: string | null;
  status: keyof typeof FAI_STATUS;
  reason: keyof typeof FAI_REASON;
  itemCode: string;
  itemName: string;
  itemRevision: string | null;
  batchNo: string | null;
  createdAt: string;
}
export interface FaiForms {
  form1: { partNumber: string; partName: string; revision: string | null; drawingNo: string | null; organization: string | null; faiNumber: string | null; reason: string; serialOrLot: string | null; subAssemblies: { partNumber: string; name: string; revision: string | null; fai: string | null }[] };
  form2: { materials: { item: string; lot: string; heat: string | null; supplier: string | null; receipt: string | null }[]; specialProcesses: { process: string | null; supplier: string; order: string | null }[]; functionalTests: { description: string; result: string }[] };
  form3: { characteristics: { balloon: string | null; description: string; kind: string; requirement: string; results: string[]; result: 'pass' | 'fail' | 'not_measured'; key: boolean }[] };
}
export interface FaiDetail extends FaiRow {
  itemId: string;
  batchId: string | null;
  inspectionRecordId: string | null;
  remarks: string | null;
  preparedBy: string | null;
  submittedAt: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  forms: FaiForms;
}

export interface Attachment {
  id: string;
  kind: 'mtc' | 'coc' | 'coa' | 'fai' | 'cmm' | 'photo' | 'calibration' | 'drawing' | 'other';
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: string;
  withdrawnAt: string | null;
  withdrawReason: string | null;
}
export const ATTACHMENT_KIND: Record<Attachment['kind'], string> = {
  mtc: 'Mill test certificate',
  coc: 'Certificate of conformance',
  coa: 'Certificate of analysis',
  fai: 'FAI report',
  cmm: 'CMM data',
  photo: 'Photo',
  calibration: 'Calibration certificate',
  drawing: 'Drawing',
  other: 'Other',
};

/** Zip of every certificate, report and FAI along the lot's genealogy, with a manifest (decision 048). */
export async function downloadCertificatePack(batchId: string, batchNo: string, scope: { tenantId?: string | null; entityId?: string | null }) {
  const res = await fetch(`/api/quality/certificate-pack/${batchId}?format=zip`, { headers: { ...(scope.tenantId ? { 'x-tenant-id': scope.tenantId } : {}), ...(scope.entityId ? { 'x-entity-id': scope.entityId } : {}) }, credentials: 'include' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `certificates-${batchNo.replace(/[^\w.-]+/g, '_')}.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** CAPA (decision 061). */
export const CAPA_STATUS: Record<'open' | 'in_action' | 'verifying' | 'closed' | 'cancelled', { label: string; tone: BadgeTone }> = {
  open: { label: 'Open', tone: 'warning' },
  in_action: { label: 'In action', tone: 'info' },
  verifying: { label: 'Awaiting check', tone: 'info' },
  closed: { label: 'Closed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const CAPA_SOURCE: Record<'ncr' | 'audit' | 'complaint' | 'other', string> = { ncr: 'NCR', audit: 'Audit finding', complaint: 'Customer complaint', other: 'Other' };
export const CAPA_ACTION_KIND: Record<'containment' | 'corrective' | 'preventive', string> = { containment: 'Containment', corrective: 'Corrective', preventive: 'Preventive' };

export interface CapaRow {
  id: string;
  number: string;
  source: keyof typeof CAPA_SOURCE;
  title: string;
  problem: string;
  severity: 'minor' | 'major';
  ownerUserId: string;
  ownerName: string;
  verifyAfterDays: number;
  status: keyof typeof CAPA_STATUS;
  verifyDueOn: string | null;
  closedAt: string | null;
  createdAt: string;
  openActions: number;
  nextDue: string | null;
  overdue: boolean;
  verificationDue: boolean;
}
export interface CapaAction {
  id: string;
  kind: keyof typeof CAPA_ACTION_KIND;
  description: string;
  ownerUserId: string;
  ownerName: string;
  dueOn: string;
  status: 'open' | 'done' | 'cancelled';
  doneOn: string | null;
  doneNote: string | null;
  doneByName: string | null;
  cancelReason: string | null;
  overdue: boolean;
}
export interface CapaDetail extends Omit<CapaRow, 'openActions' | 'nextDue' | 'overdue'> {
  whys: string[];
  rootCause: string | null;
  team: string | null;
  containment: string | null;
  recognition: string | null;
  cancelReason: string | null;
  ncrs: { id: string; number: string | null; status: keyof typeof NCR_STATUS; description: string; itemCode: string; itemName: string }[];
  actions: CapaAction[];
  verifications: { id: string; effective: boolean; note: string; verifiedByName: string; verifiedAt: string }[];
  today: string;
}
export interface CapaPerson {
  id: string;
  name: string;
}
