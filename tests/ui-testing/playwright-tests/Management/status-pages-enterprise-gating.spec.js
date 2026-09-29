/**
 * Status Pages — Notices / Custom Domains Enterprise Gating
 *
 * StatusPagesList.vue locks three per-row dropdown items (Post update, View
 * updates, Custom domains) behind `advancedEnabled`, a computed keyed off
 * `store.state.zoConfig.build_type === "enterprise"`. On an OSS build the
 * items render disabled with a lock icon; on Enterprise they render fully
 * clickable with no lock. The fourth dropdown item (Copy URL) and Delete are
 * never gated and are not asserted here.
 *
 * Exactly one of the two tests runs per environment: the active build is
 * detected directly from the live `/api/{org}/config` response's
 * `build_type` field (see StatusPagesPage.detectBuildType) rather than a
 * rendered UI signal — `build_type` IS the value the gate itself reads, so
 * there is no frontend/backend mismatch to tolerate the way
 * EditionFeaturesPage.detectEdition has to for the enterprise-upsell dialog.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { GATED_ITEMS } = require('../../pages/generalPages/statusPagesPage.js');

test.describe.configure({ mode: 'serial' });

/** Creates a status page via the admin API so the table always has a row to open. */
async function seedStatusPage(page, orgId) {
  // Backend is a separate origin from the Vite-served frontend (ZO_BASE_URL) —
  // same reasoning as StatusPagesPage.detectBuildType.
  const baseUrl = (process.env['INGESTION_URL'] || process.env['ZO_BASE_URL']).replace(/\/+$/, '');
  const auth = Buffer.from(
    `${process.env['ZO_ROOT_USER_EMAIL']}:${process.env['ZO_ROOT_USER_PASSWORD']}`,
  ).toString('base64');
  const response = await page.request.post(`${baseUrl}/api/${orgId}/status_pages`, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    data: {
      name: `Enterprise Gating Test Page ${Date.now()}`,
      description: 'seeded by status-pages-enterprise-gating.spec.js',
    },
  });
  expect(response.status(), 'seeding a status page via the admin API should succeed').toBe(200);
  const body = await response.json();
  return body.id;
}

test.describe('Status Pages — Enterprise Gating', () => {
  let pm;
  let orgId;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    orgId = process.env['ORGNAME'] || 'default';
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test('OSS - status page advanced features are locked', {
    tag: ['@statusPages', '@all', '@oss'],
  }, async ({ page }) => {
    const buildType = await pm.statusPagesPage.detectBuildType(orgId);
    test.skip(buildType !== 'opensource', `Runs only on OSS build (detected: ${buildType})`);

    testLogger.step('Seeding a status page to open its row menu against');
    const rowId = await seedStatusPage(page, orgId);

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
