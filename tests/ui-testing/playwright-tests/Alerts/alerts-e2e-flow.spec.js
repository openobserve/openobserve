const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// Test timeout constants (in milliseconds)
const THREE_MINUTES_MS = 180000;
const UI_STABILIZATION_WAIT_MS = 2000;

test.describe("Alerts E2E Flow", () => {
  // Shared test variables
  let pm;
  let createdTemplateName;
  let createdDestinationName;
  let sharedRandomValue;
  let validationInfra; // Stores unique validation infrastructure per test
  let testStreamName; // Unique stream with custom columns for this test run

  /**
   * Setup for each test
   * - Logs in
   * - Generates shared random value
   * - Initializes dedicated test stream with custom columns
   * - Navigates to alerts page
   */
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);

    // Generate shared random value if not already generated
    if (!sharedRandomValue) {
      // Lowercase to match API behavior (stream names are lowercased)
      sharedRandomValue = pm.alertsPage.generateRandomString().toLowerCase();
      testLogger.info('Generated shared random value for this run', { sharedRandomValue });
    }

    // Create unique test stream name for this test run (lowercase to match API behavior)
    testStreamName = `alert_e2e_${sharedRandomValue}`.toLowerCase();

    // Initialize the test stream with custom columns (city, country, status, age, etc.)
    // This ensures we have predictable columns for alert condition testing
    await pm.commonActions.initializeAlertTestStream(testStreamName);
    testLogger.info('Initialized test stream with custom columns', {
      testStreamName,
      columns: ['city', 'country', 'status', 'age', 'test_run_id', 'test_timestamp', 'message']
    });

    // Navigate to alerts page - stream will be available after page load
    await page.goto(
      `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`
    );

    // Refresh page to ensure newly created stream appears in dropdowns
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  });

  // ========================================================================
  // TEST 1: Alert CRUD - Create, Clone, Delete
  // Covers: folder creation, alert creation via wizard, cloning, deletion
  // ========================================================================
  test('E2E: Alert CRUD - Create, Clone, Delete', {
    tag: ['@e2eAlerts', '@crud', '@all', '@alerts'],
    timeout: THREE_MINUTES_MS
  }, async ({ page }) => {
    // This test covers create/clone/delete operations
    test.slow();

    const streamName = testStreamName;
    const column = 'city';        // Custom column from our test stream
    const value = 'bangalore';    // Value that triggers the alert condition

    // Ensure prerequisites exist (creates template + self-referencing destination)
    validationInfra = await pm.alertsPage.ensureValidationInfrastructure(pm, sharedRandomValue);
    testLogger.info('Validation infrastructure ready', validationInfra);

    // ===== Create Folder =====
    const folderName = 'auto_crud_' + sharedRandomValue;
    await pm.alertsPage.createFolder(folderName, 'E2E CRUD Test Folder');
    await pm.alertsPage.verifyFolderCreated(folderName);
    testLogger.info('Created folder', { folderName });

    await pm.alertsPage.navigateToFolder(folderName);

    // ===== Create Alert =====
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, validationInfra.destinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Created alert', { alertName });

    // ===== Clone Alert =====
    await pm.alertsPage.cloneAlert(alertName, 'logs', streamName);
    testLogger.info('Cloned alert', { alertName });

    // ===== Delete Cloned Alert =====
    await pm.alertsPage.deleteImportedAlert(alertName);
    testLogger.info('Deleted alert', { alertName });

    testLogger.info('=== Alert CRUD E2E test COMPLETE ===');
  });

  // ========================================================================
  // TEST 2: Alert State Management - Update, Pause, Resume
  // Covers: alert update (edit condition), pause, resume
  // ========================================================================
  test('E2E: Alert State Management - Update, Pause, Resume', {
    tag: ['@e2eAlerts', '@state', '@all', '@alerts'],
    timeout: THREE_MINUTES_MS
  }, async ({ page }) => {
    // This test covers update/pause/resume operations
    test.slow();

    const streamName = testStreamName;
    const column = 'city';
    const value = 'bangalore';

    // Create template and destination for this test (not the self-referencing validation type)
    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.ensureTemplateExists(createdTemplateName);
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(createdDestinationName, slackUrl, createdTemplateName);

    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // ===== Create Folder =====
    const folderName = 'auto_state_' + sharedRandomValue;
    await pm.alertsPage.createFolder(folderName, 'E2E State Management Folder');
    await pm.alertsPage.verifyFolderCreated(folderName);
    testLogger.info('Created folder', { folderName });

    await pm.alertsPage.navigateToFolder(folderName);

    // ===== Create Alert =====
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, createdDestinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Created alert for state management', { alertName });

    // ===== Update Alert =====
    await pm.alertsPage.updateAlert(alertName);
    testLogger.info('Updated alert', { alertName });

    // ===== Pause Alert =====
    await pm.alertsPage.pauseAlert(alertName);
    testLogger.info('Paused alert', { alertName });

    // ===== Resume Alert =====
    await pm.alertsPage.resumeAlert(alertName);
    testLogger.info('Resumed alert', { alertName });

    testLogger.info('=== Alert State Management E2E test COMPLETE ===');
  });

  // ========================================================================
  // TEST 3: Alert Folder Management - Move, Search, Verify
  // Covers: move alerts between folders, search across folders, verify visibility
  // ========================================================================
  test('E2E: Alert Folder Management - Move, Search, Verify', {
    tag: ['@e2eAlerts', '@folders', '@all', '@alerts'],
    timeout: THREE_MINUTES_MS
  }, async ({ page }) => {
    // This test covers folder movement and search operations
    test.slow();

    const streamName = testStreamName;
    const column = 'city';
    const value = 'bangalore';

    // Create template and destination
    createdTemplateName = 'auto_playwright_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.ensureTemplateExists(createdTemplateName);
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(createdDestinationName, slackUrl, createdTemplateName);

    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // ===== Create Source Folder =====
    const sourceFolderName = 'auto_source_' + sharedRandomValue;
    await pm.alertsPage.createFolder(sourceFolderName, 'E2E Source Folder');
    await pm.alertsPage.verifyFolderCreated(sourceFolderName);
    testLogger.info('Created source folder', { sourceFolderName });

    await pm.alertsPage.navigateToFolder(sourceFolderName);

    // ===== Create Alert in Source Folder =====
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, createdDestinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Created alert in source folder', { alertName, sourceFolderName });

    // ===== Ensure Target Folder Exists =====
    const targetFolderName = 'auto_target_' + sharedRandomValue;
    await pm.alertsPage.ensureFolderExists(targetFolderName, 'E2E Target Folder');

    // Clean target folder before moving
    await pm.alertsPage.navigateToFolder(targetFolderName);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Target folder ready', { targetFolderName });

    // ===== Move Alert to Target Folder =====
    await pm.alertsPage.navigateToFolder(sourceFolderName);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.alertsPage.moveAllAlertsToFolder(targetFolderName);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Moved all alerts to target folder', { targetFolderName });

    // ===== Search in Target Folder =====
    await pm.alertsPage.navigateToFolder(targetFolderName);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.alertsPage.searchAlert(alertName);
    await pm.alertsPage.verifyAlertCellVisible(alertName);
    testLogger.info('Verified alert visible in target folder', { alertName, targetFolderName });

    // ===== Delete the Alert =====
    await pm.alertsPage.deleteAlertByRow(alertName);
    testLogger.info('Deleted alert from target folder', { alertName });

    testLogger.info('=== Alert Folder Management E2E test COMPLETE ===');
  });
});
