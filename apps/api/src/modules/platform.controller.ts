import { auditEvent, type Database, legalEntity, platformAdmin, tenant, user } from '@factoryos/db';
import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, PlatformAdmin, type RequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { CONFIG, DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';
import type { AppConfig } from '../config.js';
import { TenancyService } from './tenancy.service.js';

/** SuperAdmin console (docs/15 §4). Impersonation is planned, not built yet. */
@Controller('platform')
@PlatformAdmin()
export class PlatformController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
  ) {}

  @Get('overview')
  async overview() {
    const [[t], [u], [e]] = await Promise.all([
      this.db.select({ n: count() }).from(tenant),
      this.db.select({ n: count() }).from(user),
      this.db.select({ n: count() }).from(legalEntity),
    ]);
    return { tenants: t?.n ?? 0, users: u?.n ?? 0, entities: e?.n ?? 0 };
  }

  @Get('tenants')
  async tenants() {
    return this.db
      .select({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        plan: tenant.plan,
        featureFlags: tenant.featureFlags,
        createdAt: tenant.createdAt,
        members: sql<number>`(select count(*)::int from membership m where m.tenant_id = "tenant"."id")`,
        entities: sql<number>`(select count(*)::int from legal_entity e where e.tenant_id = "tenant"."id")`,
      })
      .from(tenant)
      .orderBy(asc(tenant.name));
  }

  /** Creates a tenant and an owner invitation. The owner completes setup themselves. */
  @Post('tenants')
  async createTenant(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const input = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        slug: z.string().trim().regex(/^[a-z0-9-]{2,40}$/).optional(),
        ownerEmail: z.string().email(),
      }),
      body,
    );
    const { tenant: t } = await this.tenancy.createTenant(ctx, { name: input.name, slug: input.slug });
    const [ownerRole] = await this.db.execute<{ id: string }>(
      sql`select id from role where tenant_id = ${t.id} and system_key = 'owner'`,
    ).then((r) => r.rows);
    const { token } = await this.db.transaction((tx) =>
      this.tenancy.createInvitation(tx, t.id, ctx.user.id, input.ownerEmail, [{ roleId: ownerRole!.id, entityIds: null }]),
    );
    await this.audit.record(ctx, { action: 'platform.tenant.create', targetType: 'tenant', targetId: t.id, after: { name: t.name, ownerEmail: input.ownerEmail } });
    return { tenant: t, ownerInviteUrl: `${this.config.WEB_ORIGIN}/invite/${token}` };
  }

  @Patch('tenants/:id')
  async updateTenant(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(
      z.object({
        status: z.enum(['active', 'suspended']).optional(),
        plan: z.string().trim().min(1).max(40).optional(),
        featureFlags: z.record(z.string(), z.boolean()).optional(),
        reason: z.string().trim().min(3).max(500),
      }),
      body,
    );
    const [before] = await this.db.select().from(tenant).where(eq(tenant.id, id));
    if (!before) throw new NotFoundException('Tenant not found');
    const { reason, ...changes } = input;
    const [after] = await this.db.update(tenant).set({ ...changes, updatedAt: new Date() }).where(eq(tenant.id, id)).returning();
    await this.audit.record(ctx, { action: 'platform.tenant.update', targetType: 'tenant', targetId: id, before, after, reason });
    // Also record in the tenant's own chain so its owners can see platform changes.
    await this.audit.record(ctx, { tenantId: id, action: 'platform.tenant.update', targetType: 'tenant', targetId: id, before, after, reason });
    return after;
  }

  @Get('admins')
  async admins() {
    return this.db
      .select({ userId: platformAdmin.userId, level: platformAdmin.level, name: user.name, email: user.email, createdAt: platformAdmin.createdAt })
      .from(platformAdmin)
      .innerJoin(user, eq(user.id, platformAdmin.userId))
      .orderBy(asc(user.email));
  }

  @Post('admins')
  async addAdmin(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const { email, level } = parse(z.object({ email: z.string().email(), level: z.enum(['superadmin', 'support']).default('superadmin') }), body);
    const [u] = await this.db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
    if (!u) throw new BadRequestException('That person must sign up first');
    await this.db.insert(platformAdmin).values({ userId: u.id, level }).onConflictDoUpdate({ target: platformAdmin.userId, set: { level } });
    await this.audit.record(ctx, { action: 'platform.admin.grant', targetType: 'user', targetId: u.id, after: { level } });
    return { ok: true };
  }

  @Delete('admins/:userId')
  async removeAdmin(@Ctx() ctx: RequestContext, @Param('userId') userId: string) {
    if (userId === ctx.user.id) throw new BadRequestException('You cannot remove yourself');
    const [{ n } = { n: 0 }] = await this.db.select({ n: count() }).from(platformAdmin).where(eq(platformAdmin.level, 'superadmin'));
    if (n <= 1) throw new BadRequestException('At least one SuperAdmin must remain');
    await this.db.delete(platformAdmin).where(eq(platformAdmin.userId, userId));
    await this.audit.record(ctx, { action: 'platform.admin.revoke', targetType: 'user', targetId: userId });
    return { ok: true };
  }

  @Get('audit')
  async auditLog() {
    return this.db.select().from(auditEvent).where(isNull(auditEvent.tenantId)).orderBy(desc(auditEvent.seq)).limit(100);
  }
}
