import { Dec } from '@factoryos/core';
import { batch, type Database, fifoLayer, item, party, stockBin, stockEntry, stockEntryLine, stockLedgerEntry, uom, user, warehouse } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';
import { StockPostingService } from './stock-posting.service.js';

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
    const where: SQL[] = [eq(stockBin.entityId, entityId), ne(stockBin.qty, '0')];
    if (itemId) where.push(eq(stockBin.itemId, itemId));
    if (warehouseId) where.push(eq(stockBin.warehouseId, warehouseId));
    if (owner === 'company') where.push(isNull(stockBin.ownerPartyId));
    else if (owner === 'customers') where.push(isNotNull(stockBin.ownerPartyId));
    else if (owner) where.push(eq(stockBin.ownerPartyId, owner));
    const rows = await this.db
      .select({
        itemId: stockBin.itemId,
        itemCode: item.code,
        itemName: item.name,
        uomCode: uom.code,
        reorderLevel: item.reorderLevel,
        warehouseId: stockBin.warehouseId,
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        warehouseType: warehouse.type,
        batchId: stockBin.batchId,
        batchNo: batch.batchNo,
        heatNo: batch.heatNo,
        expiryDate: batch.expiryDate,
        ownerPartyId: stockBin.ownerPartyId,
        ownerName: party.name,
        qty: stockBin.qty,
      })
      .from(stockBin)
      .innerJoin(item, eq(item.id, stockBin.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .innerJoin(warehouse, eq(warehouse.id, stockBin.warehouseId))
      .leftJoin(batch, eq(batch.id, stockBin.batchId))
      .leftJoin(party, eq(party.id, stockBin.ownerPartyId))
      .where(and(...where))
      .orderBy(asc(item.code), sql`${party.name} nulls first`, asc(warehouse.code), asc(batch.batchNo));

    // FIFO value per (item, batch) from open layers; allocate to warehouses by owned quantity.
    const itemIds = [...new Set(rows.map((r) => r.itemId))];
    const layers = itemIds.length
      ? await this.db
          .select({ itemId: fifoLayer.itemId, batchId: fifoLayer.batchId, qty: sql<string>`sum(${fifoLayer.qtyRemaining})`, value: sql<string>`sum(${fifoLayer.qtyRemaining} * ${fifoLayer.rate})` })
          .from(fifoLayer)
          .where(and(eq(fifoLayer.entityId, entityId), inArray(fifoLayer.itemId, itemIds), gt(fifoLayer.qtyRemaining, '0')))
          .groupBy(fifoLayer.itemId, fifoLayer.batchId)
      : [];
    const key = (i: string, b: string | null) => `${i}:${b ?? ''}`;
    const valued = new Map(layers.map((l) => [key(l.itemId, l.batchId), { qty: Dec.of(l.qty), value: Dec.of(l.value) }]));
    return rows.map((r) => {
      const v = valued.get(key(r.itemId, r.batchId));
      const owned = r.ownerPartyId === null;
      const value = owned && v && v.qty.gt(Dec.ZERO) ? v.value.mul(Dec.of(r.qty).div(v.qty)) : Dec.ZERO;
      return { ...r, ownership: owned ? 'company' : 'customer', value: value.toFixed(2) };
    });
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
    const where: SQL[] = [eq(stockLedgerEntry.entityId, entityId), eq(stockLedgerEntry.itemId, q.itemId)];
    if (q.warehouseId) where.push(eq(stockLedgerEntry.warehouseId, q.warehouseId));
    if (q.batchId) where.push(eq(stockLedgerEntry.batchId, q.batchId));
    if (q.to) where.push(lte(stockLedgerEntry.postingDate, q.to));
    const rows = await this.db
      .select({
        seq: stockLedgerEntry.seq,
        postingDate: stockLedgerEntry.postingDate,
        warehouseCode: warehouse.code,
        batchNo: batch.batchNo,
        heatNo: batch.heatNo,
        ownerName: party.name,
        qty: stockLedgerEntry.qty,
        rate: stockLedgerEntry.rate,
        value: stockLedgerEntry.value,
        isReversal: stockLedgerEntry.isReversal,
        voucherType: stockLedgerEntry.voucherType,
        voucherId: stockLedgerEntry.voucherId,
        voucherNumber: sql<string | null>`coalesce(${stockEntry.number}, (select v.number from landed_cost_voucher v where v.id = "stock_ledger_entry"."voucher_id"))`,
        purpose: stockEntry.purpose,
        balanceQty: sql<string>`sum(${stockLedgerEntry.qty}) over (order by ${stockLedgerEntry.postingDate}, ${stockLedgerEntry.seq})`,
        balanceValue: sql<string>`sum(${stockLedgerEntry.value}) over (order by ${stockLedgerEntry.postingDate}, ${stockLedgerEntry.seq})`,
      })
      .from(stockLedgerEntry)
      .innerJoin(warehouse, eq(warehouse.id, stockLedgerEntry.warehouseId))
      .leftJoin(batch, eq(batch.id, stockLedgerEntry.batchId))
      .leftJoin(stockEntry, eq(stockEntry.id, stockLedgerEntry.voucherId))
      .leftJoin(party, eq(party.id, stockLedgerEntry.ownerPartyId))
      .where(and(...where))
      .orderBy(asc(stockLedgerEntry.postingDate), asc(stockLedgerEntry.seq));
    // Running totals include earlier movements; the date filter only trims what's shown.
    return q.from ? rows.filter((r) => r.postingDate >= q.from!) : rows;
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

