const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe("Alerts UI Operations", () => {
  // Shared test variables
  let pm;
  let createdTemplateName;
  let createdDestinationName;
  let sharedRandomValue;

  /**
   * Setup for each test
   * - Logs in
   * - Initializes page objects
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

    // Skip data ingestion for scheduled alert test
    if (!test.info().title.includes('Scheduled Alert')) {
      // Ingest test data using common actions
      const streamName = 'auto_playwright_stream';
      await pm.commonActions.ingestTestData(streamName);
    }
    
    // Navigate to alerts page
    await page.goto(
      `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  /**
   * Test: Create alert template and destination
   * Prerequisites for other alert tests
   */
  test('Create alert template and destination', {
    tag: ['@alertTemplate', '@alertDestination', '@all', '@alerts']
  }, async ({ page }) => {
    // Create template with shared random value
    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplate(createdTemplateName);
    await pm.alertTemplatesPage.verifyCreatedTemplateExists(createdTemplateName);
    testLogger.info('Created template', { templateName: createdTemplateName });

    // Create destination with shared random value
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(createdDestinationName, slackUrl, createdTemplateName);
    testLogger.info('Created destination', { destinationName: createdDestinationName });
  });

  /**
   * Test: Delete alert template functionality
   * Verifies template deletion and in-use scenarios
   */
  test('Verify Delete alert template functionality', {
    tag: ['@deleteTemplate', '@all', '@alerts']
  }, async ({ page }) => {
    // Ensure template exists
    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.ensureTemplateExists(createdTemplateName);

    // Navigate to templates page
    await pm.alertTemplatesPage.navigateToTemplates();
    await page.waitForTimeout(2000);

    // Test template deletion
    await pm.alertTemplatesPage.deleteTemplateAndVerify(createdTemplateName);
  });

  /**
   * Test: Scheduled Alert with SQL Query
   * Tests creation and deletion of scheduled alerts
   */
  test('Create and Delete Scheduled Alert with SQL Query', {
    tag: ['@scheduledAlerts', '@all', '@alerts']
  }, async ({ page }) => {
    const streamName = 'auto_playwright_stream';

    // Ensure prerequisites exist
    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.ensureTemplateExists(createdTemplateName);
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(createdDestinationName, slackUrl, createdTemplateName);

    // Navigate to alerts tab
    await pm.commonActions.navigateToAlerts();
    await page.waitForTimeout(2000);

    // Ingest custom test data
    await pm.commonActions.ingestCustomTestData(streamName);
    await page.waitForTimeout(2000);

    // Create and verify scheduled alert
    const folderName = 'auto_' + sharedRandomValue;
    await pm.alertsPage.createFolder(folderName, 'Test Automation Folder');
    await pm.alertsPage.verifyFolderCreated(folderName);
    testLogger.info('Successfully created folder', { folderName });

    await pm.alertsPage.navigateToFolder(folderName);
    const alertName = await pm.alertsPage.createScheduledAlertWithSQL(streamName, createdDestinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Successfully created scheduled alert', { alertName });

    // Clean up
    await pm.alertsPage.deleteAlertByRow(alertName);
    await pm.dashboardFolder.searchFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toBeVisible();
    await pm.dashboardFolder.deleteFolder(folderName);
  });

  /**
   * Test: Alert Module UI Validations and Filters Check
   * Tests UI validations and filter functionality
   */
  test.skip('Alert Module UI Validations and Filters Check', {
    tag: ['@all', '@alerts', '@alertsUIValidations']
  }, async ({ page }) => {
    // Create template
    const templateName = 'auto_playwright_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplate(templateName);
    testLogger.info('Created template', { templateName });

    // Create destination
    const destinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(destinationName, slackUrl, templateName);
    testLogger.info('Created destination', { destinationName });

    // Navigate to alerts page
    await pm.commonActions.navigateToAlerts();

    // Create folder
    const folderName = 'auto_' + sharedRandomValue;
    await pm.alertsPage.createFolder(folderName, 'Test Automation Folder');
    testLogger.info('Created folder', { folderName });

    // Get initial alert counts
    await pm.commonActions.navigateToHome();
    const { scheduledAlertsCount, realTimeAlertsCount } = await pm.alertsPage.verifyAlertCounts();
    testLogger.info('Initial Active Scheduled Alerts Count', { count: scheduledAlertsCount });
    testLogger.info('Initial Active Real-time Alerts Count', { count: realTimeAlertsCount });

    // Navigate to alerts and verify ui validations
    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);
    testLogger.info('Navigated to folder', { folderName });

    // Verify invalid alert name validation
    await pm.alertsPage.verifyInvalidAlertCreation();

    // Verify field required validation
    await pm.alertsPage.verifyFieldRequiredValidation();

    // Create a valid alert using existing function
    const streamName = 'auto_playwright_stream';
    const column = 'job';
    const value = 'test';
    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(2000);
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, destinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Successfully created valid alert', { alertName });
    await page.waitForTimeout(2000); // Add delay after alert creation

    // Navigate back to home and verify alert count increased
    await pm.commonActions.navigateToHome();
    const { realTimeAlertsCount: newRealTimeAlertsCount } = await pm.alertsPage.verifyAlertCounts();
    testLogger.info('New Active Real-time Alerts Count', { count: newRealTimeAlertsCount });
    
    // Verify count increased by 1
    await pm.alertsPage.verifyAlertCountIncreased(realTimeAlertsCount, newRealTimeAlertsCount);

    // Navigate back to alerts and verify clone validation
    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);
    testLogger.info('Navigated back to folder', { folderName });
    await page.waitForTimeout(2000);

    // Verify alert is visible before clone validation
    await expect(page.getByRole('cell', { name: alertName })).toBeVisible({ timeout: 10000 });
    testLogger.info('Alert is visible before clone validation', { alertName });

    // Now verify clone validation
    await pm.alertsPage.verifyCloneAlertUIValidation(alertName);

    // Continue with rest of the test...
    await pm.alertsPage.verifyTabContents();
    await pm.alertsPage.verifyFolderSearch(folderName);

    // Move alerts to target folder
    const targetFolderName = 'testfoldermove';
    await pm.alertsPage.ensureFolderExists(targetFolderName, 'Test Folder for Moving Alerts');
    await pm.alertsPage.moveAllAlertsToFolder(targetFolderName);

    await pm.dashboardFolder.searchFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toBeVisible();
    await pm.dashboardFolder.deleteFolder(folderName);

    // Verify alerts in target folder
    await page.waitForTimeout(2000);
    await pm.dashboardFolder.searchFolder(targetFolderName);
    await pm.alertsPage.navigateToFolder(targetFolderName);
    await page.waitForTimeout(2000);

    // Search and verify alert instance
    await pm.alertsPage.searchAlert(alertName);
    await pm.alertsPage.verifySearchResultsUIValidation(1);

    // Delete the alert
    await pm.alertsPage.deleteAlertByRow(alertName);
  });
}); 