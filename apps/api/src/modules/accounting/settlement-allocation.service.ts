import {
  consumeCarryingValue,
  Dec,
  type AccountingLine,
} from '@factoryos/core';
import {
  settlementAllocationDocument,
  settlementAllocationEffect,
  type AllocationDraft,
} from '@factoryos/db';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { businessDate, lockAccounting, type Tx } from './accounting-lock.js';
import { BillService, type BillBalance } from './bill.service.js';
import { GlPostingService } from './gl-posting.service.js';
import {
  addSignedLine,
  SettlementService,
  type SettlementPreview,
} from './settlement.service.js';
@Injectable()
export class SettlementAllocationService {
  constructor(
    private readonly bills: BillService,
    private readonly settlements: SettlementService,
    private readonly gl: GlPostingService,
    private readonly audit: AuditService,
  ) {}
  async documentIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    id: string,
  ) {
    const [d] = await tx
      .select()
      .from(settlementAllocationDocument)
      .where(
        and(
          eq(settlementAllocationDocument.id, id),
          eq(settlementAllocationDocument.entityId, entityId),
          eq(settlementAllocationDocument.tenantId, ctx.tenant.tenantId),
        ),
      )
      .for('update');
    if (!d)
      throw new NotFoundException(
        'Allocation document not found in this entity',
      );
    return d;
  }
  async prepareIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    input: AllocationDraft,
  ) {
    const settings = await this.settlements.settingsIn(
      tx,
      ctx,
      entityId,
      input.postingDate,
    );
    const settlement = await this.settlements.documentIn(
      tx,
      ctx,
      entityId,
      input.settlementId,
    );
    if (settlement.status !== 'submitted' || !settlement.onAccountBillId)
      throw new BadRequestException(
        'Choose a submitted settlement with on-account money',
      );
    const sourceBill = await this.bills.balanceIn(
      tx,
      ctx,
      entityId,
      settlement.onAccountBillId,
    );
    let sourceOpen = Dec.of(sourceBill.openAmount).neg(),
      sourceCarrying = Dec.of(sourceBill.carryingInr).neg();
    if (
      !sourceOpen.gt('0') ||
      input.postingDate < sourceBill.recognitionDate ||
      !input.allocations.length
    )
      throw new BadRequestException(
        'Choose available on-account money, valid date and at least one bill',
      );
    const seen = new Set<string>(),
      shares: {
        bill: BillBalance;
        amount: string;
        carrying: string;
        sourceCarrying: string;
      }[] = [];
    let total = Dec.ZERO,
      carrying = Dec.ZERO,
      consumed = Dec.ZERO;
    for (const a of input.allocations) {
      if (seen.has(a.billId))
        throw new BadRequestException('Duplicate allocation bill');
      seen.add(a.billId);
      const bill = await this.bills.balanceIn(tx, ctx, entityId, a.billId);
      if (
        bill.partyId !== sourceBill.partyId ||
        bill.side !== sourceBill.side ||
        bill.currency !== sourceBill.currency ||
        bill.recognitionDate > input.postingDate ||
        bill.id === sourceBill.id
      )
        throw new BadRequestException(
          'Choose an open bill with the source party, currency, side and valid date',
        );
      let billShare: string, sourceShare: string;
      try {
        billShare = consumeCarryingValue(
          bill.openAmount,
          bill.carryingInr,
          a.amount,
        );
        sourceShare = consumeCarryingValue(
          sourceOpen.toString(),
          sourceCarrying.toString(),
          a.amount,
        );
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      sourceOpen = sourceOpen.sub(a.amount);
      sourceCarrying = sourceCarrying.sub(sourceShare);
      total = total.add(a.amount);
      carrying = carrying.add(billShare);
      consumed = consumed.add(sourceShare);
      shares.push({
        bill,
        amount: Dec.of(a.amount).toString(),
        carrying: billShare,
        sourceCarrying: sourceShare,
      });
    }
    const receipt = settlement.draft.direction === 'receipt',
      raw: AccountingLine[] = [];
    addSignedLine(
      raw,
      sourceBill.accountId,
      receipt ? consumed : consumed.neg(),
      sourceBill.partyId,
      sourceBill.reference,
    );
    for (const a of shares)
      addSignedLine(
        raw,
        a.bill.accountId,
        receipt ? Dec.of(a.carrying).neg() : Dec.of(a.carrying),
        a.bill.partyId,
        a.bill.reference,
      );
    const forex = receipt ? carrying.sub(consumed) : consumed.sub(carrying);
    addSignedLine(raw, settings.mappings.forex!, forex);
    // Reclassification within one party/control needs evidence, not artificial gross GL rows.
    const grouped = new Map<
      string,
      {
        accountId: string;
        partyId?: string;
        billReference?: string;
        amount: Dec;
      }
    >();
    for (const l of raw) {
      const key = `${l.accountId}:${l.partyId ?? ''}`;
      const row = grouped.get(key) ?? {
        accountId: l.accountId,
        ...(l.partyId && {
          partyId: l.partyId,
          billReference: 'Bill allocation',
        }),
        amount: Dec.ZERO,
      };
      row.amount = row.amount.add(l.debit).sub(l.credit);
      grouped.set(key, row);
    }
    const lines: AccountingLine[] = [];
    for (const row of grouped.values())
      addSignedLine(
        lines,
        row.accountId,
        row.amount,
        row.partyId,
        row.billReference,
      );
    const preview: SettlementPreview = {
      amount: total.toString(),
      allocated: total.toString(),
      unapplied: sourceOpen.toString(),
      cashInr: '0.000000',
      carryingInr: carrying.toString(),
      forexInr: forex.toString(),
      roundingInr: '0.000000',
      lines,
    };
    return { preview, shares, settlement, sourceBill };
  }
  async previewIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    input: AllocationDraft,
  ) {
    return (await this.prepareIn(tx, ctx, entityId, input)).preview;
  }
  async createIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    input: AllocationDraft,
  ) {
    await this.prepareIn(tx, ctx, entityId, input);
    const scope = { tenantId: ctx.tenant.tenantId, entityId };
    const [d] = await tx
      .insert(settlementAllocationDocument)
      .values({
        ...scope,
        settlementId: input.settlementId,
        draft: input,
        createdBy: ctx.user.id,
      })
      .returning();
    await this.audit.record(
      ctx,
      {
        ...scope,
        action: 'settlement_allocation.create',
        targetType: 'settlement_allocation',
        targetId: d!.id,
        after: input,
      },
      tx,
    );
    return d!;
  }
  async submitIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    id: string,
  ) {
    await lockAccounting(tx, entityId);
    const d = await this.documentIn(tx, ctx, entityId, id);
    if (d.status !== 'draft')
      throw new ConflictException('Only draft allocations can submit');
    const { preview, shares, settlement, sourceBill } = await this.prepareIn(
      tx,
      ctx,
      entityId,
      d.draft,
    );
    const number = await this.gl.number(
        tx,
        ctx,
        entityId,
        d.draft.postingDate,
        'settlement_allocation',
        'AL',
      ),
      scope = { tenantId: ctx.tenant.tenantId, entityId };
    const source = {
      type: 'settlement_allocation',
      id,
      purpose: 'main',
      number,
      currency: sourceBill.currency,
      exchangeRate: settlement.draft.exchangeRate,
      narration: d.draft.reason,
    };
    const { voucherId } = await this.gl.postIn(
      tx,
      ctx,
      entityId,
      source,
      d.draft.postingDate,
      {
        lines: preview.lines,
        disposition: preview.lines.length ? 'posted' : 'no_value_change',
      },
    );
    for (const a of shares) {
      await this.bills.recordSourceIn(tx, ctx, entityId, source, [
        {
          billId: a.bill.id,
          partyId: a.bill.partyId,
          side: a.bill.side,
          accountId: a.bill.accountId,
          reference: a.bill.reference,
          currency: a.bill.currency,
          recognitionDate: a.bill.recognitionDate,
          postingDate: d.draft.postingDate,
          dueDate: a.bill.dueDate,
          msmeCategory: a.bill.msmeCategory,
          amount: Dec.of(a.amount).neg().toString(),
          carryingInr: Dec.of(a.carrying).neg().toString(),
          originKey: `bill:${a.bill.id}`,
        },
        {
          billId: sourceBill.id,
          partyId: sourceBill.partyId,
          side: sourceBill.side,
          accountId: sourceBill.accountId,
          reference: sourceBill.reference,
          currency: sourceBill.currency,
          recognitionDate: sourceBill.recognitionDate,
          postingDate: d.draft.postingDate,
          dueDate: null,
          msmeCategory: null,
          amount: a.amount,
          carryingInr: a.sourceCarrying,
          originKey: `advance:${a.bill.id}`,
        },
      ]);
      await tx.insert(settlementAllocationEffect).values({
        ...scope,
        settlementId: settlement.id,
        allocationDocumentId: id,
        billId: a.bill.id,
        postingDate: d.draft.postingDate,
        amount: a.amount,
        carryingInr: a.carrying,
        sourceCarryingInr: a.sourceCarrying,
      });
    }
    await tx
      .update(settlementAllocationDocument)
      .set({ status: 'submitted', number, submittedAt: new Date(), voucherId })
      .where(eq(settlementAllocationDocument.id, id));
    await this.bills.assertReconciledIn(tx, ctx, entityId);
    await this.audit.record(
      ctx,
      {
        ...scope,
        action: 'settlement_allocation.submit',
        targetType: 'settlement_allocation',
        targetId: id,
        after: { number, voucherId, preview },
      },
      tx,
    );
    return { voucherId };
  }
  async cancelIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    id: string,
    reason: string,
  ) {
    await lockAccounting(tx, entityId);
    const d = await this.documentIn(tx, ctx, entityId, id);
    if (d.status !== 'submitted')
      throw new ConflictException('Only submitted allocations can cancel');
    await this.settlements.settingsIn(tx, ctx, entityId, businessDate());
    const source = { type: 'settlement_allocation', id, purpose: 'main' };
    await this.gl.reverseIn(tx, ctx, entityId, source, reason);
    await this.bills.reverseSourceIn(tx, ctx, entityId, source, businessDate());
    const effects = await tx
      .select()
      .from(settlementAllocationEffect)
      .where(
        and(
          eq(settlementAllocationEffect.entityId, entityId),
          eq(settlementAllocationEffect.allocationDocumentId, id),
        ),
      );
    for (const a of effects.filter((e) => !e.reversalOf))
      await tx.insert(settlementAllocationEffect).values({
        tenantId: ctx.tenant.tenantId,
        entityId,
        settlementId: a.settlementId,
        allocationDocumentId: id,
        billId: a.billId,
        postingDate: businessDate(),
        amount: Dec.of(a.amount).neg().toString(),
        carryingInr: Dec.of(a.carryingInr).neg().toString(),
        sourceCarryingInr: Dec.of(a.sourceCarryingInr).neg().toString(),
        reversalOf: a.id,
      });
    await tx
      .update(settlementAllocationDocument)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: reason,
      })
      .where(eq(settlementAllocationDocument.id, id));
    await this.bills.assertReconciledIn(tx, ctx, entityId);
    await this.audit.record(
      ctx,
      {
        tenantId: ctx.tenant.tenantId,
        entityId,
        action: 'settlement_allocation.cancel',
        targetType: 'settlement_allocation',
        targetId: id,
        reason,
      },
      tx,
    );
  }
}
