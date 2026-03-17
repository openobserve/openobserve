const { chromium } = require('@playwright/test');
const dotenv = require('dotenv');
dotenv.config();

(async () => {
  const authFile = './playwright-tests/utils/auth/user.json';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: authFile, viewport: { width: 1500, height: 1024 } });
  const page = await context.newPage();

  const baseUrl = process.env.ZO_BASE_URL + '?org_identifier=' + process.env.ORGNAME;
  await page.goto(baseUrl);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const metricsMenu = page.locator('[data-test="menu-link-\\/metrics-item"]');
  await metricsMenu.click();
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'test-results/debug-metrics-initial.png', fullPage: true });

  const dataTests = await page.$$eval('[data-test]', els =>
    els.map(el => ({
      dt: el.getAttribute('data-test'),
      tag: el.tagName,
      vis: el.offsetWidth > 0,
      txt: (el.textContent || '').substring(0, 50).trim()
    }))
  );

  console.log('=== ALL data-test on metrics page ===');
  dataTests.forEach(d => console.log(JSON.stringify(d)));

  // Check for buttons with text
  const buttons = await page.$$eval('button', els =>
    els.map(el => ({
      txt: (el.textContent || '').substring(0, 50).trim(),
      dt: el.getAttribute('data-test'),
      cls: (el.className || '').substring(0, 80),
      vis: el.offsetWidth > 0
    }))
  );

  console.log('\n=== Buttons on metrics page ===');
  buttons.filter(b => b.vis).forEach(b => console.log(JSON.stringify(b)));

  await browser.close();
})();
