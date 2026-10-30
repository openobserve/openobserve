const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// Metric name is seeded by ensureMetricsIngested() / metrics-ingestion.js and is
// guaranteed to exist as a "metrics" type stream (see metrics.spec.js).
const METRIC_STREAM = 'cpu_usage';

// ===========================================================================
// Repro: Streams page "explore" (search icon) on a metrics stream → Logs page
// → "switch back to logs" → navigate to Home → back to Logs + hard refresh.
//
// Bug: after the refresh, stream_type shows "logs" (switch-back persisted
// correctly) but the stream dropdown still shows the metrics stream name —
// an inconsistent logs-type-with-metrics-stream-name state.
//
// Root cause: IndexList.vue's onStreamTypeChange('logs') clears
// selectedStream and calls saveLogsStream(orgId, []) to wipe the persisted
// logs stream, but streamPersist.ts's saveLogsStream() no-ops on an empty
// array, so the stale metrics stream name is never cleared from
// oo_selected_stream_logs_{orgId}. Separately, the selectedStream watcher in
// Index.vue wrote into that same logs-only bucket without checking that
// streamType was actually "logs", letting the metrics stream name leak in
// there in the first place.
// ===========================================================================

test.describe('Streams explore → Logs stream-type persistence', () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ensureMetricsIngested();
  });

  test('should not retain the metrics stream name after switching back to logs, leaving Home and reloading', {
    tag: ['@streams-logs-persistence', '@all', '@logs', '@streams', '@P0']
  }, async ({ page }) => {
    // 1. Streams page: filter to the Metrics tab and open the metric via the
    //    action column's search/explore icon.
    await pm.streamsPage.navigateToStreamExplorer();
    await page.locator('[data-test="log-stream-table"] [data-otoggle-value="metrics"]').click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.streamsPage.searchStream(METRIC_STREAM);
    await pm.streamsPage.verifyStreamNameVisibility(METRIC_STREAM);
    await pm.streamsPage.exploreStream();

    // 2. Landed on Logs with stream_type=metrics and the metric pre-selected.
    await expect(page).toHaveURL(/stream_type=metrics/);
    await pm.logsPage.expectStreamSelectorContainsText(METRIC_STREAM);

    // 3. Click "switch back to logs" beside the stream dropdown.
    const backToLogsBtn = page.locator('[data-test="log-search-index-list-back-to-logs-btn"]');
    await expect(backToLogsBtn).toBeVisible();
    await backToLogsBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await expect(backToLogsBtn).not.toBeVisible();

    // 4. Go to Home.
    await navigateToBase(page);

    // 5. Back to Logs, then hard refresh.
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Bug repro assertions: stream type must genuinely be "logs" (back-to-logs
    // button hidden) AND the stream dropdown must NOT still show the metrics
    // stream name left over from before the switch-back.
    await expect(backToLogsBtn).not.toBeVisible();
    await expect(page.locator('[data-test="log-search-index-list-select-stream-trigger"]'))
      .not.toContainText(METRIC_STREAM);

    // Confirm at the persistence layer too: the logs-type localStorage bucket
    // must not carry the metrics stream name across the reload.
    const persistedLogsStream = await page.evaluate(
      (orgId) => localStorage.getItem(`oo_selected_stream_logs_${orgId}`),
      getOrgIdentifier(),
    );
    if (persistedLogsStream) {
      expect(JSON.parse(persistedLogsStream)).not.toContain(METRIC_STREAM);
    }

    testLogger.info('Logs stream type/name stayed consistent after switch-back + reload');
  });
});
