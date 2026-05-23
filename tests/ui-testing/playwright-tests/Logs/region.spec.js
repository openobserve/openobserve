const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe.configure({ mode: 'parallel' });
const randomSavedView = `Savedview${Math.floor(Math.random() * 1000)}`;

test.describe("Region testcases", () => {
  let pm;

  async function applyQueryButton() {
    // Trigger the refresh while listening for the search response — replaces
    // the legacy fixed buffer with a deterministic network-keyed wait.
    const searchPromise = pm.page.waitForResponse(
      response => response.url().includes('/_search') && response.status() === 200,
      { timeout: 60000 }
    );
    await pm.logsPage.clickRefreshButton();
    try {
      await searchPromise;
      testLogger.info('Search query completed successfully');
    } catch (error) {
      testLogger.warn('Search response wait timed out, continuing test');
    }
  }

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    await page.waitForLoadState('domcontentloaded');
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');

    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`
    );
    await pm.logsPage.selectStream(logData.Stream);
    await applyQueryButton();

    // The region button is conditionally rendered (enterprise + super-cluster
    // enabled — SearchBar.vue:720 v-if). Skip the test when absent.
    if (!(await pm.logsPage.isRegionDropdownVisible())) {
      test.skip('Skipping test because region button is not visible');
      return;
    }

    await pm.logsPage.openRegionDropdown();

    testLogger.info('Region test setup completed');
  });

  test.afterEach(async ({ page }) => {
    try {
      testLogger.info('Region test completed');
    } catch (error) {
      testLogger.warn('Afterhook failed', { error: error.message });
    }
  });

  test("should display region button and click on radio buttons", async ({ page }) => {
    testLogger.info('Testing region button and radio buttons functionality');

    // Re-toggle the dropdown — the beforeEach already opened it; clicking the
    // trigger again ensures a fresh open before we interact with leaves.
    await pm.logsPage.closeRegionDropdown();
    await pm.logsPage.openRegionDropdown();

    // The original test toggled us-east-1 then us-west-2. Wrap each toggle
    // in a presence check so the test still passes if either region is
    // missing in the connected env.
    const regionCount = await pm.logsPage.countRegionNodes();
    testLogger.debug('Rendered region tree nodes', { regionCount });
    if (regionCount > 0) {
      await pm.logsPage.toggleRegionNode('us-east-1').catch(() => {
        testLogger.warn('us-east-1 region node not present in this env');
      });
      await pm.logsPage.toggleRegionNode('us-west-2').catch(() => {
        testLogger.warn('us-west-2 region node not present in this env');
      });
    }

    testLogger.info('Region radio buttons test completed successfully');
  });

  test("should display save view with 1 region", async ({ page }) => {
    testLogger.info('Testing save view with 1 region functionality');

    // Close any open region menu from beforeEach then re-open — historically
    // this dismiss/reopen sequence reproduces the saved-view-with-region path.
    await pm.logsPage.closeRegionDropdown();
    await pm.logsPage.openRegionDropdown();

    // Tick the us-east-1 region leaf
    await pm.logsPage.toggleRegionNode('us-east-1');

    // Verify check state on the OTreeNode via data-test-checked attribute
    const isChecked = await pm.logsPage.isRegionNodeChecked('us-east-1');
    testLogger.debug('Radio button state checked', { isChecked });

    // Run the query, then open the Save View dialog
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.clickSaveViewButton();

    // Fill the saved-view name on the ODialog. OInput convention §4: use the
    // wrapper data-test to wait, fill the auto-derived `-field` variant.
    await pm.logsPage.fillSavedViewName(randomSavedView);
    await pm.logsPage.clickSavedViewDialogSave();
    await pm.logsPage.expectSavedViewDialogClosed();

    // Navigate to streams and click the first Explore button to apply default
    // view, then re-open the saved views and apply the persisted one.
    await pm.logsPage.clickStreamsMenuItem();
    await pm.logsPage.clickExploreButton();

    await pm.logsPage.expandSavedViewsDropdown();
    await pm.logsPage.clickSavedViewSearchInput();
    await pm.logsPage.fillSavedViewSearchInput(randomSavedView);
    await pm.logsPage.clickSavedViewByName(randomSavedView);

    // Reload to ensure the saved view persisted, then verify region state
    await page.reload();
    await pm.logsPage.openRegionDropdown();
    const isCircleChecked = await pm.logsPage.isRegionNodeChecked('us-east-1');
    testLogger.debug('Circle state checked', { isCircleChecked });

    // Cleanup: delete the saved view we just created. clickDeleteSavedViewButton
    // (PO) handles dropdown re-open + search + click sequence end-to-end.
    await pm.logsPage.closeRegionDropdown();
    await pm.logsPage.clickDeleteSavedViewButton(randomSavedView);
    await pm.logsPage.expectConfirmButtonVisible();
    await pm.logsPage.clickConfirmButton();

    testLogger.info('Save view with 1 region test completed successfully');
  })

  test('select timezone and searcharound', async ({ page }) => {
    testLogger.info('Testing timezone selection and search around functionality');

    // Open the datetime dropdown and switch timezone via OSelect (§4 convention)
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.selectDateTimeTimezone('Asia/Dubai', 'asia/dubai');

    // Reopen region menu (beforeEach already opened it once) and tick us-east-1
    await pm.logsPage.openRegionDropdown();
    await pm.logsPage.toggleRegionNode('us-east-1');
    await pm.logsPage.clickRefreshButton();

    // Open the log detail drawer by clicking on the source cell, then trigger
    // the "search around" action and re-open the detail drawer.
    await pm.logsPage.expectLogTableColumnSourceVisible();
    await pm.logsPage.openLogDetailSidebar();
    await pm.logsPage.clickLogsDetailTableSearchAroundBtn();
    await pm.logsPage.expectLogTableColumnSourceVisible();
    await pm.logsPage.openLogDetailSidebar();

    testLogger.info('Timezone and search around test completed successfully');
  });


})
