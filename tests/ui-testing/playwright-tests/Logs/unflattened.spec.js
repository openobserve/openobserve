import { test, expect } from "../baseFixtures.js";
// pageManager.commonActions is used for streaming flip; no direct import needed
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import PageManager from '../../pages/page-manager.js';
// (unused CommonActions import removed)
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "serial" });
const streamName = `stream${Date.now()}`;

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  if (await page.getByText('Login as internal user').isVisible()) {
    await page.getByText('Login as internal user').click();
}
  // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500);
  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  //Enter Password
  await page.locator("label").filter({ hasText: "Password *" }).click();
  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
}
async function toggleQuickModeIfOff(page) {
  
  const toggleButton = await page.$(
    '[data-test="logs-search-bar-quick-mode-toggle-btn"] > .q-toggle__inner'
  );
  const isSwitchedOff = await toggleButton.evaluate((node) =>
    node.classList.contains("q-toggle__inner--falsy")
  );

  if (isSwitchedOff) {
    await toggleButton.click();
  }
}

async function ingestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");

  const headers = {
    Authorization: `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  const response = await page.evaluate(
    async ({ url, headers, orgId, streamName, logsdata }) => {
      const fetchResponse = await fetch(
        `${url}/api/${orgId}/${streamName}/_json`,
        {
          method: "POST",
          headers: headers,
          body: JSON.stringify(logsdata),
        }
      );
      return await fetchResponse.json();
    },
    {
      url: process.env.INGESTION_URL,
      headers: headers,
      orgId: orgId,
      streamName: streamName,
      logsdata: logsdata,
    }
  );
  testLogger.debug('API response received', { response });
}

test.describe("Unflattened testcases", () => {
  let pageManager;
  // let logData;
  function removeUTFCharacters(text) {
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }
  async function applyQueryButton(page) {
    // click on the run query button
    // Type the value of a variable into an input field
    const search = page.waitForResponse(logData.applyQuery);
    // Strategic 1000ms wait for complex operation completion - this is functionally necessary
  await page.waitForTimeout(1000);
    await pageManager.unflattenedPage.logsSearchBarRefreshButton.click({
      force: true,
    });
    // get the data from the search variable
    await expect.poll(async () => (await search).status()).toBe(200);
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(2000);
    pageManager = new PageManager(page);
    await page.waitForTimeout(500);
    await ingestion(page);
    // Wait for data to be indexed before navigating to logs
    await page.waitForTimeout(2000);

    // Check and disable Store Original Data if it's enabled
    testLogger.info('Navigating to Streams menu to check Store Original Data setting');
    await pageManager.unflattenedPage.streamsMenu.waitFor();
    await pageManager.unflattenedPage.streamsMenu.click();
    await page.waitForTimeout(500);

    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.streamDetailButton.waitFor();
    await pageManager.unflattenedPage.streamDetailButton.click();
    await page.waitForTimeout(2000);

    testLogger.info('Switching to Configuration tab');
    await pageManager.unflattenedPage.configurationTab.waitFor({ state: "visible", timeout: 5000 });
    await pageManager.unflattenedPage.configurationTab.click();
    await page.waitForTimeout(1000);

    testLogger.info('Checking Store Original Data toggle state');
    await pageManager.unflattenedPage.storeOriginalDataToggle.waitFor({ state: "visible", timeout: 5000 });

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
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const orgName = process.env.ORGNAME || 'default';
    const allsearch = page.waitForResponse(`**/api/${orgName}/_search**`);
    await pageManager.logsPage.selectStream("e2e_automate");
    await applyQueryButton(page);
  });

  test.afterEach(async ({ page }) => {
    // await pageManager.commonActions.flipStreaming();
  });

  test("stream to toggle store original data toggle and display o2 id", async ({ page }) => {
    testLogger.info('Starting test: toggle store original data and display o2 id');

    // Navigate to Streams Menu
    testLogger.info('Navigating to Streams menu');
    await pageManager.unflattenedPage.streamsMenu.waitFor();
    await pageManager.unflattenedPage.streamsMenu.click();

    // Search for Stream and access details
    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.streamDetailButton.waitFor();
    await pageManager.unflattenedPage.streamDetailButton.click();

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
    testLogger.info('Clicking Store Original Data toggle to enable');
    await pageManager.unflattenedPage.storeOriginalDataToggle.click();
    testLogger.info('Toggle clicked');
    await page.waitForTimeout(500);

    testLogger.info('Waiting for Update Settings button to be visible');
    await pageManager.unflattenedPage.schemaUpdateButton.waitFor({ state: "visible", timeout: 5000 });
    testLogger.info('Clicking Update Settings button');
    await pageManager.unflattenedPage.schemaUpdateButton.click();
    testLogger.info('Update Settings button clicked');

    testLogger.info('Waiting for Stream settings updated snackbar');
    await expect(pageManager.unflattenedPage.streamSettingsUpdatedSnackbar).toBeVisible({ timeout: 10000 });
    testLogger.info('Stream settings successfully updated - snackbar confirmed');
    await page.waitForTimeout(1000);

    testLogger.info('Closing stream details dialog');
    await pageManager.unflattenedPage.closeButton.waitFor();
    await pageManager.unflattenedPage.closeButton.click();
    testLogger.info('Stream details dialog closed');
    await page.waitForTimeout(500);

    testLogger.info('Re-ingesting data with updated schema (Store Original Data ON)');
    await ingestion(page);
    testLogger.info('Data ingestion completed, waiting 5s for indexing with _o2_id field');
    await page.waitForTimeout(5000);

    testLogger.info('Navigating to logs page to verify _o2_id field');
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForTimeout(1000);

    testLogger.info('Selecting e2e_automate stream in logs');
    await pageManager.logsPage.selectStream("e2e_automate");
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
    try {
      await pageManager.unflattenedPage.o2IdText.waitFor({ timeout: 30000 });
      testLogger.info('Successfully found _o2_id field');
      await pageManager.unflattenedPage.o2IdText.click();
    } catch (error) {
      testLogger.error('Failed to find _o2_id field in log details', { error: error.message });
      throw error;
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
    testLogger.info('Navigating to Streams menu');
    await pageManager.unflattenedPage.streamsMenu.waitFor();
    await pageManager.unflattenedPage.streamsMenu.click();

    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.streamDetailButton.waitFor();
    await pageManager.unflattenedPage.streamDetailButton.click();

    await page.waitForTimeout(2000);
    testLogger.info('Stream details sidebar opened');

    testLogger.info('Switching to Configuration tab');
    await pageManager.unflattenedPage.configurationTab.waitFor({ state: "visible", timeout: 5000 });
    await pageManager.unflattenedPage.configurationTab.click();
    testLogger.info('Configuration tab clicked, waiting for content to load');
    await page.waitForTimeout(1000);

    testLogger.info('Waiting for Store Original Data toggle to be visible');
    await pageManager.unflattenedPage.storeOriginalDataToggle.waitFor({ state: "visible", timeout: 5000 });
    testLogger.info('Clicking Store Original Data toggle to turn OFF');
    await pageManager.unflattenedPage.storeOriginalDataToggle.click();
    testLogger.info('Toggle clicked (turned OFF)');
    await page.waitForTimeout(500);

    testLogger.info('Waiting for Update Settings button to be visible');
    await pageManager.unflattenedPage.schemaUpdateButton.waitFor({ state: "visible", timeout: 5000 });
    testLogger.info('Clicking Update Settings button');
    await pageManager.unflattenedPage.schemaUpdateButton.click();
    testLogger.info('Update Settings button clicked');

    testLogger.info('Waiting for Stream settings updated snackbar');
    await expect(pageManager.unflattenedPage.streamSettingsUpdatedSnackbar).toBeVisible({ timeout: 10000 });
    testLogger.info('Stream settings successfully updated - Store Original Data now OFF');

    testLogger.info('Test completed successfully with cleanup');
  });


  test("stream to display o2 id when quick mode is on and select * query is added", async ({ page }) => {
    testLogger.info('Starting test: display o2 id with quick mode and SELECT * query');

    testLogger.info('Navigating to Streams menu');
    await pageManager.unflattenedPage.streamsMenu.waitFor();
    await pageManager.unflattenedPage.streamsMenu.click();

    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.streamDetailButton.waitFor();
    await pageManager.unflattenedPage.streamDetailButton.click();

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
    testLogger.info('Stream details dialog closed');
    await page.waitForTimeout(500);

    testLogger.info('Re-ingesting data with updated schema (Store Original Data ON)');
    await ingestion(page);
    testLogger.info('Data ingestion completed, waiting 5s for indexing with _o2_id field');
    await page.waitForTimeout(5000);

    testLogger.info('Navigating to logs page to verify _o2_id field');
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForTimeout(1000);

    testLogger.info('Selecting e2e_automate stream in logs');
    await pageManager.logsPage.selectStream("e2e_automate");

    testLogger.info('Toggling Quick Mode if needed');
    await toggleQuickModeIfOff(page);
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
    await page
      .locator('[data-test="log-search-index-list-interesting-kubernetes_pod_id-field-btn"]')
      .first()
      .waitFor();
    await page
      .locator('[data-test="log-search-index-list-interesting-kubernetes_pod_id-field-btn"]')
      .first()
      .click();

    testLogger.info('Switching to SQL mode');
    await pageManager.unflattenedPage.sqlModeToggle.waitFor();
    await pageManager.unflattenedPage.sqlModeToggle.click();
    await page.waitForTimeout(500);

    testLogger.info('Verifying kubernetes_pod_id appears in query editor');
    await expect(
      pageManager.unflattenedPage.logsSearchBarQueryEditor
        .getByText(/kubernetes_pod_id/)
        .first()
    ).toBeVisible();

    testLogger.info('Replacing query with SELECT * FROM "e2e_automate"');
    await pageManager.unflattenedPage.logsSearchBarQueryEditor.waitFor();
    await pageManager.unflattenedPage.logsSearchBarQueryEditor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('SELECT * FROM "e2e_automate"');

    testLogger.info('Executing SELECT * query to fetch fresh data with _o2_id');
    await page.waitForTimeout(500);
    await pageManager.unflattenedPage.logsSearchBarRefreshButton.click();
    testLogger.info('Query executed, waiting for results to load');
    await page.waitForTimeout(2000);

    testLogger.info('Expanding first log row from SELECT * results');
    await pageManager.unflattenedPage.logTableRowExpandMenu.waitFor();
    await pageManager.unflattenedPage.logTableRowExpandMenu.click();

    testLogger.info('Opening log source details');
    await pageManager.unflattenedPage.logSourceColumn.waitFor();
    await pageManager.unflattenedPage.logSourceColumn.click();
    await page.waitForTimeout(1500);

    testLogger.info('Waiting for _o2_id field to appear in log details');
    try {
      // Check if any fields are visible first
      await pageManager.unflattenedPage.logDetailJsonContent.waitFor({ timeout: 5000 });
      testLogger.info('Log detail JSON content is visible');

      await pageManager.unflattenedPage.o2IdText.waitFor({ timeout: 30000 });
      testLogger.info('Successfully found _o2_id field');
      await pageManager.unflattenedPage.o2IdText.click();
    } catch (error) {
      testLogger.error('Failed to find _o2_id field in log details', { error: error.message });

      // Log what fields are actually present
      try {
        const allKeys = await pageManager.unflattenedPage.allLogDetailKeys.allTextContents();
        testLogger.error('Available fields in log detail', { fields: allKeys });
      } catch (e) {
        testLogger.error('Could not retrieve available fields');
      }

      throw error;
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
    testLogger.info('Navigating back to Streams menu');
    await pageManager.unflattenedPage.streamsMenu.waitFor();
    await pageManager.unflattenedPage.streamsMenu.click();

    testLogger.info('Searching for stream: e2e_automate');
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    await page.waitForTimeout(500);

    testLogger.info('Opening stream detail dialog');
    await pageManager.unflattenedPage.streamDetailButton.waitFor();
    await pageManager.unflattenedPage.streamDetailButton.click();

    // Wait for stream details sidebar to fully open and load
    await page.waitForTimeout(2000);
    testLogger.info('Stream details sidebar opened');

    testLogger.info('Switching to Configuration tab');
    await page.getByRole('tab', { name: 'Configuration' }).waitFor({ state: "visible", timeout: 2000 });
    await page.getByRole('tab', { name: 'Configuration' }).click();

    testLogger.info('Toggling Store Original Data OFF');
    await pageManager.unflattenedPage.storeOriginalDataToggle.waitFor();
    await pageManager.unflattenedPage.storeOriginalDataToggle.click();

    testLogger.info('Updating schema');
    await pageManager.unflattenedPage.schemaUpdateButton.waitFor();
    await pageManager.unflattenedPage.schemaUpdateButton.click();

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
    await page.waitForTimeout(500);

    await pageManager.unflattenedPage.timestampDropdown.waitFor();
    await pageManager.unflattenedPage.timestampDropdown.click();
    testLogger.info('Test completed successfully');
});


})
