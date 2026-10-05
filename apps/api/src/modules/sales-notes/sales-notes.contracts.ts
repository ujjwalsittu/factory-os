import { z } from 'zod';
import type { AccountingLine, TaxComponents } from '@factoryos/core';
const decimal=z.string().regex(/^\d+(\.\d{1,6})?$/,'Positive decimal with up to six places');
export const noteInput=z.object({invoiceId:z.string().uuid(),kind:z.enum(['credit','debit']),taxTreatment:z.enum(['gst','commercial']),postingDate:z.string().date(),dueDate:z.string().date().optional(),reason:z.string().trim().min(5).max(500),taxEligibilityConfirmed:z.boolean().default(false),lines:z.array(z.object({invoiceLineId:z.string().uuid(),mode:z.enum(['quantity','value']),qty:decimal.optional(),taxableAmount:decimal.optional(),returnQty:decimal.optional(),warehouseId:z.string().uuid().optional()})).min(1).max(200)}).strict();
export type NoteDraftInput=z.infer<typeof noteInput>;
export type NoteLineInput=NoteDraftInput['lines'][number];
export interface NoteLinePreview extends TaxComponents {invoiceLineId:string;mode:'quantity'|'value';qty:string;taxableAmount:string;returnQty:string;warehouseId?:string;returnValueInr:string;originalLedgerSeq?:number;originalQty?:string;originalValue?:string}
export interface NoteLineLimit {invoiceLineId:string;creditQty:string;taxableValue:string;cgst:string;sgst:string;igst:string;cess:string;returnQty:string;returnValueInr:string}
export interface NotePreview extends TaxComponents {currency:string;exchangeRate:string;grandTotal:string;returnValueInr:string;applyAmount:string;remainingInvoiceAmount:string;unappliedCredit:string;lines:NoteLinePreview[];ledgerLines:AccountingLine[];limits:NoteLineLimit[]}
