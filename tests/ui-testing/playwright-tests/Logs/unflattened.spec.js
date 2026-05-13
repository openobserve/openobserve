const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier, isCloudEnvironment } = require('../utils/cloud-auth.js');

test.describe.configure({ mode: "serial", timeout: 5 * 60 * 1000 });

const { ingestTestData: ingestion } = require('../utils/data-ingestion.js');

test.describe("Unflattened testcases", () => {
  let pageManager;
  // let logData;
  function removeUTFCharacters(text) {
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }
  async function applyQueryButton(page) {
    // After stream selection, an auto-search may be in progress (button shows
    // "Cancel").  Clicking refresh while a search is running just cancels it
    // without starting a new one.  We click twice: first to cancel any
    // in-flight search, then again to start a fresh one.
    await page.waitForTimeout(3000);

    // First click — cancels any in-progress auto-search.
    await pageManager.logsPage.runQueryAndWaitForResults();

    // Second click — reliably starts a new search now that no search is running.
    await page.waitForTimeout(1000);
    await pageManager.logsPage.runQueryAndWaitForResults();

    // 2-minute timeout: cloud re-indexing after Store Original Data changes takes longer than the default 30s
    await pageManager.logsPage.waitForSearchResults(120000);
  }

  test.beforeEach(async ({ page }) => {
    pageManager = new PageManager(page);
    if (isCloudEnvironment()) {
      await navigateToBase(page);
    } else {
      await pageManager.loginPage.gotoLoginPage();
      await pageManager.loginPage.loginAsInternalUser();
      await pageManager.loginPage.login();
    }
    await page.waitForTimeout(2000);
    await page.waitForTimeout(500);
    await ingestion(page);
    // Wait for data to be indexed before navigating to logs
    await page.waitForTimeout(2000);

    // Check and disable Store Original Data if it's enabled.
    // Navigate directly to the streams URL with the correct org — clicking the
    // sidebar link would use the Pinia store's active org which may still be _meta.
    testLogger.info('Navigating to Streams page with correct org');
    await page.goto(`${process.env.ZO_BASE_URL}/web/streams?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.openStreamDetail('e2e_automate');
    await page.waitForTimeout(2000);

    testLogger.info('Switching to Configuration tab');
    await pageManager.unflattenedPage.configurationTab.waitFor({ state: "visible", timeout: 15000 });
    await pageManager.unflattenedPage.configurationTab.click();
    await page.waitForTimeout(1000);

    testLogger.info('Checking Store Original Data toggle state');
    await pageManager.unflattenedPage.storeOriginalDataToggle.waitFor({ state: "visible", timeout: 15000 });

    const wasDisabled = await pageManager.unflattenedPage.ensureStoreOriginalDataDisabled();
    if (wasDisabled) {
      testLogger.info('Store Original Data was enabled, disabled it successfully');
    } else {
      testLogger.info('Store Original Data is already disabled');
    }

    testLogger.info('Closing stream details dialog');
    await pageManager.unflattenedPage.closeButton.waitFor();
    await pageManager.unflattenedPage.closeButton.click();
    await page.waitForTimeout(500);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`
    );
    await pageManager.logsPage.selectStream("e2e_automate");
    await applyQueryButton(page);
  });

  test.afterEach(async ({ page }) => {
    // await pageManager.commonActions.flipStreaming();
  });

  test("stream to toggle store original data toggle and display o2 id", {
    tag: ['@unflattened', '@logs', '@all'],
    timeout: 5 * 60 * 1000,
  }, async ({ page }) => {
    testLogger.info('Starting test: toggle store original data and display o2 id');

    // Navigate directly — sidebar click uses Pinia store org which may still be _meta
    testLogger.info('Navigating to Streams page');
    await page.goto(`${process.env.ZO_BASE_URL}/web/streams?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.openStreamDetail('e2e_automate');
    await page.waitForTimeout(2000);

    testLogger.info('Switching to Configuration tab');
    await pageManager.unflattenedPage.configurationTab.waitFor({ state: "visible", timeout: 5000 });
    await pageManager.unflattenedPage.configurationTab.click();
    await page.waitForTimeout(1000);

    testLogger.info('Enabling Store Original Data toggle');
    const wasDisabled = await pageManager.unflattenedPage.ensureStoreOriginalDataEnabled();
    testLogger.info(wasDisabled ? 'Store Original Data enabled' : 'Store Original Data was already enabled');

    testLogger.info('Closing stream details dialog');
    await pageManager.unflattenedPage.closeButton.waitFor();
    await pageManager.unflattenedPage.closeButton.click();

    // Short wait for query engine to pick up schema change before ingesting
    await page.waitForTimeout(5000);

    testLogger.info('Re-ingesting data with updated schema (Store Original Data ON)');
    await ingestion(page);

    // Navigate directly with stream in URL — selectStream would deselect it because
    // the Pinia store already has e2e_automate selected from beforeEach
    testLogger.info('Navigating to logs with e2e_automate stream');
    await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${getOrgIdentifier()}&stream_type=logs&stream=e2e_automate`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    await applyQueryButton(page);
    testLogger.info('Search query applied, logs should now contain _o2_id field');

    testLogger.info('Expanding first log row');
    await pageManager.unflattenedPage.logTableRowExpandMenu.waitFor();
    await pageManager.unflattenedPage.logTableRowExpandMenu.click();

    testLogger.info('Opening log source details');
    await pageManager.unflattenedPage.logSourceColumn.waitFor();
    await pageManager.unflattenedPage.logSourceColumn.click();
    await page.waitForTimeout(1500);

    testLogger.info('Waiting for _o2_id field to appear in log details');
    // Retry with query refresh if _o2_id not found (data may not be indexed yet)
    let o2idFound = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await pageManager.unflattenedPage.o2IdText.waitFor({ timeout: 15000 });
        testLogger.info(`Successfully found _o2_id field (attempt ${attempt})`);
        await pageManager.unflattenedPage.o2IdText.click();
        o2idFound = true;
        break;
      } catch (error) {
        testLogger.warn(`_o2_id not found on attempt ${attempt}, refreshing search`);
        await applyQueryButton(page);
        // Re-expand log row
        await pageManager.unflattenedPage.logTableRowExpandMenu.waitFor();
        await pageManager.unflattenedPage.logTableRowExpandMenu.click();
        await pageManager.unflattenedPage.logSourceColumn.waitFor();
        await pageManager.unflattenedPage.logSourceColumn.click();
        await page.waitForTimeout(1500);
      }
    }
    if (!o2idFound) {
      throw new Error('Failed to find _o2_id field in log details after 3 attempts');
    }

    testLogger.info('Switching to unflattened tab');
    await pageManager.unflattenedPage.unflattenedTab.waitFor();
    await pageManager.unflattenedPage.unflattenedTab.click();
    await page.waitForTimeout(500);

    testLogger.info('Closing log detail dialog');
    await pageManager.unflattenedPage.closeDialog.waitFor();
    await pageManager.unflattenedPage.closeDialog.click();

    // Cleanup: Toggle Store Original Data back OFF
    testLogger.info('Cleanup: Toggling Store Original Data back OFF');
    await page.goto(`${process.env.ZO_BASE_URL}/web/streams?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    await pageManager.unflattenedPage.openStreamDetail('e2e_automate');
    await page.waitForTimeout(2000);

    await pageManager.unflattenedPage.configurationTab.waitFor({ state: "visible", timeout: 5000 });
    await pageManager.unflattenedPage.configurationTab.click();
    await page.waitForTimeout(1000);

    await pageManager.unflattenedPage.ensureStoreOriginalDataDisabled();
    testLogger.info('Store Original Data confirmed OFF — test completed successfully');
  });


  test("stream to display o2 id when quick mode is on and select * query is added", {
    tag: ['@unflattened', '@logs', '@all'],
    timeout: 5 * 60 * 1000,
  }, async ({ page }) => {
    testLogger.info('Starting test: display o2 id with quick mode and SELECT * query');

    testLogger.info('Navigating to Streams page');
    await page.goto(`${process.env.ZO_BASE_URL}/web/streams?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.openStreamDetail('e2e_automate');

    // Wait for stream details sidebar to fully open and load
    await page.waitForTimeout(2000);
    testLogger.info('Stream details sidebar opened');

    testLogger.info('Switching to Configuration tab');
    await pageManager.unflattenedPage.configurationTab.waitFor({ state: "visible", timeout: 5000 });
    await pageManager.unflattenedPage.configurationTab.click();
    testLogger.info('Configuration tab clicked, waiting for content to load');
    await page.waitForTimeout(1000);

    testLogger.info('Waiting for Store Original Data toggle to be visible');
    await pageManager.unflattenedPage.storeOriginalDataToggle.waitFor({ state: "visible", timeout: 5000 });

    // Ensure Store Original Data is enabled
    const wasEnabled = await pageManager.unflattenedPage.ensureStoreOriginalDataEnabled();
    if (wasEnabled) {
      testLogger.info('Store Original Data was disabled, enabled it successfully');
    } else {
      testLogger.info('Store Original Data is already enabled');
    }

    testLogger.info('Closing stream details dialog');
    await pageManager.unflattenedPage.closeButton.waitFor();
    await pageManager.unflattenedPage.closeButton.click();

    await page.waitForTimeout(5000);

    testLogger.info('Re-ingesting data with updated schema (Store Original Data ON)');
    await ingestion(page);

    // Navigate directly with stream in URL — selectStream would deselect it because
    // the Pinia store already has e2e_automate selected from beforeEach
    testLogger.info('Navigating to logs with e2e_automate stream');
    await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${getOrgIdentifier()}&stream_type=logs&stream=e2e_automate`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    testLogger.info('Ensuring Quick Mode is on');
    await pageManager.logsPage.ensureQuickModeState(true);
    await page.waitForTimeout(500);

    await applyQueryButton(page);
    testLogger.info('Search query applied, logs should now contain _o2_id field');

    testLogger.info('Opening all fields panel');
    await pageManager.unflattenedPage.allFieldsButton.waitFor();
    await pageManager.unflattenedPage.allFieldsButton.click();

    testLogger.info('Searching for field: kubernetes_pod_id');
    await pageManager.unflattenedPage.indexFieldSearchInput.waitFor();
    await pageManager.unflattenedPage.indexFieldSearchInput.fill("kubernetes_pod_id");
    await page.waitForTimeout(500);

    testLogger.info('Selecting kubernetes_pod_id field');
    await pageManager.unflattenedPage.clickInterestingFieldButton('kubernetes_pod_id');

    testLogger.info('Switching to SQL mode');
    await pageManager.unflattenedPage.sqlModeToggle.waitFor();
    await pageManager.unflattenedPage.sqlModeToggle.click();
    await page.waitForTimeout(500);

    testLogger.info('Verifying kubernetes_pod_id appears in query editor');
    await pageManager.unflattenedPage.expectQueryEditorContainsText(/kubernetes_pod_id/);

    testLogger.info('Replacing query with SELECT * FROM "e2e_automate"');
    await pageManager.logsPage.typeQuery('SELECT * FROM "e2e_automate"');

    testLogger.info('Executing SELECT * query to fetch fresh data with _o2_id');
    await applyQueryButton(page);

    testLogger.info('Expanding first log row from SELECT * results');
    await pageManager.unflattenedPage.logTableRowExpandMenu.waitFor();
    await pageManager.unflattenedPage.logTableRowExpandMenu.click();

    testLogger.info('Opening log source details');
    await pageManager.unflattenedPage.logSourceColumn.waitFor();
    await pageManager.unflattenedPage.logSourceColumn.click();
    await page.waitForTimeout(1500);

    testLogger.info('Waiting for _o2_id field to appear in log details');
    // Retry with query refresh if _o2_id not found (data may not be indexed yet)
    let o2idFound = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await pageManager.unflattenedPage.logDetailJsonContent.waitFor({ timeout: 5000 });
        await pageManager.unflattenedPage.o2IdText.waitFor({ timeout: 15000 });
        testLogger.info(`Successfully found _o2_id field (attempt ${attempt})`);
        await pageManager.unflattenedPage.o2IdText.click();
        o2idFound = true;
        break;
      } catch (error) {
        testLogger.warn(`_o2_id not found on attempt ${attempt}, refreshing search`);
        if (attempt === 3) {
          try {
            const allKeys = await pageManager.unflattenedPage.allLogDetailKeys.allTextContents();
            testLogger.error('Available fields in log detail', { fields: allKeys });
          } catch (e) {
            testLogger.error('Could not retrieve available fields');
          }
          break;
        }
        await applyQueryButton(page);
        await pageManager.unflattenedPage.logTableRowExpandMenu.waitFor();
        await pageManager.unflattenedPage.logTableRowExpandMenu.click();
        await pageManager.unflattenedPage.logSourceColumn.waitFor();
        await pageManager.unflattenedPage.logSourceColumn.click();
        await page.waitForTimeout(1500);
      }
    }
    if (!o2idFound) {
      throw new Error('Failed to find _o2_id field in log details after 3 attempts');
    }

    await page.waitForTimeout(500);
    testLogger.info('Switching to unflattened tab');
    await pageManager.unflattenedPage.unflattenedTab.waitFor();
    await pageManager.unflattenedPage.unflattenedTab.click();
    await page.waitForTimeout(500);

    testLogger.info('Closing log detail dialog');
    await pageManager.unflattenedPage.closeDialog.waitFor();
    await pageManager.unflattenedPage.closeDialog.click();

    testLogger.info('Toggling Store Original Data back OFF to clean up');
    await page.goto(`${process.env.ZO_BASE_URL}/web/streams?org_identifier=${getOrgIdentifier()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.openStreamDetail('e2e_automate');
    await page.waitForTimeout(2000);

    testLogger.info('Switching to Configuration tab');
    await pageManager.unflattenedPage.configurationTab.waitFor({ state: "visible", timeout: 5000 });
    await pageManager.unflattenedPage.configurationTab.click();
    await page.waitForTimeout(1000);

    await pageManager.unflattenedPage.ensureStoreOriginalDataDisabled();

    testLogger.info('Closing dialog');
    await pageManager.unflattenedPage.closeButton.waitFor();
    await pageManager.unflattenedPage.closeButton.click();

    await page.waitForTimeout(500);
    testLogger.info('Ingesting data with Store Original Data OFF');
    await ingestion(page);
    testLogger.info('Data ingestion completed, waiting 3s for indexing');
    await page.waitForTimeout(3000);

    testLogger.info('Navigating to logs explorer');
    await pageManager.unflattenedPage.exploreButton.waitFor();
    await pageManager.unflattenedPage.exploreButton.click();
    await page.waitForTimeout(1000);

    testLogger.info('Opening date/time picker');
    await pageManager.unflattenedPage.dateTimeButton.waitFor();
    await pageManager.unflattenedPage.dateTimeButton.click();

    testLogger.info('Selecting relative time range');
    await pageManager.unflattenedPage.relativeTab.waitFor();
    await pageManager.unflattenedPage.relativeTab.click();
    await page.waitForTimeout(1000);

    testLogger.info('Verifying timestamp field is visible (final verification)');
    await pageManager.unflattenedPage.logTableRowExpandMenu.waitFor();
    await pageManager.unflattenedPage.logTableRowExpandMenu.click();

    testLogger.info('Opening log source details');
    await pageManager.unflattenedPage.logSourceColumn.waitFor();
    await pageManager.unflattenedPage.logSourceColumn.click();
    await page.waitForTimeout(1500);

    testLogger.info('Waiting for log detail panel to load');
    await pageManager.unflattenedPage.logDetailJsonContent.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(1000);

    testLogger.info('Looking for timestamp dropdown in log details');
    await pageManager.unflattenedPage.timestampDropdown.waitFor({ state: "visible", timeout: 10000 });
    await pageManager.unflattenedPage.timestampDropdown.click();
    testLogger.info('Test completed successfully');
});


})
