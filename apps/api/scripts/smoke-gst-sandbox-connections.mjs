import assert from 'node:assert/strict';
import {fixture} from './gst-sandbox-test-helpers.mjs';
const {c,reg}=await fixture();
const root='/compliance/sandbox/connections';const con=await c.req('POST',root,{registrationId:reg.id,capability:'irn',provider:'mock'},201);assert.equal(con.environment,'sandbox');assert.equal(con.credentialConfigured,false);
await c.req('POST',root,{registrationId:reg.id,capability:'ewb',provider:'mock',environment:'production'},400);
await c.req('POST',root,{registrationId:reg.id,capability:'ewb',provider:'mock',endpoint:'https://evil.invalid'},400);
const list=await c.req('GET',root);assert.ok(!JSON.stringify(list).includes('envelope'));await c.req('POST',root,{registrationId:crypto.randomUUID(),capability:'ewb',provider:'mock'},404);
console.log(`PASS sandbox scoped connections ${c.checks} API checks`);
