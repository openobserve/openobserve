import { test, expect } from "../baseFixtures.js";
// pageManager.commonActions is used for streaming flip; no direct import needed
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import PageManager from '../../pages/page-manager.js';
// (unused CommonActions import removed)
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
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
    await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
      force: true,
    });
    // get the data from the search variable
    await expect.poll(async () => (await search).status()).toBe(200);
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
    pageManager = new PageManager(page);
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500);
    await ingestion(page);
    // Strategic 500ms wait for medium operation completion - this is functionally necessary
  await page.waitForTimeout(500);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await pageManager.logsPage.selectStream("e2e_automate"); 
    await applyQueryButton(page);
  });

  test.afterEach(async ({ page }) => {
    await pageManager.commonActions.flipStreaming();
  });

  test("stream to toggle store original data toggle and display o2 id", async ({ page }) => {
    // Navigate to Streams Menu
    await pageManager.unflattenedPage.streamsMenu.waitFor(); // Wait for the streams menu to be visible
    await pageManager.unflattenedPage.streamsMenu.click();
  
    // Search for Stream and access details
    await pageManager.unflattenedPage.searchStreamInput.waitFor(); // Wait for the search input to be ready
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500);
  
    await pageManager.unflattenedPage.streamDetailButton.waitFor(); // Ensure the stream detail button is visible
    await pageManager.unflattenedPage.streamDetailButton.click();
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500);

    //before toggling we need to make sure that we shift to configuration tab 
    await page.getByRole('tab', { name: 'Configuration' }).waitFor({ state: "visible", timeout: 2000 });
    await page.getByRole('tab', { name: 'Configuration' }).click();
    // Toggle 'Store Original Data' and update schema
    await pageManager.unflattenedPage.storeOriginalDataToggle.waitFor(); // Wait for the toggle to be visible
    await pageManager.unflattenedPage.storeOriginalDataToggle.click();
  
    await pageManager.unflattenedPage.schemaUpdateButton.waitFor(); // Wait for the schema update button to be clickable
    await pageManager.unflattenedPage.schemaUpdateButton.click();
  
    // Strategic 1000ms wait for schema update processing - this is functionally necessary
  await page.waitForTimeout(1000); // Ensure the schema update is processed
    await ingestion(page); // Custom ingestion function
    // Strategic 1000ms wait for data ingestion completion - this is functionally necessary
  await page.waitForTimeout(1000); // Allow time for ingestion
  
    // Close the dialog and explore the stream
    await pageManager.unflattenedPage.closeButton.waitFor(); // Wait for the close button to be visible
    await pageManager.unflattenedPage.closeButton.click();
  
    await pageManager.unflattenedPage.exploreButton.waitFor(); // Wait for the explore button to be clickable
    await pageManager.unflattenedPage.exploreButton.click();
  
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500); // Small delay to ensure page readiness
  
    // Select date and time
    await pageManager.unflattenedPage.dateTimeButton.waitFor(); // Wait for the date-time button
    await pageManager.unflattenedPage.dateTimeButton.click();
  
    await pageManager.unflattenedPage.relativeTab.waitFor(); // Wait for the relative tab to be visible
    await pageManager.unflattenedPage.relativeTab.click();
  
    // Strategic 500ms wait for medium operation completion - this is functionally necessary
  await page.waitForTimeout(500); // Wait for the relative tab to load
  
    // Expand log table row and verify details
    await pageManager.unflattenedPage.logTableRowExpandMenu.waitFor(); // Wait for the expand menu to appear
    await pageManager.unflattenedPage.logTableRowExpandMenu.click();
  
    await pageManager.unflattenedPage.logSourceColumn.waitFor(); // Ensure the source column is ready
    await pageManager.unflattenedPage.logSourceColumn.click();
  
    // Strategic 1500ms wait for complex UI update and o2 ID element rendering - this is functionally necessary
  await page.waitForTimeout(1500); // Extended wait to ensure o2 ID element is rendered
  
    await pageManager.unflattenedPage.o2IdText.waitFor({ timeout: 30000 }); // Extended timeout for o2 ID text visibility
    await pageManager.unflattenedPage.o2IdText.click();
  
    await pageManager.unflattenedPage.unflattenedTab.waitFor(); // Wait for the unflattened tab to be visible
    await pageManager.unflattenedPage.unflattenedTab.click();
  
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500); // Small delay before closing
  
    // Close the dialog
    await pageManager.unflattenedPage.closeDialog.waitFor(); // Wait for the close button in the dialog
    await pageManager.unflattenedPage.closeDialog.click();
  });


  test("stream to display o2 id when quick mode is on and select * query is added", async ({ page }) => {
    // Navigate to Streams Menu
    await pageManager.unflattenedPage.streamsMenu.waitFor();
    await pageManager.unflattenedPage.streamsMenu.click();

    // Search for Stream and access details
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500);
    
    await pageManager.unflattenedPage.streamDetailButton.waitFor();
    await pageManager.unflattenedPage.streamDetailButton.click();
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500);
    //before toggling we need to make sure that we shift to configuration tab 
    await page.getByRole('tab', { name: 'Configuration' }).waitFor({ state: "visible", timeout: 2000 });
    await page.getByRole('tab', { name: 'Configuration' }).click();
    // Toggle 'Store Original Data' and update schema
    await pageManager.unflattenedPage.storeOriginalDataToggle.waitFor();
    await pageManager.unflattenedPage.storeOriginalDataToggle.click();
    
    await pageManager.unflattenedPage.schemaUpdateButton.waitFor();
    await pageManager.unflattenedPage.schemaUpdateButton.click();
    
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500); // Timeout to ensure process completes
    await ingestion(page);
    // Strategic 500ms wait for medium operation completion - this is functionally necessary
  await page.waitForTimeout(500);

    // Close the dialog and explore the stream
    await pageManager.unflattenedPage.closeButton.waitFor();
    await pageManager.unflattenedPage.closeButton.click();
    
    await pageManager.unflattenedPage.exploreButton.waitFor();
    await pageManager.unflattenedPage.exploreButton.click();
    // Strategic 500ms wait for medium operation completion - this is functionally necessary
  await page.waitForTimeout(500);

    // Toggle Quick Mode if it's off
    await toggleQuickModeIfOff(page);
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500);

    // Select date and time
    await pageManager.unflattenedPage.dateTimeButton.waitFor();
    await pageManager.unflattenedPage.dateTimeButton.click();
    
    await pageManager.unflattenedPage.relativeTab.waitFor();
    await pageManager.unflattenedPage.relativeTab.click();
    // Strategic 500ms wait for medium operation completion - this is functionally necessary
  await page.waitForTimeout(500);

    await pageManager.unflattenedPage.allFieldsButton.waitFor();
    await pageManager.unflattenedPage.allFieldsButton.click();

    // Search for 'kubernetes_pod_id' field
    await pageManager.unflattenedPage.indexFieldSearchInput.waitFor();
    await pageManager.unflattenedPage.indexFieldSearchInput.fill("kubernetes_pod_id");
    
    // Strategic 500ms wait for medium operation completion - this is functionally necessary
  await page.waitForTimeout(500);
    await page
      .locator('[data-test="log-search-index-list-interesting-kubernetes_pod_id-field-btn"]')
      .first()
      .waitFor(); // Wait for the specific button to be visible
    await page
      .locator('[data-test="log-search-index-list-interesting-kubernetes_pod_id-field-btn"]')
      .first()
      .click();

    // Switch to SQL mode and validate query editor content
    await pageManager.unflattenedPage.sqlModeToggle.waitFor();
    await pageManager.unflattenedPage.sqlModeToggle.click();
    
    // Strategic 500ms wait for medium operation completion - this is functionally necessary
  await page.waitForTimeout(500);
    await expect(
      pageManager.unflattenedPage.logsSearchBarQueryEditor
        .getByText(/kubernetes_pod_id/)
        .first()
    ).toBeVisible();

    // Update the query editor with 'SELECT * FROM "e2e_automate"'
    await pageManager.unflattenedPage.logsSearchBarQueryEditor.waitFor();
    await page.getByRole('switch', { name: 'SQL Mode' }).locator('div').first().click();
    await pageManager.unflattenedPage.logsSearchBarQueryEditor.click();
    await page.keyboard.type('SELECT * FROM "e2e_automate"');
    // Strategic 500ms wait for medium operation completion - this is functionally necessary
  await page.waitForTimeout(500);

    // Interact with log table rows and verify details
    await pageManager.unflattenedPage.logTableRowExpandMenu.waitFor();
    await pageManager.unflattenedPage.logTableRowExpandMenu.click();
    
    await pageManager.unflattenedPage.logSourceColumn.waitFor();
    await pageManager.unflattenedPage.logSourceColumn.click();
    
    // Strategic 1500ms wait for complex UI update and o2 ID element rendering - this is functionally necessary
  await page.waitForTimeout(1500); // Extended wait to ensure o2 ID element is rendered
    await pageManager.unflattenedPage.o2IdText.waitFor({ timeout: 30000 }); // Extended timeout for o2 ID text visibility
    await pageManager.unflattenedPage.o2IdText.click();
    
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500);
    await pageManager.unflattenedPage.unflattenedTab.waitFor();
    await pageManager.unflattenedPage.unflattenedTab.click();
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500);

    // Close the dialog
    await pageManager.unflattenedPage.closeDialog.waitFor();
    await pageManager.unflattenedPage.closeDialog.click();

    // Repeat the process: Navigate back to Streams Menu, search, toggle, etc.
    await pageManager.unflattenedPage.streamsMenu.waitFor();
    await pageManager.unflattenedPage.streamsMenu.click();
    
    await pageManager.unflattenedPage.searchStreamInput.waitFor();
    await pageManager.unflattenedPage.searchStreamInput.click();
    await pageManager.unflattenedPage.searchStreamInput.fill("e2e_automate");
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500);
    
    await pageManager.unflattenedPage.streamDetailButton.waitFor();
    await pageManager.unflattenedPage.streamDetailButton.click();
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500);
    //before toggling we need to make sure that we shift to configuration tab 
    await page.getByRole('tab', { name: 'Configuration' }).waitFor({ state: "visible", timeout: 2000 });
    await page.getByRole('tab', { name: 'Configuration' }).click();
    await pageManager.unflattenedPage.storeOriginalDataToggle.waitFor();
    await pageManager.unflattenedPage.storeOriginalDataToggle.click();
    
    await pageManager.unflattenedPage.schemaUpdateButton.waitFor();
    await pageManager.unflattenedPage.schemaUpdateButton.click();
    
    await pageManager.unflattenedPage.closeButton.waitFor();
    await pageManager.unflattenedPage.closeButton.click();
    
    // Strategic 500ms wait for operation completion - this is functionally necessary
  await page.waitForTimeout(500);
    await ingestion(page);
    
    // Strategic 500ms wait for medium operation completion - this is functionally necessary
  await page.waitForTimeout(500);
    await pageManager.unflattenedPage.exploreButton.waitFor();
    await pageManager.unflattenedPage.exploreButton.click();
    
    // Strategic 1000ms wait for complex operation completion - this is functionally necessary
  await page.waitForTimeout(1000);
    await pageManager.unflattenedPage.dateTimeButton.waitFor();
    await pageManager.unflattenedPage.dateTimeButton.click();
    
    await pageManager.unflattenedPage.relativeTab.waitFor();
    await pageManager.unflattenedPage.relativeTab.click();
    // Strategic 500ms wait for medium operation completion - this is functionally necessary
  await page.waitForTimeout(500);

    // Final log row interaction
    await pageManager.unflattenedPage.logTableRowExpandMenu.waitFor();
    await pageManager.unflattenedPage.logTableRowExpandMenu.click();
    
    // Strategic 500ms wait for medium operation completion - this is functionally necessary
  await page.waitForTimeout(500);
    await page.getByText("arrow_drop_down_timestamp:").waitFor();
    await page.getByText("arrow_drop_down_timestamp:").click();
});


})
