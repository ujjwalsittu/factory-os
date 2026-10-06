import { createHash, randomBytes } from 'node:crypto';
import { SYSTEM_ROLES } from '@factoryos/auth';
import { type Database, invitation, legalEntity, membership, role, roleAssignment, tenant } from '@factoryos/db';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { DB } from '../common/tokens.js';
import { seedTenantDefaults } from '../defaults.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const entityInput = z.object({
  legalName: z.string().trim().min(2).max(200),
  shortName: z.string().trim().min(1).max(60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, 'Code must be 2–6 letters or digits'),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN')
    .optional(),
  cin: z.string().trim().max(30).optional(),
  parentEntityId: z.string().uuid().nullable().optional(),
});

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'tenant'
  );
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class TenancyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Creates a tenant, seeds system roles, and optionally makes `ownerUserId` the owner. */
  async createTenant(
    ctx: RequestContext,
    input: { name: string; slug?: string | undefined; ownerUserId?: string; entity?: z.infer<typeof entityInput> },
  ) {
    return this.db.transaction(tx=>this.createTenantIn(tx,ctx,input));
  }

  async createTenantIn(tx:Tx,ctx:RequestContext,input:{name:string;slug?:string|undefined;ownerUserId?:string;entity?:z.infer<typeof entityInput>}) {
      const slug = input.slug ?? (await this.uniqueSlug(tx, slugify(input.name)));
      const [existing] = await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, slug));
      if (existing) throw new ConflictException(`Tenant slug "${slug}" is taken`);

      const [t] = await tx.insert(tenant).values({ name: input.name, slug }).returning();
      const roles = await tx
        .insert(role)
        .values(
          SYSTEM_ROLES.map((r) => ({
            tenantId: t!.id,
            systemKey: r.key,
            name: r.name,
            description: r.description,
            permissions: [...r.permissions],
          })),
        )
        .returning();

      await seedTenantDefaults(tx, t!.id);

      if (input.ownerUserId) {
        const [m] = await tx
          .insert(membership)
          .values({ tenantId: t!.id, userId: input.ownerUserId, isOwner: true })
          .returning();
        const owner = roles.find((r) => r.systemKey === 'owner')!;
        await tx.insert(roleAssignment).values({ tenantId: t!.id, membershipId: m!.id, roleId: owner.id, entityIds: null });
      }

      let entity = null;
      if (input.entity) {
        [entity] = await tx
          .insert(legalEntity)
          .values({ ...input.entity, parentEntityId: null, tenantId: t!.id })
          .returning();
      }

      await this.audit.record(ctx, { tenantId: t!.id, action: 'tenant.create', targetType: 'tenant', targetId: t!.id, after: t }, tx);
      return { tenant: t!, entity, ownerRoleId: roles.find(r=>r.systemKey==='owner')!.id };
  }

  /** Creates a pending invitation and returns the raw token (only ever shown once, in the link). */
  async createInvitation(
    tx: Tx,
    tenantId: string,
    invitedBy: string,
    email: string,
    roles: { roleId: string; entityIds: string[] | null }[],
    origin: 'member' | 'platform_owner' = 'member',
  ) {
    const token = randomBytes(24).toString('base64url');
    const [inv] = await tx
      .insert(invitation)
      .values({
        tenantId,
        email: email.toLowerCase(),
        tokenHash: hashToken(token),
        origin,
        roles,
        invitedBy,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();
    return { invitation: inv!, token };
  }

  private async uniqueSlug(tx: Tx, base: string): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`;
      const [hit] = await tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, candidate));
      if (!hit) return candidate;
    }
    return `${base}-${randomBytes(3).toString('hex')}`;
  }
}
