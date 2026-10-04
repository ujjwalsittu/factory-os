import { type Database, invitation, legalEntity, membership, role, roleAssignment, tenant, user } from '@factoryos/db';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  GoneException,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, Public, type RequestContext, RequirePermission, type TenantRequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { CONFIG, DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';
import type { AppConfig } from '../config.js';
import { hashToken, TenancyService } from './tenancy.service.js';

const assignmentsInput = z
  .array(z.object({ roleId: z.string().uuid(), entityIds: z.array(z.string().uuid()).min(1).nullable() }))
  .max(50);

@Controller()
export class MembersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
  ) {}

  @Get('members')
  @RequirePermission('settings.user.read')
  async list(@Ctx() ctx: TenantRequestContext) {
    const tenantId = ctx.tenant.tenantId;
    const members = await this.db
      .select({
        id: membership.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        twoFactorEnabled: user.twoFactorEnabled,
        status: membership.status,
        isOwner: membership.isOwner,
        createdAt: membership.createdAt,
      })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(eq(membership.tenantId, tenantId))
      .orderBy(asc(user.name));
    const assignments = await this.db
      .select({ membershipId: roleAssignment.membershipId, roleId: role.id, roleName: role.name, entityIds: roleAssignment.entityIds })
      .from(roleAssignment)
      .innerJoin(role, eq(role.id, roleAssignment.roleId))
      .where(eq(roleAssignment.tenantId, tenantId));
    return members.map((m) => ({ ...m, roles: assignments.filter((a) => a.membershipId === m.id) }));
  }

  @Put('members/:id/roles')
  @RequirePermission('settings.user.update')
  async setRoles(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const tenantId = ctx.tenant.tenantId;
    const assignments = parse(assignmentsInput, body);
    const [m] = await this.db.select().from(membership).where(and(eq(membership.id, id), eq(membership.tenantId, tenantId)));
    if (!m) throw new NotFoundException('Member not found');
    if (m.isOwner && !ctx.tenant.isOwner) throw new ForbiddenException('Only an owner can change another owner');
    await this.assertAssignable(ctx, assignments);
    const before = await this.db.select().from(roleAssignment).where(eq(roleAssignment.membershipId, id));
    return this.db.transaction(async (tx) => {
      await tx.delete(roleAssignment).where(eq(roleAssignment.membershipId, id));
      if (assignments.length) {
        await tx.insert(roleAssignment).values(assignments.map((a) => ({ tenantId, membershipId: id, roleId: a.roleId, entityIds: a.entityIds })));
      }
      await this.audit.record(ctx, { tenantId, action: 'member.roles.set', targetType: 'membership', targetId: id, before, after: assignments }, tx);
      return { ok: true };
    });
  }

  @Patch('members/:id')
  @RequirePermission('settings.user.update')
  async setStatus(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const tenantId = ctx.tenant.tenantId;
    const { status } = parse(z.object({ status: z.enum(['active', 'disabled']) }), body);
    const [m] = await this.db.select().from(membership).where(and(eq(membership.id, id), eq(membership.tenantId, tenantId)));
    if (!m) throw new NotFoundException('Member not found');
    if (m.isOwner) throw new ForbiddenException('Owners cannot be disabled');
    if (m.userId === ctx.user.id) throw new ForbiddenException('You cannot disable yourself');
    return this.db.transaction(async (tx) => {
      await tx.update(membership).set({ status }).where(eq(membership.id, id));
      await this.audit.record(ctx, { tenantId, action: 'member.status', targetType: 'membership', targetId: id, before: { status: m.status }, after: { status } }, tx);
      return { ok: true };
    });
  }

  @Get('invitations')
  @RequirePermission('settings.user.read')
  async invitations(@Ctx() ctx: TenantRequestContext) {
    return this.db
      .select({ id: invitation.id, email: invitation.email, status: invitation.status, roles: invitation.roles, expiresAt: invitation.expiresAt, createdAt: invitation.createdAt })
      .from(invitation)
      .where(eq(invitation.tenantId, ctx.tenant.tenantId))
      .orderBy(desc(invitation.createdAt));
  }

  @Post('invitations')
  @RequirePermission('settings.user.create')
  async invite(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const tenantId = ctx.tenant.tenantId;
    const input = parse(z.object({ email: z.string().email(), roles: assignmentsInput.min(1) }), body);
    await this.assertAssignable(ctx, input.roles);
    const [already] = await this.db
      .select({ id: membership.id })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(and(eq(membership.tenantId, tenantId), eq(user.email, input.email.toLowerCase())));
    if (already) throw new BadRequestException('This person is already a member');
    return this.db.transaction(async (tx) => {
      const { invitation: inv, token } = await this.tenancy.createInvitation(tx, tenantId, ctx.user.id, input.email, input.roles);
      await this.audit.record(ctx, { tenantId, action: 'invitation.create', targetType: 'invitation', targetId: inv.id, after: { email: inv.email, roles: inv.roles } }, tx);
      // TODO(phase-1): email the link. Until the mail service exists the admin copies it from the UI.
      return { id: inv.id, email: inv.email, inviteUrl: `${this.config.WEB_ORIGIN}/invite/${token}` };
    });
  }

  @Delete('invitations/:id')
  @RequirePermission('settings.user.delete')
  async revoke(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = ctx.tenant.tenantId;
    return this.db.transaction(async (tx) => {
      const [inv] = await tx
        .update(invitation)
        .set({ status: 'revoked' })
        .where(and(eq(invitation.id, id), eq(invitation.tenantId, tenantId), eq(invitation.status, 'pending')))
        .returning();
      if (!inv) throw new NotFoundException('No pending invitation');
      await this.audit.record(ctx, { tenantId, action: 'invitation.revoke', targetType: 'invitation', targetId: id }, tx);
      return { ok: true };
    });
  }

  /** Shown on the invite page before sign-in. Reveals only tenant name and invited email. */
  @Get('invitations/lookup/:token')
  @Public()
  async lookup(@Param('token') token: string) {
    const inv = await this.findPending(token);
    const [t] = await this.db.select({ name: tenant.name }).from(tenant).where(eq(tenant.id, inv.tenantId));
    return { tenantName: t?.name ?? '', email: inv.email, expiresAt: inv.expiresAt };
  }

  @Post('invitations/accept')
  async accept(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const { token } = parse(z.object({ token: z.string().min(10) }), body);
    const inv = await this.findPending(token);
    if (inv.email !== ctx.user.email.toLowerCase()) {
      throw new ForbiddenException(`This invitation is for ${inv.email}. Sign in with that email to accept it.`);
    }
    return this.db.transaction(async (tx) => {
      const [m] = await tx
        .insert(membership)
        .values({ tenantId: inv.tenantId, userId: ctx.user.id })
        .onConflictDoUpdate({ target: [membership.tenantId, membership.userId], set: { status: 'active' } })
        .returning();
      await tx.insert(roleAssignment).values(inv.roles.map((r) => ({ tenantId: inv.tenantId, membershipId: m!.id, roleId: r.roleId, entityIds: r.entityIds })));
      await tx.update(invitation).set({ status: 'accepted' }).where(eq(invitation.id, inv.id));
      await this.audit.record(ctx, { tenantId: inv.tenantId, action: 'invitation.accept', targetType: 'invitation', targetId: inv.id }, tx);
      return { tenantId: inv.tenantId };
    });
  }

  private async findPending(token: string) {
    const [inv] = await this.db.select().from(invitation).where(eq(invitation.tokenHash, hashToken(token)));
    if (!inv || inv.status !== 'pending') throw new NotFoundException('Invitation not found or already used');
    if (inv.expiresAt.getTime() < Date.now()) throw new GoneException('Invitation has expired');
    return inv;
  }

  /** Roles and entities must belong to this tenant; only owners may grant the Owner role. */
  private async assertAssignable(ctx: TenantRequestContext, assignments: z.infer<typeof assignmentsInput>) {
    const tenantId = ctx.tenant.tenantId;
    const roleIds = [...new Set(assignments.map((a) => a.roleId))];
    const entityIds = [...new Set(assignments.flatMap((a) => a.entityIds ?? []))];
    if (roleIds.length) {
      const roles = await this.db
        .select({ id: role.id, systemKey: role.systemKey, name: role.name, permissions: role.permissions })
        .from(role)
        .where(and(eq(role.tenantId, tenantId), inArray(role.id, roleIds)));
      if (roles.length !== roleIds.length) throw new BadRequestException('Unknown role');
      if (!ctx.tenant.isOwner) {
        if (roles.some((r) => r.systemKey === 'owner')) throw new ForbiddenException('Only an owner can grant the Owner role');
        // No privilege escalation: non-owners can only hand out roles within their own permissions.
        const tooBroad = roles.filter((r) => r.permissions.some((p) => !ctx.tenant.permissions.has(p)));
        if (tooBroad.length) throw new ForbiddenException(`You cannot grant roles with more access than you have: ${tooBroad.map((r) => r.name).join(', ')}`);
      }
    }
    if (entityIds.length) {
      const found = await this.db.select({ id: legalEntity.id }).from(legalEntity).where(and(eq(legalEntity.tenantId, tenantId), inArray(legalEntity.id, entityIds)));
      if (found.length !== entityIds.length) throw new BadRequestException('Unknown entity');
    }
  }
}
