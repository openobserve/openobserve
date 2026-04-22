const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

/**
 * Anomaly Detection E2E Tests
 *
 * Tests for anomaly detection feature (Enterprise/Cloud only)
 *
 * Features tested:
 * - Navigate to anomaly detection tab
 * - Create anomaly detection configuration
 * - Verify anomaly config appears in list
 * - Pause/Resume anomaly detection
 * - Delete anomaly configuration
 *
 * Note: These tests require enterprise or cloud build
 */

test.describe("Anomaly Detection testcases", () => {
  test.describe.configure({ mode: 'serial' });

  let pm;
  let sharedRandomValue;
  let testStreamName;
  let createdDestinationName;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);

    // Generate shared random value if not already generated
    if (!sharedRandomValue) {
      sharedRandomValue = pm.alertsPage.generateRandomString().toLowerCase();
      testLogger.info('Generated shared random value', { sharedRandomValue });
    }

    // Use existing test stream
    testStreamName = `e2e_automate`;

    // Navigate to alerts page
    await page.goto(
      `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`
    );
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    testLogger.info('Test setup completed');
  });

  /**
   * Test: Check if anomaly detection feature is available
   * This test verifies if the anomaly detection tab is accessible (enterprise/cloud feature)
   */
  test('Verify anomaly detection tab is available', {
    tag: ['@anomaly', '@all', '@smoke']
  }, async () => {
    testLogger.info('Testing anomaly detection availability');

    const isAvailable = await pm.anomalyDetectionPage.isAnomalyDetectionAvailable();

    if (!isAvailable) {
      testLogger.warn('Anomaly detection is not available - skipping tests (requires enterprise/cloud build)');
      test.skip();
    }

    expect(isAvailable).toBe(true);
    testLogger.info('Anomaly detection feature is available');
  });

  /**
   * Test: Navigate to anomaly detection tab
   */
  test('Navigate to anomaly detection tab', {
    tag: ['@anomaly', '@all', '@navigation']
  }, async ({ page }) => {
    testLogger.info('Testing navigation to anomaly detection tab');

    await pm.anomalyDetectionPage.navigateToAnomalyTab();

    // Verify URL contains tab parameter
    const currentUrl = page.url();
    expect(currentUrl).toContain('tab=anomalyDetection');

    testLogger.info('Successfully navigated to anomaly detection tab');
  });

  /**
   * Test: Create anomaly detection configuration
   */
  test('Create anomaly detection configuration', {
    tag: ['@anomaly', '@all', '@create']
  }, async ({ page }) => {
    testLogger.info('Testing anomaly detection creation');

    // Check if feature is available
    const isAvailable = await pm.anomalyDetectionPage.isAnomalyDetectionAvailable();
    if (!isAvailable) {
      testLogger.warn('Anomaly detection not available - skipping test');
      test.skip();
    }

    // Ensure destination exists
    createdDestinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const templateName = 'auto_playwright_template_' + sharedRandomValue;
    const slackUrl = "DEMO";

    await pm.alertTemplatesPage.ensureTemplateExists(templateName);
    await pm.alertDestinationsPage.ensureDestinationExists(
      createdDestinationName,
      slackUrl,
      templateName
    );

    // Navigate back to alerts
    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await pm.anomalyDetectionPage.navigateToAnomalyTab();

    const anomalyName = 'auto_anomaly_' + sharedRandomValue;

    await pm.anomalyDetectionPage.createAnomalyDetection({
      name: anomalyName,
      streamName: testStreamName,
      streamType: 'logs',
      destinationName: createdDestinationName
    });

    // Verify anomaly config exists in list
    await pm.anomalyDetectionPage.navigateToAnomalyTab();
    await pm.anomalyDetectionPage.verifyAnomalyConfigExists(anomalyName);

    testLogger.info('Successfully created and verified anomaly detection config');
  });

  /**
   * Test: Verify anomaly config has status badge
   */
  test('Verify anomaly config shows status', {
    tag: ['@anomaly', '@all', '@status']
  }, async () => {
    testLogger.info('Testing anomaly status display');

    // Check if feature is available
    const isAvailable = await pm.anomalyDetectionPage.isAnomalyDetectionAvailable();
    if (!isAvailable) {
      testLogger.warn('Anomaly detection not available - skipping test');
      test.skip();
    }

    await pm.anomalyDetectionPage.navigateToAnomalyTab();

    const anomalyName = 'auto_anomaly_' + sharedRandomValue;

    // Get status
    const status = await pm.anomalyDetectionPage.getAnomalyStatus(anomalyName);

    // Status should be one of: training, ready, failed, etc.
    expect(['training', 'ready', 'failed', 'active', 'paused', 'unknown']).toContain(status);

    testLogger.info('Anomaly config has status', { status });
  });

  /**
   * Test: Pause and resume anomaly detection
   */
  test('Pause and resume anomaly detection', {
    tag: ['@anomaly', '@all', '@pause-resume']
  }, async ({ page }) => {
    testLogger.info('Testing pause and resume functionality');

    // Check if feature is available
    const isAvailable = await pm.anomalyDetectionPage.isAnomalyDetectionAvailable();
    if (!isAvailable) {
      testLogger.warn('Anomaly detection not available - skipping test');
      test.skip();
    }

    await pm.anomalyDetectionPage.navigateToAnomalyTab();

    const anomalyName = 'auto_anomaly_' + sharedRandomValue;

    // Pause anomaly detection
    await pm.anomalyDetectionPage.pauseAnomaly(anomalyName);
    await page.waitForTimeout(2000);

    // Resume anomaly detection
    await pm.anomalyDetectionPage.resumeAnomaly(anomalyName);
    await page.waitForTimeout(2000);

    testLogger.info('Successfully paused and resumed anomaly detection');
  });

  /**
   * Test: Verify anomaly detection actually detects anomalies (E2E validation)
   * This test creates an anomaly config, waits for training, ingests anomalous data,
   * and verifies the anomaly is detected and alert is triggered
   *
   * NOTE: This test may take several minutes due to model training and detection wait times
   */
  test('Verify anomaly detection E2E - model training and anomaly detection', {
    tag: ['@anomaly', '@all', '@e2e', '@detection'],
    timeout: 600000 // 10 minutes - training and detection can take time
  }, async () => {
    testLogger.info('Testing full E2E anomaly detection with trigger validation');

    // Check if feature is available
    const isAvailable = await pm.anomalyDetectionPage.isAnomalyDetectionAvailable();
    if (!isAvailable) {
      testLogger.warn('Anomaly detection not available - skipping test');
      test.skip();
    }

    // Mark this test as slow since it involves training and detection
    test.slow();

    await pm.anomalyDetectionPage.navigateToAnomalyTab();

    const anomalyName = 'auto_anomaly_' + sharedRandomValue;

    // Ensure validation infrastructure exists (destination sends alerts to validation stream)
    const validationInfra = await pm.alertsPage.ensureValidationInfrastructure(pm, sharedRandomValue);
    testLogger.info('Validation infrastructure ready', validationInfra);

    await pm.commonActions.navigateToAlerts();
    await pm.anomalyDetectionPage.navigateToAnomalyTab();

    testLogger.info('Verifying anomaly detection with actual anomaly trigger');

    // Use the comprehensive E2E verification method
    // With 1-minute schedule_interval, wait ~2.5 minutes to ensure detection runs
    const result = await pm.anomalyDetectionPage.verifyAnomalyDetection(
      pm,
      anomalyName,
      testStreamName,
      validationInfra.streamName, // Use validation stream from infrastructure
      {
        baselineValue: 100,    // Normal value
        anomalousValue: 1000   // 10x spike (clear anomaly)
      },
      150000 // Wait 2.5 minutes (schedule is 1 min, so 2.5min ensures at least 2 cycles)
    );

    // Verify anomaly was detected
    expect(result.detected, `Anomaly ${anomalyName} should be detected and trigger alert`).toBe(true);

    if (result.detected) {
      testLogger.info('SUCCESS: Anomaly detection E2E validation passed!', {
        anomalyName,
        logTextPreview: result.logText?.substring(0, 200)
      });
    } else {
      testLogger.error('FAILED: Anomaly was not detected', {
        anomalyName,
        result
      });
    }
  });

  /**
   * Test: Delete anomaly detection configuration
   */
  test('Delete anomaly detection configuration', {
    tag: ['@anomaly', '@all', '@delete']
  }, async ({ page }) => {
    testLogger.info('Testing anomaly deletion');

    // Check if feature is available
    const isAvailable = await pm.anomalyDetectionPage.isAnomalyDetectionAvailable();
    if (!isAvailable) {
      testLogger.warn('Anomaly detection not available - skipping test');
      test.skip();
    }

    await pm.anomalyDetectionPage.navigateToAnomalyTab();

    const anomalyName = 'auto_anomaly_' + sharedRandomValue;

    // Delete anomaly config
    await pm.anomalyDetectionPage.deleteAnomaly(anomalyName);
    await page.waitForTimeout(2000);

    // Verify it's removed from list (should not be visible)
    const row = page.locator('tr').filter({ hasText: anomalyName });
    await expect(row).not.toBeVisible({ timeout: 5000 });

    testLogger.info('Successfully deleted anomaly detection config');
  });
});
