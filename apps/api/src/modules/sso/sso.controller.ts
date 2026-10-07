import {Body,Controller,Get,Inject,Param,Post,Req} from '@nestjs/common';
import {z} from 'zod';
import type {Request} from 'express';
import {fromNodeHeaders} from 'better-auth/node';
import {Ctx,Public,type RequestContext} from '../../common/access.js';
import {AUTH} from '../../common/tokens.js';
import {parse} from '../../common/validation.js';
import type {Auth} from '../../auth.js';
import {SsoService} from './sso.service.js';
const actionInput=z.object({provider:z.enum(['google','microsoft']),kind:z.enum(['link','unlink']),targetBindingId:z.string().min(1).max(256).optional(),password:z.string().min(1).max(1024)}).strict().refine(v=>(v.kind==='unlink')===Boolean(v.targetBindingId));
const disconnectInput=z.object({nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
@Controller('sso')
export class SsoController {
 constructor(private readonly sso:SsoService,@Inject(AUTH)private readonly auth:Auth){}
 @Get('providers') @Public() providers(){return this.sso.availability();}
 @Get('methods') methods(@Ctx()ctx:RequestContext){return this.sso.listMethods(ctx);}
 @Post('actions') action(@Ctx()ctx:RequestContext,@Req()req:Request,@Body()body:unknown){
  const input=parse(actionInput,body);
  return this.sso.issueAction(ctx,{provider:input.provider,kind:input.kind,targetAccountId:input.targetBindingId},async()=>{
   try{return (await this.auth.api.verifyPassword({body:{password:input.password},headers:fromNodeHeaders(req.headers)})).status;}catch{return false;}
  });
 }
 @Post('methods/:id/disconnect') async disconnect(@Ctx()ctx:RequestContext,@Req()req:Request,@Param('id')id:string,@Body()body:unknown){
  const input=parse(disconnectInput,body),binding=await this.sso.disconnectAction(ctx,id,input.nonce),headers=fromNodeHeaders(req.headers);
  headers.set('x-factoryos-sso-action',input.nonce);
  // Native unlink expects the local account row ID, never a provider subject.
  await this.auth.api.unlinkAccount({headers,body:{accountId:binding.id}});return {status:true};
 }
}
