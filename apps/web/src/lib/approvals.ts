import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';

/** Decision 076: one kind per approval step that already exists, in the order the inbox groups them. */
export const KINDS = ['gst_return', 'ncr', 'fai', 'capa', 'maintenance', 'timesheet', 'return_claim', 'campaign_report', 'usage_review'] as const;
export type ApprovalKind = (typeof KINDS)[number];

export const KIND_LABEL: Record<ApprovalKind, string> = {
  gst_return: 'GST returns to approve',
  ncr: 'NCR dispositions (MRB)',
  fai: 'First article inspections',
  capa: 'CAPA effectiveness checks',
  maintenance: 'Maintenance to verify',
  timesheet: 'Timesheets',
  return_claim: 'Purchase return claims',
  campaign_report: 'Test reports to sign off',
  usage_review: 'Machine usage to review',
};

export interface ApprovalRow {
  kind: ApprovalKind;
  key: string;
  entityId: string;
  entityName: string;
  number: string;
  title: string;
  from: string | null;
  since: string;
  dueOn?: string;
  href: string;
  action?: { kind: 'verify'; orderId: string } | { kind: 'timesheets'; entryIds: string[]; hours: string };
}

export interface Approvals {
  needsMe: ApprovalRow[];
  waitingOnOthers: ApprovalRow[];
  errors: { kind: ApprovalKind; entityId: string }[];
}

/** The inbox for every entity the person can access; tenant-scoped, so the entity picker does not change it. */
export function useApprovals() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ['approvals', ws.tenantId],
    queryFn: () => api<Approvals>('/approvals', { scope: ws.tenantScope }),
    refetchOnWindowFocus: true,
  });
}

/** "3 days", "5 hours", "just now": how long something has waited. */
export function waited(since: string, now = Date.now()) {
  const ms = now - Date.parse(since.length === 10 ? `${since}T00:00:00+05:30` : since);
  if (!(ms > 0)) return 'just now';
  const h = Math.floor(ms / 3600e3);
  if (h < 1) return 'under an hour';
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}
