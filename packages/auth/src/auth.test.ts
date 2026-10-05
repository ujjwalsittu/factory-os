import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, SYSTEM_ROLES, accessibleEntityIds, can, effectivePermissions, isPermission } from './index.js';

describe('permission catalog', () => {
  it('has unique, well-formed keys', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    for (const p of ALL_PERMISSIONS) expect(p).toMatch(/^[a-z_]+\.[a-z_]+\.[a-z_]+$/);
  });
  it('validates keys', () => {
    expect(isPermission('settings.user.create')).toBe(true);
    expect(isPermission('settings.user.fly')).toBe(false);
  });
});

describe('system roles', () => {
  const role = (k: string) => SYSTEM_ROLES.find((r) => r.key === k)!;
  it('only reference catalog permissions', () => {
    for (const r of SYSTEM_ROLES) for (const p of r.permissions) expect(isPermission(p)).toBe(true);
  });
  it('enforce maker-checker on GST filing', () => {
    expect(role('accountant').permissions).toContain('compliance.gst_return.create');
    expect(role('accountant').permissions).not.toContain('compliance.gst_return.approve');
    expect(role('accountant').permissions).not.toContain('compliance.gst_return.file');
    expect(role('finance_controller').permissions).toContain('compliance.gst_return.file');
    expect(role('administrator').permissions).not.toContain('compliance.gst_return.file');
  });
  it('auditor cannot write', () => {
    for (const p of role('auditor').permissions) expect(p).toMatch(/\.(read|export)$/);
  });
});

describe('scoped evaluation', () => {
  const grants = [
    { permissions: ['settings.user.read'], entityIds: null },
    { permissions: ['accounts.voucher.create'], entityIds: ['azeonics'] },
  ];
  it('applies tenant-wide grants everywhere', () => {
    expect(can(effectivePermissions(grants, null), 'settings.user.read')).toBe(true);
    expect(can(effectivePermissions(grants, 'earthnow'), 'settings.user.read')).toBe(true);
  });
  it('applies entity grants only in that entity', () => {
    expect(can(effectivePermissions(grants, 'azeonics'), 'accounts.voucher.create')).toBe(true);
    expect(can(effectivePermissions(grants, 'earthnow'), 'accounts.voucher.create')).toBe(false);
    expect(can(effectivePermissions(grants, null), 'accounts.voucher.create')).toBe(false);
  });
  it('computes accessible entities', () => {
    expect(accessibleEntityIds(grants)).toBeNull();
    expect(accessibleEntityIds([{ permissions: [], entityIds: ['a', 'b'] }])).toEqual(['a', 'b']);
  });
});

it('separates supplier-return preparation, approval and dispatch roles', () => {
  const r = (key: string) => SYSTEM_ROLES.find(x => x.key === key)!.permissions;
  expect(r('purchase')).toContain('buying.return_claim.create');
  expect(r('purchase')).not.toContain('buying.return_claim.approve');
  expect(r('purchase')).not.toContain('buying.return_policy.update');
  expect(r('accountant')).not.toContain('buying.return_resolution.create');
  expect(r('stores')).toContain('buying.return_movement.create');
  expect(r('stores')).not.toContain('buying.supplier_note.submit');
  expect(r('finance_controller')).toContain('buying.return_claim.approve');
  expect(r('finance_controller')).toContain('buying.return_resolution.create');
});
