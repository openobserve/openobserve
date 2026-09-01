const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Multi-Stream Log Search (UNION ALL BY NAME) testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Wait for post-authentication stabilization
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    testLogger.info('Multi-stream search test setup completed');
  });

  test("should return merged results with stream attribution for two non-SQL streams", { tag: ['@multi-stream-search', '@all', '@logs', '@P0'] }, async ({ page }) => {
    testLogger.info('Testing multi-stream non-SQL UNION ALL BY NAME with stream attribution');

    // Generate unique testRunId to avoid "stream being deleted" conflicts (SDR pattern)
    const testRunId = Date.now().toString(36);
    testLogger.info(`Using testRunId: ${testRunId}`);

    // Create two same-schema streams and select both (SQL mode OFF by default)
    const { streamA, streamB } = await pm.ingestionPage.ingestionJoinUnion(testRunId);
    testLogger.info(`Created streams: ${streamA}, ${streamB}`);

    await pm.logsPage.selectIndexAndStreamJoinUnion(streamA, streamB);
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.validateResult();

    // Verify rows are attributed to both source streams via the source-cell JSON
    const streamNames = await pm.logsPage.getSourceColumnStreamNames();
    expect(streamNames.sort()).toEqual([streamA, streamB].sort());

    // Verify _stream_name is NOT rendered as a dedicated grid column
    await pm.logsPage.expectNoStreamNameColumn();

    testLogger.info('Multi-stream non-SQL UNION ALL BY NAME attribution verified');
  });

  test("should suppress the histogram for a multi-stream search", { tag: ['@multi-stream-search', '@all', '@logs', '@P0'] }, async ({ page }) => {
    testLogger.info('Testing histogram suppression for multi-stream search');

    const testRunId = Date.now().toString(36);
    testLogger.info(`Using testRunId: ${testRunId}`);

    const { streamA, streamB } = await pm.ingestionPage.ingestionJoinUnion(testRunId);
    await pm.logsPage.selectIndexAndStreamJoinUnion(streamA, streamB);

    // Ensure the histogram toggle is ON so any suppression is caused by the multi-stream path
    await pm.logsPage.ensureHistogramState(true);

    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.validateResult();

    // Histogram canvas must be absent while the results table stays visible
    await pm.logsPage.expectHistogramHidden();

    testLogger.info('Histogram suppression for multi-stream search verified');
  });

  test("should block the Visualize toggle for a non-SQL multi-stream search", { tag: ['@multi-stream-search', '@all', '@logs', '@P1'] }, async ({ page }) => {
    testLogger.info('Testing Visualize block for non-SQL multi-stream search');

    const testRunId = Date.now().toString(36);
    testLogger.info(`Using testRunId: ${testRunId}`);

    const { streamA, streamB } = await pm.ingestionPage.ingestionJoinUnion(testRunId);
    await pm.logsPage.selectIndexAndStreamJoinUnion(streamA, streamB);

    await pm.logsPage.clickVisualizeToggle();
    await pm.logsPage.expectVisualizeBlockedNotification();

    testLogger.info('Visualize block notification verified');
  });

  test("should still return results for a multi-stream search in SQL mode", { tag: ['@multi-stream-search', '@all', '@logs', '@P1'] }, async ({ page }) => {
    testLogger.info('Testing multi-stream search in SQL mode');

    const testRunId = Date.now().toString(36);
    testLogger.info(`Using testRunId: ${testRunId}`);

    const { streamA, streamB } = await pm.ingestionPage.ingestionJoinUnion(testRunId);
    await pm.logsPage.selectIndexAndStreamJoinUnion(streamA, streamB);

    // Enable SQL mode and confirm the toggle actually switched ON before running
    await pm.logsPage.enableSqlModeIfNeeded();

    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.validateResult();

    testLogger.info('Multi-stream SQL mode results verified');
  });
});
