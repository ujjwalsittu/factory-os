// Approvals inbox in the browser (decision 076): a teammate's week of hours (entity A), their maintenance sign-off on a
// critical machine (entity B) and the GST returns they prepared all wait on the owner in one list, with a count in the
// menu. The owner approves the week and verifies the order from the list, and opens a GST return in its own entity.
// Desktop and 390 px. Needs the API and web running; WEB_URL overrides http://localhost:3000.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = new URL('./shots/approvals/', import.meta.url).pathname;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const C = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gstin = (first) => {
  let n = 0;
  for (let i = 0; i < 14; i++) {
    const p = C.indexOf(first[i]) * (i % 2 ? 2 : 1);
    n += Math.floor(p / 36) + (p % 36);
  }
  return first + C[(36 - (n % 36)) % 36];
};
const fetcher = (context) => {
  const f = async (method, path, data, expected, headers = {}) => {
    const res = await context.request.fetch(`${B}/api${path}`, { method, data, headers: { origin: B, ...f.scope, ...headers } });
    const body = await res.json().catch(() => null);
    if (expected) assert.equal(res.status(), expected, `${method} ${path}: ${JSON.stringify(body)}`);
    else assert.ok(res.ok(), `${method} ${path}: ${res.status()} ${JSON.stringify(body)}`);
    return body;
  };
  f.scope = {};
  return f;
};
const call = fetcher(ctx);

try {
  console.log('→ a workspace with two entities, books and a GST registration in the first');
  await call('POST', '/auth/sign-up/email', { name: 'Inbox Owner', email: `inbox${Date.now()}@example.com`, password: 'Sup3r-secret-pw' });
  const w = await call('POST', '/tenants', { name: 'Inbox Works', entity: { legalName: 'Inbox Works Private Limited', shortName: 'Inbox Works', code: 'IW', pan: 'AAACI1234B' } }, 201);
  const A = w.entity.id;
  call.scope = { 'x-tenant-id': w.tenant.id, 'x-entity-id': A };
  const entB = await call('POST', '/entities', { legalName: 'Orbit Data Private Limited', shortName: 'Orbit Data', code: 'OD', pan: 'AAACO1234C' }, 201);
  const reg = await call('POST', `/entities/${A}/gst-registrations`, { gstin: gstin('27AAACI1234B1Z') }, 201);
  const ws2 = await call('PUT', '/accounts/opening', { lines: [], bills: [], settlements: [], receiptBaselines: [] });
  const rec = await call('GET', '/accounts/opening/reconciliation');
  await call('POST', '/accounts/opening/activate', { worksheetId: ws2.id, reviewedToken: rec.snapshotToken });
  const period = (await call('GET', '/accounts/settings')).cutoverDate.slice(0, 7);
  const uom = (await call('GET', '/uoms')).find((u) => u.code === 'NOS');
  await call('POST', '/hsn-codes', { code: '998365', kind: 'sac', description: 'Engineering', gstRate: '18', effectiveFrom: '2025-04-01' }, 201);
  const svc = await call('POST', '/items', { code: 'SVC', name: 'Engineering services', type: 'service', stockUomId: uom.id, hsnCode: '998365' }, 201);
  const cust = await call('POST', '/parties', { code: 'SAT', name: 'Satellite startup', isCustomer: true, gstTreatment: 'unregistered', stateCode: '27' }, 201);
  const p = await call('POST', '/services/projects', { customerId: cust.id, title: 'Payload bracket', serviceItemId: svc.id, contractValue: '100000', retentionPct: '0', dlpMonths: 0 }, 201);
  await call('POST', `/services/projects/${p.id}/milestones`, { name: 'Delivery', amount: '100000' }, 201);
  await call('POST', `/services/projects/${p.id}/activate`, {}, 201);
  const wc = await call('POST', '/manufacturing/work-centres', { code: 'GS', name: 'Ground station', hourlyRate: '900' }, 201, { 'x-entity-id': entB.id });
  const antenna = await call('POST', `/manufacturing/work-centres/${wc.id}/machines`, { code: 'ANT', name: 'Antenna', critical: true }, 201, { 'x-entity-id': entB.id });

  console.log('→ a teammate logs hours, prepares the GST returns, and signs off a breakdown in the other entity');
  const role = await call('POST', '/roles', {
    name: 'Crew',
    permissions: ['services.project.read', 'services.timesheet.read', 'services.timesheet.create', 'compliance.gst_return.read', 'compliance.gst_return.create', 'maintenance.order.read', 'maintenance.order.update', 'maintenance.breakdown.create'],
  }, 201);
  const email = `crew${Date.now()}@example.com`;
  const invite = await call('POST', '/invitations', { email, roles: [{ roleId: role.id, entityIds: [A, entB.id] }] }, 201);
  await new Promise((r) => setTimeout(r, 11000));
  const crewCtx = await browser.newContext();
  const crew = fetcher(crewCtx);
  await crew('POST', '/auth/sign-up/email', { name: 'Meera Crew', email, password: 'Sup3r-secret-pw' });
  await crew('POST', '/invitations/accept', { token: invite.inviteUrl.split('/').at(-1) }, 201);
  crew.scope = { 'x-tenant-id': w.tenant.id, 'x-entity-id': A };
  const crewId = (await crew('GET', '/me')).user?.id ?? (await crew('GET', '/me')).id;
  await call('POST', '/services/cost-rates', { userId: crewId, hourlyRate: '800', effectiveFrom: `${period}-01` }, 201);
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  await crew('POST', '/services/timesheets', { projectId: p.id, workDate: today, hours: '7.5', notes: 'Bracket FEA' }, 201);
  await crew('POST', '/services/timesheets/submit', { from: today, to: today }, 201);
  const prepared = await crew('POST', '/gst-returns/prepare', { gstRegistrationId: reg.id, period }, 200);
  for (const r of prepared) await crew('POST', `/gst-returns/${r.id}/review`, {}, 200);
  const bd = await crew('POST', '/maintenance/breakdowns', { machineId: antenna.id, symptom: 'Rotator stalls', failedAt: new Date(Date.now() - 3600e3).toISOString() }, 201, { 'x-entity-id': entB.id });
  await crew('POST', `/maintenance/orders/${bd.id}/done`, { cause: 'Gearbox', action: 'Re-greased' }, 201, { 'x-entity-id': entB.id });

  console.log('→ the menu counts four things waiting on the owner');
  await page.goto(`${B}/app`);
  const menuLink = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Approvals/ });
  await menuLink.getByLabel('4 waiting').waitFor();
  await menuLink.click();
  await page.waitForURL(/\/app\/approvals$/);
  await page.getByRole('tab', { name: /Needs me/ }).waitFor();
  for (const title of ['GST returns to approve', 'Maintenance to verify', 'Timesheets']) await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await page.getByRole('cell', { name: 'Orbit Data' }).waitFor();
  assert.equal(await page.getByLabel('Entity').count(), 1, 'two entities: an entity filter');
  await page.screenshot({ path: `${SHOTS}01-needs-me.png`, fullPage: true });

  console.log('→ approve the week and verify the order from the list');
  await page.getByRole('button', { name: 'Approve 7.50 h' }).click();
  await page.getByRole('heading', { name: 'Timesheets', exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await page.getByRole('heading', { name: 'Maintenance to verify', exact: true }).waitFor({ state: 'detached' });
  await menuLink.getByLabel('2 waiting').waitFor();
  assert.equal((await call('GET', `/maintenance/orders/${bd.id}`, undefined, 200, { 'x-entity-id': entB.id })).status, 'verified');

  console.log('→ filter by kind, then open a GST return in its entity');
  await page.getByLabel('Kind').selectOption('gst_return');
  await page.locator('[data-kind="gst_return"] a').first().click();
  await page.waitForURL(/\/app\/compliance\/gst-returns\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Approve' }).waitFor();

  console.log('→ waiting on others: the owner sent nothing');
  await page.goto(`${B}/app/approvals`);
  await page.getByRole('tab', { name: /Waiting on others/ }).click();
  await page.getByText('Nothing waiting on others').waitFor();

  console.log('→ phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: /Needs me/ }).click();
  await page.getByRole('heading', { name: 'GST returns to approve', exact: true }).waitFor();
  await page.waitForTimeout(500);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(wide <= 390, `the inbox scrolls sideways (${wide}px)`);
  await page.screenshot({ path: `${SHOTS}02-mobile.png`, fullPage: true });
  await crewCtx.close();
  assert.deepEqual(errors, []);
  console.log('PASS approvals browser');
} finally {
  await browser.close();
}
