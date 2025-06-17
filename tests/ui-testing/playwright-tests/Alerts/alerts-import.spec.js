import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import { AlertsPage } from '../../pages/alertsPages/alertsPage.js';
import { AlertTemplatesPage } from '../../pages/alertsPages/alertTemplatesPage.js';
import { AlertDestinationsPage } from '../../pages/alertsPages/alertDestinationsPage.js';
import { CommonActions } from '../../pages/commonActions.js';

/**
 * Helper function for login
 * Handles the initial login process and navigation
 */
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

test.describe("Alerts Import/Export", () => {
  // Shared test variables
  let alertsPage;
  let templatesPage;
  let destinationsPage;
  let commonActions;
  let createdTemplateName;
  let createdDestinationName;
  let sharedRandomValue;

  /**
   * Setup for each test
   * - Logs in
   * - Initializes page objects
   * - Generates shared random value
   * - Ingests test data
   * - Navigates to alerts page
   */
  test.beforeEach(async ({ page }, testInfo) => {
    await login(page);
    alertsPage = new AlertsPage(page);
    templatesPage = new AlertTemplatesPage(page);
    destinationsPage = new AlertDestinationsPage(page);
    commonActions = new CommonActions(page);
    await page.waitForTimeout(5000);

    // Generate shared random value if not already generated
    if (!sharedRandomValue) {
      sharedRandomValue = alertsPage.generateRandomString();
      console.log('Generated shared random value for this run:', sharedRandomValue);
    }

    // Ingest test data using common actions
    const streamName = 'auto_playwright_stream';
    await commonActions.ingestTestData(streamName);
    
    // Navigate to alerts page
    await page.goto(
      `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  /**
   * Test: Import/Export Alert Functionality
   * Tests importing and exporting alerts
   */
  test('Import/Export Alert Functionality', {
    tag: ['@all', '@alerts', '@alertsImportExport']
  }, async ({ page }) => {
    // Initialize page objects
    alertsPage = new AlertsPage(page);
    templatesPage = new AlertTemplatesPage(page);
    destinationsPage = new AlertDestinationsPage(page);
    commonActions = new CommonActions(page);

    // Create template
    const templateName = 'auto_playwright_template_' + sharedRandomValue;
    await templatesPage.createTemplate(templateName);
    console.log('Created template:', templateName);

    // Create destination
    const destinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await destinationsPage.ensureDestinationExists(destinationName, slackUrl, templateName);
    console.log('Created destination:', destinationName);

    // Navigate to alerts page
    await commonActions.navigateToAlerts();

    // Create folder
    const folderName = 'auto_' + sharedRandomValue;
    await alertsPage.createFolder(folderName, 'Test Automation Folder');
    console.log('Created folder:', folderName);

    // Create alert
    const streamName = 'auto_playwright_stream';
    const column = 'job';
    const value = 'test';
    await alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(2000);
    const alertName = await alertsPage.createAlert(streamName, column, value, destinationName, sharedRandomValue);
    await alertsPage.verifyAlertCreated(alertName);
    console.log('Successfully created alert:', alertName);
    await page.waitForTimeout(2000);

    // Export alerts
    const download = await alertsPage.exportAlerts();
    const downloadPath = `./alerts-${new Date().toISOString().split('T')[0]}-${streamName}.json`;
    await download.saveAs(downloadPath);

    // Test invalid import
    await alertsPage.importInvalidFile('utils/td150.json');

    // Import valid file
    await alertsPage.importValidFile(downloadPath);

    // Clean up imported alert
    await alertsPage.deleteImportedAlert(alertName);
    await alertsPage.cleanupDownloadedFile(downloadPath);
  });
}); 