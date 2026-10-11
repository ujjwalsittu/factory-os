// Phase 3a machine-hour MaaS (decision 055): shapes returned by /services.

export type BookingStatus = 'tentative' | 'confirmed' | 'in_use' | 'completed' | 'cancelled';

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' }> = {
  tentative: { label: 'Tentative', tone: 'neutral' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  in_use: { label: 'In use', tone: 'accent' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

/** Steps that keep billed hours exact (decision 055). */
export const ROUNDING_STEPS = [6, 12, 15, 30, 60] as const;

export interface RateCard {
  id: string;
  machineId: string;
  machineCode: string;
  machineName: string;
  serviceItemId: string;
  itemCode: string;
  itemName: string;
  standardRate: string;
  memberRate: string | null;
  minimumMinutes: number;
  roundingMinutes: number;
  validFrom: string;
  validTo: string | null;
}

export interface Booking {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  machineId: string;
  machineCode: string;
  machineName: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  purpose: string | null;
  machineBlockId: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  cancelReason: string | null;
  salesInvoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: 'draft' | 'submitted' | 'cancelled' | null;
  usedMinutes: number;
}

export interface BookingDetail extends Booking {
  member: boolean;
  workCentre: string;
  usage: { id: string; minutes: number; source: 'timer' | 'manual'; note: string | null; recordedAt: string; recordedBy: string }[];
  rateCard: { id: string; standardRate: string; memberRate: string | null; minimumMinutes: number; roundingMinutes: number; validFrom: string; validTo: string | null } | null;
  charge: { actualMinutes: number; billableMinutes: number; hours: string; rate: string; amount: string; memberRate: boolean } | null;
  /** Decision 056: the membership covering the booking's start date, and what billing would draw from it. */
  membership: { id: string; number: string; endsOn: string; remainingMinutes: number } | null;
  drawnMinutes: number;
  split: { coveredMinutes: number; overageMinutes: number; overageHours: string; overageAmount: string } | null;
  billed: boolean;
  billable: boolean;
  /** Decisions 057/058: billed with its test campaign or through its project, never by the hour. */
  campaignId: string | null;
  campaignNumber: string | null;
  projectId: string | null;
  projectNumber: string | null;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  includedMinutes: number;
  termMonths: number;
  fee: string;
  serviceItemId: string;
  itemCode: string;
  isActive: boolean;
}

export interface Membership {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  planId: string;
  planCode: string;
  planName: string;
  startsOn: string;
  endsOn: string;
  includedMinutes: number;
  fee: string;
  status: 'active' | 'cancelled';
  cancelReason: string | null;
  salesInvoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: 'draft' | 'submitted' | 'cancelled' | null;
  usedMinutes: number;
  remainingMinutes: number;
}

export interface MembershipDetail extends Membership {
  draws: { id: string; bookingId: string; bookingNumber: string; minutes: number; reversalOf: string | null; reason: string | null; createdAt: string; createdBy: string }[];
}

/** `datetime-local` value in IST for an instant, and back. */
export const toLocal = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 16);
export const fromLocal = (v: string) => new Date(`${v}:00+05:30`).toISOString();

export const formatMinutes = (m: number) => {
  const h = Math.floor(Math.abs(m) / 60);
  const r = Math.abs(m) % 60;
  return `${m < 0 ? '−' : ''}${h ? `${h} h` : ''}${h && r ? ' ' : ''}${r || !h ? `${r} min` : ''}`;
};

/** Decision 057: test campaigns. */
export type CampaignStatus = 'draft' | 'active' | 'reported' | 'closed' | 'cancelled';
export type StepResult = 'pending' | 'pass' | 'fail' | 'na';

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  active: { label: 'In test', tone: 'accent' },
  reported: { label: 'Report approved', tone: 'info' },
  closed: { label: 'Closed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

export const STEP_RESULT: Record<StepResult, { label: string; tone: 'neutral' | 'success' | 'danger' | 'warning' }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  pass: { label: 'Pass', tone: 'success' },
  fail: { label: 'Fail', tone: 'danger' },
  na: { label: 'N/A', tone: 'warning' },
};

export interface Campaign {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  title: string;
  scope: string | null;
  customerRef: string | null;
  serviceItemId: string;
  quotedAmount: string;
  status: CampaignStatus;
  cancelReason: string | null;
  salesInvoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: 'draft' | 'submitted' | 'cancelled' | null;
  inCustody: number;
  projectId: string | null;
  createdAt: string;
}

export interface CampaignDetail extends Campaign {
  itemCode: string;
  itemName: string;
  projectNumber: string | null;
  reportSummary: string | null;
  reportApprovedAt: string | null;
  approvedByName: string | null;
  closedAt: string | null;
  steps: { id: string; seq: number; name: string; requirement: string | null; result: StepResult; measured: string | null; notes: string | null; recordedByName: string | null; recordedAt: string | null }[];
  custody: { id: string; description: string; serialNo: string | null; qty: number; inwardChallanNo: string; receivedCondition: string; receivedAt: string; receivedByName: string; outwardChallanNo: string | null; returnCondition: string | null; returnedAt: string | null; returnedByName: string | null }[];
  extras: { id: string; description: string; qty: string; rate: string; amount: string }[];
  bookings: { id: string; number: string; status: BookingStatus; startsAt: string; endsAt: string; machineCode: string }[];
  files: { id: string; fileName: string; kind: string }[];
  totalAmount: string;
  pendingSteps: number;
}

/** Decision 058: projects billed by milestones with retention; cost from linked work and timesheets. */
export type ProjectStatus = 'draft' | 'active' | 'completed' | 'closed' | 'cancelled';
export type CostCategory = 'material' | 'machine' | 'labour' | 'bought_in' | 'other';
export type LinkKind = 'booking' | 'campaign' | 'work_order' | 'purchase_invoice_line';

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  active: { label: 'Active', tone: 'accent' },
  completed: { label: 'Completed', tone: 'info' },
  closed: { label: 'Closed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

export const COST_CATEGORY: Record<CostCategory, string> = {
  material: 'Material',
  machine: 'Machine',
  labour: 'Labour',
  bought_in: 'Bought-in (imagery, cloud, subcontract)',
  other: 'Other',
};

export const LINK_KIND: Record<LinkKind, string> = {
  booking: 'Machine booking',
  campaign: 'Test campaign',
  work_order: 'Work order',
  purchase_invoice_line: 'Purchase invoice line',
};

export interface Project {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  title: string;
  description: string | null;
  customerRef: string | null;
  managerUserId: string | null;
  serviceItemId: string;
  contractValue: string;
  retentionPct: string;
  dlpMonths: number;
  startDate: string | null;
  endDate: string | null;
  status: ProjectStatus;
  cancelReason: string | null;
  completedOn: string | null;
  createdAt: string;
  invoiced?: string;
  retentionHeld: string;
}

export interface ProjectDetail extends Project {
  itemCode: string;
  itemName: string;
  managerName: string | null;
  milestones: {
    id: string;
    seq: number;
    name: string;
    dueDate: string | null;
    amount: string;
    achievedOn: string | null;
    acceptanceRef: string | null;
    achievedByName: string | null;
    salesInvoiceId: string | null;
    invoiceNumber: string | null;
    invoiceStatus: 'draft' | 'submitted' | null;
    state: 'pending' | 'achieved' | 'invoiced';
  }[];
  milestoneTotal: string;
  retention: { id: string; milestoneName: string; salesInvoiceId: string; invoiceNumber: string | null; invoiceStatus: 'draft' | 'submitted'; amount: string; releasedOn: string | null; releaseRef: string | null; dueOn: string | null }[];
  retentionReleased: string;
  retentionDueOn: string | null;
  budget: { category: CostCategory; budget: string; actual: string; variance: string }[];
  revenue: string;
  actualCost: string;
  margin: string;
  hours: { userId: string; name: string; approvedHours: string; pendingHours: string; cost: string | null }[];
  sources: { category: CostCategory; kind: string; id: string; reference: string; amount: string }[];
  links: {
    bookings: { id: string; number: string; status: BookingStatus; startsAt: string; endsAt: string; machineCode: string; campaignId: string | null }[];
    campaigns: { id: string; number: string; title: string; status: CampaignStatus }[];
    workOrders: { id: string; number: string | null; status: string; itemCode: string; itemName: string; plannedQty: string }[];
    purchaseLines: { id: string; invoiceId: string; number: string | null; status: string; supplierInvoiceNo: string; supplierName: string; itemCode: string; itemName: string; taxableValue: string | null; currency: string }[];
  };
  files: { id: string; fileName: string; kind: string }[];
}

export interface TimesheetEntry {
  id: string;
  userId: string;
  personName: string;
  projectId: string;
  projectNumber: string;
  projectTitle: string;
  milestoneId: string | null;
  milestoneName: string | null;
  workDate: string;
  hours: string;
  notes: string | null;
  status: 'draft' | 'submitted' | 'approved';
  rejectReason: string | null;
  approvedByName: string | null;
  costRate: string | null;
  costAmount: string | null;
  reversalOf: string | null;
  mine: boolean;
}

export const TIMESHEET_STATUS: Record<TimesheetEntry['status'], { label: string; tone: 'neutral' | 'info' | 'success' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
};

/** Decision 059: EarthNow subscriptions — prepaid report/alert bundles per period, overage on the next invoice. */
export type SubscriptionPeriod = 'month' | 'quarter' | 'year';
export const SUBSCRIPTION_PERIOD: Record<SubscriptionPeriod, string> = { month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' };

export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  solution: string;
  period: SubscriptionPeriod;
  fee: string;
  includedReports: number;
  includedAlerts: number;
  reportRate: string;
  alertRate: string;
  serviceItemId: string;
  itemCode: string;
  isActive: boolean;
}

export interface Subscription {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerRef: string | null;
  planId: string;
  planName: string;
  planCode: string;
  solution: string;
  aoiName: string;
  aoiHectares: string | null;
  aoiNotes: string | null;
  startDate: string;
  endDate: string | null;
  status: 'active' | 'cancelled';
  cancelReason: string | null;
  next: { start: string; end: string; due: boolean } | null;
}

type InvoiceRef = { id: string; number: string | null; status: 'draft' | 'submitted' } | null;

export interface SubscriptionDetail extends Omit<Subscription, 'planName' | 'planCode' | 'solution'> {
  plan: SubscriptionPlan;
  pendingChange: { effectiveOn: string; toPlan: string } | null;
  today: string;
  periods: {
    index: number;
    start: string;
    end: string;
    feePlan: string;
    fee: string;
    planName: string;
    includedReports: number;
    includedAlerts: number;
    reports: number;
    alerts: number;
    overageReports: number;
    overageAlerts: number;
    overageAmount: string;
    ended: boolean;
    feeInvoice: InvoiceRef;
    overageInvoice: InvoiceRef;
  }[];
  changes: { id: string; fromPlan: string; toPlan: string; effectiveOn: string; prorationAmount: string; salesInvoiceId: string | null; prorationInvoiced: boolean; createdAt: string }[];
  deliveries: { id: string; kind: 'report' | 'alert'; deliveredOn: string; title: string; reference: string | null; reversalOf: string | null; reversed: boolean; recordedBy: string; createdAt: string }[];
}

/** Decision 060: billing runs — one draft invoice per customer and PO across the service sources. */
export type BillableKind = 'subscription' | 'booking' | 'milestone' | 'campaign';
export const BILLABLE_KIND: Record<BillableKind, string> = { subscription: 'Subscriptions', booking: 'Machine bookings', milestone: 'Project milestones', campaign: 'Test campaigns' };
export type BillingItem = { kind: BillableKind; sourceId: string; label: string; amount: string };

export interface BillingPreview {
  groups: { customerId: string; customerName: string; customerRef: string | null; amount: string; items: BillingItem[] }[];
  skipped: { kind: BillableKind; sourceId: string; label: string; message: string }[];
  total: string;
}

export interface BillingRun {
  id: string;
  number: string;
  asOf: string;
  kinds: BillableKind[];
  failures: { customerId: string; customerName: string; customerRef: string | null; items: string[]; message: string }[];
  createdByName: string;
  createdAt: string;
  invoices?: number;
  drafts?: number;
  total?: string;
}

export interface BillingRunDetail extends Omit<BillingRun, 'invoices'> {
  invoices: { id: string; salesInvoiceId: string | null; customerId: string; customerName: string; customerRef: string | null; items: BillingItem[]; amount: string; submitError: string | null; invoiceNumber: string | null; invoiceStatus: 'draft' | 'submitted' | 'cancelled' | 'deleted' | null; grandTotal: string | null }[];
}
