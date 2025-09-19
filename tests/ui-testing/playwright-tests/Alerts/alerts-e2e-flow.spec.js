const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');

test.describe("Alerts E2E Flow", () => {
  // Shared test variables
  let pm;
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
    pm = new PageManager(page);

    // Generate shared random value if not already generated
    if (!sharedRandomValue) {
      sharedRandomValue = pm.alertsPage.generateRandomString();
      console.log('Generated shared random value for this run:', sharedRandomValue);
    }

    await pm.commonActions.skipDataIngestionForScheduledAlert(testInfo.title);
    
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
    await pm.alertTemplatesPage.ensureTemplateExists(createdTemplateName);
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(createdDestinationName, slackUrl, createdTemplateName);

    // Navigate to alerts tab
    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle');

    // ===== First Iteration: Initial Alert Creation and Management =====
    // Create and verify folder
    const folderName = 'auto_' + sharedRandomValue;
    await pm.alertsPage.createFolder(folderName, 'Test Automation Folder');
    await pm.alertsPage.verifyFolderCreated(folderName);
    console.log('Successfully created folder:', folderName);

    // Navigate to folder and create first alert
    await pm.alertsPage.navigateToFolder(folderName);
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, createdDestinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    console.log('Successfully created alert:', alertName);

    // Clone first alert
    await pm.alertsPage.cloneAlert(alertName, 'logs', streamName);
    console.log('Successfully cloned alert:', alertName);

    // Delete all instances of the cloned alert
    await pm.alertsPage.deleteImportedAlert(alertName);
    console.log('Successfully deleted all instances of alert:', alertName);

    // ===== Second Iteration: New Alert Creation and Management =====
    // Navigate back to folder and create new alert
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForLoadState('networkidle');

    const newAlertName = await pm.alertsPage.createAlert(streamName, column, value, createdDestinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(newAlertName);
    console.log('Successfully created new alert:', newAlertName);

    // Update the new alert's operator
    await pm.alertsPage.updateAlert(newAlertName);
    console.log('Successfully updated new alert:', newAlertName);

    // Clone the new alert
    await pm.alertsPage.cloneAlert(newAlertName, 'logs', streamName);
    console.log('Successfully cloned new alert:', newAlertName);

    // ===== Alert Pause and Resume =====
    // Pause the new alert
    await pm.alertsPage.pauseAlert(newAlertName);
    console.log('Successfully paused alert:', newAlertName);

    // Resume the new alert
    await pm.alertsPage.resumeAlert(newAlertName);
    console.log('Successfully resumed alert:', newAlertName);

    // ===== Alert Movement and Cleanup =====
    // Move alerts to target folder
    const targetFolderName = 'testfoldermove';
    await pm.alertsPage.ensureFolderExists(targetFolderName, 'Test Folder for Moving Alerts');
    await pm.alertsPage.moveAllAlertsToFolder(targetFolderName);
    await page.waitForLoadState('networkidle');

    await pm.dashboardFolder.searchFolder(folderName);
    await pm.dashboardFolder.verifyFolderVisible(folderName);
    await pm.dashboardFolder.deleteFolder(folderName);

    // Verify alerts in target folder
    await page.waitForLoadState('networkidle');
    await pm.dashboardFolder.searchFolder(targetFolderName);
    await pm.dashboardFolder.verifyFolderVisible(targetFolderName);
    await pm.alertsPage.navigateToFolder(targetFolderName);
    await page.waitForLoadState('networkidle');

    // Search and verify alert instance
    await pm.alertsPage.searchAlert(newAlertName);
    await pm.alertsPage.verifySearchResults(2);

    // Delete the alert
    await pm.alertsPage.deleteAlertByRow(newAlertName);
  });
}); 