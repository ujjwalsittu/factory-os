import assert from 'node:assert/strict';
import { chromium } from 'playwright';
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
const errors = [];
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
  await page.goto(`${B}/app/accounts/bank-charges/new`);
  await page.getByRole('heading',{name:'New bank charge',exact:true}).waitFor();
  await L('Bank account').selectOption({label:'Bank'});
  await L('Expense account').selectOption({label:'Bank charges'});
  await L('Base charge').fill('100');
  await L('Charge reference').fill('BANK-BROWSER-1');
  await L('Documentary reference').fill('Bank advice for browser fixture');
  await L('Reason').fill('Record bank-only fee with documentary evidence');
  await page.getByRole('button',{name:'Review charge',exact:true}).click();
  await page.getByText('Bank debit: ₹100.00',{exact:true}).waitFor();
  await L('Base charge').fill('101');
  assert.equal(await page.getByRole('button',{name:'Post bank charge',exact:true}).count(),0,'Editing hides stale preview');
  await L('Base charge').fill('100');
  await page.getByRole('button',{name:'Review charge',exact:true}).click();
  await page.getByText('Bank debit: ₹100.00',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Post bank charge',exact:true}).click();
  await page.waitForURL('**/app/accounts/bank-charges');
  await page.getByText('BANK-BROWSER-1',{exact:true}).waitFor();
  const me=await (await ctx.request.get(`${B}/api/me`)).json();
  const tenantId=me.tenants[0].id;
  const entityId=(await (await ctx.request.get(`${B}/api/entities`,{headers:{'x-tenant-id':tenantId}})).json())[0].id;
  const headers={'x-tenant-id':tenantId,'x-entity-id':entityId,Origin:B};
  const customerResponse=await ctx.request.post(`${B}/api/parties`,{headers,data:{code:'FEE-CUS',name:'Fee browser customer',isCustomer:true,gstTreatment:'unregistered'}});
  assert.equal(customerResponse.status(),201);
  await page.goto(`${B}/app/accounts/settlements/new?direction=receipt`);
  await L('Customer').selectOption({label:'Fee browser customer'});
  await L('Amount (INR)').fill('1000');
  await L('Add bank charge').check();
  await L('Bank charge amount').fill('100');
  await L('Bank charge reference').fill('INLINE-BROWSER-1');
  await L('Bank charge document').fill('Bank advice for inline browser fee');
  await L('Bank charge reason').fill('Fee deducted by bank from customer receipt');
  await page.getByText('₹900.00',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Submit',exact:true}).click();
  await page.getByText(/GL\/RCT\/\d\d-\d\d\/00001/).waitFor();
  await page.getByRole('button',{name:'Cancel',exact:true}).waitFor();
  await page.getByText('Bank charge',{exact:true}).waitFor();
  await page.getByText('₹900.00',{exact:true}).waitFor();
  await page.goto(`${B}/app/accounts/bank-charges`);
  await page.getByText('INLINE-BROWSER-1',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),true,'No page overflow on mobile');
  assert.deepEqual(errors,[]);
  console.log('PASS production standalone/inline fee preview, stale edit, principal/net amounts, register and mobile layout');
}finally{await browser.close();}
