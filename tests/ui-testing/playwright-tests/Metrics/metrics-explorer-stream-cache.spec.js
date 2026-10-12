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
 * Cache hits and short-circuits are asserted ON THE WIRE, not in the DOM: a mount
 * served from cache renders identically to one that refetched, so the tests count
 * `/streams?type=metrics` requests across the window under test.
 *
 * NOT covered here (deliberately, per test-scope decision): the auto-refresh tick
 * and org-switch reloads — both wired but not DOM-observable with a stable
 * selector in OSS single-org CI. The loading-spinner overlay itself has no
 * `data-test`, so "no spinner during refresh" is asserted indirectly via
 * `expectCardsRemainVisible()` (cards stay mounted across the reload).
 *
 * Feature: metrics-explorer-stream-cache
 * Area: Metrics → Metrics Explorer
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

    // The grid is virtualized, so the label counts every loaded card while the DOM
    // holds only the rows in view — the label is the upper bound, never below it.
    const shown = await pm.metricsExplorerPage.getResultCount();
    expect(shown, 'the result count label should report a populated set').toBeGreaterThan(0);
    expect(shown, 'the label must not undercount the rendered cards').toBeGreaterThanOrEqual(count);

    testLogger.info('Explorer grid painted cards on first visit');
  });

  // ═══ P0: MANUAL REFRESH ═══════════════════════════════════════════════════

  // SKIPPED — races on an enterprise build. Owned by openobserve#15006, which added it.
  //
  // expectRefreshBusy() waits to OBSERVE the refresh button loading and disabled, a
  // state that exists only while the reload is in flight. On an enterprise build the
  // request returns before the poll catches it, so the state is never seen:
  //   Expected: disabled / Received: enabled — 14 x locator resolved to <button ...>
  // The retry then fails a line earlier, on the .toBe(true) poll, which is what a
  // timing race looks like rather than a broken assertion.
  //
  // It passed on #15006's own PR because that ran the OSS Playwright workflow. The
  // first enterprise run to reach it was o2-enterprise#2772, where the spec is red in
  // every shard attempt — so every ENT PR merged after 2026-09-30 13:28 inherits it.
  //
  // To re-enable: assert the OUTCOME rather than the transient busy state — the grid
  // stays mounted and the cards re-render — or have clickRefresh() hold the request
  // via page.route so the busy state is observable for a deterministic window.
  test.fixme("Manual refresh reloads streams without blanking the grid", {
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

    // The DOM cannot tell a short-circuit from a full reload — both leave the chart
    // mounted. Only the wire can: exactly one query, zero stream-list refetches.
    const streamCalls = pm.metricsExplorerPage.startStreamListCounter();
    const queryFired = pm.metricsExplorerPage.waitForPromqlQuery();

    await pm.metricsExplorerPage.runVisualizeQuery();

    await queryFired;
    expect(
      streamCalls.stop(),
      'refresh in Visualize must re-run the chart only, never refetch the stream list'
    ).toBe(0);

    // Still in Visualize — no fallback to the Explore/Workspace grid.
    await pm.metricsExplorerPage.expectModeActive('visualize');
    await pm.metricsExplorerPage.expectVisualizeVisible();
    await pm.metricsExplorerPage.expectChartRendererVisible();

    testLogger.info('Visualize refresh re-ran the chart and never touched the stream grid');
  });

  // ═══ P1: RE-ENTRY GUARD ═══════════════════════════════════════════════════

  test("Refresh re-entry guard prevents overlapping stream reloads", {
    tag: ['@metrics-explorer-stream-cache', '@metrics', '@P1', '@refresh', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing two same-tick refresh clicks collapse into one stream reload');

    await pm.metricsExplorerPage.gotoExplorer();
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.waitForCards();

    const streamCalls = pm.metricsExplorerPage.startStreamListCounter();
    // Gate on the response, not on aria-busy: the idle poll would otherwise be
    // free to fire before Vue has painted the busy state and count nothing.
    const reloadLanded = pm.metricsExplorerPage.waitForStreamListResponse();

    // Two clicks in one tick. `onRefresh` sets `refreshing` synchronously before
    // its first await, so the second click provably reaches the guard — waiting
    // for the disabled state and clicking again would race the reload instead.
    await pm.metricsExplorerPage.clickRefreshTwiceInSameTick();

    await reloadLanded;
    await pm.metricsExplorerPage.expectRefreshIdle();

    expect(
      streamCalls.stop(),
      'the re-entry guard must collapse two clicks into a single stream reload'
    ).toBe(1);

    testLogger.info('Re-entry guard verified — two clicks produced exactly one stream reload');
  });

  // ═══ P2: FRESH REMOUNT ════════════════════════════════════════════════════

  test("In-app remount repaints the grid from cache (no stream refetch)", {
    tag: ['@metrics-explorer-stream-cache', '@metrics', '@P2', '@remount', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing an in-app remount repaints the grid without refetching the stream list');

    await pm.metricsExplorerPage.gotoExplorer();
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.waitForCards();

    // Round-trip through the SPA, not page.goto() — a reload would destroy the
    // in-memory QueryClient and turn this into a plain cold load.
    const streamCalls = pm.metricsExplorerPage.startStreamListCounter();

    await pm.metricsExplorerPage.navigateAwayInApp();
    await pm.metricsExplorerPage.navigateToExplorerInApp();
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.waitForCards();

    const count = await pm.metricsExplorerPage.getCardCount();
    expect(count, 'a fresh mount must repaint the grid').toBeGreaterThan(0);

    // The whole point of the cache: inside the 5-minute staleTime the remount
    // repaints without going back to the server at all.
    expect(
      streamCalls.stop(),
      'a remount inside staleTime must serve the stream list from cache'
    ).toBe(0);

    testLogger.info('In-app remount repainted the grid from cache — zero stream-list requests');
  });
});
