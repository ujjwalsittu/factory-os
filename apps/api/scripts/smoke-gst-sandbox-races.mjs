import assert from 'node:assert/strict';
import {createDb,gstSandboxSnapshot as snap,gstSandboxOperation as op,claimOperation,completeOperation,recoverExpiredLease} from '../../../packages/db/dist/index.js';
import {canonicalHash} from '../../../packages/gsp/dist/index.js';import {eq} from 'drizzle-orm';
import {fixture} from './gst-sandbox-test-helpers.mjs';
import {runSandboxOnce} from '../../worker/dist/sandbox-worker.js';
const {c,reg,snapshot}=await fixture(),actor=(await c.req('GET','/me')).user.id,scope={tenantId:c.tenantId,entityId:c.entityId,registrationId:reg.id};
const con=await c.req('POST','/compliance/sandbox/connections',{registrationId:reg.id,capability:'irn',provider:'mock'},201);const db=createDb(process.env.DATABASE_URL);
const seed=async(n,scenario='normal')=>{const s={...snapshot,number:n},[sn]=await db.insert(snap).values({...scope,sourceKind:'sample',documentType:'INV',documentNumber:n,fy:s.fy,payload:s,hash:canonicalHash(s),createdBy:actor}).returning();const command={action:'irn.generate',snapshot:s};const [row]=await db.insert(op).values({...scope,connectionId:con.id,snapshotId:sn.id,action:'irn.generate',generationKey:n,idempotencyKey:crypto.randomUUID(),command,commandHash:canonicalHash(command),connectionRevision:1,provider:'mock',scenario,createdBy:actor}).returning();return row};
try{
 const one=await seed('RACE-1');const claims=await Promise.all([claimOperation(db,'worker-a'),claimOperation(db,'worker-b')]);assert.equal(claims.filter(Boolean).length,1);const leased=claims.find(Boolean);assert.equal(leased.id,one.id);
 await db.update(op).set({leaseExpiresAt:new Date(Date.now()-1000)}).where(eq(op.id,one.id));assert.equal(await recoverExpiredLease(db),1);assert.equal(await completeOperation(db,leased.leaseToken,{kind:'confirmed',evidence:{status:'active'}}),false);assert.equal((await db.select().from(op).where(eq(op.id,one.id)))[0].status,'unknown');
 const two=await seed('RECOVERY-2','timeout_after_success');await runSandboxOnce(db);assert.equal((await db.select().from(op).where(eq(op.id,two.id)))[0].status,'unknown');
 const lookup={action:'irn.lookup',snapshot:two.command.snapshot};const [child]=await db.insert(op).values({...scope,connectionId:con.id,snapshotId:two.snapshotId,action:'irn.lookup',parentId:two.id,idempotencyKey:crypto.randomUUID(),command:lookup,commandHash:canonicalHash(lookup),connectionRevision:1,provider:'mock',scenario:'normal',createdBy:actor}).returning();await runSandboxOnce(db);const result=(await db.select().from(op).where(eq(op.id,two.id)))[0];assert.equal(result.status,'succeeded');assert.equal(result.attemptSequence,1);assert.ok(result.result.evidence.externalId);assert.equal((await db.select().from(op).where(eq(op.id,child.id)))[0].status,'succeeded');
 await assert.rejects(db.$client.query('update gst_sandbox_snapshot set document_number=$1 where id=$2',['CHANGED',two.snapshotId]),/append-only/);await assert.rejects(db.$client.query('delete from gst_sandbox_attempt where operation_id=$1',[two.id]),/append-only/);
 await assert.rejects(db.$client.query('update gst_sandbox_operation set command_hash=$1 where id=$2',['CHANGED',two.id]),/immutable/);
 console.log('PASS two-worker race, expired-lease fencing, durable timeout recovery and immutable evidence');
}finally{await db.$client.end()}
