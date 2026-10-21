import { effectivePermissions, type ScopedGrant } from '@factoryos/auth';
import {
  capa,
  type Database,
  fai,
  gstRegistration,
  gstReturn,
  item,
  legalEntity,
  maasBooking,
  machine,
  maintenanceOrder,
  ncr,
  project,
  role,
  roleAssignment,
  supplierReturnClaim,
  testCampaign,
  testCampaignStep,
  timesheetEntry,
  user,
} from '@factoryos/db';
import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { Ctx, TenantScoped, type TenantRequestContext } from '../common/access.js';
import { DB } from '../common/tokens.js';
import { businessDate } from './accounting/accounting-lock.js';

export type ApprovalKind = 'gst_return' | 'ncr' | 'fai' | 'capa' | 'maintenance' | 'timesheet' | 'return_claim' | 'campaign_report' | 'usage_review';

/** One thing waiting for a decision, in the entity it belongs to. */
export interface ApprovalRow {
  kind: ApprovalKind;
  /** Unique within the inbox: the kind and the record (a person-week for timesheets). */
  key: string;
  entityId: string;
  entityName: string;
  number: string;
  title: string;
  /** Who sent it (prepared, submitted, owns it, signed it off); null when nobody is recorded. */
  from: string | null;
  /** When it started waiting (ISO date-time or date). */
  since: string;
  /** A date it waits until, for a CAPA check not yet due. */
  dueOn?: string;
  href: string;
  /** What the inbox itself can do: verify a maintenance order, or approve / send back these timesheet entries. */
  action?: { kind: 'verify'; orderId: string } | { kind: 'timesheets'; entryIds: string[]; hours: string };
}

interface Source {
  kind: ApprovalKind;
  /** Needed in the entity to see an item that waits on me. */
  approve: string;
  /** Needed in the entity to see my own item waiting on someone else. */
  read: string;
  run: (entityId: string, userId: string, mine: boolean) => Promise<Omit<ApprovalRow, 'kind' | 'entityId' | 'entityName'>[]>;
}

const LIMIT = 200;
const SOURCE_TIMEOUT_MS = 8000;
/** A source that cannot finish in time is reported in `errors`, as a Home tile is, and never holds up the rest. */
const limited = <T>(p: Promise<T>) => {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), SOURCE_TIMEOUT_MS);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
};
const iso = (d: Date | string | null | undefined) => (d instanceof Date ? d.toISOString() : (d ?? ''));
/** Monday of the week holding an ISO date. */
const weekOf = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
};

/**
 * The approvals inbox (decision 076): what waits on the signed-in person in every entity they can access, and what they
 * sent that waits on someone else. Each source uses the approve permission and the separation-of-duties rule of its own
 * endpoint, evaluated per entity, so the inbox never offers what the endpoint would refuse. Each source is computed on its
 * own: one that fails is reported in `errors` and never hides the rest.
 */
@Controller()
export class ApprovalsController {
  private readonly log = new Logger(ApprovalsController.name);
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get('approvals')
  @TenantScoped()
  async approvals(@Ctx() ctx: TenantRequestContext): Promise<{ needsMe: ApprovalRow[]; waitingOnOthers: ApprovalRow[]; errors: { kind: ApprovalKind; entityId: string }[] }> {
    const t = ctx.tenant;
    const grants: ScopedGrant[] = (
      await this.db
        .select({ permissions: role.permissions, entityIds: roleAssignment.entityIds })
        .from(roleAssignment)
        .innerJoin(role, eq(role.id, roleAssignment.roleId))
        .where(eq(roleAssignment.membershipId, t.membershipId))
    ).map((r) => ({ permissions: r.permissions, entityIds: r.entityIds ?? null }));
    const entities = await this.db
      .select({ id: legalEntity.id, name: legalEntity.shortName })
      .from(legalEntity)
      .where(t.entityIds === null ? eq(legalEntity.tenantId, t.tenantId) : and(eq(legalEntity.tenantId, t.tenantId), inArray(legalEntity.id, t.entityIds.length ? t.entityIds : ['00000000-0000-0000-0000-000000000000'])))
      .orderBy(asc(legalEntity.shortName));
    const sources = this.sources();
    const jobs: { kind: ApprovalKind; entity: (typeof entities)[number]; mine: boolean; run: Promise<Awaited<ReturnType<Source['run']>>> }[] = [];
    for (const e of entities) {
      const perms = effectivePermissions(grants, e.id);
      for (const s of sources) {
        if (perms.has(s.approve)) jobs.push({ kind: s.kind, entity: e, mine: false, run: s.run(e.id, ctx.user.id, false) });
        if (perms.has(s.read)) jobs.push({ kind: s.kind, entity: e, mine: true, run: s.run(e.id, ctx.user.id, true) });
      }
    }
    const settled = await Promise.allSettled(jobs.map((j) => limited(j.run)));
    const needsMe: ApprovalRow[] = [];
    const waitingOnOthers: ApprovalRow[] = [];
    const errors: { kind: ApprovalKind; entityId: string }[] = [];
    settled.forEach((r, i) => {
      const j = jobs[i]!;
      if (r.status !== 'fulfilled') {
        this.log.warn(`approvals source ${j.kind} failed for entity ${j.entity.id}: ${String((r.reason as Error)?.message ?? r.reason)}`);
        return void errors.push({ kind: j.kind, entityId: j.entity.id });
      }
      const into = j.mine ? waitingOnOthers : needsMe;
      for (const row of r.value) into.push({ ...row, kind: j.kind, entityId: j.entity.id, entityName: j.entity.name });
    });
    // Where the endpoint lets the sender approve too (NCR, return claim, test report, usage review), the row waits on me,
    // not on others: it shows once.
    const onMe = new Set(needsMe.map((r) => `${r.entityId}:${r.key}`));
    const others = waitingOnOthers.filter((r) => !onMe.has(`${r.entityId}:${r.key}`));
    const byOldest = (a: ApprovalRow, b: ApprovalRow) => a.since.localeCompare(b.since) || a.number.localeCompare(b.number);
    return { needsMe: needsMe.sort(byOldest), waitingOnOthers: others.sort(byOldest), errors };
  }

  private sources(): Source[] {
    const db = this.db;
    return [
      {
        kind: 'gst_return',
        approve: 'compliance.gst_return.approve',
        read: 'compliance.gst_return.read',
        run: async (entityId, userId, mine) => {
          const rows = await db
            .select({ id: gstReturn.id, kind: gstReturn.kind, period: gstReturn.period, gstin: gstRegistration.gstin, preparedBy: user.name, reviewedAt: gstReturn.reviewedAt })
            .from(gstReturn)
            .innerJoin(gstRegistration, eq(gstRegistration.id, gstReturn.gstRegistrationId))
            .innerJoin(user, eq(user.id, gstReturn.preparedBy))
            .where(and(eq(gstReturn.entityId, entityId), eq(gstReturn.status, 'reviewed'), mine ? eq(gstReturn.preparedBy, userId) : ne(gstReturn.preparedBy, userId)))
            .orderBy(asc(gstReturn.reviewedAt))
            .limit(LIMIT);
          return rows.map((r) => ({
            key: `gst_return:${r.id}`,
            number: `${r.kind === 'gstr1' ? 'GSTR-1' : 'GSTR-3B'} ${r.period}`,
            title: r.gstin,
            from: r.preparedBy,
            since: iso(r.reviewedAt),
            href: `/app/compliance/gst-returns/${r.id}`,
          }));
        },
      },
      {
        kind: 'ncr',
        approve: 'quality.ncr.approve',
        read: 'quality.ncr.read',
        run: async (entityId, userId, mine) => {
          // No separation rule on MRB approval; "mine" = I proposed a disposition still waiting.
          const proposed = sql`exists (select 1 from ncr_disposition d where d.ncr_id = ${ncr.id} and d.status = 'proposed'${mine ? sql` and d.proposed_by = ${userId}` : sql``})`;
          // Select-list subqueries name the outer table in full: drizzle writes its columns there unqualified.
          const rows = await db
            .select({ id: ncr.id, number: ncr.number, description: ncr.description, createdAt: ncr.createdAt, by: sql<string | null>`(select u.name from ncr_disposition d join "user" u on u.id = d.proposed_by where d.ncr_id = ncr.id and d.status = 'proposed' order by d.line_no limit 1)` })
            .from(ncr)
            .where(and(eq(ncr.entityId, entityId), eq(ncr.status, 'open'), proposed))
            .orderBy(asc(ncr.createdAt))
            .limit(LIMIT);
          return rows.map((r) => ({ key: `ncr:${r.id}`, number: r.number ?? 'NCR', title: r.description, from: r.by, since: iso(r.createdAt), href: `/app/quality/ncrs/${r.id}` }));
        },
      },
      {
        kind: 'fai',
        approve: 'quality.fai.approve',
        read: 'quality.fai.read',
        run: async (entityId, userId, mine) => {
          const rows = await db
            .select({ id: fai.id, number: fai.number, code: item.code, name: item.name, by: user.name, submittedAt: fai.submittedAt })
            .from(fai)
            .innerJoin(item, eq(item.id, fai.itemId))
            .leftJoin(user, eq(user.id, fai.submittedBy))
            .where(and(eq(fai.entityId, entityId), eq(fai.status, 'submitted'), mine ? eq(fai.submittedBy, userId) : sql`${fai.submittedBy} is distinct from ${userId}`))
            .orderBy(asc(fai.submittedAt))
            .limit(LIMIT);
          return rows.map((r) => ({ key: `fai:${r.id}`, number: r.number ?? 'FAI', title: `${r.code} · ${r.name}`, from: r.by, since: iso(r.submittedAt), href: `/app/quality/fai/${r.id}` }));
        },
      },
      {
        kind: 'capa',
        approve: 'quality.capa.approve',
        read: 'quality.capa.read',
        run: async (entityId, userId, mine) => {
          const today = businessDate();
          // Waiting on the checker once the check date is reached; the owner sees it from the start, with its date.
          const rows = await db
            .select({ id: capa.id, number: capa.number, title: capa.title, by: user.name, verifyDueOn: capa.verifyDueOn, updatedAt: capa.updatedAt })
            .from(capa)
            .innerJoin(user, eq(user.id, capa.ownerUserId))
            .where(
              and(
                eq(capa.entityId, entityId),
                eq(capa.status, 'verifying'),
                mine ? eq(capa.ownerUserId, userId) : and(ne(capa.ownerUserId, userId), sql`(${capa.verifyDueOn} is null or ${capa.verifyDueOn} <= ${today})`),
              ),
            )
            .orderBy(asc(capa.verifyDueOn))
            .limit(LIMIT);
          return rows.map((r) => ({
            key: `capa:${r.id}`,
            number: r.number ?? 'CAPA',
            title: r.title,
            from: r.by,
            since: r.verifyDueOn ?? iso(r.updatedAt),
            ...(r.verifyDueOn && r.verifyDueOn > today ? { dueOn: r.verifyDueOn } : {}),
            href: `/app/quality/capas/${r.id}`,
          }));
        },
      },
      {
        kind: 'maintenance',
        approve: 'maintenance.order.approve',
        read: 'maintenance.order.read',
        run: async (entityId, userId, mine) => {
          const rows = await db
            .select({ id: maintenanceOrder.id, number: maintenanceOrder.number, title: maintenanceOrder.title, machine: machine.code, by: user.name, doneAt: maintenanceOrder.doneAt })
            .from(maintenanceOrder)
            .innerJoin(machine, eq(machine.id, maintenanceOrder.machineId))
            .leftJoin(user, eq(user.id, maintenanceOrder.doneBy))
            .where(and(eq(maintenanceOrder.entityId, entityId), eq(maintenanceOrder.status, 'done'), eq(machine.critical, true), mine ? eq(maintenanceOrder.doneBy, userId) : sql`${maintenanceOrder.doneBy} is distinct from ${userId}`))
            .orderBy(asc(maintenanceOrder.doneAt))
            .limit(LIMIT);
          return rows.map((r) => ({
            key: `maintenance:${r.id}`,
            number: r.number,
            title: `${r.machine} · ${r.title}`,
            from: r.by,
            since: iso(r.doneAt),
            href: `/app/maintenance/orders/${r.id}`,
            ...(mine ? {} : { action: { kind: 'verify' as const, orderId: r.id } }),
          }));
        },
      },
      {
        kind: 'timesheet',
        approve: 'services.timesheet.approve',
        read: 'services.timesheet.read',
        run: async (entityId, userId, mine) => {
          const rows = await db
            .select({ id: timesheetEntry.id, userId: timesheetEntry.userId, name: user.name, workDate: timesheetEntry.workDate, hours: timesheetEntry.hours, project: project.number, updatedAt: timesheetEntry.updatedAt })
            .from(timesheetEntry)
            .innerJoin(user, eq(user.id, timesheetEntry.userId))
            .innerJoin(project, eq(project.id, timesheetEntry.projectId))
            .where(and(eq(timesheetEntry.entityId, entityId), eq(timesheetEntry.status, 'submitted'), mine ? eq(timesheetEntry.userId, userId) : ne(timesheetEntry.userId, userId)))
            .orderBy(asc(timesheetEntry.workDate))
            .limit(LIMIT * 10);
          // One row per person and week, as people submit them.
          const groups = new Map<string, { userId: string; name: string; week: string; ids: string[]; hundredths: number; projects: Set<string>; since: string }>();
          for (const r of rows) {
            const week = weekOf(r.workDate);
            const k = `${r.userId}:${week}`;
            const g = groups.get(k) ?? { userId: r.userId, name: r.name, week, ids: [], hundredths: 0, projects: new Set<string>(), since: iso(r.updatedAt) };
            g.ids.push(r.id);
            g.hundredths += Math.round(Number(r.hours) * 100);
            g.projects.add(r.project);
            if (iso(r.updatedAt) < g.since) g.since = iso(r.updatedAt);
            groups.set(k, g);
          }
          return [...groups.values()].map((g) => {
            const hours = (g.hundredths / 100).toFixed(2);
            return {
              key: `timesheet:${g.userId}:${g.week}`,
              number: `Week of ${g.week}`,
              title: `${g.name} · ${hours} h · ${[...g.projects].sort().join(', ')}`,
              from: g.name,
              since: g.since,
              href: `/app/services/timesheets`,
              ...(mine ? {} : { action: { kind: 'timesheets' as const, entryIds: g.ids, hours } }),
            };
          });
        },
      },
      {
        kind: 'return_claim',
        approve: 'buying.return_claim.approve',
        read: 'buying.return_claim.read',
        run: async (entityId, userId, mine) => {
          const rows = await db
            .select({ id: supplierReturnClaim.id, number: supplierReturnClaim.number, reason: supplierReturnClaim.reason, by: user.name, submittedAt: supplierReturnClaim.submittedAt })
            .from(supplierReturnClaim)
            .leftJoin(user, eq(user.id, supplierReturnClaim.submittedBy))
            .where(and(eq(supplierReturnClaim.entityId, entityId), eq(supplierReturnClaim.status, 'submitted'), isNull(supplierReturnClaim.approvedBy), ...(mine ? [eq(supplierReturnClaim.submittedBy, userId)] : [])))
            .orderBy(asc(supplierReturnClaim.submittedAt))
            .limit(LIMIT);
          return rows.map((r) => ({ key: `return_claim:${r.id}`, number: r.number ?? 'Claim', title: r.reason, from: r.by, since: iso(r.submittedAt), href: `/app/buying/return-claims/${r.id}` }));
        },
      },
      {
        kind: 'campaign_report',
        approve: 'services.campaign.approve',
        read: 'services.campaign.read',
        run: async (entityId, userId, mine) => {
          // Ready for sign-off: active, with at least one step and none still pending.
          const rows = await db
            .select({ id: testCampaign.id, number: testCampaign.number, title: testCampaign.title, by: user.name, last: sql<Date | null>`(select max(s.recorded_at) from test_campaign_step s where s.campaign_id = test_campaign.id)` })
            .from(testCampaign)
            .innerJoin(user, eq(user.id, testCampaign.createdBy))
            .where(
              and(
                eq(testCampaign.entityId, entityId),
                eq(testCampaign.status, 'active'),
                sql`exists (select 1 from ${testCampaignStep} s where s.campaign_id = ${testCampaign.id})`,
                sql`not exists (select 1 from ${testCampaignStep} s where s.campaign_id = ${testCampaign.id} and s.result = 'pending')`,
                ...(mine ? [eq(testCampaign.createdBy, userId)] : []),
              ),
            )
            .orderBy(asc(testCampaign.createdAt))
            .limit(LIMIT);
          return rows.map((r) => ({ key: `campaign_report:${r.id}`, number: r.number, title: r.title, from: r.by, since: iso(r.last), href: `/app/services/campaigns/${r.id}` }));
        },
      },
      {
        kind: 'usage_review',
        approve: 'services.usage.approve',
        read: 'services.booking.read',
        run: async (entityId, userId, mine) => {
          const rows = await db
            .select({ id: maasBooking.id, number: maasBooking.number, machine: machine.code, by: user.name, stoppedAt: maasBooking.stoppedAt })
            .from(maasBooking)
            .innerJoin(machine, eq(machine.id, maasBooking.machineId))
            .innerJoin(user, eq(user.id, maasBooking.createdBy))
            .where(and(eq(maasBooking.entityId, entityId), eq(maasBooking.meterStatus, 'review'), ...(mine ? [eq(maasBooking.createdBy, userId)] : [])))
            .orderBy(asc(maasBooking.stoppedAt))
            .limit(LIMIT);
          return rows.map((r) => ({ key: `usage_review:${r.id}`, number: r.number, title: `${r.machine} · metered usage to confirm`, from: r.by, since: iso(r.stoppedAt), href: `/app/services/bookings/${r.id}` }));
        },
      },
    ];
  }
}

