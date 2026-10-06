import {and,eq,inArray,isNull,or} from 'drizzle-orm';
import {gstSandboxSnapshot as snap,gstSandboxOperation as op} from './schema/gst-sandbox.js';
import type {Database} from './index.js';
type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
export async function assertSandboxSourceCancelableIn(tx:Tx,scope:{tenantId:string;entityId:string},sourceKind:string,sourceId:string):Promise<void>{
 const rows=await tx.select({id:op.id}).from(op).innerJoin(snap,eq(snap.id,op.snapshotId)).where(and(eq(op.tenantId,scope.tenantId),eq(op.entityId,scope.entityId),eq(snap.sourceKind,sourceKind),eq(snap.sourceId,sourceId),isNull(op.detachedAt),or(inArray(op.status,['queued','sending','unknown']),and(eq(op.status,'succeeded'),inArray(op.action,['irn.generate','ewb.generate','ewb.from_irn']))))).limit(1);if(rows.length)throw new Error('Resolve or cancel/detach sandbox exercises before cancelling the source');
}
