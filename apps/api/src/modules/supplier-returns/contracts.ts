import { z } from 'zod';
import type {supplierReturnClaim,supplierReturnClaimLine,supplierNote,supplierNoteLine,supplierResolutionEffect,settlementAllocationDocument} from '@factoryos/db';
export type { SupplierPolicy } from '@factoryos/db';
const decimal=z.string().regex(/^\d{1,18}(?:\.\d{1,6})?$/);
const positive=decimal.refine(v=>/[1-9]/.test(v),'Must be positive');
const day=z.iso.date();
const reason=z.string().trim().min(5).max(500);
export const policySchema=z.object({dispatchApproval:z.enum(['pending_allowed','acceptance_required']),claimApproval:z.enum(['every','above_threshold']),approvalThresholdInr:decimal,creditApplication:z.enum(['automatic','manual']),rejectedAction:z.enum(['keep_open','request_back','propose_write_off'])}).strict();
const claimLine=z.object({invoiceLineId:z.uuid(),qty:decimal.default('0'),taxableAmount:decimal}).strict();
export const claimSchema=z.object({invoiceId:z.uuid(),postingDate:day,reason,lines:z.array(claimLine).min(1).max(300)}).strict();
export type ClaimInput=z.infer<typeof claimSchema>;
export const noteSchema=z.object({invoiceId:z.uuid(),kind:z.enum(['credit','debit']),taxTreatment:z.enum(['gst','commercial']),supplierNoteNo:z.string().trim().min(1).max(16),supplierNoteDate:day,postingDate:day,reason,taxEligibilityConfirmed:z.boolean().default(false),lines:z.array(z.object({invoiceLineId:z.uuid(),claimLineId:z.uuid().optional(),mode:z.enum(['quantity','value']),qty:decimal.default('0'),taxableAmount:decimal.default('0')}).strict()).min(1).max(300)}).strict();
export type SupplierNoteInput=z.infer<typeof noteSchema>;
export const dispatchSchema=z.object({postingDate:day,reason,lines:z.array(z.object({claimLineId:z.uuid(),receiptAllocationId:z.uuid(),receiptLineId:z.uuid(),warehouseId:z.uuid(),qty:positive}).strict()).min(1).max(300)}).strict();
export type DispatchInput=z.infer<typeof dispatchSchema>;
const resolutionBase={claimLineId:z.uuid(),returnEffectId:z.uuid(),postingDate:day,qty:positive,reason};
export const resolutionSchema=z.discriminatedUnion('kind',[z.object({...resolutionBase,kind:z.literal('write_off')}).strict(),z.object({...resolutionBase,kind:z.literal('receive_back'),warehouseId:z.uuid()}).strict(),z.object({kind:z.literal('acceptance_reversal'),noteId:z.uuid(),reason}).strict()]);
export type ResolutionInput=z.infer<typeof resolutionSchema>;
export interface SupplierNotePreview {
 currency:string;exchangeRate:string;sourceBillId:string;taxableValue:string;cgst:string;sgst:string;igst:string;cess:string;grandTotal:string;
 lines:{invoiceLineId:string;claimLineId?:string;qty:string;taxableAmount:string;cgst:string;sgst:string;igst:string;cess:string;pendingValueInr:string;pendingReturns:{returnEffectId:string;qty:string;valueInr:string}[];varianceInr:string;remainingQty:string;remainingTaxable:string}[];
}
export interface MovementResult {stockEntryId:string;qty:string;valueInr:string;evidenceIds:string[]}
export type ClaimDto=typeof supplierReturnClaim.$inferSelect & {lines:(typeof supplierReturnClaimLine.$inferSelect)[]};
export type SupplierNoteDto=typeof supplierNote.$inferSelect & {lines:(typeof supplierNoteLine.$inferSelect)[]};
export type ResolutionDto=typeof supplierResolutionEffect.$inferSelect;
export type AllocationDto=typeof settlementAllocationDocument.$inferSelect;
