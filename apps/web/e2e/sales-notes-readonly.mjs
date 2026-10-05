import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {Client} from '../../api/scripts/accounting-test-helpers.mjs';
import {fixture} from '../../api/scripts/sales-notes-test-helpers.mjs';
const {c,input}=await fixture('Note approval without draft editing');
const note=await c.req('POST','/sales-notes',input(),201);
const role=await c.req('POST','/roles',{name:'Note approver',permissions:['selling.sales_note.read','selling.sales_note.submit']},201);
const viewer=new Client(),email=`notes-approver${Date.now()}@example.com`;
const invite=await c.req('POST','/invitations',{email,roles:[{roleId:role.id,entityIds:[c.entityId]}]},201);
await viewer.req('POST','/auth/sign-up/email',{name:'Note approver',email,password:'Sup3r-secret-pw'});
await viewer.req('POST','/invitations/accept',{token:invite.inviteUrl.split('/').at(-1)},201);
const B=process.env.WEB_URL??'http://localhost:3000';
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),ctx=await browser.newContext();
await ctx.addCookies(viewer.cookie.split('; ').map(cookie=>{const i=cookie.indexOf('=');return {name:cookie.slice(0,i),value:cookie.slice(i+1),url:B};}));
await ctx.addInitScript(({tenantId,entityId})=>{localStorage.setItem('fos.tenant',tenantId);localStorage.setItem(`fos.entity.${tenantId}`,entityId);},{tenantId:c.tenantId,entityId:c.entityId});
const page=await ctx.newPage();page.setDefaultTimeout(15000);
try{
 await page.goto(`${B}/app/selling/notes/${note.id}`);
 await page.getByText('Total: INR 40.000000',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).count(),0);
 assert.equal(await page.getByLabel('Taxable adjustment').isDisabled(),true);
 await page.getByRole('button',{name:'Submit note',exact:true}).click();
 await page.getByText('submitted',{exact:true}).waitFor();
 assert.equal((await c.req('GET',`/sales-notes/${note.id}`)).status,'submitted');
 console.log('PASS note approver sees saved totals and submits without editing permission');
}catch(e){await page.screenshot({path:'/tmp/sales-notes-readonly-failure.png',fullPage:true});await writeFile('/tmp/sales-notes-readonly-page.txt',await page.locator('body').innerText());throw e;}finally{await browser.close();}
