import 'reflect-metadata';
import assert from 'node:assert/strict';
import {isolatedSsoDatabase} from './sso-schema-helpers.mjs';
import {createAuth} from '../dist/auth.js';
import {loadConfig} from '../dist/config.js';
import {EmailService} from '../dist/modules/email/email.service.js';
import {AuditService} from '../dist/common/audit.service.js';
import {TenancyService} from '../dist/modules/tenancy.service.js';
export async function startPasskeyFixture(overrides={}){
 const f=await isolatedSsoDatabase();
 const config=loadConfig({NODE_ENV:'test',DATABASE_URL:f.url,BETTER_AUTH_URL:'http://localhost:3000',WEB_ORIGIN:'http://localhost:3000',BETTER_AUTH_SECRET:'synthetic-secret-over-thirty-two-characters',PASSKEY_ENABLED:'true',PASSKEY_RP_ID:'localhost',...overrides});
 const audit=new AuditService(f.db),tenancy=new TenancyService(f.db,audit),email=new EmailService(f.db,config,audit,tenancy),auth=createAuth(f.db,config,email);
 async function request(path,body,cookies=new Map(),headers={}){
  const url=config.BETTER_AUTH_URL+(path.startsWith('/api/')?path:'/api/auth'+path);
  const response=await auth.handler(new Request(url,{method:body===undefined?'GET':'POST',headers:{origin:config.WEB_ORIGIN,'content-type':'application/json',cookie:[...cookies].map(([key,value])=>key+'='+value).join('; '),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  for(const item of response.headers.getSetCookie()){const [pair]=item.split(';'),i=pair.indexOf('='),key=pair.slice(0,i),value=pair.slice(i+1);if(value&&!/max-age=0/i.test(item))cookies.set(key,value);else cookies.delete(key);}
  const data=await response.json().catch(()=>null);return {status:response.status,data,headers:response.headers};
 }
 async function localUser(email='owner@example.test'){
  const cookies=new Map(),result=await request('/sign-up/email',{name:'Synthetic passkey owner',email,password:'Synthetic-password-123'},cookies);assert.equal(result.status,200);
  const id=result.data.user.id,session=(await f.db.$client.query('select id from session where user_id=$1',[id])).rows[0];
  return {id,cookies,ctx:{user:{id,email,name:'Synthetic passkey owner'},sessionId:session.id,tenant:null,platformAdminLevel:null,ip:null,userAgent:null}};
 }
 return {db:f.db,url:f.url,config,auth,request,localUser,close:()=>f.close()};
}
