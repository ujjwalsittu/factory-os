import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLES } from './roles.js';
import { isPermission } from './permissions.js';
const role = (key:string) => SYSTEM_ROLES.find(r=>r.key===key)!.permissions as readonly string[];
describe('withholding and bank charge permissions',()=>{
 it('registers explicit accounting actions',()=>{
  for(const permission of ['accounts.withholding.read','accounts.withholding.configure','accounts.withholding.correct','accounts.bank_charge.submit'])expect(isPermission(permission)).toBe(true);
 });
 it('Finance controls protected settings and corrections',()=>{
  for(const permission of ['accounts.withholding.configure','accounts.withholding.approve','accounts.withholding.correct']) {
   expect(role('finance_controller')).toContain(permission);expect(role('accountant')).not.toContain(permission);
  }
 });
 it('Accountant routine actions include guarded cancellation',()=>{
  for(const permission of ['accounts.withholding.create','accounts.withholding.submit','accounts.withholding.cancel','accounts.bank_charge.cancel'])expect(role('accountant')).toContain(permission);
 });
 it('Auditor reads and exports, Stores has no accounting mutations',()=>{
  expect(role('auditor')).toContain('accounts.withholding.export');
  expect(role('auditor').filter(p=>/^accounts\.(withholding|bank_charge)\./.test(p)).every(p=>/\.(read|export)$/.test(p))).toBe(true);
  expect(role('stores').filter(p=>/^accounts\.(withholding|bank_charge)\./.test(p))).toEqual([]);
 });
});
