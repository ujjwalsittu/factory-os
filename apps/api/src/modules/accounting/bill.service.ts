import { Dec } from '@factoryos/core';
import { accountingSettings, glAccount, glEntry, tradeBill, tradeBillEffect } from '@factoryos/db';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, lte } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { Tx } from './accounting-lock.js';
import type { SourceRef } from './gl-posting.service.js';
export type TradeSide = 'receivable' | 'payable';
export interface BillBalance {
  id: string; partyId: string; side: TradeSide; accountId: string; reference: string;
  sourceType: string; sourceId: string; currency: string; recognitionDate: string;
  dueDate: string | null; openAmount: string; carryingInr: string; msmeCategory: string | null;
}
export interface BillSourceEffect {
  billId?: string; partyId: string; side: TradeSide; accountId: string; reference: string;
  currency: string; recognitionDate: string; postingDate: string; dueDate: string | null;
  amount: string; carryingInr: string; msmeCategory: string | null; originKey: string;
}
export interface PartyPosition { grossOpenInr: string; onAccountInr: string; netInr: string; overdueInr: string; overdueCount: number }
@Injectable()
export class BillService {
  async recordSourceIn(tx: Tx, ctx: TenantRequestContext, entityId: string, source: SourceRef, effects: BillSourceEffect[]) {
    const scope = { tenantId: ctx.tenant.tenantId, entityId };
    for (const e of effects) {
      let billId = e.billId;
      if (!billId) {
        await tx.insert(tradeBill).values({ ...scope, partyId: e.partyId, side: e.side, accountId: e.accountId, reference: e.reference, currency: e.currency, recognitionDate: e.recognitionDate, dueDate: e.dueDate, msmeCategory: e.msmeCategory, sourceType: source.type, sourceId: source.id, originKey: e.originKey }).onConflictDoNothing();
        const [b] = await tx.select().from(tradeBill).where(and(eq(tradeBill.entityId, entityId), eq(tradeBill.sourceType, source.type), eq(tradeBill.sourceId, source.id), eq(tradeBill.originKey, e.originKey)));
        billId = b!.id;
      } else await this.balanceIn(tx, ctx, entityId, billId);
      await tx.insert(tradeBillEffect).values({ ...scope, billId, sourceType: source.type, sourceId: source.id, originKey: e.originKey, postingDate: e.postingDate, amount: e.amount, carryingInr: e.carryingInr }).onConflictDoNothing();
    }
  }
  async listIn(tx: Tx, ctx: TenantRequestContext, entityId: string, filters: { side?: TradeSide; partyId?: string; currency?: string; asOf: string; overdue?: boolean; msme?: boolean }): Promise<BillBalance[]> {
    const rows = await tx.select().from(tradeBill).where(and(eq(tradeBill.tenantId, ctx.tenant.tenantId), eq(tradeBill.entityId, entityId), lte(tradeBill.recognitionDate, filters.asOf), ...(filters.side ? [eq(tradeBill.side, filters.side)] : []), ...(filters.partyId ? [eq(tradeBill.partyId, filters.partyId)] : []), ...(filters.currency ? [eq(tradeBill.currency, filters.currency)] : [])));
    const effects = await tx.select().from(tradeBillEffect).where(and(eq(tradeBillEffect.tenantId, ctx.tenant.tenantId), eq(tradeBillEffect.entityId, entityId), lte(tradeBillEffect.postingDate, filters.asOf)));
    return rows.map(b => {
      const values = effects.filter(e => e.billId === b.id);
      return { ...b, side: b.side as TradeSide, openAmount: values.reduce((s, e) => s.add(e.amount), Dec.ZERO).toString(), carryingInr: values.reduce((s, e) => s.add(e.carryingInr), Dec.ZERO).toString() };
    }).filter(b => !Dec.of(b.openAmount).isZero() || !Dec.of(b.carryingInr).isZero()).filter(b => (!filters.overdue || (b.dueDate !== null && b.dueDate < filters.asOf && Dec.of(b.openAmount).gt('0'))) && (!filters.msme || ['micro', 'small'].includes(b.msmeCategory ?? '')));
  }
  async balanceIn(tx: Tx, ctx: TenantRequestContext, entityId: string, billId: string, asOf = '9999-12-31'): Promise<BillBalance> {
    const [b] = await tx.select().from(tradeBill).where(and(eq(tradeBill.id, billId), eq(tradeBill.tenantId, ctx.tenant.tenantId), eq(tradeBill.entityId, entityId)));
    if (!b) throw new NotFoundException('Bill not found in this entity');
    const effects = await tx.select().from(tradeBillEffect).where(and(eq(tradeBillEffect.billId, billId), eq(tradeBillEffect.entityId, entityId), lte(tradeBillEffect.postingDate, asOf)));
    return { ...b, side: b.side as TradeSide, openAmount: effects.reduce((s, e) => s.add(e.amount), Dec.ZERO).toString(), carryingInr: effects.reduce((s, e) => s.add(e.carryingInr), Dec.ZERO).toString() };
  }
  async positionIn(tx: Tx, ctx: TenantRequestContext, entityId: string, partyId: string, side: TradeSide, asOf: string): Promise<PartyPosition> {
    const rows = await this.listIn(tx, ctx, entityId, { partyId, side, asOf });
    const gross = rows.filter(b => Dec.of(b.carryingInr).gt('0')).reduce((s, b) => s.add(b.carryingInr), Dec.ZERO);
    const credits = rows.filter(b => Dec.of(b.carryingInr).lt('0')).reduce((s, b) => s.sub(b.carryingInr), Dec.ZERO);
    const overdue = rows.filter(b => Dec.of(b.openAmount).gt('0') && b.dueDate && b.dueDate < asOf);
    return { grossOpenInr: gross.toString(), onAccountInr: credits.toString(), netInr: gross.sub(credits).toString(), overdueInr: overdue.reduce((s, b) => s.add(b.carryingInr), Dec.ZERO).toString(), overdueCount: overdue.length };
  }
  async controlAccountsIn(tx: Tx, ctx: TenantRequestContext, entityId: string): Promise<Map<string, TradeSide>> {
    const [s] = await tx.select().from(accountingSettings).where(and(eq(accountingSettings.entityId, entityId), eq(accountingSettings.tenantId, ctx.tenant.tenantId)));
    const accounts = await tx.select().from(glAccount).where(and(eq(glAccount.entityId, entityId), eq(glAccount.tenantId, ctx.tenant.tenantId)));
    const result = new Map<string, TradeSide>();
    for (const [role, side] of [['debtors', 'receivable'], ['creditors', 'payable']] as const)
      for (const id of [s?.mappings[role], ...(s?.controlHistory[role] ?? []), ...accounts.filter(a => a.role === role).map(a => a.id)]) if (id) result.set(id, side);
    return result;
  }
  async reconciliationIn(tx: Tx, ctx: TenantRequestContext, entityId: string, asOf = '9999-12-31') {
    const controls = await this.controlAccountsIn(tx, ctx, entityId);
    const entries = controls.size ? await tx.select().from(glEntry).where(and(eq(glEntry.entityId, entityId), eq(glEntry.tenantId, ctx.tenant.tenantId), inArray(glEntry.accountId, [...controls.keys()]), lte(glEntry.postingDate, asOf))) : [];
    const bills = await this.listIn(tx, ctx, entityId, { asOf });
    const totals = new Map<string, { partyId: string | null; accountId: string; gl: Dec; bills: Dec }>();
    const get = (partyId: string | null, accountId: string) => {
      const key = `${partyId}:${accountId}`;
      if (!totals.has(key)) totals.set(key, { partyId, accountId, gl: Dec.ZERO, bills: Dec.ZERO });
      return totals.get(key)!;
    };
    for (const e of entries) { const row = get(e.partyId, e.accountId); row.gl = row.gl.add(controls.get(e.accountId) === 'receivable' ? Dec.of(e.debit).sub(e.credit) : Dec.of(e.credit).sub(e.debit)); }
    for (const b of bills) { const row = get(b.partyId, b.accountId); row.bills = row.bills.add(b.carryingInr); }
    const rows = [...totals.values()].map(r => ({ partyId: r.partyId, accountId: r.accountId, glInr: r.gl.toString(), billInr: r.bills.toString(), difference: r.gl.sub(r.bills).toString() }));
    return { rows, differences: rows.filter(r => !Dec.of(r.difference).isZero()) };
  }
  async assertReconciledIn(tx: Tx, ctx: TenantRequestContext, entityId: string) {
    const r = await this.reconciliationIn(tx, ctx, entityId);
    if (r.differences.length) throw new ConflictException({ message: 'Trade subledger does not reconcile; review the identified party/control accounts', differences: r.differences });
  }
  async assertSourceCancellableIn(tx: Tx, ctx: TenantRequestContext, entityId: string, sourceType: string, sourceId: string) {
    const bills = await tx.select().from(tradeBill).where(and(eq(tradeBill.tenantId, ctx.tenant.tenantId), eq(tradeBill.entityId, entityId), eq(tradeBill.sourceType, sourceType), eq(tradeBill.sourceId, sourceId)));
    for (const b of bills) {
      const effects = await tx.select().from(tradeBillEffect).where(and(eq(tradeBillEffect.entityId, entityId), eq(tradeBillEffect.billId, b.id)));
      const totals = new Map<string, Dec>();
      for (const e of effects) if (e.sourceType !== sourceType || e.sourceId !== sourceId) {
        const key = `${e.sourceType}:${e.sourceId}`;
        totals.set(key, (totals.get(key) ?? Dec.ZERO).add(e.amount));
      }
      const dependencies = [...totals].filter(([, n]) => n.lt('0')).map(([source]) => source);
      if (dependencies.length) throw new ConflictException({ message: 'Reverse bill allocations/adjustments before cancelling this source', dependencies });
    }
  }
  async reverseSourceIn(tx: Tx, ctx: TenantRequestContext, entityId: string, source: SourceRef, postingDate: string) {
    const effects = await tx.select().from(tradeBillEffect).where(and(eq(tradeBillEffect.entityId, entityId), eq(tradeBillEffect.tenantId, ctx.tenant.tenantId), eq(tradeBillEffect.sourceType, source.type), eq(tradeBillEffect.sourceId, source.id)));
    for (const e of effects.filter(e => !e.reversalOf)) await tx.insert(tradeBillEffect).values({ tenantId: ctx.tenant.tenantId, entityId, billId: e.billId, sourceType: source.type, sourceId: source.id, originKey: `reversal:${e.id}`, postingDate, amount: Dec.of(e.amount).neg().toString(), carryingInr: Dec.of(e.carryingInr).neg().toString(), reversalOf: e.id }).onConflictDoNothing();
  }
}
