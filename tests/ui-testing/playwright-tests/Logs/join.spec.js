const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { ingestCustomData, waitForStreamData } = require('../utils/data-ingestion.js');
const { FilterBuilderDriver } = require('../../pages/generalPages/filterBuilderPage.js');

// Utility Functions

// Legacy login function replaced by global authentication via navigateToBase

test.describe("Join for logs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Strategic 500ms wait for post-authentication stabilization - this is functionally necessary
    await page.waitForLoadState('domcontentloaded');

    // Data ingestion for join testing (preserve exact logic)
    await pm.ingestionPage.ingestion();
    await pm.ingestionPage.ingestionJoin();

    testLogger.info('Join test setup completed');
  });

  test("Run query after selecting two streams", { tag: ['@join', '@smoke', '@P0'] }, async ({ page }) => {
    testLogger.info('Testing run query with two streams selection');

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.displayTwoStreams();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();

    testLogger.info('Two streams query execution completed');
  });

  test("Run query after selecting two streams and SQL Mode On", { tag: ['@join', '@sqlMode', '@functional', '@P1'] }, async ({ page }) => {
    testLogger.info('Testing two streams query with SQL Mode enabled');

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.displayTwoStreams();
    await pm.logsPage.validateResult();

    testLogger.info('Two streams SQL Mode query completed');
  });

  test("Run query after selecting two streams, selecting field and SQL Mode On", { tag: ['@join', '@union', '@functional', '@P1'], timeout: 300000 }, async ({ page }) => {
    testLogger.info('Testing two streams with field selection and SQL Mode');

    // Generate unique testRunId to avoid "stream being deleted" conflicts (SDR pattern)
    const testRunId = Date.now().toString(36);
    testLogger.info(`Using testRunId: ${testRunId}`);

    // Use dedicated UNION test ingestion and streams to ensure schema compatibility
    // Returns unique stream names that we pass to the selection method
    const { streamA, streamB } = await pm.ingestionPage.ingestionJoinUnion(testRunId);
    testLogger.info(`Created streams: ${streamA}, ${streamB}`);

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoinUnion(streamA, streamB);
    await pm.logsPage.kubernetesContainerName();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();

    testLogger.info('Field selection with SQL Mode query validated successfully');
  });

  test("Run query after selecting two streams, SQL Mode On and entering join queries", { tag: ['@join', '@innerJoin', '@functional', '@P1'] }, async ({ page }) => {
    testLogger.info('Testing join queries with SQL Mode enabled');

    // Use unique streams to avoid schema-mismatch / stale-index failures on shared
    // default + e2e_automate streams when multiple tests run in parallel.
    const testRunId = Date.now().toString(36);
    const { streamA, streamB } = await pm.ingestionPage.ingestionJoinUnion(testRunId);
    testLogger.info(`Created streams: ${streamA}, ${streamB}`);

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoinUnion(streamA, streamB);
    await pm.logsPage.kubernetesContainerNameJoin(streamA, streamB);
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();

    testLogger.info('Join queries execution and validation completed');
  });

  test("Run query after selecting two streams, SQL Mode On and entering join limit", { tag: ['@join', '@limit', '@functional', '@P1'] }, async ({ page }) => {
    testLogger.info('Testing join queries with limit clause');

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerNameJoinLimit();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();

    testLogger.info('Join limit query validation completed');
  });

  test("Run query after selecting two streams, SQL Mode On and entering join like", { tag: ['@join', '@like', '@functional', '@P1'] }, async ({ page }) => {
    testLogger.info('Testing join queries with LIKE clause');

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerNameJoinLike();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();

    testLogger.info('Join LIKE query execution completed');
  });

  test("Run query after selecting two streams, SQL Mode On and entering Left join queries", { tag: ['@join', '@leftJoin', '@functional', '@P1'] }, async ({ page }) => {
    testLogger.info('Testing LEFT JOIN queries');

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerNameLeftJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();

    testLogger.info('LEFT JOIN query validation completed');
  });

  test("Run query after selecting two streams, SQL Mode On and entering Right join queries", { tag: ['@join', '@rightJoin', '@functional', '@P1'] }, async ({ page }) => {
    testLogger.info('Testing RIGHT JOIN queries');

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerNameRightJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();

    testLogger.info('RIGHT JOIN query validation completed');
  });

  test("Run query after selecting two streams, SQL Mode On and entering Full join queries", { tag: ['@join', '@fullJoin', '@functional', '@P1'] }, async ({ page }) => {
    testLogger.info('Testing FULL JOIN queries');

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerNameFullJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();

    testLogger.info('FULL JOIN query validation completed');
  });

  test("Add/remove interesting field in editor and results", { tag: ['@join', '@interestingFields', '@functional', '@P1'] }, async ({ page }) => {
    testLogger.info('Testing add/remove interesting field functionality');

    // Use unique streams to avoid contention with other join tests
    const testRunId = Date.now().toString(36);
    const { streamA, streamB } = await pm.ingestionPage.ingestionJoinUnion(testRunId);
    testLogger.info(`Created streams: ${streamA}, ${streamB}`);

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoinUnion(streamA, streamB);
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.ensureQuickModeState(true);
    await pm.logsPage.clickAllFieldsButton();
    await pm.logsPage.selectRunQuery();

    // Step 1: Add field via interesting field star icon
    await pm.logsPage.clickInterestingFields();
    await pm.logsPage.expectQueryEditorContainsText('kubernetes_pod_name');
    testLogger.info('Verified kubernetes_pod_name was added to query');

    // Step 2: Remove field by clicking star again
    await pm.logsPage.addRemoveInteresting();
    await pm.logsPage.expectQueryEditorNotContainsText('kubernetes_pod_name');
    testLogger.info('Verified kubernetes_pod_name was removed from query');

    testLogger.info('Add/remove interesting field functionality completed');
  });

});

// Stream A types `code` Int64 and has `k`; stream B types `code` Utf8 and has no `k`.
test.describe("Two streams whose fields differ", () => {
  test.describe.configure({ mode: 'serial' });
  const runId = Date.now().toString(36);
  // The field list types a shared field from the later stream in the list, so the Int64 stream's name sorts second.
  const streamA = `e2e_mm_b_int_${runId}`;
  const streamB = `e2e_mm_a_txt_${runId}`;
  const rowsA = [
    ...Array.from({ length: 3 }, (_, i) => ({ code: 500, k: 'x', seq: i })),
    ...Array.from({ length: 2 }, (_, i) => ({ code: 200, k: 'y', seq: i })),
  ];
  const rowsB = [
    ...Array.from({ length: 4 }, (_, i) => ({ code: '500', seq: i })),
    { code: '200', seq: 9 },
  ];
  const CODE_500_TOTAL = 3 + 4;
  const K_X_TOTAL = 3;
  let pm;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      expect((await ingestCustomData(page, streamA, rowsA)).status, `Precondition: ${streamA} ingests`).toBe(200);
      expect((await ingestCustomData(page, streamB, rowsB)).status, `Precondition: ${streamB} ingests`).toBe(200);
      expect(await waitForStreamData(page, streamA, rowsA.length, 60000)).toBe(true);
      expect(await waitForStreamData(page, streamB, rowsB.length, 60000)).toBe(true);
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const streams = new PageManager(page).streamsPage;
      await streams.deleteStreamViaAPI(streamA);
      await streams.deleteStreamViaAPI(streamB);
    } catch (e) {
      testLogger.warn(`Cleanup failed: ${e.message}`);
    } finally {
      await page.close();
    }
  });

  test.describe("with the filter builder", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        try { localStorage.setItem('o2.logs.queryInput', 'builder'); } catch (_) {}
      });
      await navigateToBase(page);
      pm = new PageManager(page);
    });

    for (const order of [[streamA, streamB], [streamB, streamA]]) {
      test(`builder code = 500 returns both streams' rows (${order[0] === streamA ? 'Int64 first' : 'Utf8 first'})`, {
        tag: ['@join', '@filterBuilder', '@bug-16941', '@P2'],
      }, async ({ page }) => {
        await pm.logsPage.selectIndexAndStreamJoinUnion(order[0], order[1]);
        await pm.logsPage.disableSqlModeIfNeeded();
        const builder = new FilterBuilderDriver(page, 'logs-search-bar-filter-builder-bar');
        await expect(builder.barInput).toBeVisible({ timeout: 15000 });
        await builder.addCondition('code', '=', '500');

        const query = await pm.logsPage.getQueryEditorText();
        testLogger.info(`Builder wrote: ${query}`);
        expect(query).toBe("code = '500'");

        await pm.logsPage.runQueryAndWaitForResults();
        expect(await pm.logsPage.getResultHitsCount()).toBe(CODE_500_TOTAL);
      });
    }
  });

  test("a filter on a field only one stream has returns the same rows in SQL mode", {
    tag: ['@join', '@sqlMode', '@bug-16941', '@P2'],
  }, async ({ page }) => {
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.logsPage.selectIndexAndStreamJoinUnion(streamA, streamB);
    await pm.logsPage.disableSqlModeIfNeeded();
    await pm.logsPage.clearAndFillQueryEditor("k = 'x'");
    await pm.logsPage.runQueryAndWaitForResults();
    expect(await pm.logsPage.getResultHitsCount(), 'normal mode skips the stream without k').toBe(K_X_TOTAL);

    await pm.logsPage.enableSqlModeIfNeeded();
    await expect.poll(async () => (await pm.logsPage.getQueryEditorText()) || '', { timeout: 10000 })
      .toMatch(/^SELECT /i);
    const sql = await pm.logsPage.getQueryEditorText();
    testLogger.info(`SQL mode query: ${sql}`);

    await pm.logsPage.runQueryAndWaitForResults();
    expect(await pm.logsPage.getResultHitsCount()).toBe(K_X_TOTAL);
  });
});
