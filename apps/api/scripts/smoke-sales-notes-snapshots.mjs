import assert from 'node:assert/strict';
import {createDb} from '../../../packages/db/dist/index.js';
import {fixture} from './sales-notes-test-helpers.mjs';
const {c,input,reg}=await fixture('Immutable note seller snapshots');
const note=await c.req('POST','/sales-notes',input(),201);
const submitted=await c.req('POST',`/sales-notes/${note.id}/submit`,{},201);
const db=createDb(process.env.DATABASE_URL);
try{
 await db.$client.query("update legal_entity set legal_name='Later legal name' where id=$1",[c.entityId]);
 await db.$client.query('update gst_registration set address=$1 where id=$2',[JSON.stringify({line1:'Later seller address'}),reg.id]);
 const printed=await c.req('GET',`/sales-notes/${note.id}`);
 assert.equal(printed.entityName,submitted.entityName);
 assert.equal(printed.ourGstin,submitted.ourGstin);
 assert.deepEqual(printed.ourAddress,submitted.ourAddress);
 console.log('PASS submitted note seller snapshots survive later master edits',c.checks);
}finally{await db.$client.end();}
