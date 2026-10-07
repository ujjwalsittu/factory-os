import 'reflect-metadata';
import assert from 'node:assert/strict';
import {isolatedSsoDatabase} from './sso-schema-helpers.mjs';
import {syntheticProviders,syntheticTenant} from './sso-network-fixture.mjs';
import {createAuth} from '../dist/auth.js';
import {loadConfig} from '../dist/config.js';
import {EmailService} from '../dist/modules/email/email.service.js';
import {AuditService} from '../dist/common/audit.service.js';
import {TenancyService} from '../dist/modules/tenancy.service.js';
import {SsoService} from '../dist/modules/sso/sso.service.js';
export async function startSsoFixture(overrides={}){
 const f=await isolatedSsoDatabase(),provider=await syntheticProviders();
 const env={NODE_ENV:'test',DATABASE_URL:f.url,BETTER_AUTH_URL:'http://localhost:3000',WEB_ORIGIN:'http://localhost:3000',BETTER_AUTH_SECRET:'synthetic-secret-over-thirty-two-characters',SSO_GOOGLE_ENABLED:'true',SSO_GOOGLE_CLIENT_ID:'synthetic-google',SSO_GOOGLE_CLIENT_SECRET:'synthetic-google-secret',SSO_MICROSOFT_ENABLED:'true',SSO_MICROSOFT_CLIENT_ID:'synthetic-ms',SSO_MICROSOFT_CLIENT_SECRET:'synthetic-ms-secret',SSO_MICROSOFT_TENANT_ID:syntheticTenant,...overrides};
 const config=loadConfig(env),audit=new AuditService(f.db),tenancy=new TenancyService(f.db,audit),email=new EmailService(f.db,config,audit,tenancy),auth=createAuth(f.db,config,email),service=new SsoService(f.db,config);
 const diagnostics=[];const beforeAfter=auth.options.hooks.after;auth.options.hooks.after=async ctx=>{diagnostics.push({path:ctx.path,error:ctx.context.returned?.body?.code,redirectCode:new URL(ctx.context.responseHeaders?.get('location')??config.WEB_ORIGIN,config.WEB_ORIGIN).searchParams.get('error')});return beforeAfter(ctx);};
 function jar(){return new Map();}
 async function request(path,body,cookies=jar(),headers={}){
  const raw=path.startsWith('http')?path:config.BETTER_AUTH_URL+'/api/auth'+path;
  const response=await auth.handler(new Request(raw,{method:body?'POST':'GET',headers:{origin:config.WEB_ORIGIN,'content-type':'application/json',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...headers},...(body?{body:JSON.stringify(body)}:{})}));
  for(const item of response.headers.getSetCookie()){const [pair]=item.split(';'),i=pair.indexOf('='),key=pair.slice(0,i),value=pair.slice(i+1);if(value&& !/max-age=0/i.test(item))cookies.set(key,value);else cookies.delete(key);}
  const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{data=null;}
  return {status:response.status,data,location:response.headers.get('location'),response};
 }
 async function localUser(email='owner@example.test'){
  const cookies=jar(),result=await request('/sign-up/email',{name:'Local unchanged',email,password:'Synthetic-password-123'},cookies);assert.equal(result.status,200);const id=result.data.user.id;await f.db.$client.query('update "user" set email_verified=true where id=$1',[id]);const session=(await f.db.$client.query('select id from session where user_id=$1',[id])).rows[0];return {id,email,cookies,ctx:{user:{id,email,name:'Local unchanged'},sessionId:session.id,tenant:null,platformAdminLevel:null,ip:null,userAgent:null}};
 }
 async function start(providerId,user=null,extra={}){
  const cookies=user?.cookies??jar(),body={provider:providerId,callbackURL:config.WEB_ORIGIN+'/sso/complete',errorCallbackURL:config.WEB_ORIGIN+'/sso/error',disableRedirect:true,...extra};
  let headers={};if(user){const proof=await service.issueAction(user.ctx,{provider:providerId,kind:'link'},async()=>true);headers={'x-factoryos-sso-action':proof.nonce};}
  const result=await request(user?'/link-social':'/sign-in/social',body,cookies,headers);return {...result,cookies};
 }
 return {auth,diagnostics,db:f.db,config,env,email,service,provider,jar,request,localUser,start,async close(){provider.close();await f.close();}};
}
