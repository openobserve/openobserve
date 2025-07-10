import { test, expect } from "../baseFixtures";
import logData from "../../cypress/fixtures/log.json";
import { AlertsPage } from '../../pages/alertsPages/alertsPage.js';
import { AlertTemplatesPage } from '../../pages/alertsPages/alertTemplatesPage.js';
import { AlertDestinationsPage } from '../../pages/alertsPages/alertDestinationsPage.js';
import { CommonActions } from '../../pages/commonActions.js';
import DashboardFolder from '../../pages/dashboardPages/dashboard-folder.js';

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
  let alertsPage;
  let templatesPage;
  let destinationsPage;
  let commonActions;
  let createdTemplateName;
  let createdDestinationName;
  let sharedRandomValue;
  let dashboardFolders;

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

  /**
   * Test: Create alert template and destination
   * Prerequisites for other alert tests
   */
  test('Create alert template and destination', {
    tag: ['@alertTemplate', '@alertDestination', '@all', '@alerts']
  }, async ({ page }) => {
    // Create template with shared random value
    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
    await templatesPage.createTemplate(createdTemplateName);
    await templatesPage.verifyCreatedTemplateExists(createdTemplateName);
    console.log('Created template:', createdTemplateName);

    // Create destination with shared random value
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await destinationsPage.ensureDestinationExists(createdDestinationName, slackUrl, createdTemplateName);
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
    await templatesPage.ensureTemplateExists(createdTemplateName);

    // Navigate to templates page
    await templatesPage.navigateToTemplates();
    await page.waitForTimeout(2000);

    // Test template deletion
    await templatesPage.deleteTemplateAndVerify(createdTemplateName);
  });

  /**
   * Test: Scheduled Alert with SQL Query
   * Tests creation and deletion of scheduled alerts
   */
  test('Create and Delete Scheduled Alert with SQL Query', {
    tag: ['@scheduledAlerts', '@all', '@alerts']
  }, async ({ page }) => {
    dashboardFolders = new DashboardFolder(page);
    const streamName = 'auto_playwright_stream';

    // Ensure prerequisites exist
    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
    await templatesPage.ensureTemplateExists(createdTemplateName);
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await destinationsPage.ensureDestinationExists(createdDestinationName, slackUrl, createdTemplateName);

    // Navigate to alerts tab
    await commonActions.navigateToAlerts();
    await page.waitForTimeout(2000);

    // Ingest custom test data
    await commonActions.ingestCustomTestData(streamName);
    await page.waitForTimeout(2000);

    // Create and verify scheduled alert
    const folderName = 'auto_' + sharedRandomValue;
    await alertsPage.createFolder(folderName, 'Test Automation Folder');
    await alertsPage.verifyFolderCreated(folderName);
    console.log('Successfully created folder:', folderName);

    await alertsPage.navigateToFolder(folderName);
    const alertName = await alertsPage.createScheduledAlertWithSQL(streamName, createdDestinationName, sharedRandomValue);
    await alertsPage.verifyAlertCreated(alertName);
    console.log('Successfully created scheduled alert:', alertName);

    // Clean up
    await alertsPage.deleteAlertByRow(alertName);
    await dashboardFolders.searchFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toBeVisible();
    await dashboardFolders.deleteFolder(folderName);
  });

  /**
   * Test: Alert Module UI Validations and Filters Check
   * Tests UI validations and filter functionality
   */
  test('Alert Module UI Validations and Filters Check', {
    tag: ['@all', '@alerts', '@alertsUIValidations']
  }, async ({ page }) => {
    // Initialize page objects
    alertsPage = new AlertsPage(page);
    templatesPage = new AlertTemplatesPage(page);
    destinationsPage = new AlertDestinationsPage(page);
    commonActions = new CommonActions(page);
    dashboardFolders = new DashboardFolder(page);

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

    // Get initial alert counts
    await commonActions.navigateToHome();
    const { scheduledAlertsCount, realTimeAlertsCount } = await alertsPage.verifyAlertCounts();
    console.log('Initial Active Scheduled Alerts Count:', scheduledAlertsCount);
    console.log('Initial Active Real-time Alerts Count:', realTimeAlertsCount);

    // Navigate to alerts and verify ui validations
    await commonActions.navigateToAlerts();
    await alertsPage.navigateToFolder(folderName);
    console.log('Navigated to folder:', folderName);

    // Verify invalid alert name validation
    await alertsPage.verifyInvalidAlertCreation();

    // Verify field required validation
    await alertsPage.verifyFieldRequiredValidation();

    // Create a valid alert using existing function
    const streamName = 'auto_playwright_stream';
    const column = 'job';
    const value = 'test';
    await commonActions.navigateToAlerts();
    await alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(2000);
    const alertName = await alertsPage.createAlert(streamName, column, value, destinationName, sharedRandomValue);
    await alertsPage.verifyAlertCreated(alertName);
    console.log('Successfully created valid alert:', alertName);
    await page.waitForTimeout(2000); // Add delay after alert creation

    // Navigate back to home and verify alert count increased
    await commonActions.navigateToHome();
    const { realTimeAlertsCount: newRealTimeAlertsCount } = await alertsPage.verifyAlertCounts();
    console.log('New Active Real-time Alerts Count:', newRealTimeAlertsCount);
    
    // Verify count increased by 1
    await alertsPage.verifyAlertCountIncreased(realTimeAlertsCount, newRealTimeAlertsCount);

    // Navigate back to alerts and verify clone validation
    await commonActions.navigateToAlerts();
    await alertsPage.navigateToFolder(folderName);
    console.log('Navigated back to folder:', folderName);
    await page.waitForTimeout(2000);

    // Verify alert is visible before clone validation
    await expect(page.getByRole('cell', { name: alertName })).toBeVisible({ timeout: 10000 });
    console.log('Alert is visible before clone validation:', alertName);

    // Now verify clone validation
    await alertsPage.verifyCloneAlertUIValidation(alertName);

    // Continue with rest of the test...
    await alertsPage.verifyTabContents();
    await alertsPage.verifyFolderSearch(folderName);

    // Move alerts to target folder
    const targetFolderName = 'testfoldermove';
    await alertsPage.ensureFolderExists(targetFolderName, 'Test Folder for Moving Alerts');
    await alertsPage.moveAllAlertsToFolder(targetFolderName);

    await dashboardFolders.searchFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toBeVisible();
    await dashboardFolders.deleteFolder(folderName);

    // Verify alerts in target folder
    await page.waitForTimeout(2000);
    await dashboardFolders.searchFolder(targetFolderName);
    await alertsPage.navigateToFolder(targetFolderName);
    await page.waitForTimeout(2000);

    // Search and verify alert instance
    await alertsPage.searchAlert(alertName);
    await alertsPage.verifySearchResultsUIValidation(1);

    // Delete the alert
    await alertsPage.deleteAlertByRow(alertName);
  });
}); 