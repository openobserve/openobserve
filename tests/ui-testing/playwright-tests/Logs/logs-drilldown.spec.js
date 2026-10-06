/**
 * Drill down mode and the default service column — E2E
 *
 * Coverage for two of the changes in #15086:
 *
 *   Drill down — the Insights drawer became a mode in the toolbar toggle, rendered as a
 *   full page and remembered in the URL, with a per-field record count in the sidebar.
 *   Logs/logsAnalyzeDimensions.spec.js was repointed at the new selectors in that PR but
 *   still only covers the SQL-mode and empty-results edges; the page rendering, the URL
 *   round-trip and the counts have no coverage.
 *
 *   Default columns — the results table now shows `service` between the timestamp and the
 *   message column. Logs/ftsDefaultColumn.spec.js covers the FTS column in nine ways but
 *   cannot reach this branch: its fixture (test-data/logs_data.json) has no service field.
 *
 *     - Drill down renders as a page and hides the results pane     (TC-DD-001)
 *     - the mode is kept in the URL and survives a reload           (TC-DD-002)
 *     - the sidebar shows a record count per dimension              (TC-DD-003)
 *     - a stream with service shows timestamp, service, message     (TC-DC-001)
 *     - a stream without service is unchanged                       (TC-DC-002)
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const logData = require('../../fixtures/log.json');
const {
  ingestCustomData,
  waitForStreamData,
  waitForStreamListed,
} = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

const SUFFIX = Math.random().toString(36).slice(2, 7);
// Carries `service` AND an FTS-eligible `body`, which the shared fixture does not.
const SVC_STREAM = `e2e_svc_cols_${SUFFIX}`;
// Same shape minus `service`, to show the column is not injected unconditionally.
const PLAIN_STREAM = `e2e_svc_none_${SUFFIX}`;

const SVC_ROWS = [
  { body: 'checkout started', service: 'checkout', level: 'info' },
  { body: 'payment captured', service: 'payments', level: 'info' },
  { body: 'cart updated', service: 'cart', level: 'debug' },
];
const PLAIN_ROWS = [
  { body: 'no service here', level: 'info' },
  { body: 'still none', level: 'debug' },
];

const RESULTS_TABLE = '[data-test="logs-search-result-logs-table"]';
const DRILLDOWN_TOGGLE = '[data-test="logs-drilldown-toggle"]';
const ANALYSIS_PAGE = '[data-test="traces-analysis-dashboard-page"]';

/** Column ids actually rendered in the results table, in order. */
const columnIds = (page) =>
  page.evaluate((sel) => {
    const t = document.querySelector(sel);
    if (!t) return [];
    return [
      ...new Set(
        [...t.querySelectorAll('td[data-test^="o2-table-cell-"]')].map((td) =>
          td.getAttribute('data-test').replace('o2-table-cell-', ''),
        ),
      ),
    ];
  }, RESULTS_TABLE);

async function runSearch(page, stream) {
  await page.goto(
    `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}` +
      `&stream_type=logs&stream=${stream}&period=15m&quick_mode=false&sql_mode=false`,
  );
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
  await expect(page.locator(RESULTS_TABLE)).toBeVisible({ timeout: 30000 });
}

test.describe('Logs Drill down and default service column', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      for (const [stream, rows] of [
        [SVC_STREAM, SVC_ROWS],
        [PLAIN_STREAM, PLAIN_ROWS],
      ]) {
        await ingestCustomData(page, stream, rows);
        expect(
          await waitForStreamData(page, stream, rows.length, 60000),
          `stream ${stream} never became queryable within 60s`,
        ).toBe(true);
        expect(
          await waitForStreamListed(page, stream, 'logs'),
          `stream ${stream} never appeared in the streams list`,
        ).toBe(true);
      }
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  // ---------------------------------------------------------------------------
  // Default columns
  // ---------------------------------------------------------------------------

  test('a stream with a service field defaults to timestamp, service, message', {
    tag: ['@logsDefaultColumns', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    await runSearch(page, SVC_STREAM);

    // service goes between the timestamp and the chosen message column, so the first
    // question about any log line — which service emitted it — is answered without a click.
    await expect.poll(() => columnIds(page), { timeout: 30000 }).toEqual([
      '_timestamp',
      'service',
      'body',
    ]);
  });

  test('a stream without a service field is left unchanged', {
    tag: ['@logsDefaultColumns', '@logs', '@P2', '@all'],
  }, async ({ page }) => {
    await runSearch(page, PLAIN_STREAM);

    await expect.poll(() => columnIds(page), { timeout: 30000 }).toEqual(['_timestamp', 'body']);
  });

  // ---------------------------------------------------------------------------
  // Drill down
  // ---------------------------------------------------------------------------

  test('Drill down renders as a page and hides the results pane', {
    tag: ['@logsDrilldown', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    await runSearch(page, SVC_STREAM);
    await page.locator(DRILLDOWN_TOGGLE).click();

    // It used to be a drawer over the results; it is now a mode that owns the pane.
    await expect(page.locator(ANALYSIS_PAGE)).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-test="traces-analysis-dashboard-drawer"]')).toHaveCount(0);
    await expect(page.locator(RESULTS_TABLE)).toHaveCount(0);
  });

  test('the Drill down mode is kept in the URL and survives a reload', {
    tag: ['@logsDrilldown', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    await runSearch(page, SVC_STREAM);
    await page.locator(DRILLDOWN_TOGGLE).click();
    await expect(page.locator(ANALYSIS_PAGE)).toBeVisible({ timeout: 30000 });

    // A drawer could not be linked to; the whole point of the mode is a shareable URL.
    expect(page.url()).toContain('logs_visualize_toggle=drilldown');

    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    // Restoring the mode also has to reload the logs results it is built from.
    await expect(page.locator(ANALYSIS_PAGE)).toBeVisible({ timeout: 40000 });
  });

  test('the dimension sidebar shows a record count per field', {
    tag: ['@logsDrilldown', '@logs', '@P1', '@all'],
  }, async ({ page }) => {
    await runSearch(page, SVC_STREAM);
    await page.locator(DRILLDOWN_TOGGLE).click();
    await expect(page.locator(ANALYSIS_PAGE)).toBeVisible({ timeout: 30000 });

    // The counts are what make the field list usable on a wide stream: they say how many
    // records actually carry each field, so you can tell a populated dimension from an
    // almost-empty one before charting it.
    const counts = page.locator('[data-test^="dimension-count-"]');
    await expect(counts.first()).toBeVisible({ timeout: 30000 });

    const values = await counts.allInnerTexts();
    expect(values.length).toBeGreaterThan(0);
    // Every row of this fixture carries every field, so each count is the row count.
    expect(values.map((v) => v.trim())).toContain(String(SVC_ROWS.length));
  });
});
