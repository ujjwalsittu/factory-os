import { createHash } from 'node:crypto';
import { Dec, allocateProportion } from '@factoryos/core';
import {
  accountingSettings,
  fifoLayer,
  openingWorksheet,
  purchaseInvoice,
  purchaseOrderLine,
  salesInvoice,
  stockEntry,
  stockEntryLine,
} from '@factoryos/db';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '@factoryos/db';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import {
  businessDate,
  lockAccounting,
  type Db,
  type Tx,
} from './accounting-lock.js';
import { GlPostingService } from './gl-posting.service.js';
@Injectable()
export class OpeningService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly gl: GlPostingService,
    private readonly audit: AuditService,
  ) {}
  async preview(db: Db, entityId: string) {
    const [worksheet] = await db
      .select()
      .from(openingWorksheet)
      .where(eq(openingWorksheet.entityId, entityId));
    const [settings] = await db
      .select()
      .from(accountingSettings)
      .where(eq(accountingSettings.entityId, entityId));
    const layers = await db
      .select()
      .from(fifoLayer)
      .where(eq(fifoLayer.entityId, entityId));
    const sales = await db
      .select()
      .from(salesInvoice)
      .where(
        and(
          eq(salesInvoice.entityId, entityId),
          eq(salesInvoice.status, 'submitted'),
        ),
      )
      .orderBy(asc(salesInvoice.id));
    const purchases = await db
      .select()
      .from(purchaseInvoice)
      .where(
        and(
          eq(purchaseInvoice.entityId, entityId),
          eq(purchaseInvoice.status, 'submitted'),
        ),
      )
      .orderBy(asc(purchaseInvoice.id));
    const receipts = await db
      .select({
        line: stockEntryLine,
        entry: stockEntry,
        poLine: purchaseOrderLine,
      })
      .from(stockEntryLine)
      .innerJoin(stockEntry, eq(stockEntryLine.entryId, stockEntry.id))
      .innerJoin(
        purchaseOrderLine,
        eq(stockEntryLine.poLineId, purchaseOrderLine.id),
      )
      .where(
        and(
          eq(stockEntry.entityId, entityId),
          eq(stockEntry.status, 'submitted'),
          eq(stockEntry.purpose, 'receipt'),
        ),
      )
      .orderBy(
        asc(stockEntry.postingDate),
        asc(stockEntry.createdAt),
        asc(stockEntryLine.lineNo),
      );
    const billed = new Map<string, Dec>();
    const baseline = receipts
      .filter((r) => !r.line.ownerPartyId)
      .map((r) => {
        const previous = billed.get(r.poLine.id) ?? Dec.of(r.poLine.billedQty);
        const used = previous.gt(r.line.qty) ? Dec.of(r.line.qty) : previous;
        billed.set(r.poLine.id, previous.sub(used));
        const qty = Dec.of(r.line.qty).sub(used);
        return {
          receiptLineId: r.line.id,
          qty: qty.toString(),
          baseCost: allocateProportion(
            r.line.value ?? '0',
            qty.toString(),
            r.line.qty,
          ),
        };
      })
      .filter((r) => Dec.of(r.qty).gt('0'));
    const inventoryValue = layers.reduce(
      (s, l) => s.add(Dec.of(l.qtyRemaining).mul(l.rate)),
      Dec.ZERO,
    );
    const grniValue = baseline.reduce((s, r) => s.add(r.baseCost), Dec.ZERO);
    const lines = worksheet?.lines ?? [],
      bills = worksheet?.bills ?? [],
      settlements = worksheet?.settlements ?? [];
    const net = (role: string) =>
      lines
        .filter((l) => l.accountId === settings?.mappings[role])
        .reduce((s, l) => s.add(l.debit).sub(l.credit), Dec.ZERO);
    const differences: {
      control: string;
      expected: string;
      declared: string;
      difference: string;
    }[] = [];
    const diff = (control: string, expected: Dec, declared: Dec) => {
      if (!expected.eq(declared))
        differences.push({
          control,
          expected: expected.toString(),
          declared: declared.toString(),
          difference: declared.sub(expected).toString(),
        });
    };
    diff('Inventory', inventoryValue, net('inventory'));
    diff('GRNI', grniValue.neg(), net('grni'));
    const billTotal = (side: 'debit' | 'credit') =>
      bills
        .filter((b) => b.side === side)
        .reduce((s, b) => s.add(b.amount), Dec.ZERO);
    diff('Sundry Debtors', billTotal('debit'), net('debtors'));
    diff('Sundry Creditors', billTotal('credit').neg(), net('creditors'));
    const expectedBills = [
      ...sales.map((i) => ({
        id: i.id,
        partyId: i.customerId,
        side: 'debit' as const,
        number: i.number,
        amount: Dec.of(i.grandTotal ?? '0').mul(i.exchangeRate),
        currency: i.currency,
        exchangeRate: i.exchangeRate,
        originalAmount: i.grandTotal ?? '0',
      })),
      ...purchases.map((i) => ({
        id: i.id,
        partyId: i.supplierId,
        side: 'credit' as const,
        number: i.number,
        amount: Dec.of(i.grandTotal ?? '0').mul(i.exchangeRate),
        currency: i.currency,
        exchangeRate: i.exchangeRate,
        originalAmount: i.grandTotal ?? '0',
      })),
    ];
    for (const inv of expectedBills) {
      const settled = settlements
        .filter((s) => s.invoiceId === inv.id)
        .reduce((s, r) => s.add(r.amount), Dec.ZERO);
      const remaining = inv.amount.sub(settled);
      const linked = bills
        .filter(
          (b) =>
            b.invoiceId === inv.id &&
            b.partyId === inv.partyId &&
            b.side === inv.side,
        )
        .reduce((s, b) => s.add(b.amount), Dec.ZERO);
      if (settled.gt(inv.amount) || settled.lt('0'))
        differences.push({
          control: `Settlement ${inv.number}`,
          expected: inv.amount.toString(),
          declared: settled.toString(),
          difference: settled.sub(inv.amount).toString(),
        });
      else diff(`Invoice ${inv.number}`, remaining, linked);
    }
    for (const b of bills) {
      const original = expectedBills.find((i) => i.id === b.invoiceId);
      if (
        original &&
        original.currency !== 'INR' &&
        (b.currency !== original.currency ||
          !b.exchangeRate ||
          !Dec.of(b.exchangeRate).eq(original.exchangeRate) ||
          !b.originalAmount ||
          !Dec.of(b.originalAmount).eq(original.originalAmount))
      )
        differences.push({
          control: `Currency metadata ${b.reference}`,
          expected: original.originalAmount,
          declared: b.originalAmount ?? '0',
          difference: original.originalAmount,
        });
      if (
        b.invoiceId &&
        !expectedBills.some(
          (i) =>
            i.id === b.invoiceId &&
            i.partyId === b.partyId &&
            i.side === b.side,
        )
      )
        differences.push({
          control: `Unknown invoice ${b.reference}`,
          expected: '0',
          declared: b.amount,
          difference: b.amount,
        });
    }
    for (const s of settlements)
      if (!expectedBills.some((i) => i.id === s.invoiceId))
        differences.push({
          control: 'Unknown settlement invoice',
          expected: '0',
          declared: s.amount,
          difference: s.amount,
        });
    const partyIds = new Set([
      ...bills.map((b) => b.partyId),
      ...lines
        .filter(
          (l) =>
            l.accountId === settings?.mappings.debtors ||
            l.accountId === settings?.mappings.creditors,
        )
        .map((l) => l.partyId),
    ]);
    for (const partyId of partyIds)
      for (const side of ['debit', 'credit'] as const) {
        const role = side === 'debit' ? 'debtors' : 'creditors';
        const declared = lines
          .filter(
            (l) =>
              l.accountId === settings?.mappings[role] && l.partyId === partyId,
          )
          .reduce((s, l) => s.add(l.debit).sub(l.credit), Dec.ZERO);
        const expected = bills
          .filter((b) => b.partyId === partyId && b.side === side)
          .reduce((s, b) => s.add(b.amount), Dec.ZERO);
        diff(
          `${role} party ${partyId}`,
          side === 'debit' ? expected : expected.neg(),
          declared,
        );
      }
    const declaredBaselines = worksheet?.receiptBaselines ?? [];
    for (const r of baseline) {
      const stated = declaredBaselines.find(
        (b) => b.receiptLineId === r.receiptLineId,
      );
      diff(
        `Receipt quantity ${r.receiptLineId}`,
        Dec.of(r.qty),
        Dec.of(stated?.qty ?? '0'),
      );
      diff(
        `Receipt cost ${r.receiptLineId}`,
        Dec.of(r.baseCost),
        Dec.of(stated?.baseCost ?? '0'),
      );
    }
    for (const r of declaredBaselines)
      if (!baseline.some((b) => b.receiptLineId === r.receiptLineId))
        differences.push({
          control: `Unknown receipt ${r.receiptLineId}`,
          expected: '0',
          declared: r.baseCost,
          difference: r.baseCost,
        });
    // Include full reviewed source state and worksheet: edits/settlements invalidate old approval.
    const snapshot = {
      layers,
      sales,
      purchases,
      receipts,
      worksheet,
      mappings: settings?.mappings,
      date: businessDate(),
    };
    const snapshotToken = createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex');
    return {
      worksheetId: worksheet?.id ?? null,
      snapshotToken,
      inventoryValue: inventoryValue.toString(),
      grniValue: grniValue.toString(),
      receiptBaselines: baseline,
      invoices: expectedBills.map((i) => ({
        ...i,
        amount: i.amount.toString(),
        remaining: i.amount
          .sub(
            settlements
              .filter((s) => s.invoiceId === i.id)
              .reduce((sum, s) => sum.add(s.amount), Dec.ZERO),
          )
          .toString(),
      })),
      differences,
      cutoverDate: businessDate(),
    };
  }
  async activateIn(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    worksheetId: string,
    reviewedToken: string,
  ) {
    await lockAccounting(tx, entityId);
    const [settings] = await tx
      .select()
      .from(accountingSettings)
      .where(eq(accountingSettings.entityId, entityId))
      .for('update');
    if (!settings || settings.active)
      throw new ConflictException(
        'Accounting is already active or not configured',
      );
    const preview = await this.preview(tx, entityId);
    if (
      preview.worksheetId !== worksheetId ||
      preview.snapshotToken !== reviewedToken
    )
      throw new ConflictException(
        'Opening reconciliation is stale; review the latest balances',
      );
    if (preview.differences.length)
      throw new ConflictException({
        message: 'Reconcile all opening balances first',
        differences: preview.differences,
      });
    const [w] = await tx
      .select()
      .from(openingWorksheet)
      .where(
        and(
          eq(openingWorksheet.id, worksheetId),
          eq(openingWorksheet.entityId, entityId),
        ),
      )
      .for('update');
    const result = await this.gl.postIn(
      tx,
      ctx,
      entityId,
      {
        type: 'opening',
        id: w!.id,
        purpose: 'main',
        narration: 'Reconciled opening balances at accounting activation',
      },
      businessDate(),
      {
        lines: w!.lines,
        disposition: w!.lines.length ? 'posted' : 'no_value_change',
      },
    );
    await tx
      .update(openingWorksheet)
      .set({ reviewedSnapshot: preview })
      .where(eq(openingWorksheet.id, w!.id));
    await tx
      .update(accountingSettings)
      .set({
        active: true,
        cutoverDate: businessDate(),
        activatedAt: new Date(),
        activatedBy: ctx.user.id,
        openingVoucherId: result.voucherId,
      })
      .where(eq(accountingSettings.entityId, entityId));
    await this.audit.record(
      ctx,
      {
        tenantId: ctx.tenant.tenantId,
        entityId,
        action: 'accounting.activate',
        targetType: 'legal_entity',
        targetId: entityId,
        after: preview,
      },
      tx,
    );
    return { openingVoucherId: result.voucherId };
  }
}
