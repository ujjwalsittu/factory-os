import { chromium } from 'playwright';
// CAPA (decision 061) against running web + API (fresh tenant each run): an NCR raises a major CAPA, the 5-Why, root
// cause and 8D sections are written, actions are planned, started, done and submitted; a second person records the
// effectiveness check once it falls due (the wait is moved to today in the local database, test-only), and it closes.
// Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:capa   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional; DATABASE_URL from the env or ../../.env)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/capa', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const dbUrl = process.env.DATABASE_URL ?? fs.readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1];
const run = Date.now() % 100000,
  errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // The refused start (400) is expected; any other failed request is an error.
  p.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`console: ${m.text()}`));
  p.on('response', (r) => r.status() >= 400 && !(r.status() === 400 && r.url().endsWith('/start')) && errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(B, '')}`));
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
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const inDays = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + n * 86400e3));

try {
  step('sign up + onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Meera Quality');
  await L('Work email').fill(`capa${run}@azeonics.com`);
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

  step('an NCR and a second person to check effectiveness (API)');
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
  const bar = await call('POST', '/items', { code: 'TI-BAR', name: 'Titanium bar', type: 'raw_material', tracking: 'none', stockUomId: uoms.find((x) => x.code === 'KG').id, hsnCode: '76042910' });
  const sto = await call('POST', '/warehouses', { code: 'STO', name: 'Main stores', type: 'stores' });
  const rec = await call('POST', '/stock-entries', { purpose: 'receipt', postingDate: today, lines: [{ itemId: bar.id, qty: '10', toWarehouseId: sto.id, rate: '400' }] });
  await call('POST', `/stock-entries/${rec.id}/submit`, {});
  const ncr = await call('POST', '/quality/ncrs', { itemId: bar.id, qty: '2', fromWarehouseId: sto.id, description: 'Surface cracks after heat treatment' });
  const role = await call('POST', '/roles', { name: 'QA verifier', permissions: ['quality.capa.read', 'quality.capa.approve', 'quality.ncr.read'] });
  const headEmail = `head${run}@azeonics.com`;
  const inv = await call('POST', '/invitations', { email: headEmail, roles: [{ roleId: role.id, entityIds: [E] }] });
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const signUp = await ctx2.request.post(`${B}/api/auth/sign-up/email`, { headers: { Origin: B }, data: { name: 'Ravi Head', email: headEmail, password: 'Sup3r-secret-pw' } });
  expect(signUp.ok(), `verifier sign-up: ${signUp.status()}`);
  await call('POST', '/invitations/accept', { token: inv.inviteUrl.split('/').at(-1) }, ctx2);

  step('NCR page: raise a major CAPA from it');
  await page.goto(`${B}/app/quality/ncrs/${ncr.id}`);
  await pickEntity();
  await page.getByText('None linked.').waitFor();
  await page.click('main button:has-text("Raise CAPA")');
  await L('Title').fill('Cracking after heat treatment');
  expect((await L('Problem (D2)').inputValue()).includes('Surface cracks after heat treatment'), 'the NCR seeds the problem');
  await L('Severity').selectOption('major');
  await L('Check effectiveness after (days)').fill('30');
  await dialog('Raise CAPA');
  await page.waitForURL(/\/app\/quality\/capas\/[0-9a-f-]{36}$/);
  const capaId = page.url().split('/').pop();
  await page.locator('h1', { hasText: '/CAPA/' }).waitFor();
  await page.locator('main').getByRole('link', { name: ncr.number }).waitFor();

  step('start is refused until the analysis and a corrective action exist');
  await page.click('button:has-text("Start actions")');
  await page.getByText(/Before starting, add at least two whys/).waitFor();

  step('5-Why, root cause and the 8D sections');
  await page.locator('main button:has-text("Edit")').first().click();
  await L('Team (D1)').fill('Quality head, heat-treat lead, process engineer');
  await L('Containment (D3)').fill('Both lots quarantined and 100% dye-penetrant tested');
  await L('Why 1').fill('Cracks are quench cracks');
  await L('Why 2').fill('Quench delay exceeded 8 s');
  await page.click('dialog button:has-text("Why")');
  await L('Why 3').fill('Basket transfer is manual after the fixture change');
  await L('Root cause').fill('Manual transfer lets the quench delay exceed 8 s');
  await dialog('Save');
  await page.getByText('Manual transfer lets the quench delay exceed 8 s').waitFor();

  step('plan actions');
  const addAction = async (kind, description, dueOn) => {
    await page.click('main button:has-text("Add action")');
    await L('Kind').selectOption(kind);
    await L('What will be done').fill(description);
    await L('Due').fill(dueOn);
    await dialog('Add action');
    await page.getByText(description).waitFor();
  };
  await addAction('containment', 'Dye-penetrant test both lots', inDays(2));
  await addAction('corrective', 'Timed pneumatic transfer to the quench', inDays(14));
  await addAction('preventive', 'Time study for any fixture change', inDays(30));
  await shot('01-plan');

  step('start, do the actions, submit');
  await page.click('button:has-text("Start actions")');
  await page.locator('h1').getByText('In action').waitFor();
  for (let i = 0; i < 3; i++) {
    await page.locator('main button:has-text("Mark done")').first().click();
    await L('What was done').fill('Done and recorded');
    await dialog('Mark done');
  }
  expect((await page.locator('main button:has-text("Mark done")').count()) === 0, 'all actions done');
  await page.click('button:has-text("Submit for verification")');
  await page.locator('h1').getByText('Awaiting check').waitFor();
  await page.getByText(/The effectiveness check falls due on/).waitFor();
  await shot('02-verifying');

  step('list shows it waiting; the NCR lists the CAPA');
  await page.click('nav >> text=CAPA');
  await page.waitForURL('**/app/quality/capas');
  await page.locator('tr', { hasText: 'Cracking after heat treatment' }).getByText('Awaiting check').waitFor();
  await page.goto(`${B}/app/quality/ncrs/${ncr.id}`);
  await page.locator('main').getByText('Cracking after heat treatment').waitFor();

  step('the check falls due (test-only time travel); the second person records it');
  execFileSync('psql', [dbUrl, '-qtAc', `update capa set verify_due_on = (now() at time zone 'Asia/Kolkata')::date where id = '${capaId}'`]);
  const p2 = await ctx2.newPage();
  watch(p2);
  current = p2;
  await p2.goto(`${B}/app/quality/capas/${capaId}`);
  await pickEntity(p2);
  await p2.getByText(/The effectiveness check is due/).waitFor();
  await p2.click('button:has-text("Check effectiveness")');
  await L('Result', p2).selectOption('no');
  await L('Evidence', p2).fill('One more cracked bar on lot 3; transfer 9 s on night shift');
  await dialog('Not effective, reopen', p2);
  await p2.locator('h1').getByText('In action').waitFor();
  await p2.getByText('Not effective', { exact: true }).waitFor();

  step('owner adds a second corrective action and resubmits');
  current = page;
  await page.goto(`${B}/app/quality/capas/${capaId}`);
  await addAction('corrective', 'Interlock the quench door to the timer', inDays(7));
  await page.locator('main button:has-text("Mark done")').click();
  await L('What was done').fill('Interlock commissioned');
  await dialog('Mark done');
  await page.click('button:has-text("Submit for verification")');
  await page.locator('h1').getByText('Awaiting check').waitFor();
  expect((await page.locator('button:has-text("Check effectiveness")').count()) === 0, 'the owner has no check button');
  execFileSync('psql', [dbUrl, '-qtAc', `update capa set verify_due_on = (now() at time zone 'Asia/Kolkata')::date where id = '${capaId}'`]);

  step('effective: closes with D8 recognition');
  current = p2;
  await p2.reload();
  await p2.click('button:has-text("Check effectiveness")');
  await L('Evidence', p2).fill('Three lots since, crack-free; transfer under 5 s on all shifts');
  await L('Recognition (D8)', p2).fill('Heat-treat team thanked at the monthly review');
  await dialog('Effective, close', p2);
  await p2.locator('h1').getByText('Closed').waitFor();
  await p2.getByText('Heat-treat team thanked at the monthly review').waitFor();
  await shot('03-closed');

  step('phone width');
  current = page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('h1', { hasText: '/CAPA/' }).waitFor();
  await shot('04-mobile');
  expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal page scroll at 390 px');
  await page.goto(`${B}/app/quality/capas`);
  await page.locator('main').getByText('Cracking after heat treatment').waitFor();
  expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal page scroll on the list at 390 px');
  await shot('05-mobile-list');
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
console.log('CAPA walkthrough passed. Screenshots in', shots);
