import { test, expect } from "./baseFixtures";
import logData from "../../ui-testing/cypress/fixtures/log.json";
import logsdata from "../../test-data/logs_data.json";
import { AlertsNewPage } from '../../ui-testing/pages/alertsNew.js';

// Helper function for login
async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  await page.waitForTimeout(1000);
  if (await page.getByText('Login as internal user').isVisible()) {
    await page.getByText('Login as internal user').click();
  }
  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
  await page.waitForTimeout(4000);
  await page.goto(process.env["ZO_BASE_URL"]);
}

test.describe("Alerts Module testcases", () => {
  let alertsPage;

  test.beforeEach(async ({ page }) => {
    await login(page);
    alertsPage = new AlertsNewPage(page);
    await page.waitForTimeout(5000);

    // Ingest logs via API
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
    
    // Navigate to alerts page
    await page.goto(
      `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test('Create and verify folder functionality', {
    tag: ['@createFolder', '@all', '@alerts']
  }, async ({ page }) => {
    // Generate random folder name once for this test
    const folderName = alertsPage.generateRandomFolderName();
    console.log('Created folder:', folderName);
    
    // Create first folder
    await alertsPage.createFolder(folderName, 'Test Automation Folder');
    await alertsPage.verifyFolderCreated(folderName);
    
    // Click on the folder and verify no data
    await alertsPage.clickFolder(folderName);
    await alertsPage.verifyNoDataAvailable();
    
    // Try to create folder with same name
    await alertsPage.createFolder(folderName);
    await alertsPage.verifyFolderExistsError();
    await alertsPage.cancelFolderCreation();
  });

  test('Create, update, clone and delete alert in folder', {
    tag: ['@createAlert', '@editAlert', '@cloneAlert', '@deleteAlert', '@all', '@alerts']
  }, async ({ page }) => {
    const streamName = 'alertstestqa';
    const column = 'job';
    const value = 'test';

    // Generate folder name once for this test
    const folderName = 'automationFolder_'+ alertsPage.generateRandomFolderName();
    console.log('Creating new folder for alert test:', folderName);
    await alertsPage.createFolder(folderName, 'Test Automation Folder');
    await alertsPage.verifyFolderCreated(folderName);

    // Navigate to the folder
    await alertsPage.navigateToFolder(folderName);
    console.log('Using folder:', folderName);

    // Create alert and store its name
    const alertName = await alertsPage.createAlert(streamName, column, value);
    await alertsPage.verifyAlertCreated(alertName);

    // Update alert
    await alertsPage.updateAlert(alertName, '=');

    // Clone alert
    await alertsPage.cloneAlert(alertName, 'logs', streamName);
  });
});
