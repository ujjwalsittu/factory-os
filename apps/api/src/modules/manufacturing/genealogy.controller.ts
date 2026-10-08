// Genealogy explorer and recall list (decision 046).
import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { parse } from '../../common/validation.js';
import { entityOf } from '../accounting/accounting-lock.js';
import { GenealogyService } from './genealogy.service.js';

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote, and neutralise spreadsheet formulas in exported text.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

@Controller('manufacturing/genealogy')
export class GenealogyController {
  constructor(private readonly genealogy: GenealogyService) {}

  @Get()
  @RequirePermission('manufacturing.genealogy.read')
  search(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    entityOf(ctx);
    const { q } = parse(z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(60) }), query);
    return this.genealogy.search(ctx.tenant.tenantId, q);
  }

  @Get(':batchId')
  @RequirePermission('manufacturing.genealogy.read')
  tree(@Ctx() ctx: TenantRequestContext, @Param('batchId', ParseUUIDPipe) batchId: string, @Query() query: unknown) {
    const { direction } = parse(z.object({ direction: z.enum(['backward', 'forward']).default('backward') }), query);
    return this.genealogy.tree(ctx.tenant.tenantId, entityOf(ctx), batchId, direction);
  }

  @Get(':batchId/recall')
  @RequirePermission('manufacturing.genealogy.read')
  recall(@Ctx() ctx: TenantRequestContext, @Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.genealogy.recall(ctx.tenant.tenantId, entityOf(ctx), batchId);
  }

  @Get(':batchId/recall.csv')
  @RequirePermission('manufacturing.genealogy.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async recallCsv(@Ctx() ctx: TenantRequestContext, @Param('batchId', ParseUUIDPipe) batchId: string) {
    const { rows, truncated } = await this.genealogy.recall(ctx.tenant.tenantId, entityOf(ctx), batchId);
    const head = ['Level', 'Item', 'Item name', 'Serial / lot', 'Kind', 'Heat', 'Via work order', 'In stock', 'Shipped to', 'Invoice', 'Shipped on', 'Returned'];
    const lines = rows.flatMap((r) => {
      const stock = r.stock.map((s) => `${s.warehouse}: ${s.qty}`).join('; ');
      const base = [r.depth, r.itemCode, r.itemName, r.batchNo, r.kind, r.heatNo, r.viaNumber, stock];
      return r.deliveries.length ? r.deliveries.map((d) => [...base, d.customer, d.invoice, d.date, d.returned]) : [[...base, '', '', '', '']];
    });
    const out = [head, ...lines].map((l) => l.map(csvCell).join(',')).join('\r\n');
    return truncated ? `${out}\r\n"(truncated at the traversal limit)"` : out;
  }
}
