// Decision 065: Plant → Devices label printers (behind an edge) and their print jobs.
import { zplLabel } from '@factoryos/core';
import { type Database, iotEdge, labelPrinter, printJob } from '@factoryos/db';
import { Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf } from '../accounting/accounting-lock.js';
import { LabelService } from './labels.service.js';

const code = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot, dash or underscore');
const host = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.-]+$/, 'A host name or IPv4 address on the plant network');
const printerInput = z.object({
  edgeId: z.uuid(),
  code,
  name: z.string().trim().min(2).max(120),
  host,
  port: z.number().int().min(1).max(65535).default(9100),
  dpi: z.union([z.literal(203), z.literal(300), z.literal(600)]).default(203),
  widthMm: z.number().int().min(10).max(200),
  heightMm: z.number().int().min(5).max(300),
});
const printerUpdate = printerInput.omit({ edgeId: true, code: true });

@Controller('plant')
export class PrintersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly labels: LabelService,
  ) {}

  @Get('printers')
  @RequirePermission('manufacturing.smt.read')
  printers(@Ctx() ctx: TenantRequestContext) {
    return this.db
      .select({ p: labelPrinter, edgeCode: iotEdge.code })
      .from(labelPrinter)
      .innerJoin(iotEdge, eq(iotEdge.id, labelPrinter.edgeId))
      .where(eq(labelPrinter.entityId, entityOf(ctx)))
      .orderBy(asc(labelPrinter.code))
      .then((rows) => rows.map((r) => ({ ...r.p, edgeCode: r.edgeCode })));
  }

  @Post('printers')
  @RequirePermission('plant.device.manage')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(printerInput, body);
    return this.db.transaction(async (tx) => {
      const [e] = await tx.select({ status: iotEdge.status }).from(iotEdge).where(and(eq(iotEdge.id, input.edgeId), eq(iotEdge.entityId, entityId)));
      if (!e) throw new NotFoundException('Edge not found');
      if (e.status !== 'active') throw new ConflictException('The edge is revoked');
      const [dup] = await tx.select({ id: labelPrinter.id }).from(labelPrinter).where(and(eq(labelPrinter.entityId, entityId), eq(labelPrinter.code, input.code)));
      if (dup) throw new ConflictException({ message: `Printer ${input.code} already exists`, issues: [{ path: 'code', message: 'Already exists' }] });
      const [p] = await tx.insert(labelPrinter).values({ tenantId: ctx.tenant.tenantId, entityId, ...input, createdBy: ctx.user.id }).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'label_printer.create', targetType: 'label_printer', targetId: p!.id, after: input }, tx);
      return p!;
    });
  }

  @Put('printers/:id')
  @RequirePermission('plant.device.manage')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(printerUpdate, body);
    return this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(labelPrinter).where(and(eq(labelPrinter.id, id), eq(labelPrinter.entityId, entityId))).for('update');
      if (!p) throw new NotFoundException('Printer not found');
      if (p.status !== 'active') throw new ConflictException('A retired printer is fixed');
      const [after] = await tx.update(labelPrinter).set(input).where(eq(labelPrinter.id, id)).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'label_printer.update', targetType: 'label_printer', targetId: id, before: { host: p.host, port: p.port, dpi: p.dpi, widthMm: p.widthMm, heightMm: p.heightMm }, after: input }, tx);
      return after!;
    });
  }

  @Post('printers/:id/retire')
  @RequirePermission('plant.device.manage')
  async retire(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(labelPrinter).where(and(eq(labelPrinter.id, id), eq(labelPrinter.entityId, entityId))).for('update');
      if (!p) throw new NotFoundException('Printer not found');
      if (p.status !== 'active') throw new ConflictException('Already retired');
      await tx.update(labelPrinter).set({ status: 'retired' }).where(eq(labelPrinter.id, id));
      // Its waiting and in-flight jobs can't finish any more: the edge no longer claims a retired printer's jobs.
      await tx.update(printJob).set({ status: 'failed', leaseUntil: null, error: 'The printer was retired' }).where(and(eq(printJob.printerId, id), inArray(printJob.status, ['queued', 'sent'])));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'label_printer.retire', targetType: 'label_printer', targetId: id }, tx);
      return { ok: true };
    });
  }

  /** A test label, to check the printer, its size and the edge. */
  @Post('printers/:id/test')
  @RequirePermission('manufacturing.smt.update')
  test(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      const p = await this.labels.printer(tx, entityId, id);
      return this.labels.queue(tx, ctx, entityId, id, { kind: 'test', sourceId: null, label: `Test label ${p.code}`, render: (size) => zplLabel(`TEST-${p.code}`, [`Test ${p.code}`, `${size.widthMm} × ${size.heightMm} mm, ${size.dpi} dpi`], size) });
    });
  }

  @Get('print-jobs')
  @RequirePermission('manufacturing.smt.read')
  jobs(@Ctx() ctx: TenantRequestContext, @Query('status') status?: string) {
    const st = ['queued', 'sent', 'printed', 'failed'].includes(status ?? '') ? (status as 'queued') : undefined;
    return this.db
      .select({ id: printJob.id, kind: printJob.kind, sourceId: printJob.sourceId, label: printJob.label, status: printJob.status, attempts: printJob.attempts, error: printJob.error, createdAt: printJob.createdAt, printedAt: printJob.printedAt, printer: labelPrinter.code })
      .from(printJob)
      .innerJoin(labelPrinter, eq(labelPrinter.id, printJob.printerId))
      .where(and(eq(printJob.entityId, entityOf(ctx)), st ? eq(printJob.status, st) : undefined))
      .orderBy(desc(printJob.createdAt))
      .limit(100);
  }

  @Post('print-jobs/:id/reprint')
  @RequirePermission('manufacturing.smt.update')
  reprint(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction((tx) => this.labels.reprint(tx, ctx, entityId, id));
  }
}
