/**
 * Alerts Regression Bugs — Batch 1
 *
 * Covers: #10110, #11577
 *
 * Tests run in PARALLEL.
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
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Clicked Add Alert button');

    // Fill alert name
    const uniqueId = Date.now();
    const alertName = `test_alert_override_${uniqueId}`;
    const alertNameInput = page.locator('[data-test="add-alert-name-input"]');
    if (await alertNameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await alertNameInput.fill(alertName);
      testLogger.info(`✓ Filled alert name: ${alertName}`);
    }

    // Select a stream (required before template override is accessible)
    const streamDropdown = page.locator('[data-test="log-search-index-list-select-stream"]');
    if (await streamDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      await streamDropdown.click();
      await page.waitForTimeout(500);

      const defaultOption = page.getByRole('option', { name: 'default' }).first();
      const firstOption = page.getByRole('option').first();

      if (await defaultOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await defaultOption.click();
        testLogger.info('✓ Selected stream: default');
      } else if (await firstOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await firstOption.click();
        testLogger.info('✓ Selected first available stream');
      }
      await page.waitForTimeout(1000);
    }

    // Add a condition to proceed through the wizard
    const addConditionBtn = page.locator('[data-test="alert-conditions-add-condition-btn"]');
    if (await addConditionBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addConditionBtn.click();
      await page.waitForTimeout(500);
      testLogger.info('✓ Added condition');
    }

    // Navigate through wizard steps to reach template override
    const continueBtn = page.locator('button').filter({ hasText: /Continue|Next|Save/i }).first();
    let stepsAdvanced = 0;

    while (stepsAdvanced < 5) {
      if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await continueBtn.click();
        await page.waitForTimeout(1000);
        stepsAdvanced++;
        testLogger.info(`✓ Advanced to next step (${stepsAdvanced})`);
      } else {
        break;
      }
    }

    // Look for template override select/input
    const templateOverrideSelect = page.locator('.template-select-field, [data-test*="template-override"], [data-test*="template-select"]').first();
    const templateOverrideInput = page.locator('.template-select-field input, [data-test*="template-override"] input').first();

    const overrideFieldVisible = await templateOverrideSelect.isVisible({ timeout: 3000 }).catch(() => false) ||
                                 await templateOverrideInput.isVisible({ timeout: 3000 }).catch(() => false);

    // The template override field is the surface under test — its absence means
    // we cannot verify the bug fix, so this is a hard failure.
    expect(overrideFieldVisible,
      'Bug #10110: Template override field must be present to verify the fix'
    ).toBeTruthy();

    testLogger.info('✓ Template override field found');

    // If it's a select dropdown, try opening it and picking a template
    let templateSelected = false;
    if (await templateOverrideSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await templateOverrideSelect.click();
      await page.waitForTimeout(500);

      const templateOption = page.getByRole('option').first();
      if (await templateOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        const templateText = await templateOption.textContent();
        await templateOption.click();
        await page.waitForTimeout(500);
        templateSelected = true;
        testLogger.info(`✓ Selected template: ${templateText?.trim()}`);
      }
    }

    // A template MUST be selected to exercise the duplication bug;
    // otherwise the test isn't actually checking anything.
    expect(templateSelected,
      'Bug #10110: A template must be selected to verify it is not duplicated in the input'
    ).toBeTruthy();

    // Get the displayed/selected value
    const selectedText = await templateOverrideSelect.textContent().catch(() => '');
    const inputValue = await templateOverrideInput.inputValue().catch(() => '');

    testLogger.info(`Template override display text: "${selectedText?.trim()}"`);
    testLogger.info(`Template override input value: "${inputValue}"`);

    const displayValue = selectedText?.trim() || inputValue;

    expect(displayValue,
      'Bug #10110: Template override must show a selected value'
    ).toBeTruthy();

    // Check for duplication — split by common separators and verify no repeats
    const parts = displayValue.split(/[,;\s]+/).filter(Boolean);
    const uniqueParts = [...new Set(parts)];

    testLogger.info(`Template parts: ${JSON.stringify(parts)}, unique: ${JSON.stringify(uniqueParts)}`);

    expect(parts.length,
      'Bug #10110: Template should not appear twice in override input'
    ).toBe(uniqueParts.length);

    testLogger.info('✓ PASSED: Template not duplicated in override input');
  });

  // ==========================================================================
  // Bug #11577: Preview alert y-axis should have type numbers
  // https://github.com/openobserve/openobserve/issues/11577
  // ==========================================================================
  test("Alert preview chart y-axis should display numeric values, not raw strings", {
    tag: ['@bug-11577', '@P1', '@regression', '@alertsRegression', '@alertsRegressionAlertPreview']
  }, async ({ page }) => {
    testLogger.info('Test: Verify alert preview y-axis shows numbers (Bug #11577)');

    // Navigate to alerts page
    await pm.commonActions.navigateToAlerts();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Navigated to alerts page');

    // Click Add Alert
    const addAlertBtn = page.locator('[data-test="alert-list-add-alert-btn"]');
    if (!(await addAlertBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      testLogger.warn('Add Alert button not visible — skipping');
      test.skip(true, 'Add Alert button not available');
      return;
    }
    await addAlertBtn.click();
    await page.waitForTimeout(1500);

    // Fill alert name
    const uniqueId = Date.now();
    const alertName = `test_preview_yaxis_${uniqueId}`;
    const alertNameInput = page.locator('[data-test="add-alert-name-input"]');
    if (await alertNameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await alertNameInput.fill(alertName);
      testLogger.info(`✓ Filled alert name: ${alertName}`);
    }

    // Select a stream
    const streamDropdown = page.locator('[data-test="log-search-index-list-select-stream"]');
    if (await streamDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      await streamDropdown.click();
      await page.waitForTimeout(500);
      const defaultOption = page.getByRole('option', { name: 'default' }).first();
      if (await defaultOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await defaultOption.click();
        testLogger.info('✓ Selected stream: default');
      }
      await page.waitForTimeout(500);
    }

    // Add a condition (required before preview is shown)
    const addConditionBtn = page.locator('[data-test="alert-conditions-add-condition-btn"]');
    if (await addConditionBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addConditionBtn.click();
      await page.waitForTimeout(1000);
      testLogger.info('✓ Added condition');
    }

    // Navigate through wizard to reach preview step
    const navButtons = page.locator('button').filter({ hasText: /Continue|Next|Save|Preview/i });
    let stepsAdvanced = 0;
    while (stepsAdvanced < 6) {
      const nextBtn = navButtons.first();
      if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(1500);
        stepsAdvanced++;
        testLogger.info(`✓ Advanced to next step (${stepsAdvanced})`);
      } else {
        break;
      }
    }

    // Look for preview chart with y-axis values
    const chartSelectors = [
      '[data-test*="chart"]',
      '[data-test*="preview"] canvas',
      '[data-test*="alert-preview-chart"]',
      '.chart-container canvas',
      '[class*="chart"] canvas',
      'canvas',
    ];

    let chartFound = false;
    let yAxisContent = '';
    for (const sel of chartSelectors) {
      const chart = page.locator(sel).first();
      if (await chart.isVisible({ timeout: 3000 }).catch(() => false)) {
        chartFound = true;
        testLogger.info(`✓ Found preview chart via: ${sel}`);

        const yAxisTexts = page.locator('svg text, canvas').first();
        yAxisContent = await yAxisTexts.textContent().catch(() => '') || '';
        testLogger.info(`Chart text content sample: "${yAxisContent.substring(0, 100)}"`);
        break;
      }
    }

    // The chart is the surface under test — its absence means the bug cannot
    // be verified and the test should fail, not silently pass.
    expect(chartFound,
      'Bug #11577: Alert preview must show a chart with numeric y-axis values'
    ).toBeTruthy();

    // Bug #11577 specifically: y-axis labels must be numbers, not raw strings.
    // Check that chart text content contains at least one numeric value.
    const hasNumericValue = /\d/.test(yAxisContent);
    expect(hasNumericValue,
      'Bug #11577: Alert preview chart y-axis must contain numeric values, not raw strings'
    ).toBeTruthy();

    testLogger.info('✓ PASSED: Alert preview chart y-axis verified');
  });

  test.afterEach(async () => {
    testLogger.info('Alerts regression batch-1 test completed');
  });
});
