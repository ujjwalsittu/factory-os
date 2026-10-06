import {Body,Controller,Get,Param,ParseUUIDPipe,Post} from '@nestjs/common';
import {z} from 'zod';
import {Ctx,Public,PlatformAdmin,RequirePermission,type RequestContext,type TenantRequestContext} from '../../common/access.js';
import {parse} from '../../common/validation.js';
import {EmailService} from './email.service.js';
const reasonInput=z.object({reason:z.string().trim().min(3).max(500)});
@Controller('email')
export class EmailController{
 constructor(private readonly email:EmailService){}
 @Get('availability') @Public() availability(){return this.email.availability();}
 @Get('deliveries') @RequirePermission('settings.email.read') list(@Ctx()ctx:TenantRequestContext){return this.email.listTenant(ctx);}
 @Post('deliveries/:id/retry') @RequirePermission('settings.email.retry','settings.user.create') retry(@Ctx()ctx:TenantRequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()body:unknown){return this.email.retryInvitation(ctx,id,parse(reasonInput,body).reason);}
}
@Controller('platform/email') @PlatformAdmin()
export class PlatformEmailController{
 constructor(private readonly email:EmailService){}
 @Get('deliveries') list(@Ctx()ctx:RequestContext){return this.email.listPlatform(ctx);}
 @Get('health') health(@Ctx()ctx:RequestContext){return this.email.health(ctx);}
 @Post('deliveries/:id/renew') renew(@Ctx()ctx:RequestContext,@Param('id',ParseUUIDPipe)id:string,@Body()body:unknown){return this.email.renewOwner(ctx,id,parse(reasonInput,body).reason);}
}
