import {SupplierReturnResolutionService} from './resolution.service.js';
import {SupplierNoteService} from './note.service.js';
import {SupplierNotePreviewService} from './preview.service.js';
import {SupplierReturnMovementService} from './movement.service.js';
import {Body,Controller,Delete,Get,Inject,Param,ParseUUIDPipe,Post,Put} from '@nestjs/common';
import type {Database} from '@factoryos/db';
import {z} from 'zod';
import {Ctx,RequirePermission,type TenantRequestContext} from '../../common/access.js';
import {DB} from '../../common/tokens.js';
import {parse} from '../../common/validation.js';
import {entityOf,lockAccounting,type Tx} from '../accounting/accounting-lock.js';
import {claimSchema,policySchema,dispatchSchema,noteSchema,resolutionSchema} from './contracts.js';
import {SupplierReturnPolicyService} from './policy.service.js';
import {SupplierReturnClaimService} from './claim.service.js';
@Controller('buying')
export class SupplierReturnsController {
 constructor(@Inject(DB)private readonly db:Database,private readonly policy:SupplierReturnPolicyService,private readonly claims:SupplierReturnClaimService,private readonly movement:SupplierReturnMovementService,private readonly notes:SupplierNoteService,private readonly preview:SupplierNotePreviewService,private readonly resolutions:SupplierReturnResolutionService){}
 private run<T>(ctx:TenantRequestContext,f:(tx:Tx,e:string)=>Promise<T>){const e=entityOf(ctx);return this.db.transaction(async tx=>{await lockAccounting(tx,e);return f(tx,e);});}
 @Get('return-policy') @RequirePermission('buying.return_policy.read') getPolicy(@Ctx()ctx:TenantRequestContext){return this.run(ctx,(tx,e)=>this.policy.getIn(tx,ctx,e));}
 @Put('return-policy') @RequirePermission('buying.return_policy.update') updatePolicy(@Ctx()ctx:TenantRequestContext,@Body()b:unknown){const input=parse(policySchema,b);return this.run(ctx,(tx,e)=>this.policy.updateIn(tx,ctx,e,input));}
 @Get('return-claims') @RequirePermission('buying.return_claim.read') list(@Ctx()ctx:TenantRequestContext){return this.run(ctx,(tx,e)=>this.claims.listIn(tx,ctx,e));}
 @Get('return-claims/:id') @RequirePermission('buying.return_claim.read') get(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string){return this.run(ctx,(tx,e)=>this.claims.getIn(tx,ctx,e,id));}
 @Post('return-claims') @RequirePermission('buying.return_claim.create') create(@Ctx()ctx:TenantRequestContext,@Body()b:unknown){const input=parse(claimSchema,b);return this.run(ctx,(tx,e)=>this.claims.saveIn(tx,ctx,e,input));}
 @Put('return-claims/:id') @RequirePermission('buying.return_claim.update') update(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){const input=parse(claimSchema,b);return this.run(ctx,(tx,e)=>this.claims.saveIn(tx,ctx,e,input,id));}
 @Post('return-claims/:id/submit') @RequirePermission('buying.return_claim.submit') submit(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string){return this.run(ctx,(tx,e)=>this.claims.submitIn(tx,ctx,e,id));}
 @Post('return-claims/:id/approve') @RequirePermission('buying.return_claim.approve') approve(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){const {reason}=parse(z.object({reason:z.string().trim().min(5).max(500)}).strict(),b);return this.run(ctx,(tx,e)=>this.claims.approveIn(tx,ctx,e,id,reason));}
 @Post('return-claims/:id/reject') @RequirePermission('buying.return_claim.approve') reject(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){const input=parse(z.object({reason:z.string().trim().min(5).max(500),lines:z.array(z.object({claimLineId:z.uuid(),qty:z.string().regex(/^\d{1,18}(?:\.\d{1,6})?$/),taxableAmount:z.string().regex(/^\d{1,18}(?:\.\d{1,6})?$/)}).strict()).min(1).max(300)}).strict(),b);return this.run(ctx,(tx,e)=>this.claims.rejectIn(tx,ctx,e,id,input));}
 @Delete('return-claims/:id') @RequirePermission('buying.return_claim.update') remove(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string){return this.run(ctx,(tx,e)=>this.claims.deleteIn(tx,ctx,e,id));}
 @Post('return-claims/:id/dispatch-preview') @RequirePermission('buying.return_movement.create') dispatchPreview(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){const input=parse(dispatchSchema,b);return this.run(ctx,(tx,e)=>this.movement.previewDispatchIn(tx,ctx,e,id,input));}
 @Post('return-claims/:id/dispatch') @RequirePermission('buying.return_movement.create') dispatch(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){const input=parse(dispatchSchema,b);return this.run(ctx,(tx,e)=>this.movement.dispatchIn(tx,ctx,e,id,input));}
 @Get('supplier-notes') @RequirePermission('buying.supplier_note.read') listNotes(@Ctx()ctx:TenantRequestContext){return this.run(ctx,(tx,e)=>this.notes.listIn(tx,ctx,e));}
 @Get('supplier-notes/:id') @RequirePermission('buying.supplier_note.read') getNote(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string){return this.run(ctx,(tx,e)=>this.notes.getIn(tx,ctx,e,id));}
 @Post('supplier-notes/preview') @RequirePermission('buying.supplier_note.create') previewNote(@Ctx()ctx:TenantRequestContext,@Body()b:unknown){const input=parse(noteSchema,b);return this.run(ctx,(tx,e)=>this.preview.calculateIn(tx,ctx,e,input));}
 @Post('supplier-notes') @RequirePermission('buying.supplier_note.create') createNote(@Ctx()ctx:TenantRequestContext,@Body()b:unknown){const input=parse(noteSchema,b);return this.run(ctx,(tx,e)=>this.notes.saveIn(tx,ctx,e,input));}
 @Put('supplier-notes/:id') @RequirePermission('buying.supplier_note.update') updateNote(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){const input=parse(noteSchema,b);return this.run(ctx,(tx,e)=>this.notes.saveIn(tx,ctx,e,input,id));}
 @Post('supplier-notes/:id/submit') @RequirePermission('buying.supplier_note.submit') submitNote(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string){return this.run(ctx,(tx,e)=>this.notes.submitIn(tx,ctx,e,id));}
 @Delete('supplier-notes/:id') @RequirePermission('buying.supplier_note.update') removeNote(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string){return this.run(ctx,(tx,e)=>this.notes.deleteIn(tx,ctx,e,id));}
 @Post('supplier-notes/:id/cancel') @RequirePermission('buying.supplier_note.cancel') cancelNote(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){const {reason}=parse(z.object({reason:z.string().trim().min(5).max(500)}).strict(),b);return this.run(ctx,(tx,e)=>this.notes.cancelIn(tx,ctx,e,id,reason));}
 @Post('return-claims/:id/resolutions') @RequirePermission('buying.return_claim.read') resolve(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){const input=parse(resolutionSchema,b);return this.run(ctx,(tx,e)=>this.resolutions.postIn(tx,ctx,e,id,input));}
 @Post('return-resolutions/:id/cancel') @RequirePermission('buying.return_resolution.cancel') cancelResolution(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){const {reason}=parse(z.object({reason:z.string().trim().min(5).max(500)}).strict(),b);return this.run(ctx,(tx,e)=>this.resolutions.cancelIn(tx,ctx,e,id,reason));}
 @Post('return-claims/:id/cancel') @RequirePermission('buying.return_claim.cancel') cancelClaim(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){const {reason}=parse(z.object({reason:z.string().trim().min(5).max(500)}).strict(),b);return this.run(ctx,(tx,e)=>this.claims.cancelIn(tx,ctx,e,id,reason));}
 @Post('return-movements/:id/cancel') @RequirePermission('buying.return_movement.cancel') cancelMovement(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){const {reason}=parse(z.object({reason:z.string().trim().min(5).max(500)}).strict(),b);return this.run(ctx,(tx,e)=>this.movement.cancelIn(tx,ctx,e,id,reason));}
}
