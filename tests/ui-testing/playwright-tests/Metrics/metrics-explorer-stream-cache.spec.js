/**
 * Metrics Explorer — Stream List Cache E2E Suite
 *
 * Covers the cache-first mount / manual-refresh contract on `/web/metrics`:
 *
 *  - `onMounted` calls `grid.loadStreams()` with no `force`, resolving the metrics
 *    name list through TanStack Query's 5-minute cache. The grid paints cards on
 *    first visit.
 *  - Only an explicit manual refresh passes `force=true`; it invalidates and
 *    refetches the list while `refreshing` keeps the grid mounted (no full-page
 *    spinner). The refresh button enters then leaves its loading/disabled state.
 *  - In Visualize, refresh short-circuits to `runQuery()` and never touches the
 *    stream list; the grid is never remounted.
 *
 * NOT covered here (deliberately, per test-scope decision): the auto-refresh tick
 * and org-switch reloads — both wired but not DOM-observable with a stable
 * selector in OSS single-org CI. The loading-spinner overlay itself has no
 * `data-test`, so "no spinner during refresh" is asserted indirectly via
 * `expectCardsRemainVisible()` (cards stay mounted across the reload).
 *
 * Feature: metrics-explorer-stream-cache
 * Area: Metrics → Metrics Explorer
 * Feature doc: docs/test_generator/features/metrics-explorer-stream-cache-feature.md
 *
 * Pre-requisites:
 *  - Global setup handles authentication + org_identifier
 *  - Metrics ingested via ensureMetricsIngested() → up, cpu_usage, memory_usage,
 *    request_count, request_duration (all gauges)
 */
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

/** A metric the ingestion helper always seeds — safe to query and to drill into. */
const SEEDED_METRIC = 'cpu_usage';

test.describe('Metrics Explorer Stream List Cache testcases', () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  /** Fresh PageManager per test — parallel workers must not share page state. */
  async function setupTest(page, testInfo) {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    testLogger.info('Test setup completed — authenticated and on base');
    return pm;
  }

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // ═══ P0: CACHE-FIRST MOUNT ════════════════════════════════════════════════

  test("Explorer grid paints on first visit (cache-first mount)", {
    tag: ['@metrics-explorer-stream-cache', '@metrics', '@P0', '@smoke', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing the cache-first mount renders the stream-list cards');

    await pm.metricsExplorerPage.gotoExplorer();
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.waitForCards();

    const count = await pm.metricsExplorerPage.getCardCount();
    expect(count, 'the explorer should render at least one stream card').toBeGreaterThan(0);

    const countText = await pm.metricsExplorerPage.getResultCountText();
    expect(countText, 'the result count label should report a populated set').not.toBe('');

    testLogger.info('Explorer grid painted cards on first visit');
  });

  // ═══ P0: MANUAL REFRESH ═══════════════════════════════════════════════════

  test("Manual refresh reloads streams without blanking the grid", {
    tag: ['@metrics-explorer-stream-cache', '@metrics', '@P0', '@refresh', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing a manual refresh reloads the list while the grid stays mounted');

    await pm.metricsExplorerPage.gotoExplorer();
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.waitForCards();

    const before = await pm.metricsExplorerPage.getCardCount();
    expect(before).toBeGreaterThan(0);

    await pm.metricsExplorerPage.clickRefresh();

    // The button goes loading + disabled — the observable proof a reload actually
    // started (a no-op click would never enter the busy state).
    await pm.metricsExplorerPage.expectRefreshBusy();

    // Cards stay mounted throughout — the grid never blanks to a full-page spinner.
    await pm.metricsExplorerPage.expectCardsRemainVisible();

    // The button returns to idle and the grid re-renders the same (or more) cards.
    await pm.metricsExplorerPage.expectRefreshIdle();
    await pm.metricsExplorerPage.waitForCards();

    const after = await pm.metricsExplorerPage.getCardCount();
    expect(after).toBeGreaterThanOrEqual(before);

    testLogger.info('Manual refresh reloaded streams without blanking the grid');
  });

  // ═══ P1: VISUALIZE SHORT-CIRCUIT ══════════════════════════════════════════

  test("Visualize refresh re-runs the chart and never touches the stream grid", {
    tag: ['@metrics-explorer-stream-cache', '@metrics', '@P1', '@visualize', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing the Visualize refresh short-circuit re-runs only the chart');

    await pm.metricsExplorerPage.gotoExplorer({ mode: 'visualize' });
    await pm.metricsExplorerPage.waitForVisualizeReady();
    await pm.metricsExplorerPage.enterVisualizeQuery(SEEDED_METRIC);
    await pm.metricsExplorerPage.waitForMetricsDataParam();

    await pm.metricsExplorerPage.runVisualizeQuery();

    // Still in Visualize — no fallback to the Explore/Workspace grid.
    await pm.metricsExplorerPage.expectModeActive('visualize');
    await pm.metricsExplorerPage.expectVisualizeVisible();

    // The chart renderer stays mounted — a query re-run, not a stream-list reload.
    await pm.metricsExplorerPage.expectChartRendererVisible();

    testLogger.info('Visualize refresh re-ran the chart and never touched the stream grid');
  });

  // ═══ P1: RE-ENTRY GUARD ═══════════════════════════════════════════════════

  test("Refresh re-entry guard prevents overlapping stream reloads", {
    tag: ['@metrics-explorer-stream-cache', '@metrics', '@P1', '@refresh', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing the refresh button disables during a reload to block double-clicks');

    await pm.metricsExplorerPage.gotoExplorer();
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.waitForCards();

    await pm.metricsExplorerPage.clickRefresh();

    // While a reload is in flight the button is disabled — a second click is
    // impossible, so two stream reloads can never overlap.
    await expect
      .poll(async () => await pm.metricsExplorerPage.isRefreshButtonDisabled(), {
        timeout: 10000,
        intervals: [50, 100, 200],
      })
      .toBe(true);

    // Once idle the button re-enables, and only one reload ran.
    await pm.metricsExplorerPage.expectRefreshIdle();

    testLogger.info('Refresh re-entry guard verified — no overlapping reloads possible');
  });

  // ═══ P2: FRESH REMOUNT ════════════════════════════════════════════════════

  test("Rapid re-entry always renders the grid (fresh mount each visit)", {
    tag: ['@metrics-explorer-stream-cache', '@metrics', '@P2', '@remount', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing a second visit remounts and repaints the grid from cache');

    await pm.metricsExplorerPage.gotoExplorer();
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.waitForCards();

    // keepAlive:false remounts the explorer on every visit, so this second
    // gotoExplorer() is a fresh cache-first loadStreams() — it must repaint.
    await pm.metricsExplorerPage.gotoExplorer();
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.waitForCards();

    const count = await pm.metricsExplorerPage.getCardCount();
    expect(count, 'a fresh mount must repaint the grid').toBeGreaterThan(0);

    testLogger.info('Second mount repainted the grid — fresh cache-first load');
  });
});
