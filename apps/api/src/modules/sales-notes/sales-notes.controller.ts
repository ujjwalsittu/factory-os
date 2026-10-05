import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import type { Database } from '@factoryos/db';
import {z} from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf,lockAccounting,type Tx } from '../accounting/accounting-lock.js';
import { noteInput } from './sales-notes.contracts.js';
import { SalesNotePreviewService } from './sales-note-preview.service.js';
import { SalesNoteService } from './sales-note.service.js';
@Controller('sales-notes')
export class SalesNotesController {
 constructor(@Inject(DB) private readonly db:Database,private readonly preview:SalesNotePreviewService,private readonly notes:SalesNoteService){}
 private run<T>(ctx:TenantRequestContext,f:(tx:Tx,entityId:string)=>Promise<T>){const entityId=entityOf(ctx);return this.db.transaction(async tx=>{await lockAccounting(tx,entityId);return f(tx,entityId);});}
 @Get() @RequirePermission('selling.sales_note.read') list(@Ctx()ctx:TenantRequestContext){return this.run(ctx,(tx,e)=>this.notes.listIn(tx,ctx,e));}
 @Get(':id') @RequirePermission('selling.sales_note.read') get(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string){return this.run(ctx,(tx,e)=>this.notes.getIn(tx,ctx,e,id));}
 @Post('preview') @RequirePermission('selling.sales_note.create') previewNote(@Ctx()ctx:TenantRequestContext,@Body()body:unknown){const input=parse(noteInput,body);return this.run(ctx,(tx,e)=>this.preview.previewIn(tx,ctx,e,input));}
 @Post() @RequirePermission('selling.sales_note.create') create(@Ctx()ctx:TenantRequestContext,@Body()body:unknown){const input=parse(noteInput,body);return this.run(ctx,(tx,e)=>this.notes.saveIn(tx,ctx,e,input));}
 @Put(':id') @RequirePermission('selling.sales_note.update') update(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()body:unknown){const input=parse(noteInput,body);return this.run(ctx,(tx,e)=>this.notes.saveIn(tx,ctx,e,input,id));}
 @Post(':id/submit') @RequirePermission('selling.sales_note.submit') submit(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string){return this.run(ctx,(tx,e)=>this.notes.submitIn(tx,ctx,e,id));}
 @Post(':id/cancel') @RequirePermission('selling.sales_note.cancel') async cancel(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()body:unknown){const {reason}=parse(z.object({reason:z.string().trim().min(5).max(500)}),body);await this.run(ctx,(tx,e)=>this.notes.cancelIn(tx,ctx,e,id,reason));return {ok:true};}
 @Delete(':id') @RequirePermission('selling.sales_note.update') async remove(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string){await this.run(ctx,(tx,e)=>this.notes.deleteIn(tx,ctx,e,id));return {ok:true};}
}
