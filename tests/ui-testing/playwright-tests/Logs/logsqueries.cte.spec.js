const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const cteQueriesData = require("../../../test-data/cte_queries.json");
const { ingestCustomData } = require('../utils/data-ingestion.js');

// Legacy login function replaced by global authentication via navigateToBase

async function ingestion(page) {
  await ingestCustomData(page, "e2e_cte", cteQueriesData);
}

test.describe("CTE Logs Queries testcases", () => {
  let pageManager;

  async function applyQueryButton(pm) {
    // Deterministic Run-query helper — waits for the refresh button to exit any
    // in-flight Cancel state from a prior auto-search, fires the click, then waits
    // for the button to settle. Replaces the legacy 1s buffer + waitForResponse
    // pattern that races the auto-search response listener.
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.runQueryAndWaitForResults();
    // After the button settles, give the virtual-list renderer one pass to
    // materialise row 0.  waitForTableHits returns quickly when rows are present
    // and gives up silently after 5 s so the individual-test assertion still
    // owns the final failure message.
    await pm.logsPage.waitForTableHits(5000).catch(() => {});
  }

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pageManager = new PageManager(page);

    await ingestion(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    // Deterministic post-navigation settle — replaces legacy 1s buffer.
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pageManager.logsPage.selectStream("e2e_cte");
    // CTE queries use SQL syntax — enable SQL mode before the initial query run.
    await pageManager.logsPage.enableSqlModeIfDisabled();
    await applyQueryButton(pageManager);

    // Data-readiness gate: OpenObserve's WAL flush can delay indexing by a few
    // seconds.  If the initial SELECT * returns 0 rows (table still empty after
    // the 5 s window inside applyQueryButton), run the query once more so that
    // any in-progress flush has time to complete before the CTE test runs.
    const hasInitialData = await pageManager.logsPage.waitForTableHits(3000);
    if (!hasInitialData) {
      testLogger.warn('CTE beforeEach: No rows after initial query — retrying to allow data indexing');
      await applyQueryButton(pageManager);
    }

    testLogger.info('CTE test setup completed');
  });

  test("should query with simple TotalCols CTE", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing simple TotalCols CTE query');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    // setQueryEditorValue replaces any existing query via Monaco API (avoids appending to default query).
    await pageManager.logsPage.setQueryEditorValue('WITH TotalCols AS ( SELECT * FROM "e2e_cte" ) SELECT message FROM TotalCols');
    // Deterministic wait — confirms Monaco model reflects the new query before Run.
    await pageManager.logsPage.waitForQueryEditorValue('TotalCols');
    await applyQueryButton(pageManager);
    await pageManager.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('TotalCols CTE query completed successfully');
  });

  test("should query with Cleaned CTE for container names", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing Cleaned CTE for container names');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.setQueryEditorValue('WITH Cleaned AS (SELECT message, kubernetes_container_name AS container, kubernetes_pod_name FROM "e2e_cte" WHERE kubernetes_container_name IS NOT NULL) SELECT container, kubernetes_pod_name, message FROM Cleaned');
    // Deterministic wait — confirms Monaco model reflects the new query before Run.
    await pageManager.logsPage.waitForQueryEditorValue('Cleaned');
    await applyQueryButton(pageManager);
    await pageManager.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Cleaned CTE query completed successfully');
  });

  test("should query with FilteredLogs CTE for org messages", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing FilteredLogs CTE for org messages');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.setQueryEditorValue('WITH FilteredLogs AS (SELECT * FROM "e2e_cte" WHERE message LIKE \'%org%\') SELECT message, kubernetes_pod_name FROM FilteredLogs');
    // Deterministic wait — confirms Monaco model reflects the new query before Run.
    await pageManager.logsPage.waitForQueryEditorValue('FilteredLogs');
    await applyQueryButton(pageManager);
    await pageManager.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('FilteredLogs CTE query completed successfully');
  });

  test("should query with Counts CTE for pod log counts", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing Counts CTE for pod log counts');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.setQueryEditorValue('WITH Counts AS (SELECT kubernetes_pod_name, COUNT(*) AS log_count FROM "e2e_cte" GROUP BY kubernetes_pod_name) SELECT * FROM Counts WHERE log_count > 1');
    // Deterministic wait — confirms Monaco model reflects the new query before Run.
    await pageManager.logsPage.waitForQueryEditorValue('Counts');
    await applyQueryButton(pageManager);
    // Aggregate results have no user-pinned fields, so the table shows a single
    // "source" column containing the full row as JSON. Verify the source cell is
    // present and that it includes the expected field key.
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    await pageManager.logsPage.expectInterestingFieldInTable('kubernetes_pod_name');

    testLogger.info('Counts CTE query completed successfully');
  });

  test("should query with Levels CTE for log level counts", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing Levels CTE for log level counts');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.setQueryEditorValue('WITH Levels AS (SELECT level, COUNT(*) as level_count FROM "e2e_cte" GROUP BY level) SELECT * FROM Levels ORDER BY level_count DESC');
    // Deterministic wait — confirms Monaco model reflects the new query before Run.
    await pageManager.logsPage.waitForQueryEditorValue('Levels');
    await applyQueryButton(pageManager);
    // Aggregate results have no user-pinned fields, so the table shows a single
    // "source" column containing the full row as JSON. Verify the source cell is
    // present and that it includes the expected field key.
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    await pageManager.logsPage.expectInterestingFieldInTable('level');

    testLogger.info('Levels CTE query completed successfully');
  });

  test("should query with Normalized CTE for timeout messages", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing Normalized CTE for timeout messages');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    // Filter on the original message field inside the CTE — LIKE on a CTE-aliased
    // column in the outer WHERE is unreliable in OpenObserve's SQL engine.
    await pageManager.logsPage.setQueryEditorValue('WITH Normalized AS (SELECT _timestamp, COALESCE(message, \'No message\') AS normalized_message FROM "e2e_cte" WHERE str_match_ignore_case(message, \'timeout\')) SELECT * FROM Normalized');
    // Deterministic wait — confirms Monaco model reflects the new query before Run.
    await pageManager.logsPage.waitForQueryEditorValue('Normalized');
    await applyQueryButton(pageManager);
    await pageManager.logsPage.expectLogTableColumnSourceVisible();

    testLogger.info('Normalized CTE query completed successfully');
  });

  test.afterEach(async ({ page }) => {
    try {
      // await pageManager.commonActions.flipStreaming();
      testLogger.info('Streaming flipped after test');
    } catch (error) {
      testLogger.warn('Streaming flip failed', { error: error.message });
    }
  });
}); 