import 'reflect-metadata';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {mkdir,cp,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import {NestFactory} from '@nestjs/core';
import express from 'express';
import {toNodeHandler} from 'better-auth/node';
import {isolatedSsoDatabase} from './sso-schema-helpers.mjs';
import {loadConfig} from '../dist/config.js';
import {AppModule} from '../dist/app.module.js';
import {AUTH,DB,CONFIG} from '../dist/common/tokens.js';
import {syncOnStartup} from '../dist/bootstrap.js';
export async function passkeysBrowserFixture({subdomain=false,localStorage=false}={}){
 const api=process.env.API??'http://localhost:4000',web=process.env.WEB_URL??process.env.WEB_ORIGIN??'http://localhost:3000';
 for(const address of [api,web]){const target=new URL(address);if(target.protocol!=='http:'||target.hostname!=='localhost'||!target.port)throw new Error('Passkeys browser fixture requires localhost ports');const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(Number(target.port),'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));}
 const f=await isolatedSsoDatabase(),env={NODE_ENV:'test',DATABASE_URL:f.url,BETTER_AUTH_URL:web,WEB_ORIGIN:web,BETTER_AUTH_SECRET:'synthetic-browser-secret-over-thirty-two-characters',PASSKEY_ENABLED:'true',PASSKEY_RP_ID:'localhost',EMAIL_MODE:'disabled',EMAIL_WORKER_ENABLED:'false',SSO_GOOGLE_ENABLED:'false',SSO_MICROSOFT_ENABLED:'false',BOOTSTRAP_SUPERADMIN_EMAIL:'',STORAGE_DRIVER:'',STORAGE_LOCAL_DIR:'',PORT:new URL(api).port};
 const tlsPort=3443,canonical='https://factory.example.test:'+tlsPort,browserOrigin='https://extra.factory.example.test:'+tlsPort;
 if(subdomain)Object.assign(env,{BETTER_AUTH_URL:canonical,WEB_ORIGIN:canonical,EXTRA_TRUSTED_ORIGINS:browserOrigin,PASSKEY_ALLOWED_ORIGINS:canonical+','+browserOrigin,PASSKEY_RP_ID:'factory.example.test'});
 let app,child,tlsServer,tlsDirectory,storageDirectory;
 const close=async()=>{if(tlsServer)await new Promise(resolve=>tlsServer.close(resolve));if(child?.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}if(app){await app.close();await app.get(DB).$client.end();}await f.close();if(tlsDirectory)await rm(tlsDirectory,{recursive:true,force:true});if(storageDirectory)await rm(storageDirectory,{recursive:true,force:true});};
 try{
  if(localStorage){storageDirectory=await mkdtemp(join(tmpdir(),'passkey-quality-storage-'));Object.assign(env,{STORAGE_DRIVER:'local',STORAGE_LOCAL_DIR:storageDirectory});}
  await syncOnStartup(loadConfig(env));const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  try{app=await NestFactory.create(AppModule,{bodyParser:false,logger:false,abortOnError:false});const server=app.getHttpAdapter().getInstance();server.all('/api/auth/{*path}',toNodeHandler(app.get(AUTH)));server.post('/api/attachments',express.raw({type:()=>true,limit:'25mb'}));app.use(express.json({limit:'1mb'}));app.setGlobalPrefix('api');await app.listen(Number(new URL(api).port),'127.0.0.1');}finally{for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}
  const webRoot=new URL('../../web/',import.meta.url);await mkdir(new URL('.next/standalone/apps/web/.next',webRoot),{recursive:true});await cp(new URL('.next/static',webRoot),new URL('.next/standalone/apps/web/.next/static',webRoot),{recursive:true});
  child=spawn(process.execPath,['.next/standalone/apps/web/server.js'],{cwd:webRoot.pathname,env:{...process.env,...env,NODE_ENV:'production',API_INTERNAL_URL:api,PORT:new URL(web).port,HOSTNAME:'127.0.0.1'},stdio:['ignore','ignore','ignore']});
  let ready=false;for(let i=0;i<450;i++){try{if((await fetch(web+'/sign-in')).status===200){ready=true;break;}}catch{}if(child.exitCode!==null)throw new Error('Passkeys browser web stopped');await new Promise(r=>setTimeout(r,100));}if(!ready)throw new Error('Passkeys browser web not ready');
  if(subdomain){
   tlsDirectory=await mkdtemp(join(tmpdir(),'passkey-tls-'));
   execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(tlsDirectory,'key.pem'),'-out',join(tlsDirectory,'cert.pem'),'-days','1','-subj','/CN=factory.example.test','-addext','subjectAltName=DNS:factory.example.test,DNS:extra.factory.example.test,DNS:unrelated.example.test'],{stdio:'ignore'});
   tlsServer=https.createServer({key:await readFile(join(tlsDirectory,'key.pem')),cert:await readFile(join(tlsDirectory,'cert.pem'))},(req,res)=>{
    const upstream=http.request(new URL(req.url,web),{method:req.method,headers:{...req.headers,'x-forwarded-proto':'https'}},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
    upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
   });
   await new Promise((resolve,reject)=>{tlsServer.once('error',reject);tlsServer.listen(tlsPort,'127.0.0.1',resolve);});
  }
  return {db:f.db,web:subdomain?browserOrigin:web,api,close,setEnabled(value){app.get(CONFIG).passkeys.enabled=value;}};
 }catch(error){await close();throw error;}
}
