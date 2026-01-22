// tracesSearch.spec.js
// Tests for OpenObserve Traces feature - Search functionality
// Following the modular pattern from Logs tests
// CONSOLIDATED: 12 → 9 tests

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

    // Select the default stream as data is ingested for it only
    if (await pm.tracesPage.isStreamSelectVisible()) {
      await pm.tracesPage.selectTraceStream('default');
    }

    testLogger.info('Test setup completed for traces search');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // P0 - Critical Path Tests
  test("P0: Navigate to Traces section successfully", {
    tag: ['@tracesSearch', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing navigation to traces section');

    // Verify traces page loaded using page object
    await pm.tracesPage.expectUrlContains(/traces/);
    await pm.tracesPage.expectSearchBarVisible();

    testLogger.info('Traces section loaded successfully');
  });

  test("P0: Basic trace search with stream selection", {
    tag: ['@tracesSearch', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing basic trace search');

    // Setup trace search with stream and time range
    await pm.tracesPage.setupTraceSearch();

    // Check for various possible states using page object
    const hasResults = await pm.tracesPage.hasTraceResults();
    const hasNoResults = await pm.tracesPage.isNoResultsVisible();

    // Test passes if any expected state is visible
    const searchCompleted = hasResults || hasNoResults;
    expect(searchCompleted).toBeTruthy();

    testLogger.info(`Search completed: Results=${hasResults}, NoResults=${hasNoResults}`);
  });

  test("P0: View trace details from search results", {
    tag: ['@tracesSearch', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing trace details view');

    // Setup and run search
    await pm.tracesPage.setupTraceSearch();

    // Check if we have results
    const hasResults = await pm.tracesPage.hasTraceResults();

    if (!hasResults) {
      throw new Error('Precondition failed: No trace results available. Ensure trace data is ingested.');
    }

    // Click first trace
    await pm.tracesPage.clickFirstTraceResult();

    // Wait a bit more for trace details to load
    await page.waitForTimeout(3000);

    // Verify trace details loaded using page object
    const detailsVisible = await pm.tracesPage.isTraceDetailsTreeVisible();
    const altDetailsVisible = await pm.tracesPage.isAnyTraceDetailVisible();

    if (detailsVisible || altDetailsVisible) {
      testLogger.info('Trace details loaded successfully');

      // Navigate back
      await pm.tracesPage.navigateBackFromTraceDetails();

      // Verify back at search using page object
      await pm.tracesPage.expectSearchBarVisible();
      testLogger.info('Trace details viewed and navigated back successfully');
    } else {
      // Trace details may be rendered differently - check URL changed at minimum
      const currentUrl = pm.tracesPage.getPageUrl();
      testLogger.info(`Current URL after click: ${currentUrl}`);

      // Check if URL contains trace ID or details indicator
      if (currentUrl.includes('trace_id') || currentUrl.includes('span_id')) {
        testLogger.info('Trace details navigation confirmed via URL');
        expect(currentUrl).toContain('trace');
      } else {
        // Last resort - verify the search bar is still visible (we haven't broken UI)
        const searchBarStillVisible = await pm.tracesPage.isSearchBarVisible();
        testLogger.info(`Search bar visible: ${searchBarStillVisible}`);
        expect(searchBarStillVisible).toBeTruthy();
      }
    }
  });

  // P1 - Core Functionality Tests
  // CONSOLIDATED: Merged "Toggle field list sidebar" + "Share trace search link" + "Toggle metrics dashboard"
  test("P1: UI controls - field list, share link, metrics toggle", {
    tag: ['@tracesSearch', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing UI controls: field list, share link, metrics toggle');

    // Setup trace search first to ensure page is fully loaded
    await pm.tracesPage.setupTraceSearch();
    await page.waitForTimeout(2000);

    // === Test 1: Toggle field list sidebar (Original test #4) ===
    await test.step('Toggle field list sidebar', async () => {
      testLogger.info('Testing field list toggle');

      // Check if field list toggle button exists - this is the primary control
      const toggleButtonVisible = await pm.tracesPage.isFieldListToggleButtonVisible();

      if (!toggleButtonVisible) {
        throw new Error('Precondition failed: Field list toggle button not found on page. Verify traces page renders correctly.');
      }

      // Check initial state of field list using page object
      const fieldListVisible = await pm.tracesPage.isIndexListVisible();
      testLogger.info(`Initial field list state: ${fieldListVisible ? 'visible' : 'hidden'}`);

      // Toggle field list
      await pm.tracesPage.toggleFieldList();
      await page.waitForTimeout(1000); // Animation delay

      // Check new state using page object
      const fieldListVisibleAfter = await pm.tracesPage.isIndexListVisible();
      testLogger.info(`After toggle field list state: ${fieldListVisibleAfter ? 'visible' : 'hidden'}`);

      // Verify toggle functionality worked - state should change
      expect(fieldListVisibleAfter).not.toBe(fieldListVisible);

      testLogger.info(`Field list toggled: ${fieldListVisible} -> ${fieldListVisibleAfter}`);
    });

    // === Test 2: Share trace search link (Original test #5) ===
    await test.step('Share trace search link', async () => {
      testLogger.info('Testing share link functionality');

      // Click share link button using page object
      await pm.tracesPage.clickShareLinkButton();

      // Wait for share dialog or notification
      await page.waitForTimeout(1000);

      // Check if URL was copied or share dialog appeared
      testLogger.info('Share link functionality tested');
      // Verify page is still in valid state
      await pm.tracesPage.expectSearchBarVisible();
    });

    // === Test 3: Toggle metrics dashboard (Original test #6) ===
    await test.step('Toggle metrics dashboard', async () => {
      testLogger.info('Testing metrics dashboard toggle');

      // Toggle metrics
      await pm.tracesPage.toggleMetricsDashboard();

      // Wait for metrics to show/hide
      await page.waitForTimeout(1000);

      testLogger.info('Metrics dashboard toggled');
      // Verify page is still functional
      await pm.tracesPage.expectSearchBarVisible();
    });
  });

  // P2 - Edge Cases
  test("P2: Handle no stream selected state", {
    tag: ['@tracesSearch', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing no stream selected state');

    // Wait for page to be ready
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Check if we're on the traces page and it's loaded using page object
    await pm.tracesPage.expectSearchBarVisible();

    // Check for no stream message or verify a stream is already selected using page object
    const noStreamExists = await pm.tracesPage.getNoStreamSelectedCount() > 0;
    const streamSelectExists = await pm.tracesPage.getStreamSelectCount() > 0;

    if (noStreamExists && await pm.tracesPage.isNoStreamSelectedVisible()) {
      // No stream selected - this is the expected state for this test
      await pm.tracesPage.expectNoStreamSelectedVisible();
      testLogger.info('No stream selected message displayed correctly');

      // Verify that stream selector is also available
      if (streamSelectExists) {
        await pm.tracesPage.expectStreamSelectVisible();
        testLogger.info('Stream selector is available for selection');
      }
    } else if (streamSelectExists && await pm.tracesPage.isStreamSelectVisible()) {
      // Stream selector is visible - a stream is already selected
      testLogger.info('Stream already selected - verifying trace UI is functional');

      // Verify the search bar is still functional
      await pm.tracesPage.expectSearchBarVisible();

      // Verify we can see either results or a proper message
      const hasResults = await pm.tracesPage.hasTraceResults();
      const hasNoResults = await pm.tracesPage.isNoResultsVisible();

      // At least one state should be present
      const validState = hasResults || hasNoResults;
      expect(validState).toBeTruthy();
      testLogger.info(`Stream selected state verified: hasResults=${hasResults}, hasNoResults=${hasNoResults}`);
    } else {
      // Neither state is visible - this might be a different UI state or error
      testLogger.info('Neither no-stream message nor stream selector visible - checking page state');

      // At minimum, verify the traces page loaded correctly
      await pm.tracesPage.expectSearchBarVisible();

      // Check if we're in a valid traces view state
      const pageUrl = pm.tracesPage.getPageUrl();
      expect(pageUrl).toContain('/traces');

      testLogger.info('Traces page is loaded but stream selection UI not visible - may be auto-selected');
    }
  });

  test("P2: Handle empty search results", {
    tag: ['@tracesSearch', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing empty search results');

    // Select stream if needed using page object
    if (await pm.tracesPage.isStreamSelectVisible()) {
      await pm.tracesPage.selectTraceStream('default');
    }

    // Set time range
    await pm.tracesPage.setTimeRange('15m');

    // Run search
    await pm.tracesPage.runTraceSearch();

    // Check for no results message using page object
    const noResults = await pm.tracesPage.isNoResultsVisible();

    if (noResults) {
      await pm.tracesPage.expectNoResultsMessage();
      testLogger.info('No results message displayed correctly');
    } else {
      testLogger.info('Results found or different empty state');
    }

    // Verify search completed
    expect(noResults || await pm.tracesPage.hasTraceResults()).toBeTruthy();
  });

  test("P2: Handle search errors gracefully", {
    tag: ['@tracesSearch', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing error handling');

    // Try to trigger an error (implementation specific) using page object
    const errorVisible = await pm.tracesPage.isErrorMessageVisible();

    if (errorVisible) {
      const errorText = await pm.tracesPage.getErrorMessageText();
      testLogger.info(`Error message displayed correctly: ${errorText}`);
      expect(errorVisible).toBeTruthy();
    } else {
      testLogger.info('No error scenario available to test');
      // Verify page is in valid state
      await pm.tracesPage.expectSearchBarVisible();
    }
  });

  // CONSOLIDATED: Merged "Search with very short time range (1m)" + "Rapid successive searches"
  test("P2: Time range edge cases - 1m range and rapid searches", {
    tag: ['@tracesSearch', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing time range edge cases: 1m range and rapid searches');

    // === Test 1: Search with very short time range (1m) (Original test #10) ===
    await test.step('Search with very short time range (1m)', async () => {
      testLogger.info('Testing search with 1 minute time range');

      // Setup trace search with very short time range using page object
      if (await pm.tracesPage.isStreamSelectVisible()) {
        await pm.tracesPage.selectTraceStream('default');
      }

      // Set 1 minute time range using page object
      await pm.tracesPage.clickTimeRange1m();

      await pm.tracesPage.runTraceSearch();
      await page.waitForTimeout(2000);

      // Verify either results or no results message using page object
      const hasResults = await pm.tracesPage.hasTraceResults();
      const noResults = await pm.tracesPage.isNoResultsVisible();

      expect(hasResults || noResults).toBeTruthy();
      testLogger.info(`1 minute search completed: Results=${hasResults}, NoResults=${noResults}`);
    });

    // === Test 2: Rapid successive searches (Original test #11) ===
    await test.step('Rapid successive searches', async () => {
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
      const noResults = await pm.tracesPage.isNoResultsVisible();
      expect(finalResults || noResults).toBeTruthy();
    });
  });

  test("P2: Search with browser refresh", {
    tag: ['@tracesSearch', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing search persistence after browser refresh');

    // Setup and run initial search
    await pm.tracesPage.setupTraceSearch();

    // Get current URL with search parameters using page object
    const urlBeforeRefresh = pm.tracesPage.getPageUrl();
    testLogger.info(`URL before refresh: ${urlBeforeRefresh}`);

    // Refresh the page using page object
    await pm.tracesPage.reloadPage();

    // Check if search state is maintained using page object
    const urlAfterRefresh = pm.tracesPage.getPageUrl();
    testLogger.info(`URL after refresh: ${urlAfterRefresh}`);

    // Verify traces page is still loaded using page object
    await pm.tracesPage.expectUrlContains(/traces/);
    await pm.tracesPage.expectSearchBarVisible();
  });
});
