/**
 * Metrics Explorer stale "No Data" regression — #14238.
 *
 * A metric whose FIRST explorer query lands before its writes are searchable
 * settles the card as empty, and that empty answer used to be treated as final
 * by two separate paths: the in-memory `settled` guard in `requestPreview`, and
 * the persisted IndexedDB answer replayed by `restoreFromCache`. The card then
 * stayed on "No Data" forever — across a reload and across an Explore/Visualize
 * round trip — while the same metric answered correctly through PromQL and in
 * the card's own Visualize view, which is a different pipeline entirely.
 *
 * Both paths now spend one bounded re-query on the next revisit, so there is one
 * test per path. Neither test may touch the time picker or either Refresh
 * control after the card has settled: a range change and a refresh both pass
 * `skipCache`, which re-queries for reasons that have nothing to do with the
 * fix, and would pass against the broken build too.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');

/**
 * How far back the seeded history goes. It has to sit OUTSIDE the window the
 * explorer opens on (its default, "Past 15 Minutes") so the first card query is
 * legitimately empty, and INSIDE `ZO_INGEST_ALLOWED_UPTO` (5 hours in the
 * regression workflow) so the rows are not dropped on the way in.
 */
const HISTORY_MINUTES_AGO = 26;

const org = () => getOrgIdentifier() || 'default';
const baseUrl = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');

/**
 * Seed a gauge. A gauge on purpose: its card query is `avg()`, with no `rate()`
 * anywhere, so an empty result means an empty window and cannot be confused
 * with the sparse-`rate()` path, which re-probes on its own and would mask the
 * bug this suite exists to catch.
 *
 * `_timestamp` is MILLIseconds here — the metrics ingest endpoint differs from
 * the logs one, which takes micros.
 */
async function seedGauge(page, metric, { minutesAgo, points, stepSeconds, firstValue }) {
  const startMs = Date.now() - minutesAgo * 60_000;
  const rows = Array.from({ length: points }, (_, i) => ({
    __name__: metric,
    __type__: 'gauge',
    instance: 'e2e-14238',
    job: 'e2e',
    _timestamp: startMs + i * stepSeconds * 1000,
    value: firstValue + i,
  }));

  const res = await page.request.post(`${baseUrl()}/api/${org()}/ingest/metrics/_json`, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    data: rows,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok() || body.code !== 200) {
    throw new Error(`seedGauge(${metric}) failed: ${res.status()} ${JSON.stringify(body)}`);
  }
  return rows.length;
}

/**
 * Gate on the metric actually answering, rather than sleeping: the ingest ack
 * lands before the rows are searchable, and a blind wait either flakes or
 * wastes the difference.
 *
 * @param present true to wait until an instant query returns a sample, false to
 *   wait until it returns none (the "history is outside the window" premise).
 */
async function waitForInstantQuery(page, metric, present, timeout = 60_000) {
  const seriesCount = async () => {
    const res = await page.request.get(
      `${baseUrl()}/api/${org()}/prometheus/api/v1/query?query=${encodeURIComponent(metric)}`,
      { headers: getAuthHeaders() },
    );
    const body = await res.json().catch(() => ({}));
    return body?.data?.result?.length ?? 0;
  };
  const poll = expect
    .poll(seriesCount, {
      timeout,
      intervals: [1000, 2000, 2000, 5000],
      message: `${metric} never became ${present ? 'queryable' : 'empty'}`,
    });
  await (present ? poll.toBeGreaterThan(0) : poll.toBe(0));
}

test.describe('Metrics Explorer stale no-data (#14238)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  /**
   * Settles a fresh metric's card as "No Data" and leaves it there, which is the
   * state both tests start from. `show_empty` keeps no-data cards rendered —
   * the grid hides them by default, and a hidden card cannot be asserted on.
   *
   * The No Data assertion doubles as the premise check: it can only hold while
   * the explorer's default window is narrower than HISTORY_MINUTES_AGO, so a
   * future change to that default fails here, loudly, instead of quietly making
   * the rest of the test meaningless.
   */
  async function settleCardAsEmpty(page, metric) {
    await seedGauge(page, metric, {
      minutesAgo: HISTORY_MINUTES_AGO,
      points: 20,
      stepSeconds: 6,
      firstValue: 1,
    });
    await waitForInstantQuery(page, metric, false);

    await pm.metricsExplorerPage.gotoExplorer({ search: metric, show_empty: 'true' });
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.expectCardNoData(metric);
    testLogger.info(`card settled as No Data: ${metric}`);
  }

  test('a settled No-Data card re-queries after a reload once the metric reports @bug-14238 @P1 @metrics @regression @metricsRegression', async ({
    page,
  }) => {
    const metric = `e2e_14238_reload_${Date.now()}`;
    await settleCardAsEmpty(page, metric);

    await seedGauge(page, metric, { minutesAgo: 10, points: 40, stepSeconds: 15, firstValue: 400 });
    await waitForInstantQuery(page, metric, true);

    // The reload is the whole test. It used to repaint the persisted empty
    // answer and fire no query at all, so the card stayed on "No Data" with the
    // data sitting right there.
    await pm.metricsExplorerPage.gotoExplorer({ search: metric, show_empty: 'true' });
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.expectCardCharted(metric);
  });

  test('a settled No-Data card re-queries on an Explore/Visualize round trip @bug-14238 @P1 @metrics @regression @metricsRegression', async ({
    page,
  }) => {
    const metric = `e2e_14238_revisit_${Date.now()}`;
    await settleCardAsEmpty(page, metric);

    await seedGauge(page, metric, { minutesAgo: 10, points: 40, stepSeconds: 15, firstValue: 500 });
    await waitForInstantQuery(page, metric, true);

    // No reload here: this is the in-memory guard's half of the fix, where the
    // preview object survives in the same composable and only a revisit can
    // dislodge it.
    await pm.metricsExplorerPage.switchToVisualize();
    await pm.metricsExplorerPage.switchToExplore();
    await pm.metricsExplorerPage.expectModeActive('explore');
    await pm.metricsExplorerPage.expectCardCharted(metric);
  });
});
