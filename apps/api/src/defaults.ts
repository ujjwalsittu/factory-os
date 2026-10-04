import { SYSTEM_ROLES } from '@factoryos/auth';
import { type Database, role, tenant, uom } from '@factoryos/db';
import { and, eq } from 'drizzle-orm';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Tx;

/** Units every manufacturer needs on day one. Tenants can add more. */
export const DEFAULT_UOMS: { code: string; name: string; decimals: number }[] = [
  { code: 'NOS', name: 'Numbers', decimals: 0 },
  { code: 'SET', name: 'Set', decimals: 0 },
  { code: 'BOX', name: 'Box', decimals: 0 },
  { code: 'REEL', name: 'Reel', decimals: 0 },
  { code: 'KG', name: 'Kilogram', decimals: 3 },
  { code: 'G', name: 'Gram', decimals: 3 },
  { code: 'M', name: 'Metre', decimals: 3 },
  { code: 'MM', name: 'Millimetre', decimals: 1 },
  { code: 'L', name: 'Litre', decimals: 3 },
  { code: 'ML', name: 'Millilitre', decimals: 1 },
  { code: 'SQM', name: 'Square metre', decimals: 3 },
  { code: 'HR', name: 'Hour', decimals: 2 },
  { code: 'DAY', name: 'Day', decimals: 2 },
];

export async function seedTenantDefaults(db: Db, tenantId: string): Promise<void> {
  await db
    .insert(uom)
    .values(DEFAULT_UOMS.map((u) => ({ ...u, tenantId })))
    .onConflictDoNothing();
}

/**
 * System roles are catalog-owned and read-only for tenants, so new permissions (e.g. from a new module)
 * are pushed to every tenant on startup. Missing system roles are created.
 */
export async function syncSystemRoles(db: Database): Promise<void> {
  const tenants = await db.select({ id: tenant.id }).from(tenant);
  for (const t of tenants) {
    await db.transaction(async (tx) => {
      for (const def of SYSTEM_ROLES) {
        const [existing] = await tx
          .select({ id: role.id })
          .from(role)
          .where(and(eq(role.tenantId, t.id), eq(role.systemKey, def.key)));
        if (existing) {
          await tx.update(role).set({ permissions: [...def.permissions], description: def.description }).where(eq(role.id, existing.id));
        } else {
          await tx
            .insert(role)
            .values({ tenantId: t.id, systemKey: def.key, name: def.name, description: def.description, permissions: [...def.permissions] })
            .onConflictDoNothing();
        }
      }
      await seedTenantDefaults(tx, t.id);
    });
  }
}
