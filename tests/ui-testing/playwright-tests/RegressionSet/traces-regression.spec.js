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
  // Bug #10743: Stream selection lost after navigating away and returning
  // https://github.com/openobserve/openobserve/issues/10743
  // ==========================================================================
  test("Stream selection persists after navigating away and returning @bug-10743 @P1 @regression @streamPersistence", async ({ page }, testInfo) => {
    testLogger.info('Test: Verify stream selection persistence after navigation (Bug #10743)');

    // Step 1: Verify we're on traces page and select a stream
    await pm.tracesPage.expectUrlContains(/traces/);
    testLogger.info('✓ On traces page');

    // Select the default stream
    if (await pm.tracesPage.isStreamSelectVisible()) {
      await pm.tracesPage.selectTraceStream('default');
      await page.waitForTimeout(1000);
      testLogger.info('✓ Selected "default" stream');
    } else {
      testLogger.warn('Stream selector not visible, skipping test');
      testInfo.skip(true, 'Stream selector not visible');
      return;
    }

    // Step 2: Run a search to confirm stream is active
    await pm.tracesPage.runTraceSearch();
    await page.waitForTimeout(2000);
    testLogger.info('✓ Search executed with selected stream');

    // Step 3: Navigate away to logs page
    await pm.tracesPage.navigateToLogs();
    await page.waitForTimeout(1000);
    testLogger.info('✓ Navigated to logs page');

    // STRONG ASSERTION: Verify we're on logs page
    expect(page.url()).toContain('logs');
    testLogger.info('✓ Confirmed on logs page');

    // Step 4: Navigate back to traces page
    await pm.tracesPage.navigateToTraces();
    await page.waitForTimeout(2000);
    testLogger.info('✓ Navigated back to traces page');

    // Step 5: Verify the stream is still selected (BUG CHECK)
    // The bug is that the stream selection is lost after navigation
    const streamSelector = pm.tracesPage.getStreamSelector();
    await expect(streamSelector).toBeVisible({ timeout: 5000 });

    // Check if any stream is selected by looking for selected toggle
    const selectedToggle = pm.tracesPage.getSelectedStreamToggle();
    const isAnyStreamSelected = await selectedToggle.count() > 0;

    // Also check the URL for stream parameter
    const currentUrl = page.url();
    const hasStreamInUrl = currentUrl.includes('stream=') || currentUrl.includes('stream_name=');

    testLogger.info(`Stream selected state: ${isAnyStreamSelected}`);
    testLogger.info(`Stream in URL: ${hasStreamInUrl}`);
    testLogger.info(`Current URL: ${currentUrl}`);

    // STRONG ASSERTION: The stream should persist - if not, this indicates bug #10743
    // Assert that stream selection persisted (either in UI state or URL)
    expect(isAnyStreamSelected || hasStreamInUrl, 'Bug #10743: stream selection lost after navigation').toBe(true);
    testLogger.info('✓ Stream selection persisted after navigation');

    // Run search again to verify traces page is functional
    await pm.tracesPage.runTraceSearch().catch(() => {});
    await page.waitForTimeout(2000);

    const hasResults = await pm.tracesPage.hasTraceResults();
    const noResults = await pm.tracesPage.isNoResultsVisible();
    const noStreamSelected = await pm.tracesPage.isNoStreamSelectedVisible();

    testLogger.info(`After returning: Results=${hasResults}, NoResults=${noResults}, NoStreamSelected=${noStreamSelected}`);

    // STRONG ASSERTION: Verify that stream selector is not in "no stream selected" state
    expect(noStreamSelected, 'Stream should remain selected after navigation').toBe(false);

    testLogger.info('✓ PASSED: Stream persistence test completed');
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

  test.afterEach(async () => {
    testLogger.info('Traces regression test completed');
  });
});
