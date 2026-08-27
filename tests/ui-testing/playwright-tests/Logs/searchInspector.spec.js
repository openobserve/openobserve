const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

test.describe("Search Inspector Permission Gating", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  test("should keep search_inspector_enabled in the full UI configuration", {
    tag: ['@search-inspector', '@all'],
  }, async ({ page }) => {
    testLogger.info('Capturing the full UI config on reload');
    const config = await pm.searchInspectorPage.captureConfigOnReload();

    // The gating UI reads this field (SearchBar.vue / SearchHistory.vue /
    // SearchResult.vue all gate on store.state.zoConfig.search_inspector_enabled),
    // so a refactor that drops it silently disables the inspector entry points.
    expect(config).toHaveProperty('search_inspector_enabled');
    expect(typeof config.search_inspector_enabled).toBe('boolean');
    testLogger.info(`search_inspector_enabled = ${config.search_inspector_enabled}`);
    testLogger.info('Test completed');
  });

  test("should refetch the full UI configuration when switching organization", {
    tag: ['@search-inspector', '@all'],
  }, async ({ page }) => {
    const orgName = `inspectororg${Date.now()}`;
    const identifier = await pm.createOrgPage.createOrg(orgName);
    testLogger.info(`Created org "${orgName}" (identifier: ${identifier})`);

    // Register the listener before the switch: MainLayout must re-fetch the
    // org-scoped full config for the newly selected organization.
    const configRequest = pm.searchInspectorPage.waitForConfigRequest(identifier);
    await pm.homePage.selectOrgByIdentifier(orgName, identifier);
    const request = await configRequest;

    expect(request.url()).toContain(`/api/${identifier}/config`);
    testLogger.info('Full config refetched for the newly selected org');
  });

  test.fixme(
    "should hide the Search Inspect entry point for a user without the search_inspector grant — not wired: enterprise-gated v-if in SearchBar.vue:796 (config.isEnterprise == 'true' && search_inspector_enabled); OSS CI runs without enterprise so the grant path is unreachable",
    { tag: ['@search-inspector', '@all'] },
    async ({ page }) => {
      testLogger.info('Opening the search bar more-options menu');
      await pm.searchInspectorPage.openMoreOptionsMenu();
      await pm.searchInspectorPage.expectSearchInspectEntryHidden();
      testLogger.info('Search Inspect entry point correctly absent');
    },
  );
});
