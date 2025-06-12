import { test, expect } from "./baseFixtures";
import logData from "../../ui-testing/cypress/fixtures/log.json";
import logsdata from "../../test-data/logs_data.json";
import { AlertsNewPage } from '../../ui-testing/pages/alertsNew.js';
import { AlertTemplatesPage } from '../../ui-testing/pages/alertTemplatesPage.js';
import { AlertDestinationsPage } from '../../ui-testing/pages/alertDestinationsPage.js';

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

test.describe.serial("Alerts Module testcases", () => {
  let alertsPage;
  let templatesPage;
  let destinationsPage;
  let createdTemplateName;
  let createdDestinationName;
  let sharedRandomValue;

  test.beforeEach(async ({ page }) => {
    await login(page);
    alertsPage = new AlertsNewPage(page);
    templatesPage = new AlertTemplatesPage(page);
    destinationsPage = new AlertDestinationsPage(page);
    await page.waitForTimeout(5000);

    // Generate shared random value if not already generated
    if (!sharedRandomValue) {
      sharedRandomValue = alertsPage.generateRandomString();
      console.log('Generated shared random value for this run:', sharedRandomValue);
    }

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

  test('Create alert template and destination', {
    tag: ['@alertTemplate', '@alertDestination', '@all', '@alerts']
  }, async ({ page }) => {
    // Use shared random value for template name
    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;

    // Create template
    await templatesPage.createTemplate(createdTemplateName);
    console.log('Successfully created template:', createdTemplateName);

    // Use shared random value for destination name
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;

    // Create destination with test URL
    const testUrl = 'DEMO';
    await destinationsPage.createDestination(createdDestinationName, testUrl, createdTemplateName);
    console.log('Successfully created destination:', createdDestinationName);
  });

  test('Create folder and alert', {
    tag: ['@createFolder', '@createAlert', '@all', '@alerts']
  }, async ({ page }) => {
    const streamName = 'alertstestqa';
    const column = 'job';
    const value = 'test';

    // Use shared random value for folder name
    const folderName = 'automationFolder_' + sharedRandomValue;
    await alertsPage.createFolder(folderName, 'Test Automation Folder');
    await alertsPage.verifyFolderCreated(folderName);
    console.log('Successfully created folder:', folderName);

    // Navigate to the folder
    await alertsPage.navigateToFolder(folderName);

    // Create alert and store its name
    const alertName = await alertsPage.createAlert(streamName, column, value, createdDestinationName, sharedRandomValue);
    await alertsPage.verifyAlertCreated(alertName);
    console.log('Successfully created alert:', alertName);

    // Update alert
    await alertsPage.updateAlert(alertName, '=');
    console.log('Successfully updated alert:', alertName);

    // Clone alert
    await alertsPage.cloneAlert(alertName, 'logs', streamName);
    console.log('Successfully cloned alert:', alertName);
  });

  test('Delete alert template', {
    tag: ['@deleteTemplate', '@all', '@alerts']
  }, async ({ page }) => {
    // Navigate to templates page
    await templatesPage.navigateToTemplates();
    await page.waitForTimeout(2000); // Wait for page to load

    // Verify template in use message
    await templatesPage.verifyTemplateInUse(createdTemplateName, createdDestinationName);
    console.log('Successfully verified template in use message for template:', createdTemplateName);
  });
});
