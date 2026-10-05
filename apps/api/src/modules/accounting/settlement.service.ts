import {SupplierCreditApplicationService} from '../supplier-returns/credit-application.service.js';
import { CreditApplicationService } from '../sales-notes/credit-application.service.js';
import { consumeCarryingValue, Dec, settlementDifference, type AccountingLine } from '@factoryos/core';
import { accountGroup, accountingSettings, glAccount, party, partySettlement, settlementAllocationDocument, tradeBill, type SettlementAllocationDraft } from '@factoryos/db';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { StockPostingService } from '../stock-posting.service.js';
import { businessDate, lockAccounting, type Db, type Tx } from './accounting-lock.js';
import { type BillBalance, BillService, type NewEffect, type TradeSide } from './bill.service.js';
import { GlPostingService } from './gl-posting.service.js';

export type Direction = 'receipt' | 'payment';
export interface SettlementInput {
  direction: Direction;
  partyId: string;
  postingDate: string;
  currency: string;
  exchangeRate: string;
  accountId: string;
  amount: string;
  bankReference?: string | null;
  narration?: string | null;
  allocations: SettlementAllocationDraft[];
}
export interface LaterAllocationInput {
  settlementId?: string;
  creditNoteId?: string;
  supplierNoteId?: string;
  postingDate: string;
  reason: string;
  allocations: SettlementAllocationDraft[];
}
export interface SettlementPreview {
  amount: string;
  allocated: string;
  unapplied: string;
  cashInr: string;
  carryingInr: string;
  /** Signed: positive = exchange loss (debit), negative = gain (credit). */
  forexInr: string;
  lines: AccountingLine[];
  allocations: (SettlementAllocationDraft & { reference: string; carryingInr: string; openAmount: string })[];
  disposition: 'posted' | 'no_value_change';
}

const sideOf = (d: Direction): TradeSide => (d === 'receipt' ? 'receivable' : 'payable');
const CASH_GROUPS = ['Cash-in-Hand', 'Bank Accounts'];

/** Customer receipts, supplier payments and later allocation of money on account (decision 036). */
@Injectable()
export class SettlementService {
  constructor(
    private readonly credits: CreditApplicationService,
    private readonly supplierCredits: SupplierCreditApplicationService,
    private readonly gl: GlPostingService,
    private readonly bills: BillService,
    private readonly posting: StockPostingService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── validation shared by preview and submit ─────────────────────────

  private async settings(tx: Db, entityId: string) {
    const [s] = await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
    if (!s?.active) throw new BadRequestException('Activate accounting for this entity first (Accounts → Setup); receipts and payments post to the books');
    return s;
  }

  private assertDate(date: string, cutover: string) {
    if (date < cutover) throw new BadRequestException({ message: `The date is before the accounting cut-over (${cutover})`, issues: [{ path: 'postingDate', message: 'Before cut-over' }] });
    if (date > businessDate()) throw new BadRequestException({ message: 'The date is in the future', issues: [{ path: 'postingDate', message: 'Use today or earlier' }] });
  }

  /** Cash and bank accounts only: an active account of this entity under Cash-in-Hand or Bank Accounts. */
  async assertCashAccount(tx: Db, ctx: TenantRequestContext, entityId: string, accountId: string) {
    const [a] = await tx.select().from(glAccount).where(and(eq(glAccount.id, accountId), eq(glAccount.entityId, entityId), eq(glAccount.tenantId, ctx.tenant.tenantId)));
    if (!a?.isActive) throw new BadRequestException({ message: 'Choose an active cash or bank account of this entity', issues: [{ path: 'accountId', message: 'Not available' }] });
    let groupId: string | null = a.groupId;
    for (let depth = 0; groupId && depth < 20; depth++) {
      const [g] = await tx.select().from(accountGroup).where(eq(accountGroup.id, groupId));
      if (!g) break;
      if (CASH_GROUPS.includes(g.name)) return a;
      groupId = g.parentId;
    }
    throw new BadRequestException({ message: `${a.name} is not a cash or bank account`, issues: [{ path: 'accountId', message: 'Use a Cash-in-Hand or Bank Accounts ledger' }] });
  }

  private async assertParty(tx: Db, ctx: TenantRequestContext, partyId: string, direction: Direction) {
    const [p] = await tx.select().from(party).where(and(eq(party.id, partyId), eq(party.tenantId, ctx.tenant.tenantId)));
    if (!p || (direction === 'receipt' ? !p.isCustomer : !p.isSupplier)) {
      throw new BadRequestException({ message: direction === 'receipt' ? 'Choose a customer' : 'Choose a supplier', issues: [{ path: 'partyId', message: 'Not allowed' }] });
    }
    return p;
  }

  /** Bills chosen for allocation: unique, this party/side/currency, open enough, recognised by the date. */
  private async allocationBills(tx: Db, entityId: string, partyId: string, side: TradeSide, currency: string, date: string, allocations: SettlementAllocationDraft[]) {
    const ids = allocations.map((a) => a.billId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A bill is chosen twice');
    const bills = await this.bills.list(tx, entityId, { billIds: ids });
    return allocations.map((a, i) => {
      const b = bills.find((x) => x.id === a.billId);
      const path = `allocations.${i}.amount`;
      if (!b || b.partyId !== partyId || b.side !== side || b.kind !== 'bill') throw new BadRequestException({ message: `Allocation ${i + 1}: not an open bill of this party`, issues: [{ path, message: 'Wrong bill' }] });
      if (b.currency !== currency) throw new BadRequestException({ message: `${b.reference} is in ${b.currency}; this document is in ${currency}`, issues: [{ path, message: 'Currency differs' }] });
      if (b.recognitionDate > date) throw new BadRequestException({ message: `${b.reference} is dated after this document`, issues: [{ path, message: 'Bill is later' }] });
      if (!Dec.of(a.amount).gt('0')) throw new BadRequestException({ message: `Allocation ${i + 1}: amount must be positive`, issues: [{ path, message: 'Must be positive' }] });
      if (Dec.of(a.amount).gt(b.openAmount)) throw new BadRequestException({ message: `${b.reference} has only ${Dec.of(b.openAmount).toFixed(2)} ${b.currency} open`, issues: [{ path, message: 'More than open' }] });
      return b;
    });
  }

  private forexLine(settings: { mappings: Record<string, string> }, diff: Dec): AccountingLine[] {
    if (diff.isZero()) return [];
    const forex = settings.mappings.forex;
    if (!forex) throw new BadRequestException('Map the foreign exchange gain/loss account first (Accounts → Setup)');
    return [diff.gt('0') ? { accountId: forex, debit: diff.toFixed(6), credit: '0' } : { accountId: forex, debit: '0', credit: diff.abs().toFixed(6) }];
  }

  // ───────────────────────── receipts and payments ─────────────────────────

  async previewIn(tx: Db, ctx: TenantRequestContext, entityId: string, input: SettlementInput, number?: string | null): Promise<SettlementPreview> {
    const settings = await this.settings(tx, entityId);
    this.assertDate(input.postingDate, settings.cutoverDate!);
    await this.assertParty(tx, ctx, input.partyId, input.direction);
    await this.assertCashAccount(tx, ctx, entityId, input.accountId);
    const rate = input.currency === 'INR' ? Dec.of('1') : Dec.of(input.exchangeRate);
    if (input.currency === 'INR' && !Dec.of(input.exchangeRate).eq('1')) throw new BadRequestException({ message: 'INR documents use an exchange rate of 1', issues: [{ path: 'exchangeRate', message: 'Must be 1' }] });
    if (!rate.gt('0')) throw new BadRequestException({ message: `Enter the exchange rate (₹ per 1 ${input.currency})`, issues: [{ path: 'exchangeRate', message: 'Required' }] });
    const amount = Dec.of(input.amount);
    if (!amount.gt('0')) throw new BadRequestException({ message: 'The amount must be positive', issues: [{ path: 'amount', message: 'Must be positive' }] });

    const side = sideOf(input.direction);
    const bills = await this.allocationBills(tx, entityId, input.partyId, side, input.currency, input.postingDate, input.allocations);
    const allocated = input.allocations.reduce((s, a) => s.add(a.amount), Dec.ZERO);
    if (allocated.gt(amount)) throw new BadRequestException({ message: `Allocations (${allocated.toFixed(2)}) exceed the amount (${amount.toFixed(2)})`, issues: [{ path: 'amount', message: 'Less than allocated' }] });
    const unapplied = amount.sub(allocated);
    const cashInr = amount.mul(rate);
    const unappliedInr = unapplied.mul(rate);
    const shares = input.allocations.map((a, i) => Dec.of(consumeCarryingValue(bills[i]!.openAmount, bills[i]!.carryingInr, a.amount)));
    const carrying = shares.reduce((s, x) => s.add(x), unappliedInr);
    const diff = Dec.of(settlementDifference(input.direction, cashInr.toString(), carrying.toString()));

    const receipt = input.direction === 'receipt';
    const dr = (accountId: string, v: Dec, extra: Partial<AccountingLine> = {}): AccountingLine => ({ accountId, debit: v.toFixed(6), credit: '0', ...extra });
    const cr = (accountId: string, v: Dec, extra: Partial<AccountingLine> = {}): AccountingLine => ({ accountId, debit: '0', credit: v.toFixed(6), ...extra });
    const trade = (accountId: string, v: Dec, billReference: string) => (receipt ? cr : dr)(accountId, v, { partyId: input.partyId, billReference });
    const lines: AccountingLine[] = [(receipt ? dr : cr)(input.accountId, cashInr)];
    bills.forEach((b, i) => {
      if (shares[i]!.gt('0')) lines.push(trade(b.accountId, shares[i]!, b.reference));
    });
    if (unappliedInr.gt('0')) lines.push(trade(await this.bills.currentControl(tx, entityId, side), unappliedInr, `On account ${number ?? 'draft'}`));
    lines.push(...this.forexLine(settings, diff));
    return {
      amount: amount.toFixed(2),
      allocated: allocated.toFixed(2),
      unapplied: unapplied.toFixed(2),
      cashInr: cashInr.toFixed(6),
      carryingInr: carrying.toFixed(6),
      forexInr: diff.toFixed(6),
      lines,
      allocations: input.allocations.map((a, i) => ({ ...a, reference: bills[i]!.reference, openAmount: bills[i]!.openAmount, carryingInr: shares[i]!.toFixed(6) })),
      disposition: 'posted',
    };
  }

  async submitIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string) {
    await lockAccounting(tx, entityId);
    const [s] = await tx.select().from(partySettlement).where(and(eq(partySettlement.id, id), eq(partySettlement.entityId, entityId))).for('update');
    if (!s) throw new NotFoundException('Receipt or payment not found');
    if (s.status !== 'draft') throw new ConflictException('Only drafts can be submitted');
    await this.settings(tx, entityId);
    await this.bills.syncIn(tx, ctx, entityId);
    await this.bills.assertReconciledIn(tx, entityId);
    const input = this.inputOf(s);
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, s.direction === 'receipt' ? 'customer_receipt' : 'supplier_payment', s.postingDate);
    const p = await this.previewIn(tx, ctx, entityId, input, number);
    const { voucherId } = await this.gl.postIn(
      tx,
      ctx,
      entityId,
      { type: 'settlement', id, purpose: 'main', number, currency: s.currency, exchangeRate: s.exchangeRate, narration: `${s.direction === 'receipt' ? 'Receipt' : 'Payment'} ${number}${s.narration ? `: ${s.narration}` : ''}` },
      s.postingDate,
      { lines: p.lines, disposition: 'posted' },
    );

    const effects: NewEffect[] = p.allocations.map((a, i) => ({
      billId: a.billId,
      sourceType: 'settlement',
      sourceId: id,
      originKey: `settlement:${id}:${i}`,
      postingDate: s.postingDate,
      amount: Dec.of(a.amount).neg().toString(),
      carryingInr: Dec.of(a.carryingInr).neg().toString(),
    }));
    let advanceBillId: string | null = null;
    const unapplied = Dec.of(p.unapplied);
    if (unapplied.gt('0')) {
      const side = sideOf(s.direction as Direction);
      const [adv] = await tx
        .insert(tradeBill)
        .values({
          tenantId: ctx.tenant.tenantId,
          entityId,
          side,
          kind: 'advance',
          partyId: s.partyId,
          accountId: await this.bills.currentControl(tx, entityId, side),
          reference: `On account ${number}`,
          sourceType: 'settlement',
          sourceId: id,
          originKey: `settlement:${id}:advance`,
          currency: s.currency,
          originalAmount: unapplied.toString(),
          recognitionDate: s.postingDate,
        })
        .returning();
      advanceBillId = adv!.id;
      const unappliedInr = unapplied.mul(s.currency === 'INR' ? '1' : s.exchangeRate);
      effects.push({ billId: adv!.id, sourceType: 'settlement', sourceId: id, originKey: `settlement:${id}:advance`, postingDate: s.postingDate, amount: unapplied.neg().toString(), carryingInr: unappliedInr.neg().toString() });
    }
    await this.bills.addEffects(tx, ctx, entityId, effects);
    const [after] = await tx
      .update(partySettlement)
      .set({ status: 'submitted', number, voucherId, advanceBillId, submittedBy: ctx.user.id, submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(partySettlement.id, id))
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: `${s.direction}.submit`, targetType: 'party_settlement', targetId: id, after: { number, voucherId, amount: p.amount, unapplied: p.unapplied, forexInr: p.forexInr } }, tx);
    return after!;
  }

  async cancelIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, reason: string) {
    await lockAccounting(tx, entityId);
    const [s] = await tx.select().from(partySettlement).where(and(eq(partySettlement.id, id), eq(partySettlement.entityId, entityId))).for('update');
    if (!s) throw new NotFoundException('Receipt or payment not found');
    if (s.status !== 'submitted') throw new ConflictException('Only submitted documents can be cancelled');
    const later = await tx.select({ number: settlementAllocationDocument.number }).from(settlementAllocationDocument).where(and(eq(settlementAllocationDocument.settlementId, id), eq(settlementAllocationDocument.status, 'submitted')));
    if (later.length) throw new ConflictException(`Its on-account money was applied by ${later.map((l) => l.number).join(', ')}. Cancel those allocations first.`);
    await this.gl.reverseIn(tx, ctx, entityId, { type: 'settlement', id, purpose: 'main' }, reason);
    await this.bills.reverseSourceEffects(tx, ctx, entityId, 'settlement', id, businessDate());
    await tx.update(partySettlement).set({ status: 'cancelled', cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() }).where(eq(partySettlement.id, id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: `${s.direction}.cancel`, targetType: 'party_settlement', targetId: id, reason }, tx);
  }

  inputOf(s: typeof partySettlement.$inferSelect): SettlementInput {
    return {
      direction: s.direction as Direction,
      partyId: s.partyId,
      postingDate: s.postingDate,
      currency: s.currency,
      exchangeRate: s.exchangeRate,
      accountId: s.accountId,
      amount: s.amount,
      bankReference: s.bankReference,
      narration: s.narration,
      allocations: s.allocations,
    };
  }

  // ───────────────────────── later allocation of money on account ─────────────────────────

  async allocationPreviewIn(tx: Db, ctx: TenantRequestContext, entityId: string, input: LaterAllocationInput): Promise<SettlementPreview & { advance: BillBalance }> {
    if(input.supplierNoteId)return this.supplierCredits.previewIn(tx,ctx,entityId,{supplierNoteId:input.supplierNoteId,postingDate:input.postingDate,allocations:input.allocations});
    if(input.creditNoteId)return this.credits.previewIn(tx,ctx,entityId,{creditNoteId:input.creditNoteId,postingDate:input.postingDate,allocations:input.allocations});
    if(!input.settlementId)throw new BadRequestException('Choose one allocation source');
    const settings = await this.settings(tx, entityId);
    this.assertDate(input.postingDate, settings.cutoverDate!);
    const [s] = await tx.select().from(partySettlement).where(and(eq(partySettlement.id, input.settlementId), eq(partySettlement.entityId, entityId)));
    if (!s || s.status !== 'submitted') throw new BadRequestException('Choose a submitted receipt or payment');
    if (!s.advanceBillId) throw new BadRequestException(`${s.number} has no money on account`);
    if (input.postingDate < s.postingDate) throw new BadRequestException({ message: `The allocation can't be dated before ${s.number}`, issues: [{ path: 'postingDate', message: 'Before the receipt/payment' }] });
    const [advance] = await this.bills.list(tx, entityId, { billIds: [s.advanceBillId] });
    const direction = s.direction as Direction;
    const side = sideOf(direction);
    if (!input.allocations.length) throw new BadRequestException('Choose at least one bill');
    const bills = await this.allocationBills(tx, entityId, s.partyId, side, s.currency, input.postingDate, input.allocations);
    const total = input.allocations.reduce((x, a) => x.add(a.amount), Dec.ZERO);
    if (total.gt(advance!.openAmount)) throw new BadRequestException({ message: `Only ${Dec.of(advance!.openAmount).toFixed(2)} ${s.currency} is on account`, issues: [{ path: 'allocations', message: 'More than available' }] });

    // Consume the advance and each bill at their own carrying values; the difference is exchange.
    let advOpen = Dec.of(advance!.openAmount);
    let advCarry = Dec.of(advance!.carryingInr);
    const lines: AccountingLine[] = [];
    const out: SettlementPreview['allocations'] = [];
    const advShares: Dec[] = [];
    let diffTotal = Dec.ZERO;
    let billTotal = Dec.ZERO;
    let advTotal = Dec.ZERO;
    input.allocations.forEach((a, i) => {
      const b = bills[i]!;
      const billShare = Dec.of(consumeCarryingValue(b.openAmount, b.carryingInr, a.amount));
      const advShare = Dec.of(consumeCarryingValue(advOpen.toString(), advCarry.toString(), a.amount));
      advOpen = advOpen.sub(a.amount);
      advCarry = advCarry.sub(advShare);
      advShares.push(advShare);
      billTotal = billTotal.add(billShare);
      advTotal = advTotal.add(advShare);
      diffTotal = diffTotal.add(settlementDifference(direction, advShare.toString(), billShare.toString()));
      const advLine = { accountId: advance!.accountId, partyId: s.partyId, billReference: advance!.reference };
      const billLine = { accountId: b.accountId, partyId: s.partyId, billReference: b.reference };
      if (direction === 'receipt') lines.push({ ...advLine, debit: advShare.toFixed(6), credit: '0' }, { ...billLine, debit: '0', credit: billShare.toFixed(6) });
      else lines.push({ ...advLine, debit: '0', credit: advShare.toFixed(6) }, { ...billLine, debit: billShare.toFixed(6), credit: '0' });
      out.push({ ...a, reference: b.reference, openAmount: b.openAmount, carryingInr: billShare.toFixed(6) });
    });
    lines.push(...this.forexLine(settings, diffTotal));
    // A same-account, same-value reclassification moves nothing in the books: record evidence, not a journal.
    const net = new Map<string, Dec>();
    for (const l of lines) net.set(l.accountId, (net.get(l.accountId) ?? Dec.ZERO).add(l.debit).sub(l.credit));
    const noValue = [...net.values()].every((v) => v.isZero());
    return {
      amount: total.toFixed(2),
      allocated: total.toFixed(2),
      unapplied: advOpen.toFixed(2),
      cashInr: advTotal.toFixed(6),
      carryingInr: billTotal.toFixed(6),
      forexInr: diffTotal.toFixed(6),
      lines: noValue ? [] : lines.filter((l) => !(Dec.of(l.debit).isZero() && Dec.of(l.credit).isZero())),
      allocations: out.map((o, i) => ({ ...o, advanceInr: advShares[i]!.toFixed(6) })),
      disposition: noValue ? 'no_value_change' : 'posted',
      advance: advance!,
    };
  }

  async allocationSubmitIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string) {
    await lockAccounting(tx, entityId);
    const [d] = await tx.select().from(settlementAllocationDocument).where(and(eq(settlementAllocationDocument.id, id), eq(settlementAllocationDocument.entityId, entityId))).for('update');
    if (!d) throw new NotFoundException('Allocation not found');
    if (d.status !== 'draft') throw new ConflictException('Only drafts can be submitted');
    await this.bills.syncIn(tx, ctx, entityId);
    await this.bills.assertReconciledIn(tx, entityId);
    if(d.supplierNoteId){
      const number=await this.posting.allocateNumber(tx,ctx.tenant.tenantId,entityId,'settlement_allocation',d.postingDate);
      const {voucherId}=await this.supplierCredits.applyIn(tx,ctx,entityId,{supplierNoteId:d.supplierNoteId,postingDate:d.postingDate,allocations:d.allocations,sourceId:id,automatic:false});
      const [after]=await tx.update(settlementAllocationDocument).set({status:'submitted',number,voucherId,submittedBy:ctx.user.id,submittedAt:new Date(),updatedAt:new Date()}).where(eq(settlementAllocationDocument.id,id)).returning();
      await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'settlement_allocation.submit',targetType:'settlement_allocation_document',targetId:id,after:{number,supplierNoteId:d.supplierNoteId}},tx);
      await this.bills.assertReconciledIn(tx,entityId);return after!;
    }
    if(d.creditNoteId){
      const number=await this.posting.allocateNumber(tx,ctx.tenant.tenantId,entityId,'settlement_allocation',d.postingDate);
      const {voucherId}=await this.credits.applyIn(tx,ctx,entityId,{creditNoteId:d.creditNoteId,postingDate:d.postingDate,allocations:d.allocations,sourceId:id,automatic:false});
      const [after]=await tx.update(settlementAllocationDocument).set({status:'submitted',number,voucherId,submittedBy:ctx.user.id,submittedAt:new Date(),updatedAt:new Date()}).where(eq(settlementAllocationDocument.id,id)).returning();
      await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'settlement_allocation.submit',targetType:'settlement_allocation_document',targetId:id,after:{number,creditNoteId:d.creditNoteId}},tx);
      await this.bills.assertReconciledIn(tx,entityId);return after!;
    }
    if (!d.settlementId) throw new BadRequestException('Choose an allocation source');
    const p = await this.allocationPreviewIn(tx, ctx, entityId, { settlementId: d.settlementId, postingDate: d.postingDate, reason: d.reason, allocations: d.allocations });
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'settlement_allocation', d.postingDate);
    const { voucherId } = await this.gl.postIn(tx, ctx, entityId, { type: 'settlement_allocation', id, purpose: 'main', number, narration: `Allocation ${number}: ${d.reason}` }, d.postingDate, { lines: p.lines, disposition: p.disposition });
    const effects: NewEffect[] = p.allocations.flatMap((a, i) => [
      { billId: p.advance.id, sourceType: 'settlement_allocation', sourceId: id, originKey: `allocation:${id}:${i}:advance`, postingDate: d.postingDate, amount: Dec.of(a.amount).toString(), carryingInr: (a as typeof a & { advanceInr: string }).advanceInr },
      { billId: a.billId, sourceType: 'settlement_allocation', sourceId: id, originKey: `allocation:${id}:${i}:bill`, postingDate: d.postingDate, amount: Dec.of(a.amount).neg().toString(), carryingInr: Dec.of(a.carryingInr).neg().toString() },
    ]);
    await this.bills.addEffects(tx, ctx, entityId, effects);
    const [after] = await tx
      .update(settlementAllocationDocument)
      .set({ status: 'submitted', number, voucherId, submittedBy: ctx.user.id, submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(settlementAllocationDocument.id, id))
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'settlement_allocation.submit', targetType: 'settlement_allocation_document', targetId: id, after: { number, voucherId, forexInr: p.forexInr, disposition: p.disposition } }, tx);
    return after!;
  }

  async allocationCancelIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, reason: string) {
    await lockAccounting(tx, entityId);
    const [d] = await tx.select().from(settlementAllocationDocument).where(and(eq(settlementAllocationDocument.id, id), eq(settlementAllocationDocument.entityId, entityId))).for('update');
    if (!d) throw new NotFoundException('Allocation not found');
    if (d.status !== 'submitted') throw new ConflictException('Only submitted allocations can be cancelled');
    if(d.supplierNoteId)await this.supplierCredits.reverseIn(tx,ctx,entityId,id,reason);
    else if(d.creditNoteId)await this.credits.reverseIn(tx,ctx,entityId,id,reason);
    else await this.gl.reverseIn(tx, ctx, entityId, { type: 'settlement_allocation', id, purpose: 'main' }, reason);
    await this.bills.reverseSourceEffects(tx, ctx, entityId, 'settlement_allocation', id, businessDate());
    await tx.update(settlementAllocationDocument).set({ status: 'cancelled', cancelledBy: ctx.user.id, cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() }).where(eq(settlementAllocationDocument.id, id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'settlement_allocation.cancel', targetType: 'settlement_allocation_document', targetId: id, reason }, tx);
  }
}
