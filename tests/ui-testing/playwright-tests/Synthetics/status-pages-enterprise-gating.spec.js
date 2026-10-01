// Status pages — the three advanced row-menu items lock on OSS and unlock on Enterprise; build_type from /config is the value the gate reads.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { GATED_ITEMS } = require('../../pages/generalPages/statusPagesPage.js');
const { uniqueName } = require('../utils/synthetics-helpers.js');

test.describe.configure({ mode: 'serial' });

// The backend is a separate origin from the Vite-served frontend, same as StatusPagesPage.detectBuildType.
function adminApi() {
  const baseUrl = (process.env['INGESTION_URL'] || process.env['ZO_BASE_URL']).replace(/\/+$/, '');
  const auth = Buffer.from(
    `${process.env['ZO_ROOT_USER_EMAIL']}:${process.env['ZO_ROOT_USER_PASSWORD']}`,
  ).toString('base64');
  return { baseUrl, headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } };
}

/** Creates a status page via the admin API so the table always has a row to open. */
async function seedStatusPage(page, orgId) {
  const { baseUrl, headers } = adminApi();
  const response = await page.request.post(`${baseUrl}/api/${orgId}/status_pages`, {
    headers,
    data: {
      // The synth_e2e_ prefix lets cleanup.spec.js sweep pages that a crashed run left behind.
      name: uniqueName('status_page', test.info()),
      description: 'seeded by status-pages-enterprise-gating.spec.js',
    },
  });
  expect(response.status(), 'seeding a status page via the admin API should succeed').toBe(200);
  const body = await response.json();
  return body.id;
}

async function deleteStatusPage(page, orgId, id) {
  const { baseUrl, headers } = adminApi();
  const response = await page.request.delete(`${baseUrl}/api/${orgId}/status_pages/${id}`, { headers });
  expect([200, 404], 'deleting the seeded status page should succeed').toContain(response.status());
}

test.describe('Status Pages — Enterprise Gating', () => {
  let pm;
  let orgId;
  let seededId;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    orgId = process.env['ORGNAME'] || 'default';
    seededId = null;
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  // One of the two tests always skips before seeding, so only delete when a page was created.
  test.afterEach(async ({ page }) => {
    if (seededId) await deleteStatusPage(page, orgId, seededId);
  });

  test('OSS - status page advanced features are locked', {
    tag: ['@statusPages', '@all', '@oss'],
  }, async ({ page }) => {
    const buildType = await pm.statusPagesPage.detectBuildType(orgId);
    test.skip(buildType !== 'opensource', `Runs only on OSS build (detected: ${buildType})`);

    testLogger.step('Seeding a status page to open its row menu against');
    const rowId = await seedStatusPage(page, orgId);
    seededId = rowId;

    testLogger.step('Navigating to Synthetics -> Status Pages');
    await pm.statusPagesPage.navigate(orgId);

    testLogger.step(`Opening the row menu for ${rowId}`);
    await pm.statusPagesPage.openRowMenu(rowId);

    testLogger.step('Verifying all three gated items are disabled with a lock icon');
    await pm.statusPagesPage.expectAllLocked(rowId);

    await page.screenshot({ path: 'test-results/status-pages-oss-locked.png', fullPage: true });
    testLogger.info('OSS status page gating validation completed', { rowId, gated: GATED_ITEMS });
  });

  test('ENT - status page advanced features are unlocked', {
    tag: ['@statusPages', '@all', '@enterprise'],
  }, async ({ page }) => {
    const buildType = await pm.statusPagesPage.detectBuildType(orgId);
    test.skip(buildType !== 'enterprise', `Runs only on Enterprise build (detected: ${buildType})`);

    testLogger.step('Seeding a status page to open its row menu against');
    const rowId = await seedStatusPage(page, orgId);
    seededId = rowId;

    testLogger.step('Navigating to Synthetics -> Status Pages');
    await pm.statusPagesPage.navigate(orgId);

    testLogger.step(`Opening the row menu for ${rowId}`);
    await pm.statusPagesPage.openRowMenu(rowId);

    testLogger.step('Verifying all three gated items are enabled with no lock icon');
    await pm.statusPagesPage.expectAllUnlocked(rowId);

    await page.screenshot({ path: 'test-results/status-pages-ent-unlocked.png', fullPage: true });
    testLogger.info('Enterprise status page gating validation completed', { rowId, gated: GATED_ITEMS });
  });
});
