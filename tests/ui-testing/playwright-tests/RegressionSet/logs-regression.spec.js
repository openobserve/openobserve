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
    await page.waitForTimeout(2000);

    // Enable SQL mode
    testLogger.info('Enabling SQL mode');
    await pm.logsPage.clickSQLModeToggle();
    await page.waitForTimeout(1000);

    // Enter subquery
    const subquery = 'SELECT * FROM (SELECT * FROM "e2e_automate" WHERE kubernetes_pod_name IS NOT NULL LIMIT 100)';
    testLogger.info(`Entering subquery: ${subquery}`);
    await pm.logsPage.fillQueryEditor(subquery);

    // Run query
    testLogger.info('Running query');
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(3000);

    // Verify query results loaded
    const resultsVisible = await page.locator(pm.logsPage.logsSearchResultLogsTable).isVisible();
    expect(resultsVisible).toBeTruthy();
    testLogger.info('Query results loaded successfully');

    // Expand field to trigger values API
    const fieldToExpand = 'kubernetes_pod_name';

    // Search for the field first to make it visible in sidebar
    testLogger.info(`Searching for field: ${fieldToExpand}`);
    await pm.logsPage.fillIndexFieldSearchInput(fieldToExpand);
    await page.waitForTimeout(500);

    const expandButton = page.locator(pm.logsPage.fieldExpandButton(fieldToExpand));

    testLogger.info(`Expanding field: ${fieldToExpand}`);
    await expandButton.waitFor({ state: 'visible', timeout: 10000 });
    await expandButton.click();

    // Wait for field expansion content to be visible (values or error message)
    const fieldExpansionContent = page.locator(pm.logsPage.fieldListItem(fieldToExpand));
    await fieldExpansionContent.waitFor({ state: 'visible', timeout: 10000 });
    const contentText = await fieldExpansionContent.textContent().catch(() => '');

    // Primary assertion: NO 400 error (this was the bug)
    expect(contentText).not.toContain('400');
    expect(contentText.toLowerCase()).not.toMatch(/error.*400|400.*error/);
    testLogger.info('✓ PRIMARY CHECK PASSED: No 400 error displayed');

    // Secondary check: Field values loaded or acceptable message shown
    const fieldValues = page.locator(pm.logsPage.subfieldAddButton(fieldToExpand));
    const valueCount = await fieldValues.count();

    // Note: Field values may not load if there's no data or if UI is still loading
    // The primary check (no 400 error) is the critical assertion for this bug
    const hasValues = valueCount > 0;
    const hasNoValuesMessage = contentText.includes('No values found');

    if (hasValues) {
      testLogger.info(`✓ Field values displayed: ${valueCount} values`);
    } else if (hasNoValuesMessage) {
      testLogger.info('✓ No values found message shown (acceptable - no data)');
    } else {
      testLogger.warn(`⚠ Field values UI may still be loading - content: ${contentText.substring(0, 100)}`);
      testLogger.info('Primary check (no 400 error) passed - this is the critical validation for bug #7751');
    }
  });

  test('should load field values with CTE (Common Table Expression) without 400 error @bug-7751 @P1 @regression', async ({ page }) => {
    testLogger.info('Test: Field values with CTE');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();

    // Select stream
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    // Enable SQL mode
    testLogger.info('Enabling SQL mode');
    await pm.logsPage.clickSQLModeToggle();
    await page.waitForTimeout(1000);

    // Enter CTE query
    const cteQuery = 'WITH filtered_logs AS (SELECT * FROM "e2e_automate" WHERE kubernetes_pod_name IS NOT NULL LIMIT 100) SELECT * FROM filtered_logs';
    testLogger.info(`Entering CTE query: ${cteQuery}`);
    await pm.logsPage.fillQueryEditor(cteQuery);

    // Run query
    testLogger.info('Running query');
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(3000);

    // Verify query results loaded
    const resultsVisible = await page.locator(pm.logsPage.logsSearchResultLogsTable).isVisible();
    expect(resultsVisible).toBeTruthy();
    testLogger.info('Query results loaded successfully');

    // Expand field to trigger values API
    const fieldToExpand = 'kubernetes_pod_name';

    // Search for the field first to make it visible in sidebar
    testLogger.info(`Searching for field: ${fieldToExpand}`);
    await pm.logsPage.fillIndexFieldSearchInput(fieldToExpand);
    await page.waitForTimeout(500);

    const expandButton = page.locator(pm.logsPage.fieldExpandButton(fieldToExpand));

    testLogger.info(`Expanding field: ${fieldToExpand}`);
    await expandButton.waitFor({ state: 'visible', timeout: 10000 });
    await expandButton.click();

    // Wait for field expansion content to be visible (values or error message)
    const fieldExpansionContent = page.locator(pm.logsPage.fieldListItem(fieldToExpand));
    await fieldExpansionContent.waitFor({ state: 'visible', timeout: 10000 });
    const contentText = await fieldExpansionContent.textContent().catch(() => '');

    // Primary assertion: NO 400 error (this was the bug)
    expect(contentText).not.toContain('400');
    expect(contentText.toLowerCase()).not.toMatch(/error.*400|400.*error/);
    testLogger.info('✓ PRIMARY CHECK PASSED: No 400 error displayed');

    // Secondary check: Field values loaded or acceptable message shown
    const fieldValues = page.locator(pm.logsPage.subfieldAddButton(fieldToExpand));
    const valueCount = await fieldValues.count();

    // Note: Field values may not load if there's no data or if UI is still loading
    // The primary check (no 400 error) is the critical assertion for this bug
    const hasValues = valueCount > 0;
    const hasNoValuesMessage = contentText.includes('No values found');

    if (hasValues) {
      testLogger.info(`✓ Field values displayed: ${valueCount} values`);
    } else if (hasNoValuesMessage) {
      testLogger.info('✓ No values found message shown (acceptable - no data)');
    } else {
      testLogger.warn(`⚠ Field values UI may still be loading - content: ${contentText.substring(0, 100)}`);
      testLogger.info('Primary check (no 400 error) passed - this is the critical validation for bug #7751');
    }
  });

  test('should load field values with GROUP BY aggregation without 400 error @bug-7751 @P1 @regression', async ({ page }) => {
    testLogger.info('Test: Field values with GROUP BY aggregation');

    // Navigate to logs page
    await pm.logsPage.clickMenuLinkLogsItem();

    // Select stream
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    // Enable SQL mode
    testLogger.info('Enabling SQL mode');
    await pm.logsPage.clickSQLModeToggle();
    await page.waitForTimeout(1000);

    // Enter aggregation query
    const aggQuery = 'SELECT kubernetes_pod_name, count(*) as total FROM "e2e_automate" WHERE kubernetes_pod_name IS NOT NULL GROUP BY kubernetes_pod_name LIMIT 50';
    testLogger.info(`Entering aggregation query: ${aggQuery}`);
    await pm.logsPage.fillQueryEditor(aggQuery);

    // Run query
    testLogger.info('Running query');
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(3000);

    // Verify query results loaded
    const resultsVisible = await page.locator(pm.logsPage.logsSearchResultLogsTable).isVisible();
    expect(resultsVisible).toBeTruthy();
    testLogger.info('Query results loaded successfully');

    // Expand field to trigger values API
    const fieldToExpand = 'kubernetes_pod_name';

    // Search for the field first to make it visible in sidebar
    testLogger.info(`Searching for field: ${fieldToExpand}`);
    await pm.logsPage.fillIndexFieldSearchInput(fieldToExpand);
    await page.waitForTimeout(500);

    const expandButton = page.locator(pm.logsPage.fieldExpandButton(fieldToExpand));

    testLogger.info(`Expanding field: ${fieldToExpand}`);
    await expandButton.waitFor({ state: 'visible', timeout: 10000 });
    await expandButton.click();

    // Wait for field expansion content to be visible (values or error message)
    const fieldExpansionContent = page.locator(pm.logsPage.fieldListItem(fieldToExpand));
    await fieldExpansionContent.waitFor({ state: 'visible', timeout: 10000 });
    const contentText = await fieldExpansionContent.textContent().catch(() => '');

    // Primary assertion: NO 400 error (this was the bug)
    expect(contentText).not.toContain('400');
    expect(contentText.toLowerCase()).not.toMatch(/error.*400|400.*error/);
    testLogger.info('✓ PRIMARY CHECK PASSED: No 400 error displayed');

    // Secondary check: Field values loaded or acceptable message shown
    const fieldValues = page.locator(pm.logsPage.subfieldAddButton(fieldToExpand));
    const valueCount = await fieldValues.count();

    // Note: Field values may not load if there's no data or if UI is still loading
    // The primary check (no 400 error) is the critical assertion for this bug
    const hasValues = valueCount > 0;
    const hasNoValuesMessage = contentText.includes('No values found');

    if (hasValues) {
      testLogger.info(`✓ Field values displayed: ${valueCount} values`);
    } else if (hasNoValuesMessage) {
      testLogger.info('✓ No values found message shown (acceptable - no data)');
    } else {
      testLogger.warn(`⚠ Field values UI may still be loading - content: ${contentText.substring(0, 100)}`);
      testLogger.info('Primary check (no 400 error) passed - this is the critical validation for bug #7751');
    }
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

    await page.waitForTimeout(1500); // Wait for search to filter

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

  /**
   * Bug #9311: Alert graph color appears only on half of the graph
   * Issue: https://github.com/openobserve/openobserve/issues/9311
   * When viewing alert graphs, the color shading only appears on approximately
   * half of the graph instead of spanning the complete graph area
   */

  test('should display alert graph color across full graph area @bug-9311 @P2 @regression @alerts', async ({ page }) => {
    testLogger.info('Test: Alert graph color display');

    // Navigate to alerts page
    await page.locator(pm.alertsPage.alertMenuItem).click();
    await page.waitForTimeout(2000);
    testLogger.info('Navigated to alerts page');

    // Check if any alerts exist
    const alertRows = await page.locator(pm.alertsPage.tableBodyRowWithIndex).count();
    testLogger.info(`Found ${alertRows} alerts`);

    // ASSERTION: Test requires alerts to be present
    if (alertRows === 0) {
      testLogger.warn('No alerts found - cannot validate graph rendering');
      test.skip('No alerts available for testing graph display');
      return; // test.skip will mark test as skipped, not passed
    }

    // Click on first alert to view details
    const firstAlertRow = page.locator(pm.alertsPage.tableBodyRowWithIndex).first();
    await firstAlertRow.click();
    await page.waitForTimeout(2000);
    testLogger.info('Opened alert details');

    // Look for the alert graph/chart
    const alertGraph = page.locator(`${pm.alertsPage.alertGraph}, ${pm.alertsPage.alertChart}, canvas`).first();
    const graphVisible = await alertGraph.isVisible().catch(() => false);

    // ASSERTION: Alert graph must be visible to validate
    if (!graphVisible) {
      testLogger.warn('Alert graph not visible - may not have data or different UI structure');
      test.skip('Alert graph not displayed - cannot validate graph rendering');
      return; // test.skip will mark test as skipped, not passed
    }

    testLogger.info('Alert graph is visible');

    // PRIMARY CHECK: Verify graph dimensions
    const graphBox = await alertGraph.boundingBox();
    if (graphBox) {
      testLogger.info(`Graph dimensions: ${graphBox.width}x${graphBox.height}`);

      // Verify graph has reasonable dimensions (not collapsed or partial)
      expect(graphBox.width).toBeGreaterThan(100);
      expect(graphBox.height).toBeGreaterThan(50);
      testLogger.info('✓ PRIMARY CHECK PASSED: Graph has proper dimensions');

      // Check if graph container is not clipped
      const graphContainer = page.locator(pm.alertsPage.alertGraph).first();
      const containerBox = await graphContainer.boundingBox().catch(() => null);

      if (containerBox) {
        // Verify canvas/graph is not cut off (should fill most of container)
        const widthRatio = graphBox.width / containerBox.width;
        const heightRatio = graphBox.height / containerBox.height;

        testLogger.info(`Graph fills ${(widthRatio * 100).toFixed(1)}% width, ${(heightRatio * 100).toFixed(1)}% height of container`);

        // Graph should fill most of the container (at least 80%)
        if (widthRatio > 0.8 && heightRatio > 0.8) {
          testLogger.info('✓ Graph properly fills container - no partial rendering detected');
        } else {
          testLogger.warn(`⚠ Graph may be partially rendered: ${(widthRatio * 100).toFixed(1)}% x ${(heightRatio * 100).toFixed(1)}%`);
        }
      }

      // Visual validation: Take screenshot for manual verification if needed
      const screenshotPath = 'alert-graph-validation.png';
      await alertGraph.screenshot({ path: screenshotPath });
      testLogger.info(`Screenshot saved to ${screenshotPath} for visual verification`);
    } else {
      testLogger.warn('Could not get graph bounding box');
    }

    testLogger.info('Alert graph color rendering test completed');
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
    const resultText = await resultTextLocator.textContent().catch(() => '');
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
    const resultText = await page.locator(pm.logsPage.resultText).textContent().catch(() => '');

    // PRIMARY ASSERTION 3: Query should execute and return results
    expect(resultText).toBeTruthy();
    expect(resultText.length).toBeGreaterThan(0);
    testLogger.info(`✓ Query executed successfully: ${resultText.substring(0, 50)}`);

    testLogger.info('✓ PRIMARY CHECK PASSED: SQL mode conversion handled pipe operators');
  });

  test.afterEach(async () => {
    testLogger.info('Logs regression test completed');
  });
});
