import { formatSeries, fyCode } from '@factoryos/core';
import { type Database, gstRegistration, legalEntity, numberSeries } from '@factoryos/db';
import { BadRequestException, Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';
import { DEFAULT_SERIES, StockPostingService } from './stock-posting.service.js';

const LABELS: Record<string, string> = {
  sales_invoice: 'Tax invoice',
  credit_note: 'Credit note',
  quotation: 'Quotation',
  sales_order: 'Sales order',
  purchase_order: 'Purchase order',
  purchase_invoice: 'Purchase invoice (internal no.)',
  stock_entry: 'Stock entry',
  quality_inspection: 'Incoming inspection',
  landed_cost_voucher: 'Landed cost voucher',
  customer_receipt: 'Customer receipt',
  supplier_payment: 'Supplier payment',
  settlement_allocation: 'On-account allocation',
};

/** Number series of the active entity for the current FY; the next number can be moved forward (decision 029). */
@Controller()
export class SeriesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
  ) {}

  @Get('number-series')
  @RequirePermission('settings.entity.read')
  async list(@Ctx() ctx: TenantRequestContext) {
    const entityId = this.entityOf(ctx);
    const [e] = await this.db.select().from(legalEntity).where(eq(legalEntity.id, entityId));
    const fy = fyCode(new Date(), e!.fyStartMonth);
    const regs = await this.db.select().from(gstRegistration).where(eq(gstRegistration.entityId, entityId)).orderBy(asc(gstRegistration.gstin));
    const rows = await this.db.select().from(numberSeries).where(and(eq(numberSeries.entityId, entityId), eq(numberSeries.fy, fy)));
    const docTypes = Object.keys(DEFAULT_SERIES).flatMap((base) =>
      base === 'sales_invoice' || base === 'credit_note' ? regs.map((r) => ({ docType: `${base}:${r.id}`, base, gstin: r.gstin })) : [{ docType: base, base, gstin: null as string | null }],
    );
    return docTypes.map((d) => {
      const row = rows.find((r) => r.docType === d.docType);
      const nextValue = row?.nextValue ?? 1;
      return {
        docType: d.docType,
        label: LABELS[d.base] ?? d.base,
        gstin: d.gstin,
        fy,
        pattern: DEFAULT_SERIES[d.base]!,
        nextValue,
        nextNumber: formatSeries(DEFAULT_SERIES[d.base]!, { entityCode: e!.code, fy, counter: nextValue }),
        used: nextValue > 1,
      };
    });
  }

  @Put('number-series')
  @RequirePermission('settings.entity.update')
  async setNext(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = this.entityOf(ctx);
    const input = parse(z.object({ docType: z.string().min(1).max(80), fy: z.string().regex(/^\d{2}-\d{2}$/), nextValue: z.number().int().min(1).max(99999999) }), body);
    const base = input.docType.split(':')[0]!;
    if (base === 'sales_invoice' || base === 'credit_note') {
      const regId = input.docType.split(':')[1];
      const [reg] = regId ? await this.db.select().from(gstRegistration).where(and(eq(gstRegistration.id, regId), eq(gstRegistration.entityId, entityId))) : [];
      if (!reg) throw new BadRequestException('Unknown GST registration for this series');
    }
    return this.db.transaction(async (tx) => {
      const r = await this.posting.setNextValue(tx, ctx.tenant.tenantId, entityId, input.docType, input.fy, input.nextValue);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'number_series.set_next', targetType: 'number_series', targetId: input.docType, before: { nextValue: r.before }, after: { nextValue: r.after, fy: input.fy } }, tx);
      return { ok: true, ...r };
    });
  }

  private entityOf(ctx: TenantRequestContext): string {
    if (!ctx.tenant.activeEntityId) throw new BadRequestException('Select a legal entity first (number series are per entity)');
    return ctx.tenant.activeEntityId;
  }
}
