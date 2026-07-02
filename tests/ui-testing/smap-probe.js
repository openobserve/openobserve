// One-off probe: reproduce upload-invalid-zip flow and dump what the UI shows.
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';
const ORG = process.env.ORGNAME || 'default';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
  const page = await ctx.newPage();

  page.on('response', (res) => {
    if (res.url().includes('/sourcemaps')) console.log('API', res.status(), res.request().method(), res.url().slice(0, 120));
  });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 160)); });

  await page.goto(`${BASE}/web/rum/upload-source-maps?org_identifier=${ORG}`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  console.log('URL:', page.url());
  for (const sel of ['rum-upload-source-maps-service-input', 'rum-upload-source-maps-version-input', 'rum-upload-source-maps-environment-input', 'rum-upload-source-maps-file-input', 'rum-upload-source-maps-upload-btn']) {
    const n = await page.locator(`[data-test="${sel}"]`).count();
    console.log(sel, '->', n);
  }

  const svcInput = page.locator('[data-test="rum-upload-source-maps-service-input"]');
  console.log('service tag:', await svcInput.evaluate((el) => el.tagName).catch(() => 'ERR'), '| inner inputs:', await svcInput.locator('input').count());

  // fill (try both shapes)
  const fill = async (dt, val) => {
    const el = page.locator(`[data-test="${dt}"]`);
    if ((await el.evaluate((e) => e.tagName).catch(() => '')) === 'INPUT') await el.fill(val);
    else await el.locator('input').first().fill(val);
  };
  await fill('rum-upload-source-maps-service-input', 'probe-svc');
  await fill('rum-upload-source-maps-version-input', '0.0.1');
  await fill('rum-upload-source-maps-environment-input', 'e2e');
  await page.locator('[data-test="rum-upload-source-maps-file-input"]').setInputFiles(path.resolve('fixtures/sourcemaps/invalid.zip'));

  const btn = page.locator('[data-test="rum-upload-source-maps-upload-btn"]');
  console.log('upload btn disabled?', await btn.isDisabled().catch(() => 'ERR'));
  await btn.click();

  await page.waitForTimeout(5000);
  const toasts = await page.locator('[data-test^="o-toast"]').allTextContents().catch(() => []);
  console.log('toasts:', JSON.stringify(toasts));
  const notif = await page.locator('.q-notification').allTextContents().catch(() => []);
  console.log('q-notifications:', JSON.stringify(notif));
  await page.screenshot({ path: '/tmp/smap-probe.png', fullPage: true });
  console.log('screenshot: /tmp/smap-probe.png');

  await browser.close();
}

main().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
