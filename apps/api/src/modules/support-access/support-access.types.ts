// Audited support access (decision 050): API-private types and strict validation of every support input.
import {
  SUPPORT_AREAS,
  SUPPORT_MAX_DURATION_SECONDS,
  SUPPORT_MIN_DURATION_SECONDS,
  type SupportApprovalInput,
  type SupportArea,
  type SupportEventKind,
  type SupportGrantSummary,
  type SupportListQuery,
  type SupportPolicyInput,
  type SupportQuery,
} from '@factoryos/auth';
import type { Database } from '@factoryos/db';
import { z } from 'zod';

export type SupportTx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type SupportExecutor = Pick<Database, 'select' | 'execute'>;
/** Deliberately not RequestContext: it can never carry owner or platform shortcuts. */
export type SupportScope = { tenantId: string; entityId: string; membershipId: string; subjectUserId: string; permissions: ReadonlySet<string> };
/** Server-only; never serialized or accepted from a client. */
export type SupportProof = { userId: string; sessionId: string; securityEpoch: string; passwordVersion: string };
export type SupportReadAuthority = { grant: SupportGrantSummary; scope: SupportScope; actorSessionId: string };
export type SupportEvidence = { kind: SupportEventKind; area: SupportArea | null; reasonCode: string | null };
export type SupportConfig = { enabled: boolean; maxDurationSeconds: typeof SUPPORT_MAX_DURATION_SECONDS; origins: string[] };
export type SupportReadPool = { run<T>(fn: (tx: SupportExecutor) => Promise<T>): Promise<T>; close(): Promise<void> };

const area = z.enum(SUPPORT_AREAS as [SupportArea, ...SupportArea[]]);
const areas = z
  .array(area)
  .min(1)
  .refine((a) => new Set(a).size === a.length, 'Duplicate area');
const duration = z.number().int().min(SUPPORT_MIN_DURATION_SECONDS).max(SUPPORT_MAX_DURATION_SECONDS);
const reason = z.string().trim().min(3).max(500);
const password = z.string().min(1).max(256);

export const supportApprovalSchema = z
  .object({
    operatorEmail: z.string().trim().toLowerCase().pipe(z.email()),
    targetMembershipId: z.uuid(),
    entityId: z.uuid(),
    areas,
    durationSeconds: duration,
    reason,
    password,
  })
  .strict();
export const supportPolicySchema = z
  .object({ enabled: z.boolean(), maxDurationSeconds: duration, allowedAreas: areas, password: password.optional() })
  .strict();

// Query strings: every value must be a single string (repeated parameters arrive as arrays and fail).
const limit = z
  .string()
  .regex(/^\d{1,3}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(500))
  .optional()
  .transform((v) => v ?? 100);
const cursor = z.string().max(512).regex(/^[A-Za-z0-9_-]+$/).optional();
const date = z.iso.date();
const ordered = <T extends { from?: string; to?: string }>(q: T) => !q.from || !q.to || q.from <= q.to;
const DOC_STATUS = ['draft', 'submitted', 'cancelled'] as const;
const WORK_ORDER_STATUS = ['draft', 'released', 'completed', 'cancelled'] as const;

export const supportListSchema = z.object({ limit, cursor }).strict();

const inventory = z.discriminatedUnion('panel', [
  z
    .object({ panel: z.literal('balance'), limit, cursor, warehouseId: z.uuid().optional(), itemId: z.uuid().optional(), batchId: z.uuid().optional(), owner: z.union([z.enum(['company', 'customers']), z.uuid()]).optional() })
    .strict(),
  z
    .object({ panel: z.literal('ledger'), limit, cursor, itemId: z.uuid(), warehouseId: z.uuid().optional(), batchId: z.uuid().optional(), owner: z.union([z.enum(['company', 'customers']), z.uuid()]).optional(), from: date.optional(), to: date.optional() })
    .strict()
    .refine(ordered, 'from must not be after to'),
]);
const document = (status: readonly [string, ...string[]]) =>
  z.discriminatedUnion('panel', [
    z.object({ panel: z.literal('list'), limit, cursor, status: z.enum(status).optional() }).strict(),
    z.object({ panel: z.literal('detail'), limit, cursor, id: z.uuid() }).strict(),
  ]);
const accounting = z.discriminatedUnion('panel', [
  z.object({ panel: z.literal('status'), limit, cursor }).strict(),
  z.object({ panel: z.literal('trial-balance'), limit, cursor, to: date.optional() }).strict(),
  z.object({ panel: z.literal('ledger'), limit, cursor, accountId: z.uuid(), partyId: z.uuid().optional(), from: date.optional(), to: date.optional() }).strict().refine(ordered, 'from must not be after to'),
  z.object({ panel: z.literal('day-book'), limit, cursor, from: date.optional(), to: date.optional() }).strict().refine(ordered, 'from must not be after to'),
]);
const QUERY = {
  inventory,
  'sales-invoices': document(DOC_STATUS),
  'purchase-invoices': document(DOC_STATUS),
  'work-orders': document(WORK_ORDER_STATUS),
  accounting,
} as const;

export class SupportInputError extends Error {
  readonly code = 'SUPPORT_INVALID_INPUT';
}
function strict<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new SupportInputError('Invalid support access input');
  return r.data;
}

export function isSupportArea(value: unknown): value is SupportArea {
  return typeof value === 'string' && (SUPPORT_AREAS as readonly string[]).includes(value);
}
export function parseSupportQuery(a: SupportArea, query: unknown): SupportQuery {
  if (!isSupportArea(a)) throw new SupportInputError('Unknown support area');
  return { area: a, ...strict(QUERY[a] as z.ZodType<object>, query) } as SupportQuery;
}
export function parseSupportApproval(input: unknown): SupportApprovalInput {
  return strict(supportApprovalSchema, input);
}
export function parseSupportPolicy(input: unknown): SupportPolicyInput {
  return strict(supportPolicySchema, input);
}
export function parseSupportList(input: unknown): SupportListQuery {
  return strict(supportListSchema, input);
}
