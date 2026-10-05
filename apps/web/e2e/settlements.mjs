import { chromium } from 'playwright';
// AR/AP settlements walkthrough (decision 036) against running web + API (fresh tenant each run):
// activated books → receipt with "oldest due first" → money on account → later allocation → outstanding,
// reconciliation, cancellation dependency.
// Usage: pnpm --filter @factoryos/web e2e:settlements   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/settlements', import.meta.url).pathname;
import fs from 'node:fs'; fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000, errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const L = (t) => page.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);
const gstin = (f) => { const C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = 0; for (let i = 0; i < 14; i++) { const p = C.indexOf(f[i]) * (i % 2 ? 2 : 1); s += Math.floor(p / 36) + (p % 36); } return f + C[(36 - (s % 36)) % 36]; };

step('sign up + onboard');
await page.goto(`${B}/sign-up`);
await L('Full name').fill('Accounts Lead'); await L('Work email').fill(`ar${run}@azeonics.com`); await L('Password').fill('Sup3r-secret-pw');
await page.click('button[type=submit]'); await page.waitForURL('**/onboarding');
await L('Workspace (company group) name').fill('Azeonics Group'); await L('Legal name').fill('Azeonics Private Limited');
await L('Short name').fill('Azeonics'); await L('Code').fill('AZ'); await L('PAN').fill('AAACA1234B');
await page.click('button:has-text("Create workspace")'); await page.waitForURL('**/app');

step('activated books and an open invoice (API)');
const me = await (await ctx.request.get(`${B}/api/me`)).json();
const T = me.tenants[0].id;
const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
const call = async (method, path, data) => { const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data }); if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`); return r.json(); };
await call('POST', `/entities/${E}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') });
await call('POST', '/hsn-codes', { code: '998898', kind: 'sac', description: 'Machining services', gstRate: '18', effectiveFrom: '2025-04-01' });
const uoms = await call('GET', '/uoms');
const svc = await call('POST', '/items', { code: 'MAAS', name: '5-axis machining, per hour', type: 'service', stockUomId: uoms.find((u) => u.code === 'HR').id, hsnCode: '998898' });
const cus = await call('POST', '/parties', { code: 'SKYR', name: 'Skyroot Aerospace', isCustomer: true, gstin: gstin('27AAACS1234B1Z'), creditDays: 30, addresses: [{ label: 'Works', line1: 'Road 1', city: 'Pune', stateCode: '27', pincode: '411001' }] });
await call('GET', '/accounts/settings');
const accounts = await call('GET', '/accounts/accounts');
const acc = (role) => accounts.find((a) => a.role === role).id;
const ws = await call('PUT', '/accounts/opening', { lines: [{ accountId: acc('debtors'), debit: '10000', credit: '0', partyId: cus.id, billReference: 'TALLY/118' }, { accountId: acc('equity'), debit: '0', credit: '10000' }], bills: [{ partyId: cus.id, reference: 'TALLY/118', side: 'debit', amount: '10000' }], settlements: [], receiptBaselines: [] });
const rec = await call('GET', '/accounts/opening/reconciliation');
await call('POST', '/accounts/opening/activate', { worksheetId: ws.id, reviewedToken: rec.snapshotToken });
const date = (await call('GET', '/accounts/settings')).cutoverDate;
const inv = await call('POST', '/sales-invoices', { customerId: cus.id, invoiceDate: date, lines: [{ itemId: svc.id, qty: '10', rate: '1000' }] });
const sub = await call('POST', `/sales-invoices/${inv.id}/submit`, {});
await page.reload();

step('receipt: oldest due first, excess on account');
await page.click('nav >> text=Receipts & payments');
await page.waitForSelector('text=Choose a legal entity'); await page.click('main button:has-text("Azeonics")');
await page.waitForSelector('text=No receipts yet'); await shot('01-empty');
await page.click('a:has-text("New receipt")');
await L('Customer').selectOption({ label: 'Skyroot Aerospace' });
await page.waitForSelector('text=TALLY/118');
await L('Amount (INR)').fill('25000'); await L('Bank / cheque reference').fill('NEFT UTIB000123');
await page.click('button:has-text("Oldest due first")');
await page.waitForSelector('text=₹3,200.00'); // held on account: 25,000 − 10,000 − 11,800
await shot('02-receipt-form');
await page.click('button:has-text("Submit")'); await page.waitForSelector('text=AZ/RCT/26-27/00001');
await page.waitForSelector('text=still to apply');
await shot('03-receipt-submitted');

step('outstanding and reconciliation');
await page.click('nav >> text=Outstanding');
await page.waitForSelector('text=Nothing outstanding.'); await page.waitForSelector('text=Money received on account');
await shot('04-outstanding');
await page.click('button[role=tab]:has-text("Reconciliation")'); await page.waitForSelector('td:has-text("✓")');
await shot('05-reconciliation');

step('apply on-account money to a new invoice');
const inv2 = await call('POST', '/sales-invoices', { customerId: cus.id, invoiceDate: date, lines: [{ itemId: svc.id, qty: '1', rate: '1000' }] });
const sub2 = await call('POST', `/sales-invoices/${inv2.id}/submit`, {});
await page.click('nav >> text=Receipts & payments'); await page.click('text=AZ/RCT/26-27/00001');
await page.getByLabel(`Apply to ${sub2.number}`).fill('1180');
await L('Reason').fill('Customer asked to adjust advance');
await page.click('button:has-text("Apply on-account money")');
await page.waitForSelector('text=AZ/ADJ/26-27/00001');
await page.waitForSelector('text=₹2,020.00 still to apply');
await shot('06-allocated');

step('cancellation dependency and reversal');
const r = await ctx.request.post(`${B}/api/sales-invoices/${inv2.id}/cancel`, { headers: H, data: { reason: 'wrong rate' } });
if (r.status() !== 409) throw new Error(`invoice cancel should be blocked, got ${r.status()}`);
await page.click('button:has-text("Cancel") >> nth=-1');
await L('Reason (recorded in the audit log)').fill('Applied to the wrong invoice');
await page.click('button:has-text("Cancel allocation")');
await page.waitForSelector('text=₹3,200.00 still to apply');
await shot('07-allocation-cancelled');

step('mobile');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${B}/app/accounts/outstanding`); await page.waitForSelector('text=Money received on account'); await shot('08-mobile-outstanding');

await browser.close();
const unexpected = errors.filter((e) => !e.includes('409 (Conflict)'));
if (unexpected.length) { console.error('Browser errors:\n' + unexpected.join('\n')); process.exit(1); }
console.log('Settlements walkthrough passed. Screenshots in', shots);
