import {Body,Controller,Get,Post} from '@nestjs/common';
import {Ctx,RequirePermission,type TenantRequestContext} from '../../common/access.js';
import {parse} from '../../common/validation.js';
import {SandboxConnectionsService,connectionInput} from './connections.service.js';
@Controller('compliance/sandbox')
export class GstSandboxController{
 constructor(private readonly connections:SandboxConnectionsService){}
 @Get('connections') @RequirePermission('compliance.sandbox_connection.read') list(@Ctx()ctx:TenantRequestContext){return this.connections.list(ctx)}
 @Post('connections') @RequirePermission('compliance.sandbox_connection.manage') save(@Ctx()ctx:TenantRequestContext,@Body()body:unknown){return this.connections.save(ctx,parse(connectionInput,body))}
}
