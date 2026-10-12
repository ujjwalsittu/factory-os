import { chromium } from 'playwright';
// Skill matrix (decision 062) against running web + API (fresh tenant each run): the owner adds a skill, requires it
// on the 5-axis machine and certifies a trainer and a trainee; the trainee starts a card with a co-signer, who
// confirms from their own login; after a revocation the owner allows one uncertified start from the work order.
// Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:skill-matrix   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/skill-matrix', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000,
  errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
// Refused starts (409) are part of the flow; any other failed request is an error.
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`console: ${m.text()}`));
  p.on('response', (r) => r.status() >= 400 && !(r.status() === 409 && r.url().endsWith('/manufacturing/job-cards')) && errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(B, '')}`));
};
watch(page);
let current = page;
const shot = (n) => current.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const L = (t, p = page) => p.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const pickEntity = async (p = page) => {
  if (await p.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await p.click('main button:has-text("Azeonics")', { timeout: 3000 }).catch(() => null);
};
const dialog = (button, p = page) => p.click(`dialog button:has-text("${button}")`).then(() => p.locator('dialog').waitFor({ state: 'detached' }));

try {
  step('sign up + onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Sunita Supervisor');
  await L('Work email').fill(`skills${run}@azeonics.com`);
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

  step('a released work order on a CNC centre with a 5-axis machine; two operators (API)');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const call = async (method, path, data, c = ctx) => {
    const r = await c.request.fetch(`${B}/api${path}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const uoms = await call('GET', '/uoms');
  const u = (code) => uoms.find((x) => x.code === code).id;
  const bar = await call('POST', '/items', { code: 'TI64', name: 'Ti-6Al-4V bar', type: 'raw_material', tracking: 'none', stockUomId: u('KG'), hsnCode: '76042910' });
  const part = await call('POST', '/items', { code: 'HSG', name: 'Housing', type: 'finished_good', tracking: 'none', stockUomId: u('NOS'), hsnCode: '88073000' });
  const sto = await call('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' });
  const fg = await call('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' });
  const cnc = await call('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '2500' });
  await call('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M5X', name: 'Variaxis 5-axis' });
  const bom = await call('POST', '/manufacturing/boms', { itemId: part.id, revision: 'A', materials: [{ itemId: bar.id, qty: '2' }], operations: [{ seq: 10, name: '5-axis mill', workCentreId: cnc.id, runMinutesPerUnit: '90' }] });
  await call('POST', `/manufacturing/boms/${bom.id}/activate`, {});
  const draft = await call('POST', '/manufacturing/work-orders', { itemId: part.id, plannedQty: '5', sourceWarehouseId: sto.id, targetWarehouseId: fg.id });
  const wo = await call('POST', `/manufacturing/work-orders/${draft.id}/release`, {});
  const operator = (await call('GET', '/roles')).find((r) => r.name === 'Operator');
  const join = async (name, email) => {
    const inv = await call('POST', '/invitations', { email, roles: [{ roleId: operator.id, entityIds: [E] }] });
    const c = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const signUp = await c.request.post(`${B}/api/auth/sign-up/email`, { headers: { Origin: B }, data: { name, email, password: 'Sup3r-secret-pw' } });
    expect(signUp.ok(), `${name} sign-up: ${signUp.status()}`);
    await call('POST', '/invitations/accept', { token: inv.inviteUrl.split('/').at(-1) }, c);
    const p = await c.newPage();
    watch(p);
    return p;
  };
  const tara = await join('Tara Trainee', `tara${run}@azeonics.com`);
  const qadir = await join('Qadir Qualified', `qadir${run}@azeonics.com`);

  step('Quality → Skill matrix: add 5-axis milling');
  await page.reload();
  await page.click('nav >> text=Skill matrix');
  await page.waitForURL('**/app/quality/skills');
  await pickEntity();
  await page.getByText('No skills yet').waitFor();
  await page.click('[role=tab]:has-text("Skills")');
  await page.click('main button:has-text("New skill")');
  await L('Code').fill('5AX');
  await L('Name').fill('5-axis milling');
  await L('Re-certify every (months)').fill('12');
  await dialog('Add skill');
  await page.locator('tr', { hasText: '5-axis milling' }).getByText('Not required yet').waitFor();

  step('Work centres: require it on the 5-axis machine');
  await page.click('nav >> text=Work centres');
  await page.waitForURL('**/app/manufacturing/work-centres');
  await page.click('button[aria-label="Skills for CNC"]');
  await page.click('dialog button[aria-label="M5X: 5-axis milling"]');
  await dialog('Save');
  await page.locator('tr', { hasText: 'CNC' }).getByText('M5X: 5AX').waitFor();

  step('certify Qadir as trainer and Tara as trainee');
  await page.click('nav >> text=Skill matrix');
  await page.waitForURL('**/app/quality/skills');
  await page.click('button[aria-label="Certify Qadir Qualified in 5-axis milling"]');
  await L('Level').selectOption('trainer');
  await L('Note').fill('OEM course, Mazak');
  await dialog('Certify');
  await page.click('button[aria-label="Certify Tara Trainee in 5-axis milling"]');
  await L('Level').selectOption('trainee');
  await dialog('Certify');
  await page.locator('tr', { hasText: 'Tara Trainee' }).getByText('Trainee', { exact: true }).waitFor();
  await page.locator('tr', { hasText: 'Qadir Qualified' }).getByText('Trainer', { exact: true }).waitFor();
  await shot('01-matrix');

  step('Tara (trainee) starts on the 5-axis: names Qadir to co-sign');
  current = tara;
  await tara.goto(`${B}/app/manufacturing/shop-floor`);
  await pickEntity(tara);
  const opCard = tara.locator('main div.p-4', { hasText: '5-axis mill' }).first();
  await opCard.getByLabel('Machine', { exact: true }).selectOption({ label: 'M5X · Variaxis 5-axis (1 certified)' });
  await opCard.getByRole('button', { name: `Start op 10 on ${wo.number}` }).click();
  await opCard.getByLabel('Co-signer', { exact: true }).selectOption({ label: 'Qadir Qualified' });
  await opCard.getByRole('button', { name: `Start op 10 on ${wo.number}` }).click();
  await tara.getByText(/Waiting for Qadir Qualified to co-sign/).waitFor();
  expect((await tara.locator('main button:has-text("Stop")').count()) === 0, 'no stop before the co-sign');
  await shot('02-awaiting-cosign');

  step('Qadir co-signs from his own login');
  current = qadir;
  await qadir.goto(`${B}/app/manufacturing/shop-floor`);
  await pickEntity(qadir);
  await qadir.getByText('Co-sign requested').waitFor();
  await qadir.click('main button:has-text("Co-sign")');
  await qadir.getByText('Co-sign requested').waitFor({ state: 'detached' });

  step('Tara stops with the quantity made');
  current = tara;
  await tara.reload();
  await tara.click('main button:has-text("Stop")');
  await L('Good', tara).fill('1');
  await dialog('Stop and record', tara);
  await tara.getByText('My job').waitFor({ state: 'detached' });

  step('revoke Tara; the supervisor allows one uncertified start from the work order');
  current = page;
  await page.click('button[aria-label="Tara Trainee · 5-axis milling"]');
  await page.click('dialog button:has-text("Revoke")');
  await L('Why is it revoked').fill('Crashed the B-axis on a dry run');
  await page.click('dialog button:has-text("Revoke")');
  await page.locator('dialog').getByText('Revoked by Sunita Supervisor: Crashed the B-axis on a dry run').waitFor();
  await dialog('Done');
  await page.goto(`${B}/app/manufacturing/work-orders/${wo.id}`);
  await page.click('main button:has-text("Allow uncertified start")');
  await L('Machine').selectOption({ label: 'M5X · Variaxis 5-axis' });
  await L('Person').selectOption({ label: 'Tara Trainee' });
  await L('Reason').fill('AOG part; Qadir standing by the machine');
  await dialog('Allow');
  await page.locator('main li', { hasText: 'Tara Trainee' }).getByText(/Valid/).waitFor();

  step('Tara starts under the allowance');
  current = tara;
  await tara.reload();
  const opCard2 = tara.locator('main div.p-4', { hasText: '5-axis mill' }).first();
  await opCard2.getByLabel('Machine', { exact: true }).selectOption({ label: 'M5X · Variaxis 5-axis (1 certified)' });
  await opCard2.getByRole('button', { name: `Start op 10 on ${wo.number}` }).click();
  await tara.getByText(/Started under an allowance by Sunita Supervisor/).waitFor();
  await shot('03-allowance');

  step('phone width');
  current = page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${B}/app/quality/skills`);
  await page.locator('main').getByText('Qadir Qualified').waitFor();
  await shot('04-mobile-matrix');
  expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal page scroll on the matrix at 390 px');
  current = tara;
  await tara.setViewportSize({ width: 390, height: 844 });
  await tara.reload();
  await tara.getByText(/Started under an allowance/).waitFor();
  await shot('05-mobile-shop-floor');
  expect(!(await tara.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal page scroll on the shop floor at 390 px');
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
console.log('Skill matrix walkthrough passed. Screenshots in', shots);
