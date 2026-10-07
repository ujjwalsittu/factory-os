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
import type {BetterAuthOptions} from 'better-auth';
export type NativeUserValidation=Parameters<NonNullable<NonNullable<BetterAuthOptions['user']>['validateUserInfo']>>[0];
export type NativeContext=Parameters<NonNullable<NonNullable<BetterAuthOptions['user']>['validateUserInfo']>>[1];
const frameKey=Symbol('FactoryOS verified SSO frame');
export function setSsoFrame(ctx:NativeContext,frame:SsoAuthFrame){Object.assign(ctx.context,{[frameKey]:frame});}
export function getSsoFrame(ctx:NativeContext|null|undefined):SsoAuthFrame|undefined{return (ctx?.context as {[frameKey]?:SsoAuthFrame}|undefined)?.[frameKey];}
