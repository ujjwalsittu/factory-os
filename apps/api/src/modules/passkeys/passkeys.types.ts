import type {Database} from '@factoryos/db';
import type {drizzleAdapter} from 'better-auth/adapters/drizzle';
import type {passkey} from '@better-auth/passkey';
import type {NativeContext} from '../sso/sso.types.js';

export type PasskeyConfig={enabled:boolean;rpId:string|null;origins:string[];maxPerUser:number};
export type PasskeyKind='register'|'rename'|'remove';
export type PasskeyActionInput={kind:PasskeyKind;targetId?:string};
export type PasskeySummary={id:string;name:string;createdAt:string;lastUsedAt:string|null;deviceType:string;backedUp:boolean};
export type PasskeyActionGrant={nonce:string;expiresAt:string};
export type AuthTransaction=Parameters<Parameters<Database['transaction']>[0]>[0];
export type NativeAdapterFactory=ReturnType<typeof drizzleAdapter>;
export type NativeAdapter=ReturnType<NativeAdapterFactory>;
export type NativeAuthContext=NonNullable<NativeContext>;
export type NativeRegistrationCallback=NonNullable<NonNullable<NonNullable<Parameters<typeof passkey>[0]>['registration']>['afterVerification']>;
export type NativeRegistrationProof=Parameters<NativeRegistrationCallback>[0];
export type PasskeyIdentity={userId:string;credentialId:string;ceremonyId:string;rpId:string;returnPath:string;passwordVersion:string};
export type PasskeyFrame=
 | {mode:'register';userId:string;sessionId:string;actionId:string;ceremonyId:string;rpId:string;userHandle:string}
 | ({mode:'signin'} & PasskeyIdentity)
 | ({mode:'mfa';challengeExpiresAt:Date} & PasskeyIdentity)
 | {mode:'rename'|'remove';userId:string;sessionId:string;actionId:string;credentialId:string};
const frameKey=Symbol('FactoryOS verified passkey frame');
export function setPasskeyFrame(ctx:NativeAuthContext,frame:PasskeyFrame){Object.assign(ctx.context,{[frameKey]:frame});}
export function getPasskeyFrame(ctx:NativeContext|null|undefined):PasskeyFrame|undefined{return (ctx?.context as {[frameKey]?:PasskeyFrame}|undefined)?.[frameKey];}
