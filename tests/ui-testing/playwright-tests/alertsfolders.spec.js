import { test, expect } from './baseFixtures';
import logData from "../../ui-testing/cypress/fixtures/log.json";
import logsdata from "../../test-data/logs_data.json";
import { toZonedTime } from "date-fns-tz";
import { LogsPage } from '../pages/logsPage.js';
import DashboardFolder from "../pages/dashboardPages/dashboard-folder.js";

test.describe.configure({ mode: "serial" });
const folderName = `Folder ${Date.now()}`;
const dashboardName = `AutomatedDashboard${Date.now()}`;

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


test.describe("Alert folders testcases", () => {
  let logsPage;

  function removeUTFCharacters(text) {
    return text.replace(/[^\x00-\x7F]/g, " ");
  }

  async function applyQueryButton(page) {
    const search = page.waitForResponse(logData.applyQuery);
    await page.waitForTimeout(3000);
    await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
      force: true,
    });
    await expect.poll(async () => (await search).status()).toBe(200);
  }

  async function createAlertTemplate(page, templateName) {
    await page.locator('[data-test="alert-templates-tab"]').waitFor();
    await page.locator('[data-test="alert-templates-tab"]').click();
    
    await page.waitForResponse(response =>
      response.url().includes("/api/default/alerts/templates") && response.status() === 200
    );
    
    await page.locator('[data-test="alert-template-list-add-alert-btn"]').click();
    await page.locator('[data-test="add-template-name-input"]').waitFor();
    await page.locator('[data-test="add-template-name-input"]').fill(templateName);
    
    const jsonString = '{"text": "{alert_name} is active"}';
    await page.locator(".view-line").click();
    await page.keyboard.type(jsonString);
    await page.waitForTimeout(500);
    
    await page.locator('[data-test="add-template-submit-btn"]').click();
    await expect(page.locator(".q-notification__message").getByText(/Template Saved Successfully/)).toBeVisible();
  }

  async function createAlertDestination(page, destinationName, templateName) {
    await page.locator('[data-test="alert-destinations-tab"]').click();
    await page.waitForTimeout(2000);
    
    await page.locator('[data-test="alert-destination-list-add-alert-btn"]').click();
    await page.locator('[data-test="add-destination-name-input"]').waitFor();
    await page.locator('[data-test="add-destination-name-input"]').fill(destinationName);
    await page.waitForTimeout(500);
    
    await page.locator('[data-test="add-destination-template-select"]').click();
    await page.getByText(templateName).click();
    
    await page.locator('[data-test="add-destination-url-input"]').fill("sanity");
    await page.waitForTimeout(500);
    
    await page.locator('[data-test="add-destination-submit-btn"]').click();
    
    await page.waitForResponse(response =>
      response.url().includes("/api/default/alerts/destinations") && response.status() === 200
    );
  }

  async function createAlert(page, alertName, destinationName) {
    await page.locator('[data-test="menu-link-\\/alerts-item"]').click();
    await page.locator('[data-test="alert-list-add-alert-btn"]').click();
    await page.getByLabel("Name *").first().fill(alertName);
    await page.waitForTimeout(500);
    
    await page.locator('[data-test="add-alert-stream-type-select"]').click();
    await page.getByRole("option", { name: "logs" }).click();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("e2e");
    await page.getByText("e2e_automate").click();
    await page.locator('[data-test="alert-conditions-delete-condition-btn"]').click();
    
    await page.locator('[data-test="add-alert-destination-select"]').click();
    await page.waitForTimeout(2000)
    await page.locator(`[data-test="add-alert-destination-${destinationName}-select-item"]`).click();
    await page.waitForTimeout(500)
    await page.locator('[data-test="chart-renderer"] div').first().click();
    await page.waitForTimeout(1000);
    
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });
    await page.locator('[data-test="add-alert-submit-btn"]').click({force:true});
    await page.waitForTimeout(1000);
  }

  async function cloneAlert(page, alertName) {
    const clonedAlertName = `clone-${alertName}`;
    await page.locator(`[data-test="alert-list-${alertName}-clone-alert"]`).click();
    await page.locator('[data-test="to-be-clone-alert-name"]').fill(clonedAlertName);
    await page.waitForTimeout(500);
    
    await page.locator('[data-test="to-be-clone-stream-type"]').click();
    await page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
    await page.locator('[data-test="to-be-clone-stream-name"]').click();
    await page.locator('[data-test="to-be-clone-stream-name"]').fill('e2e_automate');
    await page.waitForTimeout(2000);
    await page.getByRole('option', { name: 'e2e_automate' }).click({force:true});
    await page.waitForTimeout(2000);
    await page.locator('[data-test="clone-alert-submit-btn"]').click();
    await page.getByText('Alert Cloned Successfully').click();
    
    return clonedAlertName;
  }

  async function deleteAlert(page, alertName) {
    await page.locator('[data-test="alert-list-search-input"]').fill(alertName);
    await page.waitForTimeout(500);
    await page.locator(`[data-test="alert-list-${alertName}-more-options"]`).click();
    await page.getByText('Delete',{exact:true}).click();
    await page.locator('[data-test="confirm-button"]').click();
  }

  async function deleteDestination(page, destinationName) {
    await page.locator('[data-test="menu-link-settings-item"]').click();
    await page.locator('[data-test="alert-destinations-tab"]').click();
    await page.locator('[data-test="destination-list-search-input"]').fill(destinationName);
    await page.waitForTimeout(500);
    await page.locator(`[data-test="alert-destination-list-${destinationName}-delete-destination"]`).click();
    await page.locator('[data-test="confirm-button"]').click();
  }

  async function deleteTemplate(page, templateName) {
    await page.locator('[data-test="alert-templates-tab"]').click();
    await page.locator('[data-test="template-list-search-input"]').fill(templateName);
    await page.waitForTimeout(500);
    await page.locator(`[data-test="alert-template-list-${templateName}-delete-template"]`).click();
    await page.locator('[data-test="confirm-button"]').click();
  }

  async function createFolder(page, folderName) {
    await page.locator('[data-test="dashboard-new-folder-btn"]').click();
    await page.locator('[data-test="dashboard-folder-add-name"]').click();
    await page.locator('[data-test="dashboard-folder-add-name"]').fill(folderName);
    await page.locator('[data-test="dashboard-folder-add-save"]').click();
    await page.waitForTimeout(2000);
    return folderName;
  }

  async function moveAlertToFolder(page, alertName, folderName) {
    await page.locator('[data-test="stream-association-table-undefined-row"]').getByRole('checkbox').first().click()
    await page.locator('[data-test="alert-list-move-across-folders-btn"]').click();
    await page.locator('[data-test="alerts-index-dropdown-stream_type"]').click();
    await page.getByRole('option', { name: folderName }).click();
    await page.locator('[data-test="alerts-folder-move"]').click();
    await page.getByText('alerts Moved successfully').click();
  }

  async function deleteFolder(page, folderName) {
    await page.getByText(folderName).click();
    await page.locator('[data-test="dashboard-more-icon"]').click();
    await page.locator('[data-test="dashboard-delete-folder-icon"]').getByText('Delete').click();
    await page.locator('[data-test="confirm-button"]').click();
  }

  async function moveMultipleAlertsToFolder(page, alertNames, folderName) {
    // Select all alerts using the header checkbox
    await page.getByRole('row', { name: '# Name Owner Period Frequency' }).getByRole('checkbox').click();
    
    await page.locator('[data-test="alert-list-move-across-folders-btn"]').click();
    await page.locator('[data-test="alerts-index-dropdown-stream_type"]').click();
    await page.getByRole('option', { name: folderName }).click();
    await page.locator('[data-test="alerts-folder-move"]').click();
    await page.getByText('alerts Moved successfully').click();
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
    logsPage = new LogsPage(page);
    await page.waitForTimeout(1000)
    await ingestion(page);
    await page.waitForTimeout(2000)

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await logsPage.selectStreamAndStreamTypeForLogs("e2e_automate"); 
    await applyQueryButton(page);
  });



  test("create alert and manage it in folders", async ({ page }) => {
    const dashboardFolders = new DashboardFolder(page);
    const uniqueId = Date.now();
    const templateName = `sanitytemp-${uniqueId}`;
    const destinationName = `sanitydest-${uniqueId}`;
    const alertName = `sanityalert-${uniqueId}`;
    const folderName = `alert-${uniqueId}`;
    
    await page.locator('[data-test="menu-link-settings-item"]').click();
    await page.locator('[data-test="alert-destinations-tab"]').waitFor();
    
    await createAlertTemplate(page, templateName);
    await createAlertDestination(page, destinationName, templateName);
    await createAlert(page, alertName, destinationName);
    
    // Create new folder and move alert
    await createFolder(page, folderName);
    await moveAlertToFolder(page, alertName, folderName);
    
    // Delete alert from new folder
    await page.getByText(folderName).click();
    await deleteAlert(page, alertName);
    
    // Delete folder
    await dashboardFolders.deleteFolder(folderName);
    
    // Clean up remaining resources
    await deleteDestination(page, destinationName);
    await deleteTemplate(page, templateName);
  });

  test("bulk move multiple alerts to folder", async ({ page }) => {
    const dashboardFolders = new DashboardFolder(page);
    const uniqueId = Date.now();
    const templateName = `sanitytemp-${uniqueId}`;
    const destinationName = `sanitydest-${uniqueId}`;
    const alertName1 = `sanityalert1-${uniqueId}`;
    const alertName2 = `sanityalert2-${uniqueId}`;
    const folderName = `alert-folder-${uniqueId}`;
    
    await page.locator('[data-test="menu-link-settings-item"]').click();
    await page.locator('[data-test="alert-destinations-tab"]').waitFor();
    
    // Create template and destination
    await createAlertTemplate(page, templateName);
    await createAlertDestination(page, destinationName, templateName);
    
    // Create two alerts
    await createAlert(page, alertName1, destinationName);
    await createAlert(page, alertName2, destinationName);
    
    // Create folder and move both alerts
    const createdFolderName = await createFolder(page, folderName);
    await moveMultipleAlertsToFolder(page, [alertName1, alertName2], createdFolderName);
    
    // Navigate to the new folder and delete alerts
    await page.locator('[data-test="menu-link-\\/alerts-item"]').click();
    await page.getByText(createdFolderName, { exact: true }).click();
    await page.waitForTimeout(2000);
    await deleteAlert(page, alertName1);
    await deleteAlert(page, alertName2);
    
    // Delete folder and clean up
    await dashboardFolders.deleteFolder(createdFolderName);
    await deleteDestination(page, destinationName);
    await deleteTemplate(page, templateName);
  });
});