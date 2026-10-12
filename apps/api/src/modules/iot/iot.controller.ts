// Decision 063: Plant → Devices (edge agents and their keys, machine taps) and Plant → Machines (live states, timeline),
// plus the device-authenticated ingest the edge agent posts to.
import { type Database, iotDevice, iotEdge, machine, workCentre } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, UnauthorizedException } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, Public, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf } from '../accounting/accounting-lock.js';
import { IotService } from './iot.service.js';

const code = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot, dash or underscore');
const edgeInput = z.object({ code, name: z.string().trim().min(2).max(120) });
const deviceInput = z.object({ edgeId: z.uuid(), code, name: z.string().trim().min(2).max(120), machineId: z.uuid(), heartbeatSeconds: z.number().int().min(10).max(600).default(60) });
const deviceUpdate = z.object({ name: z.string().trim().min(2).max(120), machineId: z.uuid(), heartbeatSeconds: z.number().int().min(10).max(600) });
const tapConfigInput = z
  .object({
    offAmps: z.number().min(0).max(500),
    runAmps: z.number().min(0.1).max(500),
    ctAmpsPerVolt: z.number().min(1).max(1000),
    debounceSeconds: z.number().int().min(1).max(120),
    lights: z.object({ red: z.enum(['alarm', 'none']), amber: z.enum(['idle', 'setup', 'alarm', 'none']), green: z.enum(['running', 'none']) }),
  })
  .refine((c) => c.offAmps < c.runAmps, { message: 'The running threshold is above the off threshold', path: ['runAmps'] });
const statusInput = z.object({
  statuses: z
    .array(
      z.object({
        device: z.string().min(1).max(40),
        fwVersion: z.string().min(1).max(40),
        configVersion: z.number().int().nullable(),
        uptime: z.number().int().min(0),
        rssi: z.number().int().min(-127).max(0).nullable(),
        outbox: z.number().int().min(0),
        lastError: z.string().max(200).nullable(),
        at: z.string().min(10).max(40),
      }),
    )
    .min(1)
    .max(500),
});
const ingestInput = z.object({
  events: z
    .array(z.object({ device: z.string().min(1).max(40), seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), state: z.string().min(1).max(20), at: z.string().min(10).max(40) }))
    .min(1)
    .max(1000),
});
const istDayStart = () => {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600e3);
};

@Controller('plant')
export class PlantController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly iot: IotService,
  ) {}

  // ── Edge agents ──

  @Get('edges')
  @RequirePermission('plant.device.read')
  edges(@Ctx() ctx: TenantRequestContext) {
    return this.db
      .select({ id: iotEdge.id, code: iotEdge.code, name: iotEdge.name, status: iotEdge.status, keyPrefix: iotEdge.keyPrefix, rotatedAt: iotEdge.rotatedAt, lastSeenAt: iotEdge.lastSeenAt, createdAt: iotEdge.createdAt, revokedAt: iotEdge.revokedAt })
      .from(iotEdge)
      .where(eq(iotEdge.entityId, entityOf(ctx)))
      .orderBy(asc(iotEdge.code));
  }

  /** The key is returned once, here; only its hash is kept. */
  @Post('edges')
  @RequirePermission('plant.device.manage')
  async createEdge(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(edgeInput, body);
    const k = this.iot.newKey();
    return this.db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: iotEdge.id }).from(iotEdge).where(and(eq(iotEdge.entityId, entityId), eq(iotEdge.code, input.code)));
      if (dup) throw new ConflictException({ message: `Edge ${input.code} already exists`, issues: [{ path: 'code', message: 'Already used' }] });
      const [e] = await tx.insert(iotEdge).values({ tenantId: ctx.tenant.tenantId, entityId, ...input, keyPrefix: k.keyPrefix, keyHash: k.keyHash, createdBy: ctx.user.id }).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'iot_edge.create', targetType: 'iot_edge', targetId: e!.id, after: { ...input, keyPrefix: k.keyPrefix } }, tx);
      return { id: e!.id, code: e!.code, key: k.key };
    });
  }

  /** A new key; the old one stops working at once. */
  @Post('edges/:id/rotate')
  @RequirePermission('plant.device.manage')
  async rotate(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const k = this.iot.newKey();
    return this.db.transaction(async (tx) => {
      const [e] = await tx.select().from(iotEdge).where(and(eq(iotEdge.id, id), eq(iotEdge.entityId, entityId))).for('update');
      if (!e) throw new NotFoundException('Edge not found');
      if (e.status !== 'active') throw new ConflictException('A revoked edge stays revoked; add a new one');
      await tx.update(iotEdge).set({ keyPrefix: k.keyPrefix, keyHash: k.keyHash, rotatedAt: new Date() }).where(eq(iotEdge.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'iot_edge.rotate', targetType: 'iot_edge', targetId: id, before: { keyPrefix: e.keyPrefix }, after: { keyPrefix: k.keyPrefix } }, tx);
      return { id, code: e.code, key: k.key };
    });
  }

  @Post('edges/:id/revoke')
  @RequirePermission('plant.device.manage')
  async revoke(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      const [e] = await tx.select().from(iotEdge).where(and(eq(iotEdge.id, id), eq(iotEdge.entityId, entityId))).for('update');
      if (!e) throw new NotFoundException('Edge not found');
      if (e.status !== 'active') throw new ConflictException('Already revoked');
      await tx.update(iotEdge).set({ status: 'revoked', revokedAt: new Date() }).where(eq(iotEdge.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'iot_edge.revoke', targetType: 'iot_edge', targetId: id }, tx);
      return { ok: true };
    });
  }

  // ── Taps ──

  @Get('devices')
  @RequirePermission('plant.device.read')
  devices(@Ctx() ctx: TenantRequestContext) {
    return this.db
      .select({ d: iotDevice, edgeCode: iotEdge.code, machineCode: machine.code, machineName: machine.name })
      .from(iotDevice)
      .innerJoin(iotEdge, eq(iotEdge.id, iotDevice.edgeId))
      .innerJoin(machine, eq(machine.id, iotDevice.machineId))
      .where(eq(iotDevice.entityId, entityOf(ctx)))
      .orderBy(asc(iotDevice.code))
      .then((rows) => rows.map((r) => ({ ...r.d, edgeCode: r.edgeCode, machineCode: r.machineCode, machineName: r.machineName })));
  }

  @Post('devices')
  @RequirePermission('plant.device.create')
  async createDevice(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(deviceInput, body);
    return this.db.transaction(async (tx) => {
      const [e] = await tx.select({ status: iotEdge.status }).from(iotEdge).where(and(eq(iotEdge.id, input.edgeId), eq(iotEdge.entityId, entityId)));
      if (!e) throw new NotFoundException('Edge not found');
      if (e.status !== 'active') throw new ConflictException('The edge is revoked');
      await this.machineFree(tx, entityId, input.machineId);
      const [dup] = await tx.select({ id: iotDevice.id }).from(iotDevice).where(and(eq(iotDevice.entityId, entityId), eq(iotDevice.code, input.code)));
      if (dup) throw new ConflictException({ message: `Device ${input.code} already exists`, issues: [{ path: 'code', message: 'Already used' }] });
      const [d] = await tx.insert(iotDevice).values({ tenantId: ctx.tenant.tenantId, entityId, ...input }).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'iot_device.create', targetType: 'iot_device', targetId: d!.id, after: input }, tx);
      return d!;
    });
  }

  @Put('devices/:id')
  @RequirePermission('plant.device.update')
  async updateDevice(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(deviceUpdate, body);
    return this.db.transaction(async (tx) => {
      const [d] = await tx.select().from(iotDevice).where(and(eq(iotDevice.id, id), eq(iotDevice.entityId, entityId))).for('update');
      if (!d) throw new NotFoundException('Device not found');
      if (d.status !== 'active') throw new ConflictException('A retired device is fixed');
      if (input.machineId !== d.machineId) await this.machineFree(tx, entityId, input.machineId, id);
      const [after] = await tx.update(iotDevice).set({ ...input, configVersion: input.heartbeatSeconds === d.heartbeatSeconds ? d.configVersion : d.configVersion + 1 }).where(eq(iotDevice.id, id)).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'iot_device.update', targetType: 'iot_device', targetId: id, before: { name: d.name, machineId: d.machineId, heartbeatSeconds: d.heartbeatSeconds }, after: input }, tx);
      return after!;
    });
  }

  /** Decision 064: the tap's thresholds and stack-light meanings; each change raises the version the tap reports back. */
  @Put('devices/:id/config')
  @RequirePermission('plant.device.update')
  async config(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(tapConfigInput, body);
    return this.db.transaction(async (tx) => {
      const [d] = await tx.select().from(iotDevice).where(and(eq(iotDevice.id, id), eq(iotDevice.entityId, entityId))).for('update');
      if (!d) throw new NotFoundException('Device not found');
      if (d.status !== 'active') throw new ConflictException('A retired device is fixed');
      const [after] = await tx.update(iotDevice).set({ config: input, configVersion: d.configVersion + 1 }).where(eq(iotDevice.id, id)).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'iot_device.config', targetType: 'iot_device', targetId: id, before: { version: d.configVersion, config: d.config }, after: { version: after!.configVersion, config: input } }, tx);
      return after!;
    });
  }

  @Post('devices/:id/retire')
  @RequirePermission('plant.device.update')
  async retire(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    return this.db.transaction(async (tx) => {
      const [d] = await tx.select().from(iotDevice).where(and(eq(iotDevice.id, id), eq(iotDevice.entityId, entityId))).for('update');
      if (!d) throw new NotFoundException('Device not found');
      if (d.status !== 'active') throw new ConflictException('Already retired');
      await tx.update(iotDevice).set({ status: 'retired', retiredAt: new Date() }).where(eq(iotDevice.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'iot_device.retire', targetType: 'iot_device', targetId: id }, tx);
      return { ok: true };
    });
  }

  // ── Machine states ──

  /** Every active machine: its tap, last state, freshness and today's occupied minutes. */
  @Get('machines')
  @RequirePermission('plant.machine_state.read')
  async machines(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const rows = await this.db
      .select({ id: machine.id, code: machine.code, name: machine.name, workCentre: workCentre.name })
      .from(machine)
      .innerJoin(workCentre, eq(workCentre.id, machine.workCentreId))
      .where(and(eq(machine.entityId, entityId), eq(machine.isActive, true)))
      .orderBy(asc(workCentre.name), asc(machine.code));
    const taps = await this.db.select().from(iotDevice).where(and(eq(iotDevice.entityId, entityId), eq(iotDevice.status, 'active')));
    const now = new Date();
    const dayStart = istDayStart();
    return Promise.all(
      rows.map(async (m) => {
        const tap = taps.find((t) => t.machineId === m.id);
        if (!tap) return { ...m, device: null, state: null, lastSeenAt: null, stale: false, todayMinutes: null };
        const meter = await this.iot.meter(this.db, m.id, dayStart, now);
        const stale = !tap.lastSeenAt || now.getTime() - tap.lastSeenAt.getTime() > 3 * tap.heartbeatSeconds * 1000;
        return { ...m, device: { id: tap.id, code: tap.code }, state: stale ? null : tap.lastState, lastSeenAt: tap.lastSeenAt, stale, todayMinutes: meter?.minutes ?? 0 };
      }),
    );
  }

  @Get('machines/:id/timeline')
  @RequirePermission('plant.machine_state.read')
  async timeline(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const q = parse(z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() }), query);
    const [m] = await this.db.select({ id: machine.id, code: machine.code, name: machine.name }).from(machine).where(and(eq(machine.id, id), eq(machine.entityId, entityId)));
    if (!m) throw new NotFoundException('Machine not found');
    const from = q.from ? new Date(q.from) : istDayStart();
    const to = q.to ? new Date(q.to) : new Date();
    if (to <= from || to.getTime() - from.getTime() > 7 * 86400_000) throw new BadRequestException('Choose a window of up to 7 days');
    const meter = await this.iot.meter(this.db, id, from, to);
    return { machine: m, from, to, meter };
  }

  private async machineFree(tx: Parameters<Parameters<Database['transaction']>[0]>[0], entityId: string, machineId: string, except?: string) {
    const [m] = await tx.select({ id: machine.id }).from(machine).where(and(eq(machine.id, machineId), eq(machine.entityId, entityId)));
    if (!m) throw new NotFoundException('Machine not found');
    const [taken] = await tx
      .select({ code: iotDevice.code })
      .from(iotDevice)
      .where(and(eq(iotDevice.machineId, machineId), eq(iotDevice.status, 'active'), except ? ne(iotDevice.id, except) : undefined));
    if (taken) throw new ConflictException({ message: `Tap ${taken.code} already meters this machine; retire it first`, issues: [{ path: 'machineId', message: 'Already metered' }] });
  }
}

/** The edge agent's endpoint: no session, the edge key in `Authorization: Bearer`. */
@Controller('iot')
export class IngestController {
  constructor(private readonly iot: IotService) {}

  @Post('ingest')
  @Public()
  @HttpCode(200)
  async ingest(@Headers('authorization') auth: string | undefined, @Body() body: unknown) {
    const edge = await this.iot.edgeForKey(auth);
    if (!edge) throw new UnauthorizedException('Unknown or revoked edge key');
    this.iot.throttle(edge.id);
    const input = parse(ingestInput, body);
    const results = await this.iot.ingest(edge, input.events);
    return { results };
  }

  /** Decision 064: the configs the edge publishes to its taps (retained), with their versions. */
  @Get('config')
  @Public()
  async config(@Headers('authorization') auth: string | undefined) {
    const edge = await this.iot.edgeForKey(auth);
    if (!edge) throw new UnauthorizedException('Unknown or revoked edge key');
    this.iot.throttle(edge.id);
    return { taps: await this.iot.configs(edge) };
  }

  /** Decision 064: what the taps report (firmware, applied config, signal, outbox, last error); a result per tap. */
  @Post('status')
  @Public()
  @HttpCode(200)
  async status(@Headers('authorization') auth: string | undefined, @Body() body: unknown) {
    const edge = await this.iot.edgeForKey(auth);
    if (!edge) throw new UnauthorizedException('Unknown or revoked edge key');
    this.iot.throttle(edge.id);
    const input = parse(statusInput, body);
    return { results: await this.iot.status(edge, input.statuses) };
  }
}
