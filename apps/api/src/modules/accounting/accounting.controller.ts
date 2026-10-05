import { randomUUID } from 'node:crypto';
import { glAccount as account, accountGroup, accountingSettings, glEntry, journalVoucher, openingWorksheet, party, type Database } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf, lockAccounting, type Tx } from './accounting-lock.js';
import { DEFAULT_ACCOUNTS, seedChart } from './chart.js';
import { GlPostingService } from './gl-posting.service.js';
import { OpeningService } from './opening.service.js';
const amount = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Decimal amount, at most six places');
const date = z.iso.date();
const line = z.object({ accountId: z.uuid(), debit: amount, credit: amount, partyId: z.uuid().optional(), billReference: z.string().trim().min(1).max(120).optional() });
const journalInput = z.object({ postingDate: date, narration: z.string().trim().min(5).max(1000), lines: z.array(line).min(2).max(200) });
const worksheetInput = z.object({ lines: z.array(line).max(1000), bills: z.array(z.object({ partyId: z.uuid(), reference: z.string().trim().min(1).max(120), side: z.enum(['debit', 'credit']), amount, invoiceId: z.uuid().optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), exchangeRate: amount.optional(), originalAmount: amount.optional() })).max(2000), settlements: z.array(z.object({ invoiceId: z.uuid(), amount, reason: z.string().trim().min(5).max(500) })).max(2000), receiptBaselines: z.array(z.object({ receiptLineId: z.uuid(), qty: amount, baseCost: amount })).max(2000) });
@Controller('accounts')
export class AccountingController {
  constructor(@Inject(DB) private readonly db: Database, private readonly gl: GlPostingService, private readonly opening: OpeningService, private readonly audit: AuditService) {}
  private async setup(ctx: TenantRequestContext) { const entityId = entityOf(ctx); await this.db.transaction(async tx => { await lockAccounting(tx, entityId); await seedChart(tx, ctx, entityId); }); return entityId; }
  @Get('settings') @RequirePermission('accounts.setup.read')
  async settings(@Ctx() ctx: TenantRequestContext) { const entityId = await this.setup(ctx); const [s] = await this.db.select().from(accountingSettings).where(eq(accountingSettings.entityId, entityId)); return s; }
  @Put('settings') @RequirePermission('accounts.setup.update')
  async mappings(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx), input = parse(z.object({ mappings: z.record(z.string(), z.uuid()) }), body);
    return this.db.transaction(async tx => {
      await lockAccounting(tx, entityId); await seedChart(tx, ctx, entityId);
      const rows = await tx.select().from(account).where(and(eq(account.entityId, entityId), eq(account.isActive, true)));
      for (const [role] of DEFAULT_ACCOUNTS) if (!input.mappings[role] || !rows.some(a => a.id === input.mappings[role])) throw new BadRequestException(`Map ${role} to an active account in this entity`);
      if (Object.keys(input.mappings).some(k => !DEFAULT_ACCOUNTS.some(([r]) => r === k))) throw new BadRequestException('Unknown account mapping role');
      // Distinct controls are essential for inventory and party reconciliation.
      if (new Set(Object.values(input.mappings)).size !== Object.values(input.mappings).length) throw new BadRequestException('Each accounting role requires a distinct account');
      await tx.update(accountingSettings).set({ mappings: input.mappings }).where(eq(accountingSettings.entityId, entityId));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'accounting.mappings', targetType: 'legal_entity', targetId: entityId, after: input }, tx);
      return { ok: true };
    });
  }
  @Get('groups') @RequirePermission('accounts.account.read')
  async groups(@Ctx() ctx: TenantRequestContext) { const entityId = await this.setup(ctx); return this.db.select().from(accountGroup).where(eq(accountGroup.entityId, entityId)); }
  @Post('groups') @RequirePermission('accounts.account.create')
  async createGroup(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx), input = parse(z.object({ name: z.string().trim().min(2).max(120), root: z.enum(['asset', 'liability', 'equity', 'income', 'expense']), parentId: z.uuid().optional() }), body);
    return this.db.transaction(async tx => { await lockAccounting(tx, entityId); if (input.parentId) { const [parent] = await tx.select().from(accountGroup).where(and(eq(accountGroup.id, input.parentId), eq(accountGroup.entityId, entityId))); if (!parent || parent.root !== input.root) throw new BadRequestException('Choose a parent with the same root classification'); } const [g] = await tx.insert(accountGroup).values({ ...input, key: randomUUID(), tenantId: ctx.tenant.tenantId, entityId }).returning(); await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'account_group.create', targetType: 'account_group', targetId: g!.id, after: input }, tx); return g; });
  }
  @Get('accounts') @RequirePermission('accounts.account.read')
  async accounts(@Ctx() ctx: TenantRequestContext) { const entityId = await this.setup(ctx); return this.db.select().from(account).where(eq(account.entityId, entityId)).orderBy(account.code); }
  @Post('accounts') @RequirePermission('accounts.account.create')
  async createAccount(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx), input = parse(z.object({ code: z.string().trim().min(1).max(32), name: z.string().trim().min(2).max(120), groupId: z.uuid() }), body);
    return this.db.transaction(async tx => { await lockAccounting(tx, entityId); const [group] = await tx.select().from(accountGroup).where(and(eq(accountGroup.id, input.groupId), eq(accountGroup.entityId, entityId))); if (!group) throw new BadRequestException('Group belongs to another entity'); const [a] = await tx.insert(account).values({ ...input, code: input.code.toUpperCase(), tenantId: ctx.tenant.tenantId, entityId }).returning(); await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'account.create', targetType: 'account', targetId: a!.id, after: input }, tx); return a; });
  }
  @Put('accounts/:id') @RequirePermission('accounts.account.update')
  async updateAccount(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx), input = parse(z.object({ name: z.string().trim().min(2).max(120).optional(), isActive: z.boolean().optional(), groupId: z.uuid().optional() }), body);
    return this.db.transaction(async tx => { await lockAccounting(tx, entityId); const [a] = await tx.select().from(account).where(and(eq(account.id, id), eq(account.entityId, entityId))); if (!a) throw new NotFoundException('Account not found'); const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId, entityId)); if (input.isActive === false && Object.values(settings?.mappings ?? {}).includes(id)) throw new ConflictException('Remap this required account before deactivating it'); if (input.groupId && input.groupId !== a.groupId) { const [g] = await tx.select().from(accountGroup).where(and(eq(accountGroup.id, input.groupId), eq(accountGroup.entityId, entityId))); if (!g) throw new BadRequestException('Group belongs to another entity'); const [posted] = await tx.select().from(glEntry).where(eq(glEntry.accountId, id)).limit(1); if (posted) throw new ConflictException('Posted account classification cannot change'); } const [after] = await tx.update(account).set(input).where(eq(account.id, id)).returning(); await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'account.update', targetType: 'account', targetId: id, after: input }, tx); return after; });
  }
  @Get('opening') @RequirePermission('accounts.setup.read')
  async worksheet(@Ctx() ctx: TenantRequestContext) { const entityId = await this.setup(ctx); const [w] = await this.db.select().from(openingWorksheet).where(eq(openingWorksheet.entityId, entityId)); return w ?? null; }
  @Put('opening') @RequirePermission('accounts.setup.create')
  async saveOpening(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx), input = parse(worksheetInput, body);
    return this.db.transaction(async tx => {
      await lockAccounting(tx, entityId); await seedChart(tx, ctx, entityId);
      if (await this.gl.active(tx, entityId)) throw new ConflictException('Opening books are immutable after activation');
      if (input.lines.length) await this.gl.validateLines(tx, ctx, entityId, input.lines);
      for (const list of [input.bills.map(b => b.invoiceId).filter(Boolean), input.bills.map(b => `${b.partyId}:${b.reference}:${b.side}`), input.receiptBaselines.map(r => r.receiptLineId), input.settlements.map(s => s.invoiceId)]) if (new Set(list).size !== list.length) throw new BadRequestException('Duplicate opening reference');
      const parties = await tx.select().from(party).where(eq(party.tenantId, ctx.tenant.tenantId));
      for (const bill of input.bills) if (!parties.some(p => p.id === bill.partyId)) throw new BadRequestException('Opening party belongs to another tenant');
      const [w] = await tx.insert(openingWorksheet).values({ ...input, tenantId: ctx.tenant.tenantId, entityId, createdBy: ctx.user.id }).onConflictDoUpdate({ target: openingWorksheet.entityId, set: { ...input, updatedAt: new Date() } }).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'opening.save', targetType: 'opening_worksheet', targetId: w!.id, after: input }, tx); return w;
    });
  }
  @Get('opening/reconciliation') @RequirePermission('accounts.setup.read')
  async reconciliation(@Ctx() ctx: TenantRequestContext) { const entityId = await this.setup(ctx); return this.db.transaction(async tx => { await lockAccounting(tx, entityId); return this.opening.preview(tx, entityId); }); }
  @Post('opening/activate') @HttpCode(200) @RequirePermission('accounts.setup.approve')
  async activate(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) { const entityId = entityOf(ctx), input = parse(z.object({ worksheetId: z.uuid(), reviewedToken: z.string().length(64) }), body); return this.db.transaction(tx => this.opening.activateIn(tx, ctx, entityId, input.worksheetId, input.reviewedToken)); }
  @Get('journals') @RequirePermission('accounts.voucher.read')
  async journals(@Ctx() ctx: TenantRequestContext) { return this.db.select().from(journalVoucher).where(eq(journalVoucher.entityId, entityOf(ctx))).orderBy(desc(journalVoucher.postingDate), desc(journalVoucher.submittedAt)); }
  @Get('journals/:id') @RequirePermission('accounts.voucher.read')
  async detail(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx), [v] = await this.db.select().from(journalVoucher).where(and(eq(journalVoucher.id, id), eq(journalVoucher.entityId, entityId)));
    if (!v) throw new NotFoundException('Voucher not found');
    const entries = await this.db.select().from(glEntry).where(eq(glEntry.voucherId, id));
    const [reversal] = await this.db.select().from(journalVoucher).where(and(eq(journalVoucher.entityId, entityId), eq(journalVoucher.reversalOf, id)));
    return { ...v, entries, reversal: reversal ? { ...reversal, entries: await this.db.select().from(glEntry).where(eq(glEntry.voucherId, reversal.id)) } : null };
  }
  private async journalCheck(tx: Tx, ctx: TenantRequestContext, entityId: string, input: z.infer<typeof journalInput>) { const settings = await this.gl.active(tx, entityId); if (!settings) throw new ConflictException('Activate accounting before creating journals'); if (input.postingDate < settings.cutoverDate! || input.postingDate > businessDate()) throw new BadRequestException('Journal date must be within the active accounting period'); await this.gl.validateLines(tx, ctx, entityId, input.lines, true); }
  @Post('journals') @RequirePermission('accounts.voucher.create')
  async createJournal(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) { const entityId = entityOf(ctx), input = parse(journalInput, body); return this.db.transaction(async tx => { await lockAccounting(tx, entityId); await this.journalCheck(tx, ctx, entityId, input); const id = randomUUID(); const [v] = await tx.insert(journalVoucher).values({ id, tenantId: ctx.tenant.tenantId, entityId, sourceType: 'manual', sourceId: id, postingDate: input.postingDate, narration: input.narration, draftLines: input.lines, createdBy: ctx.user.id }).returning(); await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'journal.create', targetType: 'journal_voucher', targetId: id, after: input }, tx); return v; }); }
  @Put('journals/:id') @RequirePermission('accounts.voucher.create')
  async updateJournal(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { const entityId = entityOf(ctx), input = parse(journalInput, body); return this.db.transaction(async tx => { await lockAccounting(tx, entityId); const [v] = await tx.select().from(journalVoucher).where(and(eq(journalVoucher.id, id), eq(journalVoucher.entityId, entityId))).for('update'); if (!v) throw new NotFoundException(); if (v.status !== 'draft' || v.sourceType !== 'manual') throw new ConflictException('Only manual drafts can change'); await this.journalCheck(tx, ctx, entityId, input); const [after] = await tx.update(journalVoucher).set({ postingDate: input.postingDate, narration: input.narration, draftLines: input.lines }).where(eq(journalVoucher.id, id)).returning(); await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'journal.update', targetType: 'journal_voucher', targetId: id, after: input }, tx); return after; }); }
  @Post('journals/:id/submit') @HttpCode(200) @RequirePermission('accounts.voucher.submit')
  async submitJournal(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) { const entityId = entityOf(ctx); return this.db.transaction(async tx => { await lockAccounting(tx, entityId); const [v] = await tx.select().from(journalVoucher).where(and(eq(journalVoucher.id, id), eq(journalVoucher.entityId, entityId))).for('update'); if (!v) throw new NotFoundException(); if (v.status !== 'draft' || v.sourceType !== 'manual') throw new ConflictException('Only manual drafts can submit'); await this.journalCheck(tx, ctx, entityId, { postingDate: v.postingDate, narration: v.narration, lines: v.draftLines }); const number = await this.gl.number(tx, ctx, entityId, v.postingDate); await tx.insert(glEntry).values(v.draftLines.map(l => ({ ...l, tenantId: ctx.tenant.tenantId, entityId, voucherId: id, postingDate: v.postingDate }))); const [after] = await tx.update(journalVoucher).set({ status: 'submitted', number, submittedAt: new Date() }).where(eq(journalVoucher.id, id)).returning(); await tx.insert((await import('@factoryos/db')).glDisposition).values({ tenantId: ctx.tenant.tenantId, entityId, sourceType: 'manual', sourceId: id, purpose: 'main', voucherId: id, reason: 'posted' }); await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'journal.submit', targetType: 'journal_voucher', targetId: id, after: { number } }, tx); return after; }); }
  @Post('journals/:id/cancel') @HttpCode(200) @RequirePermission('accounts.voucher.cancel')
  async cancelJournal(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { const entityId = entityOf(ctx), { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), body); return this.db.transaction(async tx => { await lockAccounting(tx, entityId); const [v] = await tx.select().from(journalVoucher).where(and(eq(journalVoucher.id, id), eq(journalVoucher.entityId, entityId))).for('update'); if (!v) throw new NotFoundException(); if (v.sourceType !== 'manual' || v.status !== 'submitted') throw new ConflictException('Cancel automatic vouchers from their source document'); await this.gl.reverseIn(tx, ctx, entityId, { type: 'manual', id, purpose: 'main' }, reason); return { ok: true }; }); }
}
