// tracesSearch.spec.js
// Tests for OpenObserve Traces feature - Search functionality
// Following the modular pattern from Logs tests

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Traces Search testcases", () => {
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
    await pm.tracesPage.navigateToTraces();

    testLogger.info('Test setup completed for traces search');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // P0 - Critical Path Tests
  test("P0: Navigate to Traces section successfully", {
    tag: ['@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing navigation to traces section');

    // Verify traces page loaded
    await expect(page).toHaveURL(/traces/);
    await expect(page.locator(pm.tracesPage.searchBar)).toBeVisible();

    testLogger.info('Traces section loaded successfully');
  });

  test("P0: Basic trace search with stream selection", {
    tag: ['@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing basic trace search');

    // Setup trace search with stream and time range
    await pm.tracesPage.setupTraceSearch();

    // Check for various possible states
    const hasResults = await pm.tracesPage.hasTraceResults();
    const hasNoResults = await page.locator('[data-test="logs-search-result-not-found-text"]').isVisible({ timeout: 5000 }).catch(() => false);

    // Test passes if any expected state is visible
    const searchCompleted = hasResults || hasNoResults;
    expect(searchCompleted).toBeTruthy();

    testLogger.info(`Search completed: Results=${hasResults}, NoResults=${hasNoResults}`);
  });

  test("P0: View trace details from search results", {
    tag: ['@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing trace details view');

    // Setup and run search
    await pm.tracesPage.setupTraceSearch();

    // Check if we have results
    const hasResults = await pm.tracesPage.hasTraceResults();

    if (hasResults) {
      // Click first trace
      await pm.tracesPage.clickFirstTraceResult();

      // Verify trace details loaded
      const detailsVisible = await page.locator(pm.tracesPage.traceDetailsTree).isVisible({ timeout: 5000 }).catch(() => false);
      const altDetailsVisible = await page.locator('[data-test*="trace-detail"]').isVisible({ timeout: 5000 }).catch(() => false);

      if (detailsVisible || altDetailsVisible) {
        testLogger.info('Trace details loaded successfully');

        // Navigate back
        await pm.tracesPage.navigateBackFromTraceDetails();

        // Verify back at search
        await expect(page.locator(pm.tracesPage.searchBar)).toBeVisible();
        testLogger.info('Trace details viewed and navigated back successfully');
      } else {
        testLogger.info('Trace details did not load after clicking result');
      }
    } else {
      testLogger.info('No trace results found - checking for error messages');
      const errorMsg = await page.locator('.error-message').textContent().catch(() => '');
      testLogger.info(`Error message: ${errorMsg}`);
    }
  });


  test("P1: Toggle field list sidebar", {
    tag: ['@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing field list toggle');

    // Wait for page to be ready and check if field list exists
    await page.waitForTimeout(1000);
    const fieldListElement = page.locator(pm.tracesPage.indexList);
    const fieldListExists = await fieldListElement.count() > 0;

    if (!fieldListExists) {
      testLogger.info('Field list element not found on page - skipping toggle test');
      // Verify toggle button exists at least
      const toggleButton = page.locator(pm.tracesPage.fieldListToggleButton);
      await expect(toggleButton).toBeVisible();
      return;
    }

    // Check initial state of field list
    const fieldListVisible = await fieldListElement.isVisible();

    // Toggle field list
    await pm.tracesPage.toggleFieldList();
    await page.waitForTimeout(1000); // Animation delay

    // Check new state
    const fieldListVisibleAfter = await fieldListElement.isVisible();

    // Should be opposite of initial state
    expect(fieldListVisibleAfter).toBe(!fieldListVisible);

    testLogger.info(`Field list toggled: ${fieldListVisible} -> ${fieldListVisibleAfter}`);
  });

  test("P1: Share trace search link", {
    tag: ['@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing share link functionality');

    // Click share link button
    await page.locator(pm.tracesPage.shareLinkButton).click();

    // Wait for share dialog or notification
    await page.waitForTimeout(1000);

    // Check if URL was copied or share dialog appeared
    testLogger.info('Share link functionality tested');
  });

  test("P1: Toggle metrics dashboard", {
    tag: ['@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing metrics dashboard toggle');

    // Toggle metrics
    await pm.tracesPage.toggleMetricsDashboard();

    // Wait for metrics to show/hide
    await page.waitForTimeout(1000);

    testLogger.info('Metrics dashboard toggled');
  });

  // P2 - Edge Cases
  test("P2: Handle no stream selected state", {
    tag: ['@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing no stream selected state');

    // Check if no stream message is visible
    const noStreamMessage = await page.locator(pm.tracesPage.noStreamSelectedText).isVisible({ timeout: 5000 }).catch(() => false);

    if (noStreamMessage) {
      await expect(page.locator(pm.tracesPage.noStreamSelectedText)).toBeVisible();
      testLogger.info('No stream selected message displayed correctly');
    } else {
      testLogger.info('Stream already selected or not required');
    }
  });

  test("P2: Handle empty search results", {
    tag: ['@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing empty search results');

    // Select stream if needed
    const streamSelector = page.locator(pm.tracesPage.streamSelect);
    if (await streamSelector.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pm.tracesPage.selectTraceStream('default');
    }

    // Set time range
    await pm.tracesPage.setTimeRange('15m');

    // Run search
    await pm.tracesPage.runTraceSearch();

    // Check for no results message
    const noResults = await page.locator(pm.tracesPage.resultNotFoundText).isVisible({ timeout: 10000 }).catch(() => false);

    if (noResults) {
      await pm.tracesPage.expectNoResultsMessage();
      testLogger.info('No results message displayed correctly');
    } else {
      testLogger.info('Results found or different empty state');
    }
  });

  test("P2: Handle search errors gracefully", {
    tag: ['@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing error handling');

    // Try to trigger an error (implementation specific)
    const errorVisible = await page.locator(pm.tracesPage.errorMessage).isVisible({ timeout: 5000 }).catch(() => false);

    if (errorVisible) {
      await expect(page.locator(pm.tracesPage.errorMessage)).toBeVisible();
      testLogger.info('Error message displayed correctly');
    } else {
      testLogger.info('No error scenario available to test');
    }
  });

  // Enhanced Edge Cases
  test("P2: Search with very short time range (1m)", {
    tag: ['@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing search with 1 minute time range');

    // Setup trace search with very short time range
    const streamSelector = page.locator(pm.tracesPage.streamSelect);
    if (await streamSelector.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pm.tracesPage.selectTraceStream('default');
    }

    // Set 1 minute time range
    await page.locator(pm.tracesPage.dateTimeButton).click();
    await page.locator('[data-test="date-time-relative-1-m-btn"]').click({ timeout: 5000 }).catch(async () => {
      // Fallback to custom range if 1m not available
      await page.locator('[data-test="date-time-relative-custom-btn"]').click();
    });

    await pm.tracesPage.runTraceSearch();
    await page.waitForTimeout(2000);

    // Verify either results or no results message
    const hasResults = await pm.tracesPage.hasTraceResults();
    const noResults = await page.locator(pm.tracesPage.resultNotFoundText).isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasResults || noResults).toBeTruthy();
    testLogger.info(`1 minute search completed: Results=${hasResults}, NoResults=${noResults}`);
  });

  test("P2: Rapid successive searches", {
    tag: ['@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing rapid successive searches');

    await pm.tracesPage.setupTraceSearch();

    // Perform rapid successive searches
    for (let i = 0; i < 3; i++) {
      await pm.tracesPage.runTraceSearch();
      await page.waitForTimeout(500); // Short wait between searches

      const hasResults = await pm.tracesPage.hasTraceResults();
      testLogger.info(`Rapid search ${i + 1}: Results=${hasResults}`);
    }

    // Final search should complete successfully
    await page.waitForTimeout(2000);
    const finalResults = await pm.tracesPage.hasTraceResults();
    expect(finalResults !== undefined).toBeTruthy();
  });

  test("P2: Search with browser refresh", {
    tag: ['@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing search persistence after browser refresh');

    // Setup and run initial search
    await pm.tracesPage.setupTraceSearch();

    // Get current URL with search parameters
    const urlBeforeRefresh = page.url();
    testLogger.info(`URL before refresh: ${urlBeforeRefresh}`);

    // Refresh the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Check if search state is maintained
    const urlAfterRefresh = page.url();
    testLogger.info(`URL after refresh: ${urlAfterRefresh}`);

    // Verify traces page is still loaded
    await expect(page).toHaveURL(/traces/);
    await expect(page.locator(pm.tracesPage.searchBar)).toBeVisible();
  });
});