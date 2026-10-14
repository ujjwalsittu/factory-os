import { chromium } from 'playwright';
// Menu by area of work, favourites and recent pages, and the "My work" Home (decision 068, slice 2) against running
// web + API: areas and no row of Finance links, collapsing and favourites that survive a reload and follow the person
// to another browser, recent pages, the Customers and Suppliers entries, a restricted person seeing fewer areas and
// tiles, a Home tile with a count and a link, and the phone menu. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:menu-home   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH optional)
import fs from 'node:fs';
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/menu-home', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000,
  errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
};
watch(page);
const shot = (p, n) => p.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const L = (p, t) => p.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const nav = (p) => p.getByRole('navigation', { name: 'Main' }).first();
/** Wait for the debounced save of the menu preferences to reach the API. */
const saved = (p) => {
  const w = p.waitForResponse((r) => r.url().endsWith('/api/me/preferences') && r.request().method() === 'PUT', { timeout: 15000 });
  w.catch(() => undefined); // a failure elsewhere must not be hidden by this wait being cut short
  return w;
};

try {
  step('sign up and create a workspace');
  const email = `menu${run}@azeonics.com`;
  await page.goto(`${B}/sign-up`);
  await L(page, 'Full name').fill('Menu Owner');
  await L(page, 'Work email').fill(email);
  await L(page, 'Password').fill('Sup3r-secret-pw');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding');
  await L(page, 'Workspace (company group) name').fill('Azeonics Group');
  await L(page, 'Legal name').fill('Azeonics Private Limited');
  await L(page, 'Short name').fill('Azeonics');
  await L(page, 'Code').fill('AZ');
  await L(page, 'PAN').fill('AAACA1234B');
  await page.click('button:has-text("Create workspace")');
  await page.waitForURL('**/app');

  // Seed: an item with a reorder level and no stock, so Home has something waiting.
  const me = await (await ctx.request.get(`${B}/api/me`)).json();
  const T = me.tenants[0].id;
  const E = (await (await ctx.request.get(`${B}/api/entities`, { headers: { 'x-tenant-id': T } })).json())[0].id;
  const H = { 'x-tenant-id': T, 'x-entity-id': E, Origin: B };
  const call = async (method, path, data) => {
    const r = await ctx.request.fetch(`${B}/api${path}`, { method, headers: H, data });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const uoms = await call('GET', '/uoms');
  await call('POST', '/items', { code: 'SS-BAR', name: 'Stainless bar 20 mm', type: 'raw_material', stockUomId: uoms.find((u) => u.code === 'KG').id, reorderLevel: '100' });

  step('Home shows the tile with a count and a link');
  await page.goto(`${B}/app`);
  if (await page.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await page.click('main button:has-text(\"Azeonics\")', { timeout: 3000 }).catch(() => null);
  const tile = page.locator('[data-tile="below-reorder"]');
  await tile.waitFor();
  expect((await tile.innerText()).includes('SS-BAR Stainless bar 20 mm'), 'the item is listed');
  expect((await tile.innerText()).includes('0 on hand, reorder at 100'), 'on hand and level are shown');
  expect(await page.getByText('Roadmap', { exact: true }).count() === 0, 'the roadmap is gone');
  expect(!(await page.locator('body').innerText()).includes('Phase 1'), 'no development text on Home');
  expect((await page.locator('[data-clear]').count()) >= 10, 'tiles with nothing waiting are listed as all clear');
  expect((await page.locator('[data-tile]').count()) === 1, 'only the tile with something waiting is a card');
  await shot(page, 'home-desktop');
  await tile.getByRole('link', { name: /Open the list|See all/ }).click();
  await page.waitForURL('**/inventory/balance');

  step('the menu is by area, with no row of Finance links');
  const n = nav(page);
  for (const area of ['Sell', 'Buy', 'Stock', 'Make', 'Quality', 'Machines', 'Services', 'Accounts & GST', 'Settings']) {
    await n.getByRole('button', { name: area, exact: true }).waitFor();
  }
  await page.goto(`${B}/app/accounts/trial-balance`);
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  expect((await page.locator('main a[href="/app/accounts/journals"]').count()) === 0, 'the row of Finance links is gone from the page');
  expect((await n.getByRole('link', { name: 'Account ledger', exact: true }).count()) === 1, 'account ledger is in the menu');
  expect((await n.getByRole('link', { name: 'Trial balance', exact: true }).getAttribute('aria-current')) === 'page', 'the open page is highlighted');

  step('areas collapse and stay collapsed after a reload');
  await page.waitForLoadState('networkidle');
  const wait1 = saved(page);
  await n.getByRole('button', { name: 'Services', exact: true }).click();
  await n.locator('button[aria-expanded="false"]', { hasText: 'Services' }).waitFor();
  expect((await n.getByRole('link', { name: 'Timesheets', exact: true }).count()) === 0, 'its links are hidden');
  await wait1;
  await page.reload();
  await n.locator('button[aria-expanded="false"]', { hasText: 'Services' }).waitFor();

  step('favourites: star a page, see it at the top, keep it after a reload');
  await page.goto(`${B}/app/masters/items`);
  await n.getByRole('button', { name: 'Stock', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  const wait2 = saved(page);
  await n.getByRole('button', { name: 'Add Items to favourites' }).click();
  await n.getByRole('button', { name: 'Remove Items from favourites' }).first().waitFor();
  expect((await n.locator('[aria-label="Favourites"] a', { hasText: 'Items' }).count()) === 1, 'Items is under Favourites');
  await wait2;
  await page.reload();
  await n.locator('[aria-label="Favourites"] a', { hasText: 'Items' }).waitFor();
  await shot(page, 'menu-favourites-desktop');

  step('the same favourites follow the person to another browser');
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page2 = await ctx2.newPage();
  watch(page2);
  const si = await ctx2.request.post(`${B}/api/auth/sign-in/email`, { data: { email, password: 'Sup3r-secret-pw' }, headers: { Origin: B } });
  expect(si.ok(), 'sign in from the second browser');
  await page2.goto(`${B}/app`);
  if (await page2.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await page2.click('main button:has-text(\"Azeonics\")', { timeout: 3000 }).catch(() => null);
  await nav(page2).locator('[aria-label="Favourites"] a', { hasText: 'Items' }).waitFor();
  await nav(page2).locator('button[aria-expanded="false"]', { hasText: 'Services' }).waitFor(); // closed areas follow too
  await ctx2.close();

  step('recent pages');
  const wait3 = saved(page);
  await page.goto(`${B}/app/selling/quotations`);
  await n.getByRole('button', { name: 'Sell', exact: true }).waitFor();
  await wait3;
  await page.goto(`${B}/app/buying/orders`);
  await n.locator('[aria-label="Recent"] a', { hasText: 'Quotations' }).waitFor();
  expect((await n.locator('[aria-label="Recent"] a', { hasText: 'Purchase orders' }).count()) === 0, 'the open page is not listed as recent');

  step('Customers and Suppliers are one page with a role filter');
  await n.getByRole('link', { name: 'Customers', exact: true }).click();
  await page.waitForURL('**/masters/parties?role=customer');
  await page.getByRole('heading', { level: 1, name: 'Customers', exact: true }).waitFor();
  expect((await n.getByRole('link', { name: 'Customers', exact: true }).getAttribute('aria-current')) === 'page', 'Customers is highlighted');
  expect((await n.getByRole('link', { name: 'Suppliers', exact: true }).getAttribute('aria-current')) === null, 'Suppliers is not');
  await n.getByRole('link', { name: 'Suppliers', exact: true }).click();
  await page.waitForURL('**/masters/parties?role=supplier');
  await page.getByRole('heading', { level: 1, name: 'Suppliers', exact: true }).waitFor();
  expect((await page.getByLabel('Filter by role').inputValue()) === 'supplier', 'the filter shows suppliers');

  step('a person with little access sees few areas and one tile');
  const roles = await call('GET', '/roles');
  const clerkRole = await call('POST', '/roles', { name: 'Stores clerk', permissions: ['masters.item.read', 'inventory.report.read'] });
  const clerkEmail = `clerk${run}@azeonics.com`;
  const inv = await call('POST', '/invitations', { email: clerkEmail, roles: [{ roleId: clerkRole.id, entityIds: [E] }] });
  void roles;
  const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page3 = await ctx3.newPage();
  watch(page3);
  const su = await ctx3.request.post(`${B}/api/auth/sign-up/email`, { data: { name: 'Kiran Clerk', email: clerkEmail, password: 'Sup3r-secret-pw' }, headers: { Origin: B } });
  expect(su.ok(), 'clerk signs up');
  const acc = await ctx3.request.post(`${B}/api/invitations/accept`, { data: { token: inv.inviteUrl.split('/').at(-1) }, headers: { Origin: B } });
  expect(acc.ok(), 'clerk accepts the invitation');
  await page3.goto(`${B}/app`);
  if (await page3.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await page3.click('main button:has-text(\"Azeonics\")', { timeout: 3000 }).catch(() => null);
  const cn = nav(page3);
  await cn.getByRole('button', { name: 'Stock', exact: true }).waitFor();
  for (const area of ['Sell', 'Buy', 'Make', 'Quality', 'Machines', 'Services', 'Accounts & GST'])
    expect((await cn.getByRole('button', { name: area, exact: true }).count()) === 0, `${area} is hidden from the clerk`);
  expect((await cn.getByRole('link', { name: 'Stock entries', exact: true }).count()) === 0, 'no stock entries link without permission');
  expect((await cn.getByRole('link', { name: 'Items', exact: true }).count()) === 1, 'Items is there');
  await page3.locator('[data-tile="below-reorder"]').waitFor();
  expect((await page3.locator('[data-tile]').count()) === 1, 'only the tile they can read');
  await shot(page3, 'home-clerk-desktop');
  await ctx3.close();

  step('phone: the menu opens, areas fold, the page does not scroll sideways');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${B}/app`);
  if (await page.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await page.click('main button:has-text(\"Azeonics\")', { timeout: 3000 }).catch(() => null);
  await page.locator('[data-tile="below-reorder"]').waitFor();
  expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'Home does not scroll sideways');
  await shot(page, 'home-phone');
  await page.getByRole('button', { name: 'Open menu' }).click();
  const pn = page.getByRole('dialog', { name: 'Menu' }).getByRole('navigation', { name: 'Main' });
  await pn.getByRole('button', { name: 'Sell', exact: true }).waitFor();
  const box = await pn.getByRole('button', { name: 'Sell', exact: true }).boundingBox();
  expect(box.height >= 36, `area headers are easy to tap (${box.height}px)`);
  await pn.getByRole('button', { name: 'Sell', exact: true }).click();
  expect((await pn.getByRole('button', { name: 'Sell', exact: true }).getAttribute('aria-expanded')) === 'false', 'an area folds on the phone');
  await shot(page, 'menu-phone');
  await pn.getByRole('link', { name: 'Items', exact: true }).first().click();
  await page.waitForURL('**/masters/items');
  expect(!(await page.getByRole('dialog', { name: 'Menu' }).count()), 'the menu closes after choosing a page');

  expect(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
  console.log('✓ menu and Home');
} finally {
  await browser.close();
}
