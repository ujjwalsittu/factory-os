import { describe, it, expect } from 'vitest';
import * as helpers from './supplier-returns.js';
describe('supplier claim approval',()=>{
 it('requires every claim including zero',()=>expect(helpers.requiresClaimApproval({claimApproval:'every',approvalThresholdInr:'100'},'0','1')).toBe(true));
 it('compares original-rate INR strictly above threshold',()=>{
 const p={claimApproval:'above_threshold' as const,approvalThresholdInr:'100'};
 expect(helpers.requiresClaimApproval(p,'50','2')).toBe(false);
 expect(helpers.requiresClaimApproval(p,'50.005','2')).toBe(true);
 });
});
