import 'reflect-metadata';
import assert from 'node:assert/strict';
import {isolatedSsoDatabase} from './sso-schema-helpers.mjs';
import {createAuth} from '../dist/auth.js';
import {loadConfig} from '../dist/config.js';
import {EmailService} from '../dist/modules/email/email.service.js';
import {AuditService} from '../dist/common/audit.service.js';
import {TenancyService} from '../dist/modules/tenancy.service.js';
import {Module,Controller,Get} from '@nestjs/common';
import {NestFactory,APP_GUARD} from '@nestjs/core';
import {PasskeysController} from '../dist/modules/passkeys/passkeys.controller.js';
import {PasskeysService} from '../dist/modules/passkeys/passkeys.service.js';
import {AccessGuard,TenantScoped,PlatformAdmin} from '../dist/common/access.js';
import {AUTH,CONFIG,DB} from '../dist/common/tokens.js';
export async function startPasskeyFixture(overrides={}){
 const f=await isolatedSsoDatabase();
 const config=loadConfig({NODE_ENV:'test',DATABASE_URL:f.url,BETTER_AUTH_URL:'http://localhost:3000',WEB_ORIGIN:'http://localhost:3000',BETTER_AUTH_SECRET:'synthetic-secret-over-thirty-two-characters',PASSKEY_ENABLED:'true',PASSKEY_RP_ID:'localhost',...overrides});
 const audit=new AuditService(f.db),tenancy=new TenancyService(f.db,audit),email=new EmailService(f.db,config,audit,tenancy),auth=createAuth(f.db,config,email);
 // Tiny route probes execute the actual shared guard, never a fake auth result.
 class AuthorityProbes{personal(){return {authorized:true};}tenant(){return {authorized:true};}platform(){return {authorized:true};}}
 Controller('passkeys-fixture-authority')(AuthorityProbes);
 for(const method of ['personal','tenant','platform'])Get(method)(AuthorityProbes.prototype,method,Object.getOwnPropertyDescriptor(AuthorityProbes.prototype,method));
 TenantScoped()(AuthorityProbes.prototype,'tenant',Object.getOwnPropertyDescriptor(AuthorityProbes.prototype,'tenant'));
 PlatformAdmin()(AuthorityProbes.prototype,'platform',Object.getOwnPropertyDescriptor(AuthorityProbes.prototype,'platform'));
 class FixtureModule{};Module({controllers:[PasskeysController,AuthorityProbes],providers:[PasskeysService,{provide:AUTH,useValue:auth},{provide:DB,useValue:f.db},{provide:CONFIG,useValue:config},{provide:APP_GUARD,useClass:AccessGuard}]})(FixtureModule);
 let app;
 const api=new URL(process.env.API??'http://localhost:4000');
 try{app=await NestFactory.create(FixtureModule,{logger:false,abortOnError:false});app.setGlobalPrefix('api');await app.listen(Number(api.port||4000),api.hostname);}catch(error){if(app)await app.close();await f.close();throw error;}
 async function request(path,body,cookies=new Map(),headers={}){
  const url=config.BETTER_AUTH_URL+(path.startsWith('/api/')?path:'/api/auth'+path);
  const application=path.startsWith('/api/')&&!path.startsWith('/api/auth/');
  const request=new Request(application?new URL(path,api):url,{method:body===undefined?'GET':'POST',headers:{origin:config.WEB_ORIGIN,'content-type':'application/json',cookie:[...cookies].map(([key,value])=>key+'='+value).join('; '),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const response=application?await fetch(request):await auth.handler(request);
  for(const item of response.headers.getSetCookie()){const [pair]=item.split(';'),i=pair.indexOf('='),key=pair.slice(0,i),value=pair.slice(i+1);if(value&&!/max-age=0/i.test(item))cookies.set(key,value);else cookies.delete(key);}
  const data=await response.json().catch(()=>null);return {status:response.status,data,headers:response.headers};
 }
 async function localUser(email='owner@example.test'){
  const cookies=new Map(),result=await request('/sign-up/email',{name:'Synthetic passkey owner',email,password:'Synthetic-password-123'},cookies);assert.equal(result.status,200);
  const id=result.data.user.id,session=(await f.db.$client.query('select id from session where user_id=$1',[id])).rows[0];
  return {id,cookies,ctx:{user:{id,email,name:'Synthetic passkey owner'},sessionId:session.id,tenant:null,platformAdminLevel:null,ip:null,userAgent:null}};
 }
 return {db:f.db,url:f.url,config,auth,service:app.get(PasskeysService),request,localUser,async close(){await app.close();await f.close();}};
}
