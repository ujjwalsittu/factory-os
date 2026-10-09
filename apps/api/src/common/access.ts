import { accessibleEntityIds, effectivePermissions, isPermission, type Permission, type ScopedGrant } from '@factoryos/auth';
import { type Database, legalEntity, membership, platformAdmin, role, roleAssignment, tenant,session as authSession } from '@factoryos/db';
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import type { Auth } from '../auth.js';
import { AUTH, DB } from './tokens.js';

export interface TenantContext {
  tenantId: string;
  membershipId: string;
  isOwner: boolean;
  /** null = all entities in the tenant. */
  entityIds: string[] | null;
  activeEntityId: string | null;
  permissions: Set<string>;
}

export interface RequestContext {
  user: { id: string; email: string; name: string };
  sessionId: string;
  platformAdminLevel: 'superadmin' | 'support' | null;
  tenant: TenantContext | null;
  ip: string | null;
  userAgent: string | null;
}

/** Same as RequestContext, for handlers that declared a tenant requirement. */
export type TenantRequestContext = RequestContext & { tenant: TenantContext };

const PUBLIC = 'access:public';
const PERMISSIONS = 'access:permissions';
const TENANT = 'access:tenant';
const PLATFORM = 'access:platform';

/** No session required. */
export const Public = () => SetMetadata(PUBLIC, true);
/** Requires a tenant (x-tenant-id) the user belongs to, and every listed permission. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSIONS, permissions);
/** Requires a tenant membership but no particular permission. */
export const TenantScoped = () => SetMetadata(TENANT, true);
/** Platform operator endpoints (SuperAdmin console). */
export const PlatformAdmin = () => SetMetadata(PLATFORM, true);

export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => {
  const req = ctx.switchToHttp().getRequest<Request & { ctx?: RequestContext }>();
  if (!req.ctx) throw new UnauthorizedException();
  return req.ctx;
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Global guard: session → platform role → tenant membership → scoped permissions.
 * The API is the authority; the UI only mirrors these checks.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { ctx?: RequestContext }>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new UnauthorizedException('Sign in required');
    const [stored]=await this.db.select({pending:authSession.ssoPending,passkeyPending:authSession.passkeyPending}).from(authSession).where(eq(authSession.id,session.session.id));
    if(!stored||stored.pending||stored.passkeyPending)throw new UnauthorizedException('Complete verification first');

    const [admin] = await this.db
      .select({ level: platformAdmin.level })
      .from(platformAdmin)
      .where(eq(platformAdmin.userId, session.user.id));

    const ctx: RequestContext = {
      user: { id: session.user.id, email: session.user.email, name: session.user.name },
      sessionId: session.session.id,
      platformAdminLevel: admin?.level ?? null,
      tenant: null,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    };
    req.ctx = ctx;

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM, targets)) {
      if (ctx.platformAdminLevel !== 'superadmin') throw new ForbiddenException('Platform administrators only');
      return true;
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS, targets) ?? [];
    const tenantScoped = required.length > 0 || this.reflector.getAllAndOverride<boolean>(TENANT, targets);
    if (!tenantScoped) return true;

    ctx.tenant = await this.resolveTenant(req, ctx.user.id);
    const missing = required.filter((p) => !isPermission(p) || !ctx.tenant!.permissions.has(p));
    if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    return true;
  }

  private async resolveTenant(req: Request, userId: string): Promise<TenantContext> {
    const tenantId = req.get('x-tenant-id');
    if (!tenantId || !UUID_RE.test(tenantId)) throw new ForbiddenException('Select a tenant (x-tenant-id header)');

    const [m] = await this.db
      .select({ id: membership.id, isOwner: membership.isOwner, status: membership.status, tenantStatus: tenant.status })
      .from(membership)
      .innerJoin(tenant, eq(tenant.id, membership.tenantId))
      .where(and(eq(membership.tenantId, tenantId), eq(membership.userId, userId)));
    if (!m || m.status !== 'active') throw new ForbiddenException('You are not a member of this tenant');
    if (m.tenantStatus !== 'active') throw new ForbiddenException('This tenant is suspended');

    const rows = await this.db
      .select({ permissions: role.permissions, entityIds: roleAssignment.entityIds })
      .from(roleAssignment)
      .innerJoin(role, eq(role.id, roleAssignment.roleId))
      .where(eq(roleAssignment.membershipId, m.id));
    const grants: ScopedGrant[] = rows.map((r) => ({ permissions: r.permissions, entityIds: r.entityIds ?? null }));

    let activeEntityId: string | null = null;
    const entityHeader = req.get('x-entity-id');
    const entityIds = accessibleEntityIds(grants);
    if (entityHeader) {
      if (!UUID_RE.test(entityHeader)) throw new ForbiddenException('Invalid entity');
      const [e] = await this.db
        .select({ id: legalEntity.id })
        .from(legalEntity)
        .where(and(eq(legalEntity.id, entityHeader), eq(legalEntity.tenantId, tenantId)));
      if (!e || (entityIds !== null && !entityIds.includes(e.id))) throw new ForbiddenException('No access to this entity');
      activeEntityId = e.id;
    }

    return {
      tenantId,
      membershipId: m.id,
      isOwner: m.isOwner,
      entityIds,
      activeEntityId,
      permissions: effectivePermissions(grants, activeEntityId),
    };
  }
}
