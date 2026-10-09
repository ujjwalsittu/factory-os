import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createDb} from '../../../packages/db/dist/index.js';
import {startPasskeyFixture,isolatedPasskeysDatabase,capturePasskeyBaseline,assertPasskeyBaseline} from './passkeys-test-helpers.mjs';
import {enrollment,primary} from './passkeys-authenticator-fixture.mjs';
const source=createDb(process.env.DATABASE_URL),original=await capturePasskeyBaseline(source),saved=JSON.parse(await readFile(new URL(process.env.PASSKEY_BASELINE_FILE??'../../../docs/superpowers/reviews/2026-10-08-passkeys-baseline.json',import.meta.url),'utf8'));
for(const [table,book] of Object.entries(original.books)){assert(book.count>0,'actual populated '+table);assert.deepEqual(book,saved.books[table]);}
for(const row of saved.activations)assert.deepEqual(original.activations.find(a=>a.entity_id===row.entity_id),row);
for(const [name,hash] of Object.entries(saved.hashes))assert.equal(original.hashes[name],hash);
const sourceJournal=(await source.$client.query('select id,hash,created_at from drizzle.__drizzle_migrations order by id')).rows;
const historical={};for(const table of ['user','account','session','verification','passkey'])historical[table]=(await source.$client.query(`select row_to_json(t)::jsonb value from "${table}" t order by id`)).rows.map(r=>r.value);
let f;
try{
 const copied=await isolatedPasskeysDatabase({populated:true,reconcileUnpublishedCopy:true});f=await startPasskeyFixture({},copied);await assertPasskeyBaseline(f.db,original);assert((await f.db.$client.query("select to_regclass('inspection_record') is not null as quality")).rows[0].quality,'copied upgrade includes published quality');
 for(const table of Object.keys(historical)){const prior=historical[table],after=(await f.db.$client.query(`select row_to_json(t)::jsonb value from "${table}" t order by id`)).rows.map(r=>r.value);assert.equal(after.length,prior.length);for(let i=0;i<after.length;i++){for(const field of Object.keys(after[i]).filter(k=>k.startsWith('passkey_')&&!(k in prior[i]))){assert.equal(after[i][field],field==='passkey_pending'?false:null);delete after[i][field];}assert.deepEqual(after[i],prior[i]);}}
 const owner=await f.localUser('passkey-invariance-'+randomUUID()+'@example.test'),e=await enrollment(f,owner);assert.equal(e.result.status,200);const signin=await primary(f,e.key);assert.equal(signin.result.status,200);const current=(await f.request('/get-session',undefined,signin.cookies)).data;assert.equal(current.user.id,owner.id);
 const renamed=await f.request('/api/passkeys/actions',{kind:'rename',targetId:e.result.data.id,password:'Synthetic-password-123'},owner.cookies);assert.equal(renamed.status,200);assert.equal((await f.request('/api/passkeys/methods/'+e.result.data.id+'/rename',{nonce:renamed.data.nonce,name:'Personal recovery key'},owner.cookies)).status,200);
 f.config.passkeys.enabled=false;f.config.passkeys.rpId='changed.example';const proof=await f.request('/api/passkeys/actions',{kind:'remove',targetId:e.result.data.id,password:'Synthetic-password-123'},owner.cookies);assert.equal(proof.status,200);assert.equal((await f.request('/api/passkeys/methods/'+e.result.data.id+'/remove',{nonce:proof.data.nonce},owner.cookies)).status,200);assert.equal((await f.request('/get-session',undefined,signin.cookies)).data,null);assert.equal((await f.request('/get-session',undefined,owner.cookies)).data.user.id,owner.id);
 assert.equal((await f.db.$client.query("select count(*)::int n from auth_passkey_event where user_id=$1 and kind in ('enrolled','signed_in','renamed','removed')",[owner.id])).rows[0].n,4);
 await assertPasskeyBaseline(f.db,original);await assertPasskeyBaseline(source,original);assert.deepEqual((await source.$client.query('select id,hash,created_at from drizzle.__drizzle_migrations order by id')).rows,sourceJournal);
 console.log('Passkeys populated copied upgrade/invariance PASS '+JSON.stringify(Object.fromEntries(Object.entries(original.books).map(([t,v])=>[t,v.count])))+'; saved activation records/original SQL hashes and historical pending/completed auth preserved; existing audit chain bytes unchanged; shared database read-only');
}finally{if(f)await f.close();await source.$client.end();}
