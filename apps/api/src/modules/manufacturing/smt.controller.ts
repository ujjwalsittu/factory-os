// Decision 065: Manufacturing → SMT line. Reels and paste jars, feeder setup, panel scans, board labels and the trace.
import { boardLabel, containerLabel, panelLabel } from '@factoryos/core';
import { bom, type Database, item, smtBoard, smtContainer, smtPanel, uom, workOrder } from '@factoryos/db';
import { Body, Controller, Get, Header, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf } from '../accounting/accounting-lock.js';
import { DEFAULT_LABEL, LabelService } from '../iot/labels.service.js';
import { SmtService } from './smt.service.js';

const scan = z.string().trim().min(1).max(80);
const slot = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9._/-]+$/, 'Letters, digits, dot, dash, slash or underscore');
const containerInput = z.object({
  kind: z.enum(['reel', 'paste']),
  batchId: z.uuid(),
  qty: z.string().regex(/^\d+(\.\d{1,4})?$/, 'A quantity').refine((v) => Number(v) > 0, 'More than zero'),
  code: scan.nullable().optional(),
  warehouseId: z.uuid().nullable().optional(),
  labelHours: z.number().int().min(1).max(10000).nullable().optional(),
  printerId: z.uuid().nullable().optional(),
});
const eventInput = z.object({ kind: z.string().trim().min(1).max(20), note: z.string().trim().max(200).nullable().optional() });
const loadInput = z.object({ workOrderId: z.uuid(), machineId: z.uuid(), slot, code: scan, splice: z.boolean().optional() });
const unloadInput = z.object({ workOrderId: z.uuid(), machineId: z.uuid(), slot });
const panelsInput = z.object({ count: z.number().int().min(1).max(200), printerId: z.uuid().nullable().optional() });
const panelScanInput = z.object({ code: scan, step: z.enum(['placed', 'depaneled']), machineId: z.uuid().nullable().optional(), printerId: z.uuid().nullable().optional() });
const scrapInput = z.object({ serial: scan, reason: z.string().trim().min(3).max(300), workOrderId: z.uuid().nullable().optional() });
const printInput = z.object({ printerId: z.uuid() });

@Controller('manufacturing/smt')
export class SmtController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly smt: SmtService,
    private readonly labels: LabelService,
  ) {}

  // ── Reels and paste jars ──

  @Get('containers')
  @RequirePermission('manufacturing.smt.read')
  containers(@Ctx() ctx: TenantRequestContext, @Query('q') q?: string, @Query('all') all?: string) {
    return this.smt.list(this.db, entityOf(ctx), { q: q?.trim() || undefined, includeEmpty: all === '1' });
  }

  @Post('containers')
  @RequirePermission('manufacturing.smt.create')
  create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(containerInput, body);
    return this.db.transaction((tx) => this.smt.createContainer(tx, ctx, entityId, input));
  }

  @Get('containers/:id')
  @RequirePermission('manufacturing.smt.read')
  async container(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const c = await this.smt.containerById(this.db, entityId, id);
    return { ...(await this.smt.describe(this.db, c)), boards: await this.smt.boardsOf(this.db, entityId, { containerId: c.id }) };
  }

  @Post('containers/:id/events')
  @RequirePermission('manufacturing.smt.update')
  event(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(eventInput, body);
    return this.db.transaction((tx) => this.smt.event(tx, ctx, entityId, id, input.kind, input.note ?? null));
  }

  @Post('containers/:id/print')
  @RequirePermission('manufacturing.smt.update')
  printContainer(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(printInput, body);
    return this.db.transaction(async (tx) => this.smt.printContainer(tx, ctx, entityId, await this.smt.containerById(tx, entityId, id), input.printerId));
  }

  // ── Feeder setup ──

  @Get('work-orders/:id')
  @RequirePermission('manufacturing.smt.read')
  setup(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.smt.setup(this.db, entityOf(ctx), id);
  }

  @Post('feeder/load')
  @RequirePermission('manufacturing.smt.update')
  load(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(loadInput, body);
    return this.db.transaction((tx) => this.smt.load(tx, ctx, entityId, input));
  }

  @Post('feeder/unload')
  @RequirePermission('manufacturing.smt.update')
  unload(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(unloadInput, body);
    return this.db.transaction((tx) => this.smt.unload(tx, ctx, entityId, input));
  }

  // ── Panels and boards ──

  @Post('work-orders/:id/panels')
  @RequirePermission('manufacturing.smt.update')
  panels(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(panelsInput, body);
    return this.db.transaction((tx) => this.smt.printPanels(tx, ctx, entityId, id, input.count, input.printerId ?? null));
  }

  @Post('panels/scan')
  @RequirePermission('manufacturing.smt.update')
  scanPanel(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(panelScanInput, body);
    return this.db.transaction((tx) => this.smt.scanPanel(tx, ctx, entityId, input));
  }

  @Post('panels/:id/print-boards')
  @RequirePermission('manufacturing.smt.update')
  printBoards(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(printInput, body);
    return this.db.transaction((tx) => this.smt.printBoards(tx, ctx, entityId, id, input.printerId));
  }

  @Post('boards/scrap')
  @RequirePermission('manufacturing.smt.update')
  scrap(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(scrapInput, body);
    return this.db.transaction((tx) => this.smt.scrapBoard(tx, ctx, entityId, input.serial, input.reason, input.workOrderId ?? null));
  }

  // ── Scans and trace ──

  @Get('resolve')
  @RequirePermission('manufacturing.smt.read')
  resolve(@Ctx() ctx: TenantRequestContext, @Query('code') code = '') {
    return this.smt.resolve(this.db, entityOf(ctx), code);
  }

  @Get('boards/:serial')
  @RequirePermission('manufacturing.smt.read')
  board(@Ctx() ctx: TenantRequestContext, @Param('serial') serial: string) {
    return this.smt.boardTraceBySerial(this.db, entityOf(ctx), serial);
  }

  /** The SMT section of a batch page: the board trace for a serial, or the boards built from a component lot. */
  @Get('batches/:id')
  @RequirePermission('manufacturing.smt.read')
  async batchTrace(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const board = await this.smt.boardTrace(this.db, entityId, id);
    const containers = await this.db.select({ id: smtContainer.id, code: smtContainer.code, kind: smtContainer.kind }).from(smtContainer).where(and(eq(smtContainer.entityId, entityId), eq(smtContainer.batchId, id))).orderBy(asc(smtContainer.code));
    const boards = containers.length ? await this.smt.boardsOf(this.db, entityId, { batchId: id }) : [];
    return { board, containers, boards };
  }

  // ── ZPL downloads (for a printer the edge can't reach) ──

  @Get('labels/:kind/:id')
  @RequirePermission('manufacturing.smt.read')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async zpl(@Ctx() ctx: TenantRequestContext, @Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Query('printerId') printerId?: string) {
    const entityId = entityOf(ctx);
    const size = printerId ? (await this.labels.printer(this.db, entityId, printerId)).size : DEFAULT_LABEL;
    if (kind === 'container') {
      const c = await this.smt.containerById(this.db, entityId, id);
      const d = await this.smt.describe(this.db, c);
      const [u] = await this.db.select({ code: uom.code }).from(item).innerJoin(uom, eq(uom.id, item.stockUomId)).where(eq(item.id, c.itemId));
      return containerLabel({ code: c.code, item: d.itemCode, lot: d.batchNo, qty: c.qty, uom: u?.code ?? '', note: c.kind === 'paste' ? 'Solder paste' : d.mslLevel ? `MSL ${d.mslLevel}` : null }, size);
    }
    const [p] = await this.db.select().from(smtPanel).where(and(eq(smtPanel.id, id), eq(smtPanel.entityId, entityId)));
    if (!p || (kind !== 'panel' && kind !== 'boards')) throw new NotFoundException('Label not found');
    const [wo] = await this.db.select().from(workOrder).where(eq(workOrder.id, p.workOrderId));
    const [it] = await this.db.select().from(item).where(eq(item.id, wo!.itemId));
    const [b] = wo!.bomId ? await this.db.select().from(bom).where(eq(bom.id, wo!.bomId)) : [];
    const boards = await this.db.select().from(smtBoard).where(and(eq(smtBoard.panelId, p.id), kind === 'boards' ? isNull(smtBoard.scrappedAt) : undefined)).orderBy(asc(smtBoard.position));
    if (kind === 'panel') return panelLabel({ code: p.code, workOrder: wo!.number!, item: it!.code, revision: b?.revision ?? it!.revision, boards: boards.length }, size);
    return boards.map((bd) => boardLabel({ serial: bd.serialNo, item: it!.code, revision: b?.revision ?? it!.revision }, size)).join('\n');
  }
}
