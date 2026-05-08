const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

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
    await page.waitForTimeout(500);

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

    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerNameJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.displayCountQuery();
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

