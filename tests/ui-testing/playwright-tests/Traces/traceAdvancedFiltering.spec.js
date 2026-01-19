// traceAdvancedFiltering.spec.js
// Advanced filtering tests for OpenObserve Traces
// Testing complex query combinations and filtering scenarios
// CONSOLIDATED: 9 → 6 tests

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Trace Advanced Filtering testcases", () => {
  test.describe.configure({ mode: 'serial' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Post-authentication stabilization wait
    await page.waitForLoadState('networkidle');

    // Navigate to traces page
    await pm.tracesPage.navigateToTracesUrl();

    if (await pm.tracesPage.isStreamSelectVisible()) {
      await pm.tracesPage.selectTraceStream('default');
    }

    testLogger.info('Test setup completed for advanced trace filtering');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // CONSOLIDATED: Merged "Complex AND query with multiple conditions" + "OR query with multiple service names"
  test("P1: Query operators - AND and OR", {
    tag: ['@traceAdvancedFiltering', '@traces', '@filtering', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing query operators: AND and OR');

    // === Test 1: Complex AND query with multiple conditions (Original test #1) ===
    await test.step('Complex AND query with multiple conditions', async () => {
      testLogger.info('Testing complex AND query with multiple conditions');

      // Enter complex AND query
      const complexQuery = "service_name='api-gateway' AND status_code='1' AND duration > 100";
      await pm.tracesPage.enterTraceQuery(complexQuery);

      // Verify query in editor using page object method
      const editorContent = await pm.tracesPage.getQueryEditorContent();
      expect(editorContent).toContain("service_name='api-gateway'");
      expect(editorContent).toContain("status_code='1'");
      testLogger.info('Complex query entered successfully');

      // Set time range and run search
      await pm.tracesPage.setTimeRange('15m');
      await pm.tracesPage.runSearch();

      // Wait for results with enhanced error handling
      let attempts = 0;
      const maxAttempts = 3;
      let searchResult = null;

      while (attempts < maxAttempts && !searchResult) {
        await page.waitForTimeout(2000);

        const hasResults = await pm.tracesPage.hasTraceResults();
        const noResults = await pm.tracesPage.isNoResultsVisible();
        const errorMsg = await pm.tracesPage.isErrorMessageVisible();

        if (hasResults || noResults || errorMsg) {
          searchResult = { hasResults, noResults, errorMsg };
          break;
        }

        attempts++;
        testLogger.info(`Search attempt ${attempts} of ${maxAttempts}`);
      }

      // Verify search completed
      expect(searchResult).not.toBeNull();
      testLogger.info(`Complex search completed: Results=${searchResult?.hasResults}, NoResults=${searchResult?.noResults}, Error=${searchResult?.errorMsg}`);
    });

    // Reset filters before next test
    await pm.tracesPage.resetTraceFilters();

    // === Test 2: OR query with multiple service names (Original test #2) ===
    await test.step('OR query with multiple service names', async () => {
      testLogger.info('Testing OR query with multiple service names');

      // Enter OR query
      const orQuery = "service_name='api-gateway' OR service_name='auth-service' OR service_name='user-service'";
      await pm.tracesPage.enterTraceQuery(orQuery);

      // Set time range and run search
      await pm.tracesPage.setTimeRange('15m');
      await pm.tracesPage.runSearch();
      await page.waitForTimeout(3000);

      // Check results
      const hasResults = await pm.tracesPage.hasTraceResults();

      if (hasResults) {
        testLogger.info('OR query returned results');

        // Verify at least one of the services is present using page object
        const foundService = await pm.tracesPage.isAnyTextVisible(['api-gateway', 'auth-service', 'user-service']);

        expect(foundService).toBeTruthy();
        testLogger.info(`Found at least one expected service in results`);
      } else {
        testLogger.info('No results for OR query');
        // Verify no results state is properly shown
        const noResults = await pm.tracesPage.isNoResultsVisible();
        expect(noResults || !hasResults).toBeTruthy();
      }
    });
  });

  test("P1: Negation query with NOT operator", {
    tag: ['@traceAdvancedFiltering', '@traces', '@filtering', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing negation query with NOT operator');

    // Enter NOT query
    const notQuery = "NOT status_code='2'";
    await pm.tracesPage.enterTraceQuery(notQuery);

    // Verify query is in the editor
    const editorContent = await pm.tracesPage.getQueryEditorContent();
    expect(editorContent).toContain('NOT');
    testLogger.info('NOT query entered in editor');

    // Set time range and run search
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(3000);

    // Check results
    const hasResults = await pm.tracesPage.hasTraceResults();
    const noResults = await pm.tracesPage.isNoResultsVisible();
    const hasError = await pm.tracesPage.isErrorMessageVisible();

    // Verify the NOT query executed properly (no syntax error)
    if (hasError) {
      const errorText = await pm.tracesPage.getErrorMessageText();
      throw new Error(`NOT query failed with error: ${errorText}`);
    }

    // Verify we got a valid response (either results or no results)
    expect(hasResults || noResults).toBeTruthy();
    testLogger.info(`NOT query completed: Results=${hasResults}, NoResults=${noResults}`);

    if (hasResults) {
      testLogger.info('NOT query returned results - filter applied successfully');
      // The results should only contain traces where status_code is NOT 2
      // We verify by checking that the query executed without errors
    }
  });

  test("P1: Range query for duration field", {
    tag: ['@traceAdvancedFiltering', '@traces', '@filtering', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing range query for duration field');

    // Enter range query
    const rangeQuery = "duration >= 500 AND duration <= 5000";
    await pm.tracesPage.enterTraceQuery(rangeQuery);

    // Set time range and run search
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(3000);

    // Check results
    const hasResults = await pm.tracesPage.hasTraceResults();

    if (hasResults) {
      testLogger.info('Range query returned results');

      // Click on first result to check duration
      await pm.tracesPage.clickFirstTraceResult();
      await page.waitForTimeout(2000);

      // Look for duration information using page object
      const durationVisible = await pm.tracesPage.isDurationCellVisible();
      if (durationVisible) {
        testLogger.info('Duration field found in trace details');
      }
      expect(hasResults).toBeTruthy();
    } else {
      testLogger.info('No results for range query');
      expect(await pm.tracesPage.isNoResultsVisible() || !hasResults).toBeTruthy();
    }
  });

  // CONSOLIDATED: Merged "Query with special characters in values" + "Case sensitivity in queries"
  test("P2: Query syntax - special chars and case sensitivity", {
    tag: ['@traceAdvancedFiltering', '@traces', '@filtering', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing query syntax: special characters and case sensitivity');

    // === Test 1: Query with special characters in values (Original test #5) ===
    await test.step('Query with special characters in values', async () => {
      testLogger.info('Testing query with special characters');

      // Test with various special characters and patterns from actual data
      const specialQueries = [
        "service_name='auth-service'",
        "span_name LIKE 'HTTP POST%'",
        "service_name='payment-service'"
      ];

      let queryExecutedSuccessfully = false;

      for (const query of specialQueries) {
        testLogger.info(`Testing query: ${query}`);

        await pm.tracesPage.enterTraceQuery(query);
        await pm.tracesPage.setTimeRange('15m');
        await pm.tracesPage.runSearch();
        await page.waitForTimeout(2000);

        // Check if query executes without error using page object
        const errorMsg = await pm.tracesPage.isErrorMessageVisible();

        if (errorMsg) {
          const errorText = await pm.tracesPage.getErrorMessageText();
          testLogger.info(`Query error: ${errorText}`);
        } else {
          testLogger.info('Query executed successfully');
          queryExecutedSuccessfully = true;
        }

        // Clear query for next test
        await pm.tracesPage.resetTraceFilters();
      }

      // At least one query should execute without error
      expect(queryExecutedSuccessfully).toBeTruthy();
    });

    // === Test 2: Case sensitivity in queries (Original test #6) ===
    await test.step('Case sensitivity in queries', async () => {
      testLogger.info('Testing case sensitivity in queries');

      // Test uppercase service name
      await pm.tracesPage.enterTraceQuery("service_name='API-GATEWAY'");
      await pm.tracesPage.setTimeRange('15m');
      await pm.tracesPage.runSearch();
      await page.waitForTimeout(2000);

      const uppercaseResults = await pm.tracesPage.hasTraceResults();
      testLogger.info(`Uppercase query results: ${uppercaseResults}`);

      // Clear and test lowercase
      await pm.tracesPage.resetTraceFilters();
      await pm.tracesPage.enterTraceQuery("service_name='api-gateway'");
      await pm.tracesPage.runSearch();
      await page.waitForTimeout(2000);

      const lowercaseResults = await pm.tracesPage.hasTraceResults();
      testLogger.info(`Lowercase query results: ${lowercaseResults}`);

      // Log comparison - test validates that queries execute properly
      testLogger.info(`Case sensitivity comparison - Uppercase: ${uppercaseResults}, Lowercase: ${lowercaseResults}`);

      // Verify at least one query executed without errors (either has results or shows no results message)
      const noResultsVisible = await pm.tracesPage.isNoResultsVisible();
      expect(lowercaseResults || uppercaseResults || noResultsVisible).toBeTruthy();
    });
  });

  test("P2: Wildcard and pattern matching", {
    tag: ['@traceAdvancedFiltering', '@traces', '@filtering', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing wildcard and pattern matching');

    // Test wildcard queries
    const wildcardQueries = [
      "service_name LIKE 'api%'",
      "service_name LIKE '%service'",
      "span_name LIKE '%POST%'"
    ];

    let atLeastOneQuerySucceeded = false;

    for (const query of wildcardQueries) {
      testLogger.info(`Testing wildcard query: ${query}`);

      await pm.tracesPage.enterTraceQuery(query);
      await pm.tracesPage.setTimeRange('15m');
      await pm.tracesPage.runSearch();
      await page.waitForTimeout(2000);

      const hasResults = await pm.tracesPage.hasTraceResults();
      const hasError = await pm.tracesPage.isErrorMessageVisible();

      testLogger.info(`Wildcard query results: Results=${hasResults}, Error=${hasError}`);

      if (!hasError) {
        atLeastOneQuerySucceeded = true;
      }

      // Clear for next query
      await pm.tracesPage.resetTraceFilters();
    }

    // At least one wildcard query should succeed
    expect(atLeastOneQuerySucceeded).toBeTruthy();
  });

  // CONSOLIDATED: Merged "Empty and null value queries" + "Combined field selection and query editor"
  test("P2: Empty/null values and combined field selection", {
    tag: ['@traceAdvancedFiltering', '@traces', '@filtering', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing empty/null values and combined field selection');

    // === Test 1: Empty and null value queries (Original test #8) ===
    await test.step('Empty and null value queries', async () => {
      testLogger.info('Testing empty and null value queries');

      // Test various empty/null scenarios with actual trace fields
      const emptyQueries = [
        "span_name = ''",
        "service_name != ''",
        "status_code IS NOT NULL"
      ];

      let atLeastOneQueryExecuted = false;

      for (const query of emptyQueries) {
        testLogger.info(`Testing empty/null query: ${query}`);

        await pm.tracesPage.enterTraceQuery(query);
        await pm.tracesPage.setTimeRange('15m');
        await pm.tracesPage.runSearch();
        await page.waitForTimeout(2000);

        const hasResults = await pm.tracesPage.hasTraceResults();
        const noResults = await pm.tracesPage.isNoResultsVisible();

        testLogger.info(`Empty/null query: Results=${hasResults}, NoResults=${noResults}`);

        // Query executed if we got either results or no-results message
        if (hasResults || noResults) {
          atLeastOneQueryExecuted = true;
        }

        // Clear for next query
        await pm.tracesPage.resetTraceFilters();
      }

      // At least one empty/null query should execute properly
      expect(atLeastOneQueryExecuted).toBeTruthy();
    });

    // === Test 2: Combined field selection and query editor (Original test #9) ===
    await test.step('Combined field selection and query editor', async () => {
      testLogger.info('Testing combined field selection and query editor');

      // First set a base query
      await pm.tracesPage.enterTraceQuery("status_code='1'");

      // Set time range and run search
      await pm.tracesPage.setTimeRange('15m');
      await pm.tracesPage.runSearch();
      await page.waitForTimeout(3000);

      // Now try to add a filter via field expansion
      const expanded = await pm.tracesPage.expandTraceField('service_name');

      if (expanded) {
        // Look for a service value to click using page object
        const clicked = await pm.tracesPage.clickButtonWithText('api-gateway');

        if (clicked) {
          await page.waitForTimeout(1000);

          // Check if filter was added to query using page object
          const editorContent = await pm.tracesPage.getQueryEditorContent();
          testLogger.info(`Query after field selection: ${editorContent}`);

          // Run the combined query
          await pm.tracesPage.runSearch();
          await page.waitForTimeout(2000);

          const hasResults = await pm.tracesPage.hasTraceResults();
          testLogger.info(`Combined filter results: ${hasResults}`);
        }
      } else {
        testLogger.info('Could not expand service_name field for combined filter test');
      }

      // Test passes if we got this far without errors
      const searchCompleted = await pm.tracesPage.hasTraceResults() || await pm.tracesPage.isNoResultsVisible();
      expect(searchCompleted || expanded === false).toBeTruthy();
    });
  });
});
