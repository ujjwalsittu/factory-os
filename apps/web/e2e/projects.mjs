import { chromium } from 'playwright';
// Projects (decision 058) against running web + API (fresh tenant each run): create a ₹10,00,000 project with 5%
// retention, two milestones and a budget, activate it, link a GPU cloud bill, set an analyst's cost rate and approve
// their hours, record own hours, mark the first milestone achieved and invoice it, and see retention held and
// budget vs actual. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:projects   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/projects', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000,
  errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const L = (t) => page.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const pickEntity = async () => {
  if (await page.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await page.click('main button:has-text("Azeonics")', { timeout: 3000 }).catch(() => null);
};
const dialog = (button) => page.click(`dialog button:has-text("${button}")`).then(() => page.locator('dialog').waitFor({ state: 'detached' }));
const chk = (base) => {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let s = 0;
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(base[i]) * (i % 2 ? 2 : 1);
    s += Math.floor(v / 36) + (v % 36);
  }
  return base + chars[(36 - (s % 36)) % 36];
};
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const monthAgo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - 31 * 24 * 3600e3));

try {
  step('sign up + onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Project Lead');
  await L('Work email').fill(`prj${run}@azeonics.com`);
  await L('Password').fill('Sup3r-secret-pw');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding');
  await L('Workspace (company group) name').fill('Azeonics Group');
  await L('Legal name').fill('Azeonics Private Limited');
  await L('Short name').fill('Azeonics');
  await L('Code').fill('AZ');
  await L('PAN').fill('AAACA1234B');
  await page.click('button:has-text("Create workspace")');
  await page.waitForURL('**/app');

  step('GSTIN, SAC rates, service items, a customer and a submitted GPU cloud bill (API)');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const call = async (method, path, data, c = ctx) => {
    const r = await c.request.fetch(`${B}/api${path}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  await call('POST', `/entities/${E}/gst-registrations`, { gstin: chk('27AAACA1234B1Z') });
  await call('POST', '/hsn-codes', { code: '998365', kind: 'sac', description: 'Other technical and scientific services', gstRate: '18', effectiveFrom: '2017-07-01' });
  await call('POST', '/hsn-codes', { code: '998315', kind: 'sac', description: 'Hosting and IT infrastructure services', gstRate: '18', effectiveFrom: '2017-07-01' });
  const uoms = await call('GET', '/uoms');
  const nos = uoms.find((x) => x.code === 'NOS').id;
  await call('POST', '/items', { code: 'SVC-PRJ', name: 'Satellite engineering services', type: 'service', stockUomId: nos, hsnCode: '998365' });
  const gpuItem = await call('POST', '/items', { code: 'SVC-GPU', name: 'GPU cloud compute', type: 'service', stockUomId: nos, hsnCode: '998315' });
  await call('POST', '/parties', { code: 'SAC-GOV', name: 'Space Applications Centre', isCustomer: true, isSupplier: false, gstin: chk('24AAAGS1234B1Z') });
  const gpu = await call('POST', '/parties', { code: 'GPUCO', name: 'GPU Cloud Pvt Ltd', isCustomer: false, isSupplier: true, gstin: chk('27AABCG1234B1Z') });
  const pi = await call('POST', '/purchase-invoices', { supplierId: gpu.id, supplierInvoiceNo: 'GPU-0917', supplierInvoiceDate: today, postingDate: today, lines: [{ itemId: gpuItem.id, qty: '1', rate: '42000' }] });
  await call('POST', `/purchase-invoices/${pi.id}/submit`, {});
  await page.reload();

  step('Services → Projects: a ₹10,00,000 project with 5% retention');
  await page.click('nav >> text=Projects');
  await page.waitForURL('**/app/services/projects');
  await pickEntity();
  await page.click('button:has-text("New project")');
  await L('Customer').selectOption({ label: 'Space Applications Centre' });
  await L('Customer reference').fill('SAC/LoA/2026/117');
  await L('Title').fill('Hyperspectral payload structure');
  await L('Service item').selectOption({ label: 'SVC-PRJ · Satellite engineering services' });
  await L('Contract value (₹)').fill('1000000');
  await L('Retention (%)').fill('5');
  await L('Defect liability (months)').fill('12');
  await page.click('dialog button:has-text("Create project")');
  await page.waitForURL(/\/app\/services\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  await page.locator('h1', { hasText: '/PRJ/' }).waitFor();
  const number = (await page.locator('h1').innerText()).trim();

  step('milestones and budget, then activate');
  for (const [name, amount] of [
    ['Design review (PDR)', '300000'],
    ['Flight structure delivered', '700000'],
  ]) {
    await page.click('button:has-text("Add milestone")');
    await L('Milestone').fill(name);
    await L('Amount (₹)').fill(amount);
    await dialog('Add milestone');
  }
  await page.click('button:has-text("Edit budget")');
  await L('Labour (₹)').fill('200000');
  await L('Bought-in (₹)').fill('50000');
  await dialog('Save budget');
  await page.click('button:has-text("Activate project")');
  await page.locator('main').getByText('Active', { exact: true }).first().waitFor();

  step('link the GPU bill line');
  await page.click('button:has-text("Link document")');
  await L('Kind').selectOption('purchase_invoice_line');
  await page.waitForFunction(() => document.querySelectorAll('dialog select')[1]?.options.length > 1);
  await L('Document').selectOption({ index: 1 });
  await dialog('Link');
  await page.locator('li', { hasText: 'GPU Cloud Pvt Ltd' }).waitFor();
  await page.locator('tr', { hasText: 'Bought-in' }).getByText('₹42,000.00').waitFor();

  step('an analyst joins and records 8 hours (API, second browser)');
  const roles = await call('GET', '/roles');
  const memberRole = roles.find((r) => r.name === 'Project member');
  const analystEmail = `analyst${run}@azeonics.com`;
  const inv = await call('POST', '/invitations', { email: analystEmail, roles: [{ roleId: memberRole.id, entityIds: [E] }] });
  const ctx2 = await browser.newContext();
  const signUp = await ctx2.request.post(`${B}/api/auth/sign-up/email`, { headers: { Origin: B }, data: { name: 'Priya Analyst', email: analystEmail, password: 'Sup3r-secret-pw' } });
  expect(signUp.ok(), `analyst sign-up: ${signUp.status()}`);
  await call('POST', '/invitations/accept', { token: inv.inviteUrl.split('/').at(-1) }, ctx2);
  const project = await call('GET', `/services/projects/${projectUrl.split('/').pop()}`);
  await call('POST', '/services/timesheets', { projectId: project.id, milestoneId: project.milestones[0].id, workDate: today, hours: '8', notes: 'FEA of the side panels' }, ctx2);
  await call('POST', '/services/timesheets/submit', { from: today, to: today }, ctx2);

  step('cost rate for the analyst, then approve their hours');
  await page.click('nav >> text=Cost rates');
  await page.waitForURL('**/app/services/cost-rates');
  await page.locator('tr', { hasText: 'Priya Analyst' }).getByRole('button', { name: 'New rate' }).click();
  await L('Rate (₹ per hour)').fill('900');
  await L('From').fill(monthAgo);
  await dialog('Save rate');
  await page.locator('tr', { hasText: 'Priya Analyst' }).getByText('₹900.00').first().waitFor();
  await page.click('nav >> text=Timesheets');
  await page.waitForURL('**/app/services/timesheets');
  await page.locator('tr', { hasText: 'Priya Analyst' }).getByRole('button', { name: 'Approve' }).click();
  await page.getByText('Nothing to approve').waitFor();

  step('record own hours and submit the week');
  await page.click('button:has-text("Add hours")');
  await L('Project').selectOption({ label: `${number} · Hyperspectral payload structure` });
  await L('Hours').fill('2');
  await L('What you worked on').fill('Customer review call');
  await dialog('Save');
  await page.click('button:has-text("Submit week")');
  await page.locator('tr', { hasText: 'Customer review call' }).getByText('Submitted').waitFor();
  await shot('01-timesheets');

  step('labour on the project, the first milestone achieved and invoiced');
  await page.goto(projectUrl);
  await page.locator('tr', { hasText: 'Labour' }).getByText('₹7,200.00').waitFor();
  await page.locator('tr', { hasText: 'Design review (PDR)' }).getByRole('button', { name: 'Mark achieved' }).click();
  await L('Customer’s acceptance reference').fill('SAC/PDR/MoM-14');
  await dialog('Mark achieved');
  await page.locator('tr', { hasText: 'Design review (PDR)' }).getByRole('button', { name: 'Create invoice' }).click();
  await page.waitForURL(/\/app\/selling\/invoices\/[0-9a-f-]{36}$/);
  await L('Customer PO number').waitFor();
  expect((await L('Customer PO number').inputValue()) === 'SAC/LoA/2026/117', 'the invoice carries the customer reference');
  expect((await L('Remarks').inputValue()).includes(`Project ${number}`), 'the invoice names the project');
  await page.goto(projectUrl);
  await page.locator('tr', { hasText: 'Held · released' }).getByText('₹17,700.00').waitFor();
  await page.locator('tr', { hasText: 'Design review (PDR)' }).getByText('Draft invoice').first().waitFor();
  await shot('02-project');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('h1', { hasText: number }).waitFor();
  await shot('03-mobile');
  expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal page scroll at 390 px');
  await ctx2.close();
} catch (error) {
  await shot('failed').catch(() => {});
  throw error;
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('Browser errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('Projects walkthrough passed. Screenshots in', shots);
