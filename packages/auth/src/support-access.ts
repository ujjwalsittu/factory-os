// Audited support access (decision 050): the fixed read catalog and the wire contracts shared by API and web.
// Dependency-free on purpose; validation lives in the API (support-access.types.ts).
import type { Permission } from './permissions.js';

export type SupportArea = 'inventory' | 'sales-invoices' | 'purchase-invoices' | 'work-orders' | 'accounting';

/** The only areas a support grant can ever read, each behind an existing read permission. */
export const SUPPORT_READ_CATALOG: Readonly<Record<SupportArea, Permission>> = Object.freeze({
  inventory: 'inventory.report.read',
  'sales-invoices': 'selling.sales_invoice.read',
  'purchase-invoices': 'buying.purchase_invoice.read',
  'work-orders': 'manufacturing.work_order.read',
  accounting: 'accounts.report.read',
});
export const SUPPORT_AREAS = Object.freeze(Object.keys(SUPPORT_READ_CATALOG) as SupportArea[]);

export const SUPPORT_MAX_DURATION_SECONDS = 1800;
export const SUPPORT_MIN_DURATION_SECONDS = 300;
export const SUPPORT_START_WINDOW_SECONDS = 600;

export type SupportState = 'approved' | 'active' | 'expired' | 'invalidated' | 'stopped' | 'revoked';
export type SupportPolicy = { enabled: boolean; maxDurationSeconds: number; allowedAreas: SupportArea[] };
/** `password` is required when enabling. */
export type SupportPolicyInput = SupportPolicy & { password?: string };
export type SupportApprovalInput = {
  operatorEmail: string;
  targetMembershipId: string;
  entityId: string;
  areas: SupportArea[];
  durationSeconds: number;
  reason: string;
  password: string;
};
export type SupportIdentity = { id: string; name: string; email: string };
export type SupportGrantSummary = {
  id: string;
  tenantId: string;
  tenantName: string;
  entityId: string;
  entityName: string;
  operator: SupportIdentity;
  subject: SupportIdentity;
  approver: SupportIdentity;
  areas: SupportArea[];
  reason: string;
  durationSeconds: number;
  approvedAt: string;
  startBy: string;
  startedAt: string | null;
  expiresAt: string | null;
  state: SupportState;
};
export type SupportEventKind = 'approved' | 'started' | 'stopped' | 'revoked' | 'expired' | 'invalidated' | 'read' | 'denied' | 'policy-changed';
export type SupportHistoryEntry = {
  id: string;
  grantId: string | null;
  kind: SupportEventKind;
  occurredAt: string;
  actorUserId: string | null;
  subjectUserId: string | null;
  operatorUserId: string | null;
  area: SupportArea | null;
  reasonCode: string | null;
};
export type SupportGrantPage = { grants: SupportGrantSummary[]; events: SupportHistoryEntry[]; nextCursor: string | null };
export type SupportWorkspaceContext = {
  grant: SupportGrantSummary;
  actor: SupportIdentity;
  actorSessionId: string;
  effectiveAreas: SupportArea[];
  serverNow: string;
  expiresAt: string;
};
/** Money and quantities stay decimal strings. */
export type SupportCell = string | boolean | null;
export type SupportTable = { columns: { key: string; label: string }[]; rows: Record<string, SupportCell>[]; nextCursor: string | null };
export type SupportDetail = { fields: { label: string; value: SupportCell }[]; tables: { label: string; table: SupportTable }[] };
export type SupportPanelResult = { kind: 'table'; table: SupportTable } | { kind: 'detail'; detail: SupportDetail };
export type SupportListQuery = { limit: number; cursor?: string; status?: string };
export type SupportQuery =
  | { area: 'inventory'; panel: 'balance' | 'ledger'; limit: number; cursor?: string; itemId?: string; warehouseId?: string; batchId?: string; owner?: string; from?: string; to?: string }
  | { area: 'sales-invoices' | 'purchase-invoices' | 'work-orders'; panel: 'list' | 'detail'; limit: number; cursor?: string; id?: string; status?: string }
  | { area: 'accounting'; panel: 'status' | 'trial-balance' | 'ledger' | 'day-book'; limit: number; cursor?: string; accountId?: string; partyId?: string; from?: string; to?: string };
export type SupportErrorCode = 'SUPPORT_UNAVAILABLE' | 'SUPPORT_REAUTHENTICATE' | 'SUPPORT_ENDED' | 'SUPPORT_INVALID_INPUT';
/** The untrusted grant selector header, accepted only on workspace GETs. */
export const SUPPORT_HEADER = 'x-factoryos-support-access';
