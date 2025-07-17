import { test, expect } from '../baseFixtures.js';
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { toZonedTime } from "date-fns-tz";
import PageManager from '../../pages/page-manager.js';

test.describe.configure({ mode: "parallel" });
const folderName = `Folder ${Date.now()}`;
const dashboardName = `AutomatedDashboard${Date.now()}`;

// ===== HELPER FUNCTIONS =====
async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  if (await page.getByText('Login as internal user').isVisible()) {
    await page.getByText('Login as internal user').click();
  }
  console.log("ZO_BASE_URL", process.env["ZO_BASE_URL"]);
  await page.waitForTimeout(1000);

  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  //Enter Password
  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
  await page.waitForTimeout(4000);
  await page.goto(process.env["ZO_BASE_URL"]);
}

async function ingestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
    const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(logsdata)
    });
    return await fetchResponse.json();
  }, {
    url: process.env.INGESTION_URL,
    headers: headers,
    orgId: orgId,
    streamName: streamName,
    logsdata: logsdata
  });
  console.log(response);
}

// ===== UTILITY FUNCTIONS =====
function removeUTFCharacters(text) {
  return text.replace(/[^\x00-\x7F]/g, " ");
}

async function applyQueryButton(page) {
  // click on the run query button
  const search = page.waitForResponse(logData.applyQuery);
  await page.waitForTimeout(3000);
  await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
    force: true,
  });
  // get the data from the search variable
  await expect.poll(async () => (await search).status()).toBe(200);
}

test.describe("Sanity testcases", () => {
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }) => {
    // ===== INITIALIZATION =====
    await login(page);
    pm = new PageManager(page);
    await page.waitForTimeout(1000)
    await ingestion(page);
    await page.waitForTimeout(2000)

    // ===== NAVIGATE TO LOGS PAGE =====
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await pm.logsPage.selectStream("e2e_automate"); 
    await applyQueryButton(page);
  });

  // ===== QUICK MODE TESTS =====
  test("should display quick mode toggle button", async ({ page }) => {
    await expect(
      page.locator('[data-test="logs-search-bar-quick-mode-toggle-btn"]')
    ).toBeVisible();
  });

  test("should click on interesting fields icon and display query in editor", async ({ page }) => {
    // Get the toggle button element
    const toggleButton = await page.$(
      '[data-test="logs-search-bar-quick-mode-toggle-btn"] > .q-toggle__inner'
    );

    // Evaluate the class attribute to determine if the toggle is in the off state
    const isSwitchedOff = await toggleButton.evaluate((node) =>
      node.classList.contains("q-toggle__inner--falsy")
    );

    // If the toggle is switched off, click on it to switch it on
    if (isSwitchedOff) {
      await toggleButton.click();
    }
    await page
      .locator('[data-cy="index-field-search-input"]')
      .fill("job");
    await page.waitForTimeout(2000);
    await page
      .locator(
        '[data-test="log-search-index-list-interesting-job-field-btn"]'
      ).first().click();
    await page.getByRole('switch', { name: 'SQL Mode' }).locator('div').nth(2).click();
    await expect(
      page
        .locator('[data-test="logs-search-bar-query-editor"]')
        .getByText(/job/)
        .first()
    ).toBeVisible();
  });

  // ===== PAGINATION TESTS =====
  test("should display result text and pagination", async ({ page }) => {
    await page.getByText("Showing 1 to 50").click();
    await page
      .getByText("fast_rewind12345fast_forward50arrow_drop_down")
      .click();
  });

  // ===== HISTOGRAM TESTS =====
  test("should not display chart if histogram off and display again when toggle is on", async ({ page }) => {
    await page
      .locator('[data-test="logs-search-bar-show-histogram-toggle-btn"]')
      .click();
    await page.getByText("Showing 1").click();
    expect(
      await page
        .locator('[data-test="logs-search-result-bar-chart"]')
        .isVisible()
    ).toBe(false);
    await page
      .locator('[data-test="logs-search-bar-show-histogram-toggle-btn"] div')
      .nth(2)
      .click();
    await page.waitForTimeout(2000);
    await expect(page.getByRole('heading', { name: 'No data found for histogram.' })).toBeVisible();
  });

  // ===== SAVED SEARCH TESTS =====
  test("should save search, favorite, click on saved search and then delete", async ({ page }) => {
    const randomSavedViewName = `streamslog${Math.random().toString(36).substring(2, 10)}`;
    await page
      .locator("button")
      .filter({ hasText: "savesaved_search" })
      .click();
    await page.locator('[data-test="add-alert-name-input"]').click();
    await page.locator('[data-test="add-alert-name-input"]').fill(randomSavedViewName);
    await page.locator('[data-test="saved-view-dialog-save-btn"]').click();
    await page
      .locator('[data-test="logs-search-saved-views-btn"]')
      .getByLabel("Expand")
      .click();
    await page
      .locator('[data-test="log-search-saved-view-field-search-input"]')
      .click();
    await page
      .locator('[data-test="log-search-saved-view-field-search-input"]')
      .fill(randomSavedViewName);
    await page.getByText(randomSavedViewName).first().click();
    await page
      .locator('[data-test="logs-search-saved-views-btn"]')
      .getByLabel("Expand")
      .click();
    await page
      .locator('[data-test="log-search-saved-view-field-search-input"]')
      .click();
    await page
      .locator('[data-test="log-search-saved-view-field-search-input"]')
      .fill(randomSavedViewName);
    await page.getByText("favorite_border").first().click();
    await page.getByText("Favorite Views").click();
    await page.getByLabel('Clear').first().click();
    await page.getByLabel("Collapse").click();
    await page
      .locator('[data-test="logs-search-saved-views-btn"]')
      .getByLabel("Expand")
      .click();
    await page
      .locator(
        '[data-test="log-search-saved-view-favorite-list-fields-table"] div'
      )
      .filter({ hasText: "Favorite Views" })
      .nth(1)
      .click();
    await page
      .locator('[data-test="log-search-saved-view-field-search-input"]')
      .click();
    await page
      .locator('[data-test="log-search-saved-view-field-search-input"]')
      .fill(randomSavedViewName);
    const deleteButtonSelector = `[data-test="logs-search-bar-delete-${randomSavedViewName}-saved-view-btn"]`;
    await page.locator(deleteButtonSelector).click(); // Click delete
    await page.locator('[data-test="confirm-button"]').click();
  });

  // ===== QUERY LIMIT TESTS =====
  test("should only display 5 result if limit 5 added", async ({ page }) => {
    await page.getByRole('switch', { name: 'SQL Mode' }).locator('div').nth(2).click();
    
    await page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .locator(".cm-content")
      .locator(".cm-line")
      .filter({ hasText: 'SELECT * FROM "e2e_automate"' })
      .nth(0)
      .click();

    await page
      .locator('[data-test="logs-search-bar-query-editor"]')
      .locator(".cm-content")
      .fill('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC limit 5');

    await page.waitForTimeout(2000);
    await page
      .locator('[data-test="logs-search-bar-refresh-btn"]')
      .click({ force: true });
    await page.waitForTimeout(2000);
    await page.getByText("Showing 1 to 5 out of 5").click();
    await page
      .locator('[data-test="logs-search-bar-reset-filters-btn"]')
      .click();
    await page.waitForTimeout(2000);
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.waitForTimeout(2000);
    await page
      .getByText("fast_rewind12345fast_forward50arrow_drop_down")
      .click();
  });

  // ===== FUNCTION TESTS =====
  test("should create a function and then delete it", async ({ page }) => {
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page
      .locator('[data-test="logs-search-bar-function-dropdown"] button')
      .filter({ hasText: "save" })
      .click();
    await page
      .locator('#fnEditor').getByRole('textbox')
      .click();
    await page
      .locator("#fnEditor")
      .locator(".cm-content")
      .fill(".a=2");
    await page.waitForTimeout(1000);
    await page
      .locator('[data-test="logs-search-bar-function-dropdown"] button')
      .filter({ hasText: "save" })
      .click();
    await page.locator('[data-test="saved-function-name-input"]').click();
    await page
      .locator('[data-test="saved-function-name-input"]')
      .fill("e2eautomatefunctions");
    await page.locator('[data-test="saved-view-dialog-save-btn"]').click();
    await page.waitForTimeout(2000);
    await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
    await page.locator('[data-test="tab-realtime"]').click();

    await page.locator('[data-test="function-stream-tab"]').click();
    await page.getByPlaceholder("Search Function").click();
    await page.getByPlaceholder("Search Function").fill("e2eautomatefunctions");
    await page.getByRole("button", { name: "Delete Function" }).click();
    await page.locator('[data-test="confirm-button"]').click();
  });

  test("should create functions via functions page and delete it", async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
    await page.locator('[data-test="tab-realtime"]').click();
    await page.locator('[data-test="function-stream-tab"]').click();
    await page.getByRole("button", { name: "Create new function" }).click();
    await page.getByLabel("Name").click();
    await page.getByLabel("Name").fill("sanitytest");
    await page.locator('[data-test="logs-vrl-function-editor"]').click();
    await page.locator('[data-test="logs-vrl-function-editor"]').locator(".cm-content").fill("sanity=1");
    await page.locator('[data-test="logs-vrl-function-editor"]').getByText("sanity=").click();
    await page.locator('[data-test="logs-vrl-function-editor"]').locator(".cm-content").press("ArrowLeft");
    await page.locator('[data-test="logs-vrl-function-editor"]').locator(".cm-content").press("ArrowLeft");
    await page.locator('[data-test="logs-vrl-function-editor"]').locator(".cm-content").press("ArrowLeft");
    await page.locator('[data-test="logs-vrl-function-editor"]').locator(".cm-content").press("ArrowLeft");
    await page.locator('[data-test="logs-vrl-function-editor"]').locator(".cm-content").fill(".sanity=1");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByPlaceholder("Search Function").click();
    await page.getByPlaceholder("Search Function").fill("sanity");
    await page.getByRole("button", { name: "Delete Function" }).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.getByText("Function deleted").click();
  });

  // ===== DASHBOARD FOLDER TESTS =====
  const randomFolderName = `Folder${Math.floor(Math.random() * 1000)}`;
  test("should create delete folder", async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await page.waitForTimeout(2000);
    await page.locator('[data-test="dashboard-search"]').click();
    await page.click('[data-test="dashboard-new-folder-btn"]');
    await page.waitForTimeout(1000);
    await page.click('[data-test="dashboard-folder-add-name"]');
    await page.type(
      '[data-test="dashboard-folder-add-name"]',
      randomFolderName
    );
    await page.click('[data-test="dashboard-folder-add-save"]');
    await page.getByText(randomFolderName).click();
    await page.waitForTimeout(5000);
    await page.locator(`[data-test^="dashboard-folder-tab"]:has-text("${randomFolderName}") [data-test="dashboard-more-icon"]`).click();
    await page.locator('[data-test="dashboard-delete-folder-icon"]').click({ force: true });
    await page.waitForTimeout(100);
    await page.click('[data-test="confirm-button"]');

    await page.waitForTimeout(100);
    const notificationMessage = await page.$(".q-notification__message");
    if (notificationMessage) {
      const messageText = await notificationMessage.textContent();
      expect(messageText).toContain("Folder deleted successfully");
    } else {
      // Handle case when notification message is not found
    }
  });

  // ===== ALERTS TESTS =====
  test.skip("create template, destination and alert and then delete it", async ({ page }) => {
    const uniqueId = Date.now(); // Generate a unique ID for each run
    const templateName = `sanitytemp-${uniqueId}`;
    const destinationName = `sanitydest-${uniqueId}`;
    const alertName = `sanityalert-${uniqueId}`;
  
    await page.locator('[data-test="menu-link-settings-item"]').click();
    await page.locator('[data-test="alert-destinations-tab"]').waitFor();
    await page.locator('[data-test="alert-destinations-tab"]').click();
  
    await page.locator('[data-test="alert-templates-tab"]').waitFor();
    await page.locator('[data-test="alert-templates-tab"]').click();
  
    // Wait for template API before clicking "Add Template" button
    await page.waitForResponse(response =>
      response.url().includes("/api/default/alerts/templates") && response.status() === 200
    );
  
    await page.locator('[data-test="alert-template-list-add-alert-btn"]').click();
    await page.locator('[data-test="add-template-name-input"]').waitFor();
    await page.locator('[data-test="add-template-name-input"]').fill(templateName);
  
    const jsonString = '{"text": "{alert_name} is active"}';
    await page.locator(".cm-line").click();
    await page.keyboard.type(jsonString);
    await page.waitForTimeout(500); // Ensure typing completes before submit
  
    await page.locator('[data-test="add-template-submit-btn"]').click();
    await expect(page.locator(".q-notification__message").getByText(/Template Saved Successfully/)).toBeVisible();
  
    await page.locator('[data-test="alert-destinations-tab"]').click();
  
    await page.waitForTimeout(2000);
  
    await page.locator('[data-test="alert-destination-list-add-alert-btn"]').click();
    await page.locator('[data-test="add-destination-name-input"]').waitFor();
    await page.locator('[data-test="add-destination-name-input"]').fill(destinationName);
    await page.waitForTimeout(500); // Ensure input is registered
  
    await page.locator('[data-test="add-destination-template-select"]').click();
    await page.getByText(templateName).click();
  
    await page.locator('[data-test="add-destination-url-input"]').fill("sanity");
    await page.waitForTimeout(500); // Ensure input is registered
  
    await page.locator('[data-test="add-destination-submit-btn"]').click();
  
    // Wait for API before proceeding
    await page.waitForResponse(response =>
      response.url().includes("/api/default/alerts/destinations") && response.status() === 200
    );
  
    await page.locator('[data-test="menu-link-\\/alerts-item"]').click();
    await page.locator('[data-test="alert-list-add-alert-btn"]').click();
    await page.getByLabel("Name *").first().fill(alertName);

    await page.waitForTimeout(500); // Ensure input is registered
  
    await page.locator('[data-test="add-alert-stream-type-select"]').click();
    await page.getByRole("option", { name: "logs" }).click();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("e2e");
    await page.getByText("e2e_automate").click();
    await page.locator('[data-test="alert-conditions-delete-condition-btn"]').click();
  
    await page.locator('[data-test="add-alert-destination-select"]').click();
    await page.locator(`[data-test="add-alert-destination-${destinationName}-select-item"]`).click();
    await page.locator('[data-test="chart-renderer"] div').click();
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight); // Scrolls down by one full screen height
    });
    await page.locator('[data-test="add-alert-submit-btn"]').click({force:true});
    await page.waitForTimeout(1000);
    await page.locator(`[data-test="alert-list-${alertName}-clone-alert"]`).click();

    const clonedAlertName = `clone-${alertName}`;
    await page.locator('[data-test="to-be-clone-alert-name"]').fill(clonedAlertName);
    await page.waitForTimeout(500); // Ensure input is registered

    await page.locator('[data-test="to-be-clone-stream-type"]').click();
    await page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
    await page.locator('[data-test="to-be-clone-stream-name"]').click();
    await page.locator('[data-test="to-be-clone-stream-name"]').fill('e2e_automate');
    await page.waitForTimeout(2000);
    await page.getByRole('option', { name: 'e2e_automate' }).click({force:true});
    await page.waitForTimeout(2000);
    await page.locator('[data-test="clone-alert-submit-btn"]').click();
    await page.getByText('Alert Cloned Successfully').click();

    await page.locator('[data-test="alert-list-search-input"]').fill(clonedAlertName);
    await page.waitForTimeout(2000);
    await page.locator(`[data-test="alert-list-${clonedAlertName}-more-options"]`).click();
    await page.getByText('Delete',{exact:true}).click();
    await page.locator('[data-test="confirm-button"]').click();

    // Delete the original alert
    await page.locator('[data-test="alert-list-search-input"]').fill(alertName);
    await page.waitForTimeout(500); // Ensure input is registered
    await page.locator(`[data-test="alert-list-${alertName}-more-options"]`).click();
    await page.getByText('Delete',{exact:true}).click();
    await page.locator('[data-test="confirm-button"]').click();
  
    // Delete the destination
    await page.locator('[data-test="menu-link-settings-item"]').click();
    await page.locator('[data-test="alert-destinations-tab"]').click();
    await page.locator('[data-test="destination-list-search-input"]').fill(destinationName);
    await page.waitForTimeout(500); // Ensure input is registered
    await page.locator(`[data-test="alert-destination-list-${destinationName}-delete-destination"]`).click();
    await page.locator('[data-test="confirm-button"]').click();
  
    // Delete the template
    await page.locator('[data-test="alert-templates-tab"]').click();
    await page.locator('[data-test="template-list-search-input"]').fill(templateName);
    await page.waitForTimeout(500); // Ensure input is registered
    await page.locator(`[data-test="alert-template-list-${templateName}-delete-template"]`).click();
    await page.locator('[data-test="confirm-button"]').click();
  });

  // ===== STREAMS TESTS =====
  test("create stream and delete it", async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.waitForTimeout(2000);
    await page.locator('[data-test="log-stream-add-stream-btn"]').click();
    await page.getByLabel("Name *").click();
    await page.getByLabel("Name *").fill("sanitylogstream");
    await page
      .locator('[data-test="add-stream-type-input"]')
      .getByText("arrow_drop_down")
      .click();
    await page.getByRole("option", { name: "Logs" }).click();
    await page.locator('[data-test="save-stream-btn"]').click();
    await page.waitForTimeout(2000);
    await page.getByText("Stream created successfully").click();
    await page.getByPlaceholder("Search Stream").click();
    await page.getByPlaceholder("Search Stream").fill("sanitylogstream");
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Ok" }).click();
  });

  // ===== RESULT SUMMARY TESTS =====
  test("should display pagination even after clicking result summary", async ({ page }) => {
    await page.waitForTimeout(2000);
    await page.locator('[data-test="log-table-column-0-source"]').click();
    await page.locator('[data-test="close-dialog"]').click();
    await page
      .getByText("fast_rewind12345fast_forward50arrow_drop_down")
      .click();
  });

});
