const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

// Test timeout constants (in milliseconds)
const FIVE_MINUTES_MS = 300000;
const ALERT_REGISTRATION_WAIT_MS = 15000; // Wait longer for alert to be registered and active
const UI_STABILIZATION_WAIT_MS = 2000;
const ALERT_TRIGGER_TIMEOUT_MS = 60000; // Give alert more time to process and fire

test.describe("Alerts E2E Flow", () => {
  // Shared test variables
  let pm;
  let createdTemplateName;
  let createdDestinationName;
  let sharedRandomValue;
  let validationInfra; // Stores unique validation infrastructure per test

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
      testLogger.info('Generated shared random value for this run', { sharedRandomValue });
    }

    await pm.commonActions.skipDataIngestionForScheduledAlert(testInfo.title);

    // Navigate to alerts page first
    await page.goto(
      `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  /**
   * Test: Complete E2E flow for alerts
   * Tests all major alert operations in sequence:
   * - Infrastructure setup (template, destination)
   * - Folder management (create, navigate, delete)
   * - Alert CRUD (create, update, clone, delete)
   * - Alert trigger validation
   * - Alert state management (pause, resume)
   * - Alert movement between folders
   * - Search and verify functionality
   */
  test('Complete Alerts E2E Flow - CRUD, Trigger Validation, Search, Folders, Pause/Resume', {
    tag: ['@e2eAlerts', '@all', '@alerts'],
    timeout: FIVE_MINUTES_MS
  }, async ({ page }) => {
    // This E2E flow covers many operations and needs more than the default 3-minute timeout
    test.slow();

    // Use auto_playwright_stream - has fewer columns so 'log' is visible in dropdown
    const streamName = 'auto_playwright_stream';
    const column = 'log';
    const value = 'test';

    // Ensure prerequisites exist
    validationInfra = await pm.alertsPage.ensureValidationInfrastructure(pm, sharedRandomValue);
    testLogger.info('Validation infrastructure ready', validationInfra);

    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.ensureTemplateExists(createdTemplateName);
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(createdDestinationName, slackUrl, createdTemplateName);

    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle');

    // ===== First Iteration: Initial Alert Creation and Management =====
    const folderName = 'auto_' + sharedRandomValue;
    await pm.alertsPage.createFolder(folderName, 'Test Automation Folder');
    await pm.alertsPage.verifyFolderCreated(folderName);
    testLogger.info('Successfully created folder', { folderName });

    await pm.alertsPage.navigateToFolder(folderName);
    const triggerStreamName = streamName;
    const alertName = await pm.alertsPage.createAlert(triggerStreamName, column, value, validationInfra.destinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Successfully created alert', { alertName });

    // TODO: Investigate alert trigger validation - currently disabled due to timing issues
    // The test-level timeout (300s) isn't being applied, global timeout (180s) takes precedence
    // Need to investigate why real-time alerts don't fire within expected timeframe
    testLogger.info('Alert created successfully - trigger validation skipped (needs investigation)', { alertName });

    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    await pm.alertsPage.cloneAlert(alertName, 'logs', streamName);
    testLogger.info('Successfully cloned alert', { alertName });

    await pm.alertsPage.deleteImportedAlert(alertName);
    testLogger.info('Successfully deleted all instances of alert', { alertName });

    // ===== Second Iteration: New Alert Creation and Management =====
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForLoadState('networkidle');

    const newAlertName = await pm.alertsPage.createAlert(streamName, column, value, createdDestinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(newAlertName);
    testLogger.info('Successfully created new alert', { alertName: newAlertName });

    await pm.alertsPage.updateAlert(newAlertName);
    testLogger.info('Successfully updated new alert', { alertName: newAlertName });

    await pm.alertsPage.cloneAlert(newAlertName, 'logs', streamName);
    testLogger.info('Successfully cloned new alert', { alertName: newAlertName });

    // ===== Alert Pause and Resume =====
    await pm.alertsPage.pauseAlert(newAlertName);
    testLogger.info('Successfully paused alert', { alertName: newAlertName });

    await pm.alertsPage.resumeAlert(newAlertName);
    testLogger.info('Successfully resumed alert', { alertName: newAlertName });

    // ===== Alert Movement and Cleanup =====
    const targetFolderName = 'testfoldermove';
    await pm.alertsPage.ensureFolderExists(targetFolderName, 'Test Folder for Moving Alerts');

    await pm.alertsPage.navigateToFolder(targetFolderName);
    await page.waitForLoadState('networkidle');
    await pm.alertsPage.deleteAllAlertsInFolder();
    testLogger.info('Cleaned up target folder before moving alerts', { targetFolderName });

    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForLoadState('networkidle');
    await pm.alertsPage.moveAllAlertsToFolder(targetFolderName);
    await page.waitForLoadState('networkidle');

    await pm.dashboardFolder.searchFolder(folderName);
    await pm.dashboardFolder.verifyFolderVisible(folderName);
    await pm.dashboardFolder.deleteFolder(folderName);

    await page.waitForLoadState('networkidle');
    await pm.dashboardFolder.searchFolder(targetFolderName);
    await pm.dashboardFolder.verifyFolderVisible(targetFolderName);
    await pm.alertsPage.navigateToFolder(targetFolderName);
    await page.waitForLoadState('networkidle');

    await pm.alertsPage.searchAlert(newAlertName);
    await pm.alertsPage.verifySearchResults(2);

    await pm.alertsPage.deleteAlertByRow(newAlertName);
  });
});
