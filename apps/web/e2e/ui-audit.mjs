import { chromium } from 'playwright';
// UI audit: a fresh workspace with a modest seeded dataset, then every app page at desktop and 390 px. Per page it
// records the heading, load time, console errors, failed API calls, horizontal overflow and whether it shows an empty
// state, and saves screenshots plus contact sheets. Output: AUDIT_DIR (default e2e/shots/ui-audit) with audit.json.
// Usage: CHROMIUM_PATH=… node e2e/ui-audit.mjs   (WEB_URL, AUDIT_DIR optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const out = process.env.AUDIT_DIR ?? new URL('./shots/ui-audit', import.meta.url).pathname;
fs.mkdirSync(`${out}/desktop`, { recursive: true });
fs.mkdirSync(`${out}/mobile`, { recursive: true });
const run = Date.now() % 100000;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const L = (t) => page.getByLabel(t, { exact: true });
const gstin = (f) => { const C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = 0; for (let i = 0; i < 14; i++) { const p = C.indexOf(f[i]) * (i % 2 ? 2 : 1); s += Math.floor(p / 36) + (p % 36); } return f + C[(36 - (s % 36)) % 36]; };

// ── Workspace ──
await page.goto(`${B}/sign-up`);
await L('Full name').fill('Audit Owner');
await L('Work email').fill(`audit${run}@azeonics.com`);
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

// ── Seed (API) ──
const me = await (await ctx.request.get(`${B}/api/me`)).json();
const T = me.tenants[0].id;
const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
const call = async (method, path, data) => {
  const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data });
  if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
  return r.json();
};
const ids = {};
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
await call('POST', `/entities/${E}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') });
for (const [code, d] of [['72249000', 'Steel bars'], ['84669390', 'Machine parts'], ['998898', 'Job work services']]) await call('POST', '/hsn-codes', { code, kind: code.startsWith('99') ? 'sac' : 'hsn', description: d, gstRate: '18', effectiveFrom: '2025-04-01' });
const uoms = await call('GET', '/uoms');
const u = (c) => uoms.find((x) => x.code === c).id;
const bar = await call('POST', '/items', { code: 'SS-BAR', name: 'Stainless bar 20 mm', type: 'raw_material', tracking: 'batch', stockUomId: u('KG'), hsnCode: '72249000' });
const part = await call('POST', '/items', { code: 'HOUSING', name: 'Pump housing', type: 'finished_good', tracking: 'none', stockUomId: u('NOS'), hsnCode: '84669390' });
await call('POST', '/items', { code: 'SP-BELT', name: 'Spindle belt', type: 'consumable', stockUomId: u('NOS'), hsnCode: '84669390' });
ids.item = part.id;
const cust = await call('POST', '/parties', { code: 'ORBIT', name: 'Orbit Aerospace Pvt Ltd', isCustomer: true, gstin: gstin('27AABCO1234B1Z') });
const sup = await call('POST', '/parties', { code: 'TIMET', name: 'Titanium Metals India', isSupplier: true, gstin: gstin('27AAACT1234B1Z'), creditDays: 45 });
const sto = await call('POST', '/warehouses', { code: 'STO', name: 'Main stores', type: 'stores' });
const fg = await call('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' });
const rec = await call('POST', '/stock-entries', { purpose: 'receipt', postingDate: today, partyId: sup.id, lines: [{ itemId: bar.id, qty: '200', toWarehouseId: sto.id, newBatchNo: 'HT-101', rate: '420' }] });
await call('POST', `/stock-entries/${rec.id}/submit`, {});
ids.entry = rec.id;
ids.batch = (await call('GET', `/batches?itemId=${bar.id}`))[0]?.id;
const cnc = await call('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC machining', hourlyRate: '1800' });
const vmc = await call('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'VMC-1', name: 'VMC 3-axis', critical: true });
ids.machine = vmc.id;
await call('POST', '/manufacturing/calendars', { name: 'Two shifts', shifts: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '06:00', end: '22:00' })) });
const bom = await call('POST', '/manufacturing/boms', { itemId: part.id, revision: 'A', materials: [{ itemId: bar.id, qty: '2.5' }], operations: [{ seq: 10, name: 'Rough and finish', workCentreId: cnc.id, runMinutesPerUnit: '45' }] });
await call('POST', `/manufacturing/boms/${bom.id}/activate`, {});
ids.bom = bom.id;
const wo = await call('POST', '/manufacturing/work-orders', { itemId: part.id, plannedQty: '20', sourceWarehouseId: sto.id, targetWarehouseId: fg.id });
await call('POST', `/manufacturing/work-orders/${wo.id}/release`, {});
ids.wo = wo.id;
const plan = await call('POST', '/maintenance/plans', { machineId: vmc.id, name: 'Quarterly service', everyDays: 90, leadDays: 7, plannedMinutes: 120, lastDoneAt: new Date(Date.now() - 86 * 86400e3).toISOString(), items: [{ text: 'Spindle runout', unit: 'mm', min: '0', max: '0.005' }] });
ids.mo = (await call('POST', `/maintenance/plans/${plan.id}/order`, {})).id;
ids.party = cust.id;
fs.writeFileSync(`${out}/seed.json`, JSON.stringify({ tenantId: T, entityId: E, ids }, null, 2));

// ── Routes ──
const dynamic = { '/app/manufacturing/work-orders/[id]': ids.wo, '/app/manufacturing/boms/[id]': ids.bom, '/app/inventory/entries/[id]': ids.entry, '/app/inventory/batches/[id]': ids.batch, '/app/machines/[id]': ids.machine, '/app/maintenance/orders/[id]': ids.mo };
// Every page under src/app/app; record pages without a seeded record are listed as not audited, never dropped silently.
const appDir = new URL('../src/app/app', import.meta.url).pathname;
const found = [];
const walk = (dir, route) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${dir}/${e.name}`, `${route}/${e.name}`);
    else if (e.name === 'page.tsx') found.push(route);
  }
};
walk(appDir, '/app');
found.sort();
const notAudited = found.filter((r) => r.includes('[') && !dynamic[r]);
const routes = found.filter((r) => !notAudited.includes(r)).map((r) => (r.includes('[') ? r.replace(/\[[a-zA-Z]+\]/, dynamic[r]) : r));
// ROUTES=a,b limits the run to routes containing any of the given fragments (for re-checking fixes).
const only = process.env.ROUTES?.split(',').filter(Boolean);
if (only) routes.splice(0, routes.length, ...routes.filter((r) => only.some((o) => r.includes(o))));
fs.writeFileSync(`${out}/routes.txt`, found.join('\n'));
const results = [];
let current;
page.on('console', (m) => m.type() === 'error' && current && current.consoleErrors.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => current && current.consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('response', (r) => current && r.url().includes('/api/') && r.status() >= 400 && current.failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(B, '').slice(0, 120)}`));
// The menu saves its recent pages as a page is left; the browser reports that request as aborted, and it still completes.
page.on('requestfailed', (r) => current && r.url().includes('/api/') && !(r.url().endsWith('/api/me/preferences') && r.failure()?.errorText === 'net::ERR_ABORTED') && current.failed.push(`no response (${r.failure()?.errorText ?? 'unknown'}) ${r.method()} ${r.url().replace(B, '').slice(0, 120)}`));
const slug = (r) => r.replace(/^\/app\/?/, '').replace(/[\/]/g, '__') || 'home';
for (const width of process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1400, 390]) {
  await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
  for (const route of routes) {
    current = { route, width, consoleErrors: [], failed: [] };
    const t0 = Date.now();
    try {
      await page.goto(`${B}${route}`, { waitUntil: 'domcontentloaded' });
      if (await page.waitForSelector('text=Choose a legal entity', { timeout: 1500 }).catch(() => null)) {
        await page.click('main button:has-text("Azeonics")', { timeout: 3000 }).catch(() => null);
      }
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
      current.ms = Date.now() - t0;
      current.h1 = (await page.locator('h1').first().textContent({ timeout: 2000 }).catch(() => null))?.trim() ?? null;
      current.title = await page.title();
      current.overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      // The elements that are wider than the box they sit in (outside any scrolling area): what causes an overflow.
      if (current.overflow)
        current.wide = await page.evaluate(() => {
          const scrolls = (el) => { for (let a = el.parentElement; a; a = a.parentElement) if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(a).overflowX)) return true; return false; };
          return [...document.querySelectorAll('body *')]
            .filter((el) => el.parentElement && el.getBoundingClientRect().width > el.parentElement.clientWidth + 1 && el.getBoundingClientRect().right > window.innerWidth + 1 && !scrolls(el))
            .slice(0, 6)
            .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)} "${el.textContent?.trim().slice(0, 30)}"`);
        });
      current.empty = await page.locator('text=/^No |nothing|Nothing/').count();
      current.loading = await page.locator('text=/Loading…|Loading\\.\\.\\./').count();
      current.buttons = await page.locator('main button, main a[class*="bg-accent"]').count();
      await page.screenshot({ path: `${out}/${width > 500 ? 'desktop' : 'mobile'}/${slug(route.replace(/[0-9a-f-]{36}/, 'id'))}.png`, fullPage: true });
    } catch (e) {
      current.error = e.message.slice(0, 200);
    }
    results.push(current);
  }
}
// Navigation as the owner sees it.
await page.setViewportSize({ width: 1400, height: 900 });
await page.goto(`${B}/app`);
const nav = await page.evaluate(() => [...document.querySelectorAll('nav a, nav p, nav div > span')].map((n) => `${n.tagName}:${n.textContent?.trim()}`).filter((x) => x.length > 2));
// Menu links as the owner sees them: every one must open a real page, and every page that is not a record page (no
// [id]) must be the menu's own, under one of its paths, or a create/print page of one.
await page.waitForSelector('nav[aria-label="Main"] a[href^="/app"]', { timeout: 15000 });
const menuPaths = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Main"] a[href^="/app"]')].map((a) => a.getAttribute('href').split('?')[0]));
const menu = [...new Set(menuPaths)];
const pageRoutes = new Set(found.map((r) => r.replace(/\/\[[^/]+\]/g, '/:id')));
const menuBroken = menu.filter((m) => !found.includes(m));
const unreachable = found.filter((r) => !r.includes('[') && r !== '/app' && !menu.some((m) => r === m || r.startsWith(`${m}/`)));
fs.writeFileSync(`${out}/audit.json`, JSON.stringify({ seed: ids, nav, menu, menuBroken, unreachable, notAudited, results }, null, 2));
void pageRoutes;
await browser.close();
if (menuBroken.length || unreachable.length) console.log(`Menu links that open no page: ${menuBroken.join(', ') || 'none'}. Pages outside every menu path: ${unreachable.join(', ') || 'none'}.`);
console.log(`Audited ${results.length} page views of ${routes.length} pages; ${notAudited.length} record pages need a record and were not audited (listed in audit.json). Output in ${out}`);
if (menuBroken.length) process.exit(1);
