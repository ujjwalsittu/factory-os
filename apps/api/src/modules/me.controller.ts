import { type Database, legalEntity, membership, tenant } from '@factoryos/db';
import { Body, Controller, ForbiddenException, Get, Inject, Post } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, type RequestContext, TenantScoped, type TenantRequestContext } from '../common/access.js';
import type { AppConfig } from '../config.js';
import { CONFIG, DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';
import { entityInput, TenancyService } from './tenancy.service.js';

@Controller()
export class MeController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly tenancy: TenancyService,
  ) {}

  /** Who am I, which tenants can I open, am I a platform admin. */
  @Get('me')
  async me(@Ctx() ctx: RequestContext) {
    const tenants = await this.db
      .select({ id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, isOwner: membership.isOwner })
      .from(membership)
      .innerJoin(tenant, eq(tenant.id, membership.tenantId))
      .where(and(eq(membership.userId, ctx.user.id), eq(membership.status, 'active')))
      .orderBy(asc(tenant.name));
    return {
      user: ctx.user,
      platformAdmin: ctx.platformAdminLevel,
      tenants,
      canCreateTenant: this.config.ALLOW_SELF_SERVE_TENANTS || ctx.platformAdminLevel === 'superadmin',
    };
  }

  /** Context for one tenant: accessible entities and effective permissions (for the active entity, if any). */
  @Get('me/context')
  @TenantScoped()
  async context(@Ctx() ctx: TenantRequestContext) {
    const t = ctx.tenant;
    const where =
      t.entityIds === null
        ? eq(legalEntity.tenantId, t.tenantId)
        : and(eq(legalEntity.tenantId, t.tenantId), inArray(legalEntity.id, t.entityIds.length ? t.entityIds : ['00000000-0000-0000-0000-000000000000']));
    const entities = await this.db
      .select({ id: legalEntity.id, shortName: legalEntity.shortName, legalName: legalEntity.legalName, code: legalEntity.code, parentEntityId: legalEntity.parentEntityId })
      .from(legalEntity)
      .where(where)
      .orderBy(asc(legalEntity.shortName));
    return {
      tenantId: t.tenantId,
      isOwner: t.isOwner,
      /** False when the member only has entity-scoped roles: the UI must then pick an entity. */
      allEntities: t.entityIds === null,
      activeEntityId: t.activeEntityId,
      entities,
      permissions: [...t.permissions].sort(),
    };
  }

  /** Onboarding: create my first tenant and its first legal entity. */
  @Post('tenants')
  async createTenant(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    if (!this.config.ALLOW_SELF_SERVE_TENANTS && ctx.platformAdminLevel !== 'superadmin') {
      throw new ForbiddenException('Tenant creation is restricted to platform administrators');
    }
    const input = parse(z.object({ name: z.string().trim().min(2).max(120), entity: entityInput }), body);
    const { tenant: t, entity } = await this.tenancy.createTenant(ctx, { name: input.name, ownerUserId: ctx.user.id, entity: input.entity });
    return { tenant: t, entity };
  }
}
