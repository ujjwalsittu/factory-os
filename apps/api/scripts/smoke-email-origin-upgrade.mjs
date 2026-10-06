import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createDb} from '../../../packages/db/dist/index.js';
import {runMigrations} from '../../../packages/db/dist/migrate.js';
import {enqueueEmailIn,pruneEmailEvidence} from '../../../packages/email/dist/index.js';
import {AuditService} from '../dist/common/audit.service.js';
import {emailFixture,closeEmailDatabase} from './email-test-helpers.mjs';
const {migrate}=createRequire(import.meta.url)('drizzle-orm/node-postgres/migrator');
const admin=createDb(process.env.DATABASE_URL),name='email_origin_'+randomUUID().replaceAll('-',''),folder=await mkdtemp(join(tmpdir(),'email-origin-'));
await admin.$client.query(`create database ${name}`);const url=new URL(process.env.DATABASE_URL);url.pathname='/'+name;process.env.DATABASE_URL=url.toString();let f;
try{
 const root=new URL('../../../packages/db/drizzle/',import.meta.url),journal=JSON.parse(await readFile(new URL('meta/_journal.json',root),'utf8'));journal.entries=journal.entries.filter(e=>e.idx<24);await mkdir(join(folder,'meta'));await writeFile(join(folder,'meta/_journal.json'),JSON.stringify(journal));for(const e of journal.entries)await copyFile(new URL(e.tag+'.sql',root),join(folder,e.tag+'.sql'));
 const old=createDb(process.env.DATABASE_URL);try{await migrate(old,{migrationsFolder:folder});}finally{await old.$client.end();}
 f=await emailFixture();const audit=new AuditService(f.db),ctx={user:{id:f.userId},ip:null,userAgent:null};
 const insert=async email=>(await f.db.$client.query("insert into invitation(tenant_id,email,token_hash,roles,invited_by,expires_at) values($1,$2,$3,'[]',$4,$5) returning id",[f.tenantId,email,randomUUID(),f.userId,new Date(Date.now()+86400000)])).rows[0].id;
 const prunedOwner=await insert('pruned-owner@example.test'),retainedOwner=await insert('retained-owner@example.test'),member=await insert('member@example.test'),renewedOwner=await insert('renewed-owner@example.test'),renewalOriginal=await insert('prior-renewed-owner@example.test');
 const enqueue=id=>f.db.transaction(tx=>enqueueEmailIn(tx,{purpose:'owner_invitation',source:{kind:'invitation',tenantId:f.tenantId,invitationId:id},sourceExpiresAt:new Date(Date.now()+86400000),dedupeKey:id,templateVersion:'v1',envelope:null}));
 const pruned=await enqueue(prunedOwner);await audit.record(ctx,{action:'platform.tenant.create',targetType:'tenant',targetId:f.tenantId,after:{ownerEmail:'pruned-owner@example.test'}});await pruneEmailEvidence(f.db,new Date(Date.now()+31*86400000));assert.equal((await f.db.$client.query('select count(*)::int n from email_delivery where id=$1',[pruned.id])).rows[0].n,0);await enqueue(retainedOwner);await audit.record(ctx,{action:'platform.owner_invitation.renew',targetType:'invitation',targetId:renewedOwner,before:{invitationId:renewalOriginal}});
 await runMigrations(process.env.DATABASE_URL);
 for(const id of [prunedOwner,retainedOwner,renewedOwner,renewalOriginal])assert.equal((await f.db.$client.query('select origin from invitation where id=$1',[id])).rows[0].origin,'platform_owner');assert.equal((await f.db.$client.query('select origin from invitation where id=$1',[member])).rows[0].origin,'member');await assert.rejects(f.db.$client.query("update invitation set origin='member' where id=$1",[prunedOwner]));await assert.rejects(f.db.$client.query("insert into invitation(tenant_id,email,token_hash,roles,invited_by,expires_at,origin) values($1,'bad@example.test',$2,'[]',$3,now(),'bad')",[f.tenantId,randomUUID(),f.userId]));
 console.log('Email origin upgrade: retained/pruned original/replacement owner provenance, member separation and immutable bounded origin PASS');
}finally{if(f)await f.close();await closeEmailDatabase(admin,name);await admin.$client.end();await rm(folder,{recursive:true,force:true});}
