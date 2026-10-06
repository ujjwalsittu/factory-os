import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLES } from './roles.js';
import { isPermission } from './permissions.js';
const actions = ['read','create','submit','cancel','export','configure','approve'];
const role = (key: string) => SYSTEM_ROLES.find(r => r.key === key)!.permissions as readonly string[];
// Removing explicit reconciliation catalog entries or broadening protected actions breaks these tests.
describe('bank reconciliation permissions', () => {
  it('registers every scoped action and grants Finance all of them', () => {
    for (const action of actions) { const p = `accounts.bank_reconciliation.${action}`; expect(isPermission(p)).toBe(true); expect(role('finance_controller')).toContain(p); }
  });
  it('Accountant can reverse ordinary evidence but cannot configure or approve', () => {
    for (const action of ['read','create','submit','cancel','export']) expect(role('accountant')).toContain(`accounts.bank_reconciliation.${action}`);
    for (const action of ['configure','approve']) expect(role('accountant')).not.toContain(`accounts.bank_reconciliation.${action}`);
  });
  it('Auditor and Administrator follow existing read conventions; Stores has no access', () => {
    expect(role('auditor').filter(p => p.startsWith('accounts.bank_reconciliation.'))).toEqual(['accounts.bank_reconciliation.read','accounts.bank_reconciliation.export']);
    expect(role('administrator').filter(p => p.startsWith('accounts.bank_reconciliation.'))).toEqual(['accounts.bank_reconciliation.read']);
    expect(role('stores').filter(p => p.startsWith('accounts.bank_reconciliation.'))).toEqual([]);
  });
});
