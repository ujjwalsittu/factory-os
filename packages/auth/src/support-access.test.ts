import { describe, expect, it } from 'vitest';
import { isPermission } from './permissions.js';
import { SYSTEM_ROLES } from './roles.js';
import { SUPPORT_AREAS, SUPPORT_READ_CATALOG } from './support-access.js';

const role = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)!.permissions as readonly string[];
const CONTROL = ['read', 'configure', 'approve', 'cancel'].map((a) => `settings.support_access.${a}`);

// Decision 050: the support read surface is a fixed five-area catalog; no `.read` permission is admitted implicitly.
describe('support_catalog_and_control_scope', () => {
  it('catalogs exactly the five approved areas and their existing read permissions', () => {
    expect(SUPPORT_READ_CATALOG).toEqual({
      inventory: 'inventory.report.read',
      'sales-invoices': 'selling.sales_invoice.read',
      'purchase-invoices': 'buying.purchase_invoice.read',
      'work-orders': 'manufacturing.work_order.read',
      accounting: 'accounts.report.read',
    });
    expect(SUPPORT_AREAS).toEqual(Object.keys(SUPPORT_READ_CATALOG));
    for (const p of Object.values(SUPPORT_READ_CATALOG)) expect(isPermission(p)).toBe(true);
    expect(Object.isFrozen(SUPPORT_READ_CATALOG)).toBe(true);
  });

  it('registers read/configure/approve/cancel for support access', () => {
    for (const p of CONTROL) expect(isPermission(p)).toBe(true);
    expect(isPermission('settings.support_access.update')).toBe(false);
  });

  it('Owner and Administrator receive every control permission', () => {
    for (const key of ['owner', 'administrator']) for (const p of CONTROL) expect(role(key)).toContain(p);
  });

  it('read-only role rules receive only read; nobody else can approve, configure or cancel', () => {
    expect(role('auditor').filter((p) => p.startsWith('settings.support_access.'))).toEqual(['settings.support_access.read']);
    for (const def of SYSTEM_ROLES) {
      if (['owner', 'administrator'].includes(def.key)) continue;
      for (const p of CONTROL.slice(1)) expect(def.permissions as readonly string[]).not.toContain(p);
    }
  });
});
