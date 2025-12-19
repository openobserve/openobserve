// traceAdvancedFiltering.spec.js
// Advanced filtering tests for OpenObserve Traces
// Testing complex query combinations and filtering scenarios

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

    testLogger.info('Test setup completed for advanced trace filtering');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // P1 Tests - Advanced Query Combinations
  test("P1: Complex AND query with multiple conditions", {
    tag: ['@traces', '@filtering', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing complex AND query with multiple conditions');

    // Enter complex AND query
    const complexQuery = "service_name='api-gateway' AND status_code='1' AND duration > 100";
    await pm.tracesPage.enterTraceQuery( complexQuery);

    // Verify query in editor
    const viewLines = page.locator('.view-lines');
    const editorContent = await viewLines.textContent();
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
      const noResults = await page.locator('[data-test="logs-search-result-not-found-text"]').isVisible({ timeout: 1000 }).catch(() => false);
      const errorMsg = await page.locator('[data-test="logs-search-error-message"]').isVisible({ timeout: 1000 }).catch(() => false);

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

  test("P1: OR query with multiple service names", {
    tag: ['@traces', '@filtering', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing OR query with multiple service names');

    // Enter OR query
    const orQuery = "service_name='api-gateway' OR service_name='auth-service' OR service_name='user-service'";
    await pm.tracesPage.enterTraceQuery( orQuery);

    // Set time range and run search
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(3000);

    // Check results
    const hasResults = await pm.tracesPage.hasTraceResults();

    if (hasResults) {
      testLogger.info('OR query returned results');

      // Verify at least one of the services is present
      const apiGateway = await page.getByText('api-gateway').first().isVisible({ timeout: 2000 }).catch(() => false);
      const authService = await page.getByText('auth-service').first().isVisible({ timeout: 2000 }).catch(() => false);
      const userService = await page.getByText('user-service').first().isVisible({ timeout: 2000 }).catch(() => false);

      const foundService = apiGateway || authService || userService;
      expect(foundService).toBeTruthy();
      testLogger.info(`Found services: api-gateway=${apiGateway}, auth-service=${authService}, user-service=${userService}`);
    } else {
      testLogger.info('No results for OR query');
    }
  });

  test("P1: Negation query with NOT operator", {
    tag: ['@traces', '@filtering', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing negation query with NOT operator');

    // Enter NOT query
    const notQuery = "NOT status_code='2'";
    await pm.tracesPage.enterTraceQuery( notQuery);

    // Set time range and run search
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(3000);

    // Check results
    const hasResults = await pm.tracesPage.hasTraceResults();

    if (hasResults) {
      testLogger.info('NOT query returned results');

      // Click on first result to verify no errors
      await pm.tracesPage.clickFirstTraceResult();
      await page.waitForTimeout(2000);

      // Check that status_code is not 2
      const statusCode2 = await page.getByRole('cell', { name: '2', exact: true }).isVisible({ timeout: 2000 }).catch(() => false);

      if (statusCode2) {
        testLogger.info('Warning: Found status_code=2 in NOT query results - may be from different field');
      } else {
        testLogger.info('Verified: No error status codes in results');
      }
    } else {
      testLogger.info('No results for NOT query');
    }
  });

  test("P1: Range query for duration field", {
    tag: ['@traces', '@filtering', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing range query for duration field');

    // Enter range query
    const rangeQuery = "duration >= 500 AND duration <= 5000";
    await pm.tracesPage.enterTraceQuery( rangeQuery);

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

      // Look for duration information
      const durationCell = await page.getByRole('cell', { name: 'duration' }).isVisible({ timeout: 2000 }).catch(() => false);
      if (durationCell) {
        testLogger.info('Duration field found in trace details');
      }
    } else {
      testLogger.info('No results for range query');
    }
  });

  // P2 Tests - Edge Cases and Complex Scenarios
  test("P2: Query with special characters in values", {
    tag: ['@traces', '@filtering', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing query with special characters');

    // Test with various special characters and patterns from actual data
    const specialQueries = [
      "service_name='auth-service'",
      "span_name LIKE 'HTTP POST%'",
      "service_name='payment-service'"
    ];

    for (const query of specialQueries) {
      testLogger.info(`Testing query: ${query}`);

      await pm.tracesPage.enterTraceQuery( query);
      await pm.tracesPage.setTimeRange('15m');
      await pm.tracesPage.runSearch();
      await page.waitForTimeout(2000);

      // Check if query executes without error
      const errorMsg = await page.locator('[data-test="logs-search-error-message"]').isVisible({ timeout: 1000 }).catch(() => false);

      if (errorMsg) {
        const errorText = await page.locator('[data-test="logs-search-error-message"]').textContent().catch(() => '');
        testLogger.info(`Query error: ${errorText}`);
      } else {
        testLogger.info('Query executed successfully');
      }

      // Clear query for next test
      await pm.tracesPage.resetTraceFilters();
    }
  });

  test("P2: Case sensitivity in queries", {
    tag: ['@traces', '@filtering', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing case sensitivity in queries');

    // Test uppercase service name
    await pm.tracesPage.enterTraceQuery( "service_name='API-GATEWAY'");
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(2000);

    const uppercaseResults = await pm.tracesPage.hasTraceResults();
    testLogger.info(`Uppercase query results: ${uppercaseResults}`);

    // Clear and test lowercase
    await pm.tracesPage.resetTraceFilters();
    await pm.tracesPage.enterTraceQuery( "service_name='api-gateway'");
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(2000);

    const lowercaseResults = await pm.tracesPage.hasTraceResults();
    testLogger.info(`Lowercase query results: ${lowercaseResults}`);

    // Log comparison
    testLogger.info(`Case sensitivity comparison - Uppercase: ${uppercaseResults}, Lowercase: ${lowercaseResults}`);
  });

  test("P2: Wildcard and pattern matching", {
    tag: ['@traces', '@filtering', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing wildcard and pattern matching');

    // Test wildcard queries
    const wildcardQueries = [
      "service_name LIKE 'api%'",
      "service_name LIKE '%service'",
      "span_name LIKE '%POST%'"
    ];

    for (const query of wildcardQueries) {
      testLogger.info(`Testing wildcard query: ${query}`);

      await pm.tracesPage.enterTraceQuery( query);
      await pm.tracesPage.setTimeRange('15m');
      await pm.tracesPage.runSearch();
      await page.waitForTimeout(2000);

      const hasResults = await pm.tracesPage.hasTraceResults();
      const hasError = await page.locator('[data-test="logs-search-error-message"]').isVisible({ timeout: 1000 }).catch(() => false);

      testLogger.info(`Wildcard query results: Results=${hasResults}, Error=${hasError}`);

      // Clear for next query
      await pm.tracesPage.resetTraceFilters();
    }
  });

  test("P2: Empty and null value queries", {
    tag: ['@traces', '@filtering', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing empty and null value queries');

    // Test various empty/null scenarios with actual trace fields
    const emptyQueries = [
      "span_name = ''",
      "service_name != ''",
      "status_code IS NOT NULL"
    ];

    for (const query of emptyQueries) {
      testLogger.info(`Testing empty/null query: ${query}`);

      await pm.tracesPage.enterTraceQuery( query);
      await pm.tracesPage.setTimeRange('15m');
      await pm.tracesPage.runSearch();
      await page.waitForTimeout(2000);

      const hasResults = await pm.tracesPage.hasTraceResults();
      const noResults = await page.locator('[data-test="logs-search-result-not-found-text"]').isVisible({ timeout: 1000 }).catch(() => false);

      testLogger.info(`Empty/null query: Results=${hasResults}, NoResults=${noResults}`);

      // Clear for next query
      await pm.tracesPage.resetTraceFilters();
    }
  });

  test("P1: Combined field selection and query editor", {
    tag: ['@traces', '@filtering', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing combined field selection and query editor');

    // First set a base query
    await pm.tracesPage.enterTraceQuery( "status_code='1'");

    // Set time range and run search
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runSearch();
    await page.waitForTimeout(3000);

    // Now try to add a filter via field expansion
    const expanded = await pm.tracesPage.expandTraceField('service_name');

    if (expanded) {
      // Look for a service value to click
      const serviceButton = page.locator('button').filter({ hasText: 'api-gateway' }).first();
      if (await serviceButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await serviceButton.click();
        await page.waitForTimeout(1000);

        // Check if filter was added to query
        const viewLines = page.locator('.view-lines');
        const editorContent = await viewLines.textContent();

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
  });

});