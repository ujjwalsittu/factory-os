import { Dec } from './decimal.js';
export function requiresClaimApproval(policy:{claimApproval:'every'|'above_threshold';approvalThresholdInr:string},requestedAmount:string,exchangeRate:string):boolean {
 return policy.claimApproval==='every'||Dec.of(requestedAmount).mul(exchangeRate).gt(policy.approvalThresholdInr);
}
