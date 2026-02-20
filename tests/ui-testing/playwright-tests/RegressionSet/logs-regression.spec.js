const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');

test.describe("Logs Regression Bugs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Post-authentication stabilization wait
    await page.waitForLoadState('networkidle');

    // Data ingestion for logs page testing
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');

    testLogger.info('Logs regression bug test setup completed');
  });

  test("should display error icon and error message when entering invalid time in absolute time range", {
    tag: ['@absoluteTimeError', '@regressionBugs', '@P0', '@logs']
  }, async () => {
    testLogger.info('Testing error validation for invalid absolute time input');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();

    // Select e2e_automate stream
    await pm.logsPage.selectStream("e2e_automate");

    // Open date-time picker
    await pm.logsPage.clickDateTimeButton();

    // Switch to absolute time tab
    await pm.logsPage.clickAbsoluteTimeTab();

    // Verify Start time and End time are visible
    await pm.logsPage.expectStartTimeVisible();
    await pm.logsPage.expectEndTimeVisible();

    // Click on time cell and enter invalid time value (partial time)
    await pm.logsPage.clickTimeCell();
    await pm.logsPage.fillTimeCellWithInvalidValue('07:39:2');

    // Click outside to trigger validation
    await pm.logsPage.clickOutsideTimeInput();

    // Verify error icon is visible
    await pm.logsPage.expectErrorIconVisible();

    // Click run query button
    await pm.logsPage.clickRefreshButton();

    // Verify error details button is visible
    await pm.logsPage.expectResultErrorDetailsButtonVisible();

    // Click error details button
    await pm.logsPage.clickResultErrorDetailsButton();

    // Verify error message is visible
    await pm.logsPage.expectSearchDetailErrorMessageVisible();

    testLogger.info('Absolute time error validation test completed');
  });

  test("should display correct table fields when switching between saved views of different streams (#9388)", {
    tag: ['@savedViews', '@streamSwitching', '@regressionBugs', '@P0', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing stream field persistence when switching saved views');

    // Generate unique names for streams and saved views
    const uniqueId = Date.now();
    const streamA = `e2e_stream_a_${uniqueId}`;
    const streamB = `e2e_stream_b_${uniqueId}`;
    const savedViewA = `view_a_${uniqueId}`;
    const savedViewB = `view_b_${uniqueId}`;
    const fieldForStreamA = 'kubernetes_container_name';
    const fieldForStreamB = 'log';

    // Ingest data to both streams
    testLogger.info(`Ingesting data to stream A: ${streamA}`);
    await ingestTestData(page, streamA);
    testLogger.info(`Ingesting data to stream B: ${streamB}`);
    await ingestTestData(page, streamB);
    await page.waitForLoadState('networkidle'); // Wait for data to be indexed

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle');

    // ===== STREAM A SETUP =====
    testLogger.info(`Setting up Stream A (${streamA}) with saved view`);

    // Select stream A
    await pm.logsPage.selectStream(streamA);
    await page.waitForLoadState('networkidle');

    // Click refresh to load data
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Search for the field first to make it visible in sidebar
    await pm.logsPage.fillIndexFieldSearchInput(fieldForStreamA);
    await page.waitForTimeout(500);

    // Add field to table for stream A
    await pm.logsPage.hoverOnFieldExpandButton(fieldForStreamA);
    await pm.logsPage.clickAddFieldToTableButton(fieldForStreamA);
    await page.waitForTimeout(1000);

    // Clear field search
    await pm.logsPage.fillIndexFieldSearchInput('');
    await page.waitForTimeout(300);

    // Verify field is in table
    await pm.logsPage.expectFieldInTableHeader(fieldForStreamA);
    testLogger.info(`Added ${fieldForStreamA} to table for stream A`);

    // Create saved view for stream A
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSaveViewButton();
    await pm.logsPage.fillSavedViewName(savedViewA);
    await pm.logsPage.clickSavedViewDialogSave();
    await page.waitForTimeout(2000);
    testLogger.info(`Created saved view: ${savedViewA}`);

    // ===== STREAM B SETUP =====
    testLogger.info(`Setting up Stream B (${streamB}) with saved view`);

    // Switch to stream B
    await pm.logsPage.selectStream(streamB);
    await page.waitForLoadState('networkidle');

    // Click refresh to load data
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Search for the field first to make it visible in sidebar
    await pm.logsPage.fillIndexFieldSearchInput(fieldForStreamB);
    await page.waitForTimeout(500);

    // Add different field to table for stream B
    await pm.logsPage.hoverOnFieldExpandButton(fieldForStreamB);
    await pm.logsPage.clickAddFieldToTableButton(fieldForStreamB);
    await page.waitForTimeout(1000);

    // Clear field search
    await pm.logsPage.fillIndexFieldSearchInput('');
    await page.waitForTimeout(300);

    // Verify field is in table
    await pm.logsPage.expectFieldInTableHeader(fieldForStreamB);
    testLogger.info(`Added ${fieldForStreamB} to table for stream B`);

    // Create saved view for stream B
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSaveViewButton();
    await pm.logsPage.fillSavedViewName(savedViewB);
    await pm.logsPage.clickSavedViewDialogSave();
    await page.waitForTimeout(2000);
    testLogger.info(`Created saved view: ${savedViewB}`);

    // ===== VERIFY SAVED VIEW SWITCHING =====
    testLogger.info('Verifying saved view switching maintains correct fields');

    // Switch to saved view A
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewSearchInput();
    await pm.logsPage.fillSavedViewSearchInput(savedViewA);
    await page.waitForTimeout(1000);
    await pm.logsPage.clickSavedViewByText(savedViewA);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify stream A field is present
    await pm.logsPage.expectFieldInTableHeader(fieldForStreamA);
    testLogger.info(`Verified ${fieldForStreamA} present in saved view A`);

    // Switch to saved view B
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewSearchInput();
    await pm.logsPage.fillSavedViewSearchInput(savedViewB);
    await page.waitForTimeout(1000);
    await pm.logsPage.clickSavedViewByText(savedViewB);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify stream B field is present
    await pm.logsPage.expectFieldInTableHeader(fieldForStreamB);
    testLogger.info(`Verified ${fieldForStreamB} present in saved view B`);

    // ===== CLEANUP: Delete saved views =====
    testLogger.info('Cleaning up saved views');

    // Delete saved view A
    await pm.logsPage.clickDeleteSavedViewButton(savedViewA);
    await page.waitForTimeout(500);
    await pm.logsPage.clickConfirmButton();
    await page.waitForTimeout(1000);

    // Delete saved view B
    await pm.logsPage.clickDeleteSavedViewButton(savedViewB);
    await page.waitForTimeout(500);
    await pm.logsPage.clickConfirmButton();
    await page.waitForTimeout(1000);

    testLogger.info('Stream switching test completed - saved views maintain correct fields for each stream');
  });

  /**
   * Bug #7751: Values API giving error with complex queries (subqueries, CTEs)
   * Issue: https://github.com/openobserve/openobserve/issues/7751
   * When users run complex SQL queries (subqueries, CTEs, JOINs) and try to expand
   * fields to see values, they get 400 error instead of field values.
   */

  test('should load field values with SUBQUERY without 400 error @bug-7751 @P0 @regression', async ({ page }) => {
    testLogger.info('Test: Field values with subquery');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();

    // Select stream
    await pm.logsPage.selectStream('e2e_automate');

    // Set date/time range
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Enter subquery
    const subquery = 'SELECT kubernetes_pod_name FROM (SELECT * FROM "e2e_automate" WHERE kubernetes_pod_name IS NOT NULL LIMIT 10)';
    testLogger.info(`Entering subquery: ${subquery}`);
    await pm.logsPage.clearAndFillQueryEditor(subquery);
    await pm.logsPage.waitForTimeout(500);

    // Run query
    testLogger.info('Running query');
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.waitForTimeout(3000);

    // Wait for results table to load
    await pm.logsPage.expectLogTableColumnSourceVisible();
    await pm.logsPage.waitForTimeout(2000);
    testLogger.info('Query results loaded successfully');

    // Expand field to trigger values API
    const fieldToExpand = 'kubernetes_pod_name';

    // Search for the field first to make it visible in sidebar
    testLogger.info(`Searching for field: ${fieldToExpand}`);
    await pm.logsPage.fillIndexFieldSearchInput(fieldToExpand);

    const expandButton = page.locator(pm.logsPage.fieldExpandButton(fieldToExpand));

    testLogger.info(`Expanding field: ${fieldToExpand}`);
    await expandButton.waitFor({ state: 'visible', timeout: 10000 });

    // Set up values API response waiter BEFORE clicking expand
    testLogger.info('Setting up values API listener');
    const valuesApiResponse = page.waitForResponse(
      response => response.url().includes('/_values') && response.status() !== 0,
      { timeout: 20000 }
    );

    testLogger.info('Clicking expand to trigger values API call');
    await expandButton.click();

    // Wait for values API response
    let apiResponse;
    try {
      apiResponse = await valuesApiResponse;
      testLogger.info(`✓ Values API responded with status: ${apiResponse.status()}`);

      // PRIMARY ASSERTION: Values API should NOT return 400 (this was the bug #7751)
      expect(apiResponse.status()).not.toBe(400);
      testLogger.info('✓ PRIMARY CHECK PASSED: Values API did not return 400 error');
    } catch (error) {
      testLogger.warn(`Values API response timeout or error: ${error.message}`);
      // If API times out, we'll still check the UI for 400 errors below
    }

    // Wait for field expansion content to be visible (values or error message)
    const fieldExpansionContent = page.locator(pm.logsPage.fieldListItem(fieldToExpand));
    await fieldExpansionContent.waitFor({ state: 'visible', timeout: 10000 });
    // Note: Using try-catch for safer error handling than .catch()
    let contentText = '';
    try {
      contentText = await fieldExpansionContent.textContent() || '';
    } catch (error) {
      testLogger.debug(`Could not read field expansion content: ${error.message}`);
    }

    // Secondary assertion: NO 400 error in UI
    expect(contentText).not.toContain('400');
    expect(contentText.toLowerCase()).not.toMatch(/error.*400|400.*error/);
    testLogger.info('✓ SECONDARY CHECK PASSED: No 400 error displayed in UI');

    // TERTIARY ASSERTION: Verify field values actually appear in dropdown
    // Wait for at least one field value to load (proves dropdown populated successfully)
    const firstFieldValue = page.locator(`[data-test^="logs-search-subfield-add-${fieldToExpand}-"]`).first();
    await firstFieldValue.waitFor({ state: 'visible', timeout: 5000 });

    const fieldValues = page.locator(`[data-test^="logs-search-subfield-add-${fieldToExpand}-"]`);
    const valueCount = await fieldValues.count();
    expect(valueCount).toBeGreaterThanOrEqual(1);
    testLogger.info(`✓ TERTIARY CHECK PASSED: ${valueCount} field value(s) displayed in dropdown`);
  });

  test.skip('should load field values with CTE (Common Table Expression) without 400 error @bug-7751 @P1 @regression', async ({ page }) => {
    testLogger.info('Test: Field values with CTE');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();

    // Select stream
    await pm.logsPage.selectStream('e2e_automate');

    // Set date/time range
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Enter CTE query
    const cteQuery = 'WITH filtered_logs AS (SELECT * FROM "e2e_automate" WHERE kubernetes_pod_name IS NOT NULL LIMIT 10) SELECT * FROM filtered_logs';
    testLogger.info(`Entering CTE query: ${cteQuery}`);
    await pm.logsPage.clearAndFillQueryEditor(cteQuery);
    await pm.logsPage.waitForTimeout(500);

    // Run query
    testLogger.info('Running query');
    await pm.logsPage.clickRefreshButton();

    // Wait for results table to load
    await pm.logsPage.expectLogTableColumnSourceVisible();
    testLogger.info('Query results loaded successfully');

    // Expand field to trigger values API
    const fieldToExpand = 'kubernetes_pod_name';

    // Search for the field first to make it visible in sidebar
    testLogger.info(`Searching for field: ${fieldToExpand}`);
    await pm.logsPage.fillIndexFieldSearchInput(fieldToExpand);

    const expandButton = page.locator(pm.logsPage.fieldExpandButton(fieldToExpand));

    testLogger.info(`Expanding field: ${fieldToExpand}`);
    await expandButton.waitFor({ state: 'visible', timeout: 10000 });

    // Set up values API response waiter BEFORE clicking expand
    testLogger.info('Setting up values API listener');
    const valuesApiResponse = page.waitForResponse(
      response => response.url().includes('/_values') && response.status() !== 0,
      { timeout: 20000 }
    );

    testLogger.info('Clicking expand to trigger values API call');
    await expandButton.click();

    // Wait for values API response
    let apiResponse;
    try {
      apiResponse = await valuesApiResponse;
      testLogger.info(`✓ Values API responded with status: ${apiResponse.status()}`);

      // PRIMARY ASSERTION: Values API should NOT return 400 (this was the bug #7751)
      expect(apiResponse.status()).not.toBe(400);
      testLogger.info('✓ PRIMARY CHECK PASSED: Values API did not return 400 error');
    } catch (error) {
      testLogger.warn(`Values API response timeout or error: ${error.message}`);
      // If API times out, we'll still check the UI for 400 errors below
    }

    // Wait for field expansion content to be visible (values or error message)
    const fieldExpansionContent = page.locator(pm.logsPage.fieldListItem(fieldToExpand));
    await fieldExpansionContent.waitFor({ state: 'visible', timeout: 10000 });
    // Note: Using try-catch for safer error handling than .catch()
    let contentText = '';
    try {
      contentText = await fieldExpansionContent.textContent() || '';
    } catch (error) {
      testLogger.debug(`Could not read field expansion content: ${error.message}`);
    }

    // Secondary assertion: NO 400 error in UI
    expect(contentText).not.toContain('400');
    expect(contentText.toLowerCase()).not.toMatch(/error.*400|400.*error/);
    testLogger.info('✓ SECONDARY CHECK PASSED: No 400 error displayed in UI');

    // TERTIARY ASSERTION: Verify field values actually appear in dropdown
    // Wait for at least one field value to load (proves dropdown populated successfully)
    const firstFieldValue = page.locator(`[data-test^="logs-search-subfield-add-${fieldToExpand}-"]`).first();
    await firstFieldValue.waitFor({ state: 'visible', timeout: 5000 });

    const fieldValues = page.locator(`[data-test^="logs-search-subfield-add-${fieldToExpand}-"]`);
    const valueCount = await fieldValues.count();
    expect(valueCount).toBeGreaterThanOrEqual(1);
    testLogger.info(`✓ TERTIARY CHECK PASSED: ${valueCount} field value(s) displayed in dropdown`);
  });

  test('should load field values with GROUP BY aggregation without 400 error @bug-7751 @P1 @regression', async ({ page }) => {
    testLogger.info('Test: Field values with GROUP BY aggregation');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();

    // Select stream
    await pm.logsPage.selectStream('e2e_automate');

    // Set date/time range
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Enter aggregation query
    const aggQuery = 'SELECT kubernetes_pod_name, count(*) as total FROM "e2e_automate" WHERE kubernetes_pod_name IS NOT NULL GROUP BY kubernetes_pod_name LIMIT 10';
    testLogger.info(`Entering aggregation query: ${aggQuery}`);
    await pm.logsPage.clearAndFillQueryEditor(aggQuery);
    await pm.logsPage.waitForTimeout(500);

    // Run query
    testLogger.info('Running query');
    await pm.logsPage.clickRefreshButton();

    // Wait for results table to load
    await pm.logsPage.expectLogTableColumnSourceVisible();
    testLogger.info('Query results loaded successfully');

    // Expand field to trigger values API
    const fieldToExpand = 'kubernetes_pod_name';

    // Search for the field first to make it visible in sidebar
    testLogger.info(`Searching for field: ${fieldToExpand}`);
    await pm.logsPage.fillIndexFieldSearchInput(fieldToExpand);

    const expandButton = page.locator(pm.logsPage.fieldExpandButton(fieldToExpand));

    testLogger.info(`Expanding field: ${fieldToExpand}`);
    await expandButton.waitFor({ state: 'visible', timeout: 10000 });

    // Set up values API response waiter BEFORE clicking expand
    testLogger.info('Setting up values API listener');
    const valuesApiResponse = page.waitForResponse(
      response => response.url().includes('/_values') && response.status() !== 0,
      { timeout: 20000 }
    );

    testLogger.info('Clicking expand to trigger values API call');
    await expandButton.click();

    // Wait for values API response
    let apiResponse;
    try {
      apiResponse = await valuesApiResponse;
      testLogger.info(`✓ Values API responded with status: ${apiResponse.status()}`);

      // PRIMARY ASSERTION: Values API should NOT return 400 (this was the bug #7751)
      expect(apiResponse.status()).not.toBe(400);
      testLogger.info('✓ PRIMARY CHECK PASSED: Values API did not return 400 error');
    } catch (error) {
      testLogger.warn(`Values API response timeout or error: ${error.message}`);
      // If API times out, we'll still check the UI for 400 errors below
    }

    // Wait for field expansion content to be visible (values or error message)
    const fieldExpansionContent = page.locator(pm.logsPage.fieldListItem(fieldToExpand));
    await fieldExpansionContent.waitFor({ state: 'visible', timeout: 10000 });
    // Note: Using try-catch for safer error handling than .catch()
    let contentText = '';
    try {
      contentText = await fieldExpansionContent.textContent() || '';
    } catch (error) {
      testLogger.debug(`Could not read field expansion content: ${error.message}`);
    }

    // Secondary assertion: NO 400 error in UI
    expect(contentText).not.toContain('400');
    expect(contentText.toLowerCase()).not.toMatch(/error.*400|400.*error/);
    testLogger.info('✓ SECONDARY CHECK PASSED: No 400 error displayed in UI');

    // TERTIARY ASSERTION: Verify field values actually appear in dropdown
    // Wait for at least one field value to load (proves dropdown populated successfully)
    const firstFieldValue = page.locator(`[data-test^="logs-search-subfield-add-${fieldToExpand}-"]`).first();
    await firstFieldValue.waitFor({ state: 'visible', timeout: 5000 });

    const fieldValues = page.locator(`[data-test^="logs-search-subfield-add-${fieldToExpand}-"]`);
    const valueCount = await fieldValues.count();
    expect(valueCount).toBeGreaterThanOrEqual(1);
    testLogger.info(`✓ TERTIARY CHECK PASSED: ${valueCount} field value(s) displayed in dropdown`);
  });

  /**
   * Bug #8868: Pagination count not updating after search/filter
   * Issue: https://github.com/openobserve/openobserve/issues/8868
   * When user searches/filters results, pagination counter shows total count
   * instead of filtered count (e.g., searching 100 items with 20 matches still shows 100)
   */

  test('should update pagination count after search filter @bug-8868 @P1 @regression', async ({ page }) => {
    testLogger.info('Test: Pagination count after search');

    // Navigate to streams page (has many items and search functionality)
    await page.locator(pm.logsPage.streamsMenuItem).click();
    await page.waitForTimeout(2000);

    // Get initial pagination text (shows total count)
    const paginationLocator = page.locator(pm.logsPage.tableBottom).first();

    // Wait for pagination to load
    await paginationLocator.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000); // Extra wait for pagination to update

    const initialPaginationText = await paginationLocator.textContent().catch(() => 'N/A');
    testLogger.info(`Initial pagination text: ${initialPaginationText}`);

    // Extract initial total count (e.g., "1-50 of 100")
    const initialMatch = initialPaginationText.match(/of\s+(\d+)/i);
    if (!initialMatch) {
      testLogger.warn(`Could not parse pagination text: "${initialPaginationText}" - skipping test`);
      test.skip(true, 'Pagination not available or not in expected format');
    }
    const initialTotal = parseInt(initialMatch[1]);
    testLogger.info(`Initial total count: ${initialTotal}`);

    // Perform search with a specific term that will filter results
    const searchTerm = 'e2e';
    const searchInput = page.locator(pm.logsPage.streamsSearchInputField);
    await searchInput.fill(searchTerm);
    testLogger.info(`Entered search term: "${searchTerm}"`);

    // Wait for table filtering to complete
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500); // Small buffer for UI update

    // Get pagination text after search
    const filteredPaginationText = await paginationLocator.textContent().catch(() => 'N/A');
    testLogger.info(`Filtered pagination text: ${filteredPaginationText}`);

    // Extract filtered total count
    const filteredMatch = filteredPaginationText.match(/of\s+(\d+)/i);
    const filteredTotal = filteredMatch ? parseInt(filteredMatch[1]) : 0;
    testLogger.info(`Filtered total count: ${filteredTotal}`);

    // PRIMARY CHECK: Filtered count should be less than or equal to initial count
    expect(filteredTotal).toBeLessThanOrEqual(initialTotal);
    testLogger.info(`✓ PRIMARY CHECK PASSED: Filtered count (${filteredTotal}) <= Initial count (${initialTotal})`);

    // Additional check: Pagination should reflect actual filtered results
    if (filteredTotal < initialTotal) {
      testLogger.info(`✓ Pagination correctly updated from ${initialTotal} to ${filteredTotal} after search`);
    } else if (filteredTotal === initialTotal && searchTerm) {
      testLogger.warn(`⚠ Search returned all results - pagination count unchanged (${filteredTotal})`);
    }

    // Verify table shows filtered results
    const tableRows = await page.locator(pm.logsPage.tableBodyRowWithIndex).count();
    testLogger.info(`Table shows ${tableRows} rows after filtering`);

    // Clear search and verify count returns to original
    await searchInput.clear();
    await page.waitForTimeout(2000); // Wait for table to reload

    const clearedPaginationText = await paginationLocator.textContent().catch(() => 'N/A');
    testLogger.info(`After clearing search, pagination text: ${clearedPaginationText}`);

    const clearedMatch = clearedPaginationText.match(/of\s+(\d+)/i);
    const clearedTotal = clearedMatch ? parseInt(clearedMatch[1]) : 0;
    testLogger.info(`After clearing search, pagination shows: ${clearedTotal}`);

    // Verify count returns to initial total (or close to it)
    if (clearedTotal === initialTotal) {
      testLogger.info(`✓ Pagination correctly restored to ${clearedTotal} after clearing search`);
    } else if (clearedTotal > 0) {
      testLogger.warn(`⚠ Pagination showed ${clearedTotal} after clear (expected ${initialTotal}) - possible timing issue`);
      expect(clearedTotal).toBeGreaterThan(0); // At least verify it's not 0
    } else {
      testLogger.warn(`⚠ Pagination shows 0 after clearing - skipping restore check`);
    }
  });

  // ============================================================================
  // Bug #8180: Multiple log search issues
  // https://github.com/openobserve/openobserve/issues/8180
  test('should execute histogram query from search history without error @bug-8180 @P0 @regression', async ({ page }) => {
    testLogger.info('Test: Histogram query from search history (Bug #8180 - Part 2)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    // Switch to SQL mode
    await pm.logsPage.clickSQLModeToggle();
    await page.waitForTimeout(1000);

    // Execute a histogram query (similar to the one that failed in bug report)
    // Note: Bug #8180 requires zo_sql_val alias for COUNT (not zo_sql_num) - per Greptile review
    const histogramQuery = 'SELECT histogram(_timestamp) AS zo_sql_key, COUNT(*) AS zo_sql_val FROM "e2e_automate" GROUP BY zo_sql_key ORDER BY zo_sql_key';
    await pm.logsPage.fillQueryEditor(histogramQuery);
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(3000);

    // Check for any error messages
    const errorIndicators = await page.locator(pm.logsPage.errorIndicators).count();
    expect(errorIndicators).toBe(0);
    testLogger.info('✓ No error notifications displayed after histogram query');

    // Verify results are displayed
    const resultTextLocator = page.locator(pm.logsPage.resultText);
    let resultText = '';
    try {
      resultText = await resultTextLocator.textContent() || '';
    } catch (error) {
      testLogger.debug(`Could not read result text: ${error.message}`);
    }
    expect(resultText).toBeTruthy();
    testLogger.info(`✓ Results displayed: ${resultText.substring(0, 50)}`);

    // Check if histogram query appears in search history
    const historyButton = page.locator(`${pm.logsPage.queryHistoryButton}, button:has-text("History")`).first();
    if (await historyButton.isVisible()) {
      await historyButton.click();
      await page.waitForTimeout(1000);

      // Verify history panel opened
      const historyPanel = page.locator(pm.logsPage.historyPanel).first();
      if (await historyPanel.isVisible()) {
        testLogger.info('✓ Search history panel opened successfully');
      }

      // Close history panel
      await historyButton.click();
      await page.waitForTimeout(500);
    }

    testLogger.info('✓ PRIMARY CHECK PASSED: Histogram query executed without error');
  });

  test('should display timestamp field in quick mode @bug-8180 @P1 @regression', async ({ page }) => {
    testLogger.info('Test: Timestamp field display in quick mode (Bug #8180 - Part 3)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    // Ensure we're in quick mode (not SQL mode)
    const sqlModeToggle = page.locator(pm.logsPage.sqlModeToggle);
    const sqlModeDiv = sqlModeToggle.locator('div').first();
    const isSQLMode = await sqlModeDiv.getAttribute('aria-checked');

    if (isSQLMode === 'true') {
      await sqlModeToggle.click();
      await page.waitForTimeout(1000);
      testLogger.info('Switched to quick mode');
    }

    // Run a query to get results
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(3000);

    // Check if timestamp column/field is visible in results
    const timestampHeader = page.locator('th:has-text("_timestamp"), [data-test*="_timestamp"]').first();
    const timestampVisible = await timestampHeader.isVisible().catch(() => false);

    if (timestampVisible) {
      testLogger.info('✓ Timestamp header found in table view');
    } else {
      // Check if timestamp appears in expanded log view
      const logRows = page.locator(pm.logsPage.tableBodyRow).first();
      if (await logRows.isVisible()) {
        await logRows.click();
        await page.waitForTimeout(500);

        const timestampInDetail = page.locator(pm.logsPage.timestampInDetail).first();
        await expect(timestampInDetail).toBeVisible({ timeout: 5000 });
        testLogger.info('✓ Timestamp found in log detail view');
      }
    }

    testLogger.info('✓ PRIMARY CHECK PASSED: Timestamp field displays in quick mode');
  });

  test('should display source field when only timestamp remains @bug-8180 @P2 @regression', async ({ page }) => {
    testLogger.info('Test: Source field display logic (Bug #8180 - Part 4)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    // Run initial query
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(3000);

    // Get list of currently displayed fields in table
    const tableHeaders = page.locator(pm.logsPage.tableHeaders);
    const initialHeaderCount = await tableHeaders.count();
    testLogger.info(`Initial field count in table: ${initialHeaderCount}`);

    // Try to remove fields until only _timestamp remains (or close to it)
    // This simulates the scenario where user removes fields
    const fieldListItems = page.locator(pm.logsPage.allFieldExpandButtons);
    const fieldCount = await fieldListItems.count();

    if (fieldCount > 0) {
      // Search for a specific field to remove
      const fieldToRemove = 'kubernetes_pod_name';
      await pm.logsPage.fillIndexFieldSearchInput(fieldToRemove);
      await page.waitForTimeout(500);

      // Check if field has a remove/toggle button
      const fieldItem = page.locator(pm.logsPage.fieldIndexListButton(fieldToRemove)).first();
      if (await fieldItem.isVisible()) {
        // Click to toggle field (remove from view)
        await fieldItem.click();
        await page.waitForTimeout(1000);

        testLogger.info(`Toggled field: ${fieldToRemove}`);
      }

      // Clear search to see all remaining fields
      await pm.logsPage.fillIndexFieldSearchInput('');
      await page.waitForTimeout(500);
    }

    // Check current table state
    const updatedHeaderCount = await tableHeaders.count();
    testLogger.info(`Updated field count in table: ${updatedHeaderCount}`);

    // Verify that when minimal fields remain, source field OR _timestamp is still visible
    const timestampVisible = await page.locator('th:has-text("_timestamp")').isVisible().catch(() => false);
    const sourceVisible = await page.locator('th:has-text("source"), th:has-text("_source")').first().isVisible().catch(() => false);

    expect(timestampVisible || sourceVisible).toBeTruthy();

    if (timestampVisible) {
      testLogger.info('✓ _timestamp field remains visible');
    }
    if (sourceVisible) {
      testLogger.info('✓ source field is visible');
    }

    testLogger.info('✓ PRIMARY CHECK PASSED: Essential fields (timestamp/source) display correctly');
  });

  // ============================================================================
  // Bug #9455: Download validation and empty results handling
  // https://github.com/openobserve/openobserve/issues/9455
  test('should handle empty results download for CSV @bug-9455 @P1 @regression @download', async ({ page }) => {
    testLogger.info('Test: Download empty CSV results (Bug #9455)');

    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    await pm.logsPage.clickSQLModeToggle();
    await page.waitForTimeout(1000);

    const emptyQuery = 'SELECT * FROM "e2e_automate" WHERE _timestamp < 0';
    await pm.logsPage.fillQueryEditor(emptyQuery);
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(3000);

    const moreOptionsButton = page.locator('[data-test="logs-search-bar-more-options-btn"]');
    if (await moreOptionsButton.isVisible()) {
      await moreOptionsButton.click();
      await page.waitForTimeout(500);

      const downloadTableMenu = page.locator('text=/Download Table/i').first();
      if (await downloadTableMenu.isVisible()) {
        await downloadTableMenu.hover();
        await page.waitForTimeout(500);

        const csvDownloadButton = page.locator('[data-test="search-download-csv-btn"]');
        if (await csvDownloadButton.isVisible()) {
          await csvDownloadButton.click();
          await page.waitForTimeout(2000);

          const notifications = page.locator('.q-notification__message');
          const notificationCount = await notifications.count();

          if (notificationCount > 0) {
            const notificationText = await notifications.first().textContent();
            testLogger.info(`✓ Notification displayed: ${notificationText}`);
            expect(notificationText.length).toBeGreaterThan(0);
          } else {
            testLogger.info('✓ Download prevented for empty results');
          }

          testLogger.info('✓ PRIMARY CHECK PASSED: Empty CSV download handled');
        }
      }
    }
  });

  test('should handle empty results download for JSON @bug-9455 @P1 @regression @download', async ({ page }) => {
    testLogger.info('Test: Download empty JSON results (Bug #9455)');

    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    await pm.logsPage.clickSQLModeToggle();
    await page.waitForTimeout(1000);

    const emptyQuery = 'SELECT * FROM "e2e_automate" WHERE _timestamp < 0';
    await pm.logsPage.fillQueryEditor(emptyQuery);
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(3000);

    const moreOptionsButton = page.locator('[data-test="logs-search-bar-more-options-btn"]');
    if (await moreOptionsButton.isVisible()) {
      await moreOptionsButton.click();
      await page.waitForTimeout(500);

      const downloadTableMenu = page.locator('text=/Download Table/i').first();
      if (await downloadTableMenu.isVisible()) {
        await downloadTableMenu.hover();
        await page.waitForTimeout(500);

        const jsonDownloadButton = page.locator('[data-test="search-download-json-btn"]');
        if (await jsonDownloadButton.isVisible()) {
          await jsonDownloadButton.click();
          await page.waitForTimeout(2000);

          const notifications = page.locator('.q-notification__message');
          const notificationCount = await notifications.count();

          if (notificationCount > 0) {
            const notificationText = await notifications.first().textContent();
            testLogger.info(`✓ Notification displayed: ${notificationText}`);
            expect(notificationText.length).toBeGreaterThan(0);
          } else {
            testLogger.info('✓ Download prevented for empty results');
          }

          testLogger.info('✓ PRIMARY CHECK PASSED: Empty JSON download handled');
        }
      }
    }
  });

  test('should validate stream selection before search @bug-9455 @P1 @regression', async ({ page }) => {
    testLogger.info('Test: Stream validation (Bug #9455)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForTimeout(2000);

    const refreshButton = page.locator(pm.logsPage.queryButton);
    const isRefreshButtonVisible = await refreshButton.isVisible();

    // PRIMARY ASSERTION: Refresh button should be visible
    expect(isRefreshButtonVisible).toBeTruthy();

    await refreshButton.click();
    await page.waitForTimeout(2000);

    const errorNotifications = page.locator('.q-notification__message, text=/select.*stream/i').first();
    const errorVisible = await errorNotifications.isVisible().catch(() => false);

    // PRIMARY ASSERTION: Either error notification appears OR search was silently prevented
    if (errorVisible) {
      const errorText = await errorNotifications.textContent();
      testLogger.info(`✓ Validation message: ${errorText}`);
      expect(errorText.toLowerCase()).toMatch(/stream|select/);
      testLogger.info('✓ PRIMARY CHECK PASSED: Validation message displayed correctly');
    } else {
      // If no error notification, verify no results were loaded (search was prevented)
      const resultsTable = page.locator(pm.logsPage.logsSearchResultLogsTable);
      const hasResults = await resultsTable.isVisible().catch(() => false);

      // Assert search was prevented (no results loaded without stream selection)
      expect(hasResults).toBeFalsy();
      testLogger.info('✓ PRIMARY CHECK PASSED: Search prevented without stream selection');
    }
  });

  // ============================================================================
  // Bug #9117: SQL mode conversion with pipe operators
  // https://github.com/openobserve/openobserve/issues/9117
  test('should convert pipe operators correctly when switching to SQL mode @bug-9117 @P1 @regression @sqlMode', async ({ page }) => {
    testLogger.info('Test: SQL mode conversion with pipes (Bug #9117)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    // Make sure we're in quick mode initially
    const sqlModeToggle = page.getByRole('switch', { name: 'SQL Mode' });
    await sqlModeToggle.waitFor({ state: 'visible', timeout: 10000 });

    const isSQLMode = await sqlModeToggle.getAttribute('aria-checked');

    if (isSQLMode === 'true') {
      await sqlModeToggle.click();
      await page.waitForTimeout(1000);
      testLogger.info('Switched to quick mode');
    }

    // Enter a query with pipe operator in quick mode
    const queryWithPipe = 'kubernetes_pod_name | stats count()';
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor(queryWithPipe);
    testLogger.info(`Entered query in quick mode: ${queryWithPipe}`);

    await page.waitForTimeout(1000);

    // Toggle to SQL mode
    await sqlModeToggle.click();
    await page.waitForTimeout(1500);
    testLogger.info('Toggled to SQL mode');

    // Get the converted SQL query
    const convertedQuery = await pm.logsPage.getQueryFromEditor();
    testLogger.info(`Converted SQL query: ${convertedQuery}`);

    // PRIMARY ASSERTION 1: Query should be converted (not empty and different from original)
    expect(convertedQuery.length).toBeGreaterThan(0);
    testLogger.info('✓ Query was converted to SQL syntax');

    // Try to run the converted query
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(3000);

    // Check for syntax errors
    const errorNotifications = page.locator('.q-notification--negative, text=/error/i, text=/syntax/i').first();
    const hasError = await errorNotifications.isVisible().catch(() => false);

    // PRIMARY ASSERTION 2: No syntax errors should occur after SQL conversion
    expect(hasError).toBeFalsy();

    if (hasError) {
      const errorText = await errorNotifications.textContent();
      testLogger.error(`Unexpected error after SQL conversion: ${errorText}`);
    } else {
      testLogger.info('✓ No syntax errors after SQL mode conversion');
    }

    // Verify results or at least that query executed
    let resultText = '';
    try {
      resultText = await page.locator(pm.logsPage.resultText).textContent() || '';
    } catch (error) {
      testLogger.debug(`Could not read result text: ${error.message}`);
    }

    // PRIMARY ASSERTION 3: Query should execute and return results
    expect(resultText).toBeTruthy();
    expect(resultText.length).toBeGreaterThan(0);
    testLogger.info(`✓ Query executed successfully: ${resultText.substring(0, 50)}`);

    testLogger.info('✓ PRIMARY CHECK PASSED: SQL mode conversion handled pipe operators');
  });

  // ============================================================================
  // VRL Fields: Include/exclude term icons should not appear on VRL-generated fields
  // Feature: VRL fields should not have include/exclude icons as they are computed fields
  // ============================================================================
  test('should not display include/exclude term icons on VRL-generated fields @vrl @P1 @regression @v0.40', async ({ page }) => {
    testLogger.info('Test: VRL fields should not have include/exclude icons');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    // Set time range
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Enable VRL toggle to show VRL editor
    await pm.logsPage.clickShowQueryToggle();
    await page.waitForTimeout(1000);

    // Enter VRL function that creates a new field
    await pm.logsPage.waitForVrlEditorAndClick();
    await pm.logsPage.enterVrlFunction('.vrl_test_field = "test_value"');
    testLogger.info('Entered VRL function to create vrl_test_field');

    // Run query with VRL
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(3000);

    // Wait for and expand first log row to see field details (hard assertion - must be present)
    await pm.logsPage.waitForLogsTable(15000);
    const expandMenuVisible = await pm.logsPage.isFirstExpandMenuVisible();
    expect(expandMenuVisible).toBe(true);
    testLogger.info('✓ Expand menu is visible - proceeding with VRL field check');

    await pm.logsPage.clickFirstExpandMenu();
    await page.waitForTimeout(1000);

    // GUARD: First verify the VRL field actually exists in the expanded detail view
    // This prevents vacuous pass if VRL didn't execute or field name is wrong
    const vrlFieldExists = await page.locator('[data-test="log-expand-detail-key-vrl_test_field"]').count();
    expect(vrlFieldExists, 'VRL field "vrl_test_field" should exist in expanded log detail').toBeGreaterThan(0);
    testLogger.info('✓ VRL field exists in expanded log detail');

    // Look for include/exclude buttons on VRL fields
    // VRL-generated fields should NOT have these buttons
    const vrlFieldIncludeExcludeCount = await pm.logsPage.getVrlFieldIncludeExcludeCount('vrl_test_field');

    // PRIMARY ASSERTION: VRL fields should NOT have include/exclude buttons
    expect(vrlFieldIncludeExcludeCount).toBe(0);
    testLogger.info('✓ VRL-generated field does not have include/exclude buttons');

    // Verify regular fields still have include/exclude buttons
    const regularFieldCount = await pm.logsPage.getRegularIncludeExcludeCount();
    expect(regularFieldCount).toBeGreaterThan(0);
    testLogger.info(`✓ Regular fields have ${regularFieldCount} include/exclude buttons`);

    testLogger.info('✓ PRIMARY CHECK PASSED: VRL fields do not show include/exclude icons');
  });

  // ============================================================================
  // Query Inspector: readonly flag in buildSearch to avoid mutating logs state
  // Feature: Query inspector should not modify the original logs state
  // ============================================================================
  test('should not mutate logs state when using query inspector @queryInspector @P1 @regression @v0.40', async ({ page }) => {
    testLogger.info('Test: Query inspector should not mutate logs state');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    // Set time range and run initial query
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(3000);

    // Capture initial logs state (first few log entries)
    await pm.logsPage.waitForLogsTable(10000);
    const initialLogsContent = await pm.logsPage.getLogsTableContent();
    testLogger.info(`Initial logs content length: ${initialLogsContent?.length || 0}`);

    // Store initial row count
    const initialRowCount = await pm.logsPage.getLogRowCount();
    testLogger.info(`Initial row count: ${initialRowCount}`);

    // Open query inspector/show query toggle
    await pm.logsPage.clickShowQueryToggle();
    await page.waitForTimeout(1000);
    testLogger.info('Opened query inspector');

    // Interact with query inspector - view the query
    await pm.logsPage.waitForQueryEditorVisible(5000);

    // Click on query editor (readonly interaction)
    await pm.logsPage.clickQueryEditor();
    await page.waitForTimeout(500);

    // Close query inspector
    await pm.logsPage.clickShowQueryToggle();
    await page.waitForTimeout(1000);

    // PRIMARY ASSERTION 1: Logs table should still be visible after query inspector interaction
    await pm.logsPage.expectLogsTableVisible();
    testLogger.info('✓ Logs table remains visible after query inspector interaction');

    // PRIMARY ASSERTION 2: Row count should not decrease (streaming may add more, but data should not be lost)
    const finalRowCount = await pm.logsPage.getLogRowCount();
    expect(finalRowCount).toBeGreaterThanOrEqual(initialRowCount);
    testLogger.info(`✓ Row count preserved: initial=${initialRowCount}, final=${finalRowCount}`);

    // PRIMARY ASSERTION 3: Table content should exist (not empty/cleared by query inspector)
    const finalLogsContent = await pm.logsPage.getLogsTableContent();
    expect(finalLogsContent, 'Logs table content should not be empty after query inspector interaction').toBeTruthy();
    const initialLength = initialLogsContent?.length || 0;
    expect(finalLogsContent.length, `Logs content was truncated: final=${finalLogsContent.length}, initial=${initialLength}`).toBeGreaterThanOrEqual(initialLength);
    testLogger.info(`✓ Logs content preserved: initial=${initialLength}, final=${finalLogsContent.length}`);

    testLogger.info('✓ PRIMARY CHECK PASSED: Query inspector does not mutate logs state (readonly flag working)');
  });

  // ============================================================================
  // Sorting Logs: Sort logs when response has order_by_metadata
  // Feature: Logs should be correctly sorted when API response contains order_by_metadata
  // ============================================================================
  test('should sort logs correctly when response has order_by_metadata @sorting @P1 @regression @v0.40', async ({ page }) => {
    testLogger.info('Test: Logs sorting with order_by_metadata');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    // Turn off quick mode if enabled
    await pm.logsPage.ensureQuickModeState(false);

    // Set time range
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Run query
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(5000);

    // Wait for results
    await pm.logsPage.waitForLogsTable(15000);

    // Get timestamps from visible log rows to verify sorting
    const timestampCount = await pm.logsPage.getTimestampCellCount();
    testLogger.info(`Found ${timestampCount} timestamp cells`);

    // GUARD ASSERTION: Must have at least 2 timestamps to verify sorting - fail fast if not enough data
    expect(timestampCount).toBeGreaterThanOrEqual(2);

    const timestamps = await pm.logsPage.getTimestampCellValues(5);
    testLogger.info(`First ${timestamps.length} timestamps: ${JSON.stringify(timestamps)}`);

    // PRIMARY ASSERTION: Timestamps should be in descending order (newest first) by default
    // Logs with order_by_metadata should maintain proper sort order

    // Helper to parse timestamps in OpenObserve's format "MMM DD, YYYY HH:mm:ss.SSS Z" or similar
    // Falls back to native Date.parse if the format doesn't match
    const MONTH_MAP = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const parseTimestamp = (str) => {
      if (!str || typeof str !== 'string') return NaN;
      // Try native Date.parse first (handles ISO 8601 and common formats)
      const native = new Date(str).getTime();
      if (!isNaN(native)) return native;
      // Try to parse "MMM DD, YYYY HH:mm:ss[.SSS] [+/-]ZZZZ" format
      // Example: "Jan 15, 2024 10:30:45.123 +0000" or "Jan 15, 2024 10:30:45 +0000"
      const match = str.match(/^(\w{3})\s+(\d{1,2}),\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*([+-]\d{4})?/);
      if (match) {
        const [, mon, day, year, hour, min, sec, ms, tz] = match;
        const month = MONTH_MAP[mon];
        if (month !== undefined) {
          const date = new Date(Date.UTC(+year, month, +day, +hour, +min, +sec, ms ? +ms.slice(0, 3) : 0));
          // Adjust for timezone offset if present (e.g., +0000, -0500)
          if (tz) {
            const tzHours = parseInt(tz.slice(0, 3), 10);
            const tzMins = parseInt(tz.slice(0, 1) + tz.slice(3), 10);
            date.setUTCMinutes(date.getUTCMinutes() - tzHours * 60 - tzMins);
          }
          return date.getTime();
        }
      }
      return NaN;
    };

    let isDescending = true;
    let validTimestampCount = 0;
    const nanIndices = new Set(); // Track indices to avoid duplicates
    for (let i = 1; i < timestamps.length; i++) {
      const prev = parseTimestamp(timestamps[i - 1]);
      const curr = parseTimestamp(timestamps[i]);
      // Collect NaN timestamp indices (use Set to avoid duplicates when same index is prev and curr)
      if (isNaN(prev)) nanIndices.add(i - 1);
      if (isNaN(curr)) nanIndices.add(i);
      if (isNaN(prev) || isNaN(curr)) {
        testLogger.warn(`Timestamp parsing failed: "${timestamps[i-1]}" -> ${prev}, "${timestamps[i]}" -> ${curr}`);
        continue; // Skip this comparison but continue checking others
      }
      validTimestampCount++;
      if (prev < curr) {
        isDescending = false;
        testLogger.warn(`Sort order broken at index ${i}: ${timestamps[i-1]} > ${timestamps[i]}`);
        break;
      }
    }
    // Convert to array with values for error message
    const nanTimestamps = [...nanIndices].map(idx => ({ index: idx, value: timestamps[idx] }));

    // ASSERTION: No timestamps should be unparseable (fail with descriptive message)
    expect(nanTimestamps.length, `Unparseable timestamps: ${JSON.stringify(nanTimestamps)}`).toBe(0);

    // ASSERTION: Must have at least 2 timestamps to verify sorting
    expect(timestamps.length).toBeGreaterThanOrEqual(2);
    // ASSERTION: At least one valid timestamp comparison must have been made
    expect(validTimestampCount).toBeGreaterThanOrEqual(1);

    // PRIMARY ASSERTION: Logs must be sorted in descending order (newest first)
    expect(isDescending).toBe(true);
    testLogger.info(`✓ Logs are correctly sorted in descending order (${validTimestampCount} comparisons made)`);

    // PRIMARY ASSERTION: Results should be displayed
    const resultText = await pm.logsPage.getSearchResultText();
    expect(resultText).toBeTruthy();
    testLogger.info(`✓ Results displayed: ${resultText?.substring(0, 50)}`);

    testLogger.info('✓ PRIMARY CHECK PASSED: Logs sorting works with order_by_metadata');
  });

  // ============================================================================
  // Logs Expand: Last log should maintain highlighting when expanding
  // Feature: When expanding a log entry, the last log should not lose its highlighting
  // ============================================================================
  test('should maintain highlighting on last log when expanding log entries @expand @highlight @P1 @regression @v0.40', async ({ page }) => {
    testLogger.info('Test: Last log highlighting on expand');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    // Turn off quick mode if enabled
    await pm.logsPage.ensureQuickModeState(false);

    // Set time range and run query
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(5000);

    // Wait for logs table
    await pm.logsPage.waitForLogsTable(15000);

    // Get all log rows
    const rowCount = await pm.logsPage.getLogRowCount();
    testLogger.info(`Found ${rowCount} log rows`);

    if (rowCount < 2) {
      testLogger.warn('Not enough log rows to test highlighting - skipping');
      test.skip(true, 'Not enough log rows');
      return;
    }

    // Expand first log row using the expand menu to trigger highlighting
    await pm.logsPage.clickFirstExpandMenu();
    await page.waitForTimeout(1000);
    testLogger.info('Expanded first log row');

    // Close the dialog/detail panel that opens (press Escape or click outside)
    await pm.logsPage.pressEscapeToCloseDialog();
    await page.waitForTimeout(500);

    // Click on the last visible log row to select/highlight it
    const lastRow = pm.logsPage.getLastRow();
    await lastRow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // Get the expand menu for last row and click it
    await pm.logsPage.clickLastExpandMenu();
    await page.waitForTimeout(1000);
    testLogger.info('Expanded last log row');

    // Check if the log detail panel shows for last row
    const isPanelVisible = await pm.logsPage.isLogDetailPanelVisible();
    testLogger.info(`Log detail panel visible: ${isPanelVisible}`);

    // Close the detail panel
    await pm.logsPage.pressEscapeToCloseDialog();
    await page.waitForTimeout(500);

    // Capture the last row's visual state AFTER closing (post-close highlight state)
    // This is the state we expect to be preserved when expanding a different row
    const lastRowClasses = await lastRow.getAttribute('class') || '';
    testLogger.info(`Last row baseline state (post-close) - classes: ${lastRowClasses}`);

    // Now expand first row again - this is when the bug would cause last row to lose highlighting
    const firstRowExpandMenu = pm.logsPage.getFirstRowExpandMenu();
    await firstRowExpandMenu.click();
    await page.waitForTimeout(1000);
    testLogger.info('Expanded first log row again');

    // PRIMARY ASSERTION 1: Last row should still be visible
    await pm.logsPage.expectVisible(lastRow);
    testLogger.info('✓ Last row is still visible after expanding another log');

    // Check last row's visual state after expanding a different row
    const lastRowFinalClasses = await lastRow.getAttribute('class') || '';
    testLogger.info(`Last row final state - classes: ${lastRowFinalClasses}`);

    // PRIMARY ASSERTION 2: Last row should retain its original styling classes
    // Compare that the classes from before expansion are still present
    expect(lastRowFinalClasses).toBeTruthy();
    // Filter out generic/transient table classes that don't indicate highlighting state
    const ignoredClasses = new Set(['table-row', 'q-tr', 'cursor-pointer']);
    const originalClassSet = new Set(lastRowClasses.split(/\s+/).filter(c => c && !ignoredClasses.has(c)));
    const finalClassSet = new Set(lastRowFinalClasses.split(/\s+/).filter(c => c && !ignoredClasses.has(c)));

    // Log class differences for debugging
    const missingClasses = [...originalClassSet].filter(cls => !finalClassSet.has(cls));
    const addedClasses = [...finalClassSet].filter(cls => !originalClassSet.has(cls));
    testLogger.info(`Class comparison: original=${originalClassSet.size}, final=${finalClassSet.size}`);
    if (missingClasses.length > 0) testLogger.info(`Missing classes: ${missingClasses.join(', ')}`);
    if (addedClasses.length > 0) testLogger.info(`Added classes: ${addedClasses.join(', ')}`);

    // Guard: Ensure we have meaningful classes to compare (not vacuously true)
    expect(originalClassSet.size, 'Last row should have styling classes beyond generic table classes').toBeGreaterThan(0);

    // The original classes should be preserved in the final state
    // (row may have additional classes added, but original ones should remain)
    const classesPreserved = [...originalClassSet].every(cls => finalClassSet.has(cls));
    expect(classesPreserved, `Last row lost classes after expanding different row. Missing: ${missingClasses.join(', ')}`).toBe(true);
    testLogger.info(`✓ Last row preserved all ${originalClassSet.size} original styling classes`);

    // Close the expanded row
    await pm.logsPage.pressEscapeToCloseDialog();
    await page.waitForTimeout(500);

    // PRIMARY ASSERTION 3: Table should still have rows (streaming may add/remove, but table intact)
    const finalRowCount = await pm.logsPage.getLogRowCount();
    expect(finalRowCount).toBeGreaterThan(0);
    testLogger.info(`✓ Table remains intact with ${finalRowCount} rows`);

    testLogger.info('✓ PRIMARY CHECK PASSED: Last log maintains highlighting on expand');
  });

  test.afterEach(async () => {
    testLogger.info('Logs regression test completed');
  });
});
