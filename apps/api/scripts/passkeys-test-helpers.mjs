import 'reflect-metadata';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {runMigrations} from '../../../packages/db/dist/migrate.js';
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
export async function startPasskeyFixture(overrides={},database=null){
 const f=database??await isolatedPasskeysDatabase();
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
 const api=new URL(process.env.API??'http://localhost:4000'),listenHost=api.hostname==='localhost'?'127.0.0.1':api.hostname,transportApi=new URL(api);transportApi.hostname=listenHost;
 try{app=await NestFactory.create(FixtureModule,{logger:false,abortOnError:false});app.setGlobalPrefix('api');await app.listen(Number(api.port||4000),listenHost);}catch(error){if(app)await app.close();await f.close();throw error;}
 async function request(path,body,cookies=new Map(),headers={},handler=auth){
  const url=config.BETTER_AUTH_URL+(path.startsWith('/api/')?path:'/api/auth'+path);
  const application=path.startsWith('/api/')&&!path.startsWith('/api/auth/');
  const request=new Request(application?new URL(path,transportApi):url,{method:body===undefined?'GET':'POST',headers:{origin:config.WEB_ORIGIN,'content-type':'application/json',cookie:[...cookies].map(([key,value])=>key+'='+value).join('; '),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const response=application?await fetch(request):await handler.handler(request);
  for(const item of response.headers.getSetCookie()){const [pair]=item.split(';'),i=pair.indexOf('='),key=pair.slice(0,i),value=pair.slice(i+1);if(value&&!/max-age=0/i.test(item))cookies.set(key,value);else cookies.delete(key);}
  const data=await response.json().catch(()=>null);return {status:response.status,data,headers:response.headers};
 }
 async function localUser(email='owner@example.test'){
  const cookies=new Map(),result=await request('/sign-up/email',{name:'Synthetic passkey owner',email,password:'Synthetic-password-123'},cookies);assert.equal(result.status,200);
  const id=result.data.user.id,session=(await f.db.$client.query('select id from session where user_id=$1',[id])).rows[0];
  return {id,cookies,ctx:{user:{id,email,name:'Synthetic passkey owner'},sessionId:session.id,tenant:null,platformAdminLevel:null,ip:null,userAgent:null}};
 }
 return {db:f.db,url:f.url,config,auth,email,service:app.get(PasskeysService),request,localUser,async close(){await app.close();await f.close();}};
}

// These snapshots contain hashes/counts and activation metadata, never auth secrets.
export async function capturePasskeyBaseline(db){
 const books={};for(const table of ['gl_entry','journal_voucher','trade_bill','trade_bill_effect','stock_ledger_entry','stock_bin','fifo_layer','fifo_consumption']){const rows=(await db.$client.query(`select row_to_json(t)::text value from ${table} t order by row_to_json(t)::text`)).rows.map(r=>r.value);books[table]={count:rows.length,hash:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}
 const activations=(await db.$client.query('select entity_id,active,cutover_date,activated_at,activated_by,opening_voucher_id from accounting_settings order by entity_id')).rows;
 const directory=new URL('../../../packages/db/drizzle/',import.meta.url),hashes={};for(const name of (await readdir(directory)).filter(n=>/^\d{4}_.*\.sql$/.test(n)).sort())hashes[name]=createHash('sha256').update(await readFile(new URL(name,directory))).digest('hex');
 const auditRows=(await db.$client.query('select row_to_json(t)::text value from audit_event t order by row_to_json(t)::text')).rows.map(r=>r.value);
 return JSON.parse(JSON.stringify({books,activations,hashes,audit:{count:auditRows.length,hash:createHash('sha256').update(JSON.stringify(auditRows)).digest('hex')}}));
}
export async function assertPasskeyBaseline(db,baseline){assert.deepEqual(await capturePasskeyBaseline(db),baseline);}
export async function observeWaiter(blockerPid,waiterPid,db){
 assert.notEqual(blockerPid,waiterPid);
 const rows=(await db.$client.query("with recursive waiters(pid) as (select $1::int union select a.pid from pg_stat_activity a join waiters w on w.pid=any(pg_blocking_pids(a.pid)) where a.datname=current_database() and a.wait_event_type='Lock') select pid from waiters where pid=$2 and pid<>$1",[blockerPid,waiterPid])).rows;
 assert.equal(rows.length,1,'actual distinct PostgreSQL lock waiting required');
}
export async function isolatedPasskeysDatabase({populated=false}={}){
 if(!populated)return isolatedSsoDatabase();
 const source=new URL(process.env.DATABASE_URL);if(!['localhost','127.0.0.1','db'].includes(source.hostname))throw new Error('Populated fixture requires local Compose PostgreSQL');
 const f=await isolatedSsoDatabase(false),target=new URL(f.url),username=decodeURIComponent(source.username)||'postgres';
 // PostgreSQL logical snapshot: source is read-only, no shared migration or
 // termination of other sessions. Docker Compose supplies local PG tools.
 let dump,restore;
 const exit=child=>new Promise((resolve,reject)=>{child.once('error',()=>reject(new Error('PostgreSQL copy tool unavailable')));child.once('exit',code=>code===0?resolve():reject(new Error('PostgreSQL populated fixture copy failed')));});
 try{
  dump=spawn('docker',['compose','exec','-T','db','pg_dump','--username',username,'--dbname',decodeURIComponent(source.pathname.slice(1)),'--format=custom','--no-owner','--no-acl'],{cwd:new URL('../../../',import.meta.url),stdio:['ignore','pipe','ignore']});
  restore=spawn('docker',['compose','exec','-T','db','pg_restore','--username',username,'--dbname',decodeURIComponent(target.pathname.slice(1)),'--no-owner','--no-acl','--exit-on-error'],{cwd:new URL('../../../',import.meta.url),stdio:['pipe','ignore','ignore']});
  await Promise.all([exit(dump),exit(restore),pipeline(dump.stdout,restore.stdin)]);await runMigrations(f.url);return f;
 }catch(error){dump?.kill();restore?.kill();await f.close();throw error;}
}
