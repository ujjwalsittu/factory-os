// Decision 061: CAPA. Raised from NCRs (several may link) or standalone; a 5-Why and root cause on every CAPA, the 8D
// sections on major ones; actions with owners and due dates; after all are done, an effectiveness check by someone other
// than the owner once the verification date has come. Not effective returns it to action; every check is kept.
import { attachment, capa, capaAction, capaNcr, capaVerification, item, membership, ncr, type Database, user } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf, type Tx } from '../accounting/accounting-lock.js';
import { StockPostingService } from '../stock-posting.service.js';

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const capaInput = z.object({
  source: z.enum(['ncr', 'audit', 'complaint', 'other']),
  title: z.string().trim().min(3).max(200),
  problem: z.string().trim().min(5, 'Describe the problem').max(4000),
  severity: z.enum(['minor', 'major']),
  ownerUserId: z.string().min(1),
  verifyAfterDays: z.number().int().min(30).max(180).default(60),
  ncrIds: z.array(z.uuid()).max(50).default([]),
});
const analysisInput = z.object({
  title: z.string().trim().min(3).max(200),
  problem: z.string().trim().min(5).max(4000),
  ownerUserId: z.string().min(1),
  verifyAfterDays: z.number().int().min(30).max(180),
  whys: z.array(z.string().trim().min(2).max(1000)).max(5),
  rootCause: text(2000),
  team: text(1000),
  containment: text(2000),
  recognition: text(1000),
});
const actionInput = z.object({ kind: z.enum(['containment', 'corrective', 'preventive']), description: z.string().trim().min(3).max(2000), ownerUserId: z.string().min(1), dueOn: z.iso.date() });
const doneInput = z.object({ doneOn: z.iso.date().optional(), note: z.string().trim().min(3, 'Say what was done').max(2000) });
const verifyInput = z.object({ effective: z.boolean(), note: z.string().trim().min(5, 'Record the evidence').max(4000), recognition: text(1000) });
const reasonInput = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });
const listQuery = z.object({ status: z.enum(['open', 'in_action', 'verifying', 'closed', 'cancelled']).optional(), ownerUserId: z.string().optional(), ncrId: z.uuid().optional() });

type Capa = typeof capa.$inferSelect;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

@Controller('quality')
export class CapaController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
  ) {}

  @Get('capas')
  @RequirePermission('quality.capa.read')
  async list(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const q = parse(listQuery, query);
    const owner = alias(user, 'owner');
    const linked = q.ncrId ? (await this.db.select({ id: capaNcr.capaId }).from(capaNcr).where(eq(capaNcr.ncrId, q.ncrId))).map((r) => r.id) : null;
    if (linked && !linked.length) return [];
    const rows = await this.db
      .select({ c: capa, ownerName: owner.name })
      .from(capa)
      .innerJoin(owner, eq(owner.id, capa.ownerUserId))
      .where(and(eq(capa.entityId, entityId), q.status ? eq(capa.status, q.status) : undefined, q.ownerUserId ? eq(capa.ownerUserId, q.ownerUserId) : undefined, linked ? inArray(capa.id, linked) : undefined))
      .orderBy(desc(capa.createdAt))
      .limit(500);
    const ids = rows.map((r) => r.c.id);
    const open = ids.length
      ? await this.db
          .select({ capaId: capaAction.capaId, n: sql<number>`count(*)::int`, next: sql<string | null>`min(${capaAction.dueOn})::text` })
          .from(capaAction)
          .where(and(inArray(capaAction.capaId, ids), eq(capaAction.status, 'open')))
          .groupBy(capaAction.capaId)
      : [];
    const today = businessDate();
    return rows.map((r) => {
      const a = open.find((x) => x.capaId === r.c.id);
      const nextDue = r.c.status === 'verifying' ? r.c.verifyDueOn : (a?.next ?? null);
      return { ...r.c, ownerName: r.ownerName, openActions: a?.n ?? 0, nextDue, overdue: !!nextDue && nextDue < today && r.c.status !== 'closed' && r.c.status !== 'cancelled' && r.c.status !== 'verifying', verificationDue: r.c.status === 'verifying' && !!r.c.verifyDueOn && r.c.verifyDueOn <= today };
    });
  }

  @Get('capas/:id')
  @RequirePermission('quality.capa.read')
  async get(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const owner = alias(user, 'owner');
    const [r] = await this.db.select({ c: capa, ownerName: owner.name }).from(capa).innerJoin(owner, eq(owner.id, capa.ownerUserId)).where(and(eq(capa.id, id), eq(capa.entityId, entityId)));
    if (!r) throw new NotFoundException('CAPA not found');
    const ncrs = await this.db
      .select({ id: ncr.id, number: ncr.number, status: ncr.status, description: ncr.description, itemCode: item.code, itemName: item.name })
      .from(capaNcr)
      .innerJoin(ncr, eq(ncr.id, capaNcr.ncrId))
      .innerJoin(item, eq(item.id, ncr.itemId))
      .where(eq(capaNcr.capaId, id))
      .orderBy(asc(ncr.number));
    const actionOwner = alias(user, 'action_owner');
    const doer = alias(user, 'doer');
    const actions = await this.db
      .select({ a: capaAction, ownerName: actionOwner.name, doneByName: doer.name })
      .from(capaAction)
      .innerJoin(actionOwner, eq(actionOwner.id, capaAction.ownerUserId))
      .leftJoin(doer, eq(doer.id, capaAction.doneBy))
      .where(eq(capaAction.capaId, id))
      .orderBy(asc(capaAction.createdAt));
    const verifier = alias(user, 'verifier');
    const verifications = await this.db
      .select({ v: capaVerification, verifiedByName: verifier.name })
      .from(capaVerification)
      .innerJoin(verifier, eq(verifier.id, capaVerification.verifiedBy))
      .where(eq(capaVerification.capaId, id))
      .orderBy(asc(capaVerification.verifiedAt));
    const files = await this.db
      .select({ id: attachment.id, fileName: attachment.fileName, kind: attachment.kind })
      .from(attachment)
      .where(and(eq(attachment.entityId, entityId), eq(attachment.ownerType, 'capa'), eq(attachment.ownerId, id), isNull(attachment.withdrawnAt)));
    const today = businessDate();
    return {
      ...r.c,
      ownerName: r.ownerName,
      ncrs,
      actions: actions.map((a) => ({ ...a.a, ownerName: a.ownerName, doneByName: a.doneByName, overdue: a.a.status === 'open' && a.a.dueOn < today })),
      verifications: verifications.map((v) => ({ ...v.v, verifiedByName: v.verifiedByName })),
      files,
      today,
      verificationDue: r.c.status === 'verifying' && !!r.c.verifyDueOn && r.c.verifyDueOn <= today,
    };
  }

  @Get('capa-people')
  @RequirePermission('quality.capa.read')
  async people(@Ctx() ctx: TenantRequestContext) {
    return this.db
      .select({ id: user.id, name: user.name })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(and(eq(membership.tenantId, ctx.tenant.tenantId), eq(membership.status, 'active')))
      .orderBy(asc(user.name));
  }

  @Post('capas')
  @RequirePermission('quality.capa.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(capaInput, body);
    await this.member(ctx, input.ownerUserId, 'owner');
    if (input.source === 'ncr' && !input.ncrIds.length) throw new BadRequestException({ message: 'Link the NCR this CAPA comes from', issues: [{ path: 'ncrIds', message: 'Required for source NCR' }] });
    return this.db.transaction(async (tx) => {
      await this.ncrsIn(tx, entityId, input.ncrIds);
      const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'capa', businessDate());
      const [c] = await tx
        .insert(capa)
        .values({ tenantId: ctx.tenant.tenantId, entityId, number, source: input.source, title: input.title, problem: input.problem, severity: input.severity, ownerUserId: input.ownerUserId, verifyAfterDays: input.verifyAfterDays, createdBy: ctx.user.id })
        .returning();
      if (input.ncrIds.length) await tx.insert(capaNcr).values([...new Set(input.ncrIds)].map((ncrId) => ({ capaId: c!.id, ncrId })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'capa.create', targetType: 'capa', targetId: c!.id, after: { number, ...input } }, tx);
      return c!;
    });
  }

  /** Problem, owner, wait, 5-Why, root cause and the 8D texts; while open or in action. */
  @Put('capas/:id')
  @RequirePermission('quality.capa.update')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(analysisInput, body);
    await this.member(ctx, input.ownerUserId, 'owner');
    await this.transition(ctx, id, 'capa.update', async (tx, c) => {
      this.editable(c);
      await tx
        .update(capa)
        .set({ title: input.title, problem: input.problem, ownerUserId: input.ownerUserId, verifyAfterDays: input.verifyAfterDays, whys: input.whys, rootCause: input.rootCause ?? null, team: input.team ?? null, containment: input.containment ?? null, recognition: input.recognition ?? null, updatedAt: new Date() })
        .where(eq(capa.id, id));
    }, input);
    return { ok: true };
  }

  @Post('capas/:id/ncrs')
  @RequirePermission('quality.capa.update')
  async linkNcr(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { ncrId } = parse(z.object({ ncrId: z.uuid() }), body);
    await this.transition(ctx, id, 'capa.link_ncr', async (tx, c) => {
      if (c.status === 'closed' || c.status === 'cancelled') throw new ConflictException(`A ${c.status} CAPA’s links are fixed`);
      await this.ncrsIn(tx, c.entityId, [ncrId]);
      await tx.insert(capaNcr).values({ capaId: id, ncrId }).onConflictDoNothing();
    }, { ncrId });
    return { ok: true };
  }

  @Delete('capas/:id/ncrs/:ncrId')
  @RequirePermission('quality.capa.update')
  async unlinkNcr(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Param('ncrId', ParseUUIDPipe) ncrId: string) {
    await this.transition(ctx, id, 'capa.unlink_ncr', async (tx, c) => {
      if (c.status === 'closed' || c.status === 'cancelled') throw new ConflictException(`A ${c.status} CAPA’s links are fixed`);
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(capaNcr).where(eq(capaNcr.capaId, id));
      if (c.source === 'ncr' && (n?.n ?? 0) <= 1) throw new ConflictException('A CAPA raised from an NCR keeps at least one');
      await tx.delete(capaNcr).where(and(eq(capaNcr.capaId, id), eq(capaNcr.ncrId, ncrId)));
    }, { ncrId });
    return { ok: true };
  }

  // ── Actions ──

  @Post('capas/:id/actions')
  @RequirePermission('quality.capa.update')
  async addAction(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(actionInput, body);
    await this.member(ctx, input.ownerUserId, 'action owner');
    let created: unknown;
    await this.transition(ctx, id, 'capa.action_add', async (tx, c) => {
      this.editable(c);
      [created] = await tx.insert(capaAction).values({ capaId: id, kind: input.kind, description: input.description, ownerUserId: input.ownerUserId, dueOn: input.dueOn }).returning();
    }, input);
    return created;
  }

  @Put('capa-actions/:aid')
  @RequirePermission('quality.capa.update')
  async editAction(@Ctx() ctx: TenantRequestContext, @Param('aid', ParseUUIDPipe) aid: string, @Body() body: unknown) {
    const input = parse(actionInput, body);
    await this.member(ctx, input.ownerUserId, 'action owner');
    const a = await this.actionIn(ctx, aid);
    await this.transition(ctx, a.capaId, 'capa.action_edit', async (tx, c) => {
      this.editable(c);
      const [locked] = await tx.select().from(capaAction).where(eq(capaAction.id, aid)).for('update');
      if (locked!.status !== 'open') throw new ConflictException(`A ${locked!.status} action is fixed`);
      await tx.update(capaAction).set({ kind: input.kind, description: input.description, ownerUserId: input.ownerUserId, dueOn: input.dueOn }).where(eq(capaAction.id, aid));
    }, { aid, ...input });
    return { ok: true };
  }

  @Post('capa-actions/:aid/done')
  @RequirePermission('quality.capa.update')
  async actionDone(@Ctx() ctx: TenantRequestContext, @Param('aid', ParseUUIDPipe) aid: string, @Body() body: unknown) {
    const input = parse(doneInput, body);
    const a = await this.actionIn(ctx, aid);
    await this.transition(ctx, a.capaId, 'capa.action_done', async (tx, c) => {
      if (c.status !== 'in_action') throw new ConflictException(c.status === 'open' ? 'Start the actions first (root cause and plan)' : `A ${c.status.replace('_', ' ')} CAPA’s actions are fixed`);
      const [locked] = await tx.select().from(capaAction).where(eq(capaAction.id, aid)).for('update');
      if (locked!.status !== 'open') throw new ConflictException(`Already ${locked!.status}`);
      const doneOn = input.doneOn ?? businessDate();
      if (doneOn > businessDate()) throw new BadRequestException('The completion date can’t be in the future');
      await tx.update(capaAction).set({ status: 'done', doneOn, doneNote: input.note, doneBy: ctx.user.id }).where(eq(capaAction.id, aid));
    }, { aid, ...input });
    return { ok: true };
  }

  @Post('capa-actions/:aid/cancel')
  @RequirePermission('quality.capa.update')
  async actionCancel(@Ctx() ctx: TenantRequestContext, @Param('aid', ParseUUIDPipe) aid: string, @Body() body: unknown) {
    const { reason } = parse(reasonInput, body);
    const a = await this.actionIn(ctx, aid);
    await this.transition(ctx, a.capaId, 'capa.action_cancel', async (tx, c) => {
      this.editable(c);
      const [locked] = await tx.select().from(capaAction).where(eq(capaAction.id, aid)).for('update');
      if (locked!.status !== 'open') throw new ConflictException(`Already ${locked!.status}`);
      await tx.update(capaAction).set({ status: 'cancelled', cancelReason: reason }).where(eq(capaAction.id, aid));
    }, { aid, reason });
    return { ok: true };
  }

  // ── Life cycle ──

  /** Open → in action: the root cause is known and the corrective work is planned. */
  @Post('capas/:id/start')
  @RequirePermission('quality.capa.update')
  async start(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.transition(ctx, id, 'capa.start', async (tx, c) => {
      if (c.status !== 'open') throw new ConflictException('Only an open CAPA is started');
      const missing: string[] = [];
      if (c.whys.length < 2) missing.push('at least two whys');
      if (!c.rootCause) missing.push('the root-cause statement');
      if (c.severity === 'major' && !c.team) missing.push('the team (D1)');
      if (c.severity === 'major' && !c.containment) missing.push('the containment (D3)');
      const [ca] = await tx.select({ n: sql<number>`count(*)::int` }).from(capaAction).where(and(eq(capaAction.capaId, id), eq(capaAction.kind, 'corrective'), eq(capaAction.status, 'open')));
      if (!ca?.n) missing.push('a corrective action');
      if (missing.length) throw new BadRequestException(`Before starting, add ${missing.join(', ')}`);
      await tx.update(capa).set({ status: 'in_action', updatedAt: new Date() }).where(eq(capa.id, id));
    });
    return { ok: true };
  }

  /** In action → verifying: every action finished; the check falls due after the CAPA's wait. */
  @Post('capas/:id/submit')
  @RequirePermission('quality.capa.update')
  async submit(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    let verifyDueOn = '';
    await this.transition(ctx, id, 'capa.submit', async (tx, c) => {
      if (c.status !== 'in_action') throw new ConflictException('Submit a CAPA in action');
      const rows = await tx.select({ kind: capaAction.kind, status: capaAction.status }).from(capaAction).where(eq(capaAction.capaId, id));
      const open = rows.filter((r) => r.status === 'open').length;
      if (open) throw new ConflictException(`${open} action${open === 1 ? ' is' : 's are'} still open`);
      if (!rows.some((r) => r.kind === 'corrective' && r.status === 'done')) throw new ConflictException('At least one corrective action must be done');
      verifyDueOn = addDays(businessDate(), c.verifyAfterDays);
      await tx.update(capa).set({ status: 'verifying', verifyDueOn, updatedAt: new Date() }).where(eq(capa.id, id));
    }, {});
    return { ok: true, verifyDueOn };
  }

  /** The effectiveness check: on or after the due date, by someone other than the owner. */
  @Post('capas/:id/verify')
  @RequirePermission('quality.capa.approve')
  async verify(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(verifyInput, body);
    await this.transition(ctx, id, 'capa.verify', async (tx, c) => {
      if (c.status !== 'verifying') throw new ConflictException('Verify a CAPA waiting for its effectiveness check');
      if (c.ownerUserId === ctx.user.id) throw new ForbiddenException('Someone other than the owner checks effectiveness');
      if (c.verifyDueOn && businessDate() < c.verifyDueOn) throw new ConflictException(`The effectiveness check is due on ${c.verifyDueOn}`);
      const recognition = input.recognition ?? c.recognition;
      if (input.effective && c.severity === 'major' && !recognition) throw new BadRequestException({ message: 'A major CAPA closes with D8 recognition (it may say none)', issues: [{ path: 'recognition', message: 'Required' }] });
      await tx.insert(capaVerification).values({ capaId: id, effective: input.effective, note: input.note, verifiedBy: ctx.user.id });
      if (input.effective) await tx.update(capa).set({ status: 'closed', closedAt: new Date(), recognition: recognition ?? null, updatedAt: new Date() }).where(eq(capa.id, id));
      else await tx.update(capa).set({ status: 'in_action', verifyDueOn: null, updatedAt: new Date() }).where(eq(capa.id, id));
    }, input);
    return { ok: true };
  }

  @Post('capas/:id/cancel')
  @RequirePermission('quality.capa.cancel')
  async cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { reason } = parse(reasonInput, body);
    await this.transition(ctx, id, 'capa.cancel', async (tx, c) => {
      if (c.status !== 'open' && c.status !== 'in_action') throw new ConflictException(`A ${c.status} CAPA can’t be cancelled`);
      await tx.update(capa).set({ status: 'cancelled', cancelReason: reason, updatedAt: new Date() }).where(eq(capa.id, id));
    }, { reason });
    return { ok: true };
  }

  // ── helpers ──

  private async transition(ctx: TenantRequestContext, id: string, action: string, fn: (tx: Tx, c: Capa) => Promise<void>, after?: unknown) {
    const entityId = entityOf(ctx);
    await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(capa).where(and(eq(capa.id, id), eq(capa.entityId, entityId))).for('update');
      if (!c) throw new NotFoundException('CAPA not found');
      await fn(tx, c);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action, targetType: 'capa', targetId: id, after }, tx);
    });
  }

  private editable(c: Capa) {
    if (c.status !== 'open' && c.status !== 'in_action') throw new ConflictException(c.status === 'verifying' ? 'The CAPA waits for its effectiveness check' : `A ${c.status} CAPA is fixed`);
  }

  private async member(ctx: TenantRequestContext, userId: string, what: string) {
    const [m] = await this.db.select({ id: membership.id }).from(membership).where(and(eq(membership.tenantId, ctx.tenant.tenantId), eq(membership.userId, userId), eq(membership.status, 'active')));
    if (!m) throw new BadRequestException(`The ${what} must be an active member`);
  }

  private async ncrsIn(tx: Tx, entityId: string, ids: string[]) {
    if (!ids.length) return;
    const found = await tx.select({ id: ncr.id }).from(ncr).where(and(inArray(ncr.id, ids), eq(ncr.entityId, entityId)));
    if (found.length !== new Set(ids).size) throw new NotFoundException('NCR not found in this entity');
  }

  private async actionIn(ctx: TenantRequestContext, aid: string) {
    const [a] = await this.db
      .select({ id: capaAction.id, capaId: capaAction.capaId })
      .from(capaAction)
      .innerJoin(capa, eq(capa.id, capaAction.capaId))
      .where(and(eq(capaAction.id, aid), eq(capa.entityId, entityOf(ctx))));
    if (!a) throw new NotFoundException('Action not found');
    return a;
  }
}
