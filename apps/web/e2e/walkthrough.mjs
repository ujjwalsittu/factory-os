import { chromium } from 'playwright';
import crypto from 'node:crypto';

// Full browser walkthrough of Phase 0 against running web + API (see docs/ai/STATUS.md).
// Usage: pnpm --filter @factoryos/web e2e
//   WEB_URL (default http://localhost:3000), SHOTS_DIR (default ./e2e/shots),
//   CHROMIUM_PATH (optional), SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD (optional: enables the platform step).
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots', import.meta.url).pathname;
import fs from 'node:fs'; fs.mkdirSync(shots, { recursive: true });
const run = Date.now() % 100000;
const email = `prachi${run}@azeonics.com`;
const errors = [];

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secret.replace(/=+$/, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', key).update(ctr).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: false });
const step = (s) => console.log('→', s);

step('landing'); await page.goto(B); await page.waitForLoadState('networkidle'); await shot('01-landing');
await page.screenshot({ path: `${shots}/01b-landing-full.png`, fullPage: true });

step('sign up'); await page.click('text=Sign in'); await page.click('text=Create an account');
await page.fill('input[autocomplete=name]', 'Prachi Kulkarni');
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', 'Sup3r-secret-pw');
await shot('02-sign-up');
await page.click('button[type=submit]');
await page.waitForURL('**/onboarding');

step('onboarding'); await page.getByLabel('Workspace (company group) name', { exact: true }).fill('Azeonics Group');
await page.getByLabel('Legal name', { exact: true }).fill('Azeonics Private Limited');
await page.getByLabel('Short name', { exact: true }).fill('Azeonics');
await page.getByLabel('Code', { exact: true }).fill('AZ');
await page.getByLabel('PAN', { exact: true }).fill('AAACA1234B');
await shot('03-onboarding');
await page.click('button:has-text("Create workspace")');
await page.waitForURL('**/app'); await page.waitForSelector('text=Set up your workspace'); await shot('04-home');

step('entities'); await page.click('nav >> text=Entities & GST'); await page.waitForSelector('text=Azeonics Private Limited');
await page.click('button:has-text("Add GSTIN")');
await page.getByLabel('GSTIN', { exact: true }).fill('27AAACA1234B1Z0');
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForSelector('text=Check digit does not match'); await shot('05-gstin-error');
const C='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', f='27AAACA1234B1Z'; let s=0; for(let i=0;i<14;i++){const p=C.indexOf(f[i])*(i%2?2:1); s+=Math.floor(p/36)+p%36}
await page.getByLabel('GSTIN', { exact: true }).fill(f + C[(36 - s % 36) % 36]);
await page.getByLabel('E-invoicing applies from', { exact: true }).fill('2027-04-01');
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForSelector('text=E-invoice from 01-Apr-2027');
await page.click('button:has-text("Add entity")');
await page.getByLabel('Legal name', { exact: true }).fill('EarthNow Private Limited');
await page.getByLabel('Short name', { exact: true }).fill('EarthNow');
await page.getByLabel('Code', { exact: true }).fill('EN');
await page.getByLabel('Parent entity', { exact: true }).selectOption({ label: 'Azeonics' });
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForSelector('text=Subsidiary of Azeonics');
await page.locator('button:has-text("Add plant")').first().click();
await page.getByLabel('Name', { exact: true }).fill('Navi Mumbai'); await page.getByLabel('Code', { exact: true }).fill('NM1');
await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('text=Navi Mumbai');
await shot('06-entities');

step('users + invite'); await page.click('nav >> text=Users'); await page.waitForSelector('text=Prachi Kulkarni');
await page.click('button:has-text("Invite user")');
await page.getByLabel('Email', { exact: true }).fill(`rahul${run}@earthnow.tech`);
await page.getByLabel('Scope', { exact: true }).selectOption('some');
await page.getByLabel('EarthNow', { exact: true }).check(); await page.getByLabel('Azeonics', { exact: true }).uncheck();
await shot('07-invite-dialog');
await page.click('button:has-text("Create invitation")'); await page.waitForSelector('text=Invitation created');
await shot('08-users');

step('roles'); await page.click('nav >> text=Roles'); await page.click('button:has-text("Accountant")');
await page.waitForSelector('text=Vouchers and invoices'); await shot('09-roles');

step('palette'); await page.keyboard.press('Control+k'); await page.keyboard.type('audit'); await shot('10-palette');
await page.keyboard.press('Enter'); await page.waitForURL('**/settings/audit'); await page.waitForSelector('text=Chain intact'); await shot('11-audit');

step('2FA'); await page.click('nav >> text=My security');
await page.getByLabel('Confirm your password', { exact: true }).fill('Sup3r-secret-pw'); await page.click('button:has-text("Set up two-factor")');
const secret = await page.locator('code').first().textContent();
await page.getByLabel('2. Enter the 6-digit code', { exact: true }).fill(totp(secret.trim()));
await shot('12-2fa-setup');
await page.click('button:has-text("Verify and turn on")'); await page.waitForSelector('text=Two-factor is on');

step('entity switch'); await page.click('header button[aria-haspopup=listbox]'); await page.click('[role=option]:has-text("EarthNow")');
await page.click('nav >> text=Home'); await page.waitForSelector('text=EarthNow Private Limited'); await shot('13-home-earthnow');

step('dark mode'); await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await page.click('nav >> text=Entities & GST'); await page.waitForSelector('text=Navi Mumbai'); await shot('14-entities-dark');
await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });

step('sign out → sign in with 2FA'); await page.click('button[aria-label="Account menu"]'); await page.click('text=Sign out'); await page.waitForURL('**/sign-in');
await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill('Sup3r-secret-pw'); await page.click('button[type=submit]');
await page.waitForURL('**/sign-in/two-factor**'); await shot('15-two-factor');
await page.getByLabel('Authentication code', { exact: true }).fill(totp(secret.trim())); await page.click('button:has-text("Verify")');
await page.waitForURL('**/app'); await page.waitForSelector('text=Good');

step('mobile app menu');
await page.setViewportSize({ width: 390, height: 844 });
await page.click('button[aria-label="Open menu"]'); await page.click('[role=dialog] >> text=Users'); await page.waitForURL('**/settings/users');
await page.screenshot({ path: `${shots}/19-mobile-users.png` });
console.log('app mobile overflow:', await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
await page.setViewportSize({ width: 1360, height: 860 });

if (process.env.SUPERADMIN_EMAIL) {
step('platform as superadmin');
const admin = await browser.newContext({ viewport: { width: 1360, height: 860 } }); const p2 = await admin.newPage();
await p2.goto(`${B}/sign-in`); await p2.getByLabel('Email', { exact: true }).fill(process.env.SUPERADMIN_EMAIL); await p2.getByLabel('Password', { exact: true }).fill(process.env.SUPERADMIN_PASSWORD ?? ''); await p2.click('button[type=submit]');
await p2.waitForURL(/\/(platform|app)/); await p2.goto(`${B}/platform`); await p2.waitForSelector('text=Platform console'); await p2.waitForSelector('text=Azeonics Group');
await p2.screenshot({ path: `${shots}/16-platform.png` });
}

step('mobile landing'); const m = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p3 = await m.newPage(); await p3.goto(B); await p3.screenshot({ path: `${shots}/17-mobile.png` });
const overflow = await p3.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); console.log('mobile horizontal overflow:', overflow);

await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO PAGE ERRORS');
const unexpected = errors.filter((e) => !e.includes('400 (Bad Request)')); // the invalid-GSTIN step returns 400 on purpose
if (unexpected.length) process.exit(1);
console.log('WALKTHROUGH OK');
