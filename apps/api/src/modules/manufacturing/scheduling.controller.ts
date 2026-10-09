// Production schedule (decision 049): run, view, move and pin, unpin, and work order priority.
import { type Database, jobCard, machine, user, workOrder, workOrderOperation } from '@factoryos/db';
import { Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf } from '../accounting/accounting-lock.js';
import { SchedulingService } from './scheduling.service.js';

@Controller('manufacturing')
export class SchedulingController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly scheduling: SchedulingService,
  ) {}

  @Get('schedule')
  @RequirePermission('manufacturing.schedule.read')
  view(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const q = parse(z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() }), query);
    return this.scheduling.view(entityOf(ctx), q.from, q.to);
  }

  @Post('schedule/run')
  @RequirePermission('manufacturing.schedule.update')
  async run(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    await this.db.transaction((tx) => this.scheduling.runIn(tx, ctx, entityId));
    return this.scheduling.view(entityId);
  }

  @Post('schedule/move')
  @RequirePermission('manufacturing.schedule.update')
  async move(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(z.object({ operationId: z.uuid(), machineId: z.uuid(), start: z.iso.datetime({ offset: true }), runId: z.uuid() }), body);
    return this.db.transaction((tx) => this.scheduling.moveIn(tx, ctx, entityId, input));
  }

  @Post('schedule/:operationId/unpin')
  @RequirePermission('manufacturing.schedule.update')
  unpin(@Ctx() ctx: TenantRequestContext, @Param('operationId', ParseUUIDPipe) operationId: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction((tx) => this.scheduling.unpinIn(tx, ctx, entityId, operationId));
  }

  /** Job cards started ahead of their machine's dispatch order, with the reasons given. */
  @Get('schedule/out-of-sequence')
  @RequirePermission('manufacturing.schedule.read')
  outOfSequence(@Ctx() ctx: TenantRequestContext) {
    return this.db
      .select({ id: jobCard.id, reason: jobCard.outOfSequenceReason, startedAt: jobCard.createdAt, operator: user.name, machine: machine.code, number: workOrder.number, workOrderId: workOrder.id, seq: workOrderOperation.seq, operation: workOrderOperation.name })
      .from(jobCard)
      .innerJoin(workOrder, eq(workOrder.id, jobCard.workOrderId))
      .innerJoin(workOrderOperation, eq(workOrderOperation.id, jobCard.operationId))
      .innerJoin(user, eq(user.id, jobCard.operatorId))
      .leftJoin(machine, eq(machine.id, jobCard.machineId))
      .where(and(eq(jobCard.entityId, entityOf(ctx)), isNotNull(jobCard.outOfSequenceReason)))
      .orderBy(desc(jobCard.createdAt))
      .limit(200);
  }

  /** Priority changes at any time; the next run places the order accordingly. */
  @Post('work-orders/:id/priority')
  @RequirePermission('manufacturing.schedule.update')
  async priority(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { priority } = parse(z.object({ priority: z.number().int().min(1).max(5) }), body);
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(workOrder).where(and(eq(workOrder.id, id), eq(workOrder.entityId, entityId))).for('update');
      if (!before) throw new NotFoundException('Work order not found');
      const [row] = await tx.update(workOrder).set({ priority, updatedAt: new Date() }).where(eq(workOrder.id, id)).returning({ id: workOrder.id, priority: workOrder.priority });
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'work_order.priority', targetType: 'work_order', targetId: id, before: { priority: before.priority }, after: { priority } }, tx);
      return row;
    });
  }
}
