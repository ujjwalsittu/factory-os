// Decision 066: Maintenance → plans, due list, orders and breakdowns, machine summary and reports.
import { type Database } from '@factoryos/db';
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf } from '../accounting/accounting-lock.js';
import { MaintenanceService } from './maintenance.service.js';

const decimal = z.string().trim().regex(/^-?\d+(\.\d{1,4})?$/, 'A number');
const positive = z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'A quantity').refine((v) => Number(v) > 0, 'More than zero');
const planItem = z.object({
  text: z.string().trim().min(2).max(300),
  unit: z.string().trim().max(20).nullable().optional(),
  min: decimal.nullable().optional(),
  max: decimal.nullable().optional(),
  spareItemId: z.uuid().nullable().optional(),
  spareQty: positive.nullable().optional(),
});
const planBody = {
  name: z.string().trim().min(2).max(120),
  instructions: z.string().trim().max(4000).nullable().optional(),
  everyDays: z.number().int().min(1).max(3650).nullable().optional(),
  everyRunHours: z.number().int().min(1).max(100000).nullable().optional(),
  leadDays: z.number().int().min(0).max(90).default(7),
  plannedMinutes: z.number().int().min(5).max(7 * 1440).default(60),
  lastDoneAt: z.iso.datetime({ offset: true }).nullable().optional(),
  items: z.array(planItem).max(100).default([]),
};
const planInput = z.object({ machineId: z.uuid(), ...planBody });
const planUpdate = z.object({ ...planBody, isActive: z.boolean().optional() });
const breakdownInput = z.object({ machineId: z.uuid(), symptom: z.string().trim().min(3).max(500), failedAt: z.iso.datetime({ offset: true }).nullable().optional() });
const scheduleInput = z.object({ start: z.iso.datetime({ offset: true }).nullable() });
const resultInput = z.object({ itemId: z.uuid(), reading: decimal.nullable().optional(), note: z.string().trim().max(500).nullable().optional() });
const labourInput = z.object({ minutes: z.number().int().min(1).max(24 * 60), technicianId: z.string().min(1).max(64).nullable().optional(), note: z.string().trim().max(300).nullable().optional() });
const sparesInput = z.object({ warehouseId: z.uuid(), lines: z.array(z.object({ itemId: z.uuid(), qty: positive, batchId: z.uuid().nullable().optional() })).min(1).max(50) });
const doneInput = z.object({ cause: z.string().trim().max(1000).nullable().optional(), action: z.string().trim().max(1000).nullable().optional() });
const reasonInput = z.object({ reason: z.string().trim().min(3).max(300) });
const periodInput = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });

@Controller('maintenance')
export class MaintenanceController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly mnt: MaintenanceService,
  ) {}

  // ── Plans and the due list ──

  @Get('plans')
  @RequirePermission('maintenance.plan.read')
  plans(@Ctx() ctx: TenantRequestContext, @Query('machineId') machineId?: string, @Query('all') all?: string) {
    return this.mnt.dueList(this.db, entityOf(ctx), machineId && z.uuid().safeParse(machineId).success ? machineId : undefined, all === '1');
  }

  @Post('plans')
  @RequirePermission('maintenance.plan.create')
  createPlan(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(planInput, body);
    return this.db.transaction((tx) => this.mnt.createPlan(tx, ctx, entityId, input));
  }

  @Get('plans/:id')
  @RequirePermission('maintenance.plan.read')
  plan(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.mnt.plan(this.db, entityOf(ctx), id);
  }

  @Put('plans/:id')
  @RequirePermission('maintenance.plan.update')
  updatePlan(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(planUpdate, body);
    return this.db.transaction((tx) => this.mnt.updatePlan(tx, ctx, entityId, id, input));
  }

  @Post('plans/:id/order')
  @RequirePermission('maintenance.order.create')
  openOrder(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => this.mnt.detail(tx, entityId, (await this.mnt.openPreventive(tx, ctx, entityId, id)).id));
  }

  @Post('due/generate')
  @RequirePermission('maintenance.order.create')
  generate(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => ({ created: (await this.mnt.generateDue(tx, ctx, entityId)).map((o) => ({ id: o.id, number: o.number, title: o.title })) }));
  }

  // ── Breakdowns and orders ──

  @Post('breakdowns')
  @RequirePermission('maintenance.breakdown.create')
  breakdown(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(breakdownInput, body);
    return this.db.transaction(async (tx) => {
      const o = await this.mnt.reportBreakdown(tx, ctx, entityId, input);
      return { id: o.id, number: o.number, machineId: o.machineId, failedAt: o.failedAt };
    });
  }

  @Get('orders')
  @RequirePermission('maintenance.order.read')
  orders(@Ctx() ctx: TenantRequestContext, @Query('status') status?: string, @Query('machineId') machineId?: string, @Query('kind') kind?: string) {
    const okStatus = ['open', 'in_progress', 'done', 'verified', 'cancelled'].includes(status ?? '') ? status : undefined;
    return this.mnt.list(this.db, entityOf(ctx), { ...(okStatus ? { status: okStatus } : {}), ...(machineId && z.uuid().safeParse(machineId).success ? { machineId } : {}), ...(kind ? { kind } : {}) });
  }

  @Get('orders/:id')
  @RequirePermission('maintenance.order.read')
  order(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.mnt.detail(this.db, entityOf(ctx), id);
  }

  @Post('orders/:id/schedule')
  @RequirePermission('maintenance.order.update')
  schedule(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(scheduleInput, body);
    return this.db.transaction((tx) => this.mnt.schedule(tx, ctx, entityId, id, input.start));
  }

  @Post('orders/:id/start')
  @RequirePermission('maintenance.order.update')
  start(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction((tx) => this.mnt.start(tx, ctx, entityId, id));
  }

  @Post('orders/:id/results')
  @RequirePermission('maintenance.order.update')
  result(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(resultInput, body);
    return this.db.transaction((tx) => this.mnt.result(tx, ctx, entityId, id, input));
  }

  @Post('orders/:id/labour')
  @RequirePermission('maintenance.order.update')
  labour(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(labourInput, body);
    return this.db.transaction((tx) => this.mnt.labour(tx, ctx, entityId, id, input));
  }

  @Post('orders/:id/spares')
  @RequirePermission('maintenance.order.update')
  spares(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(sparesInput, body);
    return this.db.transaction((tx) => this.mnt.issueSpares(tx, ctx, entityId, id, input));
  }

  @Post('orders/:id/spares/:entryId/cancel')
  @RequirePermission('maintenance.order.update')
  cancelSpares(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Param('entryId', ParseUUIDPipe) entryId: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(reasonInput, body);
    return this.db.transaction((tx) => this.mnt.cancelSpares(tx, ctx, entityId, id, entryId, input.reason));
  }

  @Post('orders/:id/done')
  @RequirePermission('maintenance.order.update')
  done(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(doneInput, body);
    return this.db.transaction((tx) => this.mnt.done(tx, ctx, entityId, id, input));
  }

  @Post('orders/:id/verify')
  @RequirePermission('maintenance.order.approve')
  verify(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction((tx) => this.mnt.verify(tx, ctx, entityId, id));
  }

  @Post('orders/:id/cancel')
  @RequirePermission('maintenance.order.cancel')
  cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(reasonInput, body);
    return this.db.transaction((tx) => this.mnt.cancel(tx, ctx, entityId, id, input.reason));
  }

  // ── Machines and reports ──

  @Get('machines/:id')
  @RequirePermission('maintenance.order.read')
  machine(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.mnt.machineSummary(this.db, entityOf(ctx), id);
  }

  @Get('reports')
  @RequirePermission('maintenance.order.read')
  report(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const q = parse(periodInput, query);
    const to = q.to ? new Date(`${q.to}T00:00:00+05:30`).getTime() + 86400_000 : Date.now();
    const from = q.from ? new Date(`${q.from}T00:00:00+05:30`).getTime() : to - 30 * 86400_000;
    return this.mnt.report(this.db, entityOf(ctx), new Date(from), new Date(to));
  }
}
