import type { Permission } from './permissions.js';

/** A role granted to a member. `entityIds: null` means the whole tenant. */
export interface ScopedGrant {
  permissions: readonly string[];
  entityIds: readonly string[] | null;
}

/**
 * Effective permissions for one request.
 * - With an active entity: union of grants that are tenant-wide or include that entity.
 * - Without one (tenant-level screens): only tenant-wide grants count.
 */
export function effectivePermissions(grants: readonly ScopedGrant[], activeEntityId: string | null): Set<string> {
  const out = new Set<string>();
  for (const g of grants) {
    const applies = g.entityIds === null || (activeEntityId !== null && g.entityIds.includes(activeEntityId));
    if (applies) for (const p of g.permissions) out.add(p);
  }
  return out;
}

/** Entities a member can access: all (null) if any grant is tenant-wide, else the union of scoped ones. */
export function accessibleEntityIds(grants: readonly ScopedGrant[]): string[] | null {
  const ids = new Set<string>();
  for (const g of grants) {
    if (g.entityIds === null) return null;
    for (const id of g.entityIds) ids.add(id);
  }
  return [...ids];
}

export function can(permissions: ReadonlySet<string>, required: Permission | readonly Permission[]): boolean {
  const list = typeof required === 'string' ? [required] : required;
  return list.every((p) => permissions.has(p));
}
