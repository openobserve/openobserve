const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// Test timeout constants (in milliseconds)
const FIVE_MINUTES_MS = 300000;
const THREE_MINUTES_MS = 180000;
const UI_STABILIZATION_WAIT_MS = 2000;

// ============================================================================
// Alerts UI Operations — each test is self-contained with its own suffix
// ============================================================================

test.describe("Alerts UI Operations", () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);

    // Navigate to base URL
    await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
  });

  /**
   * Test: Create alert template and destination
   * Self-contained: generates its own random suffix for resource names
   */
  test('Create alert template and destination', {
    tag: ['@alertTemplate', '@alertDestination', '@all', '@alerts'],
    timeout: THREE_MINUTES_MS
  }, async ({ page }) => {
    const suffix = pm.alertsPage.generateRandomString();

    const templateName = 'auto_playwright_template_' + suffix;
    await pm.alertTemplatesPage.createTemplate(templateName);
    await pm.alertTemplatesPage.verifyCreatedTemplateExists(templateName);
    testLogger.info('Created template', { templateName });

    const destinationName = 'auto_playwright_destination_' + suffix;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(destinationName, slackUrl, templateName);
    testLogger.info('Created destination', { destinationName });
  });

  /**
   * Test: Verify Delete alert template functionality
   * Self-contained: creates its own template name for isolated deletion
   */
  test('Verify Delete alert template functionality', {
    tag: ['@deleteTemplate', '@all', '@alerts'],
    timeout: THREE_MINUTES_MS
  }, async ({ page }) => {
    const suffix = pm.alertsPage.generateRandomString();

    const deleteTemplateName = 'auto_playwright_delete_template_' + suffix;
    await pm.alertTemplatesPage.createTemplate(deleteTemplateName);
    testLogger.info('Created isolated template for deletion test', { templateName: deleteTemplateName });

    await pm.alertTemplatesPage.navigateToTemplates();
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    await pm.alertTemplatesPage.deleteTemplateAndVerify(deleteTemplateName);
    testLogger.info('Successfully deleted isolated template', { templateName: deleteTemplateName });
  });

  /**
   * Test: Create and Delete Scheduled Alert with SQL Query
   * Self-contained: generates its own suffix and creates its own resources
   */
  test('Create and Delete Scheduled Alert with SQL Query', {
    tag: ['@scheduledAlerts', '@all', '@alerts'],
    timeout: FIVE_MINUTES_MS
  }, async ({ page }) => {
    const suffix = pm.alertsPage.generateRandomString();
    const streamName = 'auto_playwright_stream';

    // Ingest test data for the stream
    await pm.commonActions.ingestTestData(streamName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    // Create validation infrastructure with unique names
    const validationInfra = await pm.alertsPage.ensureValidationInfrastructure(pm, suffix);
    testLogger.info('Validation infrastructure ready', validationInfra);

    // Ensure template exists
    const templateName = 'auto_playwright_template_' + suffix;
    await pm.alertTemplatesPage.ensureTemplateExists(templateName);

    await pm.commonActions.navigateToAlerts();
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    // Ingest custom test data for better query results
    await pm.commonActions.ingestCustomTestData(streamName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    // Create folder
    const folderName = 'auto_' + suffix;
    await pm.alertsPage.createFolder(folderName, 'Test Automation Folder');
    await pm.alertsPage.verifyFolderCreated(folderName);
    testLogger.info('Successfully created folder', { folderName });

    // Create scheduled alert with SQL
    await pm.alertsPage.navigateToFolder(folderName);
    const alertName = await pm.alertsPage.createScheduledAlertWithSQL(streamName, validationInfra.destinationName, suffix);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Successfully created scheduled alert', { alertName });

    // Scheduled alert trigger validation skipped — needs evaluation cycles exceeding test timeout
    testLogger.info('Scheduled alert created successfully', { alertName });

    // Cleanup
    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    await pm.alertsPage.deleteAlertByRow(alertName);
    await pm.dashboardFolder.searchFolder(folderName);
    await pm.dashboardFolder.verifyFolderVisible(folderName);
    await pm.dashboardFolder.deleteFolder(folderName);

    testLogger.info('Scheduled alert test complete — created, verified, and cleaned up');
  });

  /**
   * Feature #9484: Manual Alert Trigger via UI
   * Self-contained: generates its own suffix and creates its own resources
   */
  test('Manual Alert Trigger via UI (Feature #9484)', {
    tag: ['@manualTrigger', '@all', '@alerts', '@feature9484'],
    timeout: THREE_MINUTES_MS
  }, async ({ page }) => {
    const suffix = pm.alertsPage.generateRandomString();
    const streamName = 'auto_playwright_stream';

    // Ensure stream has data
    await pm.commonActions.ingestTestData(streamName);

    // Create validation infrastructure with unique names
    const validationInfra = await pm.alertsPage.ensureValidationInfrastructure(pm, suffix);
    testLogger.info('Validation infrastructure ready for manual trigger test', validationInfra);

    await pm.commonActions.navigateToAlerts();
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    // Create folder for the test
    const folderName = 'auto_trigger_' + suffix;
    await pm.alertsPage.createFolder(folderName, 'Manual Trigger Test Folder');
    await pm.alertsPage.verifyFolderCreated(folderName);
    testLogger.info('Created folder for manual trigger test', { folderName });

    // Navigate to folder and create alert with validation destination
    await pm.alertsPage.navigateToFolder(folderName);
    const column = 'log';
    const value = 'test';
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, validationInfra.destinationName, suffix);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Successfully created alert for manual trigger test', { alertName });

    // Trigger the alert manually via the UI
    testLogger.info('Triggering alert manually via UI');
    const triggerSuccess = await pm.alertsPage.triggerAlertManually(alertName);
    expect(triggerSuccess).toBe(true);
    testLogger.info('Manual alert trigger successful', { alertName });

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

  /**
   * Test: Alert Module UI Validations and Filters Check
   * Self-contained: generates its own suffix and creates its own resources
   */
  test('Alert Module UI Validations and Filters Check', {
    tag: ['@all', '@alerts', '@alertsUIValidations'],
    timeout: FIVE_MINUTES_MS
  }, async ({ page }) => {
    const suffix = pm.alertsPage.generateRandomString();
    const streamName = 'auto_playwright_stream';

    // Ensure stream has data
    await pm.commonActions.ingestTestData(streamName);

    // Create template and destination
    const templateName = 'auto_playwright_template_' + suffix;
    await pm.alertTemplatesPage.ensureTemplateExists(templateName);
    testLogger.info('Template ready for use', { templateName });

    const destinationName = 'auto_playwright_destination_' + suffix;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(destinationName, slackUrl, templateName);
    testLogger.info('Destination ready for use', { destinationName });

    await pm.commonActions.navigateToAlerts();

    // Create folder
    const folderName = 'auto_' + suffix;
    await pm.alertsPage.createFolder(folderName, 'Test Automation Folder');
    testLogger.info('Created folder', { folderName });

    // Get initial counts to verify increase after alert creation
    await pm.commonActions.navigateToHome();
    const { scheduledAlertsCount, realTimeAlertsCount } = await pm.alertsPage.verifyAlertCounts();
    testLogger.info('Initial counts', { scheduledAlertsCount, realTimeAlertsCount });

    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);

    // Test validation UI
    await pm.alertsPage.verifyInvalidAlertCreation();
    await pm.alertsPage.verifyFieldRequiredValidation();

    // Create a valid alert
    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);
    const column = 'log';
    const value = 'test';
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, destinationName, suffix);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Successfully created valid alert', { alertName });

    // Verify alert count increased
    await pm.commonActions.navigateToHome();
    const { realTimeAlertsCount: newRealTimeAlertsCount } = await pm.alertsPage.verifyAlertCounts();
    testLogger.info('New real-time alerts count', { count: newRealTimeAlertsCount });
    await pm.alertsPage.verifyAlertCountIncreased(realTimeAlertsCount, newRealTimeAlertsCount);

    // Navigate back and verify alert
    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    await pm.alertsPage.verifyAlertCellVisible(alertName);
    await pm.alertsPage.verifyCloneAlertUIValidation(alertName);
    await pm.alertsPage.verifyTabContents();
    await pm.alertsPage.verifyFolderSearch(folderName);

    // Move alert to target folder
    const targetFolderName = 'testfoldermove';
    await pm.alertsPage.ensureFolderExists(targetFolderName, 'Test Folder for Moving Alerts');
    // Navigate back to source folder — ensureFolderExists may navigate away via createFolder
    await pm.alertsPage.navigateToFolder(folderName);
    await pm.alertsPage.moveAllAlertsToFolder(targetFolderName);

    // Verify in target folder
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

    testLogger.info('UI Validations test complete');
  });
});

// ============================================================================
// Alerts & Incidents Page Navigation Tests
// ============================================================================

test.describe("Alerts & Incidents Page Navigation", { tag: '@enterprise' }, () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate directly to alerts page
        await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
        testLogger.info('Navigated to alerts page');

        // Wait for any loading overlays to disappear
        await pm.alertsPage.waitForLoadingOverlayToDisappear();

        // Wait for alert list page to be ready
        await pm.alertsPage.waitForAlertListPageReady();

        // Check config API for enterprise feature flag (service_graph_enabled)
        let isEnterprise = false;
        try {
            const configResp = await page.waitForResponse(
                response => response.url().includes('/config') && response.status() === 200,
                { timeout: 10000 }
            );
            const configBody = await configResp.json();
            isEnterprise = configBody?.service_graph_enabled === true;
        } catch {
            const incidentsMenu = page.locator(pm.alertsPage.locators.incidentsMenuItem);
            isEnterprise = await incidentsMenu.isVisible({ timeout: 5000 }).catch(() => false);
        }

        if (!isEnterprise) {
            test.skip(true, 'service_graph_enabled is false — enterprise feature, skipping on OSS');
        }
        testLogger.info('Alert page loaded successfully (enterprise features enabled)');
    });

    test("Page navigation and UI validation - Alerts and Incidents", {
        tag: ['@alertsPageNav', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Verify Alerts page on load ===');

        await pm.alertsPage.expectSidebarMenuItemsVisible();
        testLogger.info('Sidebar menu items visible');

        await pm.alertsPage.expectAlertListTableVisible();
        await pm.alertsPage.expectSearchAcrossFoldersToggleVisible();
        await pm.alertsPage.expectImportButtonVisible();
        await pm.alertsPage.expectAddAlertButtonVisible();
        await pm.alertsPage.expectAlertListSplitterVisible();
        testLogger.info('All Alerts page elements visible');

        await pm.alertsPage.expectIncidentsOnlyElementsHidden();
        testLogger.info('Incidents elements hidden on Alerts page');

        testLogger.info('=== PHASE 2: Navigate to Incidents page ===');

        await pm.alertsPage.navigateToIncidentsPage();
        await pm.alertsPage.expectIncidentsViewElementsVisible();
        testLogger.info('Incidents page elements visible');

        await pm.alertsPage.expectAlertsOnlyElementsHidden();
        testLogger.info('Alerts elements hidden on Incidents page');

        testLogger.info('=== PHASE 3: Navigate back to Alerts page ===');

        await pm.alertsPage.navigateToAlertsPage();
        await pm.alertsPage.expectAlertsViewElementsVisible();
        testLogger.info('Alerts page elements restored');

        await pm.alertsPage.expectSearchAcrossFoldersToggleVisible();
        testLogger.info('Toggle visible on Alerts page');

        await pm.alertsPage.expectImportButtonVisible();
        await pm.alertsPage.expectAddAlertButtonVisible();
        testLogger.info('Import and Add buttons visible on Alerts page');

        await pm.alertsPage.expectIncidentsOnlyElementsHidden();
        testLogger.info('Incidents elements hidden again');

        testLogger.info('=== Page navigation UI validation COMPLETE ===');
    });

    test("Search functionality works in both pages", {
        tag: ['@alertsPageNav', '@functional', '@P1', '@all', '@search']
    }, async ({ page }) => {
        const searchQuery = 'test';

        testLogger.info('=== PHASE 1: Search on Alerts page ===');

        await pm.alertsPage.typeInAlertSearchInput(searchQuery);
        await pm.alertsPage.expectAlertSearchInputFocused();
        await pm.alertsPage.expectAlertListTableVisible();
        testLogger.info('Search on Alerts page works');

        testLogger.info('=== PHASE 2: Search on Incidents page ===');

        await pm.alertsPage.navigateToIncidentsPage();
        await pm.alertsPage.searchInIncidentsView(searchQuery);
        await pm.alertsPage.expectIncidentSearchInputValue(searchQuery);
        await pm.alertsPage.expectIncidentListTableVisible();
        testLogger.info('Search on Incidents page works');

        testLogger.info('=== Search functionality COMPLETE ===');
    });

    test("Edge cases - empty states and page refresh", {
        tag: ['@alertsPageNav', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Empty Alerts state ===');

        await pm.alertsPage.expectAlertListTableVisible();
        await pm.alertsPage.expectSidebarMenuItemsVisible();
        await pm.alertsPage.expectAddAlertButtonVisible();
        testLogger.info('Empty alerts state handled correctly');

        testLogger.info('=== PHASE 2: Empty Incidents state ===');

        await pm.alertsPage.navigateToIncidentsPage();
        await pm.alertsPage.expectIncidentListTableVisible();
        testLogger.info('Empty incidents state handled correctly');

        testLogger.info('=== PHASE 3: Page refresh preserves page ===');

        await pm.alertsPage.expectIncidentsViewElementsVisible();
        const incidentsUrl = page.url();
        testLogger.info(`Incidents URL: ${incidentsUrl}`);

        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        testLogger.info('Page refreshed');

        await pm.alertsPage.waitForLoadingOverlayToDisappear();
        await pm.alertsPage.waitForIncidentsToLoad();

        await pm.alertsPage.expectIncidentsViewElementsVisible();
        await pm.alertsPage.expectAlertsOnlyElementsHidden();
        testLogger.info('Incidents page preserved after refresh');

        await pm.alertsPage.navigateToAlertsPage();
        await pm.alertsPage.expectAlertsViewElementsVisible();
        testLogger.info('Can navigate to Alerts after refresh');

        testLogger.info('=== Edge cases COMPLETE ===');
    });
});
