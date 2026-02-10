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

// ============================================================================
// Alerts & Incidents Page Navigation Tests
// ============================================================================

const { navigateToBase } = require('../utils/enhanced-baseFixtures.js');

test.describe("Alerts & Incidents Page Navigation", { tag: '@enterprise' }, () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate directly to alerts page
        await page.goto(`${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
        testLogger.info('Navigated to alerts page');

        // Wait for any loading overlays to disappear
        await pm.alertsPage.waitForLoadingOverlayToDisappear();

        // Wait for alert list page to be ready
        await pm.alertsPage.waitForAlertListPageReady();

        // Wait for config API to complete - incidents menu depends on service_graph_enabled
        await page.waitForResponse(
            response => response.url().includes('/config') && response.status() === 200,
            { timeout: 10000 }
        ).catch(() => {}); // Config may already be loaded
        testLogger.info('Alert page loaded successfully');
    });

    /**
     * Page Navigation and UI Validation
     *
     * Validates:
     * - Alerts page elements visible on load
     * - Sidebar menu shows both Alerts and Incidents links
     * - Navigate to Incidents page shows correct elements
     * - Navigate back to Alerts page restores elements
     */
    test("Page navigation and UI validation - Alerts and Incidents", {
        tag: ['@alertsPageNav', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Verify Alerts page on load ===');

        // 1.1 Verify sidebar menu items are visible
        await pm.alertsPage.expectSidebarMenuItemsVisible();
        testLogger.info('Sidebar menu items visible');

        // 1.2 Verify all Alerts page elements
        await pm.alertsPage.expectAlertListTableVisible();
        await pm.alertsPage.expectSearchAcrossFoldersToggleVisible();
        await pm.alertsPage.expectImportButtonVisible();
        await pm.alertsPage.expectAddAlertButtonVisible();
        await pm.alertsPage.expectAlertListSplitterVisible();
        testLogger.info('All Alerts page elements visible');

        // 1.3 Verify Incidents-only elements are hidden on Alerts page
        await pm.alertsPage.expectIncidentsOnlyElementsHidden();
        testLogger.info('Incidents elements hidden on Alerts page');

        testLogger.info('=== PHASE 2: Navigate to Incidents page ===');

        // 2.1 Navigate to Incidents page via sidebar menu
        await pm.alertsPage.navigateToIncidentsPage();

        // 2.2 Verify Incidents page elements
        await pm.alertsPage.expectIncidentsViewElementsVisible();
        testLogger.info('Incidents page elements visible');

        // 2.3 Verify Alerts-only elements are hidden on Incidents page
        await pm.alertsPage.expectAlertsOnlyElementsHidden();
        testLogger.info('Alerts elements hidden on Incidents page');

        testLogger.info('=== PHASE 3: Navigate back to Alerts page ===');

        // 3.1 Navigate back to Alerts page via sidebar menu
        await pm.alertsPage.navigateToAlertsPage();

        // 3.2 Verify Alerts page elements restored
        await pm.alertsPage.expectAlertsViewElementsVisible();
        testLogger.info('Alerts page elements restored');

        // 3.3 Verify toggle visible
        await pm.alertsPage.expectSearchAcrossFoldersToggleVisible();
        testLogger.info('Toggle visible on Alerts page');

        // 3.4 Verify buttons visible
        await pm.alertsPage.expectImportButtonVisible();
        await pm.alertsPage.expectAddAlertButtonVisible();
        testLogger.info('Import and Add buttons visible on Alerts page');

        // 3.5 Verify Incidents elements hidden again
        await pm.alertsPage.expectIncidentsOnlyElementsHidden();
        testLogger.info('Incidents elements hidden again');

        testLogger.info('=== Page navigation UI validation COMPLETE ===');
    });

    /**
     * Search Functionality in Both Pages
     *
     * Validates:
     * - Search input works on Alerts page
     * - Search input works on Incidents page
     */
    test("Search functionality works in both pages", {
        tag: ['@alertsPageNav', '@functional', '@P1', '@all', '@search']
    }, async ({ page }) => {
        const searchQuery = 'test';

        testLogger.info('=== PHASE 1: Search on Alerts page ===');

        // 1.1 Type in alert search input
        await pm.alertsPage.typeInAlertSearchInput(searchQuery);

        // 1.2 Verify search works
        await pm.alertsPage.expectAlertSearchInputFocused();
        await pm.alertsPage.expectAlertListTableVisible();
        testLogger.info('Search on Alerts page works');

        testLogger.info('=== PHASE 2: Search on Incidents page ===');

        // 2.1 Navigate to Incidents page
        await pm.alertsPage.navigateToIncidentsPage();

        // 2.2 Type in incident search input
        await pm.alertsPage.searchInIncidentsView(searchQuery);

        // 2.3 Verify search input has value and table visible
        await pm.alertsPage.expectIncidentSearchInputValue(searchQuery);
        await pm.alertsPage.expectIncidentListTableVisible();
        testLogger.info('Search on Incidents page works');

        testLogger.info('=== Search functionality COMPLETE ===');
    });

    /**
     * Edge Cases - Empty States and Page Refresh
     *
     * Validates:
     * - Empty alerts list shows table container and add button
     * - Empty incidents list shows table container
     * - Page refresh preserves current page (URL state)
     */
    test("Edge cases - empty states and page refresh", {
        tag: ['@alertsPageNav', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('=== PHASE 1: Empty Alerts state ===');

        // 1.1 Verify table container present (even if empty)
        await pm.alertsPage.expectAlertListTableVisible();

        // 1.2 Verify sidebar navigation functional
        await pm.alertsPage.expectSidebarMenuItemsVisible();

        // 1.3 Verify Add Alert button visible (key action for empty state)
        await pm.alertsPage.expectAddAlertButtonVisible();
        testLogger.info('Empty alerts state handled correctly');

        testLogger.info('=== PHASE 2: Empty Incidents state ===');

        // 2.1 Navigate to Incidents page
        await pm.alertsPage.navigateToIncidentsPage();

        // 2.2 Verify incident table container present
        await pm.alertsPage.expectIncidentListTableVisible();
        testLogger.info('Empty incidents state handled correctly');

        testLogger.info('=== PHASE 3: Page refresh preserves page ===');

        // 3.1 Verify we're on Incidents page
        await pm.alertsPage.expectIncidentsViewElementsVisible();
        const incidentsUrl = page.url();
        testLogger.info(`Incidents URL: ${incidentsUrl}`);

        // 3.2 Refresh page
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        testLogger.info('Page refreshed');

        // 3.3 Wait for page to stabilize
        await pm.alertsPage.waitForLoadingOverlayToDisappear();
        await pm.alertsPage.waitForIncidentsToLoad();

        // 3.4 Verify still on Incidents page (URL state preserved)
        await pm.alertsPage.expectIncidentsViewElementsVisible();
        await pm.alertsPage.expectAlertsOnlyElementsHidden();
        testLogger.info('Incidents page preserved after refresh');

        // 3.5 Verify can navigate to Alerts
        await pm.alertsPage.navigateToAlertsPage();
        await pm.alertsPage.expectAlertsViewElementsVisible();
        testLogger.info('Can navigate to Alerts after refresh');

        testLogger.info('=== Edge cases COMPLETE ===');
    });
});
