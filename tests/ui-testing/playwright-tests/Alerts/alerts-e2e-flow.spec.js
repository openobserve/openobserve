import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import PageManager from '../../pages/page-manager.js';

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

test.describe("Alerts E2E Flow", () => {
  // Shared test variables
  let pageManager;
  let createdTemplateName;
  let createdDestinationName;
  let sharedRandomValue;

  /**
   * Setup for each test
   * - Logs in
   * - Generates shared random value
   * - Ingests test data (except for scheduled alert test)
   * - Navigates to alerts page
   */
  test.beforeEach(async ({ page }, testInfo) => {
    await login(page);
    pageManager = new PageManager(page);
    await page.waitForTimeout(5000);

    // Generate shared random value if not already generated
    if (!sharedRandomValue) {
      sharedRandomValue = pageManager.alertsPage.generateRandomString();
      console.log('Generated shared random value for this run:', sharedRandomValue);
    }

    // Skip data ingestion for scheduled alert test
    if (!test.info().title.includes('Scheduled Alert')) {
      // Ingest test data using common actions
      const streamName = 'auto_playwright_stream';
      await pageManager.commonActions.ingestTestData(streamName);
    }
    
    // Navigate to alerts page
    await page.goto(
      `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  /**
   * Test: Complete E2E flow for alerts
   * Tests all major alert operations in sequence
   */
  test('Alerts E2E Flow - Create, Update, Move, Clone, Delete, Pause, Resume', {
    tag: ['@e2eAlerts', '@all', '@alerts']
  }, async ({ page }) => {
    // Test data setup
    const streamName = 'auto_playwright_stream';
    const column = 'job';
    const value = 'test';

    // Ensure prerequisites exist
    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
    await pageManager.alertTemplatesPage.ensureTemplateExists(createdTemplateName);
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pageManager.alertDestinationsPage.ensureDestinationExists(createdDestinationName, slackUrl, createdTemplateName);

    // Navigate to alerts tab
    await pageManager.commonActions.navigateToAlerts();
    await page.waitForTimeout(2000);

    // ===== First Iteration: Initial Alert Creation and Management =====
    // Create and verify folder
    const folderName = 'auto_' + sharedRandomValue;
    await pageManager.alertsPage.createFolder(folderName, 'Test Automation Folder');
    await pageManager.alertsPage.verifyFolderCreated(folderName);
    console.log('Successfully created folder:', folderName);

    // Navigate to folder and create first alert
    await pageManager.alertsPage.navigateToFolder(folderName);
    const alertName = await pageManager.alertsPage.createAlert(streamName, column, value, createdDestinationName, sharedRandomValue);
    await pageManager.alertsPage.verifyAlertCreated(alertName);
    console.log('Successfully created alert:', alertName);

    // Clone first alert
    await pageManager.alertsPage.cloneAlert(alertName, 'logs', streamName);
    console.log('Successfully cloned alert:', alertName);

    // Delete all instances of the cloned alert
    await pageManager.alertsPage.deleteImportedAlert(alertName);
    console.log('Successfully deleted all instances of alert:', alertName);

    // ===== Second Iteration: New Alert Creation and Management =====
    // Navigate back to folder and create new alert
    await pageManager.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(2000);

    const newAlertName = await pageManager.alertsPage.createAlert(streamName, column, value, createdDestinationName, sharedRandomValue);
    await pageManager.alertsPage.verifyAlertCreated(newAlertName);
    console.log('Successfully created new alert:', newAlertName);

    // Update the new alert's operator
    await pageManager.alertsPage.updateAlert(newAlertName);
    console.log('Successfully updated new alert:', newAlertName);

    // Clone the new alert
    await pageManager.alertsPage.cloneAlert(newAlertName, 'logs', streamName);
    console.log('Successfully cloned new alert:', newAlertName);

    // ===== Alert Pause and Resume =====
    // Pause the new alert
    await pageManager.alertsPage.pauseAlert(newAlertName);
    console.log('Successfully paused alert:', newAlertName);

    // Resume the new alert
    await pageManager.alertsPage.resumeAlert(newAlertName);
    console.log('Successfully resumed alert:', newAlertName);

    // ===== Alert Movement and Cleanup =====
    // Move alerts to target folder
    const targetFolderName = 'testfoldermove';
    await pageManager.alertsPage.ensureFolderExists(targetFolderName, 'Test Folder for Moving Alerts');
    await pageManager.alertsPage.moveAllAlertsToFolder(targetFolderName);
    await page.waitForTimeout(2000);

    await pageManager.dashboardFolder.searchFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toBeVisible();
    await pageManager.dashboardFolder.deleteFolder(folderName);

    // Verify alerts in target folder
    await page.waitForTimeout(2000);
    await pageManager.dashboardFolder.searchFolder(targetFolderName);
    await expect(page.locator(`text=${targetFolderName}`)).toBeVisible();
    await pageManager.alertsPage.navigateToFolder(targetFolderName);
    await page.waitForTimeout(2000);

    // Search and verify alert instance
    await pageManager.alertsPage.searchAlert(newAlertName);
    await pageManager.alertsPage.verifySearchResults(2);

    // Delete the alert
    await pageManager.alertsPage.deleteAlertByRow(newAlertName);
  });
}); 