// tracesCharts.spec.js — RED metrics charts: rendering, zoom, and the Insights filter handoff.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');

// TracesMetricsDashboard.emitFiltersToQueryEditor writes duration filters as human-readable strings.
const DURATION_FILTER_PATTERN = /duration\s*(>=|<=)\s*'[\d.]+(us|ms|s|m)'/;
// The Insights query fails server-side when that string is not decoded back to µs.
const CAST_ERROR_PATTERN = /Cannot cast string|simplify_expressions|Arrow error/i;
const RED_PANELS = ['Rate', 'Errors', 'Duration'];
// Insights tab slugs from TracesAnalysisDashboard.vue.
const ANALYSIS_TABS = ['volume', 'error', 'duration'];

test.describe("Traces Charts testcases", () => {
  let pm;

  // The Errors panel plots an empty series unless the window holds at least one error span.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      const errors = await ingestTraces(page, 6, { forceScenario: 'error' });
      const success = await ingestTraces(page, 10, { forceScenario: 'success' });
      testLogger.info('Seeded traces for chart tests', {
        errors: errors.successful,
        success: success.successful,
      });
    } catch (e) {
      testLogger.warn('Chart trace seeding failed (continuing)', { error: e.message });
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');

    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.isStreamSelectVisible();
    await pm.tracesPage.selectTraceStream('default');
    await page.waitForTimeout(2000);
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // Helper: run a search, assert it returned data, and surface the RED charts.
  async function searchAndShowCharts() {
    await pm.tracesPage.setupTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();

    const hasResults = await pm.tracesPage.hasTraceResults();
    expect(hasResults, 'Trace results must be available — check data ingestion').toBeTruthy();

    const metricsVisible = await pm.tracesPage.ensureMetricsDashboardVisible();
    expect(metricsVisible, 'RED metrics charts must be visible').toBeTruthy();

    const rendered = await pm.tracesPage.waitForMetricsPanels();
    expect(rendered.length, `Panels rendered: ${rendered.join(', ')}`).toBeGreaterThan(0);
    return rendered;
  }

  // ─── P0 — Regression guards for open chart bugs ──────────────────────────────

  // Skipped until #14533 lands — the zoom selection greys out the whole chart, not just the band.
  test.skip("P0: Zoom selection keeps the chart visible while dragging (#14533)", {
    tag: ['@tracesCharts', '@traces', '@regression', '@P0', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    const snapped = await pm.tracesPage.zoomWithCanvasSnapshots('Rate');
    expect(snapped, 'Rate panel canvas must be snapshottable around the zoom drag').toBeTruthy();

    const ink = await pm.tracesPage.measureChartInkUnderSelection();
    expect(ink, 'The zoom drag must paint a detectable selection rectangle').not.toBeNull();
    testLogger.info('Chart ink under the zoom selection', ink);

    // A translucent highlight tints the series and gridlines; an opaque wash erases them.
    expect(
      ink.inkRatio,
      `Series under the selection must stay visible (before=${ink.beforeInk}, during=${ink.duringInk})`
    ).toBeGreaterThan(0.75);
  });

  // Skipped until #14534 lands — Insights forwards `duration <= '5.62s'` to SQL undecoded.
  test.skip("P0: Duration zoom then Insights renders without a cast error (#14534)", {
    tag: ['@tracesCharts', '@traces', '@regression', '@P0', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    const zoomed = await pm.tracesPage.zoomDurationBand();
    expect(zoomed, 'Duration panel must accept the zoom drag').toBeTruthy();

    const query = await pm.tracesPage.getQueryEditorContent();
    testLogger.info('Query editor after duration zoom', { query });
    expect(query, 'Duration zoom must write a duration filter into the editor')
      .toMatch(DURATION_FILTER_PATTERN);

    await pm.tracesPage.clickInsightsButton();
    await pm.tracesPage.waitForAnalysisDashboardLoad();
    await page.waitForTimeout(5000);

    // The cast error hits every dimension panel on every tab, so all three are checked.
    for (const tab of ANALYSIS_TABS) {
      await pm.tracesPage.openAnalysisTab(tab);

      const states = await pm.tracesPage.getAnalysisPanelStates();
      testLogger.info(`Insights ${tab} tab panels after duration zoom`, states);

      expect(states.errorText, `${tab} tab must not fail casting the duration filter`)
        .not.toMatch(CAST_ERROR_PATTERN);
      expect(states.errors, `${tab} tab must render no errored dimension panel`).toBe(0);
      expect(states.charts, `${tab} tab must render a chart per dimension panel`)
        .toBe(states.panels);
    }

    await pm.tracesPage.closeAnalysisDashboard();
  });

  // ─── P0 — Critical path ──────────────────────────────────────────────────────

  test("P0: RED charts render Rate, Errors and Duration panels", {
    tag: ['@tracesCharts', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {

    const rendered = await searchAndShowCharts();

    expect(rendered).toEqual(expect.arrayContaining(RED_PANELS));

    const panelError = await pm.tracesPage.getMetricsPanelErrorText();
    expect(panelError, 'No RED panel may render an error').toBe('');

    for (const title of RED_PANELS) {
      const box = await pm.tracesPage.getMetricsPanelCanvasBox(title);
      expect(box, `${title} panel must have a sized canvas`).not.toBeNull();
      expect(box.width, `${title} canvas width`).toBeGreaterThan(0);
      expect(box.height, `${title} canvas height`).toBeGreaterThan(0);
    }
  });

  test("P0: Charts toggle hides and restores the RED charts", {
    tag: ['@tracesCharts', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    await pm.tracesPage.toggleMetricsDashboard();
    await page.waitForTimeout(1000);
    expect(
      await pm.tracesPage.isTracesMetricsDashboardVisible(),
      'Charts must hide when the toggle is switched off'
    ).toBeFalsy();

    await pm.tracesPage.toggleMetricsDashboard();
    await page.waitForTimeout(1000);
    expect(
      await pm.tracesPage.isTracesMetricsDashboardVisible(),
      'Charts must come back when the toggle is switched on'
    ).toBeTruthy();

    const rendered = await pm.tracesPage.waitForMetricsPanels();
    expect(rendered.length, 'Panels must re-render after being restored').toBeGreaterThan(0);
  });

  test("P0: Insights opens from the charts and renders content", {
    tag: ['@tracesCharts', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    expect(await pm.tracesPage.isInsightsButtonVisible(), 'Insights button must be visible').toBeTruthy();
    await pm.tracesPage.clickInsightsButton();
    await pm.tracesPage.waitForAnalysisDashboardLoad();

    expect(await pm.tracesPage.isAnalysisDashboardVisible(), 'Insights dashboard must open').toBeTruthy();

    const drawerText = await pm.tracesPage.getAnalysisDashboardText();
    expect(drawerText, 'Insights must open without a query error').not.toMatch(CAST_ERROR_PATTERN);

    await pm.tracesPage.closeAnalysisDashboard();
  });

  test("P0: Insights renders a chart for every dimension on every tab", {
    tag: ['@tracesCharts', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();
    await pm.tracesPage.clickInsightsButton();
    await pm.tracesPage.waitForAnalysisDashboardLoad();

    for (const tab of ANALYSIS_TABS) {
      await pm.tracesPage.openAnalysisTab(tab);

      const states = await pm.tracesPage.getAnalysisPanelStates();
      testLogger.info(`Insights ${tab} tab panels`, states);

      expect(states.panels, `${tab} tab must render dimension panels`).toBeGreaterThan(0);
      expect(states.errors, `${tab} tab panel error: ${states.errorText}`).toBe(0);
      expect(states.charts, `${tab} tab must draw a chart in every panel`).toBe(states.panels);
    }

    await pm.tracesPage.closeAnalysisDashboard();
  });

  // ─── P1 — Functional ─────────────────────────────────────────────────────────

  test("P1: Duration zoom writes a duration filter into the query editor", {
    tag: ['@tracesCharts', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    const before = await pm.tracesPage.getQueryEditorContent();
    expect(before, 'Editor must start without a duration filter').not.toMatch(DURATION_FILTER_PATTERN);

    const zoomed = await pm.tracesPage.zoomDurationBand();
    expect(zoomed, 'Duration panel must accept the zoom drag').toBeTruthy();

    const after = await pm.tracesPage.getQueryEditorContent();
    testLogger.info('Query editor after duration zoom', { after });
    expect(after, 'Duration zoom must add a duration filter').toMatch(DURATION_FILTER_PATTERN);
  });

  test("P1: Reset clears the zoom-applied duration filter", {
    tag: ['@tracesCharts', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();
    await pm.tracesPage.zoomDurationBand();

    const applied = await pm.tracesPage.getQueryEditorContent();
    expect(applied, 'Duration zoom must add a duration filter').toMatch(DURATION_FILTER_PATTERN);

    await pm.tracesPage.resetAllFilters();
    await page.waitForTimeout(2000);

    const cleared = await pm.tracesPage.getQueryEditorContent();
    testLogger.info('Query editor after reset', { cleared });
    expect(cleared, 'Reset must drop the duration filter').not.toMatch(DURATION_FILTER_PATTERN);
  });

  test("P1: Charts re-render after a time range change", {
    tag: ['@tracesCharts', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    await pm.tracesPage.setTimeRange('1h');
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();

    const rendered = await pm.tracesPage.waitForMetricsPanels();
    expect(rendered.length, 'Panels must re-render for the new time range').toBeGreaterThan(0);

    const panelError = await pm.tracesPage.getMetricsPanelErrorText();
    expect(panelError, 'No RED panel may error after a time range change').toBe('');
  });

  test("P1: Charts keep rendering with the error-only filter applied", {
    tag: ['@tracesCharts', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    const badgeVisible = await pm.tracesPage.waitForErrorBadgeAfterSearch();
    test.skip(!badgeVisible, 'error-count badge absent — no error spans in this window');

    await pm.tracesPage.toggleErrorOnlyFilter();
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();

    const rendered = await pm.tracesPage.waitForMetricsPanels();
    expect(rendered.length, 'Panels must render under the error-only filter').toBeGreaterThan(0);

    const panelError = await pm.tracesPage.getMetricsPanelErrorText();
    expect(panelError, 'No RED panel may error under the error-only filter').toBe('');

    await pm.tracesPage.toggleErrorOnlyFilter();
  });

  test("P1: Charts survive a switch from Traces to Spans mode", {
    tag: ['@tracesCharts', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    await page.locator('[data-test="traces-search-mode-spans-btn"]').click();
    await page.waitForTimeout(3000);

    const rendered = await pm.tracesPage.waitForMetricsPanels();
    expect(rendered.length, 'Panels must re-render in spans mode').toBeGreaterThan(0);

    const panelError = await pm.tracesPage.getMetricsPanelErrorText();
    expect(panelError, 'No RED panel may error in spans mode').toBe('');
  });

  // ─── P2 — Negative scenarios ─────────────────────────────────────────────────

  test("P2: Charts render no panels before a stream is selected", {
    tag: ['@tracesCharts', '@traces', '@negative', '@P2', '@all']
  }, async ({ page }) => {

    // A full reload drops the in-memory stream selection; a sidebar click would keep it.
    await pm.tracesPage.navigateToTracesUrl();
    await page.waitForTimeout(3000);

    await expect(
      page.locator('[data-test="traces-no-stream-select-stream-card"]'),
      'The no-stream state must be shown before a stream is picked'
    ).toBeVisible({ timeout: 15000 });

    const panelCanvases = await page
      .locator('[data-test="traces-metrics-dashboard"] [data-test-panel-title] canvas')
      .count();
    expect(panelCanvases, 'No RED panel may render without a stream').toBe(0);

    const panelError = await pm.tracesPage.getMetricsPanelErrorText();
    expect(panelError, 'An unselected stream must not surface a panel error').toBe('');

    await pm.tracesPage.expectSearchBarVisible();
  });

  test("P2: A query matching nothing leaves the charts empty, not errored", {
    tag: ['@tracesCharts', '@traces', '@negative', '@P2', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    const typed = await pm.tracesPage.typeTraceQuery("service_name = 'no_such_service_e2e'");
    expect(typed, 'The filter must land in the editor').toBeTruthy();
    await pm.tracesPage.runQuery();
    await pm.tracesPage.waitForTraceSearchResults();
    await page.waitForTimeout(3000);

    // Proves the filter reached the search rather than the assertions passing on stale results.
    expect(await pm.tracesPage.isNoResultsVisible(), 'The filter must match nothing').toBeTruthy();

    const panelError = await pm.tracesPage.getMetricsPanelErrorText();
    testLogger.info('Empty-result chart state', { panelError });
    expect(panelError, 'An empty result set must not surface a panel error').toBe('');
    expect(
      await pm.tracesPage.isTracesMetricsDashboardVisible(),
      'Charts must stay mounted for an empty result set'
    ).toBeTruthy();
  });

  test("P2: A rejected query surfaces an error without crashing the page", {
    tag: ['@tracesCharts', '@traces', '@negative', '@P2', '@all']
  }, async ({ page }) => {

    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await searchAndShowCharts();

    const typed = await pm.tracesPage.typeTraceQuery("duration >= 'abc'");
    expect(typed, 'The bad query must land in the editor').toBeTruthy();
    await pm.tracesPage.runQuery();
    await page.waitForTimeout(6000);

    // Charts are gated on the error state, so they are expected to go; the page is not.
    expect(await pm.tracesPage.isSearchErrorVisible(), 'The query must be rejected').toBeTruthy();
    await pm.tracesPage.expectSearchBarVisible();

    // Rejected HTTP calls are the point of this flow; only script errors mean a crash.
    const scriptErrors = pageErrors.filter((m) => !/Request failed with status code/.test(m));
    expect(scriptErrors, `Uncaught script errors: ${scriptErrors.join(' | ')}`).toHaveLength(0);
  });

  // Skipped until o2-enterprise#2643 lands — a rejected query leaves the charts
  // unmounted even after the editor is emptied and the search succeeds again.
  test.skip("P0: Charts return once a rejected query is cleared (o2-enterprise#2643)", {
    tag: ['@tracesCharts', '@traces', '@regression', '@P0', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    expect(await pm.tracesPage.typeTraceQuery("duration >= 'abc'"), 'Bad query must land').toBeTruthy();
    await pm.tracesPage.runQuery();
    await page.waitForTimeout(6000);
    expect(await pm.tracesPage.isSearchErrorVisible(), 'The query must be rejected').toBeTruthy();

    expect(await pm.tracesPage.clearTraceQueryByKeyboard(), 'Editor must end up empty').toBeTruthy();
    await pm.tracesPage.runQuery();
    await pm.tracesPage.waitForTraceSearchResults();

    const rendered = await pm.tracesPage.waitForMetricsPanels();
    testLogger.info('Panels after clearing the rejected query', { rendered });
    expect(rendered.length, 'Charts must come back once the query is valid again').toBeGreaterThan(0);
  });

  // ─── P2 — Edge cases ─────────────────────────────────────────────────────────

  test("P2: Zoom drag leaves the charts and search bar functional", {
    tag: ['@tracesCharts', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();
    await pm.tracesPage.zoomOnMetricsPanel('Rate');

    await pm.tracesPage.expectSearchBarVisible();
    expect(
      await pm.tracesPage.isTracesMetricsDashboardVisible(),
      'Charts must survive a zoom drag'
    ).toBeTruthy();

    const panelError = await pm.tracesPage.getMetricsPanelErrorText();
    expect(panelError, 'No RED panel may error after a zoom').toBe('');
  });

  test("P2: A click without a drag applies no duration filter", {
    tag: ['@tracesCharts', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    const clicked = await pm.tracesPage.clickMetricsPanelWithoutDrag('Duration');
    expect(clicked, 'Duration panel must accept the click').toBeTruthy();

    const query = await pm.tracesPage.getQueryEditorContent();
    testLogger.info('Query editor after a bare click', { query });
    expect(query, 'A zero-width selection must not become a filter')
      .not.toMatch(DURATION_FILTER_PATTERN);
  });

  test("P2: Repeated zooms keep the charts rendering", {
    tag: ['@tracesCharts', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    for (let i = 0; i < 3; i++) {
      await pm.tracesPage.zoomOnMetricsPanel('Rate');
    }

    const rendered = await pm.tracesPage.waitForMetricsPanels();
    expect(rendered.length, 'Panels must still render after repeated zooms').toBeGreaterThan(0);

    const panelError = await pm.tracesPage.getMetricsPanelErrorText();
    expect(panelError, 'No RED panel may error after repeated zooms').toBe('');
  });

  test("P2: Chart rendering and zoom raise no page errors", {
    tag: ['@tracesCharts', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {

    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await searchAndShowCharts();
    await pm.tracesPage.zoomDurationBand();

    testLogger.info('Page errors during chart interaction', { pageErrors });
    expect(pageErrors, `Uncaught errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
