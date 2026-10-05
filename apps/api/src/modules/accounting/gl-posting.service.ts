import {
  assertBalanced,
  Dec,
  formatSeries,
  fyCode,
  reverseLines,
  type AccountingLine,
  type PostingPlan,
} from '@factoryos/core';
import {
  glAccount as account,
  accountingSettings,
  glDisposition,
  glEntry,
  gstRegistration,
  journalVoucher,
  legalEntity,
  numberSeries,
  party,
} from '@factoryos/db';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { businessDate, lockAccounting, type Tx } from './accounting-lock.js';
import { BillService } from './bill.service.js';
export interface SourceRef {
  type: string;
  id: string;
  purpose: string;
  number?: string | null;
  currency?: string;
  exchangeRate?: string;
  narration?: string;
}
@Injectable()
export class GlPostingService {
  constructor(
    private readonly audit: AuditService,
    private readonly bills: BillService,
  ) {}
  async active(tx: Tx, entityId: string) {
    const [s] = await tx
      .select()
      .from(accountingSettings)
      .where(eq(accountingSettings.entityId, entityId));
    return s?.active ? s : null;
  }
  async validateLines(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    lines: AccountingLine[],
    manual = false,
  ) {
    try {
      assertBalanced(lines);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const accounts = await tx
      .select()
      .from(account)
      .where(
        and(
          eq(account.tenantId, ctx.tenant.tenantId),
          eq(account.entityId, entityId),
          inArray(
            account.id,
            lines.map((l) => l.accountId),
          ),
        ),
      );
    for (const l of lines) {
      const a = accounts.find((a) => a.id === l.accountId);
      if (!a?.isActive)
        throw new BadRequestException(
          'Choose an active account belonging to this entity',
        );
      const [settings] = await tx
        .select()
        .from(accountingSettings)
        .where(eq(accountingSettings.entityId, entityId));
      const roles = [
        ...Object.entries(settings?.mappings ?? {})
          .filter(([, id]) => id === a.id)
          .map(([role]) => role),
        ...Object.entries(settings?.controlHistory ?? {})
          .filter(([, ids]) => ids.includes(a.id))
          .map(([role]) => role),
        ...(a.role ? [a.role] : []),
      ];
      if (manual && roles.some((r) => r === 'inventory' || r === 'grni'))
        throw new BadRequestException(
          'Inventory and GRNI are corrected through operational documents',
        );
      if (
        roles.some((r) => r === 'debtors' || r === 'creditors') &&
        (!l.partyId || !l.billReference)
      )
        throw new BadRequestException(
          'Party and bill or on-account reference are required on trade controls',
        );
      if (l.partyId) {
        const [p] = await tx
          .select()
          .from(party)
          .where(
            and(
              eq(party.id, l.partyId),
              eq(party.tenantId, ctx.tenant.tenantId),
            ),
          );
        if (!p)
          throw new BadRequestException('Party belongs to another tenant');
      }
      if (l.gstRegistrationId) {
        const [g] = await tx
          .select()
          .from(gstRegistration)
          .where(
            and(
              eq(gstRegistration.id, l.gstRegistrationId),
              eq(gstRegistration.entityId, entityId),
            ),
          );
        if (!g)
          throw new BadRequestException(
            'GST registration belongs to another entity',
          );
      }
    }
  }
  async number(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    date: string,
  ) {
    const fy = fyCode(new Date(`${date}T00:00:00Z`)),
      docType = 'journal_voucher';
    await tx
      .insert(numberSeries)
      .values({
        tenantId: ctx.tenant.tenantId,
        entityId,
        docType,
        fy,
        pattern: '{ENTITY}/JV/{FY}/{#####}',
      })
      .onConflictDoNothing();
    const [n] = await tx
      .select()
      .from(numberSeries)
      .where(
        and(
          eq(numberSeries.entityId, entityId),
          eq(numberSeries.docType, docType),
          eq(numberSeries.fy, fy),
        ),
      )
      .for('update');
    const [e] = await tx
      .select()
      .from(legalEntity)
      .where(eq(legalEntity.id, entityId));
    await tx
      .update(numberSeries)
      .set({ nextValue: n!.nextValue + 1 })
      .where(eq(numberSeries.id, n!.id));
    return formatSeries(n!.pattern, {
      entityCode: e!.code,
      fy,
      counter: n!.nextValue,
    });
  }
  async postIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    source: SourceRef,
    postingDate: string,
    plan: PostingPlan,
  ) {
    await lockAccounting(tx, entityId);
    const settings = await this.active(tx, entityId);
    if (!settings && source.type !== 'opening') return { voucherId: null };
    if (settings && postingDate < settings.cutoverDate!)
      throw new ConflictException('Posting date is before accounting cut-over');
    const match = and(
      eq(glDisposition.entityId, entityId),
      eq(glDisposition.sourceType, source.type),
      eq(glDisposition.sourceId, source.id),
      eq(glDisposition.purpose, source.purpose),
    );
    const [prior] = await tx.select().from(glDisposition).where(match);
    if (prior)
      throw new ConflictException('This source has already been accounted for');
    let voucherId: string | null = null;
    if (plan.disposition === 'posted') {
      await this.validateLines(tx, ctx, entityId, plan.lines);
      const number = await this.number(tx, ctx, entityId, postingDate);
      const [v] = await tx
        .insert(journalVoucher)
        .values({
          tenantId: ctx.tenant.tenantId,
          entityId,
          number,
          status: 'submitted',
          postingDate,
          narration:
            source.narration ?? `${source.type} ${source.number ?? source.id}`,
          sourceType: source.type,
          sourceId: source.id,
          sourceNumber: source.number,
          purpose: source.purpose,
          currency: source.currency ?? 'INR',
          exchangeRate: source.exchangeRate ?? '1',
          createdBy: ctx.user.id,
          submittedAt: new Date(),
        })
        .returning();
      voucherId = v!.id;
      await tx.insert(glEntry).values(
        plan.lines.map((l) => ({
          ...l,
          debit: Dec.of(l.debit).toString(),
          credit: Dec.of(l.credit).toString(),
          tenantId: ctx.tenant.tenantId,
          entityId,
          voucherId: v!.id,
          postingDate,
        })),
      );
    } else if (plan.lines.length)
      throw new BadRequestException(
        'Zero-value disposition cannot contain journal lines',
      );
    await tx.insert(glDisposition).values({
      tenantId: ctx.tenant.tenantId,
      entityId,
      sourceType: source.type,
      sourceId: source.id,
      purpose: source.purpose,
      voucherId,
      reason: plan.disposition,
    });
    await this.audit.record(
      ctx,
      {
        tenantId: ctx.tenant.tenantId,
        entityId,
        action: 'accounting.post',
        targetType: source.type,
        targetId: source.id,
        after: { voucherId, disposition: plan.disposition },
      },
      tx,
    );
    return { voucherId };
  }
  async reverseIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    source: SourceRef,
    reason: string,
  ) {
    await lockAccounting(tx, entityId);
    if (!(await this.active(tx, entityId))) return;
    // Bills this source created must not still be settled by receipts, payments or adjustments (decision 036).
    await this.bills.syncIn(tx, ctx, entityId);
    await this.bills.assertSourceCancellableIn(tx, entityId, source.type, source.id);
    const [d] = await tx
      .select()
      .from(glDisposition)
      .where(
        and(
          eq(glDisposition.entityId, entityId),
          eq(glDisposition.sourceType, source.type),
          eq(glDisposition.sourceId, source.id),
          eq(glDisposition.purpose, source.purpose),
        ),
      );
    if (!d)
      throw new ConflictException(
        'This document predates accounting activation; use a reviewed current-date adjustment',
      );
    const [clearing] = await tx
      .select()
      .from(journalVoucher)
      .where(
        and(
          eq(journalVoucher.entityId, entityId),
          eq(journalVoucher.clearingSourceId, source.id),
          eq(journalVoucher.status, 'submitted'),
        ),
      )
      .limit(1);
    if (clearing)
      throw new ConflictException(
        'Reverse the linked clearing journal before cancelling its source',
      );
    const [reversed] = await tx
      .select()
      .from(glDisposition)
      .where(
        and(
          eq(glDisposition.entityId, entityId),
          eq(glDisposition.sourceType, source.type),
          eq(glDisposition.sourceId, source.id),
          eq(glDisposition.purpose, `${source.purpose}:reversal`),
        ),
      );
    if (reversed)
      throw new ConflictException('Accounting reversal already exists');
    if (!d.voucherId) {
      await tx.insert(glDisposition).values({
        tenantId: ctx.tenant.tenantId,
        entityId,
        sourceType: source.type,
        sourceId: source.id,
        purpose: `${source.purpose}:reversal`,
        reason: 'no_value_change',
      });
      return;
    }
    const [original] = await tx
      .select()
      .from(journalVoucher)
      .where(eq(journalVoucher.id, d.voucherId));
    const entries = await tx
      .select()
      .from(glEntry)
      .where(eq(glEntry.voucherId, d.voucherId));
    const lines = reverseLines(
      entries.map((e) => ({
        accountId: e.accountId,
        debit: e.debit,
        credit: e.credit,
        ...(e.partyId && { partyId: e.partyId }),
        ...(e.billReference && { billReference: e.billReference }),
        ...(e.gstRegistrationId && { gstRegistrationId: e.gstRegistrationId }),
      })),
    );
    // Historic accounts can be inactive: reversals must use exact original accounts.
    const date = businessDate(),
      number = await this.number(tx, ctx, entityId, date);
    const [v] = await tx
      .insert(journalVoucher)
      .values({
        tenantId: ctx.tenant.tenantId,
        entityId,
        number,
        status: 'submitted',
        postingDate: date,
        narration: `Reversal of ${original!.number}: ${reason}`,
        sourceType: source.type,
        sourceId: source.id,
        purpose: `${source.purpose}:reversal`,
        currency: original!.currency,
        exchangeRate: original!.exchangeRate,
        reversalOf: d.voucherId,
        createdBy: ctx.user.id,
        submittedAt: new Date(),
      })
      .returning();
    await tx.insert(glEntry).values(
      lines.map((l) => ({
        ...l,
        tenantId: ctx.tenant.tenantId,
        entityId,
        voucherId: v!.id,
        postingDate: date,
      })),
    );
    await tx.insert(glDisposition).values({
      tenantId: ctx.tenant.tenantId,
      entityId,
      sourceType: source.type,
      sourceId: source.id,
      purpose: `${source.purpose}:reversal`,
      voucherId: v!.id,
      reason: 'posted',
    });
    await tx
      .update(journalVoucher)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: reason,
      })
      .where(eq(journalVoucher.id, d.voucherId));
    await this.audit.record(
      ctx,
      {
        tenantId: ctx.tenant.tenantId,
        entityId,
        action: 'accounting.reverse',
        targetType: source.type,
        targetId: source.id,
        reason,
        after: { reversalId: v!.id },
      },
      tx,
    );
  }
}
