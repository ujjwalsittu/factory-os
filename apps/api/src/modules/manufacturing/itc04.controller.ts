// ITC-04 (decision 047, evidence docs/compliance/itc04-evidence.md): goods sent to job workers (Table 4) and
// received back (Table 5A) for a rule 45(3) period, CSV in the form's field order, and return deadlines.
import { deadlineState, Dec, itc04Period, type Itc04Frequency } from '@factoryos/core';
import {
  type Database,
  gstRegistration,
  hsnCode,
  item,
  itc04Setting,
  jobWorkChallan,
  jobWorkChallanLine,
  jobWorkConsumption,
  jobWorkOrder,
  jobWorkReceipt,
  party,
  uom,
} from '@factoryos/db';
import { Body, Controller, Get, Header, Inject, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf } from '../accounting/accounting-lock.js';
import { JobWorkService } from './job-work.service.js';

const fyLabel = z.string().regex(/^\d{4}-\d{2}$/, 'Financial year like 2026-27');
const periodQuery = z.object({ period: z.string().regex(/^\d{4}-\d{2}( H[12])?$/, 'Period like "2026-27 H1" or "2026-27"').optional() });
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

interface Table4Row {
  gstin: string | null;
  jobWorker: string;
  jobWorkerState: string | null;
  challanNo: string | null;
  challanDate: string;
  description: string;
  uqc: string;
  qty: string;
  taxableValue: string;
  goodsType: 'input' | 'capital_good';
  igstRate: string | null;
  cgstRate: string | null;
  sgstRate: string | null;
}
interface Table5Row {
  gstin: string | null;
  jobWorker: string;
  jobWorkerState: string | null;
  originalChallanNo: string | null;
  originalChallanDate: string;
  jobWorkerChallanNo: string | null;
  jobWorkerChallanDate: string | null;
  receivedDate: string;
  natureOfWork: string | null;
  description: string;
  uqc: string;
  qty: string;
  lossQty: string;
  scrapQty: string;
}

@Controller('compliance/itc04')
export class Itc04Controller {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly jobWork: JobWorkService,
  ) {}

  @Get('settings')
  @RequirePermission('compliance.itc04.read')
  settings(@Ctx() ctx: TenantRequestContext) {
    return this.db.select().from(itc04Setting).where(eq(itc04Setting.entityId, entityOf(ctx))).orderBy(desc(itc04Setting.fy));
  }

  /** Rule 45(3): half-yearly when the previous FY's aggregate turnover exceeded ₹5 crore, else annual. */
  @Put('settings')
  @RequirePermission('compliance.itc04.update')
  async setFrequency(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(z.object({ fy: fyLabel, frequency: z.enum(['half_yearly', 'annual']) }), body);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(itc04Setting)
        .values({ tenantId: ctx.tenant.tenantId, entityId, fy: input.fy, frequency: input.frequency, createdBy: ctx.user.id })
        .onConflictDoUpdate({ target: [itc04Setting.entityId, itc04Setting.fy], set: { frequency: input.frequency } })
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'itc04.frequency', targetType: 'itc04_setting', targetId: row!.id, after: input }, tx);
      return row!;
    });
  }

  @Get()
  @RequirePermission('compliance.itc04.read')
  async report(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.build(ctx.tenant.tenantId, entityOf(ctx), parse(periodQuery, query).period);
  }

  @Get('export.csv')
  @RequirePermission('compliance.itc04.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async csv(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const r = await this.build(ctx.tenant.tenantId, entityOf(ctx), parse(periodQuery, query).period);
    const out: string[] = [
      ['FORM GST ITC-04 fields', `Period ${r.period.label} (${r.period.from} to ${r.period.to})`, `Due ${r.period.due}`].map(csvCell).join(','),
      '',
      ['Table', 'Our GSTIN', 'GSTIN of job worker', 'State of job worker (if unregistered)', 'Job worker', 'Challan no.', 'Challan date', 'Description of goods', 'UQC', 'Quantity', 'Taxable value', 'Type of goods', 'Integrated tax rate (%)', 'Central tax rate (%)', 'State/UT tax rate (%)'].map(csvCell).join(','),
    ];
    for (const g of r.gstins)
      for (const x of g.table4)
        out.push(['4', g.gstin, x.gstin, x.gstin ? '' : x.jobWorkerState, x.jobWorker, x.challanNo, x.challanDate, x.description, x.uqc, x.qty, x.taxableValue, x.goodsType === 'input' ? 'Inputs' : 'Capital goods', x.igstRate, x.cgstRate, x.sgstRate].map(csvCell).join(','));
    out.push('');
    out.push(['Table', 'Our GSTIN', 'GSTIN of job worker', 'State of job worker (if unregistered)', 'Job worker', 'Original challan no.', 'Original challan date', 'Job worker challan no.', 'Job worker challan date', 'Received date', 'Nature of job work', 'Description of goods', 'UQC', 'Quantity received back', 'Losses', 'Waste and scrap'].map(csvCell).join(','));
    for (const g of r.gstins)
      for (const x of g.table5a)
        out.push(['5A', g.gstin, x.gstin, x.gstin ? '' : x.jobWorkerState, x.jobWorker, x.originalChallanNo, x.originalChallanDate, x.jobWorkerChallanNo, x.jobWorkerChallanDate, x.receivedDate, x.natureOfWork, x.description, x.uqc, x.qty, x.lossQty, x.scrapQty].map(csvCell).join(','));
    return out.join('\r\n') + '\r\n';
  }

  /** Open challan lines with their Sec 143 return deadline; `soon` counts those within 30 days or past it. */
  @Get('deadlines')
  @RequirePermission('compliance.itc04.read')
  async deadlines(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const today = businessDate();
    const rows = await this.db
      .select({
        id: jobWorkChallanLine.id,
        orderId: jobWorkOrder.id,
        orderNumber: jobWorkOrder.number,
        challanNo: jobWorkChallan.number,
        challanDate: jobWorkChallan.postingDate,
        jobWorker: party.name,
        itemCode: item.code,
        itemName: item.name,
        uqc: uom.code,
        qty: jobWorkChallanLine.qty,
        value: jobWorkChallanLine.value,
        goodsType: jobWorkChallanLine.goodsType,
        dueBy: jobWorkChallanLine.dueBy,
        extendedDueBy: jobWorkChallanLine.extendedDueBy,
        extensionRef: jobWorkChallanLine.extensionRef,
        deemedSupplyInvoiceNo: jobWorkChallanLine.deemedSupplyInvoiceNo,
      })
      .from(jobWorkChallanLine)
      .innerJoin(jobWorkChallan, eq(jobWorkChallan.id, jobWorkChallanLine.challanId))
      .innerJoin(jobWorkOrder, eq(jobWorkOrder.id, jobWorkChallan.orderId))
      .innerJoin(party, eq(party.id, jobWorkOrder.supplierId))
      .innerJoin(item, eq(item.id, jobWorkChallanLine.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .where(and(eq(jobWorkChallan.entityId, entityId), eq(jobWorkChallan.status, 'submitted')))
      .orderBy(asc(jobWorkChallan.postingDate), asc(jobWorkChallanLine.lineNo));
    const used = rows.length
      ? await this.db
          .select({ challanLineId: jobWorkConsumption.challanLineId, qty: jobWorkConsumption.qty })
          .from(jobWorkConsumption)
          .where(inArray(jobWorkConsumption.challanLineId, rows.map((r) => r.id)))
      : [];
    const lines = rows
      .map((r) => {
        const back = used.filter((u) => u.challanLineId === r.id).reduce((s, u) => s.add(u.qty), Dec.ZERO);
        const open = Dec.of(r.qty).sub(back);
        const due = r.extendedDueBy ?? r.dueBy;
        return { ...r, open: open.toString(), due, state: r.deemedSupplyInvoiceNo ? 'deemed_supply' : deadlineState(due, today) };
      })
      .filter((r) => Dec.of(r.open).gt('0'))
      .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
    return { today, soon: lines.filter((l) => l.state === 'due_soon' || l.state === 'overdue').length, lines };
  }

  private async build(tenantId: string, entityId: string, period: string | undefined) {
    const today = businessDate();
    const fyStart = period ? Number(period.slice(0, 4)) : Number(itc04Period(today, 'annual').from.slice(0, 4));
    const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
    const [setting] = await this.db.select().from(itc04Setting).where(and(eq(itc04Setting.entityId, entityId), eq(itc04Setting.fy, fy)));
    // An explicit period decides its own frequency; otherwise the FY's setting (default half-yearly) does.
    const frequency: Itc04Frequency = period ? (period.includes(' H') ? 'half_yearly' : 'annual') : (setting?.frequency ?? 'half_yearly');
    const anchor = period?.endsWith('H2') ? `${fyStart}-10-01` : period ? `${fyStart}-04-01` : today;
    const p = itc04Period(anchor, frequency);
    const regs = await this.db.select().from(gstRegistration).where(eq(gstRegistration.entityId, entityId));
    const challans = await this.db
      .select({ challan: jobWorkChallan, line: jobWorkChallanLine, supplier: party, itemName: item.name, itemCode: item.code, uqc: uom.code, hsn: item.hsnCode })
      .from(jobWorkChallanLine)
      .innerJoin(jobWorkChallan, eq(jobWorkChallan.id, jobWorkChallanLine.challanId))
      .innerJoin(jobWorkOrder, eq(jobWorkOrder.id, jobWorkChallan.orderId))
      .innerJoin(party, eq(party.id, jobWorkOrder.supplierId))
      .innerJoin(item, eq(item.id, jobWorkChallanLine.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .where(and(eq(jobWorkChallan.entityId, entityId), eq(jobWorkChallan.status, 'submitted'), gte(jobWorkChallan.postingDate, p.from), lte(jobWorkChallan.postingDate, p.to)))
      .orderBy(asc(jobWorkChallan.postingDate), asc(jobWorkChallan.number), asc(jobWorkChallanLine.lineNo));
    const rates = new Map<string, string | null>();
    for (const c of challans) {
      const key = `${c.line.hsnCode ?? c.hsn}:${c.challan.postingDate}`;
      if (rates.has(key) || !(c.line.hsnCode ?? c.hsn)) continue;
      const [h] = await this.db
        .select({ rate: hsnCode.gstRate })
        .from(hsnCode)
        .where(and(eq(hsnCode.tenantId, tenantId), eq(hsnCode.code, (c.line.hsnCode ?? c.hsn)!), lte(hsnCode.effectiveFrom, c.challan.postingDate)))
        .orderBy(desc(hsnCode.effectiveFrom))
        .limit(1);
      rates.set(key, h?.rate ?? null);
    }
    const receipts = await this.db
      .select({ consumption: jobWorkConsumption, receipt: jobWorkReceipt, order: jobWorkOrder, challan: jobWorkChallan, supplier: party, itemName: item.name, itemCode: item.code, uqc: uom.code })
      .from(jobWorkConsumption)
      .innerJoin(jobWorkReceipt, eq(jobWorkReceipt.id, jobWorkConsumption.receiptId))
      .innerJoin(jobWorkOrder, eq(jobWorkOrder.id, jobWorkReceipt.orderId))
      .innerJoin(jobWorkChallanLine, eq(jobWorkChallanLine.id, jobWorkConsumption.challanLineId))
      .innerJoin(jobWorkChallan, eq(jobWorkChallan.id, jobWorkChallanLine.challanId))
      .innerJoin(party, eq(party.id, jobWorkOrder.supplierId))
      .innerJoin(item, eq(item.id, jobWorkChallanLine.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .where(and(eq(jobWorkReceipt.entityId, entityId), eq(jobWorkReceipt.status, 'submitted'), isNull(jobWorkConsumption.reversalOf), gte(jobWorkReceipt.postingDate, p.from), lte(jobWorkReceipt.postingDate, p.to)))
      .orderBy(asc(jobWorkReceipt.postingDate), asc(jobWorkReceipt.number), asc(jobWorkChallan.number));
    const stateOf = (s: typeof party.$inferSelect) => s.stateCode ?? (s.gstin ? s.gstin.slice(0, 2) : null);
    const groups = new Map<string, { gstin: string | null; table4: Table4Row[]; table5a: Table5Row[] }>();
    const group = (regId: string | null) => {
      const key = regId ?? 'none';
      if (!groups.has(key)) groups.set(key, { gstin: regs.find((r) => r.id === regId)?.gstin ?? null, table4: [], table5a: [] });
      return groups.get(key)!;
    };
    for (const c of challans) {
      const rate = rates.get(`${c.line.hsnCode ?? c.hsn}:${c.challan.postingDate}`) ?? null;
      const half = rate === null ? null : Dec.of(rate).div('2').toString();
      group(c.challan.gstRegistrationId).table4.push({
        gstin: c.supplier.gstin,
        jobWorker: c.supplier.name,
        jobWorkerState: stateOf(c.supplier),
        challanNo: c.challan.number,
        challanDate: c.challan.postingDate,
        description: `${c.itemCode} ${c.itemName}`,
        uqc: c.uqc,
        qty: c.line.qty,
        taxableValue: Dec.of(c.line.value).toFixed(2),
        goodsType: c.line.goodsType,
        igstRate: c.challan.interstate ? rate : null,
        cgstRate: c.challan.interstate ? null : half,
        sgstRate: c.challan.interstate ? null : half,
      });
    }
    for (const r of receipts) {
      const q = Dec.of(r.consumption.qty);
      group(r.challan.gstRegistrationId).table5a.push({
        gstin: r.supplier.gstin,
        jobWorker: r.supplier.name,
        jobWorkerState: stateOf(r.supplier),
        originalChallanNo: r.challan.number,
        originalChallanDate: r.challan.postingDate,
        jobWorkerChallanNo: r.receipt.jobWorkerChallanNo,
        jobWorkerChallanDate: r.receipt.jobWorkerChallanDate,
        receivedDate: r.receipt.postingDate,
        natureOfWork: r.order.natureOfWork,
        description: `${r.itemCode} ${r.itemName}`,
        uqc: r.uqc,
        qty: q.sub(r.consumption.lossQty).sub(r.consumption.scrapQty).toString(),
        lossQty: r.consumption.lossQty,
        scrapQty: r.consumption.scrapQty,
      });
    }
    return { period: p, frequency, configuredFrequency: setting?.frequency ?? null, gstins: [...groups.values()] };
  }
}
