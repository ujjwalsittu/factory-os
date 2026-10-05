import { consumeCarryingValue, Dec, type AccountingLine } from '@factoryos/core';
import { accountGroup, accountingSettings, glAccount, party, partySettlement, settlementAllocationDocument, settlementAllocationEffect, tradeBill, type SettlementDraft } from '@factoryos/db';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { businessDate, lockAccounting, type Tx } from './accounting-lock.js';
import { BillService, type BillBalance, type TradeSide } from './bill.service.js';
import { BillInitializationService } from './bill-initialization.service.js';
import { GlPostingService } from './gl-posting.service.js';
export type SettlementInput = SettlementDraft;
export interface SettlementPreview { amount: string; allocated: string; unapplied: string; cashInr: string; carryingInr: string; forexInr: string; roundingInr: string; lines: AccountingLine[] }
export function addSignedLine(lines: AccountingLine[], accountId: string, signedDebit: Dec, partyId?: string, billReference?: string) {
  if (signedDebit.isZero()) return;
  lines.push({ accountId, debit: signedDebit.gt('0') ? signedDebit.toString() : '0', credit: signedDebit.lt('0') ? signedDebit.neg().toString() : '0', ...(partyId && { partyId }), ...(billReference && { billReference }) });
}
@Injectable()
export class SettlementService {
  constructor(private readonly bills: BillService, private readonly initialization: BillInitializationService, private readonly gl: GlPostingService, private readonly audit: AuditService) {}
  async settingsIn(tx: Tx, ctx: TenantRequestContext, entityId: string, date: string) {
    await lockAccounting(tx, entityId);
    const [s] = await tx.select().from(accountingSettings).where(and(eq(accountingSettings.tenantId, ctx.tenant.tenantId), eq(accountingSettings.entityId, entityId)));
    if (!s?.active) throw new ConflictException('Activate accounting before recording settlements');
    if (date < s.cutoverDate! || date > businessDate()) throw new BadRequestException('Date must be within the active accounting period, not in the future');
    await this.initialization.ensureIn(tx, ctx, entityId);
    if (!s.mappings.forex || !s.mappings.rounding) throw new BadRequestException('Configure FX and rounding accounts');
    return s;
  }
  async documentIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string) {
    const [d] = await tx.select().from(partySettlement).where(and(eq(partySettlement.id, id), eq(partySettlement.entityId, entityId), eq(partySettlement.tenantId, ctx.tenant.tenantId))).for('update');
    if (!d) throw new NotFoundException('Settlement not found in this entity');
    return d;
  }
  async prepareIn(tx: Tx, ctx: TenantRequestContext, entityId: string, input: SettlementInput) {
    const s = await this.settingsIn(tx, ctx, entityId, input.postingDate), side: TradeSide = input.direction === 'receipt' ? 'receivable' : 'payable';
    const [p] = await tx.select().from(party).where(and(eq(party.id, input.partyId), eq(party.tenantId, ctx.tenant.tenantId), eq(party.isActive, true)));
    if (!p || (side === 'receivable' ? !p.isCustomer : !p.isSupplier)) throw new BadRequestException('Choose an active matching customer or supplier');
    const amount = Dec.of(input.amount), rate = Dec.of(input.exchangeRate);
    if (!amount.gt('0') || !rate.gt('0') || (input.currency === 'INR' && !rate.eq('1'))) throw new BadRequestException('Positive amount/rate required; INR rate must be 1');
    const [account] = await tx.select().from(glAccount).where(and(eq(glAccount.id, input.accountId), eq(glAccount.entityId, entityId), eq(glAccount.tenantId, ctx.tenant.tenantId), eq(glAccount.isActive, true)));
    const groups = await tx.select().from(accountGroup).where(and(eq(accountGroup.entityId, entityId), eq(accountGroup.tenantId, ctx.tenant.tenantId)));
    let group = groups.find(g => g.id === account?.groupId), cashBank = false;
    const visited = new Set<string>();
    while (group && !visited.has(group.id)) {
      visited.add(group.id);
      if (['Cash-in-Hand:asset', 'Bank Accounts:asset'].includes(group.key)) cashBank = true;
      group = groups.find(g => g.id === group!.parentId);
    }
    const excluded = Object.entries(s.mappings).some(([role, id]) => id === account?.id && !['cash', 'bank'].includes(role)) || !!(account?.role && !['cash', 'bank'].includes(account.role)) || (await this.bills.controlAccountsIn(tx, ctx, entityId)).has(input.accountId);
    if (!account || !cashBank || excluded) throw new BadRequestException('Choose an active cash/bank account in this entity');
    const seen = new Set<string>(), shares: { bill: BillBalance; amount: string; carrying: string }[] = [];
    let allocated = Dec.ZERO, carrying = Dec.ZERO;
    for (const a of input.allocations) {
      if (seen.has(a.billId)) throw new BadRequestException('Duplicate bill allocation');
      seen.add(a.billId);
      const bill = await this.bills.balanceIn(tx, ctx, entityId, a.billId);
      if (bill.partyId !== input.partyId || bill.side !== side || bill.currency !== input.currency || bill.recognitionDate > input.postingDate)
        throw new BadRequestException('Allocation needs a matching party, currency, side and recognition date');
      let share: string;
      try { share = consumeCarryingValue(bill.openAmount, bill.carryingInr, a.amount); } catch (e) { throw new BadRequestException((e as Error).message); }
      allocated = allocated.add(a.amount); carrying = carrying.add(share); shares.push({ bill, amount: Dec.of(a.amount).toString(), carrying: share });
    }
    if (allocated.gt(amount)) throw new BadRequestException('Allocated amount exceeds the settlement amount');
    const unapplied = amount.sub(allocated), advanceCarrying = unapplied.mul(rate), cash = amount.mul(rate), realized = allocated.mul(rate).sub(carrying);
    if (cash.gt('999999999999999999.999999')) throw new BadRequestException('Converted cash/bank amount exceeds supported accounting precision');
    const forex = input.direction === 'receipt' ? realized.neg() : realized, lines: AccountingLine[] = [];
    addSignedLine(lines, input.accountId, input.direction === 'receipt' ? cash : cash.neg());
    for (const share of shares) addSignedLine(lines, share.bill.accountId, input.direction === 'receipt' ? Dec.of(share.carrying).neg() : Dec.of(share.carrying), input.partyId, share.bill.reference);
    const control = s.mappings[side === 'receivable' ? 'debtors' : 'creditors'];
    if (!control) throw new BadRequestException('Configure the trade control account');
    addSignedLine(lines, control, input.direction === 'receipt' ? advanceCarrying.neg() : advanceCarrying, input.partyId, 'On account');
    addSignedLine(lines, s.mappings.forex!, forex);
    const residual = lines.reduce((sum, l) => sum.add(l.debit).sub(l.credit), Dec.ZERO).neg();
    addSignedLine(lines, s.mappings.rounding!, residual);
    const preview: SettlementPreview = { amount: amount.toString(), allocated: allocated.toString(), unapplied: unapplied.toString(), cashInr: cash.toString(), carryingInr: carrying.toString(), forexInr: forex.toString(), roundingInr: residual.toString(), lines };
    return { preview, shares, side, control, advanceCarrying };
  }
  async previewIn(tx: Tx, ctx: TenantRequestContext, entityId: string, input: SettlementInput) { return (await this.prepareIn(tx, ctx, entityId, input)).preview; }
  async saveIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string | null, input: SettlementInput) {
    await lockAccounting(tx, entityId);
    if (id && (await this.documentIn(tx, ctx, entityId, id)).status !== 'draft') throw new ConflictException('Only draft settlements can be edited');
    await this.prepareIn(tx, ctx, entityId, input);
    const scope = { tenantId: ctx.tenant.tenantId, entityId };
    const [d] = id ? await tx.update(partySettlement).set({ draft: input }).where(and(eq(partySettlement.id, id), eq(partySettlement.entityId, entityId))).returning() : await tx.insert(partySettlement).values({ ...scope, draft: input, createdBy: ctx.user.id }).returning();
    await this.audit.record(ctx, { ...scope, action: id ? 'settlement.update' : 'settlement.create', targetType: 'party_settlement', targetId: d!.id, after: input }, tx);
    return d!;
  }
  async submitIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string) {
    await lockAccounting(tx, entityId);
    const d = await this.documentIn(tx, ctx, entityId, id);
    if (d.status !== 'draft') throw new ConflictException('Only draft settlements can submit');
    const input = d.draft, prepared = await this.prepareIn(tx, ctx, entityId, input), { preview, shares, side, control, advanceCarrying } = prepared;
    const number = await this.gl.number(tx, ctx, entityId, input.postingDate, input.direction === 'receipt' ? 'customer_receipt' : 'supplier_payment', input.direction === 'receipt' ? 'RC' : 'PM');
    const source = { type: 'settlement', id, purpose: 'main', number, currency: input.currency, exchangeRate: input.exchangeRate, narration: input.narration };
    const { voucherId } = await this.gl.postIn(tx, ctx, entityId, source, input.postingDate, { lines: preview.lines, disposition: preview.lines.length ? 'posted' : 'no_value_change' });
    const scope = { tenantId: ctx.tenant.tenantId, entityId };
    for (const share of shares) {
      await this.bills.recordSourceIn(tx, ctx, entityId, source, [{ billId: share.bill.id, partyId: input.partyId, side, accountId: share.bill.accountId, reference: share.bill.reference, currency: input.currency, recognitionDate: share.bill.recognitionDate, postingDate: input.postingDate, dueDate: share.bill.dueDate, msmeCategory: share.bill.msmeCategory, amount: Dec.of(share.amount).neg().toString(), carryingInr: Dec.of(share.carrying).neg().toString(), originKey: `bill:${share.bill.id}` }]);
      await tx.insert(settlementAllocationEffect).values({ ...scope, settlementId: id, billId: share.bill.id, amount: share.amount, carryingInr: share.carrying, sourceCarryingInr: Dec.of(share.amount).mul(input.exchangeRate).toString(), postingDate: input.postingDate });
    }
    let onAccountBillId: string | null = null;
    if (Dec.of(preview.unapplied).gt('0')) {
      await this.bills.recordSourceIn(tx, ctx, entityId, source, [{ partyId: input.partyId, side, accountId: control, reference: `${number}: On account`, currency: input.currency, recognitionDate: input.postingDate, postingDate: input.postingDate, dueDate: null, msmeCategory: null, amount: Dec.of(preview.unapplied).neg().toString(), carryingInr: advanceCarrying.neg().toString(), originKey: 'on_account' }]);
      const [b] = await tx.select().from(tradeBill).where(and(eq(tradeBill.entityId, entityId), eq(tradeBill.sourceType, 'settlement'), eq(tradeBill.sourceId, id), eq(tradeBill.originKey, 'on_account')));
      onAccountBillId = b!.id;
    }
    await tx.update(partySettlement).set({ status: 'submitted', number, submittedAt: new Date(), voucherId, onAccountBillId }).where(eq(partySettlement.id, id));
    await this.bills.assertReconciledIn(tx, ctx, entityId);
    await this.audit.record(ctx, { ...scope, action: 'settlement.submit', targetType: 'party_settlement', targetId: id, after: { number, voucherId, preview } }, tx);
    return { voucherId };
  }
  async cancelIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, reason: string) {
    await lockAccounting(tx, entityId);
    const d = await this.documentIn(tx, ctx, entityId, id);
    if (d.status !== 'submitted') throw new ConflictException('Only submitted settlements can cancel');
    await this.settingsIn(tx, ctx, entityId, businessDate());
    const dependencies = await tx.select().from(settlementAllocationDocument).where(and(eq(settlementAllocationDocument.entityId, entityId), eq(settlementAllocationDocument.settlementId, id), eq(settlementAllocationDocument.status, 'submitted')));
    if (dependencies.length) throw new ConflictException({ message: 'Reverse later allocations before cancelling the settlement', dependencies: dependencies.map(a => ({ id: a.id, number: a.number })) });
    await this.gl.reverseIn(tx, ctx, entityId, { type: 'settlement', id, purpose: 'main' }, reason);
    await this.bills.reverseSourceIn(tx, ctx, entityId, { type: 'settlement', id, purpose: 'main' }, businessDate());
    const allocations = await tx.select().from(settlementAllocationEffect).where(and(eq(settlementAllocationEffect.entityId, entityId), eq(settlementAllocationEffect.settlementId, id)));
    for (const a of allocations.filter(a => !a.reversalOf && !a.allocationDocumentId)) await tx.insert(settlementAllocationEffect).values({ tenantId: ctx.tenant.tenantId, entityId, settlementId: id, billId: a.billId, postingDate: businessDate(), amount: Dec.of(a.amount).neg().toString(), carryingInr: Dec.of(a.carryingInr).neg().toString(), sourceCarryingInr: Dec.of(a.sourceCarryingInr).neg().toString(), reversalOf: a.id });
    await tx.update(partySettlement).set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason }).where(eq(partySettlement.id, id));
    await this.bills.assertReconciledIn(tx, ctx, entityId);
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'settlement.cancel', targetType: 'party_settlement', targetId: id, reason }, tx);
  }
}
