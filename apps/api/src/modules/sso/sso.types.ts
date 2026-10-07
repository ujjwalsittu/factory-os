export type SsoProviderId = 'google' | 'microsoft';
export type SsoActionKind = 'link' | 'unlink';
export type SsoConfig = {
  google: null | {clientId:string;clientSecret:string;allowedHostedDomains:string[]};
  microsoft: null | {clientId:string;clientSecret:string;tenantId:string;issuer:string};
};
/** A relative path accepted by validateSsoReturn. Never an identity authority. */
export type SsoReturn = string;
export type SsoAuthFrame = {mode:'signin'|'link'|'mfa';provider:SsoProviderId;userId:string;accountId:string|null;issuer:string;returnPath:SsoReturn;actionId?:string};
export type ProviderAvailability = {id:SsoProviderId;label:string};
export type ConnectionSummary = {bindingId:string;provider:SsoProviderId;label:string;connectedAt:string};
