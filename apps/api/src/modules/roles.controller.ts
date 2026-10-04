import { isPermission, RESOURCES } from '@factoryos/auth';
import { auditEvent, type Database, role, roleAssignment } from '@factoryos/db';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { and, asc, count, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';

const roleInput = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(240).optional(),
  permissions: z.array(z.string()).refine((ps) => ps.every(isPermission), 'Unknown permission'),
});

@Controller()
export class RolesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** The permission catalog, grouped for the roles matrix. */
  @Get('permissions')
  @RequirePermission('settings.role.read')
  catalog() {
    return RESOURCES;
  }

  @Get('roles')
  @RequirePermission('settings.role.read')
  async list(@Ctx() ctx: TenantRequestContext) {
    const tenantId = ctx.tenant.tenantId;
    const roles = await this.db.select().from(role).where(eq(role.tenantId, tenantId)).orderBy(asc(role.name));
    const usage = await this.db
      .select({ roleId: roleAssignment.roleId, n: count() })
      .from(roleAssignment)
      .where(eq(roleAssignment.tenantId, tenantId))
      .groupBy(roleAssignment.roleId);
    return roles.map((r) => ({ ...r, isSystem: r.systemKey !== null, memberCount: usage.find((u) => u.roleId === r.id)?.n ?? 0 }));
  }

  @Post('roles')
  @RequirePermission('settings.role.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const input = parse(roleInput, body);
    const tenantId = ctx.tenant.tenantId;
    this.assertNoEscalation(ctx, input.permissions);
    return this.db.transaction(async (tx) => {
      const [r] = await tx.insert(role).values({ ...input, tenantId }).onConflictDoNothing().returning();
      if (!r) throw new ConflictException('A role with this name already exists');
      await this.audit.record(ctx, { tenantId, action: 'role.create', targetType: 'role', targetId: r.id, after: r }, tx);
      return r;
    });
  }

  @Patch('roles/:id')
  @RequirePermission('settings.role.update')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(roleInput.partial(), body);
    const before = await this.get(ctx.tenant.tenantId, id);
    if (before.systemKey) throw new ForbiddenException('System roles cannot be edited. Copy the role and edit the copy.');
    if (input.permissions) this.assertNoEscalation(ctx, input.permissions);
    return this.db.transaction(async (tx) => {
      const [after] = await tx.update(role).set({ ...input, updatedAt: new Date() }).where(eq(role.id, id)).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, action: 'role.update', targetType: 'role', targetId: id, before, after }, tx);
      return after;
    });
  }

  @Delete('roles/:id')
  @RequirePermission('settings.role.delete')
  async remove(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const before = await this.get(ctx.tenant.tenantId, id);
    if (before.systemKey) throw new ForbiddenException('System roles cannot be deleted');
    const [used] = await this.db.select({ n: count() }).from(roleAssignment).where(eq(roleAssignment.roleId, id));
    if ((used?.n ?? 0) > 0) throw new BadRequestException('Remove this role from all members first');
    return this.db.transaction(async (tx) => {
      await tx.delete(role).where(eq(role.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, action: 'role.delete', targetType: 'role', targetId: id, before }, tx);
      return { ok: true };
    });
  }

  @Get('audit')
  @RequirePermission('settings.audit.read')
  async auditLog(@Ctx() ctx: TenantRequestContext, @Query('before') before?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const cursor = Number(before);
    return this.db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.tenantId, ctx.tenant.tenantId), Number.isFinite(cursor) && cursor > 0 ? lt(auditEvent.seq, cursor) : undefined))
      .orderBy(desc(auditEvent.seq))
      .limit(n);
  }

  /** Non-owners can only grant permissions they hold themselves. */
  private assertNoEscalation(ctx: TenantRequestContext, permissions: string[]) {
    if (ctx.tenant.isOwner) return;
    const extra = permissions.filter((p) => !ctx.tenant.permissions.has(p));
    if (extra.length) throw new ForbiddenException(`You cannot grant permissions you don't have: ${extra.join(', ')}`);
  }

  private async get(tenantId: string, id: string) {
    const [r] = await this.db.select().from(role).where(and(eq(role.id, id), eq(role.tenantId, tenantId)));
    if (!r) throw new NotFoundException('Role not found');
    return r;
  }
}
