const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getHeaders, getIngestionUrl, sendRequest } = require('../utils/data-ingestion.js');
const logData = require("../../fixtures/log.json");

/**
 * Alerts Regression Bugs Test Suite
 *
 * This suite contains regression tests for alert-related bugs that have been fixed.
 * Each test verifies that a specific bug fix is working correctly.
 *
 * Tests run in PARALLEL for efficiency - setup/cleanup handled via hooks.
 */
test.describe("Alerts Regression Bugs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance
  let randomValue = `${Date.now()}`;
  const METRICS_STREAM = 'e2e_test_cpu_usage';
  const DESTINATION_NAME = 'e2e_promql_dest';
  const TEMPLATE_NAME = 'e2e_promql_template';

  // ============================================================================
  // Setup hook: Create prerequisites (destination and template) ONCE before all tests
  // Uses API for reliable creation across all environments
  // ============================================================================
  test.beforeAll(async ({ browser }) => {
    testLogger.info('Setting up prerequisites for PromQL alert tests (beforeAll)');

    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();

    try {
      // Navigate to base to get auth context
      await page.goto(`${process.env.ZO_BASE_URL || 'http://localhost:5080'}?org_identifier=${process.env.ORGNAME || 'default'}`);
      await page.waitForLoadState('networkidle');

      // Ingest metrics data
      await ingestMetricsData(page);

      // Create template and destination via API for reliability
      const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
      const org = process.env.ORGNAME || 'default';
      const authToken = Buffer.from(`${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`).toString('base64');

      // Create template via API
      const templatePayload = {
        name: TEMPLATE_NAME,
        body: JSON.stringify({ text: "Alert: {alert_name}" }),
        isDefault: false
      };

      const templateResponse = await page.evaluate(async ({ baseUrl, org, authToken, templatePayload }) => {
        const response = await fetch(`${baseUrl}/api/${org}/alerts/templates`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(templatePayload)
        });
        return { status: response.status, data: await response.json().catch(() => ({})) };
      }, { baseUrl, org, authToken, templatePayload });

      if (templateResponse.status === 200 || templateResponse.status === 409) {
        testLogger.info('Template ready via API', { templateName: TEMPLATE_NAME, status: templateResponse.status });
      } else {
        testLogger.warn('Template creation response', { status: templateResponse.status, data: templateResponse.data });
      }

      // Create destination via API
      const destinationPayload = {
        name: DESTINATION_NAME,
        url: "https://httpbin.org/post",
        method: "post",
        skip_tls_verify: false,
        template: TEMPLATE_NAME,
        headers: {}
      };

      const destResponse = await page.evaluate(async ({ baseUrl, org, authToken, destinationPayload }) => {
        const response = await fetch(`${baseUrl}/api/${org}/alerts/destinations`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(destinationPayload)
        });
        return { status: response.status, data: await response.json().catch(() => ({})) };
      }, { baseUrl, org, authToken, destinationPayload });

      if (destResponse.status === 200 || destResponse.status === 409) {
        testLogger.info('Destination ready via API', { destinationName: DESTINATION_NAME, status: destResponse.status });
      } else {
        testLogger.warn('Destination creation response', { status: destResponse.status, data: destResponse.data });
      }

      testLogger.info('Prerequisites setup completed');
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');
    testLogger.info('Alerts regression test setup completed');
  });

  // ============================================================================
  // Bug #9967: Cannot save alert when selecting PromQL mode
  // https://github.com/openobserve/openobserve/issues/9967
  // Fix: https://github.com/openobserve/openobserve/pull/9970
  //
  // CONSOLIDATED TEST: Covers all scenarios in a single test for efficiency:
  // - P1: PromQL tab visibility for metrics streams
  // - P1: "Trigger if the value is" fields appear in Step 4
  // - P2: promql_condition clears when switching from PromQL to Custom mode
  // - P1: Different operators (>=, <=) work correctly
  // - P0: Alert can be saved with PromQL mode (the core bug fix)
  // ============================================================================
  test("Bug #9967: PromQL alert creation - comprehensive validation", {
    tag: ['@promqlAlert', '@alerts', '@regressionBugs', '@P0', '@metrics', '@bug-9967']
  }, async ({ page }) => {
    testLogger.info('Testing Bug #9967 fix - comprehensive validation');
    testLogger.info('Bug: Cannot save alert when selecting PromQL on metrics stream');
    testLogger.info('Fix: Added promql_condition field with operator and value inputs');

    const alertsUrl = `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle');

    // Reload to ensure destinations are fetched (fixes deployed env caching issues)
    await page.reload();
    await page.waitForLoadState('networkidle');

    // ========== PART 1: UI Element Visibility Tests ==========
    testLogger.info('PART 1: Testing UI element visibility');

    // Click Add Alert button using page object
    await pm.alertsPage.clickAddAlertButton();

    // Fill alert name using page object
    await pm.alertsPage.fillAlertName('test_promql_comprehensive');

    // Select metrics stream type using page object
    await pm.alertsPage.selectStreamType('metrics');

    // Select a metrics stream using page object (handles retry and fallback)
    const streamSelected = await pm.alertsPage.selectMetricsStream(METRICS_STREAM);
    if (!streamSelected) {
      testLogger.warn('No metrics streams available - skipping test');
      test.skip(true, 'No metrics streams available on environment');
      return;
    }

    // Select Scheduled alert type using page object
    await pm.alertsPage.selectScheduledAlertType();

    // Navigate to Step 2: Conditions
    await pm.alertsPage.clickContinueButton();
    await page.waitForTimeout(500);

    // ✅ COVERAGE: P1 - PromQL tab visibility for metrics streams
    await pm.alertsPage.expectPromqlTabVisible();
    testLogger.info('✅ P1: PromQL tab is visible for metrics stream');

    // Verify all three tabs are visible
    await pm.alertsPage.expectCustomTabVisible();
    await pm.alertsPage.expectSqlTabVisible();
    testLogger.info('✅ All three tabs (Custom, SQL, PromQL) visible');

    // Click PromQL tab using page object
    await pm.alertsPage.clickPromqlTab();

    // Navigate to Step 4 to verify promql_condition fields
    await pm.alertsPage.clickContinueButton(); // Step 3
    await pm.alertsPage.clickContinueButton(); // Step 4
    await page.waitForTimeout(500);

    // ✅ COVERAGE: P1 - "Trigger if the value is" fields appear in Step 4
    await pm.alertsPage.expectPromqlConditionRowVisible();
    testLogger.info('✅ P1: PromQL condition row "Trigger if the value is" is visible');

    // Verify operator dropdown and value input exist
    await pm.alertsPage.expectOperatorDropdownVisible();
    await pm.alertsPage.expectValueInputVisible();
    testLogger.info('✅ P1: Operator dropdown and value input are visible');

    // ========== PART 2: Mode Switching Test ==========
    testLogger.info('PART 2: Testing mode switching behavior');

    // Go back to Step 2 using wizard step navigation (index 1 = Step 2)
    await pm.alertsPage.clickStepIndicator(1);

    // Switch to Custom tab using page object
    await pm.alertsPage.clickCustomTab();

    // Navigate to Step 4 (index 3 = Step 4)
    await pm.alertsPage.clickStepIndicator(3);

    // ✅ COVERAGE: P2 - promql_condition clears when switching to Custom mode
    await pm.alertsPage.expectPromqlConditionRowNotVisible();
    testLogger.info('✅ P2: PromQL condition row NOT visible in Custom mode');

    // Cancel this wizard flow using page object
    await pm.alertsPage.clickBackButton();

    // ========== PART 3: Save Alerts with Different Operators ==========
    testLogger.info('PART 3: Testing alert save with different operators');

    const testOperators = ['>=', '<='];
    const createdAlerts = [];

    for (const operator of testOperators) {
      testLogger.info(`Testing operator: ${operator}`);

      await page.goto(alertsUrl);
      await page.waitForLoadState('networkidle');

      // ✅ COVERAGE: P0 (>=) + P1 (<=) - Alert can be saved with PromQL mode
      const alertName = await pm.alertsPage.createScheduledAlertWithPromQL(
        METRICS_STREAM,
        METRICS_STREAM,
        DESTINATION_NAME,
        `${Date.now()}`,
        { operator: operator, value: 50 }
      );

      createdAlerts.push(alertName);
      testLogger.info(`Alert created with operator ${operator}`, { alertName });

      // Verify alert appears in the list using page object
      await pm.alertsPage.searchAlert(alertName);
      await page.waitForTimeout(2000);
      await pm.alertsPage.expectAlertRowVisible(alertName);
      testLogger.info(`✅ P0/P1: Alert with operator ${operator} saved successfully`);
    }

    // ========== CLEANUP ==========
    testLogger.info('Cleaning up created alerts');
    for (const alertName of createdAlerts) {
      await pm.alertsPage.searchAndDeleteAlert(alertName);
    }

    testLogger.info('✅ Bug #9967 comprehensive test completed - all scenarios verified');
  });

  // ============================================================================
  // Bug #9967 - P2 Test: Loading existing PromQL alert shows correct values
  // NOTE: There appears to be a separate bug where promql_condition.value
  //       isn't loaded from saved alert (shows default 1 instead of saved value).
  //       This test validates the UI displays the edit form correctly.
  // ============================================================================
  test("should load existing PromQL alert with correct condition values (Bug #9967 - P2)", {
    tag: ['@promqlAlert', '@alerts', '@regressionBugs', '@P2', '@metrics', '@bug-9967']
  }, async ({ page }) => {
    testLogger.info('Testing loading existing PromQL alert');

    const alertsUrl = `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`;
    const testValue = 75;
    const testOperator = '>';

    // First create a PromQL alert with specific values
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle');

    const alertName = await pm.alertsPage.createScheduledAlertWithPromQL(
      METRICS_STREAM,
      METRICS_STREAM,
      DESTINATION_NAME,
      `${Date.now()}`,
      { operator: testOperator, value: testValue }
    );

    testLogger.info('Created PromQL alert for edit test', { alertName, testOperator, testValue });

    // Navigate back to alerts page and find the alert
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle');

    // Search for the alert using page object
    await pm.alertsPage.searchAlert(alertName);
    await page.waitForTimeout(2000);

    // Click to edit the alert using page object
    await pm.alertsPage.clickAlertUpdateButton(alertName);
    testLogger.info('Opened alert for editing');

    // Navigate to Step 4: Alert Settings to check the promql_condition values
    await pm.alertsPage.clickContinueButton(); // Step 2
    await pm.alertsPage.clickContinueButton(); // Step 3
    await pm.alertsPage.clickContinueButton(); // Step 4
    await page.waitForTimeout(500);

    // Verify the PromQL condition row is visible (key fix from Bug #9967)
    await pm.alertsPage.expectPromqlConditionRowVisible();
    testLogger.info('PromQL condition row is visible in edit mode - Bug #9967 fix verified');

    // Verify the operator dropdown is visible
    await pm.alertsPage.expectOperatorDropdownVisible();
    testLogger.info('Operator dropdown is visible in edit mode');

    // Verify the value input exists and get its value
    await pm.alertsPage.expectValueInputVisible();
    const currentValue = await pm.alertsPage.getPromqlConditionValue();
    testLogger.info('Retrieved value from promql_condition input', { currentValue, expectedValue: testValue });

    // Verify the saved value loads correctly
    expect(parseInt(currentValue)).toBe(testValue);

    // Cancel and go back using page object
    await pm.alertsPage.clickBackButton();

    // Cleanup: Delete the test alert
    await pm.alertsPage.searchAndDeleteAlert(alertName);

    testLogger.info('Loading existing PromQL alert test completed');
  });

  test.afterEach(async () => {
    testLogger.info('Alerts regression test completed');
  });

  // ============================================================================
  // Cleanup hook: Remove test prerequisites ONCE after all tests complete
  // ============================================================================
  test.afterAll(async ({ browser }) => {
    testLogger.info('Cleaning up test prerequisites (afterAll)');

    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    const cleanupPm = new PageManager(page);

    try {
      await page.goto(`${process.env.ZO_BASE_URL || 'http://localhost:5080'}?org_identifier=${process.env.ORGNAME || 'default'}`);
      await page.waitForLoadState('networkidle');

      await cleanupAlertDestination(page, cleanupPm);
      await cleanupAlertTemplate(page, cleanupPm);
      testLogger.info('Test suite cleanup completed');
    } catch (e) {
      testLogger.warn('Cleanup encountered issues', { error: e.message });
    } finally {
      await page.close();
      await context.close();
    }
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Ingest metrics data to the test metrics stream using JSON API
 */
async function ingestMetricsData(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = 'e2e_test_cpu_usage';
  const baseUrl = process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080';
  const ingestionUrl = `${baseUrl}/api/${orgId}/ingest/metrics/_json`;

  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const timestamp = Math.floor(Date.now() / 1000);

  // Create metrics data in JSON format with __name__ field
  const metricsData = [];
  for (let i = 0; i < 10; i++) {
    metricsData.push({
      "__name__": streamName,
      "__type__": "gauge",
      "host_name": `server-${i % 3 + 1}`,
      "env": "test",
      "region": ["us-east-1", "us-west-2", "eu-west-1"][i % 3],
      "_timestamp": timestamp - (i * 60),
      "value": 20 + Math.random() * 60
    });
  }

  try {
    const response = await page.evaluate(async ({ url, authToken, data }) => {
      const fetchResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      return {
        status: fetchResponse.status,
        data: await fetchResponse.json().catch(() => ({}))
      };
    }, { url: ingestionUrl, authToken: basicAuthCredentials, data: metricsData });

    testLogger.info('Metrics data ingested', { response, streamName });
  } catch (e) {
    testLogger.warn('Metrics ingestion may have failed', { error: e.message });
  }

  await page.waitForTimeout(3000); // Allow time for indexing
}

/**
 * Create alert destination for testing
 */
async function createAlertDestination(page, pm) {
  const destinationName = 'e2e_promql_dest';

  try {
    // Navigate to Settings > Destinations using homePage
    await pm.homePage.navigateToAlertDestinations();
    await page.waitForLoadState('networkidle');

    // Check if destination already exists
    const existingDest = page.locator(`text=${destinationName}`);
    if (await existingDest.isVisible({ timeout: 3000 }).catch(() => false)) {
      testLogger.info('Destination already exists', { destinationName });
      return;
    }

    // Click add destination
    await page.locator('[data-test="alert-destination-list-add-alert-btn"]').click();
    await page.waitForTimeout(1000);

    // Fill destination details
    await page.locator('[data-test="add-destination-name-input"]').fill(destinationName);

    // Select HTTP destination type
    await page.locator('[data-test="add-destination-type-select"]').click();
    await page.getByRole('option', { name: 'Http' }).click();

    // Fill URL
    await page.locator('[data-test="add-destination-url-input"]').fill('http://localhost:8080/webhook');

    // Select POST method
    await page.locator('[data-test="add-destination-method-select"]').click();
    await page.getByRole('option', { name: 'post' }).click();

    // Select template
    await page.locator('[data-test="add-destination-template-select"]').click();
    await page.waitForTimeout(500);

    // Try to select e2e_promql_template or first available
    const templateOption = page.getByRole('option', { name: 'e2e_promql_template' });
    if (await templateOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await templateOption.click();
    } else {
      // Select first available template or create one
      await page.locator('.q-menu:visible .q-item').first().click();
    }

    // Save destination
    await page.locator('[data-test="add-destination-submit-btn"]').click();
    await page.waitForTimeout(2000);

    testLogger.info('Destination created', { destinationName });
  } catch (e) {
    testLogger.warn('Could not create destination', { error: e.message });
  }
}

/**
 * Create alert template for testing
 */
async function createAlertTemplate(page, pm) {
  const templateName = 'e2e_promql_template';

  try {
    // Navigate to Settings > Templates using homePage
    await pm.homePage.navigateToTemplates();
    await page.waitForLoadState('networkidle');

    // Check if template already exists
    const existingTemplate = page.locator(`text=${templateName}`);
    if (await existingTemplate.isVisible({ timeout: 3000 }).catch(() => false)) {
      testLogger.info('Template already exists', { templateName });
      return;
    }

    // Click add template (correct selector: template-list-add-btn)
    await page.locator('[data-test="template-list-add-btn"]').click();
    await page.waitForTimeout(1000);

    // Fill template details
    await page.locator('[data-test="add-template-name-input"]').fill(templateName);
    await page.locator('[data-test="add-template-body-input"]').fill('{"alert": "{alert_name}", "message": "{alert_type}"}');

    // Save template
    await page.locator('[data-test="add-template-submit-btn"]').click();
    await page.waitForTimeout(2000);

    testLogger.info('Template created', { templateName });
  } catch (e) {
    testLogger.warn('Could not create template', { error: e.message });
  }
}

/**
 * Cleanup alert destination
 */
async function cleanupAlertDestination(page, pm) {
  const destinationName = 'e2e_promql_dest';

  try {
    // Navigate to Settings > Destinations using homePage
    await pm.homePage.navigateToAlertDestinations();
    await page.waitForLoadState('networkidle');

    const deleteBtn = page.locator(`[data-test="alert-destination-list-${destinationName}-delete-destination"]`);
    if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deleteBtn.click();
      await page.locator('button:has-text("Delete")').click();
      await page.waitForTimeout(1000);
      testLogger.info('Destination deleted', { destinationName });
    }
  } catch (e) {
    testLogger.warn('Could not delete destination', { error: e.message });
  }
}

/**
 * Cleanup alert template
 */
async function cleanupAlertTemplate(page, pm) {
  const templateName = 'e2e_promql_template';

  try {
    // Navigate to Settings > Templates using homePage
    await pm.homePage.navigateToTemplates();
    await page.waitForLoadState('networkidle');

    const deleteBtn = page.locator(`[data-test="alert-template-list-${templateName}-delete-template"]`);
    if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deleteBtn.click();
      await page.locator('button:has-text("Delete")').click();
      await page.waitForTimeout(1000);
      testLogger.info('Template deleted', { templateName });
    }
  } catch (e) {
    testLogger.warn('Could not delete template', { error: e.message });
  }
}
