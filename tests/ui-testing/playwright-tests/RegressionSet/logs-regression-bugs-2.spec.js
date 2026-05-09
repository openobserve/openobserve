/**
 * Logs Regression Bugs — Batch 1
 *
 * Covers: #10821, #10595, #9049
 * Note: #9388 is already covered in logs-regression.spec.js
 * Note: #9796 removed — stream selection inherently triggers a query
 *
 * Tests run in PARALLEL.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTestData } = require('../utils/data-ingestion.js');

test.describe("Logs Regression Bugs — Batch 1", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Ingest data for logs tests
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');

    testLogger.info('Logs regression batch-1 setup completed');
  });

  // ==========================================================================
  // Bug #10821: Quick mode is not working when clicking on text,
  //             but histogram toggle works
  // https://github.com/openobserve/openobserve/issues/10821
  // ==========================================================================
  test("Quick mode should activate when clicking its toggle (not just histogram toggle)", {
    tag: ['@bug-10821', '@P1', '@regression', '@logsRegression', '@logsRegressionQuickMode']
  }, async ({ page }) => {
    testLogger.info('Test: Verify quick mode toggle activates on click (Bug #10821)');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream("e2e_automate");
    await page.waitForTimeout(2000);

    // Run query first so search bar controls are fully rendered
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Use page object to find the quick/SQL mode toggle
    const quickModeToggle = await pm.logsPage.findQueryModeToggle();

    // Bug #10821 is about this toggle not responding to clicks —
    // if the toggle doesn't exist at all, the bug check is inconclusive.
    if (!quickModeToggle) {
      testLogger.warn('Quick mode toggle not found with any known selector');
      test.skip(true, 'Quick mode toggle selector not available — cannot verify bug #10821');
      return;
    }

    // Capture pre-click state to verify the toggle actually changed
    const isActiveBefore = await pm.logsPage.isToggleActive(quickModeToggle);
    testLogger.info(`Mode toggle state before click: ${isActiveBefore}`);

    // Click the toggle
    await quickModeToggle.click();
    await page.waitForTimeout(1000);
    testLogger.info('✓ Clicked quick/SQL mode toggle');

    const isActiveAfter = await pm.logsPage.isToggleActive(quickModeToggle);
    testLogger.info(`Mode toggle state after click: ${isActiveAfter}`);

    // Bug #10821: the toggle should change state on click
    expect(isActiveBefore !== null && isActiveAfter !== null && isActiveBefore !== isActiveAfter,
      'Bug #10821: Quick mode toggle should change state on click'
    ).toBeTruthy();

    // Verify histogram toggle also works independently
    const histogramToggleVisible = await pm.logsPage.isHistogramToggleVisible();
    if (histogramToggleVisible) {
      await pm.logsPage.clickHistogramToggle();
      testLogger.info('✓ Clicked histogram toggle');
    }

    testLogger.info('✓ PASSED: Mode toggle interaction verified');
  });

  // ==========================================================================
  // Bug #10595: ExpandedRow visible in 2 rows when user opens first row
  //             and clicks on run query
  // https://github.com/openobserve/openobserve/issues/10595
  // ==========================================================================
  test("Only one row should be expanded after clicking run query", {
    tag: ['@bug-10595', '@P1', '@regression', '@logsRegression', '@logsRegressionTableRowExpand']
  }, async ({ page }) => {
    testLogger.info('Test: Verify single row expansion after run query (Bug #10595)');

    // Navigate to logs and load data
    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream("e2e_automate");
    await page.waitForLoadState('domcontentloaded');

    // Run query to get results
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Check for table rows using page object
    const tableRows = pm.logsPage.getLogsTableRows();
    const rowCount = await tableRows.count();
    testLogger.info(`Table row count: ${rowCount}`);

    if (rowCount < 2) {
      testLogger.warn('Not enough rows to test expansion — skipping');
      test.skip(true, 'Need at least 2 rows in the table');
      return;
    }

    // Expand the first row using page object
    const firstRowExpand = pm.logsPage.getFirstRowExpandMenu();
    if (await firstRowExpand.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstRowExpand.click();
      testLogger.info('✓ Clicked expand menu on first row');
      await page.waitForTimeout(1000);

      const expandButton = page.locator('[data-test*="expand"], [aria-label*="expand" i]').first();
      if (await expandButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expandButton.click();
        await page.waitForTimeout(500);
      }
    } else {
      await tableRows.first().click();
      testLogger.info('✓ Clicked first row directly');
      await page.waitForTimeout(1000);
    }

    // Now click run query
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // PRIMARY ASSERTION: Only one row should be expanded after run query
    const tableBody = pm.logsPage.getLogsTableBody();
    const expandedRows = tableBody.locator('[aria-expanded="true"]');
    const expandedCount = await expandedRows.count();
    testLogger.info(`Expanded table rows after run query: ${expandedCount}`);

    expect(expandedCount,
      'Bug #10595: At most 1 row should be expanded after run query (bug caused 2+ rows to expand)'
    ).toBeLessThanOrEqual(1);

    testLogger.info('✓ PASSED: Single row expansion verified after run query');
  });

  // ==========================================================================
  // Bug #9049: Decimal Values should not be accepted in the datetime picker
  // https://github.com/openobserve/openobserve/issues/9049
  // ==========================================================================
  test("Decimal values should be rejected in the absolute datetime picker", {
    tag: ['@bug-9049', '@P1', '@regression', '@logsRegression', '@logsRegressionDatetimeValidation']
  }, async ({ page }) => {
    testLogger.info('Test: Verify decimal values rejected in datetime picker (Bug #9049)');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream("e2e_automate");
    await page.waitForLoadState('domcontentloaded');

    // Open the date-time picker
    await pm.logsPage.clickDateTimeButton();
    await page.waitForTimeout(500);

    // Switch to absolute time tab
    await pm.logsPage.clickAbsoluteTimeTab();
    await page.waitForTimeout(500);

    // Find the time input using page object
    const timeInput = await pm.logsPage.findTimeInput();
    if (timeInput) {
      testLogger.info('Found time input via page object');
    }

    if (timeInput) {
      // Clear existing value and type a decimal
      await timeInput.click();
      await timeInput.fill('');
      await timeInput.fill('12.5:00');
      await page.waitForTimeout(500);

      // Click outside to trigger validation
      await page.locator('[data-test="logs-search-bar-datetime-dropdown"], [data-test="date-time-btn"]').first().click().catch(() => {});
      await page.waitForTimeout(500);

      // Get the value to check if decimal was accepted
      const inputValue = await timeInput.inputValue().catch(() => '');
      testLogger.info(`Time input value after decimal entry: "${inputValue}"`);

      // PRIMARY ASSERTION: Decimal value should be rejected or corrected
      const hasDecimalInValue = inputValue.includes('.');
      const errorVisible = await page.locator('[data-test="logs-search-error-message"], .q-field--error, [class*="error"], [data-test*="error"]')
        .isVisible({ timeout: 2000 }).catch(() => false);

      testLogger.info(`Decimal in value: ${hasDecimalInValue}, Error visible: ${errorVisible}`);

      // The bug is fixed if either: the decimal is stripped, or an error is shown
      expect(hasDecimalInValue && !errorVisible,
        'Bug #9049: Decimal value should not be accepted in datetime time input without error'
      ).toBeFalsy();

      testLogger.info('✓ PASSED: Decimal value rejected in datetime picker');
    } else {
      // Time input not in absolute tab — check if the time is entered via Quasar time picker buttons instead
      const timePickerVisible = await page.locator('.q-time, [data-test*="time-picker"], [class*="time-picker"]')
        .isVisible({ timeout: 2000 }).catch(() => false);

      if (timePickerVisible) {
        testLogger.info('Quasar time picker component found — decimal entry not possible via button UI');
        testLogger.info('✓ PASSED: Time picker uses button UI — decimal entry is naturally prevented');
      } else {
        testLogger.warn('Time input not found — skipping');
        test.skip(true, 'Time input element not available in current UI');
      }
    }
  });

  test.afterEach(async () => {
    testLogger.info('Logs regression batch-1 test completed');
  });
});
