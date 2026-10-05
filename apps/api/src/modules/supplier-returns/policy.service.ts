import { supplierReturnPolicy, type SupplierPolicy } from '@factoryos/db';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit.service.js';
import type { TenantRequestContext } from '../../common/access.js';
import { lockAccounting,type Tx } from '../accounting/accounting-lock.js';
export const DEFAULT_SUPPLIER_POLICY:SupplierPolicy={dispatchApproval:'pending_allowed',claimApproval:'every',approvalThresholdInr:'0',creditApplication:'automatic',rejectedAction:'keep_open'};
@Injectable()
export class SupplierReturnPolicyService {
 constructor(private readonly audit:AuditService){}
 async getIn(tx:Tx,ctx:TenantRequestContext,entityId:string):Promise<SupplierPolicy>{
 const [row]=await tx.select().from(supplierReturnPolicy).where(and(eq(supplierReturnPolicy.tenantId,ctx.tenant.tenantId),eq(supplierReturnPolicy.entityId,entityId)));
 if(!row)return {...DEFAULT_SUPPLIER_POLICY};
 return {dispatchApproval:row.dispatchApproval as SupplierPolicy['dispatchApproval'],claimApproval:row.claimApproval as SupplierPolicy['claimApproval'],approvalThresholdInr:row.approvalThresholdInr,creditApplication:row.creditApplication as SupplierPolicy['creditApplication'],rejectedAction:row.rejectedAction as SupplierPolicy['rejectedAction']};
 }
 async updateIn(tx:Tx,ctx:TenantRequestContext,entityId:string,input:SupplierPolicy):Promise<SupplierPolicy>{
 await lockAccounting(tx,entityId);const before=await this.getIn(tx,ctx,entityId);
 await tx.insert(supplierReturnPolicy).values({...input,tenantId:ctx.tenant.tenantId,entityId,updatedBy:ctx.user.id}).onConflictDoUpdate({target:supplierReturnPolicy.entityId,set:{...input,updatedBy:ctx.user.id,updatedAt:new Date()}});
 await this.audit.record(ctx,{tenantId:ctx.tenant.tenantId,entityId,action:'supplier_return_policy.update',targetType:'supplier_return_policy',targetId:entityId,before,after:input},tx);return this.getIn(tx,ctx,entityId);
 }
}
