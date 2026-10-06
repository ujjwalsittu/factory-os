import {Body,Controller,Get,Post,Param,ParseUUIDPipe,Query} from '@nestjs/common';
import {Ctx,RequirePermission,type TenantRequestContext} from '../../common/access.js';
import {z} from 'zod';
import {SandboxOperationsService} from './operations.service.js';
import {preparationInput,enqueueInput,actionInput} from './contracts.js';
import {parse} from '../../common/validation.js';
import {SandboxConnectionsService,connectionInput} from './connections.service.js';
@Controller('compliance/sandbox')
export class GstSandboxController{
 constructor(private readonly connections:SandboxConnectionsService,private readonly operations:SandboxOperationsService){}
 @Get('connections') @RequirePermission('compliance.sandbox_connection.read') list(@Ctx()ctx:TenantRequestContext){return this.connections.list(ctx)}
 @Post('connections') @RequirePermission('compliance.sandbox_connection.manage') save(@Ctx()ctx:TenantRequestContext,@Body()body:unknown){return this.connections.save(ctx,parse(connectionInput,body))}


 @Get('registrations') @RequirePermission('compliance.sandbox_operation.read') registrations(@Ctx()ctx:TenantRequestContext){return this.operations.registrations(ctx)}
 @Get('sources') @RequirePermission('compliance.sandbox_operation.read') sources(@Ctx()ctx:TenantRequestContext,@Query()q:unknown){const x=parse(z.object({kind:z.enum(['sales_invoice','sales_note','purchase_return']),registrationId:z.string().uuid()}).strict(),q);return this.operations.sources(ctx,x.kind,x.registrationId)}
 @Post('snapshots') @RequirePermission('compliance.sandbox_operation.read') prepare(@Ctx()ctx:TenantRequestContext,@Body()b:unknown){return this.operations.prepare(ctx,parse(preparationInput,b))}
 @Post('snapshots/:id/approve') @RequirePermission('compliance.sandbox_valuation.approve') approve(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string){return this.operations.approve(ctx,id)}
 @Post('operations') @RequirePermission('compliance.sandbox_operation.read') enqueue(@Ctx()ctx:TenantRequestContext,@Body()b:unknown){return this.operations.enqueue(ctx,parse(enqueueInput,b))}
 @Get('operations') @RequirePermission('compliance.sandbox_operation.read') listOperations(@Ctx()ctx:TenantRequestContext){return this.operations.list(ctx)}
 @Get('operations/:id') @RequirePermission('compliance.sandbox_operation.read') get(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string){return this.operations.get(ctx,id)}
 @Post('operations/:id/actions') @RequirePermission('compliance.sandbox_operation.read') action(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){return this.operations.action(ctx,id,parse(actionInput,b))}
 @Post('operations/:id/detach') @RequirePermission('compliance.sandbox_detachment.approve') detach(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()b:unknown){return this.operations.detach(ctx,id,parse(z.object({reason:z.string().min(5).max(500)}).strict(),b).reason)}
}
