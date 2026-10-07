import {spawn} from 'node:child_process';
import net from 'node:net';
import {mkdir,cp} from 'node:fs/promises';
import {startSsoFixture} from '../../api/scripts/sso-test-helpers.mjs';
import {startSsoBrowserApi} from '../../api/scripts/sso-browser-api.mjs';
export async function ssoBrowserFixture(){
 const api=process.env.API??'http://localhost:4000',web=process.env.WEB_URL??process.env.WEB_ORIGIN??'http://localhost:3000';
 for(const address of [api,web]){const target=new URL(address);if(target.protocol!=='http:'||!['localhost','127.0.0.1'].includes(target.hostname))throw new Error('SSO browser fixture requires loopback');const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(Number(target.port),'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));}
 const f=await startSsoFixture({BETTER_AUTH_URL:web,WEB_ORIGIN:web});let runtime,child;
 const close=async()=>{if(child?.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}if(runtime)await runtime.close();await f.close();};
 try{
  runtime=await startSsoBrowserApi(f,Number(new URL(api).port));
  await mkdir(new URL('../.next/standalone/apps/web/.next',import.meta.url),{recursive:true});await cp(new URL('../.next/static',import.meta.url),new URL('../.next/standalone/apps/web/.next/static',import.meta.url),{recursive:true});
  child=spawn(process.execPath,['.next/standalone/apps/web/server.js'],{cwd:new URL('../',import.meta.url).pathname,env:{...process.env,...f.env,NODE_ENV:'production',API_INTERNAL_URL:api,PORT:new URL(web).port,HOSTNAME:'127.0.0.1'},stdio:['ignore','ignore','ignore']});
  let ready=false;for(let n=0;n<450;n++){try{if((await fetch(web+'/sign-in')).status===200){ready=true;break;}}catch{}if(child.exitCode!==null)throw new Error('SSO browser web stopped');await new Promise(r=>setTimeout(r,100));}if(!ready)throw new Error('SSO browser web not ready');
  return {...f,api,web,choice:{email:'owner@example.test',subject:'google-browser'},close,async routeProviders(page){
   const fixture=this;
   for(const prefix of ['https://accounts.google.com/o/oauth2/v2/auth','https://login.microsoftonline.com/'])await page.route(prefix+'**',async route=>{const input={...fixture.choice};if(route.request().url().includes('microsoftonline'))input.subject='microsoft-browser';const code=f.provider.authorize(route.request().url(),input);if(fixture.beforeCallback)await fixture.beforeCallback(code);const callback=input.denied?code.record.redirectUri+'?'+new URLSearchParams({state:code.state,error:'access_denied',error_description:'never-render-this'}):code.callback;await route.fulfill({status:302,headers:{location:callback},body:''});});
  }};
 }catch(error){await close();throw error;}
}
