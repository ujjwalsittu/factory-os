import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createDb} from '../../../packages/db/dist/index.js';
import {runMigrations} from '../../../packages/db/dist/migrate.js';
import {startSsoFixture} from './sso-test-helpers.mjs';
const db=createDb(process.env.DATABASE_URL),baseline=JSON.parse(await readFile(new URL('../../../.superpowers/sdd/2026-10-07-sso/upgrade-baseline.json',import.meta.url),'utf8'));
const tables=['gl_entry','journal_voucher','trade_bill','trade_bill_effect','stock_ledger_entry','stock_bin','fifo_layer','fifo_consumption'];
async function snapshot(){const books={};for(const table of tables){const rows=(await db.$client.query(`select row_to_json(t)::text value from ${table} t order by row_to_json(t)::text`)).rows.map(r=>r.value);assert(rows.length>0);books[table]={count:rows.length,hash:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}return {books,activations:(await db.$client.query('select entity_id,active,cutover_date,activated_at,activated_by,opening_voucher_id from accounting_settings order by entity_id')).rows};}
let f,user;
try{
 const before=await snapshot();assert.deepEqual(before.books,baseline.books);for(const row of baseline.activations)assert.deepEqual(JSON.parse(JSON.stringify(before.activations.find(a=>a.entity_id===row.entity_id))),row);
 const directory=new URL('../../../packages/db/drizzle/',import.meta.url);for(const name of (await readdir(directory)).filter(n=>/^(001[1-9]|002[0-4])_.*\.sql$/.test(n)))assert.equal(createHash('sha256').update(await readFile(new URL(name,directory))).digest('hex'),baseline.hashes[name]);
 assert.equal((await db.$client.query("select count(*)::int n from (select provider_id,account_id from account group by provider_id,account_id having count(*)>1) duplicates")).rows[0].n,0,'upgrade refuses duplicate provider keys; no automatic identity resolution');
 await runMigrations(process.env.DATABASE_URL);
 f=await startSsoFixture({}, {db,url:process.env.DATABASE_URL,async close(){await db.$client.end();}});user=await f.localUser('sso-invariance-'+randomUUID()+'@example.test');
 for(const provider of ['google','microsoft']){
  const subject='invariance-'+provider+'-'+randomUUID(),link=await f.start(provider,user),code=f.provider.authorize(link.data.url,{subject,email:user.email});assert.equal(new URL((await f.request(code.callback,null,link.cookies)).location).pathname,'/sso/complete');
  const start=await f.start(provider),signin=f.provider.authorize(start.data.url,{subject,email:user.email});assert.equal(new URL((await f.request(signin.callback,null,start.cookies)).location).pathname,'/sso/complete');assert.equal((await f.request('/get-session',null,start.cookies)).data.user.id,user.id);
  const binding=(await db.$client.query('select id from account where user_id=$1 and provider_id=$2',[user.id,provider])).rows[0].id,proof=await f.service.issueAction(user.ctx,{provider,kind:'unlink',targetAccountId:binding},async()=>true);assert.equal((await f.request('/unlink-account',{providerId:provider,accountId:binding},user.cookies,{'x-factoryos-sso-action':proof.nonce})).status,200);
 }
 assert.equal((await db.$client.query('select count(*)::int n from auth_sso_event where user_id=$1',[user.id])).rows[0].n,6);
 await db.$client.query('delete from auth_sso_action where user_id=$1',[user.id]);await db.$client.query('delete from "user" where id=$1',[user.id]);user=null;
 assert.deepEqual(await snapshot(),before);console.log('SSO populated shared GL/journals/bills/effects/stock/FIFO exact invariance PASS; original SQL and book activations unchanged; only fixture-owned auth mutations');
}finally{if(user)await db.$client.query('delete from "user" where id=$1',[user.id]);if(f)await f.close();else await db.$client.end();}
