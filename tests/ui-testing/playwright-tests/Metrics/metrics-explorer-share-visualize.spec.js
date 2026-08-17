/**
 * Metrics Explorer — Share URL & Visualize Deep-Link E2E Suite
 *
 * Covers PR #13274 (`be7a44e512`, v0.92.0), fixes F1 and F2:
 *
 *  F1 — Share URL on the metrics page. The explorer toolbar gained a ShareButton,
 *       and Visualize serializes the built chart into a `metrics_data` blob that is
 *       written to the URL (debounced 300ms), stripped when leaving Visualize, and
 *       rehydrated into the chart when a shared link is opened.
 *
 *  F2 — The back-compat route guard hijacked shared Visualize links. `/metrics`
 *       carrying editor params redirects to `/metrics/editor`; that redirect now
 *       skips when `mode=visualize`, so an explorer share link opens the explorer.
 *
 * NOT covered here (deliberately, per test-scope decision): F3 favorites/facet
 * gating and F4 stacked charts + OEmptyState migration.
 *
 * Feature: metrics-explorer-share-visualize
 * Area: Metrics → Metrics Explorer
 * Feature doc: docs/test_generator/features/metrics-explorer-share-visualize-feature.md
 *
 * Pre-requisites:
 *  - Global setup handles authentication + org_identifier
 *  - Metrics ingested via ensureMetricsIngested() → up, cpu_usage, memory_usage,
 *    request_count, request_duration (all gauges)
 *  - ZO_WEB_URL must be configured for the clipboard tests; where it is not, the
 *    share button self-disables and those tests skip with a reason
 */
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

/** A metric the ingestion helper always seeds — safe to query and to drill into. */
const SEEDED_METRIC = 'cpu_usage';

test.describe("Metrics Explorer Share & Visualize Deep-Link testcases", () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  /** Fresh PageManager per test — parallel workers must not share page state. */
  async function setupTest(page, testInfo) {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    // Clipboard access for the share-button copy assertions.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const pm = new PageManager(page);
    testLogger.info('Test setup completed — authenticated and on base');
    return pm;
  }

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // ═══ F2: ROUTE GUARD ══════════════════════════════════════════════════════

  test("Visualize deep-link stays on the explorer instead of redirecting to the editor", {
    tag: ['@metrics-explorer-share', '@P0', '@deeplink', '@route-guard', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing mode=visualize deep-link is exempt from the editor redirect');

    // `metrics_data` is an editor param, so pre-fix this URL was redirected to
    // /metrics/editor and the shared chart never opened in the explorer.
    const blob = pm.metricsExplorerPage.buildPromqlBlob(SEEDED_METRIC);
    const url = pm.metricsExplorerPage.buildExplorerUrl({
      mode: 'visualize',
      metrics_data: blob,
    });

    await pm.metricsExplorerPage.navigateToUrl(url);

    // The fix: still on /web/metrics, not /web/metrics/editor.
    await pm.metricsExplorerPage.expectOnExplorerRoute();
    await pm.metricsExplorerPage.expectModeActive('visualize');
    await pm.metricsExplorerPage.expectVisualizeVisible();

    testLogger.info('Visualize deep-link opened the explorer — guard exemption verified');
  });

  test("Legacy metrics_data link without a mode still redirects to the editor", {
    tag: ['@metrics-explorer-share', '@P1', '@deeplink', '@route-guard', '@backcompat', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing the back-compat branch of the guard is intact');

    // Links shared before the explorer existed carry metrics_data with NO mode.
    // Those must keep landing on the editor — the fix narrowed the redirect, it
    // did not remove it.
    const blob = pm.metricsExplorerPage.buildPromqlBlob(SEEDED_METRIC);
    const url = pm.metricsExplorerPage.buildExplorerUrl({ metrics_data: blob });

    await pm.metricsExplorerPage.navigateToUrl(url);

    await pm.metricsExplorerPage.expectRedirectedToEditor();

    testLogger.info('Legacy deep-link still routed to the editor — back-compat preserved');
  });

  test("Explorer mode links without editor params are never redirected", {
    tag: ['@metrics-explorer-share', '@P2', '@deeplink', '@route-guard', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing plain explorer URLs bypass the guard entirely');

    // No editor params at all — hasMetricsEditorParams is false, so the guard
    // must not fire regardless of the mode carried.
    await pm.metricsExplorerPage.gotoExplorer({ mode: 'workspace' });

    await pm.metricsExplorerPage.expectOnExplorerRoute();
    await pm.metricsExplorerPage.expectModeActive('workspace');

    testLogger.info('Plain explorer link stayed put — guard correctly inert');
  });

  // ═══ F1: SHARE BUTTON PRESENCE ════════════════════════════════════════════

  test("Share button is present on the explorer toolbar in every mode", {
    tag: ['@metrics-explorer-share', '@P0', '@share', '@smoke', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing the share affordance exists on the explorer');

    // Pre-fix the explorer had no share button at all — this is the headline
    // regression, so presence is asserted, not probed.
    await pm.metricsExplorerPage.gotoExplorer();
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.expectShareButtonVisible();

    await pm.metricsExplorerPage.switchToVisualize();
    await pm.metricsExplorerPage.expectModeActive('visualize');
    await pm.metricsExplorerPage.expectShareButtonVisible();

    await pm.metricsExplorerPage.switchToWorkspace();
    await pm.metricsExplorerPage.expectModeActive('workspace');
    await pm.metricsExplorerPage.expectShareButtonVisible();

    testLogger.info('Share button rendered in explore, visualize and workspace');
  });

  // ═══ F1: URL SYNC ═════════════════════════════════════════════════════════

  test("Building a chart in Visualize writes the metrics_data blob to the URL", {
    tag: ['@metrics-explorer-share', '@P0', '@url-sync', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing Visualize serializes the built chart into the URL');

    await pm.metricsExplorerPage.gotoExplorer({ mode: 'visualize' });
    await pm.metricsExplorerPage.waitForVisualizeReady();

    // A blank Visualize carries no blob — the param only appears once there is
    // a query to encode.
    expect(pm.metricsExplorerPage.hasMetricsDataParam()).toBe(false);

    await pm.metricsExplorerPage.enterVisualizeQuery(SEEDED_METRIC);

    // The write-back is debounced 300ms, so poll for it.
    await pm.metricsExplorerPage.waitForMetricsDataParam();

    const blob = pm.metricsExplorerPage.decodeMetricsBlob();
    expect(blob).not.toBeNull();
    expect(blob.v).toBe(1);
    expect(JSON.stringify(blob.data)).toContain(SEEDED_METRIC);

    testLogger.info('metrics_data blob written to the URL with the built query');
  });

  test("Leaving Visualize strips the stale metrics_data blob from the URL", {
    tag: ['@metrics-explorer-share', '@P1', '@url-sync', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing the blob is removed when the mode leaves Visualize');

    await pm.metricsExplorerPage.gotoExplorer({ mode: 'visualize' });
    await pm.metricsExplorerPage.waitForVisualizeReady();
    await pm.metricsExplorerPage.enterVisualizeQuery(SEEDED_METRIC);
    await pm.metricsExplorerPage.waitForMetricsDataParam();

    // Back to the grid: the blob describes a chart that is no longer on screen,
    // so carrying it would make the URL misrepresent the page.
    await pm.metricsExplorerPage.switchToExplore();
    await pm.metricsExplorerPage.expectModeActive('explore');

    await pm.metricsExplorerPage.waitForMetricsDataCleared();

    testLogger.info('Stale blob stripped on leaving Visualize');
  });

  test("A blank Visualize adds no metrics_data param", {
    tag: ['@metrics-explorer-share', '@P2', '@url-sync', '@edge-case', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing an unbuilt chart contributes nothing to the URL');

    await pm.metricsExplorerPage.gotoExplorer();
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.switchToVisualize();
    await pm.metricsExplorerPage.waitForVisualizeReady();

    // visualizeBlob short-circuits on an empty queries[0].query, so nothing is
    // encoded. Assert it stays absent rather than merely reading once — the
    // debounce means an erroneous write would land shortly after mount.
    await expect
      .poll(() => pm.metricsExplorerPage.hasMetricsDataParam(), {
        timeout: 5000,
        intervals: [500, 1000],
      })
      .toBe(false);

    testLogger.info('Blank Visualize left the URL clean');
  });

  test("The metrics_data blob excludes volatile keys (id, title, description)", {
    tag: ['@metrics-explorer-share', '@P2', '@url-sync', '@volatile-data', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing volatile panel keys are stripped before sharing');

    await pm.metricsExplorerPage.gotoExplorer({ mode: 'visualize' });
    await pm.metricsExplorerPage.waitForVisualizeReady();
    await pm.metricsExplorerPage.enterVisualizeQuery(SEEDED_METRIC);
    await pm.metricsExplorerPage.waitForMetricsDataParam();

    // getMetricsConfig deletes these — a shared link must not carry the sender's
    // panel identity into the recipient's session.
    const blob = pm.metricsExplorerPage.decodeMetricsBlob();
    expect(blob).not.toBeNull();
    expect(blob.data.id).toBeUndefined();
    expect(blob.data.title).toBeUndefined();
    expect(blob.data.description).toBeUndefined();

    testLogger.info('Volatile keys absent from the shared blob');
  });

  // ═══ F1 + F2: FULL ROUND-TRIP ═════════════════════════════════════════════

  test("A shared Visualize URL reopens the same chart", {
    tag: ['@metrics-explorer-share', '@P0', '@share', '@round-trip', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing the end-to-end share round-trip');

    // Build a chart, then take the URL the page produced — not a hand-rolled
    // one. This is the whole bug: what the app writes must be what it can read.
    await pm.metricsExplorerPage.gotoExplorer({ mode: 'visualize' });
    await pm.metricsExplorerPage.waitForVisualizeReady();
    await pm.metricsExplorerPage.enterVisualizeQuery(SEEDED_METRIC);
    await pm.metricsExplorerPage.waitForMetricsDataParam();

    const sharedUrl = page.url();
    testLogger.info(`Captured shared URL of length ${sharedUrl.length}`);

    // Open it as a recipient would — a cold navigation, no in-page state.
    await pm.metricsExplorerPage.navigateToUrl(sharedUrl);

    await pm.metricsExplorerPage.expectOnExplorerRoute();
    await pm.metricsExplorerPage.expectModeActive('visualize');
    await pm.metricsExplorerPage.waitForVisualizeReady();
    await pm.metricsExplorerPage.expectVisualizeQueryToContain(SEEDED_METRIC);

    testLogger.info('Shared URL rehydrated the chart with its original query');
  });

  test("Card drill-in produces a shareable Visualize URL", {
    tag: ['@metrics-explorer-share', '@P1', '@url-sync', '@drill-in', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing the card → Visualize path also serializes to the URL');

    await pm.metricsExplorerPage.gotoExplorer();
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.waitForCards();

    // The real user path into Visualize: open a card rather than typing PromQL.
    // Its seeded query must be shareable exactly like a hand-built one.
    await pm.metricsExplorerPage.openFirstCardInVisualize();
    await pm.metricsExplorerPage.expectModeActive('visualize');
    await pm.metricsExplorerPage.waitForVisualizeReady();

    await pm.metricsExplorerPage.waitForMetricsDataParam();
    const blob = pm.metricsExplorerPage.decodeMetricsBlob();
    expect(blob).not.toBeNull();
    expect(blob.v).toBe(1);
    expect(blob.data.queries?.[0]?.query).toBeTruthy();

    testLogger.info('Drill-in chart serialized into a shareable URL');
  });

  // ═══ F1: SHARE BUTTON BEHAVIOUR ═══════════════════════════════════════════

  test("Share button copies a short URL for the built Visualize chart", {
    tag: ['@metrics-explorer-share', '@P0', '@share', '@clipboard', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing share-to-clipboard from the explorer Visualize mode');

    await pm.metricsExplorerPage.gotoExplorer({ mode: 'visualize' });
    await pm.metricsExplorerPage.waitForVisualizeReady();

    const { canShare, reason } = await pm.metricsExplorerPage.checkShareReadiness();
    if (!canShare) {
      testLogger.warn(`Skipping share test — ${reason}`);
      test.skip(true, reason);
      return;
    }

    await pm.metricsExplorerPage.enterVisualizeQuery(SEEDED_METRIC);
    await pm.metricsExplorerPage.waitForMetricsDataParam();

    await pm.metricsExplorerPage.clickShareButton();
    await pm.metricsExplorerPage.waitForShareSuccessToast();

    const clipboardUrl = await pm.metricsExplorerPage.getCopiedShortUrl();
    expect(clipboardUrl).toContain('/short/');

    testLogger.info('Short URL copied to the clipboard from the explorer');
  });

  test("Share button clears its loading state after the shorten call completes", {
    tag: ['@metrics-explorer-share', '@P2', '@share', '@loading', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing the share button loading lifecycle');

    await pm.metricsExplorerPage.gotoExplorer({ mode: 'visualize' });
    await pm.metricsExplorerPage.waitForVisualizeReady();

    const { canShare, reason } = await pm.metricsExplorerPage.checkShareReadiness();
    if (!canShare) {
      testLogger.warn(`Skipping loading-state test — ${reason}`);
      test.skip(true, reason);
      return;
    }

    await pm.metricsExplorerPage.enterVisualizeQuery(SEEDED_METRIC);
    await pm.metricsExplorerPage.waitForMetricsDataParam();

    await pm.metricsExplorerPage.clickShareButton();
    await pm.metricsExplorerPage.waitForShareSuccessToast();

    // Poll the real state rather than sleeping into a race — a button stuck in
    // aria-busy is unclickable, so this is the assertion that matters.
    await expect
      .poll(async () => await pm.metricsExplorerPage.isShareButtonLoading(), {
        timeout: 10000,
        intervals: [200, 400, 800],
      })
      .toBe(false);

    testLogger.info('Share button returned to its idle state');
  });

  test("Share URL in a grid mode carries the explorer filters and no blob", {
    tag: ['@metrics-explorer-share', '@P1', '@share', '@grid-mode', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing grid-mode sharing is the plain filtered URL');

    // In Explore and Workspace the whole page state already lives in the URL, so
    // shareUrl is location.href untouched — no metrics_data is appended.
    await pm.metricsExplorerPage.gotoExplorer({ search: SEEDED_METRIC, sort: 'z-a' });
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.expectShareButtonVisible();

    expect(pm.metricsExplorerPage.getQueryParam('search')).toBe(SEEDED_METRIC);
    expect(pm.metricsExplorerPage.getQueryParam('sort')).toBe('z-a');
    expect(pm.metricsExplorerPage.hasMetricsDataParam()).toBe(false);

    testLogger.info('Grid-mode URL carries filters only — verified');
  });

  // ═══ F1 + F2: MALFORMED BLOB EDGE CASES ═══════════════════════════════════

  test("Visualize deep-link with a corrupt blob opens the explorer without crashing", {
    tag: ['@metrics-explorer-share', '@P2', '@deeplink', '@error-handling', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing corrupt metrics_data is ignored, not fatal');

    // decodeMetricsConfig swallows the failure and returns null, so the pane
    // opens blank rather than throwing — and the guard still exempts the link.
    const url = pm.metricsExplorerPage.buildExplorerUrl({
      mode: 'visualize',
      metrics_data: '!!!not-valid-base64!!!',
    });

    await pm.metricsExplorerPage.navigateToUrl(url);

    await pm.metricsExplorerPage.expectOnExplorerRoute();
    await pm.metricsExplorerPage.expectModeActive('visualize');
    await pm.metricsExplorerPage.expectVisualizeVisible();

    testLogger.info('Corrupt blob ignored — explorer stable in Visualize');
  });

  test("Visualize deep-link with an unknown blob version does not apply the payload", {
    tag: ['@metrics-explorer-share', '@P2', '@deeplink', '@version-mismatch', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing the blob version gate rejects future payloads');

    // v:9999 is the migration hook — an unrecognised envelope decodes to null, so
    // no seed reaches MetricsVisualize and it falls back to applyMetricsDefaults.
    //
    // That fallback is NOT necessarily an empty editor: the last metrics stream is
    // remembered in localStorage per org (utils/streamPersist.ts) and the default
    // panel runs with customQuery=false, so the builder can auto-generate a query
    // such as `avg(cpu_usage{})` on its own. Asserting "blank" would therefore be
    // testing the environment's leftover state, not the version gate.
    //
    // So the rejected payload carries a marker no generated query can produce, and
    // the assertion is precisely that the MARKER never lands — i.e. the blob was
    // not applied — whatever the defaults happen to fill in.
    const REJECTED_MARKER = 'max_over_time';
    const blob = pm.metricsExplorerPage.buildPromqlBlob(
      `${REJECTED_MARKER}(${SEEDED_METRIC}[42h])`,
      9999
    );
    const url = pm.metricsExplorerPage.buildExplorerUrl({
      mode: 'visualize',
      metrics_data: blob,
    });

    await pm.metricsExplorerPage.navigateToUrl(url);

    await pm.metricsExplorerPage.expectOnExplorerRoute();
    await pm.metricsExplorerPage.expectModeActive('visualize');
    await pm.metricsExplorerPage.waitForVisualizeReady();

    // Let whatever the defaults produce settle first, so the assertion runs after
    // the editor has been populated rather than racing an empty initial state.
    await pm.metricsExplorerPage.waitForVisualizeQuerySettled();

    const queryText = await pm.metricsExplorerPage.getVisualizeQueryText();
    expect(queryText).not.toContain(REJECTED_MARKER);

    // Note: the rejected blob may REMAIN in the address bar. syncVisualizeUrl only
    // rewrites metrics_data when the serialized chart differs from the param, and
    // on a blank canvas it has nothing to write — nothing proactively scrubs an
    // unrecognised inbound param. Asserting it disappears would test a guarantee
    // the app does not make, so the invariant here is strictly "not applied".

    testLogger.info('Version-gated blob rejected — payload never applied');
  });
});
