import { test, expect } from "./baseFixtures";
import logData from "../../ui-testing/cypress/fixtures/log.json";
import { AlertsNewPage } from '../../ui-testing/pages/alertsNew.js';
import { AlertTemplatesPage } from '../../ui-testing/pages/alertTemplatesPage.js';
import { AlertDestinationsPage } from '../../ui-testing/pages/alertDestinationsPage.js';
import { CommonActions } from '../../ui-testing/pages/commonActions.js';

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
  let templatesPage;
  let destinationsPage;
  let commonActions;
  let createdTemplateName;
  let createdDestinationName;
  let sharedRandomValue;

  // Helper function to ensure template exists
  async function ensureTemplateExists() {
    if (!createdTemplateName) {
      createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
      await templatesPage.createTemplate(createdTemplateName);
      console.log('Created template for dependency:', createdTemplateName);
    }
    return createdTemplateName;
  }

  // Helper function to ensure destination exists
  async function ensureDestinationExists() {
    if (!createdDestinationName) {
      await ensureTemplateExists();
      createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
      const slackUrl = "DEMO";
      await destinationsPage.createDestination(createdDestinationName, slackUrl, createdTemplateName);
      console.log('Created destination for dependency:', createdDestinationName);
    }
    return createdDestinationName;
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
    alertsPage = new AlertsNewPage(page);
    templatesPage = new AlertTemplatesPage(page);
    destinationsPage = new AlertDestinationsPage(page);
    commonActions = new CommonActions(page);
    await page.waitForTimeout(5000);

    // Generate shared random value if not already generated
    if (!sharedRandomValue) {
      sharedRandomValue = alertsPage.generateRandomString();
      console.log('Generated shared random value for this run:', sharedRandomValue);
    }

    // Skip data ingestion for scheduled alert test
    if (!test.info().title.includes('Scheduled Alert')) {
      // Ingest test data using common actions
      const streamName = 'auto_playwright_stream';
      await commonActions.ingestTestData(streamName);
    }
    
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

    // Create destination with Slack URL from environment
    const slackUrl = "DEMO";
    await destinationsPage.createDestination(createdDestinationName, slackUrl, createdTemplateName);
    console.log('Successfully created destination:', createdDestinationName);
  });

  test('Alerts E2E Flow - Create, Update, Move, Clone, Delete, Pause, Resume', {
    tag: ['@createFolder', '@createAlert', '@moveAlerts', '@updateAlerts', '@cloneAlerts', '@deleteAlerts', '@pauseAlerts', '@resumeAlerts', '@all', '@alerts']
  }, async ({ page }) => {
    const streamName = 'auto_playwright_stream';
    const column = 'job';
    const value = 'test';

    // Ensure destination exists (which will also ensure template exists)
    await ensureDestinationExists();

    // Navigate to alerts tab using common actions
    await commonActions.navigateToAlerts();
    await page.waitForTimeout(2000);

    // Use the shared random value for the folder name
    const folderName = 'auto_' + sharedRandomValue;
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

    // Ensure target folder exists and move alerts
    const targetFolderName = 'testfoldermove';
    await alertsPage.ensureFolderExists(targetFolderName, 'Test Folder for Moving Alerts');
    await alertsPage.moveAllAlertsToFolder(targetFolderName);

    // Navigate to the target folder
    await page.waitForTimeout(2000);
    await alertsPage.navigateToFolder(targetFolderName);
    await page.waitForTimeout(2000);

    // Search for the alert and verify results
    await alertsPage.searchAlert(alertName);
    await alertsPage.verifySearchResults(2);

    // Delete first alert
    await alertsPage.deleteAlertByRow(alertName);

    // Search again and verify only one result remains
    await alertsPage.searchAlert(alertName);
    await alertsPage.verifySearchResults(1);

    // Delete second alert
    await alertsPage.deleteAlertByRow(alertName);
  });

  test('Verify Delete alert template functionality', {
    tag: ['@deleteTemplate', '@all', '@alerts']
  }, async ({ page }) => {
    // Ensure template exists
    await ensureTemplateExists();

    // Navigate to templates page
    await templatesPage.navigateToTemplates();
    await page.waitForTimeout(2000); // Wait for page to load

    // Try to delete template and handle both success and in-use scenarios
    await templatesPage.deleteTemplateAndVerify(createdTemplateName);
  });

  test('Create and Delete Scheduled Alert with SQL Query', {
    tag: ['@createAlert', '@deleteAlerts', '@scheduledAlerts', '@all', '@alerts']
  }, async ({ page }) => {
    const streamName = 'auto_playwright_stream';

    // Ensure destination exists (which will also ensure template exists)
    await ensureDestinationExists();

    // Navigate to alerts tab using common actions
    await commonActions.navigateToAlerts();
    await page.waitForTimeout(2000);

    // Ingest custom test data
    await commonActions.ingestCustomTestData(streamName);
    await page.waitForTimeout(2000);

    // Use the shared random value for the folder name
    const folderName = 'auto_' + sharedRandomValue;
    await alertsPage.createFolder(folderName, 'Test Automation Folder');
    await alertsPage.verifyFolderCreated(folderName);
    console.log('Successfully created folder:', folderName);

    // Navigate to the folder
    await alertsPage.navigateToFolder(folderName);

    // Create scheduled alert with SQL query
    const alertName = await alertsPage.createScheduledAlertWithSQL(streamName, createdDestinationName, sharedRandomValue);
    await alertsPage.verifyAlertCreated(alertName);
    console.log('Successfully created scheduled alert:', alertName);

    // Delete the alert
    await alertsPage.deleteAlertByRow(alertName);
  });
});
