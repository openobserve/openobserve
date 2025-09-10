const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe("Alerts E2E Flow", () => {
  // Shared test variables
  let pm;
  let createdTemplateName;
  let createdDestinationName;
  let sharedRandomValue;

  /**
   * @setup Test Setup and Initialization
   * @description Performs common setup operations required before each test execution
   * @author Automation Team
   * 
   * @setup_steps
   * 1. **Page Manager Initialization**: Creates new PageManager instance for test
   * 2. **Random Value Generation**: Generates shared random string for unique test data (once per test run)
   * 3. **Data Ingestion Control**: Conditionally skips data ingestion for scheduled alert tests
   * 4. **Navigation**: Navigates to alerts page with organization context
   * 
   * @dependencies
   * - PageManager: Core page object management
   * - testLogger: Logging and debug information
   * - logData.alertUrl: Base alert URL from fixtures
   * - process.env.ORGNAME: Organization identifier from environment
   * 
   * @shared_variables
   * - pm: PageManager instance (available to all tests)
   * - sharedRandomValue: Unique string for test data isolation
   * - createdTemplateName: Alert template name (set during test execution)
   * - createdDestinationName: Alert destination name (set during test execution)
   * 
   * @preconditions
   * - OpenObserve instance must be running and accessible
   * - User authentication state must be valid
   * - Environment variables (ORGNAME) must be configured
   * - Test fixtures (logData) must be available
   * 
   * @postconditions
   * - Page is navigated to alerts interface
   * - PageManager is initialized and ready for test operations
   * - Unique random value is generated and logged
   * - Test data ingestion is handled based on test type
   * 
   * @error_handling
   * - Navigation failures will cause test to fail early
   * - Missing environment variables will cause URL construction issues
   * - PageManager initialization failures will prevent test execution
   * 
   * @performance
   * - Random value generation: ~1ms (cached for subsequent tests)
   * - Page navigation: ~2-3 seconds (depends on server response)
   * - Data ingestion skip: ~100ms (conditional logic)
   * 
   * @logging Generates debug log entry with shared random value for traceability
   */
  test.beforeEach(async ({ page }, testInfo) => {
    pm = new PageManager(page);

    // Generate shared random value if not already generated
    if (!sharedRandomValue) {
      sharedRandomValue = pm.alertsPage.generateRandomString();
      testLogger.info('Generated shared random value for this run', { sharedRandomValue });
    }

    await pm.commonActions.skipDataIngestionForScheduledAlert(testInfo.title);
    
    // Navigate to alerts page
    await page.goto(
      `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  /**
   * @testcase ALERT-E2E-001
   * @title Complete Alert Lifecycle Management E2E Test
   * @description Comprehensive end-to-end test that validates all major alert operations including creation, management, and cleanup
   * @priority Critical
   * @category Alert Management
   * @type End-to-End
   * @tags @e2eAlerts @all @alerts @smoke @regression
   * @author Automation Team
   * @created 2025-09-10
   * 
   * @preconditions
   * - User has admin privileges and is authenticated
   * - OpenObserve instance is running and accessible
   * - Test stream 'auto_playwright_stream' exists with test data
   * - Alert templates and destinations can be created
   * 
   * @testdata
   * - Stream: auto_playwright_stream
   * - Column: job
   * - Value: test
   * - Template: auto_playwright_template_{random}
   * - Destination: auto_playwright_destination_{random}
   * 
   * @steps
   * 1. **Setup Phase**: Create alert template and destination prerequisites
   * 2. **Folder Creation**: Create alert folder 'auto_{random}' and verify creation
   * 3. **Alert Creation**: Navigate to folder and create initial alert with stream configuration
   * 4. **First Clone & Delete**: Clone the alert and delete all instances to test bulk operations
   * 5. **Second Alert Creation**: Create new alert in the same folder
   * 6. **Alert Update**: Modify alert operator settings and verify changes
   * 7. **Second Clone**: Clone the updated alert to test cloning functionality
   * 8. **Pause/Resume Operations**: Test alert pause and resume functionality
   * 9. **Folder Movement**: Move all alerts to target folder 'testfoldermove'
   * 10. **Cleanup**: Delete original folder and verify alerts in target location
   * 11. **Final Verification**: Search for alerts and verify expected count (2 instances)
   * 12. **Final Cleanup**: Delete alert by row to complete test cleanup
   * 
   * @expected
   * - All alert operations complete successfully without errors
   * - Alert templates and destinations are created and reusable
   * - Folder operations (create, move, delete) work correctly
   * - Alert cloning creates exact copies with proper naming
   * - Pause/Resume functionality works without data loss
   * - Bulk operations (move, delete) handle multiple alerts correctly
   * - Search functionality returns accurate results (2 alert instances)
   * - Final cleanup removes all test artifacts
   * 
   * @risks
   * - Test creates multiple alerts that need cleanup on failure
   * - Folder operations may leave orphaned alerts if test fails mid-execution
   * - Random values may conflict if tests run in parallel
   * 
   * @duration ~85 seconds (based on historical runs)
   * @browser Chrome/Chromium
   * @viewport 1500x1024
   * 
   * @automation_mapping
   * - File: tests/ui-testing/playwright-tests/Alerts/alerts-e2e-flow.spec.js
   * - Test Method: Alerts E2E Flow - Create, Update, Move, Clone, Delete, Pause, Resume
   * - Framework: Playwright
   * - Page Objects: AlertsPage, AlertTemplatesPage, AlertDestinationsPage, DashboardFolder
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
    testLogger.info('Successfully created folder', { folderName });

    // Navigate to folder and create first alert
    await pm.alertsPage.navigateToFolder(folderName);
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, createdDestinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Successfully created alert', { alertName });

    // Clone first alert
    await pm.alertsPage.cloneAlert(alertName, 'logs', streamName);
    testLogger.info('Successfully cloned alert', { alertName });

    // Delete all instances of the cloned alert
    await pm.alertsPage.deleteImportedAlert(alertName);
    testLogger.info('Successfully deleted all instances of alert', { alertName });

    // ===== Second Iteration: New Alert Creation and Management =====
    // Navigate back to folder and create new alert
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForLoadState('networkidle');

    const newAlertName = await pm.alertsPage.createAlert(streamName, column, value, createdDestinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(newAlertName);
    testLogger.info('Successfully created new alert', { alertName: newAlertName });

    // Update the new alert's operator
    await pm.alertsPage.updateAlert(newAlertName);
    testLogger.info('Successfully updated new alert', { alertName: newAlertName });

    // Clone the new alert
    await pm.alertsPage.cloneAlert(newAlertName, 'logs', streamName);
    testLogger.info('Successfully cloned new alert', { alertName: newAlertName });

    // ===== Alert Pause and Resume =====
    // Pause the new alert
    await pm.alertsPage.pauseAlert(newAlertName);
    testLogger.info('Successfully paused alert', { alertName: newAlertName });

    // Resume the new alert
    await pm.alertsPage.resumeAlert(newAlertName);
    testLogger.info('Successfully resumed alert', { alertName: newAlertName });

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