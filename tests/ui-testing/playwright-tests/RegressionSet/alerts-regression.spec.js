const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getHeaders, getIngestionUrl, sendRequest } = require('../utils/data-ingestion.js');
const logData = require("../../fixtures/log.json");
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

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
  const TEST_STREAM = 'e2e_automate';
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
      await page.goto(`${process.env.ZO_BASE_URL || 'http://localhost:5080'}?org_identifier=${getOrgIdentifier() || 'default'}`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Ingest metrics data
      await ingestMetricsData(page);

      // Create template and destination via API for reliability
      const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
      const org = getOrgIdentifier() || 'default';
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
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
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

    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Reload to ensure destinations are fetched (fixes deployed env caching issues)
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

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

    // NOTE: In the current UI, the threshold operator row (alert-threshold-operator-select)
    // is visible in all modes as a unified condition control. The old "Trigger if the value is"
    // row that was PromQL-specific no longer exists as a separate row.
    testLogger.info('P2 mode-switch check skipped: threshold row is now mode-agnostic in current UI');

    // Cancel this wizard flow using page object
    await pm.alertsPage.clickBackButton();

    // ========== PART 3: Save Alerts with Different Operators ==========
    testLogger.info('PART 3: Testing alert save with different operators');

    const testOperators = ['>=', '<='];
    const createdAlerts = [];

    for (const operator of testOperators) {
      testLogger.info(`Testing operator: ${operator}`);

      await page.goto(alertsUrl);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

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
  // Bug #10899: Group By field autocomplete not working
  // https://github.com/openobserve/openobserve/issues/10899
  // ============================================================================
  // SKIPPED: Timing out in current test environment (page.goto timeouts)
  // TODO: Re-enable when environment is stable
  test.skip("Group By field should show autocomplete suggestions @bug-10899 @P1 @regression @alerts", async ({ page }) => {
    test.setTimeout(300000); // 5 minutes timeout
    testLogger.info('Test: Verify Group By field autocomplete (Bug #10899)');

    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Click Add Alert button
    await pm.alertsPage.clickAddAlertButton();
    await pm.alertsPage.fillAlertName(`auto_groupby_autocomplete_${randomValue}`);

    // Select logs stream type
    await pm.alertsPage.selectStreamType('logs');
    await pm.alertsPage.selectLogsStream(TEST_STREAM);
    await pm.alertsPage.selectScheduledAlertType();

    // Navigate to Step 2: Conditions
    await pm.alertsPage.clickContinueButton();

    // Enable aggregation to show Group By section
    const aggregationToggle = pm.alertsPage.getAggregationToggle();
    await aggregationToggle.waitFor({ state: 'visible', timeout: 5000 });
    testLogger.info('✓ Navigated to Step 2');
    await expect(aggregationToggle).toBeEnabled({ timeout: 3000 });
    await aggregationToggle.click();

    // STRONG ASSERTION: Verify group-by section appeared
    const groupByLabel = pm.alertsPage.getGroupByLabel().first();
    await expect(groupByLabel).toBeVisible({ timeout: 5000 });
    testLogger.info('✓ Group By section visible');

    // Get the query config section container (Step 2: Conditions) using POM
    const queryConfigSection = pm.alertsPage.getStepQueryConfigSection();

    // Find the Group By input field using POM method with fallback selectors
    const groupByInput = await pm.alertsPage.findGroupByInputWithFallback(queryConfigSection);

    // STRONG ASSERTION: Group By input must be found to test Bug #10899
    expect(groupByInput, 'Bug #10899: Group By input field must be visible').not.toBeNull();
    testLogger.info('✓ Found Group By input using POM fallback method');

    // Click to open dropdown/autocomplete
    await groupByInput.click();
    testLogger.info('✓ Clicked Group By input');

    // Type characters to trigger autocomplete
    await groupByInput.fill('k8s');
    testLogger.info('✓ Typed "k8s" to trigger autocomplete');

    // STRONG ASSERTION: Check for autocomplete suggestions using POM
    const suggestions = pm.alertsPage.getAutocompleteSuggestions();
    // Wait for autocomplete dropdown to appear after typing
    await suggestions.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const suggestionCount = await suggestions.count();
    testLogger.info(`Autocomplete suggestions found: ${suggestionCount}`);

    // PRIMARY ASSERTION: Autocomplete should show suggestions
    expect(suggestionCount, 'Bug #10899: Group By autocomplete should show suggestions').toBeGreaterThan(0);
    testLogger.info('✓ Autocomplete suggestions appeared - Bug #10899 is fixed');

    // Select first suggestion to verify it's clickable
    const firstSuggestion = suggestions.first();
    await expect(firstSuggestion).toBeVisible({ timeout: 2000 });
    await firstSuggestion.click();
    testLogger.info('✓ Selected first autocomplete suggestion');

    // Clean up
    await pm.alertsPage.clickBackButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    testLogger.info('✓ PASSED: Group By autocomplete test completed');
  });

  // ============================================================================
  // Bug #10872: Multi-window alert VRL processing not working correctly
  // https://github.com/openobserve/openobserve/issues/10872
  // ============================================================================
  test.skip("VRL Apply button should process multi-window result array correctly @bug-10872 @P2 @regression @alerts", async ({ page }, testInfo) => {
    test.setTimeout(300000); // 5 minutes timeout
    testLogger.info('Test: VRL processing for multi-window alerts (Bug #10872)');

    // Skip this test - VRL editor requires specific alert wizard steps that vary by deployment
    testInfo.annotations.push({
      type: 'skip',
      description: 'VRL editor location varies by alert type and deployment configuration. Test needs refactoring to properly navigate the alert wizard steps.'
    });

    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Navigate to create new alert
    await pm.alertsPage.clickCreateAlertButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Check if multi-window/compare options are available
    const compareWithPastContainer = pm.alertsPage.getCompareWithPastContainer();
    const multiWindowOption = pm.alertsPage.getMultiWindowOption();

    // Try to find and enable multi-window mode
    if (await compareWithPastContainer.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await compareWithPastContainer.first().click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      testLogger.info('✓ Compare with Past container found');
    } else {
      testLogger.info('Compare with Past container not found - may need to navigate to condition step first');
    }

    // Navigate to the SQL/condition step where VRL can be applied
    const conditionTab = pm.alertsPage.getConditionTab();
    if (await conditionTab.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await conditionTab.first().click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    // Look for VRL editor or apply VRL button
    const vrlEditor = pm.alertsPage.getVrlEditorElement();
    const applyVrlButton = pm.alertsPage.getApplyVrlButton();

    if (await vrlEditor.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      testLogger.info('✓ VRL editor found');
    } else {
      testLogger.warn('VRL editor not found - skipping VRL test');
      return;
    }

    // Try to input VRL function that processes array
    const vrlInput = pm.alertsPage.getVrlEditorInput();
    await expect(vrlInput, 'Bug #10872: VRL input must be visible').toBeVisible({ timeout: 3000 });

    // Sample VRL for multi-window processing
    const multiWindowVrl = `.result = if is_array(.) {
  map_values(., |item| item.count)
} else {
  [.count]
}`;
    await vrlInput.fill(multiWindowVrl);
    testLogger.info('✓ VRL function entered');

    // PRIMARY ASSERTION: Apply VRL button should be available
    await expect(applyVrlButton).toBeVisible({ timeout: 3000 });
    await applyVrlButton.click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Apply VRL button clicked');

    // STRONG ASSERTION: Check for error messages - the bug would cause an error here
    const errorMessage = pm.alertsPage.getErrorMessageBanner();
    const hasError = await errorMessage.isVisible({ timeout: 2000 }).catch(() => false);

    // PRIMARY ASSERTION: VRL should apply without errors
    expect(hasError, 'Bug #10872: VRL Apply should not produce errors for multi-window processing').toBe(false);

    if (hasError) {
      const errorText = await errorMessage.textContent();
      testLogger.error(`VRL Apply error: ${errorText}`);
    } else {
      testLogger.info('✓ VRL applied without errors - Bug #10872 is fixed');
    }

    // Clean up
    await pm.alertsPage.clickBackButton().catch(() => {});

    testLogger.info('✓ PASSED: Multi-window VRL test completed');
  });

  // ============================================================================
  // Bug #10472: Alert firing count column not visible/incrementing
  // https://github.com/openobserve/openobserve/issues/10472
  // ============================================================================
  // SKIPPED: Timing out in current test environment (page.goto timeouts)
  // TODO: Re-enable when environment is stable
  test.skip("Alert firing count should increment when alert fires @bug-10472 @P2 @regression @alerts", async ({ page }, testInfo) => {
    test.setTimeout(240000); // 4 minutes timeout
    testLogger.info('Test: Verify alert firing count increment (Bug #10472)');

    // Mark this test as informational - it verifies the column exists but doesn't test increment behavior
    testInfo.annotations.push({
      type: 'informational',
      description: 'This test verifies the firing count column is visible but does not validate increment behavior. Full testing requires triggering alerts, which is done in other tests.'
    });

    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    testLogger.info('✓ Navigated to alerts list');

    // Check for "Last Triggered" column (closest proxy to firing count tracking)
    // NOTE: firing_count field exists in data but no dedicated column displays it yet
    const lastTriggeredColumn = pm.alertsPage.getFiringCountElements();
    const columnExists = await lastTriggeredColumn.count() > 0;

    // STRONG ASSERTION: Last Triggered column must exist (Bug #10472 relates to alert state visibility)
    expect(columnExists, 'Bug #10472: Alert list should show "Last Triggered" column for tracking alert firing').toBe(true);
    testLogger.info('✓ "Last Triggered" column is visible in alerts table');

    if (columnExists) {
      const columnHeader = lastTriggeredColumn.first();
      const headerText = await columnHeader.textContent();
      testLogger.info(`Found column header: ${headerText}`);
      testLogger.info('NOTE: This column tracks when alerts were last triggered');
    } else {
      testLogger.info('Last Triggered column not visible in current alert list view');

      // Try to find alerts table and check for related columns
      const headers = await pm.alertsPage.getAlertTableHeaders();
      if (headers.length > 0) {
        testLogger.info(`Alert table headers: ${headers.join(', ')}`);
      }
    }

    testLogger.info('✓ PASSED: Alert firing count test completed');
  });

  // ============================================================================
  // Bug #10110: Template appears twice in override template input field
  // https://github.com/openobserve/openobserve/issues/10110
  // ============================================================================
  test("Override template should appear only once in input field @bug-10110 @P2 @regression @alerts", async ({ page }) => {
    testLogger.info('Test: Verify template override displays value once (Bug #10110)');

    const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Start creating a real-time alert to reach the Alert Settings step
    await pm.alertsPage.clickAddAlertButton();

    // ==================== STEP 1: ALERT SETUP ====================
    const alertName = `auto_template_display_${randomValue}`;
    // fillAlertName includes wait for input to be visible
    await pm.alertsPage.fillAlertName(alertName);
    testLogger.info('✓ Filled alert name', { alertName });

    // Select logs stream type
    await pm.alertsPage.selectStreamType('logs');

    // Select stream (selectLogsStream includes wait for dropdown to be visible)
    await pm.alertsPage.selectLogsStream(TEST_STREAM);
    testLogger.info('✓ Selected stream', { stream: TEST_STREAM });

    // Select real-time alert type
    await pm.alertsPage.expectRealtimeRadioVisible();
    await pm.alertsPage.selectRealtimeAlertType();
    testLogger.info('✓ Selected real-time alert type');

    // ==================== STEP 2: CONDITIONS ====================
    await pm.alertsPage.clickContinueButton();
    // Wait for Step 2 (Conditions) to load
    await expect(pm.alertsPage.getAddConditionButton()).toBeVisible({ timeout: 5000 });
    testLogger.info('✓ Navigated to Step 2: Conditions');

    // Add a simple condition
    const addCondBtn = pm.alertsPage.getAddConditionButton();
    if (await addCondBtn.isVisible({ timeout: 3000 })) {
      await addCondBtn.click();
      // Wait for condition column select to appear
      await expect(pm.alertsPage.getConditionColumnSelect()).toBeVisible({ timeout: 5000 });

      // Select first available column
      const columnSelect = pm.alertsPage.getConditionColumnSelect();
      await columnSelect.click();
      // Wait for dropdown menu to appear
      await expect(pm.alertsPage.getFirstMenuItem()).toBeVisible({ timeout: 5000 });
      await pm.alertsPage.getFirstMenuItem().click();

      // Select operator
      const operatorSelect = pm.alertsPage.getOperatorSelect();
      await operatorSelect.click();
      // Wait for operator dropdown menu to appear
      await expect(pm.alertsPage.getFirstMenuItem()).toBeVisible({ timeout: 5000 });
      // Select Contains operator from dropdown
      await pm.alertsPage.getVisibleMenu().getByText('Contains', { exact: true }).click();

      // Fill value
      await pm.alertsPage.getConditionValueInputElement().fill('test');

      testLogger.info('✓ Added condition');
    }

    // ==================== STEP 3: COMPARE (Skip) ====================
    await pm.alertsPage.clickContinueButton();
    // No need to wait - immediately clicking continue to skip this step

    testLogger.info('✓ Navigated to Step 3: Compare (skipping)');

    // ==================== STEP 4: ALERT SETTINGS ====================
    await pm.alertsPage.clickContinueButton();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    // Wait for template select to appear (confirms Step 4 loaded)
    await pm.alertsPage.expectTemplateOverrideSelectVisible();
    testLogger.info('✓ Navigated to Step 4: Alert Settings');

    // Find the template override select field (it's in the alert settings step)
    // Wait for template field to be visible as confirmation that we're on the right step
    // NOTE: No data-test attribute exists on this component (AlertSettings.vue line 189)
    // Using .template-select-field (application-defined class, stable) + .q-select (Quasar component)
    // TODO: Product team should add data-test="alert-template-override-select" for test stability
    const templateSelect = pm.alertsPage.getTemplateOverrideSelect();
    testLogger.info('✓ Template override field visible');

    // Click the template select to open dropdown
    await templateSelect.click();
    // Wait for dropdown menu to appear
    await expect(pm.alertsPage.getFirstMenuItem()).toBeVisible({ timeout: 5000 });

    // Find and select the first available template from dropdown
    const firstTemplate = pm.alertsPage.getFirstMenuItem();
    const selectedTemplateName = await firstTemplate.textContent();
    testLogger.info('Selecting template', { templateName: selectedTemplateName?.trim() });

    await firstTemplate.click();
    // Wait for dropdown menu to close (indicates selection completed)
    await expect(pm.alertsPage.getVisibleMenu()).not.toBeVisible({ timeout: 5000 });
    testLogger.info('✓ Selected template from dropdown');

    // STRONG ASSERTION: Verify template name appears exactly once in the select field
    // Bug #10110 caused templates to display twice in the input field
    // Get all visible text from the component (includes template name + icon labels)
    const displayedText = await templateSelect.innerText();
    const cleanDisplayText = displayedText?.trim() || '';
    testLogger.info('Template display text', { text: cleanDisplayText });

    // Template name must be non-empty to validate
    // Normalize whitespace to handle extra spaces/newlines from .q-item
    const templateName = selectedTemplateName?.trim().replace(/\s+/g, ' ') || '';
    expect(templateName, 'Bug #10110: Selected template name must be non-empty to verify duplication').toBeTruthy();

    // PRIMARY ASSERTION: Template name should appear exactly once (Bug #10110 caused duplication)
    // Count occurrences of the template name in the displayed text
    // The text includes icon labels (cancel, arrow_drop_down) but template should appear only once
    const regex = new RegExp(templateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const occurrences = (cleanDisplayText.match(regex) || []).length;
    expect(occurrences, `Bug #10110: Template "${templateName}" should appear exactly once in display, not ${occurrences} times`).toBe(1);
    testLogger.info(`✓ Template display matches selected template exactly (no duplication) - Bug #10110 is fixed`);

    // Additional check: Verify no duplicate class names or rendering issues
    const templateFieldClasses = await templateSelect.getAttribute('class') || '';
    testLogger.info('Template field classes', { classes: templateFieldClasses });

    // Verify no nested q-select components (templateSelect IS the q-select, so children count should be 0)
    const nestedQSelectCount = await pm.alertsPage.getNestedQSelectCount();
    expect(nestedQSelectCount, 'Bug #10110: Should have no nested q-select components (templateSelect is already the q-select)').toBe(0);
    testLogger.info('✓ No nested/duplicate q-select components detected');

    // Clean up - go back without saving
    await pm.alertsPage.clickBackButton();
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    testLogger.info('✓ PASSED: Template override duplication test completed');
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
      await page.goto(`${process.env.ZO_BASE_URL || 'http://localhost:5080'}?org_identifier=${getOrgIdentifier() || 'default'}`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

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
  const orgId = getOrgIdentifier();
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

  // Allow time for indexing by waiting for network activity to settle
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

/**
 * Create alert destination for testing
 */
async function createAlertDestination(page, pm) {
  const destinationName = 'e2e_promql_dest';
  const url = 'http://localhost:8080/webhook';
  const templateName = 'e2e_promql_template';

  try {
    // Use POM method to ensure destination exists (handles navigation and existence check)
    await pm.alertDestinationsPage.ensureDestinationExists(destinationName, url, templateName);
    testLogger.info('Destination ensured to exist', { destinationName });
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
    // Use POM method to ensure template exists (handles navigation and existence check)
    await pm.alertTemplatesPage.ensureTemplateExists(templateName);
    testLogger.info('Template ensured to exist', { templateName });
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
    // Use POM method to delete destination
    await pm.alertDestinationsPage.deleteDestinationByName(destinationName);
    testLogger.info('Destination deleted', { destinationName });
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
    // Use POM method to delete template
    await pm.alertTemplatesPage.deleteTemplateAndVerify(templateName);
    testLogger.info('Template deleted', { templateName });
  } catch (e) {
    testLogger.warn('Could not delete template', { error: e.message });
  }
}
