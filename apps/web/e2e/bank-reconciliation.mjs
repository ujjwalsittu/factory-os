import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {createDb} from '../../../packages/db/dist/index.js';
const db=createDb(process.env.DATABASE_URL);
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
);
const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  }),
  page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [],apiFailures=[];
page.on('response',async r=>{if(r.url().includes('/api/accounts')&&r.status()>=400)apiFailures.push({path:new URL(r.url()).pathname,status:r.status(),body:await r.json().catch(()=>null)});});
page.on('pageerror', (e) => errors.push(e.message));
const L = (t) => page.getByLabel(t, { exact: true });
try {
  console.log('→ onboard accounting tenant');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Finance Lead');
  await L('Work email').fill(`acct${Date.now()}@example.com`);
  await L('Password').fill('Sup3r-secret-pw');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding');
  await L('Workspace (company group) name').fill('GL Browser');
  await L('Legal name').fill('GL Private Limited');
  await L('Short name').fill('GL Browser');
  await L('Code').fill('GL');
  await L('PAN').fill('AAACA1234B');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL('**/app');
  await page.goto(`${B}/app/accounts/setup`);
  await page.getByText('Choose a legal entity', { exact: true }).waitFor();
  await page
    .locator('main')
    .getByRole('button', { name: 'GL Browser', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Save opening worksheet', exact: true })
    .waitFor();
  await page.goto(`${B}/app/accounts/trial-balance`);
  await page
    .getByText(
      'Accounting inactive. These books exclude operational transactions and have no reconciled opening balances.',
      { exact: true },
    )
    .waitFor();
  await page.goto(`${B}/app/accounts/setup`);
  await page
    .getByRole('button', { name: 'Save opening worksheet', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Review reconciliation', exact: true })
    .click();
  await page.getByText('Ready to activate', { exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'Activate accounting', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm cut-over', exact: true })
    .click();
  await page.getByText('Accounting active', { exact: true }).waitFor();
  await page.goto(`${B}/app/accounts/bank-reconciliation`);
  await page.getByRole('heading',{name:'Bank reconciliation',exact:true}).waitFor();
  await page.getByRole('link',{name:'Configure bank',exact:true}).click();
  await L('Bank account').selectOption({label:'Bank'});
  await L('Masked bank identifier').fill('••1234');
  await L('Date format').selectOption('YYYY-MM-DD');
  await L('Amount mode').selectOption('signed');
  await L('Amount column').fill('Amount');
  await page.getByRole('button',{name:'Save bank profile',exact:true}).click();
  await page.waitForURL('**/app/accounts/bank-reconciliation');
  const me=await (await ctx.request.get(`${B}/api/me`)).json(),tenantId=me.tenants[0].id,entityId=(await (await ctx.request.get(`${B}/api/entities`,{headers:{'x-tenant-id':tenantId}})).json())[0].id;
  const headers={'x-tenant-id':tenantId,'x-entity-id':entityId,Origin:B};
  const settings=await (await ctx.request.get(`${B}/api/accounts/settings`,{headers})).json(),date=settings.cutoverDate;
  const prior=new Date(`${date}T00:00:00Z`);prior.setUTCDate(prior.getUTCDate()-1);const previous=prior.toISOString().slice(0,10);
  // This newly activated empty browser entity alone gets the approved synthetic clock fixture.
  await db.$client.query('update accounting_settings set cutover_date=$1 where entity_id=$2',[previous,entityId]);
  await L('Baseline date').fill(previous);
  await L('Statement opening balance').fill('0');
  await L('Baseline reference').fill('Browser opening');
  await L('Baseline evidence').fill('Reviewed empty opening statement');
  await page.getByRole('button',{name:'Review baseline',exact:true}).click();
  await page.getByText('Baseline difference: 0.000000',{exact:true}).waitFor();
  await L('Baseline evidence').fill('Changed review evidence');
  assert.equal(await page.getByRole('button',{name:'Activate baseline',exact:true}).count(),0);
  await page.getByRole('button',{name:'Review baseline',exact:true}).click();
  await page.getByRole('button',{name:'Activate baseline',exact:true}).click();
  await page.getByText('Active baseline',{exact:true}).waitFor();
  const next=date;
  await L('Statement start').fill(next);await L('Statement end').fill(next);await L('Import opening balance').fill('0');await L('Import closing balance').fill('0');
  await L('Statement CSV').setInputFiles({name:'quiet.csv',mimeType:'text/csv',buffer:Buffer.from('Date,Ref,Description,Amount')});
  await page.getByRole('button',{name:'Stage statement',exact:true}).click();
  await page.getByRole('button',{name:'Submit statement',exact:true}).click();
  await page.getByText('Statement submitted',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Return to reconciliation',exact:true}).click();
  await L('Report date').fill(next);await page.getByRole('button',{name:'Review dated report',exact:true}).click();
  await page.getByText('Complete statement coverage',{exact:true}).waitFor();
  await L('I reviewed the remaining uncleared book items').check();
  await page.getByRole('button',{name:'Approve period',exact:true}).click();
  const frozenPrint=await page.getByRole('link',{name:'Print approved report',exact:true}).getAttribute('href');
  await page.getByRole('link',{name:'Print approved report',exact:true}).click();
  await page.getByRole('heading',{name:'Approved bank reconciliation',exact:true}).waitFor();
  await page.getByText('Statement balance: 0.000000',{exact:true}).waitFor();
  await page.goto(`${B}/app/accounts/bank-reconciliation`);
  console.log('→ reopen frozen revision and exercise actual sources');
  await L('Period reopening reason').fill('Review real sources after browser approval');
  await page.getByRole('button',{name:'Reopen period',exact:true}).click();
  await page.getByText(/Reopened: Review real sources/).waitFor();
  await L('Import reversal reason').fill('Replace quiet statement with actual bank movements');
  await page.getByRole('button',{name:'Reverse import',exact:true}).click();
  await page.getByRole('cell',{name:'reversed',exact:true}).waitFor();
  const request=async(method,path,data,status=200)=>{const response=await ctx.request[method](`${B}/api${path}`,{headers,...data===undefined?{}:{data}});assert.equal(response.status(),status,await response.text());return response.json();};
  const accounts=await request('get','/accounts/accounts'),bank=accounts.find(x=>x.role==='bank'),equity=accounts.find(x=>x.role==='equity'),expense=accounts.find(x=>x.role==='bank_charges');
  const profile=(await request('get','/accounts/bank-reconciliation/profiles'))[0],path=`/accounts/bank-reconciliation/profiles/${profile.id}`;
  const secondAccount=await request('post','/accounts/accounts',{code:'BANK-TWO',name:'Second browser bank',groupId:bank.groupId},201),secondProfile=await request('post','/accounts/bank-reconciliation/profiles',{accountId:secondAccount.id,maskedIdentifier:'••5678',currency:'INR',mapping:(await request('get',path)).mapping.mapping},201);
  const secondBaseline={date:previous,bankBalance:'0',reference:'Second empty bank',evidence:'Isolated browser evidence',outstanding:[]},secondReview=await request('post',`/accounts/bank-reconciliation/profiles/${secondProfile.id}/baseline/preview`,secondBaseline,201);
  await request('post',`/accounts/bank-reconciliation/profiles/${secondProfile.id}/baseline/activate`,{...secondBaseline,reviewedHash:secondReview.previewHash},201);
  const olderAccount=await request('post','/accounts/accounts',{code:'BANK-OLDER',name:'Older evidence bank',groupId:bank.groupId},201),older=await request('post','/accounts/journals',{postingDate:date,narration:'Original older bank source',lines:[{accountId:olderAccount.id,debit:'100',credit:'0'},{accountId:equity.id,debit:'0',credit:'100'}]},201);await request('post',`/accounts/journals/${older.id}/submit`,{});const olderEntry=(await request('get',`/accounts/journals/${older.id}`)).entries.find(x=>x.accountId===olderAccount.id),olderProfile=await request('post','/accounts/bank-reconciliation/profiles',{accountId:olderAccount.id,maskedIdentifier:'••9012',currency:'INR',mapping:(await request('get',path)).mapping.mapping},201),olderInput={date,bankBalance:'0',reference:'Original pending bank credit',evidence:'Reviewed original bank ledger',outstanding:[{date,signedAmount:'100',reference:'Older credit',reason:'Credit not yet on bank statement',evidence:'Original pending credit advice',glEntryId:olderEntry.id}]},olderReview=await request('post',`/accounts/bank-reconciliation/profiles/${olderProfile.id}/baseline/preview`,olderInput,201);await request('post',`/accounts/bank-reconciliation/profiles/${olderProfile.id}/baseline/activate`,{...olderInput,reviewedHash:olderReview.previewHash},201);
  await page.reload();await L('Reconciliation bank').selectOption(olderProfile.id);await page.getByText('Credit not yet on bank statement · Original pending credit advice',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'View older source voucher',exact:true}).getAttribute('href'),`/app/accounts/journals/${older.id}`);await L('Reconciliation bank').selectOption(profile.id);
  const books=[];
  for(let i=0;i<2;i++){const doc=await request('post','/accounts/journals',{postingDate:date,narration:`Browser exact bank ${i}`,lines:[{accountId:bank.id,debit:'100',credit:'0'},{accountId:equity.id,debit:'0',credit:'100'}]},201);await request('post',`/accounts/journals/${doc.id}/submit`,{});books.push((await request('get',`/accounts/journals/${doc.id}`)).entries.find(x=>x.accountId===bank.id));}
  const customer=await request('post','/parties',{code:'BANK-NET',name:'Net browser customer',isCustomer:true,gstTreatment:'unregistered'},201),receipt=await request('post','/accounts/settlements',{direction:'receipt',partyId:customer.id,postingDate:date,currency:'INR',exchangeRate:'1',accountId:bank.id,amount:'90000',allocations:[],bankReference:'NET',charge:{postingDate:date,bankAccountId:bank.id,expenseAccountId:expense.id,baseAmount:'100',gst:{cgst:'0',sgst:'0',igst:'0',cess:'0'},reference:'BROWSER-NET-FEE',evidence:{document:'Bank fee advice',reason:'Actual receipt deducted fee'},itcEligible:false}},201);await request('post',`/accounts/settlements/${receipt.id}/submit`,{});
  await page.reload();await L('Reconciliation bank').selectOption(profile.id);
  const csv=`Date,Ref,Description,Amount\n${date},REPEAT,"=SUM(1,2)",100\n${date},REPEAT,"=SUM(1,2)",100\n${date},NET,Gross receipt,90000\n${date},FEE,Actual receipt fee,-100`;
  const upload=async(content)=>{await L('Statement start').fill(date);await L('Statement end').fill(date);await L('Import opening balance').fill('0');await L('Import closing balance').fill('90100');await L('Statement CSV').setInputFiles({name:'actual.csv',mimeType:'text/csv',buffer:Buffer.from(content)});await page.getByRole('button',{name:'Stage statement',exact:true}).click();await page.getByRole('heading',{name:'Original statement evidence',exact:true}).waitFor();};
  await upload(csv);await page.getByRole('button',{name:'Submit statement',exact:true}).click();await page.getByText('Statement submitted',{exact:true}).waitFor();
  const firstImportId=new URL(page.url()).pathname.split('/').at(-1),normalized=await ctx.request.get(`${B}/api${path}/imports/${firstImportId}/export`,{headers});assert.equal(normalized.status(),200);assert.ok((await normalized.text()).includes("\"'=SUM(1,2)\""),'Formula description safely escaped');
  await page.getByRole('link',{name:'Return to reconciliation',exact:true}).click();await upload('\ufeff'+csv);
  const overlapId=new URL(page.url()).pathname.split('/').at(-1),overlap=await request('get',`${path}/imports/${overlapId}/review`);
  for(const ambiguity of overlap.ambiguities){await L(`Row ${ambiguity.ordinal} duplicate decision`).selectOption('link');await L(`Row ${ambiguity.ordinal} canonical occurrence`).fill(overlap.candidatePools[ambiguity.poolId][ambiguity.ordinal===3?1:0]);await L(`Row ${ambiguity.ordinal} duplicate reason`).fill('Same original occurrence in overlapping bank export');}
  await page.getByRole('button',{name:'Submit statement',exact:true}).click();await page.getByText('Statement submitted',{exact:true}).waitFor();
  assert.equal((await request('get',`${path}/matches`)).statement.length,4,'Overlap has one canonical vector per true occurrence');
  await page.getByRole('link',{name:'Return to reconciliation',exact:true}).click();
  const state=await request('get',`${path}/matches`),repeat=state.statement.filter(x=>x.reference==='REPEAT'),net=state.statement.find(x=>x.reference==='NET'),fee=state.statement.find(x=>x.reference==='FEE');
  const selectRow=id=>page.getByRole('checkbox',{name:new RegExp(`^Select bank row .* ${id}$`)});
  await selectRow(repeat[0].id).check();await L('Book movement').selectOption(`gl:${books[0].id}`);await L(`Allocation for REPEAT ${repeat[0].id}`).fill('50');
  let release,arrived;const hold=new Promise(r=>release=r),received=new Promise(r=>arrived=r);
  const delayed=async route=>{const response=await route.fetch();arrived();await hold;await route.fulfill({response});};
  await page.route('**/api/accounts/bank-reconciliation/profiles/*/matches/preview',delayed);
  await page.getByRole('button',{name:'Review match',exact:true}).click();await received;
  await L(`Allocation for REPEAT ${repeat[0].id}`).fill('40');const responseArrived=page.waitForResponse(r=>r.url().endsWith('/matches/preview'));release();await responseArrived;
  assert.equal(await page.getByRole('button',{name:'Confirm match',exact:true}).count(),0,'Delayed stale amount cannot restore preview');await page.unroute('**/api/accounts/bank-reconciliation/profiles/*/matches/preview',delayed);
  // A response from the old account must also disappear after switching away and back.
  let releaseAccount,arrivedAccount;const holdAccount=new Promise(r=>releaseAccount=r),receivedAccount=new Promise(r=>arrivedAccount=r);
  const delayedAccount=async route=>{const response=await route.fetch();arrivedAccount();await holdAccount;await route.fulfill({response});};await page.route('**/api/accounts/bank-reconciliation/profiles/*/matches/preview',delayedAccount);
  await page.getByRole('button',{name:'Review match',exact:true}).click();await receivedAccount;await L('Reconciliation bank').selectOption(secondProfile.id);await page.getByText('INR · ••5678 · Mapping revision 1',{exact:true}).waitFor();const accountResponse=page.waitForResponse(r=>r.url().endsWith('/matches/preview'));releaseAccount();await accountResponse;await L('Reconciliation bank').selectOption(profile.id);assert.equal(await page.getByRole('button',{name:'Confirm match',exact:true}).count(),0);await page.unroute('**/api/accounts/bank-reconciliation/profiles/*/matches/preview',delayedAccount);
  const match=async(row,book,amount)=>{await selectRow(row).check();await L('Book movement').selectOption(`gl:${book}`);await L(`Allocation for REPEAT ${row}`).fill(amount);await page.getByRole('button',{name:'Review match',exact:true}).click();await page.getByRole('button',{name:'Confirm match',exact:true}).click();await page.getByRole('button',{name:'Confirm match',exact:true}).waitFor({state:'hidden'});};
  await match(repeat[0].id,books[0].id,'50');await page.getByText('Remaining 50.000000',{exact:true}).first().waitFor();
  await match(repeat[0].id,books[0].id,'50');await match(repeat[1].id,books[1].id,'100');
  await selectRow(net.id).check();await selectRow(fee.id).check();await L('Book movement').selectOption(`gl:${state.book.find(x=>x.reference==='NET').id}`);await L('Match type').selectOption('net');await L('Net group reason').fill('Actual gross credit and fee reconcile one source bank movement');await page.getByRole('button',{name:'Review match',exact:true}).click();await page.getByText('Gross source amount: 90000.000000',{exact:true}).waitFor();await page.getByText('Actual net bank movement: 89900.000000',{exact:true}).waitFor();await page.getByRole('button',{name:'Confirm match',exact:true}).click();
  console.log('→ linked charge and journal exceptions');
  const extraCsv=csv+`\n${date},EX-FEE,Bank-only fee,-25\n${date},EX-INTEREST,Bank interest,25`,context=await request('get',path);
  const extraResponse=await ctx.request.post(`${B}/api${path}/imports`,{headers,multipart:{metadata:JSON.stringify({startDate:date,endDate:date,openingBalance:'0',closingBalance:'90100',mappingId:context.mapping.id}),file:{name:'exceptions.csv',mimeType:'text/csv',buffer:Buffer.from(extraCsv)}}});assert.equal(extraResponse.status(),201);const extra=await extraResponse.json(),extraReview=await request('get',`${path}/imports/${extra.id}/review`);
  await request('post',`${path}/imports/${extra.id}/submit`,{reviewedHash:extraReview.previewHash,decisions:extraReview.ambiguities.map(a=>({ordinal:a.ordinal,decision:'link',movementId:extraReview.candidatePools[a.poolId][a.ordinal===3?1:0],reason:'Same bank export plus newly identified exceptions'}))},201);
  await page.reload();await L('Reconciliation bank').selectOption(profile.id);
  const exceptionState=await request('get',`${path}/matches`),extraFee=exceptionState.statement.find(x=>x.reference==='EX-FEE'),interest=exceptionState.statement.find(x=>x.reference==='EX-INTEREST');
  const openException=async ref=>{await page.getByRole('row').filter({has:page.getByText(ref,{exact:true})}).getByRole('button',{name:'Review exception',exact:true}).click();await page.getByRole('button',{name:'Review exception source',exact:true}).click();};
  await page.getByRole('button',{name:'Review dated report',exact:true}).click();await page.getByText('Complete statement coverage',{exact:true}).waitFor();await L('I reviewed the remaining uncleared book items').check();assert.equal(await page.getByRole('button',{name:'Approve period',exact:true}).isDisabled(),true,'Opposite unresolved bank rows cannot silently offset');
  await openException('EX-FEE');await page.getByRole('link',{name:'Record linked bank charge',exact:true}).click();
  assert.equal(await L('Bank account').isDisabled(),true);assert.equal(await L('Posting date').isDisabled(),true);assert.equal(await L('Base charge').inputValue(),'25.000000');
  await page.getByRole('button',{name:'Review charge',exact:true}).click();await page.getByText('Bank debit: ₹25.00',{exact:true}).waitFor();await page.getByRole('button',{name:'Post bank charge',exact:true}).click();await page.waitForURL('**/app/accounts/bank-reconciliation');
  await openException('EX-INTEREST');await page.getByRole('link',{name:'Create linked journal',exact:true}).click();
  await L('Narration').fill('Browser linked interest evidence');await L('Account 2').selectOption(equity.id);await L('Credit 2').fill('25');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.waitForURL(url=>/\/app\/accounts\/journals\/[0-9a-f-]{36}$/.test(url.pathname));
  await L('Linked draft abandonment reason').fill('Explicitly abandon reviewed draft before replacement');await page.getByRole('button',{name:'Abandon linked draft',exact:true}).click();await page.getByText('cancelled',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Return to reconciliation',exact:true}).click();await openException('EX-INTEREST');await page.getByRole('link',{name:'Create linked journal',exact:true}).click();
  await L('Narration').fill('Browser explicit replacement interest');await L('Account 2').selectOption(equity.id);await L('Credit 2').fill('25');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.waitForURL(url=>/\/app\/accounts\/journals\/[0-9a-f-]{36}$/.test(url.pathname));await page.getByRole('button',{name:'Submit journal',exact:true}).click();await page.getByText('submitted',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Return to reconciliation',exact:true}).click();const postedState=await request('get',`${path}/matches`);
  for(const [row,amount] of [[extraFee,'-25.000000'],[interest,'25.000000']]){const book=postedState.book.find(x=>x.signedAmount===amount);assert.ok(book);await selectRow(row.id).check();await L('Book movement').selectOption(`gl:${book.id}`);await L(`Allocation for ${row.reference} ${row.id}`).fill('25');await page.getByRole('button',{name:'Review match',exact:true}).click();await page.getByRole('button',{name:'Confirm match',exact:true}).click();await page.getByRole('button',{name:'Confirm match',exact:true}).waitFor({state:'hidden'});}
  console.log('→ delayed report across entity scope');
  let releaseEntity,arrivedEntity;const holdEntity=new Promise(r=>releaseEntity=r),receivedEntity=new Promise(r=>arrivedEntity=r);const delayEntity=async route=>{const response=await route.fetch();arrivedEntity();await holdEntity;await route.fulfill({response});};
  await page.route('**/api/accounts/bank-reconciliation/profiles/*/report?asOf=*',delayEntity);await L('Report date').fill(date);await page.getByRole('button',{name:'Review dated report',exact:true}).click();await receivedEntity;
  await page.locator('button[aria-haspopup="listbox"]').click();await page.getByRole('option',{name:'All entities',exact:true}).click();await page.getByText('Choose a legal entity',{exact:true}).waitFor();const entityResponse=page.waitForResponse(r=>r.url().includes('/report?asOf='));releaseEntity();await entityResponse;
  await page.locator('button[aria-haspopup="listbox"]').click();await page.getByRole('option').filter({hasText:'GL Browser'}).click();await page.getByRole('heading',{name:'Dated reconciliation report',exact:true}).waitFor();assert.equal(await page.getByText('Complete statement coverage',{exact:true}).count(),0,'Prior entity response cannot restore report');await page.unroute('**/api/accounts/bank-reconciliation/profiles/*/report?asOf=*',delayEntity);
  await L('Report date').fill(date);await page.getByRole('button',{name:'Review dated report',exact:true}).click();await page.getByText('Complete statement coverage',{exact:true}).waitFor();await L('I reviewed the remaining uncleared book items').check();await page.getByRole('button',{name:'Approve period',exact:true}).click();await page.getByRole('link',{name:'Print approved report',exact:true}).nth(1).waitFor();
  await page.goto(`${B}${frozenPrint}`);await page.getByText('Statement balance: 0.000000',{exact:true}).waitFor();await page.getByText(/Historical approved revision/).waitFor();
  await page.goto(`${B}/app/accounts/bank-reconciliation`);
  console.log('→ preparer and auditor permissions');
  for(const [name,permissions] of [['Preparer',['accounts.bank_reconciliation.read','accounts.bank_reconciliation.create','accounts.bank_reconciliation.submit','accounts.bank_reconciliation.cancel','accounts.bank_reconciliation.export','accounts.account.read','accounts.voucher.read']],['Auditor',['accounts.bank_reconciliation.read','accounts.bank_reconciliation.export','accounts.account.read','accounts.voucher.read']]]){
   const role=await request('post','/roles',{name:`Bank browser ${name}`,permissions},201),email=`bank-${name}-${Date.now()}@example.com`,invite=await request('post','/invitations',{email,roles:[{roleId:role.id,entityIds:[entityId]}]},201),limited=await browser.newContext({viewport:{width:1400,height:900}});
   try{await new Promise(r=>setTimeout(r,12000));const signup=await limited.request.post(`${B}/api/auth/sign-up/email`,{headers:{Origin:B},data:{name,email,password:'Sup3r-secret-pw'}});assert.equal(signup.status(),200);const accept=await limited.request.post(`${B}/api/invitations/accept`,{headers:{Origin:B},data:{token:invite.inviteUrl.split('/').at(-1)}});assert.equal(accept.status(),201);const p=await limited.newPage();await p.goto(`${B}/app/accounts/bank-reconciliation`);await p.getByRole('heading',{name:'Bank reconciliation',exact:true}).waitFor();await p.getByText('Active baseline',{exact:true}).waitFor();assert.equal(await p.getByRole('link',{name:'Configure bank',exact:true}).count(),0);assert.equal(await p.getByRole('button',{name:'Approve period',exact:true}).count(),0);assert.equal(await p.getByRole('button',{name:'Reopen period',exact:true}).count(),0);if(name==='Preparer')assert.equal(await p.getByLabel('Match type',{exact:true}).locator('option[value="net"]').count(),0);else{assert.equal(await p.getByRole('button',{name:'Stage statement',exact:true}).count(),0);assert.equal(await p.getByRole('button',{name:'Review match',exact:true}).count(),0);}assert.equal((await limited.request.post(`${B}/api${path}/periods/approve`,{headers,data:{asOf:date,reviewedHash:'0'.repeat(64),outstandingReviewed:true}})).status(),403);
   }finally{await limited.close();}
  }
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile page does not overflow');
  assert.deepEqual(errors,[]);
  console.log('PASS bank settings/baseline, quoted/repeated CSV and canonical duplicates, partial/net matches, delayed amount/account/entity responses, linked charge/journal abandonment/replacement, Finance/preparer/auditor boundaries, frozen print/formula export/mobile');
}catch(error){console.error('Browser diagnostic',JSON.stringify({path:new URL(page.url()).pathname,alerts:await page.locator('[role=alert]').allTextContents(),apiFailures,widths:await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,grids:[...document.querySelectorAll('main .grid')].map(e=>({classes:e.className,width:e.getBoundingClientRect().width}))}))}));await page.screenshot({path:'/tmp/bank-browser-failure.png',fullPage:true});throw error;}finally{await browser.close();await db.$client.end();}
