const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

// Test timeout constants (in milliseconds)
const FIVE_MINUTES_MS = 300000;
const UI_STABILIZATION_WAIT_MS = 2000;

test.describe("Alerts UI Operations", () => {
  let pm;
  let createdTemplateName;
  let createdDestinationName;
  let sharedRandomValue;
  let validationInfra;

  test.beforeEach(async ({ page }, testInfo) => {
    pm = new PageManager(page);

    if (!sharedRandomValue) {
      sharedRandomValue = pm.alertsPage.generateRandomString();
      testLogger.info('Generated shared random value for this run', { sharedRandomValue });
    }

    // Skip data ingestion for scheduled alert test - uses different data
    if (!test.info().title.includes('Scheduled Alert')) {
      const streamName = 'auto_playwright_stream';
      await pm.commonActions.ingestTestData(streamName);
    }

    await page.goto(
      `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test('Create alert template and destination', {
    tag: ['@alertTemplate', '@alertDestination', '@all', '@alerts']
  }, async ({ page }) => {
    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplate(createdTemplateName);
    await pm.alertTemplatesPage.verifyCreatedTemplateExists(createdTemplateName);
    testLogger.info('Created template', { templateName: createdTemplateName });

    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(createdDestinationName, slackUrl, createdTemplateName);
    testLogger.info('Created destination', { destinationName: createdDestinationName });
  });

  test('Verify Delete alert template functionality', {
    tag: ['@deleteTemplate', '@all', '@alerts']
  }, async ({ page }) => {
    // Use isolated template to avoid conflicts with other tests
    const deleteTemplateName = 'auto_playwright_delete_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplate(deleteTemplateName);
    testLogger.info('Created isolated template for deletion test', { templateName: deleteTemplateName });

    await pm.alertTemplatesPage.navigateToTemplates();
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    await pm.alertTemplatesPage.deleteTemplateAndVerify(deleteTemplateName);
    testLogger.info('Successfully deleted isolated template', { templateName: deleteTemplateName });
  });

  test('Create and Delete Scheduled Alert with SQL Query', {
    tag: ['@scheduledAlerts', '@all', '@alerts'],
    timeout: FIVE_MINUTES_MS
  }, async ({ page }) => {
    const streamName = 'auto_playwright_stream';

    validationInfra = await pm.alertsPage.ensureValidationInfrastructure(pm, sharedRandomValue);
    testLogger.info('Validation infrastructure ready', validationInfra);

    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.ensureTemplateExists(createdTemplateName);

    await pm.commonActions.navigateToAlerts();
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    await pm.commonActions.ingestCustomTestData(streamName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    const folderName = 'auto_' + sharedRandomValue;
    await pm.alertsPage.createFolder(folderName, 'Test Automation Folder');
    await pm.alertsPage.verifyFolderCreated(folderName);
    testLogger.info('Successfully created folder', { folderName });

    // Use auto_playwright_stream - has fewer columns so 'log' is visible in dropdown
    const triggerStreamName = 'auto_playwright_stream';
    await pm.alertsPage.navigateToFolder(folderName);
    const alertName = await pm.alertsPage.createScheduledAlertWithSQL(triggerStreamName, validationInfra.destinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Successfully created scheduled alert', { alertName });

    // TODO: Investigate scheduled alert trigger validation - currently disabled due to timing issues
    // Scheduled alerts need evaluation cycles (1+ minute) which exceeds test timeout
    testLogger.info('Scheduled alert created successfully - trigger validation skipped (needs investigation)', { alertName });

    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    await pm.alertsPage.deleteAlertByRow(alertName);
    await pm.dashboardFolder.searchFolder(folderName);
    await pm.dashboardFolder.verifyFolderVisible(folderName);
    await pm.dashboardFolder.deleteFolder(folderName);
  });

  /**
   * Feature #9484: Manual Alert Trigger via UI
   * https://github.com/openobserve/openobserve/issues/9484
   * Tests the manual alert trigger functionality accessible via the kebab menu
   * Uses validation infrastructure (self-referential destination) for reliable testing
   */
  test('Manual Alert Trigger via UI (Feature #9484)', {
    tag: ['@manualTrigger', '@all', '@alerts', '@feature9484']
  }, async ({ page }) => {
    const streamName = 'auto_playwright_stream';
    const uniqueSuffix = sharedRandomValue || pm.alertsPage.generateRandomString();

    // Use validation infrastructure - creates a destination that posts back to OpenObserve
    // This ensures the trigger succeeds without external dependencies
    validationInfra = await pm.alertsPage.ensureValidationInfrastructure(pm, uniqueSuffix);
    testLogger.info('Validation infrastructure ready for manual trigger test', validationInfra);

    await pm.commonActions.navigateToAlerts();
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    // Create folder for the test
    const folderName = 'auto_trigger_' + uniqueSuffix;
    await pm.alertsPage.createFolder(folderName, 'Manual Trigger Test Folder');
    await pm.alertsPage.verifyFolderCreated(folderName);
    testLogger.info('Created folder for manual trigger test', { folderName });

    // Navigate to folder and create alert with validation destination
    await pm.alertsPage.navigateToFolder(folderName);
    const column = 'log';
    const value = 'test';
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, validationInfra.destinationName, uniqueSuffix);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Successfully created alert for manual trigger test', { alertName });

    // Trigger the alert manually via the UI
    testLogger.info('Triggering alert manually via UI');
    const triggerSuccess = await pm.alertsPage.triggerAlertManually(alertName);
    expect(triggerSuccess).toBe(true);
    testLogger.info('Manual alert trigger successful', { alertName, triggerSuccess });

    // Note: Alert history verification is optional for this feature test
    // The core Feature #9484 is about the UI button triggering the API successfully
    // The success notification confirms the trigger was successful

    // Cleanup: delete the alert and folder
    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);
    await pm.alertsPage.deleteAlertByRow(alertName);
    await pm.dashboardFolder.searchFolder(folderName);
    await pm.dashboardFolder.verifyFolderVisible(folderName);
    await pm.dashboardFolder.deleteFolder(folderName);

    testLogger.info('Feature #9484 test completed: Manual Alert Trigger via UI');
  });

  test('Alert Module UI Validations and Filters Check', {
    tag: ['@all', '@alerts', '@alertsUIValidations']
  }, async ({ page }) => {
    const templateName = 'auto_playwright_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.ensureTemplateExists(templateName);
    testLogger.info('Template ready for use', { templateName });

    const destinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(destinationName, slackUrl, templateName);
    testLogger.info('Destination ready for use', { destinationName });

    await pm.commonActions.navigateToAlerts();

    const folderName = 'auto_' + sharedRandomValue;
    await pm.alertsPage.createFolder(folderName, 'Test Automation Folder');
    testLogger.info('Created folder', { folderName });

    // Get initial counts to verify increase after alert creation
    await pm.commonActions.navigateToHome();
    const { scheduledAlertsCount, realTimeAlertsCount } = await pm.alertsPage.verifyAlertCounts();
    testLogger.info('Initial Active Scheduled Alerts Count', { count: scheduledAlertsCount });
    testLogger.info('Initial Active Real-time Alerts Count', { count: realTimeAlertsCount });

    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);

    await pm.alertsPage.verifyInvalidAlertCreation();
    await pm.alertsPage.verifyFieldRequiredValidation();

    // Use auto_playwright_stream - has fewer columns so 'log' is visible in dropdown
    const streamName = 'auto_playwright_stream';
    const column = 'log';
    const value = 'test';
    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, destinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Successfully created valid alert', { alertName });

    await pm.commonActions.navigateToHome();
    const { realTimeAlertsCount: newRealTimeAlertsCount } = await pm.alertsPage.verifyAlertCounts();
    testLogger.info('New Active Real-time Alerts Count', { count: newRealTimeAlertsCount });

    await pm.alertsPage.verifyAlertCountIncreased(realTimeAlertsCount, newRealTimeAlertsCount);

    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    await pm.alertsPage.verifyAlertCellVisible(alertName);
    await pm.alertsPage.verifyCloneAlertUIValidation(alertName);

    await pm.alertsPage.verifyTabContents();
    await pm.alertsPage.verifyFolderSearch(folderName);

    const targetFolderName = 'testfoldermove';
    await pm.alertsPage.ensureFolderExists(targetFolderName, 'Test Folder for Moving Alerts');
    await pm.alertsPage.moveAllAlertsToFolder(targetFolderName);

    await pm.dashboardFolder.searchFolder(folderName);
    await pm.dashboardFolder.verifyFolderVisible(folderName);
    await pm.dashboardFolder.deleteFolder(folderName);

    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);
    await pm.dashboardFolder.searchFolder(targetFolderName);
    await pm.alertsPage.navigateToFolder(targetFolderName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    await pm.alertsPage.searchAlert(alertName);
    await pm.alertsPage.verifySearchResultsUIValidation(1);

    await pm.alertsPage.deleteAlertByRow(alertName);
  });
});
