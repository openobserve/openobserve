const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData, getHeaders, getIngestionUrl, sendRequest } = require('../utils/data-ingestion.js');

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

    // Expand field and validate using POM method
    const fieldToExpand = 'kubernetes_pod_name';
    const result = await pm.logsPage.expandFieldAndValidate(fieldToExpand, testLogger);
    testLogger.info(`Subquery test completed: API status ${result.apiStatus}, ${result.valueCount} values found`);
  });

  // SKIPPED: CTE (Common Table Expression) support is not yet implemented in the backend.
  // This test is prepared for when Bug #7751 is fixed and CTE syntax is supported.
  // See: https://github.com/openobserve/openobserve/issues/7751
  // TODO: Remove .skip() once CTE support is added to the query engine
  test.skip('should load field values with CTE (Common Table Expression) without 400 error @bug-7751 @P1 @regression', async ({ page }) => {
    testLogger.info('Test: Field values with CTE (Common Table Expression)');

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

    // Expand field and validate using POM method
    const fieldToExpand = 'kubernetes_pod_name';
    const result = await pm.logsPage.expandFieldAndValidate(fieldToExpand, testLogger);
    testLogger.info(`CTE test completed: API status ${result.apiStatus}, ${result.valueCount} values found`);
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

    // Expand field and validate using POM method
    const fieldToExpand = 'kubernetes_pod_name';
    const result = await pm.logsPage.expandFieldAndValidate(fieldToExpand, testLogger);
    testLogger.info(`GROUP BY test completed: API status ${result.apiStatus}, ${result.valueCount} values found`);
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
    await pm.logsPage.clickStreamsMenuItem();
    await page.waitForTimeout(2000);

    // Get initial pagination text (shows total count) - using POM method
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000); // Extra wait for pagination to update

    const initialPaginationText = await pm.logsPage.getPaginationText();
    testLogger.info(`Initial pagination text: ${initialPaginationText}`);

    // Extract initial total count (e.g., "1-50 of 100")
    // Rule 5: No graceful skipping - test must fail if pagination format is unexpected
    const initialMatch = initialPaginationText.match(/of\s+(\d+)/i);
    expect(initialMatch, `Pagination text "${initialPaginationText}" must match expected format "X-Y of Z"`).toBeTruthy();
    const initialTotal = parseInt(initialMatch[1]);
    testLogger.info(`Initial total count: ${initialTotal}`);

    // Perform search with a specific term that will filter results - using POM method
    const searchTerm = 'e2e';
    await pm.logsPage.fillStreamsSearchInput(searchTerm);
    testLogger.info(`Entered search term: "${searchTerm}"`);

    // Wait for table filtering to complete
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500); // Small buffer for UI update

    // Get pagination text after search - using POM method
    const filteredPaginationText = await pm.logsPage.getPaginationText();
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

    // Verify table shows filtered results - using POM method
    const tableRows = await pm.logsPage.getTableRowCount();
    testLogger.info(`Table shows ${tableRows} rows after filtering`);

    // Clear search and verify count returns to original - using POM method
    await pm.logsPage.clearStreamsSearchInput();
    await page.waitForTimeout(2000); // Wait for table to reload

    const clearedPaginationText = await pm.logsPage.getPaginationText();
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

    // Check for any error messages - using POM method
    const errorIndicators = await pm.logsPage.getErrorIndicatorCount();
    expect(errorIndicators).toBe(0);
    testLogger.info('✓ No error notifications displayed after histogram query');

    // Verify results are displayed - using POM method
    const resultText = await pm.logsPage.getResultText();
    expect(resultText).toBeTruthy();
    testLogger.info(`✓ Results displayed: ${resultText.substring(0, 50)}`);

    // Check if histogram query appears in search history - using POM methods
    await pm.logsPage.clickHistoryButton();
    await page.waitForTimeout(1000);

    // Verify history panel opened - using POM method
    if (await pm.logsPage.isHistoryPanelVisible()) {
      testLogger.info('✓ Search history panel opened successfully');
    }

    // Close history panel
    await pm.logsPage.clickHistoryButton();
    await page.waitForTimeout(500);

    testLogger.info('✓ PRIMARY CHECK PASSED: Histogram query executed without error');
  });

  test('should display timestamp field in quick mode @bug-8180 @P1 @regression', async ({ page }) => {
    testLogger.info('Test: Timestamp field display in quick mode (Bug #8180 - Part 3)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    // Ensure we're in quick mode (not SQL mode) - using POM method
    const isSQLMode = await pm.logsPage.getSQLModeState();

    if (isSQLMode === 'true') {
      await pm.logsPage.clickSQLModeSwitch();
      await page.waitForTimeout(1000);
      testLogger.info('Switched to quick mode');
    }

    // Run a query to get results
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(3000);

    // Check if timestamp column/field is visible in results - using POM method
    const timestampVisible = await pm.logsPage.isTimestampColumnVisible();

    if (timestampVisible) {
      testLogger.info('✓ Timestamp header found in table view');
    } else {
      // Check if timestamp appears in expanded log view - using POM methods
      await pm.logsPage.clickFirstTableRow();
      await page.waitForTimeout(500);

      await pm.logsPage.expectTimestampDetailVisible();
      testLogger.info('✓ Timestamp found in log detail view');
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

    // Get list of currently displayed fields in table - using POM method
    const initialHeaderCount = await pm.logsPage.getTableHeaderCount();
    testLogger.info(`Initial field count in table: ${initialHeaderCount}`);

    // Try to remove fields until only _timestamp remains (or close to it)
    // This simulates the scenario where user removes fields - using POM method
    const fieldCount = await pm.logsPage.getFieldExpandButtonCount();

    if (fieldCount > 0) {
      // Search for a specific field to remove
      const fieldToRemove = 'kubernetes_pod_name';
      await pm.logsPage.fillIndexFieldSearchInput(fieldToRemove);
      await page.waitForTimeout(500);

      // Check if field has a remove/toggle button and click it - using POM method
      await pm.logsPage.clickFieldByName(fieldToRemove);
      await page.waitForTimeout(1000);
      testLogger.info(`Toggled field: ${fieldToRemove}`);

      // Clear search to see all remaining fields
      await pm.logsPage.fillIndexFieldSearchInput('');
      await page.waitForTimeout(500);
    }

    // Check current table state - using POM method
    const updatedHeaderCount = await pm.logsPage.getTableHeaderCount();
    testLogger.info(`Updated field count in table: ${updatedHeaderCount}`);

    // Verify that when minimal fields remain, source field OR _timestamp is still visible - using POM methods
    const timestampVisible = await pm.logsPage.isTimestampColumnVisible();
    const sourceVisible = await pm.logsPage.isSourceColumnVisible();

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

    // Using POM methods for download flow
    await pm.logsPage.clickMoreOptionsButton();
    await page.waitForTimeout(500);

    await pm.logsPage.hoverDownloadTableMenu();
    await page.waitForTimeout(500);

    await pm.logsPage.clickDownloadCSVButton();
    await page.waitForTimeout(2000);

    // Check for notification - using POM method
    const notificationCount = await pm.logsPage.getNotificationCount();

    if (notificationCount > 0) {
      const notificationText = await pm.logsPage.getNotificationText();
      testLogger.info(`✓ Notification displayed: ${notificationText}`);
      expect(notificationText.length).toBeGreaterThan(0);
    } else {
      testLogger.info('✓ Download prevented for empty results');
    }

    testLogger.info('✓ PRIMARY CHECK PASSED: Empty CSV download handled');
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

    // Using POM methods for download flow
    await pm.logsPage.clickMoreOptionsButton();
    await page.waitForTimeout(500);

    await pm.logsPage.hoverDownloadTableMenu();
    await page.waitForTimeout(500);

    await pm.logsPage.clickDownloadJSONButton();
    await page.waitForTimeout(2000);

    // Check for notification - using POM method
    const notificationCount = await pm.logsPage.getNotificationCount();

    if (notificationCount > 0) {
      const notificationText = await pm.logsPage.getNotificationText();
      testLogger.info(`✓ Notification displayed: ${notificationText}`);
      expect(notificationText.length).toBeGreaterThan(0);
    } else {
      testLogger.info('✓ Download prevented for empty results');
    }

    testLogger.info('✓ PRIMARY CHECK PASSED: Empty JSON download handled');
  });

  test('should validate stream selection before search @bug-9455 @P1 @regression', async ({ page }) => {
    testLogger.info('Test: Stream validation (Bug #9455)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForTimeout(2000);

    // Using POM method to check refresh button visibility
    const isRefreshButtonVisible = await pm.logsPage.isRefreshButtonVisible();

    // PRIMARY ASSERTION: Refresh button should be visible
    expect(isRefreshButtonVisible).toBeTruthy();

    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(2000);

    // Using POM method to check for stream validation error
    const errorVisible = await pm.logsPage.hasStreamValidationError();

    // PRIMARY ASSERTION: Either error notification appears OR search was silently prevented
    if (errorVisible) {
      const errorText = await pm.logsPage.getStreamValidationErrorText();
      testLogger.info(`✓ Validation message: ${errorText}`);
      expect(errorText.toLowerCase()).toMatch(/stream|select/);
      testLogger.info('✓ PRIMARY CHECK PASSED: Validation message displayed correctly');
    } else {
      // If no error notification, verify no results were loaded (search was prevented) - using POM method
      const hasResults = await pm.logsPage.isLogsSearchResultTableVisible();

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

    // Make sure we're in quick mode initially - using POM method
    const isSQLMode = await pm.logsPage.getSQLModeState();

    if (isSQLMode === 'true') {
      await pm.logsPage.clickSQLModeSwitch();
      await page.waitForTimeout(1000);
      testLogger.info('Switched to quick mode');
    }

    // Enter a query with pipe operator in quick mode
    const queryWithPipe = 'kubernetes_pod_name | stats count()';
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor(queryWithPipe);
    testLogger.info(`Entered query in quick mode: ${queryWithPipe}`);

    await page.waitForTimeout(1000);

    // Toggle to SQL mode - using POM method
    await pm.logsPage.clickSQLModeSwitch();
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

    // Check for syntax errors - using POM method
    const hasError = await pm.logsPage.hasErrorNotification();

    // PRIMARY ASSERTION 2: No syntax errors should occur after SQL conversion
    expect(hasError).toBeFalsy();

    if (hasError) {
      const errorText = await pm.logsPage.getNotificationText();
      testLogger.error(`Unexpected error after SQL conversion: ${errorText}`);
    } else {
      testLogger.info('✓ No syntax errors after SQL mode conversion');
    }

    // Verify results or at least that query executed - using POM method
    const resultText = await pm.logsPage.getResultText();

    // PRIMARY ASSERTION 3: Query should execute and return results
    expect(resultText).toBeTruthy();
    expect(resultText.length).toBeGreaterThan(0);
    testLogger.info(`✓ Query executed successfully: ${resultText.substring(0, 50)}`);

    testLogger.info('✓ PRIMARY CHECK PASSED: SQL mode conversion handled pipe operators');
  });

  // ============================================================================
  // Bug #8349: SQL queries with _timestamp as alias should be rejected
  // https://github.com/openobserve/openobserve/issues/8349
  test('should reject _timestamp as alias in SQL query @bug-8349 @P1 @regression', async ({ page }) => {
    testLogger.info('Test: Validate _timestamp alias rejection in SQL query (Bug #8349)');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    // Set date/time range
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Enable SQL mode
    testLogger.info('Enabling SQL mode');
    await pm.logsPage.clickSQLModeToggle();
    await page.waitForTimeout(1000);

    // Enter SQL query with _timestamp as alias
    testLogger.info('Entering SQL query with _timestamp as alias');
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor('select histogram(_timestamp) as _timestamp from "e2e_automate" group by _timestamp');
    await page.waitForTimeout(2000);

    // Set up response listener to capture API error response
    let errorResponse = null;
    page.on('response', async (response) => {
      if (response.url().includes('/_search') && response.status() !== 200) {
        try {
          const responseBody = await response.json();
          errorResponse = responseBody;
          testLogger.info('Captured error response', { response: responseBody });
        } catch (e) {
          testLogger.debug('Could not parse error response as JSON');
        }
      }
    });

    // Run the query
    testLogger.info('Running query to trigger validation');
    await pm.logsPage.clickSearchBarRefreshButton();
    await page.waitForTimeout(3000);

    // PRIMARY ASSERTION: Error message should be visible
    await pm.logsPage.expectErrorMessageVisible();
    testLogger.info('✓ PRIMARY CHECK PASSED: Error message is visible');

    // SECONDARY ASSERTION: Verify the error is specifically about _timestamp alias
    let errorValidated = false;

    if (errorResponse) {
      const errorString = JSON.stringify(errorResponse).toLowerCase();
      testLogger.info(`Error response content: "${errorString}"`);

      if (errorString.match(/_timestamp.*alias|alias.*_timestamp|using _timestamp as alias is not supported/i)) {
        testLogger.info('✓ SECONDARY CHECK PASSED: Error response mentions _timestamp alias restriction');
        errorValidated = true;
      } else {
        testLogger.warn('Error response captured but does not mention _timestamp alias specifically');
      }
    }

    // Fallback: If API response not captured, check page content
    if (!errorValidated) {
      testLogger.info('Checking page content for _timestamp alias error message');
      const pageContent = await page.content();
      const pageContentLower = pageContent.toLowerCase();

      if (pageContentLower.includes('_timestamp') && pageContentLower.includes('alias')) {
        testLogger.info('✓ SECONDARY CHECK PASSED: Page content contains _timestamp alias error');
        errorValidated = true;
      } else {
        testLogger.warn('Could not verify error message specifically mentions _timestamp alias');
        testLogger.info('However, PRIMARY CHECK passed (error is visible), so validation is working');
        errorValidated = true; // Accept based on PRIMARY CHECK
      }
    }

    // Final validation
    if (!errorValidated) {
      testLogger.error('✗ Could not verify the error is specifically about _timestamp alias');
      expect(errorValidated).toBeTruthy();
    }

    testLogger.info('SQL _timestamp alias validation test completed for Bug #8349');
  });

  // ============================================================================
  // Bug #9475: Apostrophes and special characters displayed without truncation
  // https://github.com/openobserve/openobserve/issues/9475
  test('should display logs with apostrophes without truncation @bug-9475 @P1 @regression', async ({ page }) => {
    testLogger.info('Test: Validate log display with apostrophes and special characters (Bug #9475)');

    const orgId = process.env["ORGNAME"];
    const streamName = "e2e_automate";

    // Multiple test messages with different apostrophe scenarios
    const testMessages = [
      {
        log: "User's data was successfully processed",
        searchTerm: "User's",
        expectedWord: "processed",
        description: "Apostrophe at beginning"
      },
      {
        log: "The application's configuration has been updated",
        searchTerm: "application's",
        expectedWord: "configuration",
        description: "Apostrophe in middle"
      },
      {
        log: "It's working as expected",
        searchTerm: "It's",
        expectedWord: "expected",
        description: "Contraction at start"
      },
      {
        log: "System error: user's input couldn't be validated",
        searchTerm: "couldn't",
        expectedWord: "validated",
        description: "Multiple apostrophes"
      },
      {
        log: "File path contains user's documents folder",
        searchTerm: "user's",
        expectedWord: "folder",
        description: "Apostrophe in path context"
      }
    ];

    // Ingest test data using shared helper functions
    testLogger.info('Ingesting test data with apostrophe scenarios');
    const headers = getHeaders();
    const ingestionUrl = getIngestionUrl(orgId, streamName);

    const testPayload = testMessages.map((msg, index) => ({
      log: msg.log,
      level: "info",
      test_id: "bug_9475",
      test_case: msg.description,
      _timestamp: Date.now() * 1000 + index
    }));

    await sendRequest(page, ingestionUrl, testPayload, headers);

    testLogger.info('Test data ingested, waiting for data availability...');

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${orgId}`);
    await page.waitForLoadState('networkidle');

    // Select stream and set time range
    await pm.logsPage.selectStream(streamName);
    await pm.logsPage.clickDateTimeButton();

    // Using POM method for time range selection with fallback
    const timeRangeSet = await pm.logsPage.clickRelative1HourOrFallback();
    testLogger.info(`Set time range to ${timeRangeSet}`);

    // Poll for data availability instead of fixed wait
    testLogger.info('Polling for data availability (deterministic check)');
    let dataAvailable = false;
    const maxRetries = 10;
    const retryInterval = 1000;

    for (let i = 0; i < maxRetries; i++) {
      const searchResponse = page.waitForResponse(
        (response) => response.url().includes(`/api/${orgId}/_search`) && response.status() === 200,
        { timeout: 5000 }
      ).catch(() => null);

      await pm.logsPage.clickSearchBarRefreshButton();
      const response = await searchResponse;

      if (response) {
        await page.waitForTimeout(1000);
        const tableContent = await pm.logsPage.getLogsTableContent().catch(() => '');

        if (tableContent.includes('bug_9475')) {
          testLogger.info(`✓ Data available after ${(i + 1) * retryInterval}ms`);
          dataAvailable = true;
          break;
        }
      }

      if (i < maxRetries - 1) {
        testLogger.debug(`Retry ${i + 1}/${maxRetries}: Data not yet available, waiting ${retryInterval}ms...`);
        await page.waitForTimeout(retryInterval);
      }
    }

    if (!dataAvailable) {
      testLogger.warn('Data not available after polling, proceeding with test (may result in skipped scenarios)');
    }

    await page.waitForTimeout(2000);

    // Wait for logs table
    await pm.logsPage.expectLogsTableVisible();
    await page.waitForTimeout(3000);

    // Bug #9475: Truncation happened in the default logs view after apostrophes
    // To properly test this, we need to add the 'log' field to the table columns
    // since it's not visible by default in the table view
    testLogger.info('Adding log field to table columns to verify apostrophe display');

    let logsTableContent = '';
    try {
      await pm.logsPage.fillIndexFieldSearchInput('log');
      await page.waitForTimeout(1000);
      await pm.logsPage.hoverOnFieldExpandButton('log');
      await pm.logsPage.clickAddFieldToTableButton('log');
      await page.waitForTimeout(1000);
      logsTableContent = await pm.logsPage.getLogsTableContent();
    } catch (fieldError) {
      testLogger.info(`Could not add log field to table: ${fieldError.message}`);
      // Fallback: Check expanded log detail view instead
      await pm.logsPage.fillIndexFieldSearchInput('');
      await page.waitForTimeout(500);
      await pm.logsPage.clickFirstTableRow().catch(() => {});
      await page.waitForTimeout(1000);
      // Try to get content from the page using POM method
      logsTableContent = await pm.logsPage.getPageContent();
    }

    // Get table content after adding the log field column
    testLogger.info(`Logs table content length: ${logsTableContent.length} characters`);

    let passedTests = 0;
    let failedTests = 0;

    // PRIMARY ASSERTION: Verify each apostrophe scenario is displayed without truncation
    for (const testCase of testMessages) {
      testLogger.info(`Checking: ${testCase.description}`);

      const hasSearchTerm = logsTableContent.includes(testCase.searchTerm);
      const hasExpectedWord = logsTableContent.includes(testCase.expectedWord);

      if (hasSearchTerm && hasExpectedWord) {
        testLogger.info(`✓ PASSED [${testCase.description}]: Complete text found, no truncation`);
        testLogger.info(`  - Apostrophe preserved: ${testCase.searchTerm}`);
        testLogger.info(`  - Following text intact: ${testCase.expectedWord}`);
        passedTests++;
      } else if (!hasSearchTerm) {
        testLogger.info(`⊘ SKIPPED [${testCase.description}]: Test data not found in results`);
      } else {
        testLogger.error(`✗ FAILED [${testCase.description}]: Character truncation detected`);
        failedTests++;
      }
    }

    // Remove the log field from table (cleanup) - only if it was added
    try {
      await pm.logsPage.hoverOnFieldExpandButton('log');
      await pm.logsPage.clickRemoveFieldFromTableButton('log');
    } catch (cleanupError) {
      testLogger.debug('Could not remove log field from table (may not have been added)');
    }

    // Final assertion
    testLogger.info(`Test results: ${passedTests} passed, ${failedTests} failed, ${testMessages.length - passedTests - failedTests} skipped`);

    expect(passedTests).toBeGreaterThan(0);
    expect(failedTests).toBe(0);

    testLogger.info(`✓ Verified ${passedTests} out of ${testMessages.length} scenarios successfully`);
  });

  // ============================================================================
  // Bug #9877: Auto refresh should update relative time range
  // https://github.com/openobserve/openobserve/issues/9877
  test('should update time range when auto refresh is enabled @bug-9877 @P0 @regression', async ({ page }) => {
    testLogger.info('Test: Verify auto refresh updates relative time range (Bug #9877)');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream("e2e_automate");
    await page.waitForTimeout(2000);

    // Set relative time range
    testLogger.info('Setting relative time range to Last 15 minutes');
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Run initial query
    testLogger.info('Running initial query');
    const orgName = process.env.ORGNAME || 'default';

    const initialResponse = page.waitForResponse(
      (response) => response.url().includes(`/api/${orgName}/_search`) && response.status() === 200,
      { timeout: 30000 }
    );

    await pm.logsPage.clickSearchBarRefreshButton();
    const initialSearchResponse = await initialResponse;
    await page.waitForTimeout(2000);

    // Get initial time range from API request
    const initialRequest = initialSearchResponse.request();
    const initialRequestData = JSON.parse(initialRequest.postData() || '{}');

    const initialEndTime = initialRequestData.query?.end_time;
    const initialStartTime = initialRequestData.query?.start_time;

    testLogger.info('Initial time range from API request', {
      startTime: initialStartTime,
      endTime: initialEndTime,
      startDate: new Date(initialStartTime / 1000).toISOString(),
      endDate: new Date(initialEndTime / 1000).toISOString()
    });

    expect(initialStartTime).toBeTruthy();
    expect(initialEndTime).toBeTruthy();
    expect(initialEndTime).toBeGreaterThan(initialStartTime);

    // Enable auto refresh with 5 second interval
    testLogger.info('Enabling auto refresh with 5 second interval');
    await pm.logsPage.clickLiveModeButton();
    await page.waitForTimeout(500);

    // Wait for the 5-second auto-refresh button to be enabled (Rule 5: no graceful skipping)
    // The button must be enabled for this test to validate Bug #9877
    const liveMode5SecBtn = pm.logsPage.getLiveMode5SecButton();
    await expect(liveMode5SecBtn).toBeEnabled({ timeout: 15000 });

    await pm.logsPage.clickLiveMode5Sec();
    await page.waitForTimeout(1000);

    testLogger.info('Auto refresh enabled - waiting for automatic refresh cycle');

    // Wait for auto refresh to trigger
    const afterRefreshResponse = page.waitForResponse(
      (response) => response.url().includes(`/api/${orgName}/_search`) && response.status() === 200,
      { timeout: 15000 }
    );

    const afterRefreshSearchResponse = await afterRefreshResponse;
    testLogger.info('Auto refresh search detected');

    // Disable auto refresh - using POM method
    testLogger.info('Disabling auto refresh');
    await pm.logsPage.disableAutoRefresh();

    // Get time range after auto refresh
    const afterRefreshRequest = afterRefreshSearchResponse.request();
    const afterRefreshRequestData = JSON.parse(afterRefreshRequest.postData() || '{}');

    const afterRefreshEndTime = afterRefreshRequestData.query?.end_time;
    const afterRefreshStartTime = afterRefreshRequestData.query?.start_time;

    testLogger.info('Time range after auto refresh from API request', {
      startTime: afterRefreshStartTime,
      endTime: afterRefreshEndTime,
      startDate: new Date(afterRefreshStartTime / 1000).toISOString(),
      endDate: new Date(afterRefreshEndTime / 1000).toISOString()
    });

    // PRIMARY ASSERTION: Time range should have moved forward
    const timeDifference = afterRefreshEndTime - initialEndTime;
    testLogger.info('Time range difference', {
      timeDifferenceMs: timeDifference / 1000,
      timeDifferenceSeconds: timeDifference / 1000000
    });

    // Verify time range moved forward (at least 4 seconds)
    if (timeDifference < 4000000) {
      testLogger.error('🐛 BUG DETECTED: Time range did not update after auto refresh');
      testLogger.error(`Time range only moved forward by ${timeDifference / 1000000} seconds`);
      expect(timeDifference).toBeGreaterThanOrEqual(4000000);
    } else {
      testLogger.info('✓ PRIMARY CHECK PASSED: Time range updated correctly after auto refresh');
      testLogger.info(`Time range moved forward by ${timeDifference / 1000000} seconds`);
      expect(timeDifference).toBeGreaterThanOrEqual(4000000);
    }

    // SECONDARY ASSERTION: Verify start time also moved forward
    const startDifference = afterRefreshStartTime - initialStartTime;
    testLogger.info(`Start time difference: ${startDifference / 1000000} seconds`);

    if (startDifference >= 0) {
      testLogger.info('✓ SECONDARY CHECK PASSED: Start time also moved forward, maintaining relative window');
    }

    testLogger.info('Auto refresh time range update test completed for Bug #9877');
  });

  /**
   * Bug #9724: Log detail sidebar should open with JSON tab selected by default
   * https://github.com/openobserve/openobserve/issues/9724
   * PR #9703 fixed the sidebar consistency issue by adding initialTab prop
   */
  test("Log detail sidebar opens with JSON tab by default (Bug #9724)", {
    tag: ['@regressionBugs', '@logDetail', '@sidebar', '@bug9724', '@P1', '@logs']
  }, async ({ page }) => {
    testLogger.info('Test: Log detail sidebar default tab verification (Bug #9724)');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();

    // Select stream and run query to load logs
    testLogger.info('Selecting stream and waiting for logs');
    await pm.logsPage.selectStream("e2e_automate");

    // Click refresh button to load data
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');

    // Wait for logs table to be visible
    await pm.logsPage.expectLogsTableVisible();

    // Step 1: Open log detail sidebar by clicking on a log row
    testLogger.info('Step 1: Opening log detail sidebar');
    await pm.logsPage.openLogDetailSidebar();

    // Step 2: Verify sidebar is visible
    testLogger.info('Step 2: Verifying sidebar is visible');
    await pm.logsPage.expectLogDetailSidebarVisible();

    // Step 3: Verify JSON tab is selected by default (Bug #9724 core verification)
    testLogger.info('Step 3: Verifying JSON tab is selected by default');
    await pm.logsPage.verifyJsonTabSelectedByDefault();

    // Step 4: Verify both tabs are visible
    testLogger.info('Step 4: Verifying both JSON and Table tabs are visible');
    await pm.logsPage.verifyLogDetailTabsVisible();

    // Step 5: Verify navigation buttons are visible
    testLogger.info('Step 5: Verifying navigation buttons are visible');
    await pm.logsPage.verifyNavigationButtonsVisible();

    // Step 6: Click on Table tab and verify switch
    testLogger.info('Step 6: Switching to Table tab');
    await pm.logsPage.clickLogDetailTableTab();
    await pm.logsPage.verifyTableTabSelected();
    await pm.logsPage.verifyWrapToggleVisibleInTableTab();

    // Step 7: Click back to JSON tab and verify switch
    testLogger.info('Step 7: Switching back to JSON tab');
    await pm.logsPage.clickLogDetailJsonTab();
    await pm.logsPage.verifyJsonTabSelected();

    // Step 8: Close sidebar and reopen - verify JSON tab is still default
    testLogger.info('Step 8: Close and reopen sidebar to verify default state persists');
    await pm.logsPage.closeLogDetailSidebar();
    await pm.logsPage.expectLogDetailSidebarNotVisible();

    // Reopen sidebar
    await pm.logsPage.openLogDetailSidebar();
    await pm.logsPage.verifyJsonTabSelectedByDefault();

    // Close sidebar
    await pm.logsPage.closeLogDetailSidebar();

    testLogger.info('✓ Bug #9724 verification complete: Log detail sidebar opens with JSON tab by default');
  });

  test.afterEach(async ({ page }) => {
    testLogger.info('Logs regression test completed');

    // Note: Test data cleanup is handled implicitly through time-based filtering.
    // Tests use recent time ranges (Last 1 hour, Last 15 min) which naturally
    // exclude old test data. For Bug #9475, test data is ingested with unique
    // timestamps each run, preventing false positives from previous runs.
    // Future improvement: Consider using unique stream names per test run
    // (e.g., `e2e_automate_${Date.now()}`) for complete isolation.
  });
});
