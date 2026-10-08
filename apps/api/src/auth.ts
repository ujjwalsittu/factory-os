import type { Database } from '@factoryos/db';
import { account, passkey, session, twoFactor, user, verification } from '@factoryos/db';
import { betterAuth } from 'better-auth';
import { twoFactor as twoFactorPlugin } from 'better-auth/plugins';
import type { AppConfig } from './config.js';
import {authEmailCallbacks} from './modules/email/auth-email.js';
import type {EmailService} from './modules/email/email.service.js';
import {APIError,createAuthMiddleware,isAPIError} from 'better-auth/api';
import {buildSsoOptions} from './modules/sso/sso.policy.js';
import {withSsoMfa} from './modules/sso/sso.mfa.js';
import {SsoStore} from './modules/sso/sso.store.js';
import {createTransactionalAuthAdapter} from './modules/passkeys/passkeys.adapter.js';
import {withPasskeyAuthority} from './modules/passkeys/passkeys.scope.js';
import {createPasskeyPlugin} from './modules/passkeys/passkeys.native.js';
import {PasskeyStore} from './modules/passkeys/passkeys.store.js';

export function createAuth(db: Database, config: AppConfig,email:EmailService) {
  const callbacks=authEmailCallbacks(db,config,email);
  const sso=buildSsoOptions(db,config);
  const privateString={type:'string' as const,required:false,input:false,returned:false};
  const privateVerification={passkeyCredentialId:privateString,passkeyRpId:privateString,passkeyReturnCipher:privateString,passkeyPasswordVersion:privateString};
  const mutationBefore=sso.hooks!.before!;
  const auth=betterAuth({
    ...sso,
    session:{...sso.session,additionalFields:{...sso.session?.additionalFields,passkeyCredentialId:privateString,passkeyRpId:privateString,passkeyPending:{type:'boolean',required:false,input:false,returned:false,defaultValue:false}}},
    appName: 'FactoryOS',
    logger:{disabled:true},
    baseURL: config.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.WEB_ORIGIN, ...config.EXTRA_TRUSTED_ORIGINS],
    database: createTransactionalAuthAdapter(db,{ user, session, account, verification, twoFactor,passkey }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      resetPasswordTokenExpiresIn:3600,
      revokeSessionsOnPasswordReset:true,
      sendResetPassword:callbacks.sendResetPassword,
    },
    emailVerification:{sendVerificationEmail:callbacks.sendVerificationEmail,sendOnSignUp:config.email.mode==='smtp',sendOnSignIn:false,expiresIn:3600},
    hooks:{...sso.hooks,before:createAuthMiddleware(async ctx=>{
      const merge=(headers:Headers)=>{headers.forEach((value,key)=>{if(key!=='set-cookie')ctx.setHeader(key,value);});for(const cookie of headers.getSetCookie())ctx.responseHeaders.append('set-cookie',cookie);};
      const outcome=await callbacks.before({...ctx,returnHeaders:true});
      if(!outcome||typeof outcome!=='object'||!('headers' in outcome)||!(outcome.headers instanceof Headers)||!('response' in outcome))throw new APIError('INTERNAL_SERVER_ERROR',{message:'Authentication is temporarily unavailable'});
      merge(outcome.headers);if(outcome.response)return outcome.response;
      const result=await mutationBefore({...ctx,returnHeaders:true});
      if(!result||typeof result!=='object'||!('headers' in result)||!(result.headers instanceof Headers)||!('response' in result))throw new APIError('INTERNAL_SERVER_ERROR',{message:'Authentication is temporarily unavailable'});
      merge(result.headers);return result.response;
    })},
    onAPIError:{errorURL:new URL('/sso/error',config.WEB_ORIGIN).href,onError(error){
      // The router logs raw non-API errors even when its logger is disabled.
      // Adapter errors can contain SQL parameters and credential material.
      if(!isAPIError(error))throw new APIError('INTERNAL_SERVER_ERROR',{message:'Authentication is temporarily unavailable'});
    }},
    rateLimit: { enabled: config.NODE_ENV !== 'test', window: 60, max: 100 },
    plugins: [withSsoMfa(twoFactorPlugin({ issuer: 'FactoryOS' }),new SsoStore(db,config),config,db),{id:'factoryos-passkey-schema',schema:{verification:{fields:privateVerification}}},createPasskeyPlugin(db,config,new PasskeyStore(db,config))],
  });
  return withPasskeyAuthority(auth,db);
}

export type Auth = ReturnType<typeof createAuth>;
