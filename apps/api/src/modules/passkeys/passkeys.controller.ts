import {Body,Controller,Get,HttpCode,Inject,Param,Post,Req,Res} from '@nestjs/common';
import type {Request,Response} from 'express';
import {fromNodeHeaders} from 'better-auth/node';
import {z} from 'zod';
import {AUTH} from '../../common/tokens.js';
import {Ctx,Public,type RequestContext} from '../../common/access.js';
import {parse} from '../../common/validation.js';
import type {Auth} from '../../auth.js';
import {PasskeysService} from './passkeys.service.js';
const actionInput=z.object({kind:z.enum(['register','rename','remove']),targetId:z.string().min(1).max(256).optional(),password:z.string().min(1).max(1024)}).strict().refine(v=>(v.kind==='register')===!v.targetId);
const proof=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const renameInput=z.object({nonce:proof,name:z.string().trim().min(1).max(80)}).strict();
const removeInput=z.object({nonce:proof}).strict();
function cookies(res:Response,headers:Headers){for(const cookie of headers.getSetCookie())res.append('set-cookie',cookie);}
@Controller('passkeys')
export class PasskeysController{
 constructor(private readonly service:PasskeysService,@Inject(AUTH)private readonly auth:Auth){}
 @Get('availability') @Public() availability(){return this.service.availability();}
 @Get('methods') methods(@Ctx()ctx:RequestContext){return this.service.listMethods(ctx);}
 @Post('actions') @HttpCode(200) action(@Ctx()ctx:RequestContext,@Req()req:Request,@Body()body:unknown){const input=parse(actionInput,body);return this.service.issueAction(ctx,{kind:input.kind,targetId:input.targetId},async()=>{try{return (await this.auth.api.verifyPassword({headers:fromNodeHeaders(req.headers),body:{password:input.password}})).status;}catch{return false;}});}
 @Post('methods/:id/rename') @HttpCode(200) async rename(@Ctx()ctx:RequestContext,@Param('id')id:string,@Req()req:Request,@Body()body:unknown,@Res({passthrough:true})res:Response){const input=parse(renameInput,body);const result=await this.service.rename(ctx,id,input.nonce,input.name,fromNodeHeaders(req.headers));cookies(res,result.headers);return result.method;}
 @Post('methods/:id/remove') @HttpCode(200) async remove(@Ctx()ctx:RequestContext,@Param('id')id:string,@Req()req:Request,@Body()body:unknown,@Res({passthrough:true})res:Response){const input=parse(removeInput,body);const result=await this.service.remove(ctx,id,input.nonce,fromNodeHeaders(req.headers));cookies(res,result.headers);return {status:result.status,reauthenticate:result.reauthenticate};}
}
