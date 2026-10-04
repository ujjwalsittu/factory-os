import { validateGstin } from '@factoryos/compliance-in';
import { type Database, gstRegistration, legalEntity, plant } from '@factoryos/db';
import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';
import { entityInput } from './tenancy.service.js';

const PROVIDERS = ['mock', 'nic_direct', 'masters_india', 'cleartax', 'iris', 'adaequare', 'cygnet', 'tera'] as const;

const addressInput = z.object({
  line1: z.string().trim().min(1),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(1),
  district: z.string().trim().optional(),
  stateCode: z.string().regex(/^\d{2}$/),
  pincode: z.string().regex(/^\d{6}$/, 'PIN code must be 6 digits'),
  country: z.string().default('IN'),
});

const gstInput = z.object({
  gstin: z.string(),
  type: z.enum(['regular', 'composition', 'sez_unit', 'sez_developer', 'isd', 'casual', 'non_resident']).default('regular'),
  tradeName: z.string().trim().optional(),
  address: addressInput.optional(),
  effectiveFrom: z.string().date().optional(),
  einvoiceApplicableFrom: z.string().date().nullable().optional(),
  irpProvider: z.enum(PROVIDERS).default('mock'),
  ewbProvider: z.enum(PROVIDERS).default('mock'),
  returnsProvider: z.enum(PROVIDERS).default('mock'),
  /** Letter of Undertaking for exports / SEZ supplies without IGST (decision 031). ARN is 15 characters. */
  lutArn: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{15}$/, 'LUT ARN is 15 letters and digits').nullable().optional(),
  lutValidFrom: z.string().date().nullable().optional(),
  lutValidTo: z.string().date().nullable().optional(),
});

const plantInput = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/),
  gstRegistrationId: z.string().uuid().nullable().optional(),
  address: addressInput.optional(),
});

@Controller()
export class EntitiesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  @Get('entities')
  @RequirePermission('settings.entity.read')
  async list(@Ctx() ctx: TenantRequestContext) {
    const { tenantId, entityIds } = ctx.tenant;
    const [entities, regs, plants] = await Promise.all([
      this.db.select().from(legalEntity).where(eq(legalEntity.tenantId, tenantId)).orderBy(asc(legalEntity.shortName)),
      this.db.select().from(gstRegistration).where(eq(gstRegistration.tenantId, tenantId)).orderBy(asc(gstRegistration.gstin)),
      this.db.select().from(plant).where(eq(plant.tenantId, tenantId)).orderBy(asc(plant.name)),
    ]);
    return entities
      .filter((e) => entityIds === null || entityIds.includes(e.id))
      .map((e) => ({
        ...e,
        gstRegistrations: regs.filter((r) => r.entityId === e.id),
        plants: plants.filter((p) => p.entityId === e.id),
      }));
  }

  @Post('entities')
  @RequirePermission('settings.entity.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const input = parse(entityInput, body);
    const tenantId = ctx.tenant.tenantId;
    if (input.parentEntityId) await this.getEntity({ ...ctx, tenant: { ...ctx.tenant, activeEntityId: null } }, input.parentEntityId);
    return this.db.transaction(async (tx) => {
      const [e] = await tx.insert(legalEntity).values({ ...input, tenantId }).returning();
      await this.audit.record(ctx, { tenantId, entityId: e!.id, action: 'entity.create', targetType: 'legal_entity', targetId: e!.id, after: e }, tx);
      return e;
    });
  }

  @Patch('entities/:id')
  @RequirePermission('settings.entity.update')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(entityInput.partial().extend({ isActive: z.boolean().optional() }), body);
    const tenantId = ctx.tenant.tenantId;
    const before = await this.getEntity(ctx, id);
    if (input.parentEntityId === id) throw new BadRequestException('An entity cannot be its own parent');
    if (input.parentEntityId) await this.getEntity({ ...ctx, tenant: { ...ctx.tenant, activeEntityId: null } }, input.parentEntityId);
    return this.db.transaction(async (tx) => {
      const [after] = await tx
        .update(legalEntity)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(legalEntity.id, id), eq(legalEntity.tenantId, tenantId)))
        .returning();
      await this.audit.record(ctx, { tenantId, entityId: id, action: 'entity.update', targetType: 'legal_entity', targetId: id, before, after }, tx);
      return after;
    });
  }

  @Post('entities/:id/gst-registrations')
  @RequirePermission('settings.entity.update')
  async addGst(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(gstInput, body);
    const tenantId = ctx.tenant.tenantId;
    const entity = await this.getEntity(ctx, id);
    const check = validateGstin(input.gstin);
    if (!check.valid) throw new BadRequestException({ message: 'Invalid GSTIN', issues: [{ path: 'gstin', message: check.reason }] });
    if (entity.pan && entity.pan !== check.pan) {
      throw new BadRequestException({ message: 'GSTIN does not belong to this entity', issues: [{ path: 'gstin', message: `PAN in GSTIN is ${check.pan}, entity PAN is ${entity.pan}` }] });
    }
    return this.db.transaction(async (tx) => {
      const [reg] = await tx
        .insert(gstRegistration)
        .values({ ...input, gstin: check.gstin, stateCode: check.stateCode, tenantId, entityId: id })
        .returning();
      await this.audit.record(ctx, { tenantId, entityId: id, action: 'gst_registration.create', targetType: 'gst_registration', targetId: reg!.id, after: reg }, tx);
      return reg;
    });
  }

  @Patch('gst-registrations/:id')
  @RequirePermission('settings.entity.update')
  async updateGst(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(gstInput.omit({ gstin: true }).partial(), body);
    const tenantId = ctx.tenant.tenantId;
    const [before] = await this.db.select().from(gstRegistration).where(and(eq(gstRegistration.id, id), eq(gstRegistration.tenantId, tenantId)));
    if (!before) throw new NotFoundException();
    await this.getEntity(ctx, before.entityId);
    return this.db.transaction(async (tx) => {
      const [after] = await tx.update(gstRegistration).set({ ...input, updatedAt: new Date() }).where(eq(gstRegistration.id, id)).returning();
      await this.audit.record(ctx, { tenantId, entityId: before.entityId, action: 'gst_registration.update', targetType: 'gst_registration', targetId: id, before, after }, tx);
      return after;
    });
  }

  @Post('entities/:id/plants')
  @RequirePermission('settings.entity.update')
  async addPlant(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(plantInput, body);
    const tenantId = ctx.tenant.tenantId;
    await this.getEntity(ctx, id);
    return this.db.transaction(async (tx) => {
      const [p] = await tx.insert(plant).values({ ...input, tenantId, entityId: id }).returning();
      await this.audit.record(ctx, { tenantId, entityId: id, action: 'plant.create', targetType: 'plant', targetId: p!.id, after: p }, tx);
      return p;
    });
  }

  /**
   * Loads an entity in this tenant; 404 if it doesn't exist or isn't visible to the caller.
   * Permissions were evaluated for the active entity (x-entity-id) or, without one, from
   * tenant-wide grants only. So with an active entity, the target must be that same entity.
   */
  private async getEntity(ctx: TenantRequestContext, id: string) {
    const { tenantId, entityIds, activeEntityId } = ctx.tenant;
    if ((entityIds !== null && !entityIds.includes(id)) || (activeEntityId !== null && activeEntityId !== id)) {
      throw new NotFoundException('Entity not found');
    }
    const [e] = await this.db.select().from(legalEntity).where(and(eq(legalEntity.id, id), eq(legalEntity.tenantId, tenantId)));
    if (!e) throw new NotFoundException('Entity not found');
    return e;
  }
}
