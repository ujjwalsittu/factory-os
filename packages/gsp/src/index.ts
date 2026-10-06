// DRAFT CONTRACT FOR REVIEW — types only, no implementation. See docs/05-india-compliance.md §8.
// Canonical payloads follow the NIC (IRP / EWB) schemas; each provider adapter maps to/from them.

export type GspProviderId =
  | 'mock'
  | 'masters_india'
  | 'cleartax'
  | 'iris'
  | 'adaequare'
  | 'cygnet'
  | 'tera'
  | 'nic_direct';

export type GspCapability =
  | 'einvoice'
  | 'ewaybill'
  | 'gstr1'
  | 'gstr3b'
  | 'gstr2b'
  | 'ims'
  | 'gstin_lookup';

/** Configured per GSTIN in entity settings. Secrets are stored envelope-encrypted, never returned to the UI. */
export interface GspConnection {
  gstin: string;
  provider: GspProviderId;
  environment: 'sandbox' | 'production';
  /** Different providers may be used per capability for the same GSTIN. */
  capabilities: GspCapability[];
  credentialRef: string;
}

export interface IrnResult {
  irn: string;
  ackNo: string;
  ackDate: string;
  signedInvoice: string;
  signedQrCode: string;
  ewbNo?: string;
}

export interface EwbResult {
  ewbNo: string;
  ewbDate: string;
  validUpto?: string;
}

export interface GspProvider {
  readonly id: GspProviderId;
  readonly capabilities: ReadonlySet<GspCapability>;

  einvoice: {
    generate(conn: GspConnection, payload: unknown): Promise<IrnResult>;
    cancel(conn: GspConnection, irn: string, reasonCode: string, remark: string): Promise<void>;
    getByIrn(conn: GspConnection, irn: string): Promise<IrnResult>;
  };

  ewaybill: {
    generate(conn: GspConnection, payload: unknown): Promise<EwbResult>;
    generateFromIrn(conn: GspConnection, irn: string, partB: unknown): Promise<EwbResult>;
    updatePartB(conn: GspConnection, ewbNo: string, partB: unknown): Promise<EwbResult>;
    extend(conn: GspConnection, ewbNo: string, details: unknown): Promise<EwbResult>;
    cancel(conn: GspConnection, ewbNo: string, reasonCode: string, remark: string): Promise<void>;
  };

  returns: {
    saveGstr1(conn: GspConnection, period: string, payload: unknown): Promise<{ referenceId: string }>;
    getGstr2b(conn: GspConnection, period: string): Promise<unknown>;
    imsAction(conn: GspConnection, actions: unknown[]): Promise<void>;
    getReturnStatus(conn: GspConnection, referenceId: string): Promise<unknown>;
  };

  lookup: {
    gstin(conn: GspConnection, gstin: string): Promise<unknown>;
  };
}

export * from './contracts.js';
export * from './canonical.js';
export * from './redaction.js';
export * from './mock.js';
