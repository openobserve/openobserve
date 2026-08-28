// Copyright 2026 OpenObserve Inc.

/**
 * Custom Hide Menus — Alert Library Tab  [Alerts]
 *
 * The `custom_hide_menus` org config (zoConfig.custom_hide_menus, served by
 * /api/{org}/config) hides any rail/section entry it names. This spec covers the
 * two surfaces the feature changed:
 *   • AlertSectionTabs.vue — the "Library" tab in the alert section strip
 *     disappears when the flag lists "alertLibrary" and stays otherwise.
 *   • ONavGroup.vue — the "Alert Library" child in the Reliability flyout is
 *     dropped when the flag names it (by route name); siblings are kept.
 *
 * The flag is an enterprise config value in production, but the FRONTEND logic
 * under test is OSS and complete — it reads `store.state.zoConfig.custom_hide_menus`.
 * A pure OSS build serves "" (nothing hidden), so the tests intercept the
 * /api/{org}/config response and inject a value — the same config-mocking
 * technique already used for web_url in RegressionSet/Logs/logs-bugs.spec.js.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';

/**
 * Intercept the authenticated full-config endpoint and override
 * `custom_hide_menus`. Must run BEFORE any navigation so the SPA's initial
 * /api/{org}/config fetch (MainLayout) already carries the mocked value.
 */
async function mockCustomHideMenus(page, hiddenMenus) {
  await page.route('**/api/*/config', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.custom_hide_menus = hiddenMenus;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(json),
    });
  });
}

test.describe('Custom Hide Menus (Alert Library Tab) testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
  });

  test("should keep the Library tab when custom_hide_menus lists other menus", { tag: ['@custom-hide-menus', '@all'] }, async ({ page }) => {
    testLogger.info('Mocking custom_hide_menus with a value that does not name alertLibrary');
    await mockCustomHideMenus(page, 'openapi,reports');
    await navigateToBase(page);
    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pm.alertsPage.expectAllAlertsTabVisible();
    await pm.alertsPage.expectLibraryTabVisible();
    testLogger.info('Test completed');
  });

  test("should hide the Library tab when custom_hide_menus lists alertLibrary", { tag: ['@custom-hide-menus', '@all'] }, async ({ page }) => {
    testLogger.info('Mocking custom_hide_menus with a value that names alertLibrary');
    await mockCustomHideMenus(page, 'openapi,reports,alertLibrary');
    await navigateToBase(page);
    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pm.alertsPage.expectAllAlertsTabVisible();
    await pm.alertsPage.expectLibraryTabHidden();
    testLogger.info('Test completed');
  });

  test("should hide the Alert Library flyout item when custom_hide_menus lists alertLibrary", { tag: ['@custom-hide-menus', '@all'] }, async ({ page }) => {
    testLogger.info('Mocking custom_hide_menus and asserting the Reliability flyout drops the named child');
    await mockCustomHideMenus(page, 'alertLibrary');
    await navigateToBase(page);
    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pm.alertsPage.openReliabilityFlyout();
    await pm.alertsPage.expectNavGroupAllAlertsItemVisible();
    await pm.alertsPage.expectNavGroupLibraryItemHidden();
    testLogger.info('Test completed');
  });
});
