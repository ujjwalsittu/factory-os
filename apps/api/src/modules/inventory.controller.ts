import { Dec } from '@factoryos/core';
import { batch, type Database, item, party, stockBin, stockEntry, stockEntryLine, uom, user, warehouse } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';
import { StockPostingService } from './stock-posting.service.js';
import { stockBalance, stockLedger } from './readers/inventory.read.js';

const WAREHOUSE_TYPES = ['stores', 'quarantine', 'mrb', 'wip', 'dry_cabinet', 'cleanroom', 'finished_goods', 'scrap', 'customer_owned', 'at_job_worker', 'transit'] as const;
/** Stock in these locations can't be issued to production until it's moved out (docs/03 §2). */
const NOT_ISSUABLE = new Set(['quarantine', 'mrb', 'scrap', 'transit', 'at_job_worker']);

/** The standard layout from docs/03 §2, created in one click for a new entity. */
const STANDARD_WAREHOUSES: { code: string; name: string; type: (typeof WAREHOUSE_TYPES)[number] }[] = [
  { code: 'STORES', name: 'Main stores', type: 'stores' },
  { code: 'QUAR', name: 'Quarantine (incoming QC)', type: 'quarantine' },
  { code: 'MRB', name: 'MRB / hold', type: 'mrb' },
  { code: 'WIP', name: 'Work in progress', type: 'wip' },
  { code: 'DRY', name: 'Dry cabinet', type: 'dry_cabinet' },
  { code: 'FG', name: 'Finished goods', type: 'finished_goods' },
  { code: 'SCRAP', name: 'Scrap yard', type: 'scrap' },
  { code: 'CUST', name: 'Customer-owned material', type: 'customer_owned' },
];

export const WASTE_CATEGORIES = ['metal_swarf', 'metal_offcut', 'rejected_parts', 'metal_powder', 'e_waste', 'coolant_oil', 'solvent', 'packaging', 'other'] as const;

const qtyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,6})?$/, 'Must be a number with up to 6 decimals'));

const warehouseInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,16}$/, 'Up to 16 letters, digits or -'),
  name: z.string().trim().min(1).max(80),
  type: z.enum(WAREHOUSE_TYPES),
  parentId: z.string().uuid().nullable().optional(),
  plantId: z.string().uuid().nullable().optional(),
  availableForIssue: z.boolean().optional(),
});

const lineInput = z.object({
  itemId: z.string().uuid(),
  qty: qtyString,
  fromWarehouseId: z.string().uuid().nullable().optional(),
  toWarehouseId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  newBatchNo: z.string().trim().max(60).nullable().optional(),
  heatNo: z.string().trim().max(60).nullable().optional(),
  expiryDate: z.string().date().nullable().optional(),
  rate: qtyString.nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
  wasteCategory: z.enum(WASTE_CATEGORIES).nullable().optional(),
  poLineId: z.string().uuid().nullable().optional(),
});
const entryInput = z.object({
  purpose: z.enum(['receipt', 'issue', 'transfer', 'adjustment', 'return', 'scrap']),
  postingDate: z.string().date(),
  partyId: z.string().uuid().nullable().optional(),
  /** Goods receipt against this purchase order (slice 1b). */
  purchaseOrderId: z.string().uuid().nullable().optional(),
  /** Customer who owns the material on every line (decision 024); null = our own stock. */
  ownerPartyId: z.string().uuid().nullable().optional(),
  reference: z.string().trim().max(100).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(lineInput).min(1).max(500),
});

/** Inventory is per legal entity: every call needs an active entity (x-entity-id). */
function entityOf(ctx: TenantRequestContext): string {
  if (!ctx.tenant.activeEntityId) throw new BadRequestException('Select a legal entity first (inventory is kept per entity)');
  return ctx.tenant.activeEntityId;
}

@Controller()
export class InventoryController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
  ) {}

  // ---- Warehouses ----
  @Get('warehouses')
  @RequirePermission('inventory.warehouse.read')
  warehouses(@Ctx() ctx: TenantRequestContext) {
    return this.db.select().from(warehouse).where(eq(warehouse.entityId, entityOf(ctx))).orderBy(asc(warehouse.code));
  }

  @Post('warehouses')
  @RequirePermission('inventory.warehouse.create')
  async createWarehouse(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(warehouseInput, body);
    if (input.parentId) {
      const [p] = await this.db.select({ id: warehouse.id }).from(warehouse).where(and(eq(warehouse.id, input.parentId), eq(warehouse.entityId, entityId)));
      if (!p) throw new BadRequestException('Parent warehouse not found in this entity');
    }
    return this.db.transaction(async (tx) => {
      const [w] = await tx
        .insert(warehouse)
        .values({ ...input, availableForIssue: input.availableForIssue ?? !NOT_ISSUABLE.has(input.type), tenantId: ctx.tenant.tenantId, entityId })
        .onConflictDoNothing()
        .returning();
      if (!w) throw new ConflictException('A warehouse with this code exists in this entity');
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'warehouse.create', targetType: 'warehouse', targetId: w.id, after: w }, tx);
      return w;
    });
  }

  @Post('warehouses/standard')
  @RequirePermission('inventory.warehouse.create')
  async createStandard(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(warehouse)
        .values(STANDARD_WAREHOUSES.map((w) => ({ ...w, availableForIssue: !NOT_ISSUABLE.has(w.type), tenantId: ctx.tenant.tenantId, entityId })))
        .onConflictDoNothing()
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'warehouse.create_standard', targetType: 'warehouse', after: rows.map((r) => r.code) }, tx);
      return rows;
    });
  }

  @Patch('warehouses/:id')
  @RequirePermission('inventory.warehouse.update')
  async updateWarehouse(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), availableForIssue: z.boolean().optional(), isActive: z.boolean().optional() }), body);
    const [before] = await this.db.select().from(warehouse).where(and(eq(warehouse.id, id), eq(warehouse.entityId, entityId)));
    if (!before) throw new NotFoundException('Warehouse not found');
    return this.db.transaction(async (tx) => {
      const [after] = await tx.update(warehouse).set(input).where(eq(warehouse.id, id)).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'warehouse.update', targetType: 'warehouse', targetId: id, before, after }, tx);
      return after;
    });
  }

  // ---- Batches ----
  /** Batches of an item with their balance in this entity, oldest expiry first (FEFO order for pickers). */
  @Get('batches')
  @RequirePermission('inventory.batch.read')
  async batches(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { itemId, warehouseId, inStock, owner } = parse(
      z.object({
        itemId: z.string().uuid(),
        warehouseId: z.string().uuid().optional(),
        inStock: z.enum(['true', 'false']).optional(),
        /** "company" = our own stock, a party id = that customer's material; omit for all. */
        owner: z.union([z.literal('company'), z.string().uuid()]).optional(),
      }),
      query,
    );
    // Explicit aliases: drizzle renders columns unqualified inside sql``, which would bind "id" to stock_bin.
    const ownerFilter = owner === 'company' ? sql` and sb.owner_party_id is null` : owner ? sql` and sb.owner_party_id = ${owner}` : sql``;
    const whFilter = warehouseId ? sql` and sb.warehouse_id = ${warehouseId}${ownerFilter}` : ownerFilter;
    const rows = await this.db
      .select({
        batch,
        qty: sql<string>`coalesce((select sum(sb.qty) from stock_bin sb where sb.entity_id = ${entityId} and sb.item_id = ${itemId} and sb.batch_id = "batch"."id"${whFilter}), 0)`,
      })
      .from(batch)
      .where(and(eq(batch.tenantId, ctx.tenant.tenantId), eq(batch.itemId, itemId)))
      .orderBy(sql`${batch.expiryDate} asc nulls last`, asc(batch.createdAt));
    return rows.map((r) => ({ ...r.batch, qty: r.qty })).filter((r) => inStock !== 'true' || Dec.of(r.qty).gt(Dec.ZERO));
  }

  /** Decision 053: find a lot, serial or remnant by its number, heat or item code; quantity in this entity. */
  @Get('batches/search')
  @RequirePermission('inventory.batch.read')
  async searchBatches(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { q } = parse(z.object({ q: z.string().trim().max(60).optional() }), query);
    const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = await this.db.execute<Record<string, string | null>>(sql`
      select b.id, b.batch_no, b.heat_no, b.kind, b.created_at, i.id as item_id, i.code as item_code, i.name as item_name, u.code as uom_code,
             coalesce((select sum(sb.qty) from stock_bin sb where sb.entity_id = ${entityId} and sb.batch_id = b.id), 0)::text as qty
      from batch b join item i on i.id = b.item_id join uom u on u.id = i.stock_uom_id
      where b.tenant_id = ${ctx.tenant.tenantId}
        ${like ? sql`and (b.batch_no ilike ${like} or b.heat_no ilike ${like} or i.code ilike ${like})` : sql``}
      order by b.created_at desc, b.batch_no
      limit 100`);
    return rows.rows.map((r) => ({ id: r.id, batchNo: r.batch_no, heatNo: r.heat_no, kind: r.kind, createdAt: r.created_at, itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, uomCode: r.uom_code, qty: r.qty }));
  }

  /** Decision 053: one lot, serial or remnant — details, stock by warehouse here, and the quality records the caller may read. */
  @Get('batches/:id')
  @RequirePermission('inventory.batch.read')
  async batchDetail(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [b] = await this.db.execute<Record<string, string | null>>(sql`
      select b.*, i.code as item_code, i.name as item_name, i.tracking, u.code as uom_code, s.name as supplier_name, pb.batch_no as parent_batch_no
      from batch b join item i on i.id = b.item_id join uom u on u.id = i.stock_uom_id
      left join party s on s.id = b.supplier_id left join batch pb on pb.id = b.parent_batch_id
      where b.id = ${id} and b.tenant_id = ${ctx.tenant.tenantId}`).then((r) => r.rows);
    if (!b) throw new NotFoundException('Batch not found');
    const stock = await this.db.execute<Record<string, string | null>>(sql`
      select w.id as warehouse_id, w.code as warehouse_code, w.name as warehouse_name, w.type as warehouse_type, o.name as owner_name, sb.qty::text as qty
      from stock_bin sb join warehouse w on w.id = sb.warehouse_id left join party o on o.id = sb.owner_party_id
      where sb.entity_id = ${entityId} and sb.batch_id = ${id} and sb.qty <> 0
      order by w.code`);
    const can = (p: string) => ctx.tenant.permissions.has(p);
    const rows = async (q: SQL) => (await this.db.execute<Record<string, string | null>>(q)).rows;
    const inspections = can('quality.inspection.read')
      ? await rows(sql`
          select r.id, r.number, r.stage::text, r.status::text, r.outcome::text as result, r.qty::text as qty, r.created_at, 'record' as source from inspection_record r
          where r.entity_id = ${entityId} and r.batch_id = ${id} and r.status <> 'cancelled'
          union all
          select q.id, q.number, 'incoming', q.status::text, q.result::text, q.qty_inspected::text, q.created_at, 'receipt' from quality_inspection q
          where q.entity_id = ${entityId} and q.batch_id = ${id} and q.inspection_record_id is null and q.status <> 'cancelled'
          order by created_at desc`)
      : null;
    const ncrs = can('quality.ncr.read') ? await rows(sql`select id, number, status::text, qty::text as qty, description, created_at from ncr where entity_id = ${entityId} and batch_id = ${id} order by created_at desc`) : null;
    const fais = can('quality.fai.read') ? await rows(sql`select id, number, status::text, created_at from fai where entity_id = ${entityId} and batch_id = ${id} order by created_at desc`) : null;
    return {
      id: b.id,
      batchNo: b.batch_no,
      kind: b.kind,
      heatNo: b.heat_no,
      supplierBatchNo: b.supplier_batch_no,
      supplierName: b.supplier_name,
      mfgDate: b.mfg_date,
      expiryDate: b.expiry_date,
      lengthMm: b.length_mm,
      parentBatchId: b.parent_batch_id,
      parentBatchNo: b.parent_batch_no,
      createdAt: b.created_at,
      itemId: b.item_id,
      itemCode: b.item_code,
      itemName: b.item_name,
      tracking: b.tracking,
      uomCode: b.uom_code,
      stock: stock.rows.map((r) => ({ warehouseId: r.warehouse_id, warehouseCode: r.warehouse_code, warehouseName: r.warehouse_name, warehouseType: r.warehouse_type, ownerName: r.owner_name, qty: r.qty })),
      inspections: inspections?.map((r) => ({ id: r.id, number: r.number, stage: r.stage, status: r.status, result: r.result, qty: r.qty, source: r.source, createdAt: r.created_at })) ?? null,
      ncrs: ncrs?.map((r) => ({ id: r.id, number: r.number, status: r.status, qty: r.qty, description: r.description, createdAt: r.created_at })) ?? null,
      fais: fais?.map((r) => ({ id: r.id, number: r.number, status: r.status, createdAt: r.created_at })) ?? null,
    };
  }

  // ---- Remnants (decision 046) ----
  /** Cut part of a bar (batch) into a remnant piece with a length. Posts at once; cancel like any stock entry. */
  @Post('stock/cuts')
  @RequirePermission('inventory.stock_entry.submit')
  async cut(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(
      z.object({
        postingDate: z.string().date(),
        itemId: z.string().uuid(),
        warehouseId: z.string().uuid(),
        batchId: z.string().uuid(),
        qty: qtyString.refine((v) => Dec.of(v).gt('0'), 'Must be more than zero'),
        lengthMm: qtyString.refine((v) => Dec.of(v).gt('0'), 'Enter the remnant length'),
        remnantNo: z.string().trim().max(60).nullable().optional(),
        remarks: z.string().trim().max(500).nullable().optional(),
      }),
      body,
    );
    return this.db.transaction(async (tx) => {
      const [e] = await tx.insert(stockEntry).values({ tenantId: ctx.tenant.tenantId, entityId, purpose: 'cut', postingDate: input.postingDate, remarks: input.remarks ?? null, createdBy: ctx.user.id }).returning();
      await tx.insert(stockEntryLine).values({ entryId: e!.id, lineNo: 1, itemId: input.itemId, qty: input.qty, fromWarehouseId: input.warehouseId, batchId: input.batchId, newBatchNo: input.remnantNo ?? null, lengthMm: input.lengthMm });
      const posted = await this.posting.submitIn(tx, ctx, entityId, e!.id);
      const [line] = await tx.select({ remnantNo: stockEntryLine.newBatchNo, value: stockEntryLine.value }).from(stockEntryLine).where(eq(stockEntryLine.entryId, e!.id));
      return { ...posted, remnantNo: line!.remnantNo, value: line!.value };
    });
  }

  /** Remnant pieces in stock, longest first; filter by item, minimum length and warehouse. */
  @Get('stock/remnants')
  @RequirePermission('inventory.batch.read')
  async remnants(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const q = parse(z.object({ itemId: z.string().uuid().optional(), minLengthMm: qtyString.optional(), warehouseId: z.string().uuid().optional() }), query);
    const where: SQL[] = [eq(stockBin.entityId, entityId), eq(batch.kind, 'remnant'), gt(stockBin.qty, '0'), isNull(stockBin.ownerPartyId)];
    if (q.itemId) where.push(eq(stockBin.itemId, q.itemId));
    if (q.warehouseId) where.push(eq(stockBin.warehouseId, q.warehouseId));
    if (q.minLengthMm) where.push(sql`${batch.lengthMm} >= ${q.minLengthMm}`);
    const parent = sql<string | null>`(select p.batch_no from batch p where p.id = ${batch.parentBatchId})`;
    return this.db
      .select({ batchId: batch.id, batchNo: batch.batchNo, heatNo: batch.heatNo, lengthMm: batch.lengthMm, parentBatchNo: parent, itemId: item.id, itemCode: item.code, itemName: item.name, warehouseId: warehouse.id, warehouse: warehouse.name, qty: stockBin.qty, uom: uom.code })
      .from(stockBin)
      .innerJoin(batch, eq(batch.id, stockBin.batchId))
      .innerJoin(item, eq(item.id, stockBin.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .innerJoin(warehouse, eq(warehouse.id, stockBin.warehouseId))
      .where(and(...where))
      .orderBy(desc(batch.lengthMm))
      .limit(500);
  }

  // ---- Stock entries ----
  @Get('stock-entries')
  @RequirePermission('inventory.stock_entry.read')
  async entries(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { status, purpose, limit } = parse(
      z.object({
        status: z.enum(['draft', 'submitted', 'cancelled']).optional(),
        purpose: z.enum(['receipt', 'issue', 'transfer', 'adjustment', 'return', 'scrap', 'delivery']).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      }),
      query,
    );
    const where: SQL[] = [eq(stockEntry.entityId, entityId)];
    if (status) where.push(eq(stockEntry.status, status));
    if (purpose) where.push(eq(stockEntry.purpose, purpose));
    return this.db
      .select({
        id: stockEntry.id,
        number: stockEntry.number,
        purpose: stockEntry.purpose,
        status: stockEntry.status,
        postingDate: stockEntry.postingDate,
        reference: stockEntry.reference,
        partyName: party.name,
        createdByName: user.name,
        createdAt: stockEntry.createdAt,
        lineCount: sql<number>`(select count(*)::int from stock_entry_line l where l.entry_id = "stock_entry"."id")`,
        totalValue: sql<string>`(select coalesce(sum(l.value), 0) from stock_entry_line l where l.entry_id = "stock_entry"."id")`,
      })
      .from(stockEntry)
      .leftJoin(party, eq(party.id, stockEntry.partyId))
      .innerJoin(user, eq(user.id, stockEntry.createdBy))
      .where(and(...where))
      .orderBy(desc(stockEntry.createdAt))
      .limit(limit);
  }

  @Get('stock-entries/:id')
  @RequirePermission('inventory.stock_entry.read')
  async entry(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [e] = await this.db.select().from(stockEntry).where(and(eq(stockEntry.id, id), eq(stockEntry.entityId, entityId)));
    if (!e) throw new NotFoundException('Stock entry not found');
    const lines = await this.db
      .select({ line: stockEntryLine, itemCode: item.code, itemName: item.name, tracking: item.tracking, uomCode: uom.code, batchNo: batch.batchNo, batchHeatNo: batch.heatNo, ownerName: party.name })
      .from(stockEntryLine)
      .innerJoin(item, eq(item.id, stockEntryLine.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .leftJoin(batch, eq(batch.id, stockEntryLine.batchId))
      .leftJoin(party, eq(party.id, stockEntryLine.ownerPartyId))
      .where(eq(stockEntryLine.entryId, id))
      .orderBy(asc(stockEntryLine.lineNo));
    return {
      ...e,
      ownerPartyId: lines[0]?.line.ownerPartyId ?? null,
      ownerName: lines[0]?.ownerName ?? null,
      lines: lines.map((l) => ({ ...l.line, itemCode: l.itemCode, itemName: l.itemName, tracking: l.tracking, uomCode: l.uomCode, batchNo: l.batchNo ?? l.line.newBatchNo, heatNo: l.batchHeatNo ?? l.line.heatNo })),
    };
  }

  @Post('stock-entries')
  @RequirePermission('inventory.stock_entry.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(entryInput, body);
    await this.assertRefs(ctx, input);
    return this.db.transaction(async (tx) => {
      const { lines, ownerPartyId, ...header } = input;
      const [e] = await tx.insert(stockEntry).values({ ...header, tenantId: ctx.tenant.tenantId, entityId, createdBy: ctx.user.id }).returning();
      await tx.insert(stockEntryLine).values(lines.map((l, i) => ({ ...l, ownerPartyId: ownerPartyId ?? null, entryId: e!.id, lineNo: i + 1 })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'stock_entry.create', targetType: 'stock_entry', targetId: e!.id, after: input }, tx);
      return e;
    });
  }

  /** Replace a draft wholesale (header + lines). Submitted documents are immutable. */
  @Put('stock-entries/:id')
  @RequirePermission('inventory.stock_entry.create')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(entryInput, body);
    await this.assertRefs(ctx, input);
    return this.db.transaction(async (tx) => {
      const [e] = await tx.select().from(stockEntry).where(and(eq(stockEntry.id, id), eq(stockEntry.entityId, entityId))).for('update');
      if (!e) throw new NotFoundException('Stock entry not found');
      if (e.status !== 'draft') throw new ConflictException('Only drafts can be edited');
      const { lines, ownerPartyId, ...header } = input;
      await tx.update(stockEntry).set({ ...header, updatedAt: new Date() }).where(eq(stockEntry.id, id));
      await tx.delete(stockEntryLine).where(eq(stockEntryLine.entryId, id));
      await tx.insert(stockEntryLine).values(lines.map((l, i) => ({ ...l, ownerPartyId: ownerPartyId ?? null, entryId: id, lineNo: i + 1 })));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'stock_entry.update', targetType: 'stock_entry', targetId: id, after: input }, tx);
      return { ok: true };
    });
  }

  @Delete('stock-entries/:id')
  @RequirePermission('inventory.stock_entry.create')
  async remove(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      const [e] = await tx.delete(stockEntry).where(and(eq(stockEntry.id, id), eq(stockEntry.entityId, entityId), eq(stockEntry.status, 'draft'))).returning();
      if (!e) throw new ConflictException('Only drafts can be deleted; cancel submitted entries instead');
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'stock_entry.delete_draft', targetType: 'stock_entry', targetId: id }, tx);
      return { ok: true };
    });
  }

  @Post('stock-entries/:id/submit')
  @RequirePermission('inventory.stock_entry.submit')
  submit(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.posting.submit(ctx, entityOf(ctx), id);
  }

  @Post('stock-entries/:id/cancel')
  @RequirePermission('inventory.stock_entry.cancel')
  cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) }), body);
    return this.posting.cancel(ctx, entityOf(ctx), id, reason);
  }

  // ---- Reports ----
  /**
   * Stock balance by item × warehouse × batch with FIFO value. Value is held per item (and batch) at entity
   * level; per-warehouse value is allocated by quantity.
   */
  @Get('stock/balance')
  @RequirePermission('inventory.report.read')
  async balance(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { itemId, warehouseId, owner } = parse(
      z.object({ itemId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(), owner: z.union([z.literal('company'), z.literal('customers'), z.string().uuid()]).optional() }),
      query,
    );
    return stockBalance(this.db, { tenantId: ctx.tenant.tenantId, entityId }, { itemId, warehouseId, owner });
  }

  /** Movements of one item with a running balance (optionally per warehouse / date range). */
  @Get('stock/ledger')
  @RequirePermission('inventory.report.read')
  async ledger(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const q = parse(
      z.object({ itemId: z.string().uuid(), warehouseId: z.string().uuid().optional(), batchId: z.string().uuid().optional(), from: z.string().date().optional(), to: z.string().date().optional() }),
      query,
    );
    return stockLedger(this.db, { tenantId: ctx.tenant.tenantId, entityId }, q);
  }

  /** Items, warehouses, batches and parties on a document must belong to this tenant/entity. */
  private async assertRefs(ctx: TenantRequestContext, input: z.infer<typeof entryInput>) {
    const entityId = entityOf(ctx);
    const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
    const found = await this.db.select({ id: item.id }).from(item).where(and(eq(item.tenantId, ctx.tenant.tenantId), inArray(item.id, itemIds)));
    if (found.length !== itemIds.length) throw new BadRequestException('Unknown item on a line');
    const whIds = [...new Set(input.lines.flatMap((l) => [l.fromWarehouseId, l.toWarehouseId]).filter((x): x is string => !!x))];
    if (whIds.length) {
      const whs = await this.db.select({ id: warehouse.id }).from(warehouse).where(and(eq(warehouse.entityId, entityId), inArray(warehouse.id, whIds)));
      if (whs.length !== whIds.length) throw new BadRequestException('A warehouse on a line is not in this entity');
    }
    if (input.partyId) {
      const [p] = await this.db.select({ id: party.id }).from(party).where(and(eq(party.id, input.partyId), eq(party.tenantId, ctx.tenant.tenantId)));
      if (!p) throw new BadRequestException('Unknown party');
    }
    if (input.ownerPartyId) {
      const [o] = await this.db.select({ isCustomer: party.isCustomer }).from(party).where(and(eq(party.id, input.ownerPartyId), eq(party.tenantId, ctx.tenant.tenantId)));
      if (!o?.isCustomer) throw new BadRequestException({ message: 'The material owner must be a customer', issues: [{ path: 'ownerPartyId', message: 'Pick a customer' }] });
    }
    if (input.purpose === 'return' && (!input.ownerPartyId || input.partyId !== input.ownerPartyId)) {
      throw new BadRequestException({ message: "Returns send a customer's own material back to them", issues: [{ path: 'ownerPartyId', message: 'Owner and receiving customer must match' }] });
    }
    if (input.purchaseOrderId && (!input.partyId || input.purpose !== 'receipt')) {
      throw new BadRequestException({ message: 'A goods receipt against a PO needs the supplier', issues: [{ path: 'partyId', message: 'Choose the supplier' }] });
    }
    if (input.purpose === 'scrap' && input.lines.some((l) => !l.wasteCategory)) {
      throw new BadRequestException({ message: 'Each scrap line needs a waste category', issues: [{ path: 'lines', message: 'Choose a waste category' }] });
    }
  }
}

