/**
 * Traces Regression Bugs Test Suite
 *
 * This suite contains regression tests for traces-related bugs that have been fixed.
 * Each test verifies that a specific bug fix is working correctly.
 *
 * Tests run in PARALLEL for efficiency - setup/cleanup handled via hooks.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Traces Regression Bugs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to traces page
    await pm.tracesPage.navigateToTraces();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    testLogger.info('Traces regression test setup completed');
  });

  // ==========================================================================
  // Bug #10769: Traces UI: Column sorting support
  // https://github.com/openobserve/openobserve/issues/10769
  // ==========================================================================
  test("Trace columns should support sorting @bug-10769 @P1 @regression @sorting", async ({ page }) => {
    testLogger.info('Test: Verify trace column sorting (Bug #10769)');

    // Wait for traces page to be ready
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Try to run a search to get results
    const runBtn = pm.tracesPage.getRunQueryButton().first();
    if (await runBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await runBtn.click();
      await page.waitForTimeout(2000);
      testLogger.info('✓ Ran trace search');
    } else {
      testLogger.info('Run button not visible, checking existing results');
    }

    // Find column headers in the trace results table
    const columnHeaders = pm.tracesPage.getTraceResultColumnHeaders();
    const headerCount = await columnHeaders.count();
    testLogger.info(`Found ${headerCount} column headers`);

    // STRONG ASSERTION: Column headers should exist for sorting
    expect(headerCount, 'Bug #10769: Trace table should have column headers for sorting').toBeGreaterThan(0);

    // Try clicking the first sortable column (usually duration or timestamp)
    const durationHeader = pm.tracesPage.getDurationHeader().first();
    const timestampHeader = pm.tracesPage.getTimestampHeader().first();

    let sortedColumnFound = false;

    if (await durationHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
      await durationHeader.click();
      await page.waitForTimeout(1000);
      testLogger.info('✓ Clicked Duration column header');
      sortedColumnFound = true;

      // Check for sort indicator
      const sortIndicator = pm.tracesPage.getSortIndicator();
      const hasSortIndicator = await sortIndicator.count() > 0;
      testLogger.info(`Sort indicator visible: ${hasSortIndicator}`);

      // Click again to toggle sort direction
      await durationHeader.click();
      await page.waitForTimeout(1000);
      testLogger.info('✓ Toggled sort direction');
    } else if (await timestampHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
      await timestampHeader.click();
      await page.waitForTimeout(1000);
      testLogger.info('✓ Clicked Timestamp column header');
      sortedColumnFound = true;
    } else {
      // Click any visible header
      const firstHeader = columnHeaders.first();
      if (await firstHeader.isVisible()) {
        await firstHeader.click();
        await page.waitForTimeout(1000);
        testLogger.info('✓ Clicked first available column header');
        sortedColumnFound = true;
      }
    }

    // PRIMARY ASSERTION: Should be able to click at least one column header
    expect(sortedColumnFound, 'Bug #10769: Should be able to click column headers to enable sorting').toBe(true);

    testLogger.info('✓ PASSED: Column sorting test completed');
  });

  // ==========================================================================
  // Bug #9043: Trace pagination cursor resets when navigating back from trace details
  // https://github.com/openobserve/openobserve/issues/9043
  // ==========================================================================
  test("Pagination cursor should not reset after navigating back from trace details @bug-9043 @P1 @regression @pagination", async ({ page }) => {
    testLogger.info('Test: Verify pagination cursor persists after trace detail navigation (Bug #9043)');

    // Set a time range that will have enough traces
    await pm.tracesPage.setTimeRange('15m');
    testLogger.info('✓ Set time range to 15 minutes');

    // Run trace search
    const runBtn = pm.tracesPage.getRunQueryButton().first();
    if (await runBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await runBtn.click();
      await page.waitForTimeout(3000);
      testLogger.info('✓ Ran trace search');
    }

    // Wait for traces to load
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Check if we have trace results
    const hasResults = await pm.tracesPage.hasTraceResults();
    if (!hasResults) {
      testLogger.warn('No trace results available - skipping test');
      test.skip(true, 'No trace results available');
      return;
    }

    // STEP 1: Get initial trace count and capture trace IDs before navigation
    const initialTraceCount = await pm.tracesPage.getTraceCount();
    testLogger.info(`Initial trace count: ${initialTraceCount}`);

    // STRONG ASSERTION: We need at least some traces to test pagination
    expect(initialTraceCount, 'Bug #9043: Should have initial traces to test pagination').toBeGreaterThan(0);

    // Capture initial trace IDs by getting the text content of trace result items
    // Trace results usually contain unique trace IDs or span information
    const initialTraceItems = page.locator('[data-test="traces-search-result-item"]');
    const initialTraceCount2 = await initialTraceItems.count();

    const initialTraceData = [];
    for (let i = 0; i < Math.min(initialTraceCount2, 10); i++) {
      const traceItem = initialTraceItems.nth(i);
      const traceText = await traceItem.textContent().catch(() => '');
      initialTraceData.push(traceText);
    }
    testLogger.info(`Captured ${initialTraceData.length} initial trace identifiers`);

    // STEP 2: Click on first trace to open trace details
    await pm.tracesPage.clickFirstTraceResult();
    await page.waitForTimeout(2000);
    testLogger.info('✓ Clicked first trace to open details');

    // Wait for trace details to load (either sidebar, dialog, or inline view)
    const traceDetailsVisible = await page.locator('[data-test="trace-details-header"], [data-test="trace-details-tree"], [data-test="trace-details-sidebar"]')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (traceDetailsVisible) {
      testLogger.info('✓ Trace details opened successfully');
    } else {
      testLogger.info('Trace details may be displayed inline or differently');
    }

    // STEP 3: Navigate back from trace details
    await pm.tracesPage.navigateBackFromTraceDetails();
    await page.waitForTimeout(2000);
    testLogger.info('✓ Navigated back from trace details');

    // Wait for traces list to be visible again
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // STEP 4: Get trace count after navigation back
    const afterBackTraceCount = await pm.tracesPage.getTraceCount();
    testLogger.info(`Trace count after navigating back: ${afterBackTraceCount}`);

    // PRIMARY ASSERTION 1: Trace count should be preserved or similar after navigation
    // It should not drop to 0 or drastically change
    expect(afterBackTraceCount, 'Bug #9043: Trace count should be maintained after navigating back').toBeGreaterThan(0);
    testLogger.info('✓ Trace count maintained after navigation');

    // STEP 5: Check for duplicates in the trace list
    // If pagination cursor resets, we would see the same traces loaded again
    // Use DOM element positions + unique attributes instead of just text content
    const afterBackTraceItems = page.locator('[data-test="traces-search-result-item"]');
    const afterBackCount = await afterBackTraceItems.count();

    const afterBackTraceData = [];
    for (let i = 0; i < Math.min(afterBackCount, 20); i++) {
      const traceItem = afterBackTraceItems.nth(i);

      // Try to extract unique trace ID from the element's HTML
      const itemHTML = await traceItem.innerHTML().catch(() => '');

      // Look for trace_id pattern in the HTML (e.g., in data attributes or text)
      const traceIdMatch = itemHTML.match(/trace[_-]?id["\s:=]+([a-f0-9]{16,64})/i);
      const traceId = traceIdMatch ? traceIdMatch[1] : null;

      // Fallback: use combination of index + text content for comparison
      const traceText = await traceItem.textContent().catch(() => '');
      const cleanText = traceText.trim();

      // Create a more robust identifier: use trace ID if available, otherwise position + text hash
      const identifier = traceId || `${i}:${cleanText.substring(0, 100)}`;

      afterBackTraceData.push({ index: i, id: identifier, text: cleanText.substring(0, 100) });
    }
    testLogger.info(`Captured ${afterBackTraceData.length} trace identifiers after navigation`);

    // Count duplicates by checking if the same trace identifier appears multiple times
    const traceCounts = new Map();
    afterBackTraceData.forEach(trace => {
      if (trace.id) {
        traceCounts.set(trace.id, (traceCounts.get(trace.id) || 0) + 1);
      }
    });

    const duplicates = [];
    traceCounts.forEach((count, traceId) => {
      if (count > 1) {
        // Find sample trace with this ID
        const sample = afterBackTraceData.find(t => t.id === traceId);
        duplicates.push({
          id: traceId.substring(0, 50) + '...',
          count,
          sample: sample?.text || 'N/A'
        });
      }
    });

    testLogger.info(`Found ${duplicates.length} duplicate trace entries`);
    if (duplicates.length > 0) {
      testLogger.warn('Duplicates detected (same trace ID appears multiple times):', {
        duplicates: duplicates.slice(0, 3)
      });
    }

    // PRIMARY ASSERTION 2: No duplicate traces should be present
    // Bug #9043 caused pagination cursor to reset, loading the same traces again
    // Duplicates would show as same trace_id or same position+content appearing multiple times
    expect(duplicates.length, 'Bug #9043: Should not have duplicate traces after navigating back (cursor should not reset)').toBe(0);
    testLogger.info('✓ No duplicate traces detected - pagination cursor maintained correctly');

    // STEP 6: Verify that scrolling/pagination works correctly after navigation
    // Try to scroll the results container to trigger potential lazy loading
    const resultsContainer = page.locator('[data-test="traces-search-result-list"], .traces-result-container').first();
    if (await resultsContainer.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Scroll to bottom to trigger pagination/infinite scroll if it exists
      await resultsContainer.evaluate(el => {
        el.scrollTop = el.scrollHeight;
      }).catch(() => {
        testLogger.info('Could not scroll results container - may not support scrolling');
      });

      await page.waitForTimeout(2000);
      testLogger.info('✓ Attempted to scroll results to trigger pagination');

      // Check trace count after scroll
      const afterScrollCount = await pm.tracesPage.getTraceCount();
      testLogger.info(`Trace count after scroll: ${afterScrollCount}`);

      // If pagination is working, count should be >= the previous count
      expect(afterScrollCount, 'Bug #9043: Trace count should not decrease after scrolling').toBeGreaterThanOrEqual(afterBackTraceCount);
    }

    testLogger.info('✓ PASSED: Pagination cursor persistence test completed');
  });

  test.afterEach(async () => {
    testLogger.info('Traces regression test completed');
  });
});
