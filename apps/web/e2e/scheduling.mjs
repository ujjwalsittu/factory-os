import { chromium } from 'playwright';
// Manufacturing 2e walkthrough (decision 049) against running web + API (fresh tenant each run):
// calendar with shifts and a holiday → downtime → Reschedule → Gantt bars → drag to pin, details, unpin → work order
// priority and schedule panel → shop floor dispatch order and out-of-sequence reason → planner list; mobile.
// Usage: pnpm --filter @factoryos/web e2e:scheduling   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/scheduling', import.meta.url).pathname;
import fs from 'node:fs'; fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000, errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
let expected = 0; // refusals the walkthrough provokes on purpose
page.on('console', (m) => m.type() === 'error' && !(expected && /status of 409/.test(m.text()) && expected--) && errors.push(`console: ${m.text()}`));
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const L = (t) => page.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);
const pickEntity = async () => {
  if (await page.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await page.click('main button:has-text("Azeonics")', { timeout: 3000 }).catch(() => null); // the gate can flash while the workspace loads
};

step('sign up + onboard');
await page.goto(`${B}/sign-up`);
await L('Full name').fill('Production Planner'); await L('Work email').fill(`plan${run}@azeonics.com`); await L('Password').fill('Sup3r-secret-pw');
await page.click('button[type=submit]'); await page.waitForURL('**/onboarding');
await L('Workspace (company group) name').fill('Azeonics Group'); await L('Legal name').fill('Azeonics Private Limited');
await L('Short name').fill('Azeonics'); await L('Code').fill('AZ'); await L('PAN').fill('AAACA1234B');
await page.click('button:has-text("Create workspace")'); await page.waitForURL('**/app');

step('masters, a routing and three released work orders (API)');
const me = await (await ctx.request.get(`${B}/api/me`)).json();
const T = me.tenants[0].id;
const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
const call = async (method, path, data) => { const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data }); if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`); return r.json(); };
const uoms = await call('GET', '/uoms');
const u = (c) => uoms.find((x) => x.code === c).id;
const bar = await call('POST', '/items', { code: 'AL6061', name: 'Aluminium bar', type: 'raw_material', tracking: 'none', stockUomId: u('KG'), hsnCode: '76042910' });
const part = await call('POST', '/items', { code: 'BRKT', name: 'Bracket', type: 'finished_good', tracking: 'none', stockUomId: u('NOS'), hsnCode: '88073000' });
const sto = await call('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' });
const fg = await call('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' });
const cnc = await call('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' });
const grind = await call('POST', '/manufacturing/work-centres', { code: 'GRIND', name: 'Grinding', hourlyRate: '900' });
const m1 = await call('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M1', name: 'VMC 1' });
await call('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M2', name: 'VMC 2' });
await call('POST', `/manufacturing/work-centres/${grind.id}/machines`, { code: 'G1', name: 'Surface grinder' });
const bom = await call('POST', '/manufacturing/boms', { itemId: part.id, revision: 'A', materials: [{ itemId: bar.id, qty: '0.5' }], operations: [{ seq: 10, name: 'Mill', workCentreId: cnc.id, runMinutesPerUnit: '60' }, { seq: 20, name: 'Grind', workCentreId: grind.id, runMinutesPerUnit: '30' }] });
await call('POST', `/manufacturing/boms/${bom.id}/activate`, {});
const orders = [];
for (const [qty, priority] of [['2', 1], ['1', 2], ['1', 3]]) {
  const w = await call('POST', '/manufacturing/work-orders', { itemId: part.id, plannedQty: qty, sourceWarehouseId: sto.id, targetWarehouseId: fg.id, priority });
  orders.push(await call('POST', `/manufacturing/work-orders/${w.id}/release`, {}));
}
await page.reload();

step('schedule without a calendar points to the calendar page');
await page.click('nav >> text=Schedule');
await pickEntity();
await page.waitForSelector('text=No working calendar yet');

step('calendars: two shifts Mon–Sat with a holiday');
await page.click('nav >> text=Calendars');
await page.click('button:has-text("New calendar")');
await L('Name').fill('Two shifts');
await page.click('dialog button:has-text("Add shift")');
await L('Start of shift 7').fill('17:30'); await L('End of shift 7').fill('23:00');
await page.click('dialog button:has-text("Copy Monday to Tue–Sat")');
await page.click('dialog button:has-text("Add holiday")');
await L('Holiday 1 date').fill('2026-11-08'); await L('Holiday 1 name').fill('Diwali');
await shot('01-calendar-dialog');
await page.click('dialog button:has-text("Save")');
await page.waitForSelector('text=84 h a week');
await page.waitForSelector('text=Default');

step('downtime on M1');
await page.click('button:has-text("Add downtime")');
await L('Machine').selectOption({ label: 'M1 · VMC 1' });
await L('Reason').fill('Spindle service');
await page.click('dialog button:has-text("Save")');
await page.waitForSelector('td >> text=Spindle service');
await shot('02-calendars');

step('reschedule and read the Gantt');
await page.click('nav >> text=Schedule');
await page.waitForSelector('text=Run Reschedule to place the released work orders');
await page.click('button:has-text("Reschedule")');
await page.waitForSelector(`button[aria-label="${orders[0].number} operation 10 Mill"]`);
await page.waitForSelector(`button[aria-label="${orders[2].number} operation 20 Grind"]`);
await page.waitForSelector('text=Downtime: Spindle service'.replace('text=', '[aria-label="') + '"]', { state: 'attached' });
await shot('03-gantt');

step('drag the last grinding job two hours later: it is pinned');
const last = page.locator(`button[aria-label="${orders[2].number} operation 20 Grind"]`);
await last.scrollIntoViewIfNeeded();
const box = await last.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
await page.mouse.up();
await page.waitForSelector(`button[aria-label="${orders[2].number} operation 20 Grind"] [aria-label="Pinned"]`);
await last.click();
await page.waitForSelector('[aria-label="Selected operation"] >> text=Pinned');
await shot('04-pinned');
await page.click('button:has-text("Unpin")');
await page.waitForSelector(`button[aria-label="${orders[2].number} operation 20 Grind"] [aria-label="Pinned"]`, { state: 'detached' });

step('work order: priority and schedule panel');
await page.goto(`${B}/app/manufacturing/work-orders/${orders[2].id}`); await pickEntity();
await page.waitForSelector('text=Scheduled to finish');
await L('Priority').selectOption('1');
await page.goto(`${B}/app/manufacturing/schedule`); await pickEntity();
await page.waitForSelector('text=Out of date');
await page.click('button:has-text("Reschedule")');
await page.waitForSelector('text=Out of date', { state: 'detached' });

step('shop floor: dispatch order and an out-of-sequence start');
await page.click('nav >> text=Shop floor');
await page.waitForSelector('text=Next on');
await shot('05-shop-floor');
const v = await call('GET', '/manufacturing/schedule');
const onM1 = v.bars.filter((b) => b.machineId === m1.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
const notFirst = v.bars.find((b) => b.machineId && b.machineId !== m1.id && b.seq === 10) ?? onM1[1];
const card = page.locator(`button[aria-label="Start op ${notFirst.seq} on ${notFirst.number}"]`).locator('xpath=ancestor::div[contains(@class,"p-4")][1]');
await card.getByLabel('Machine').selectOption({ label: 'M1 · VMC 1' });
expected = 1;
await card.locator('button:has-text("Start")').click();
await card.getByLabel('Reason for starting out of sequence').fill('Customer chasing this one');
await card.locator('button:has-text("Start anyway")').click();
await page.waitForSelector('main button:has-text("Stop")');
await shot('06-started-out-of-sequence');

step('planner sees the reason');
await page.click('nav >> text=Schedule');
await page.waitForSelector('text=Customer chasing this one');

step('mobile');
await page.setViewportSize({ width: 390, height: 844 });
await page.reload(); await page.waitForSelector('text=Started out of sequence');
await page.locator(`text=${orders[0].number}`).locator('visible=true').first().waitFor();
if (await page.locator('[aria-label$="operation 10 Mill"]').locator('visible=true').count()) throw new Error('the Gantt should be hidden on a phone');
await shot('07-mobile-schedule');
if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('horizontal page scroll at 390 px');
await page.goto(`${B}/app/manufacturing/calendars`); await pickEntity(); await page.waitForSelector('text=Two shifts'); await shot('08-mobile-calendars');
if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('horizontal page scroll at 390 px (calendars)');

await browser.close();
if (errors.length) { console.error('Browser errors:\n' + errors.join('\n')); process.exit(1); }
console.log('Scheduling walkthrough passed. Screenshots in', shots);
