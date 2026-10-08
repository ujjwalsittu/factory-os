import 'reflect-metadata';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {mkdir,cp} from 'node:fs/promises';
import {NestFactory} from '@nestjs/core';
import express from 'express';
import {toNodeHandler} from 'better-auth/node';
import {isolatedSsoDatabase} from './sso-schema-helpers.mjs';
import {loadConfig} from '../dist/config.js';
import {AppModule} from '../dist/app.module.js';
import {AUTH,DB,CONFIG} from '../dist/common/tokens.js';
import {syncOnStartup} from '../dist/bootstrap.js';
export async function passkeysBrowserFixture(){
 const api=process.env.API??'http://localhost:4000',web=process.env.WEB_URL??process.env.WEB_ORIGIN??'http://localhost:3000';
 for(const address of [api,web]){const target=new URL(address);if(target.protocol!=='http:'||target.hostname!=='localhost'||!target.port)throw new Error('Passkeys browser fixture requires localhost ports');const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(Number(target.port),'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));}
 const f=await isolatedSsoDatabase(),env={NODE_ENV:'test',DATABASE_URL:f.url,BETTER_AUTH_URL:web,WEB_ORIGIN:web,BETTER_AUTH_SECRET:'synthetic-browser-secret-over-thirty-two-characters',PASSKEY_ENABLED:'true',PASSKEY_RP_ID:'localhost',EMAIL_MODE:'disabled',EMAIL_WORKER_ENABLED:'false',SSO_GOOGLE_ENABLED:'false',SSO_MICROSOFT_ENABLED:'false',BOOTSTRAP_SUPERADMIN_EMAIL:'',PORT:new URL(api).port};
 let app,child;
 const close=async()=>{if(child?.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}if(app){await app.close();await app.get(DB).$client.end();}await f.close();};
 try{
  await syncOnStartup(loadConfig(env));const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  try{app=await NestFactory.create(AppModule,{bodyParser:false,logger:false,abortOnError:false});const server=app.getHttpAdapter().getInstance();server.all('/api/auth/{*path}',toNodeHandler(app.get(AUTH)));app.use(express.json({limit:'1mb'}));app.setGlobalPrefix('api');await app.listen(Number(new URL(api).port),'127.0.0.1');}finally{for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}
  const webRoot=new URL('../../web/',import.meta.url);await mkdir(new URL('.next/standalone/apps/web/.next',webRoot),{recursive:true});await cp(new URL('.next/static',webRoot),new URL('.next/standalone/apps/web/.next/static',webRoot),{recursive:true});
  child=spawn(process.execPath,['.next/standalone/apps/web/server.js'],{cwd:webRoot.pathname,env:{...process.env,...env,NODE_ENV:'production',API_INTERNAL_URL:api,PORT:new URL(web).port,HOSTNAME:'127.0.0.1'},stdio:['ignore','ignore','ignore']});
  let ready=false;for(let i=0;i<450;i++){try{if((await fetch(web+'/sign-in')).status===200){ready=true;break;}}catch{}if(child.exitCode!==null)throw new Error('Passkeys browser web stopped');await new Promise(r=>setTimeout(r,100));}if(!ready)throw new Error('Passkeys browser web not ready');
  return {db:f.db,web,api,close,setEnabled(value){app.get(CONFIG).passkeys.enabled=value;}};
 }catch(error){await close();throw error;}
}
