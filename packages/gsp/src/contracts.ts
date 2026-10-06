import {z} from 'zod';
export const decimal=z.string().regex(/^\d{1,18}(\.\d{1,6})?$/);
const address=z.object({name:z.string().min(1).max(200),gstin:z.string().regex(/^\d{2}[A-Z0-9]{13}$/).nullable(),stateCode:z.string().regex(/^\d{2}$/),address:z.string().min(1).max(500),city:z.string().min(1).max(100),pincode:z.string().regex(/^\d{6}$/)}).strict();
export const snapshotSchema=z.object({documentType:z.enum(['INV','CRN','DBN']),number:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9/-]{0,15}$/),date:z.iso.date(),fy:z.string().regex(/^\d{2}-\d{2}$/),supplyType:z.enum(['regular','sez_with_payment','sez_without_payment','export_with_payment','export_under_lut']),currency:z.string().regex(/^[A-Z]{3}$/),exchangeRate:decimal,seller:address,buyer:address,lines:z.array(z.object({description:z.string().min(1).max(200),hsn:z.string().regex(/^\d{4,8}$/),uqc:z.string().regex(/^[A-Z]{3}$/),isService:z.boolean(),qty:decimal,taxable:decimal,cgst:decimal,sgst:decimal,igst:decimal,cess:decimal}).strict()).min(1).max(1000),total:decimal,provenance:z.object({kind:z.enum(['sample','sales_invoice','sales_note','purchase_return']),sourceId:z.string().uuid().optional(),reason:z.string().min(5).max(500)}).strict()}).strict();
export type DocumentSnapshot=z.infer<typeof snapshotSchema>;
export const transportSchema=z.object({dispatchAddress:address,shipTo:address,reason:z.string().min(5).max(500),distanceKm:z.coerce.number().int().min(1).max(4000),mode:z.enum(['road','rail','air','ship']),transporterId:z.string().max(30).optional(),vehicleNo:z.string().regex(/^[A-Z0-9]{4,15}$/).optional(),transportDocumentNo:z.string().min(1).max(50).optional(),transportDocumentDate:z.iso.date().optional(),valuationConfirmed:z.boolean().default(false)}).strict();
export type TransportDraft=z.infer<typeof transportSchema>;
export const actionSchema=z.enum(['irn.generate','irn.lookup','irn.cancel','ewb.generate','ewb.from_irn','ewb.lookup','ewb.update_partb','ewb.extend','ewb.cancel']);
export type OperationAction=z.infer<typeof actionSchema>;
export interface SandboxScope{tenantId:string;entityId:string;registrationId:string;gstin:string;environment:'sandbox'}
export interface ProviderCommand{action:OperationAction;snapshot:DocumentSnapshot;transport?:TransportDraft;externalId?:string;irn?:string;reason?:string}
export type MockScenario='normal'|'timeout_after_success'|'rejected'|'unsupported_lookup'|'mismatched_lookup';
export interface ProviderAccess{scope:SandboxScope;provider:'mock'|'nic_direct';scenario:MockScenario;credentialRevisionId?:string;secrets?:Record<string,string>}
export interface ProviderEvidence{externalId:string;documentHash:string;gstin:string;documentNumber:string;documentType:string;issuedAt:string;status:'active'|'cancelled';simulated:boolean;signatureStatus:'simulated'|'verified'|'unverified'|'invalid';signedQrCode?:string;validUpto?:string;transport?:TransportDraft}
export type ProviderOutcome={kind:'confirmed';evidence:ProviderEvidence}|{kind:'rejected';code:string}|{kind:'unknown'}|{kind:'not_found'}|{kind:'unsupported'};
export interface SandboxProvider{execute(command:ProviderCommand,access:ProviderAccess):Promise<ProviderOutcome>}
export interface MockRemoteStore{get(key:string):Promise<ProviderEvidence|null>;put(key:string,value:ProviderEvidence):Promise<void>}
