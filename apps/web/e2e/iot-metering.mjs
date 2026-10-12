import { chromium } from 'playwright';
// IoT metering (decisions 063 and 064) against running web + API (fresh tenant each run): Plant → Devices adds an edge (its key
// shown once) and a tap on the 5-axis; tap heartbeats with a 20-minute gap are posted to the ingest endpoint with that
// key; stopping the booking sends its usage to review, the supervisor corrects it and the invoice button appears; the
// machine grid and machine page show the states. Booking start is moved back in the local database (test-only).
// Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:iot-metering   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional; DATABASE_URL from env or ../../.env)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/iot-metering', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const dbUrl = process.env.DATABASE_URL ?? fs.readFileSync(new URL('../../../.env', import.meta.url), 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1];
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
const istDate = (d) => new Date(Date.now() + 5.5 * 3600e3 + d * 86400e3).toISOString().slice(0, 10);
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

try {
  step('sign up + onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Plant Lead');
  await L('Work email').fill(`iot${run}@azeonics.com`);
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

  step('a rented 5-axis with a rate card, a customer and a booking in use (API)');
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const call = async (method, path, data) => {
    const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  await call('POST', `/entities/${E}/gst-registrations`, { gstin: chk('27AAACA1234B1Z') });
  await call('POST', '/hsn-codes', { code: '998898', kind: 'sac', description: 'Other manufacturing services', gstRate: '18', effectiveFrom: '2017-07-01' });
  await call('POST', '/manufacturing/calendars', { name: '24x7', shifts: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '00:00' })) });
  const uoms = await call('GET', '/uoms');
  const svc = await call('POST', '/items', { code: 'MAAS', name: 'Machine time', type: 'service', stockUomId: uoms.find((x) => x.code === 'HR').id, hsnCode: '998898' });
  const cnc = await call('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '1800' });
  const m5 = await call('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M5X', name: 'Variaxis 5-axis' });
  await call('POST', '/services/rate-cards', { machineId: m5.id, serviceItemId: svc.id, standardRate: '2500', minimumMinutes: 60, roundingMinutes: 15, validFrom: istDate(-30) });
  const orbit = await call('POST', '/parties', { code: 'ORBIT', name: 'Orbit Space Pvt Ltd', isCustomer: true, gstin: chk('27AABCO1234B1Z') });
  const h = Math.ceil(Date.now() / 900e3) * 900e3;
  const bk = await call('POST', '/services/bookings', { customerId: orbit.id, machineId: m5.id, startsAt: new Date(h + 3600e3).toISOString(), endsAt: new Date(h + 3 * 3600e3).toISOString() });
  for (const a of ['confirm', 'start']) await call('POST', `/services/bookings/${bk.id}/${a}`, {});
  execFileSync('psql', [dbUrl, '-qtAc', `update maas_booking set started_at = now() - interval '90 minutes' where id = '${bk.id}'`]);

  step('Plant → Devices: add an edge (key shown once) and a tap on the 5-axis');
  await page.reload();
  await page.click('nav >> text=Devices');
  await page.waitForURL('**/app/plant/devices');
  await pickEntity();
  await page.click('main button:has-text("Add edge")');
  await L('Code').fill('NM1');
  await L('Name').fill('Navi Mumbai edge PC');
  await dialog('Add edge');
  const key = (await page.getByLabel('Edge key').textContent()).trim();
  expect(key.startsWith('fos_edge_'), 'the key is shown once');
  await page.click('main button:has-text("Add tap")');
  await L('Code').fill('MT1-01');
  await L('Name').fill('5-axis tap');
  await L('Machine').selectOption({ label: 'M5X · Variaxis 5-axis (CNC)' });
  await dialog('Add tap');
  await page.locator('tr', { hasText: 'MT1-01' }).getByText('Variaxis 5-axis').waitFor();
  await page.click('main button:has-text("I\'ve saved it")');
  expect((await page.getByLabel('Edge key').count()) === 0, 'the key is gone once acknowledged');
  await shot('01-devices');

  step('the edge posts the tap’s heartbeats (a 20-minute Wi-Fi gap)');
  let seq = 1;
  const beats = (a, b, state) => Array.from({ length: a - b }, (_, i) => ({ device: 'MT1-01', seq: seq++, state, at: ago(a - i) }));
  const r = await fetch(`${B}/api/iot/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ events: [...beats(92, 80, 'setup'), ...beats(80, 50, 'running'), ...beats(30, 1, 'running'), ...beats(1, 0, 'idle')] }) });
  expect(r.ok, `ingest ${r.status}`);
  expect((await r.json()).results.every((x) => x.status === 'accepted'), 'all heartbeats accepted');

  step('tap settings (decision 064): a new version, pending until the tap reports it');
  await page.locator('tr', { hasText: 'MT1-01' }).getByRole('button', { name: 'Settings' }).click();
  await L('Running from (A)').fill('6.5');
  await L('Amber light').selectOption('setup');
  await dialog('Save settings');
  const edgeFetch = (path, init) => fetch(`${B}/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` } });
  const cfg = await (await edgeFetch('/iot/config')).json();
  expect(cfg.taps[0].config.version === 2 && cfg.taps[0].config.runAmps === 6.5 && cfg.taps[0].config.lights.amber === 'setup', 'the edge gets version 2');
  const report = (configVersion) => edgeFetch('/iot/status', { method: 'POST', body: JSON.stringify({ statuses: [{ device: 'MT1-01', fwVersion: '1.0.0', configVersion, uptime: 60, rssi: -58, outbox: 3, lastError: null, at: new Date().toISOString() }] }) });
  await report(1);
  await page.reload();
  await page.locator('tr', { hasText: 'MT1-01' }).getByText('v2 pending (runs v1)').waitFor();
  await report(2);
  await page.reload();
  await page.locator('tr', { hasText: 'MT1-01' }).getByText('Config v2 applied').waitFor();
  await page.locator('tr', { hasText: 'MT1-01' }).getByText(/signal good \(-58 dBm\) · 3 queued/).waitFor();
  await shot('01b-tap-status');

  step('stop the booking: usage goes to review');
  await page.goto(`${B}/app/services/bookings/${bk.id}`);
  await page.locator('h1', { hasText: bk.number }).waitFor();
  await page.getByRole('img', { name: 'M5X states during the booking' }).waitFor();
  await page.click('button:has-text("Stop machine")');
  await page.getByText('Usage needs review before billing').waitFor();
  expect((await page.locator('button:has-text("Create invoice")').count()) === 0, 'no invoice while under review');
  await shot('02-review');

  step('the supervisor corrects it; billing opens');
  await page.click('main button:has-text("Review usage")');
  await L('Use').selectOption('corrected');
  await L('Minutes').fill('85');
  await L('Why').fill('Tap lost Wi-Fi for 20 min; log sheet shows the spindle ran');
  await dialog('Apply');
  await page.getByText(/Reviewed by Plant Lead: Tap lost Wi-Fi/).waitFor();
  await page.locator('button:has-text("Create invoice")').waitFor();
  await page.locator('tr', { hasText: 'Total' }).getByText('1 h 25 min').waitFor();

  step('Plant → Machines and the machine page');
  await page.click('nav >> text=Machines');
  await page.waitForURL('**/app/machines');
  await page.locator('tr', { hasText: 'M5X' }).getByText('Idle').waitFor();
  await page.click('main a:has-text("M5X")');
  await page.getByRole('img', { name: 'M5X states today' }).waitFor();
  await shot('03-machine');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [`/app/services/bookings/${bk.id}`, '/app/plant/devices', '/app/machines']) {
    await page.goto(`${B}${path}`);
    await page.locator('h1').waitFor();
    await page.waitForLoadState('networkidle');
    expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `no horizontal page scroll at 390 px on ${path}`);
  }
  await shot('04-mobile-machines');
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
console.log('IoT metering walkthrough passed. Screenshots in', shots);
