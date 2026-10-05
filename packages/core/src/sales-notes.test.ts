import { describe, it, expect } from 'vitest';
import { calculateReturnCost, allocateNoteComponents, gstCreditDeadline } from './sales-notes.js';
describe('recorded original-cost returns',()=>{
 it('uses the remaining recorded dispatch cost and exhausts the exact residual',()=>{
  expect(calculateReturnCost({originalQty:'10',originalValue:'600',returnedQty:'0',returnedValue:'0',qty:'4'})).toBe('240.000000');
  expect(calculateReturnCost({originalQty:'10',originalValue:'600',returnedQty:'4',returnedValue:'240',qty:'6'})).toBe('360.000000');
  expect(calculateReturnCost({originalQty:'3',originalValue:'0.01',returnedQty:'2',returnedValue:'0.006666',qty:'1'})).toBe('0.003334');
 });
 it('refuses negative or over-returned evidence',()=>{
  expect(()=>calculateReturnCost({originalQty:'10',originalValue:'600',returnedQty:'4',returnedValue:'240',qty:'7'})).toThrow();
  expect(()=>calculateReturnCost({originalQty:'10',originalValue:'600',returnedQty:'4',returnedValue:'601',qty:'1'})).toThrow();
 });
});
describe('original rounded note tax shares',()=>{
 const original={taxableValue:'3',cgst:'0.01',sgst:'0.01',igst:'0',cess:'0'};
 it('takes a bounded rounded partial share and the final original residual',()=>{
  const first=allocateNoteComponents(original,original,'1','3',false);
  expect(first.cgst).toBe('0.00');
  const final=allocateNoteComponents(original,{...original,taxableValue:'2'},'2','3',true);
  expect(final.cgst).toBe('0.01'); expect(final.taxableValue).toBe('2.00');
 });
 it('never allocates more than a remaining component',()=>{
  expect(()=>allocateNoteComponents(original,{...original,taxableValue:'0.50'},'1','3',false)).toThrow();
 });
 it('pins the next FY November deadline including Jan-March invoices',()=>{
  expect(gstCreditDeadline('2026-10-05')).toBe('2027-11-30');
  expect(gstCreditDeadline('2027-03-31')).toBe('2027-11-30');
  expect(gstCreditDeadline('2027-04-01')).toBe('2028-11-30');
 });
});
