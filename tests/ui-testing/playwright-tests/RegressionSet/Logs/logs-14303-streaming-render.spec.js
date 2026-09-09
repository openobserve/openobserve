/**
 * Logs Streaming Render Regression Tests
 *
 * Collateral-damage guard for #14303: the results grid stayed hidden behind the
 * skeleton for the whole duration of a streaming-aggs query. The regression itself
 * is caught by the unit tests (SearchResult.spec.ts / OTable.spec.ts) — see
 * docs/issue-14303-implementation-spec.md §1.8.1. These cases assert the settled
 * states adjacent to the fix still resolve correctly against a real backend.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logData = require("../../../fixtures/log.json");
const { ingestTestData, sendRequest, getHeaders, getIngestionUrl, waitForFieldValueSearchable } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier, isCloudEnvironment } = require('../../utils/cloud-auth.js');

test.describe("Logs Streaming Render Regression", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Attempt data ingestion but don't fail test if it errors (global setup already ingested data)
    try {
      await ingestTestData(page);
    } catch (error) {
      testLogger.warn(`Data ingestion skipped (may already exist from global setup): ${error.message}`);
    }

    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative1HourOrFallback();

    testLogger.info('Logs streaming render regression test setup completed');
  });

  test("aggregate query resolves to settled rows with no skeleton or banner left behind @bug-14303 @P1 @streamingAggs @regression @logsRegression", async ({ page }) => {
    testLogger.info('Test: streaming_aggs query settles the results grid (Bug #14303)');

    await pm.logsPage.enableSqlModeIfNeeded();
    await pm.logsPage.setQueryEditorContent('SELECT kubernetes_pod_name, count(*) as total FROM "e2e_automate" GROUP BY kubernetes_pod_name');
    await pm.logsPage.runQueryAndWaitForResults();

    await pm.logsPage.expectResultsGridSettledWithRows();
    await pm.logsPage.expectResultsProgressBarFadedOut();

    testLogger.info('✓ PASSED: aggregate query settles with rows, no skeleton, banner or progress bar');
  });

  test("plain non-aggregate logs query is unchanged @bug-14303 @P1 @streamingAggs @regression @logsRegression", async ({ page }) => {
    testLogger.info('Test: non-aggregate query still settles the results grid (Bug #14303)');

    await pm.logsPage.runQueryAndWaitForResults();

    await pm.logsPage.expectResultsGridSettledWithRows();

    testLogger.info('✓ PASSED: non-aggregate query unaffected by the streaming-aggs fix');
  });

  test("zero-row query still shows the no-events empty state @bug-14303 @P1 @streamingAggs @regression @logsRegression", async ({ page }) => {
    testLogger.info('Test: empty result set still renders the no-events state (Bug #14303)');

    await pm.logsPage.enableSqlModeIfNeeded();
    await pm.logsPage.setQueryEditorContent('SELECT * FROM "e2e_automate" WHERE kubernetes_pod_name = \'nonexistent_pod_14303_regression\'');
    await pm.logsPage.runQueryAndWaitForResults();

    const noResultsVisible = await pm.logsPage.isNoResultsMessageVisible();
    expect(noResultsVisible, 'No-events empty state must render for a zero-row result').toBeTruthy();
    await expect(page.locator(pm.logsPage.resultsSkeleton)).toHaveCount(0);

    testLogger.info('✓ PASSED: zero-row query still shows the no-events empty state');
  });
});
