import { chromium } from 'playwright';
// DD-MM-YYYY date field (decision 068) against running web + API: today's date shows as DD-MM-YYYY, an impossible date
// is flagged and clears the value, other separators are read and tidied on leaving the field. Desktop and 390 px.
// Usage: pnpm --filter @factoryos/web e2e:date-input   (WEB_URL, CHROMIUM_PATH optional)
const B = process.env.WEB_URL ?? 'http://localhost:3000';
const run = Date.now() % 100000,
  errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const L = (t) => page.getByLabel(t, { exact: true });
const step = (s) => console.log('→', s);
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

try {
  step('sign up + onboard');
  await page.goto(`${B}/sign-up`);
  await L('Full name').fill('Date Owner');
  await L('Work email').fill(`dates${run}@azeonics.com`);
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

  for (const width of [1400, 390]) {
    step(`stock entry posting date at ${width} px`);
    await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
    await page.goto(`${B}/app/inventory/entries/new?purpose=receipt`);
    if (await page.waitForSelector('text=Choose a legal entity', { timeout: 3000 }).catch(() => null)) await page.click('main button:has-text("Azeonics")', { timeout: 3000 }).catch(() => null);
    const field = L('Posting date');
    await field.waitFor();
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const shown = `${today.slice(8, 10)}-${today.slice(5, 7)}-${today.slice(0, 4)}`;
    expect((await field.inputValue()) === shown, `today shows as ${shown}, got ${await field.inputValue()}`);
    expect((await field.getAttribute('placeholder')) === 'DD-MM-YYYY', 'placeholder');

    await field.fill('31-02-2026');
    expect((await field.getAttribute('aria-invalid')) === 'true', 'impossible date is flagged');
    expect(!(await field.evaluate((el) => el.checkValidity())), 'impossible date fails validity');

    await field.fill('1/4/2026');
    await field.blur();
    expect((await field.inputValue()) === '01-04-2026', `tidied to 01-04-2026, got ${await field.inputValue()}`);
    expect((await field.getAttribute('aria-invalid')) !== 'true', 'valid date is not flagged');
    expect(await field.evaluate((el) => el.checkValidity()), 'valid date passes validity');

    await field.fill('2026-10-13');
    await field.blur();
    expect((await field.inputValue()) === '13-10-2026', 'pasted ISO date is shown as DD-MM-YYYY');
    expect(await page.getByRole('button', { name: 'Open calendar' }).first().isVisible(), 'calendar button');
    expect(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'no sideways scroll');
  }
  expect(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
  console.log('✓ date field');
} finally {
  await browser.close();
}
