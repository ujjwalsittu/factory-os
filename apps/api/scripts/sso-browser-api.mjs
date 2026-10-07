import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import express from 'express';
import {toNodeHandler} from 'better-auth/node';
import {AppModule} from '../dist/app.module.js';
import {AUTH,DB} from '../dist/common/tokens.js';
import {syncOnStartup} from '../dist/bootstrap.js';
export async function startSsoBrowserApi(f,port){
 await syncOnStartup(f.config);
 const values={...f.env,PORT:String(port)},previous=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
 Object.assign(process.env,values);let app;
 try{app=await NestFactory.create(AppModule,{bodyParser:false,logger:false});const server=app.getHttpAdapter().getInstance();server.all('/api/auth/{*path}',toNodeHandler(app.get(AUTH)));app.use(express.json({limit:'1mb'}));app.setGlobalPrefix('api');await app.listen(port,'127.0.0.1');}
 finally{for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}
 return {async close(){await app.close();await app.get(DB).$client.end();}};
}
