import { bankChargeDocument, type Database } from '@factoryos/db';
import { Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf, lockAccounting, type Tx } from './accounting-lock.js';
import { bankChargeInput, BankChargeService } from './bank-charge.service.js';
@Controller('accounts/bank-charges')
export class BankChargesController {
 constructor(@Inject(DB) private readonly db:Database,private readonly charges:BankChargeService) {}
 private transaction<T>(ctx:TenantRequestContext,run:(tx:Tx,entityId:string)=>Promise<T>){const id=entityOf(ctx);return this.db.transaction(async tx=>{await lockAccounting(tx,id);return run(tx,id);});}
 @Get() @RequirePermission('accounts.bank_charge.read')
 list(@Ctx() ctx:TenantRequestContext){return this.db.select().from(bankChargeDocument).where(and(eq(bankChargeDocument.entityId,entityOf(ctx)),eq(bankChargeDocument.tenantId,ctx.tenant.tenantId))).orderBy(desc(bankChargeDocument.createdAt)).limit(500);}
 @Get(':id') @RequirePermission('accounts.bank_charge.read')
 async detail(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string){const [row]=await this.db.select().from(bankChargeDocument).where(and(eq(bankChargeDocument.id,id),eq(bankChargeDocument.entityId,entityOf(ctx)),eq(bankChargeDocument.tenantId,ctx.tenant.tenantId)));if(!row)throw new NotFoundException('Bank charge not found');return row;}
 @Post('preview') @RequirePermission('accounts.bank_charge.read')
 preview(@Ctx() ctx:TenantRequestContext,@Body() body:unknown){const input=parse(bankChargeInput,body);return this.transaction(ctx,(tx,id)=>this.charges.previewIn(tx,ctx,id,input));}
 @Post() @RequirePermission('accounts.bank_charge.create','accounts.bank_charge.submit')
 submit(@Ctx() ctx:TenantRequestContext,@Body() body:unknown){const input=parse(bankChargeInput,body);return this.transaction(ctx,(tx,id)=>this.charges.submitIn(tx,ctx,id,input,{kind:'standalone'}));}
 @Post(':id/cancel') @RequirePermission('accounts.bank_charge.cancel')
 cancel(@Ctx() ctx:TenantRequestContext,@Param('id',ParseUUIDPipe) id:string,@Body() body:unknown){const {reason}=parse(z.object({reason:z.string().trim().min(5).max(1000)}).strict(),body);return this.transaction(ctx,(tx,entity)=>this.charges.cancelIn(tx,ctx,entity,id,reason));}
}
