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

test.describe("Alerts UI Operations", () => {
  // Shared test variables
  let pageManager;
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
   * Test: Create alert template and destination
   * Prerequisites for other alert tests
   */
  test('Create alert template and destination', {
    tag: ['@alertTemplate', '@alertDestination', '@all', '@alerts']
  }, async ({ page }) => {
    // Create template with shared random value
    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
    await pageManager.alertTemplatesPage.createTemplate(createdTemplateName);
    await pageManager.alertTemplatesPage.verifyCreatedTemplateExists(createdTemplateName);
    console.log('Created template:', createdTemplateName);

    // Create destination with shared random value
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pageManager.alertDestinationsPage.ensureDestinationExists(createdDestinationName, slackUrl, createdTemplateName);
    console.log('Created destination:', createdDestinationName);
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
    await pageManager.alertTemplatesPage.ensureTemplateExists(createdTemplateName);

    // Navigate to templates page
    await pageManager.alertTemplatesPage.navigateToTemplates();
    await page.waitForTimeout(2000);

    // Test template deletion
    await pageManager.alertTemplatesPage.deleteTemplateAndVerify(createdTemplateName);
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
    await pageManager.alertTemplatesPage.ensureTemplateExists(createdTemplateName);
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pageManager.alertDestinationsPage.ensureDestinationExists(createdDestinationName, slackUrl, createdTemplateName);

    // Navigate to alerts tab
    await pageManager.commonActions.navigateToAlerts();
    await page.waitForTimeout(2000);

    // Ingest custom test data
    await pageManager.commonActions.ingestCustomTestData(streamName);
    await page.waitForTimeout(2000);

    // Create and verify scheduled alert
    const folderName = 'auto_' + sharedRandomValue;
    await pageManager.alertsPage.createFolder(folderName, 'Test Automation Folder');
    await pageManager.alertsPage.verifyFolderCreated(folderName);
    console.log('Successfully created folder:', folderName);

    await pageManager.alertsPage.navigateToFolder(folderName);
    const alertName = await pageManager.alertsPage.createScheduledAlertWithSQL(streamName, createdDestinationName, sharedRandomValue);
    await pageManager.alertsPage.verifyAlertCreated(alertName);
    console.log('Successfully created scheduled alert:', alertName);

    // Clean up
    await pageManager.alertsPage.deleteAlertByRow(alertName);
    await pageManager.dashboardFolder.searchFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toBeVisible();
    await pageManager.dashboardFolder.deleteFolder(folderName);
  });

  /**
   * Test: Alert Module UI Validations and Filters Check
   * Tests UI validations and filter functionality
   */
  test('Alert Module UI Validations and Filters Check', {
    tag: ['@all', '@alerts', '@alertsUIValidations']
  }, async ({ page }) => {
    // Create template
    const templateName = 'auto_playwright_template_' + sharedRandomValue;
    await pageManager.alertTemplatesPage.createTemplate(templateName);
    console.log('Created template:', templateName);

    // Create destination
    const destinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pageManager.alertDestinationsPage.ensureDestinationExists(destinationName, slackUrl, templateName);
    console.log('Created destination:', destinationName);

    // Navigate to alerts page
    await pageManager.commonActions.navigateToAlerts();

    // Create folder
    const folderName = 'auto_' + sharedRandomValue;
    await pageManager.alertsPage.createFolder(folderName, 'Test Automation Folder');
    console.log('Created folder:', folderName);

    // Get initial alert counts
    await pageManager.commonActions.navigateToHome();
    const { scheduledAlertsCount, realTimeAlertsCount } = await pageManager.alertsPage.verifyAlertCounts();
    console.log('Initial Active Scheduled Alerts Count:', scheduledAlertsCount);
    console.log('Initial Active Real-time Alerts Count:', realTimeAlertsCount);

    // Navigate to alerts and verify ui validations
    await pageManager.commonActions.navigateToAlerts();
    await pageManager.alertsPage.navigateToFolder(folderName);
    console.log('Navigated to folder:', folderName);

    // Verify invalid alert name validation
    await pageManager.alertsPage.verifyInvalidAlertCreation();

    // Verify field required validation
    await pageManager.alertsPage.verifyFieldRequiredValidation();

    // Create a valid alert using existing function
    const streamName = 'auto_playwright_stream';
    const column = 'job';
    const value = 'test';
    await pageManager.commonActions.navigateToAlerts();
    await pageManager.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(2000);
    const alertName = await pageManager.alertsPage.createAlert(streamName, column, value, destinationName, sharedRandomValue);
    await pageManager.alertsPage.verifyAlertCreated(alertName);
    console.log('Successfully created valid alert:', alertName);
    await page.waitForTimeout(2000); // Add delay after alert creation

    // Navigate back to home and verify alert count increased
    await pageManager.commonActions.navigateToHome();
    const { realTimeAlertsCount: newRealTimeAlertsCount } = await pageManager.alertsPage.verifyAlertCounts();
    console.log('New Active Real-time Alerts Count:', newRealTimeAlertsCount);
    
    // Verify count increased by 1
    await pageManager.alertsPage.verifyAlertCountIncreased(realTimeAlertsCount, newRealTimeAlertsCount);

    // Navigate back to alerts and verify clone validation
    await pageManager.commonActions.navigateToAlerts();
    await pageManager.alertsPage.navigateToFolder(folderName);
    console.log('Navigated back to folder:', folderName);
    await page.waitForTimeout(2000);

    // Verify alert is visible before clone validation
    await expect(page.getByRole('cell', { name: alertName })).toBeVisible({ timeout: 10000 });
    console.log('Alert is visible before clone validation:', alertName);

    // Now verify clone validation
    await pageManager.alertsPage.verifyCloneAlertUIValidation(alertName);

    // Continue with rest of the test...
    await pageManager.alertsPage.verifyTabContents();
    await pageManager.alertsPage.verifyFolderSearch(folderName);

    // Move alerts to target folder
    const targetFolderName = 'testfoldermove';
    await pageManager.alertsPage.ensureFolderExists(targetFolderName, 'Test Folder for Moving Alerts');
    await pageManager.alertsPage.moveAllAlertsToFolder(targetFolderName);

    await pageManager.dashboardFolder.searchFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toBeVisible();
    await pageManager.dashboardFolder.deleteFolder(folderName);

    // Verify alerts in target folder
    await page.waitForTimeout(2000);
    await pageManager.dashboardFolder.searchFolder(targetFolderName);
    await pageManager.alertsPage.navigateToFolder(targetFolderName);
    await page.waitForTimeout(2000);

    // Search and verify alert instance
    await pageManager.alertsPage.searchAlert(alertName);
    await pageManager.alertsPage.verifySearchResultsUIValidation(1);

    // Delete the alert
    await pageManager.alertsPage.deleteAlertByRow(alertName);
  });
}); 