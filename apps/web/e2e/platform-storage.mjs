import { chromium } from 'playwright';
import fs from 'node:fs';
// Platform → Storage walkthrough (decision 051) against running web + API: a SuperAdmin opens the page, tests a wrong key, tests
// and saves the right one, sees storage on, and the secret is never shown again; phone width.
// The API must run without STORAGE_DRIVER and with STORAGE_CREDENTIAL_KEY_V1; a fake S3 server stands in for R2.
// Usage: pnpm --filter @factoryos/web e2e:platform-storage   (WEB_URL, SHOTS_DIR, CHROMIUM_PATH, DATABASE_URL)
const { createDb } = await import('../../../packages/db/dist/index.js');
const { startFakeS3 } = await import('../../api/scripts/fake-s3.mjs');
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const shots = process.env.SHOTS_DIR ?? new URL('./shots/platform-storage', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const db = createDb(process.env.DATABASE_URL);
const s3 = await startFakeS3();
const run = Date.now() % 100000, errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
let expected = 0; // refusals the walkthrough provokes on purpose
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !(expected && /status of 422/.test(m.text()) && expected--) && errors.push(`console: ${m.text()}`));
const shot = (n) => page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
const L = (t) => page.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);

try {
  step('sign up and become SuperAdmin');
  await page.goto(`${B}/sign-up`);
  const email = `ops${run}@azeonics.com`;
  await L('Full name').fill('Platform Owner'); await L('Work email').fill(email); await L('Password').fill('Sup3r-secret-pw');
  await page.click('button[type=submit]'); await page.waitForURL('**/onboarding');
  await db.$client.query(`insert into platform_admin(user_id, level) select id, 'superadmin' from "user" where email = $1`, [email]);

  step('open Platform → Storage');
  await page.goto(`${B}/platform`);
  await page.click('header >> text=Storage');
  await page.waitForSelector('text=Status');
  await shot('01-open');

  step('a wrong access key is reported by the test');
  await L('Endpoint').fill(s3.endpoint);
  await L('Bucket').fill(s3.bucket);
  await L('Access key ID').fill('AKIDWRONG');
  await L('Secret access key').fill('not-the-secret-' + run);
  expected = 1;
  await page.click('button:has-text("Test connection")');
  await page.waitForSelector('text=InvalidAccessKeyId');

  step('the right key tests and saves');
  await L('Access key ID').fill(s3.accessKeyId);
  await page.click('button:has-text("Test connection")');
  await page.waitForSelector('text=Connection works');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Saved. Uploads now go to this bucket.');
  await page.waitForSelector(`text=bucket ${s3.bucket}`);
  if ((await L('Secret access key').inputValue()) !== '') throw new Error('the secret should be cleared after saving');
  await page.waitForSelector('text=Leave blank to keep the saved secret');
  await shot('02-saved');

  step('reload: settings kept, secret never shown');
  await page.reload();
  await page.waitForSelector(`text=bucket ${s3.bucket}`);
  if ((await L('Access key ID').inputValue()) !== s3.accessKeyId) throw new Error('saved access key id not shown');
  if ((await L('Secret access key').inputValue()) !== '') throw new Error('secret must never be shown');
  const html = await page.content();
  if (html.includes('not-the-secret-' + run)) throw new Error('secret leaked into the page');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForSelector(`text=bucket ${s3.bucket}`);
  await shot('03-mobile');
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('horizontal page scroll at 390 px');
} finally {
  await browser.close();
  s3.close();
  await db.$client.end();
}
if (errors.length) { console.error('Browser errors:\n' + errors.join('\n')); process.exit(1); }
console.log('Platform storage walkthrough passed. Screenshots in', shots);
