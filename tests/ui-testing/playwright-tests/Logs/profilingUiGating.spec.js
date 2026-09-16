const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// Mock the authenticated per-org config so `profiling_enabled` reads true. The
// v-if gate reads store.state.zoConfig?.profiling_enabled (truthy), hydrated from
// GET /api/{org}/config. setConfig REPLACES the whole zoConfig object, so pass
// through the real response and patch only the one field. The glob `**/api/*/config`
// matches exactly /api/<org>/config — never the bootstrap /config (no flags) and
// never deeper paths like /api/<org>/alerts/deduplication/config.
async function mockProfilingEnabled(page, value = true) {
  await page.route('**/api/*/config', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.profiling_enabled = value;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(json),
    });
  });
}

test.describe('Profiling UI feature-flag gating testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  // ---- Flag OFF (default OSS backend: env var unset — no mock, no data) ----

  test('should hide the Profiles tab in the Streams type filter when the flag is off', {
    tag: ['@profiling-ui-gating', '@logs', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Navigating to the Streams explorer');
    await pm.streamsPage.gotoStreamsPage();

    testLogger.info('Asserting the type filter renders siblings but no Profiles tab');
    await pm.streamsPage.expectStreamTypeFilterVisible();
    await pm.streamsPage.expectProfilesFilterTabHidden();
    await pm.streamsPage.expectSiblingFilterTabVisible('logs');
    await pm.streamsPage.expectSiblingFilterTabVisible('metrics');
    await pm.streamsPage.expectSiblingFilterTabVisible('traces');
    await pm.streamsPage.expectSiblingFilterTabVisible('metadata');
    testLogger.info('Test completed');
  });

  test('should hide the Profiles tab on the Ingestion Custom page when the flag is off', {
    tag: ['@profiling-ui-gating', '@logs', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Navigating to the Ingestion Custom page');
    await pm.ingestionConfigPage.navigateToCustom(getOrgIdentifier());

    testLogger.info('Asserting the Profiles tab is absent while Logs/Metrics/Traces render');
    await pm.ingestionConfigPage.expectCustomProfilesTabHidden();
    await pm.ingestionConfigPage.expectCustomLogsTabVisible();
    await pm.ingestionConfigPage.expectCustomMetricsTabVisible();
    await pm.ingestionConfigPage.expectCustomTracesTabVisible();
    testLogger.info('Test completed');
  });

  test('should hide the left-nav Profiles menu item when the flag is off', {
    tag: ['@profiling-ui-gating', '@logs', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Asserting the left-nav Profiles item is absent');
    await pm.homePage.expectProfilesMenuItemHidden();
    testLogger.info('Test completed');
  });

  // ---- Flag ON (per-test config mock; register then reload so config re-fetches) ----

  test('should show the Profiles tab in the Streams type filter and select it on click', {
    tag: ['@profiling-ui-gating', '@logs', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Mocking profiling_enabled=true and reloading so the config re-fetches');
    await mockProfilingEnabled(page, true);
    await page.reload();
    await pm.homePage.expectProfilesMenuItemVisible();

    testLogger.info('Navigating to the Streams explorer');
    await pm.streamsPage.gotoStreamsPage();

    testLogger.info('Asserting the Profiles tab renders and activates on click');
    await pm.streamsPage.expectProfilesFilterTabVisible();
    await pm.streamsPage.clickProfilesFilterTab();
    await pm.streamsPage.expectProfilesFilterTabSelected();
    testLogger.info('Test completed');
  });

  test('should show the Profiles tab on the Ingestion Custom page and route to the profiles module', {
    tag: ['@profiling-ui-gating', '@logs', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Mocking profiling_enabled=true and reloading so the config re-fetches');
    await mockProfilingEnabled(page, true);
    await page.reload();
    await pm.homePage.expectProfilesMenuItemVisible();

    testLogger.info('Navigating to the Ingestion Custom page');
    await pm.ingestionConfigPage.navigateToCustom(getOrgIdentifier());

    testLogger.info('Asserting the Profiles tab renders and navigates to the profiles route');
    await pm.ingestionConfigPage.expectCustomProfilesTabVisible();
    await pm.ingestionConfigPage.clickCustomProfilesTab();
    await expect(page).toHaveURL(/ingestion\/custom\/profiles/);
    await expect(page).toHaveURL(/org_identifier=/);
    testLogger.info('Test completed');
  });

  test('should show the left-nav Profiles menu item when the flag is on', {
    tag: ['@profiling-ui-gating', '@logs', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Mocking profiling_enabled=true and reloading so the config re-fetches');
    await mockProfilingEnabled(page, true);
    await page.reload();
    await pm.homePage.expectProfilesMenuItemVisible();
    testLogger.info('Test completed');
  });

  // ---- Home no-data chip (P2): gated on flag AND an empty org. The suite's
  // shared org ingests e2e_automate, so UsageTab.vue:539 (no_data_ingest) never
  // renders the empty state and no empty-org provisioning exists — these remain
  // honest fixme placeholders rather than a brittle summary mock.

  test.fixme('should show the Home no-data Profiles chip when the flag is on and the org has no data (needs empty org: UsageTab.vue:539)', {
    tag: ['@profiling-ui-gating', '@logs', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Mocking profiling_enabled=true and reloading so the config re-fetches');
    await mockProfilingEnabled(page, true);
    await page.reload();
    await pm.homePage.expectProfilesMenuItemVisible();

    testLogger.info('Navigating Home and asserting the empty-state Profiles chip routes to profiles');
    await pm.homePage.gotoHomePage();
    await pm.homePage.expectHomeUsageTabNoDataVisible();
    await pm.homePage.expectHomeNoDataProfilesBtnVisible();
    await pm.homePage.clickHomeNoDataProfilesBtn();
    await expect(page).toHaveURL(/profiles/);
    testLogger.info('Test completed');
  });

  test.fixme('should hide the Home no-data Profiles chip when the flag is off (needs empty org: UsageTab.vue:539)', {
    tag: ['@profiling-ui-gating', '@logs', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Navigating Home and asserting the empty state renders without the Profiles chip');
    await pm.homePage.gotoHomePage();
    await pm.homePage.expectHomeUsageTabNoDataVisible();
    await pm.homePage.expectHomeNoDataProfilesBtnHidden();
    await pm.homePage.expectHomeNoDataOtelBtnVisible();
    testLogger.info('Test completed');
  });
});
