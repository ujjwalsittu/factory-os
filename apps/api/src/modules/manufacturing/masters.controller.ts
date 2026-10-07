// Manufacturing masters (decision 044): work centres, machines and revisioned BOMs with operations.
import { Dec } from '@factoryos/core';
import { bom, bomMaterial, bomOperation, type Database, item, machine, uom, workCentre } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf, type Tx } from '../accounting/accounting-lock.js';

const decimal = (places: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(new RegExp(`^\\d+(\\.\\d{1,${places}})?$`), `A number with up to ${places} decimals`));
const positive = decimal(6).refine((v) => Dec.of(v).gt('0'), 'Must be more than zero');

const centreInput = z.object({
  code: z.string().trim().toUpperCase().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  hourlyRate: decimal(2),
  isActive: z.boolean().optional(),
});
const machineInput = z.object({
  code: z.string().trim().toUpperCase().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  isActive: z.boolean().optional(),
});
const bomInput = z.object({
  itemId: z.uuid(),
  revision: z.string().trim().toUpperCase().min(1).max(10),
  quantity: positive.default('1'),
  remarks: z.string().trim().max(2000).nullable().optional(),
  materials: z
    .array(z.object({ itemId: z.uuid(), qty: positive, backflush: z.boolean().default(false), remarks: z.string().trim().max(500).nullable().optional() }))
    .max(200),
  operations: z
    .array(
      z.object({
        seq: z.number().int().min(1).max(9999),
        name: z.string().trim().min(1).max(120),
        workCentreId: z.uuid(),
        setupMinutes: decimal(2).default('0'),
        runMinutesPerUnit: decimal(4).default('0'),
        instructions: z.string().trim().max(4000).nullable().optional(),
      }),
    )
    .max(100),
});
type BomInput = z.infer<typeof bomInput>;

@Controller('manufacturing')
export class ManufacturingMastersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  @Get('work-centres')
  @RequirePermission('manufacturing.work_centre.read')
  async centres(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const centres = await this.db.select().from(workCentre).where(eq(workCentre.entityId, entityId)).orderBy(asc(workCentre.code));
    const machines = await this.db.select().from(machine).where(eq(machine.entityId, entityId)).orderBy(asc(machine.code));
    return centres.map((c) => ({ ...c, machines: machines.filter((m) => m.workCentreId === c.id) }));
  }

  @Post('work-centres')
  @RequirePermission('manufacturing.work_centre.create')
  async createCentre(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(centreInput, body);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(workCentre)
        .values({ tenantId: ctx.tenant.tenantId, entityId, code: input.code, name: input.name, hourlyRate: input.hourlyRate, isActive: input.isActive ?? true, createdBy: ctx.user.id })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictException(`Work centre ${input.code} already exists`);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_centre.create', targetType: 'work_centre', targetId: row.id, after: input }, tx);
      return row;
    });
  }

  @Put('work-centres/:id')
  @RequirePermission('manufacturing.work_centre.update')
  async updateCentre(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(centreInput.omit({ code: true }), body);
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(workCentre).where(and(eq(workCentre.id, id), eq(workCentre.entityId, entityId))).for('update');
      if (!before) throw new NotFoundException('Work centre not found');
      // The new rate applies to job cards completed from now on; completed cards keep their snapshot.
      const [row] = await tx
        .update(workCentre)
        .set({ name: input.name, hourlyRate: input.hourlyRate, isActive: input.isActive ?? before.isActive, updatedAt: new Date() })
        .where(eq(workCentre.id, id))
        .returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_centre.update', targetType: 'work_centre', targetId: id, before: { name: before.name, hourlyRate: before.hourlyRate, isActive: before.isActive }, after: input }, tx);
      return row;
    });
  }

  @Post('work-centres/:id/machines')
  @RequirePermission('manufacturing.work_centre.update')
  async addMachine(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(machineInput, body);
    return this.db.transaction(async (tx) => {
      const [centre] = await tx.select().from(workCentre).where(and(eq(workCentre.id, id), eq(workCentre.entityId, entityId)));
      if (!centre) throw new NotFoundException('Work centre not found');
      const [row] = await tx
        .insert(machine)
        .values({ tenantId: ctx.tenant.tenantId, entityId, workCentreId: id, code: input.code, name: input.name, isActive: input.isActive ?? true, createdBy: ctx.user.id })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictException(`Machine ${input.code} already exists`);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'machine.create', targetType: 'machine', targetId: row.id, after: { ...input, workCentre: centre.code } }, tx);
      return row;
    });
  }

  @Put('machines/:id')
  @RequirePermission('manufacturing.work_centre.update')
  async updateMachine(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(machineInput.omit({ code: true }), body);
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(machine).where(and(eq(machine.id, id), eq(machine.entityId, entityId))).for('update');
      if (!before) throw new NotFoundException('Machine not found');
      const [row] = await tx.update(machine).set({ name: input.name, isActive: input.isActive ?? before.isActive, updatedAt: new Date() }).where(eq(machine.id, id)).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'machine.update', targetType: 'machine', targetId: id, before: { name: before.name, isActive: before.isActive }, after: input }, tx);
      return row;
    });
  }

  @Get('boms')
  @RequirePermission('manufacturing.bom.read')
  async boms(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { itemId, status } = parse(z.object({ itemId: z.uuid().optional(), status: z.enum(['draft', 'active', 'obsolete']).optional() }), query);
    const where = [eq(bom.entityId, entityId)];
    if (itemId) where.push(eq(bom.itemId, itemId));
    if (status) where.push(eq(bom.status, status));
    return this.db
      .select({
        id: bom.id,
        itemId: bom.itemId,
        itemCode: item.code,
        itemName: item.name,
        revision: bom.revision,
        quantity: bom.quantity,
        status: bom.status,
        isDefault: bom.isDefault,
        updatedAt: bom.updatedAt,
        materials: sql<number>`(select count(*)::int from bom_material m where m.bom_id = "bom"."id")`,
        operations: sql<number>`(select count(*)::int from bom_operation o where o.bom_id = "bom"."id")`,
      })
      .from(bom)
      .innerJoin(item, eq(item.id, bom.itemId))
      .where(and(...where))
      .orderBy(asc(item.code), desc(bom.createdAt))
      .limit(500);
  }

  @Get('boms/:id')
  @RequirePermission('manufacturing.bom.read')
  async getBom(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.loadBom(this.db, entityOf(ctx), id);
  }

  @Post('boms')
  @RequirePermission('manufacturing.bom.create')
  async createBom(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(bomInput, body);
    return this.db.transaction(async (tx) => {
      await this.validateBom(tx, ctx, entityId, input);
      const [row] = await tx
        .insert(bom)
        .values({ tenantId: ctx.tenant.tenantId, entityId, itemId: input.itemId, revision: input.revision, quantity: input.quantity, remarks: input.remarks ?? null, createdBy: ctx.user.id })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictException(`Revision ${input.revision} already exists for this item`);
      await this.writeLines(tx, row.id, input);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'bom.create', targetType: 'bom', targetId: row.id, after: { revision: input.revision } }, tx);
      return this.loadBom(tx, entityId, row.id);
    });
  }

  @Put('boms/:id')
  @RequirePermission('manufacturing.bom.update')
  async updateBom(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(bomInput, body);
    return this.db.transaction(async (tx) => {
      const before = await this.lockBom(tx, entityId, id);
      if (before.status !== 'draft') throw new ConflictException('Only draft BOMs can be edited; copy it to a new revision');
      if (input.itemId !== before.itemId) throw new BadRequestException('A BOM stays with its item');
      await this.validateBom(tx, ctx, entityId, input);
      const [clash] = await tx.select({ id: bom.id }).from(bom).where(and(eq(bom.entityId, entityId), eq(bom.itemId, before.itemId), eq(bom.revision, input.revision), ne(bom.id, id)));
      if (clash) throw new ConflictException(`Revision ${input.revision} already exists for this item`);
      await tx.update(bom).set({ revision: input.revision, quantity: input.quantity, remarks: input.remarks ?? null, updatedAt: new Date() }).where(eq(bom.id, id));
      await tx.delete(bomMaterial).where(eq(bomMaterial.bomId, id));
      await tx.delete(bomOperation).where(eq(bomOperation.bomId, id));
      await this.writeLines(tx, id, input);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'bom.update', targetType: 'bom', targetId: id, after: { revision: input.revision } }, tx);
      return this.loadBom(tx, entityId, id);
    });
  }

  /** Freezes the BOM. The first active revision of an item becomes its default. */
  @Post('boms/:id/activate')
  @RequirePermission('manufacturing.bom.submit')
  async activate(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { makeDefault } = parse(z.object({ makeDefault: z.boolean().optional() }), body ?? {});
    return this.db.transaction(async (tx) => {
      const b = await this.lockBom(tx, entityId, id);
      if (b.status !== 'draft') throw new ConflictException(`This BOM is already ${b.status}`);
      const full = await this.loadBom(tx, entityId, id);
      if (!full.materials.length && !full.operations.length) throw new BadRequestException('Add materials or operations before activating');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bom-default:${entityId}:${b.itemId}`}))`);
      const [current] = await tx.select({ id: bom.id }).from(bom).where(and(eq(bom.entityId, entityId), eq(bom.itemId, b.itemId), eq(bom.isDefault, true)));
      const asDefault = makeDefault || !current;
      if (asDefault && current) await tx.update(bom).set({ isDefault: false, updatedAt: new Date() }).where(eq(bom.id, current.id));
      await tx.update(bom).set({ status: 'active', isDefault: asDefault, activatedAt: new Date(), activatedBy: ctx.user.id, updatedAt: new Date() }).where(eq(bom.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'bom.activate', targetType: 'bom', targetId: id, after: { revision: b.revision, isDefault: asDefault } }, tx);
      return this.loadBom(tx, entityId, id);
    });
  }

  @Post('boms/:id/default')
  @RequirePermission('manufacturing.bom.submit')
  async makeDefault(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      const b = await this.lockBom(tx, entityId, id);
      if (b.status !== 'active') throw new ConflictException('Only an active BOM can be the default');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bom-default:${entityId}:${b.itemId}`}))`);
      await tx.update(bom).set({ isDefault: false, updatedAt: new Date() }).where(and(eq(bom.entityId, entityId), eq(bom.itemId, b.itemId), eq(bom.isDefault, true)));
      await tx.update(bom).set({ isDefault: true, updatedAt: new Date() }).where(eq(bom.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'bom.default', targetType: 'bom', targetId: id }, tx);
      return this.loadBom(tx, entityId, id);
    });
  }

  /** Obsolete BOMs can't be used for new work orders; released work orders keep their frozen copy. */
  @Post('boms/:id/obsolete')
  @RequirePermission('manufacturing.bom.cancel')
  async obsolete(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      const b = await this.lockBom(tx, entityId, id);
      if (b.status === 'obsolete') throw new ConflictException('This BOM is already obsolete');
      await tx.update(bom).set({ status: 'obsolete', isDefault: false, updatedAt: new Date() }).where(eq(bom.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'bom.obsolete', targetType: 'bom', targetId: id }, tx);
      return this.loadBom(tx, entityId, id);
    });
  }

  /** Engineering change: a new draft revision starting from this one. */
  @Post('boms/:id/copy')
  @RequirePermission('manufacturing.bom.create')
  async copy(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { revision } = parse(z.object({ revision: z.string().trim().toUpperCase().min(1).max(10) }), body);
    return this.db.transaction(async (tx) => {
      const from = await this.loadBom(tx, entityId, id);
      const [row] = await tx
        .insert(bom)
        .values({ tenantId: ctx.tenant.tenantId, entityId, itemId: from.itemId, revision, quantity: from.quantity, remarks: from.remarks, createdBy: ctx.user.id })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictException(`Revision ${revision} already exists for this item`);
      await this.writeLines(tx, row.id, {
        materials: from.materials.map((m) => ({ itemId: m.itemId, qty: m.qty, backflush: m.backflush, remarks: m.remarks })),
        operations: from.operations.map((o) => ({ seq: o.seq, name: o.name, workCentreId: o.workCentreId, setupMinutes: o.setupMinutes, runMinutesPerUnit: o.runMinutesPerUnit, instructions: o.instructions })),
      });
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'bom.copy', targetType: 'bom', targetId: row.id, after: { from: from.revision, revision } }, tx);
      return this.loadBom(tx, entityId, row.id);
    });
  }

  private async lockBom(tx: Tx, entityId: string, id: string) {
    const [b] = await tx.select().from(bom).where(and(eq(bom.id, id), eq(bom.entityId, entityId))).for('update');
    if (!b) throw new NotFoundException('BOM not found');
    return b;
  }

  private async validateBom(tx: Tx, ctx: TenantRequestContext, entityId: string, input: BomInput) {
    const ids = [input.itemId, ...input.materials.map((m) => m.itemId)];
    const items = new Map((await tx.select().from(item).where(and(inArray(item.id, ids), eq(item.tenantId, ctx.tenant.tenantId)))).map((i) => [i.id, i]));
    const parent = items.get(input.itemId);
    if (!parent) throw new BadRequestException('Unknown item');
    if (!parent.isStockItem) throw new BadRequestException(`${parent.code} is not a stock item`);
    if (parent.tracking === 'serial') throw new BadRequestException('Serial-tracked items are made from slice 2b');
    const seen = new Set<string>();
    input.materials.forEach((m, i) => {
      const it = items.get(m.itemId);
      if (!it) throw new BadRequestException(`Material ${i + 1}: unknown item`);
      if (m.itemId === input.itemId) throw new BadRequestException(`Material ${i + 1}: an item can't be made from itself`);
      if (!it.isStockItem) throw new BadRequestException(`Material ${i + 1}: ${it.code} is not a stock item`);
      if (it.tracking === 'serial') throw new BadRequestException(`Material ${i + 1}: serial-tracked materials arrive in slice 2b`);
      if (m.backflush && it.tracking !== 'none') throw new BadRequestException(`Material ${i + 1}: ${it.code} is batch-tracked; issue it by batch instead of backflushing`);
      if (seen.has(m.itemId)) throw new BadRequestException(`Material ${i + 1}: ${it.code} is listed twice; combine the quantities`);
      seen.add(m.itemId);
    });
    const seqs = new Set<number>();
    const centreIds = [...new Set(input.operations.map((o) => o.workCentreId))];
    const centres = new Map((centreIds.length ? await tx.select().from(workCentre).where(and(inArray(workCentre.id, centreIds), eq(workCentre.entityId, entityId))) : []).map((c) => [c.id, c]));
    input.operations.forEach((o) => {
      if (seqs.has(o.seq)) throw new BadRequestException(`Operation ${o.seq} is listed twice`);
      seqs.add(o.seq);
      const c = centres.get(o.workCentreId);
      if (!c) throw new BadRequestException(`Operation ${o.seq}: unknown work centre`);
      if (!c.isActive) throw new BadRequestException(`Operation ${o.seq}: work centre ${c.code} is inactive`);
    });
  }

  private async writeLines(tx: Tx, bomId: string, input: Pick<BomInput, 'materials' | 'operations'>) {
    if (input.materials.length)
      await tx.insert(bomMaterial).values(input.materials.map((m, i) => ({ bomId, lineNo: i + 1, itemId: m.itemId, qty: m.qty, backflush: m.backflush, remarks: m.remarks ?? null })));
    if (input.operations.length)
      await tx.insert(bomOperation).values(
        input.operations.map((o) => ({ bomId, seq: o.seq, name: o.name, workCentreId: o.workCentreId, setupMinutes: o.setupMinutes, runMinutesPerUnit: o.runMinutesPerUnit, instructions: o.instructions ?? null })),
      );
  }

  private async loadBom(db: Database | Tx, entityId: string, id: string) {
    const [row] = await db
      .select({ bom, itemCode: item.code, itemName: item.name, itemRevision: item.revision, uom: uom.code })
      .from(bom)
      .innerJoin(item, eq(item.id, bom.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .where(and(eq(bom.id, id), eq(bom.entityId, entityId)));
    if (!row) throw new NotFoundException('BOM not found');
    const materials = await db
      .select({ ...bomMaterialCols, itemCode: item.code, itemName: item.name, tracking: item.tracking, uom: uom.code })
      .from(bomMaterial)
      .innerJoin(item, eq(item.id, bomMaterial.itemId))
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .where(eq(bomMaterial.bomId, id))
      .orderBy(asc(bomMaterial.lineNo));
    const operations = await db
      .select({ ...bomOperationCols, workCentreCode: workCentre.code, workCentreName: workCentre.name, hourlyRate: workCentre.hourlyRate })
      .from(bomOperation)
      .innerJoin(workCentre, eq(workCentre.id, bomOperation.workCentreId))
      .where(eq(bomOperation.bomId, id))
      .orderBy(asc(bomOperation.seq));
    return { ...row.bom, itemCode: row.itemCode, itemName: row.itemName, itemRevision: row.itemRevision, uom: row.uom, materials, operations };
  }
}

const bomMaterialCols = {
  id: bomMaterial.id,
  lineNo: bomMaterial.lineNo,
  itemId: bomMaterial.itemId,
  qty: bomMaterial.qty,
  backflush: bomMaterial.backflush,
  remarks: bomMaterial.remarks,
};
const bomOperationCols = {
  id: bomOperation.id,
  seq: bomOperation.seq,
  name: bomOperation.name,
  workCentreId: bomOperation.workCentreId,
  setupMinutes: bomOperation.setupMinutes,
  runMinutesPerUnit: bomOperation.runMinutesPerUnit,
  instructions: bomOperation.instructions,
};
