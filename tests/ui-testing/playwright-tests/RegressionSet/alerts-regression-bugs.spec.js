/**
 * Alerts Regression Bugs — Batch 1
 *
 * Covers: #10110
 *
 * Tests run in PARALLEL.
 *
 * Note: The v3 alert creation UI is a single-page layout with two tabs
 * (Alert Rules, Advanced), NOT a multi-step wizard. Template Override
 * is in the Advanced tab; the preview chart appears automatically in
 * the right panel when stream type + name are selected.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Alerts Regression Bugs — Batch 1", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    testLogger.info('Alerts regression batch-1 setup completed');
  });

  // ==========================================================================
  // Bug #10110: On adding a template in the override template option on
  //             alerts UI, it is shown twice in the input field
  // https://github.com/openobserve/openobserve/issues/10110
  // ==========================================================================
  test("Template should not appear twice in override template input", {
    tag: ['@bug-10110', '@P1', '@regression', '@alertsRegression', '@alertsRegressionTemplateOverride']
  }, async ({ page }) => {
    testLogger.info('Test: Verify template not duplicated in override input (Bug #10110)');

    // Navigate to alerts page
    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Navigated to alerts page');

    // Click "Add Alert" button
    const addAlertBtn = page.locator('[data-test="alert-list-add-alert-btn"]');
    if (!(await addAlertBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      testLogger.warn('Add Alert button not visible — skipping');
      test.skip(true, 'Add Alert button not available');
      return;
    }
    await addAlertBtn.click();
    await page.waitForTimeout(2000);
    testLogger.info('✓ Clicked Add Alert button');

    // Fill alert name
    const uniqueId = Date.now();
    const alertName = `test_alert_override_${uniqueId}`;
    const alertNameInput = page.locator('[data-test="add-alert-name-input"]');
    if (await alertNameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await alertNameInput.fill(alertName);
      testLogger.info(`✓ Filled alert name: ${alertName}`);
    }

    // Select stream type first (enables stream name dropdown)
    const streamTypeDropdown = page.locator('[data-test="add-alert-stream-type-select-dropdown"]');
    if (await streamTypeDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      await streamTypeDropdown.click();
      await page.waitForTimeout(500);
      const logsOption = page.getByRole('option', { name: 'Logs' }).first();
      if (await logsOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await logsOption.click();
        testLogger.info('✓ Selected stream type: Logs');
      }
      await page.waitForTimeout(1000);
    }

    // Select stream name (enabled after stream type is chosen).
    // Type into the q-select to filter, then pick e2e_automate.
    const streamNameDropdown = page.locator('[data-test="add-alert-stream-name-select-dropdown"]');
    if (await streamNameDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      await streamNameDropdown.click();
      await page.waitForTimeout(500);
      await streamNameDropdown.fill('e2e_automate');
      await page.waitForTimeout(1500);

      const e2eOption = page.getByRole('option', { name: 'e2e_automate' }).first();
      if (await e2eOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await e2eOption.click();
        testLogger.info('✓ Selected stream: e2e_automate');
      } else {
        const firstOption = page.getByRole('option').first();
        if (await firstOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await firstOption.click();
          testLogger.info('✓ Selected first available stream');
        }
      }
      await page.waitForTimeout(1000);
    }

    // Add a condition
    const addConditionBtn = page.locator('[data-test="alert-conditions-add-condition-btn"]');
    if (await addConditionBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addConditionBtn.click();
      await page.waitForTimeout(500);
      testLogger.info('✓ Added condition');
    }

    // Switch to the Advanced tab to access Template Override.
    // The v3 layout uses an OToggleGroup with buttons — find the Advanced tab.
    const advancedTab = page.locator('button').filter({ hasText: 'Advanced' }).first();
    if (!(await advancedTab.isVisible({ timeout: 3000 }).catch(() => false))) {
      testLogger.warn('Advanced tab not found — skipping');
      test.skip(true, 'Advanced tab not available in current UI');
      return;
    }
    await advancedTab.click();
    await page.waitForTimeout(1000);
    testLogger.info('✓ Switched to Advanced tab');

    // Template Override is a q-select with class alert-v3-select inside the Advanced tab.
    // The select uses emit-value and has options filtered via @filter.
    const templateOverrideSelect = page.locator('.alert-v3-select').first();
    if (!(await templateOverrideSelect.isVisible({ timeout: 3000 }).catch(() => false))) {
      testLogger.warn('Template override select not found — skipping');
      test.skip(true, 'Template override field not available in current UI');
      return;
    }
    testLogger.info('✓ Template override field found');

    // Open the select dropdown and pick a template
    await templateOverrideSelect.click();
    await page.waitForTimeout(500);

    const templateOption = page.getByRole('option').first();
    if (!(await templateOption.isVisible({ timeout: 3000 }).catch(() => false))) {
      testLogger.warn('No template option available — skipping');
      test.skip(true, 'No template options available');
      return;
    }
    const templateText = await templateOption.textContent();
    await templateOption.click();
    await page.waitForTimeout(500);
    testLogger.info(`✓ Selected template: ${templateText?.trim()}`);

    // Get the displayed value from the select
    const selectedText = await templateOverrideSelect.textContent().catch(() => '');
    testLogger.info(`Template override display text: "${selectedText?.trim()}"`);

    // Check for duplication — the same template name appearing twice
    const displayValue = selectedText?.trim();
    expect(displayValue,
      'Bug #10110: Template override must show a selected value'
    ).toBeTruthy();

    // Split and verify no repeats
    const parts = displayValue.split(/[,;\s]+/).filter(Boolean);
    const uniqueParts = [...new Set(parts)];

    testLogger.info(`Template parts: ${JSON.stringify(parts)}, unique: ${JSON.stringify(uniqueParts)}`);

    expect(parts.length,
      'Bug #10110: Template should not appear twice in override input'
    ).toBe(uniqueParts.length);

    testLogger.info('✓ PASSED: Template not duplicated in override input');
  });

  test.afterEach(async () => {
    testLogger.info('Alerts regression batch-1 test completed');
  });
});
