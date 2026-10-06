// tracesCharts.spec.js — RED metrics charts: rendering, zoom, and the Insights filter handoff.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');

// A heatmap box writes its half-open band with exact 1-2-5 bounds.
const DURATION_FILTER_PATTERN = /duration\s*(>=|<)\s*'\d+(us|ms|s)'/;
const HEATMAP_BAND_PATTERN =
  /^duration >= '\d+(us|ms|s)'( and duration < '\d+(us|ms|s)')?$|^duration < '\d+(us|ms|s)'$/;
const USER_DURATION_FILTER = "duration >= '1ms'";
const DURATION_UNIT_US = { us: 1, ms: 1000, s: 1000000 };
// The Insights query fails server-side when that string is not decoded back to µs.
const CAST_ERROR_PATTERN = /Cannot cast string|simplify_expressions|Arrow error/i;
const RED_PANELS = ['Rate', 'Errors', 'Duration'];
// Insights tab slugs from TracesAnalysisDashboard.vue.
const ANALYSIS_TABS = ['volume', 'error', 'duration'];

test.describe("Traces Charts testcases", () => {
  let pm;

  // The Errors panel plots an empty series unless the window holds at least one error span.
  // Seeded spans are stamped "now" in the shared `default` stream, so they age out and need no teardown.
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

  // Regression guard for #14534, fixed by #14542: Insights now decodes the duration
  // filter back to microseconds instead of forwarding `duration <= '5.62s'` to SQL.
  test("P0: Duration zoom then Insights renders without a cast error (#14534)", {
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

    // The cast error hit every dimension panel on every tab, so all three are checked.
    // A zoomed band can match nothing, so this asserts on errors, not on chart counts.
    for (const tab of ANALYSIS_TABS) {
      const states = await pm.tracesPage.openAnalysisTab(tab);
      testLogger.info(`Insights ${tab} tab panels after duration zoom`, states);

      expect(states.errorText, `${tab} tab must not fail casting the duration filter`)
        .not.toMatch(CAST_ERROR_PATTERN);
      expect(states.errors, `${tab} tab must render no errored dimension panel`).toBe(0);
      // A narrow zoom can legitimately leave a dimension empty; an unresolved panel cannot.
      expect(states.charts + states.noData, `${tab} tab must resolve every panel`)
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

    let charted = 0;
    for (const tab of ANALYSIS_TABS) {
      const states = await pm.tracesPage.openAnalysisTab(tab);
      testLogger.info(`Insights ${tab} tab panels`, states);

      expect(states.panels, `${tab} tab must render dimension panels`).toBeGreaterThan(0);
      expect(states.errors, `${tab} tab panel error: ${states.errorText}`).toBe(0);
      // The Errors tab is empty when the window holds no error spans; that is not a failure.
      expect(states.charts + states.noData, `${tab} tab must resolve every panel`)
        .toBe(states.panels);
      charted += states.charts;
    }
    expect(charted, 'At least one dimension must chart across the three tabs').toBeGreaterThan(0);

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
    await expect
      .poll(() => pm.tracesPage.getTimeRangeLabel(), { timeout: 10000 })
      .toContain('1 Hour');
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
    expect(await pm.tracesPage.isErrorOnlyFilterActive(), 'Error-only filter must be active')
      .toBeTruthy();
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

    await pm.tracesPage.switchToSpansMode();
    await page.waitForTimeout(3000);

    const rendered = await pm.tracesPage.waitForMetricsPanels();
    expect(rendered.length, 'Panels must re-render in spans mode').toBeGreaterThan(0);

    const panelError = await pm.tracesPage.getMetricsPanelErrorText();
    expect(panelError, 'No RED panel may error in spans mode').toBe('');
  });

  // ─── P2 — Negative scenarios ─────────────────────────────────────────────────

  test("P2: A full reload auto-selects the default stream instead of the no-stream state", {
    tag: ['@tracesCharts', '@traces', '@negative', '@P2', '@all']
  }, async ({ page }) => {

    // A full reload drops the in-memory stream selection; loadStreamLists then
    // falls back to the `default` stream rather than leaving the page empty.
    await pm.tracesPage.navigateToTracesUrl();
    await page.waitForTimeout(3000);

    await pm.tracesPage.expectNoStreamCardHidden(
      'The no-stream state must not be shown when a default stream exists'
    );

    const selectedStream = await pm.tracesPage.getSelectedStreamName();
    expect(selectedStream, 'The default stream must be selected after a reload').toBe('default');

    const panelError = await pm.tracesPage.getMetricsPanelErrorText();
    expect(panelError, 'The auto-selected stream must not surface a panel error').toBe('');

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

  // Regression guard for o2-enterprise#2643: a cancelled search's late error
  // callback used to overwrite errorMsg after a newer search already
  // succeeded, leaving the charts unmounted forever. Fixed by guarding the
  // error handler with the same staleness check the data handler already had.
  test("P0: Charts return once a rejected query is cleared (o2-enterprise#2643)", {
    tag: ['@tracesCharts', '@traces', '@regression', '@P0', '@all']
  }, async ({ page }) => {

    await searchAndShowCharts();

    expect(await pm.tracesPage.typeTraceQuery("duration >= 'abc'"), 'Bad query must land').toBeTruthy();
    await pm.tracesPage.runQuery();
    await page.waitForTimeout(6000);
    expect(await pm.tracesPage.isSearchErrorVisible(), 'The query must be rejected').toBeTruthy();

    expect(await pm.tracesPage.clearTraceQueryByKeyboard(), 'Editor must end up empty').toBeTruthy();
    // CodeQueryEditor commits Monaco's content to the app after a 500ms debounce;
    // clicking Run before that flushes re-submits the query it just replaced.
    // No real user clears and clicks inside that window.
    await page.waitForTimeout(600);
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

  // ─── Heatmap box → span table → Drill down (triage loop) ─────────────────

  // The table search: traces mode posts `filter`, spans mode posts a base64 `SELECT *` SQL.
  const tableFilterOf = (request) => {
    if (request.method() !== 'POST' || !/_search/.test(request.url())) return null;
    const body = request.postDataJSON?.() ?? null;
    if (!body) return null;
    if (typeof body.filter === 'string' && body.stream_name) return body.filter;
    const sql = decodedSqlOf(body);
    return sql && /^SELECT \* FROM/.test(sql) ? sql : null;
  };

  function decodedSqlOf(body) {
    const query = body?.query ?? {};
    const sql = query.sql ?? body?.sql;
    if (typeof sql !== 'string') return null;
    const base64 = body.encoding === 'base64' || query.encoding === 'base64';
    return base64 ? Buffer.from(sql, 'base64').toString('utf8') : sql;
  }

  const comparisonSqlOf = (request) => {
    if (request.method() !== 'POST' || !/_search/.test(request.url())) return null;
    const sql = decodedSqlOf(request.postDataJSON?.() ?? null);
    return sql && sql.includes("'Selected' AS series") ? sql : null;
  };

  // The band's bounds in µs; a missing side is 0 below and unbounded above.
  const bandBoundsUs = (band) => {
    const toUs = (m) => (m ? Number(m[1]) * DURATION_UNIT_US[m[2]] : null);
    return {
      lo: toUs(band.match(/duration >= '(\d+)(us|ms|s)'/)) ?? 0,
      hi: toUs(band.match(/duration < '(\d+)(us|ms|s)'/)),
    };
  };

  for (const live of [false, true]) {
    test(`P1: A heatmap box filters the table and Drill down compares it to the pre-box filter (live mode ${live ? 'on' : 'off'})`, {
      tag: ['@tracesCharts', '@traces', '@functional', '@P1', '@all']
    }, async ({ page }) => {
      test.setTimeout(180000);

      await searchAndShowCharts();
      const liveModeSet = await pm.tracesPage.setLiveMode(live);
      test.skip(!liveModeSet, 'auto_query_enabled is off on this environment, so live mode cannot be turned on');

      expect(await pm.tracesPage.typeTraceQuery(USER_DURATION_FILTER), 'User filter must land').toBeTruthy();
      await pm.tracesPage.runTraceSearch();
      await pm.tracesPage.waitForTraceSearchResults();
      expect((await pm.tracesPage.waitForMetricsPanels()).includes('Duration'), 'Heatmap must render').toBeTruthy();

      const tableRequest = page.waitForRequest((r) => tableFilterOf(r) !== null, { timeout: 45000 });
      expect(await pm.tracesPage.zoomDurationBand(), 'Heatmap must accept the box drag').toBeTruthy();
      if (!live) await pm.tracesPage.runQuery();

      // Editor: the user condition is kept, grouped, and intersected with the band.
      const editor = (await pm.tracesPage.getQueryEditorContent()).trim();
      testLogger.info('Query editor after the heatmap box', { editor, live });
      const prefix = `(${USER_DURATION_FILTER}) and `;
      expect(editor.startsWith(prefix), `Editor must keep the user filter: ${editor}`).toBeTruthy();
      const band = editor.slice(prefix.length);
      expect(band).toMatch(HEATMAP_BAND_PATTERN);
      const { lo, hi } = bandBoundsUs(band);

      // Table: both the user condition and the band reach the search, decoded to µs.
      const tableFilter = tableFilterOf(await tableRequest);
      testLogger.info('Table search filter after the box', { tableFilter });
      expect(tableFilter).toMatch(/duration >= 1000\b/);
      if (lo) expect(tableFilter).toMatch(new RegExp(`duration >= ${lo}\\b`));
      if (hi !== null) expect(tableFilter).toMatch(new RegExp(`duration < ${hi}\\b`));
      await pm.tracesPage.waitForTraceSearchResults();

      // Drill down: Selected is the box under the pre-box filter, Baseline the pre-box filter alone.
      const comparisonRequest = page.waitForRequest((r) => comparisonSqlOf(r) !== null, { timeout: 60000 });
      const comparisonResponse = page.waitForResponse(
        (r) => comparisonSqlOf(r.request()) !== null,
        { timeout: 60000 }
      );
      await pm.tracesPage.clickInsightsButton();
      await pm.tracesPage.waitForAnalysisDashboardLoad();

      const sql = comparisonSqlOf(await comparisonRequest);
      testLogger.info('Drill-down comparison SQL', { sql });
      const selected = sql.split(/\bUNION\b/).find((p) => p.includes("'Selected' AS series"));
      const baseline = sql.split(/\bUNION\b/).find((p) => p.includes("'Baseline' AS series"));
      const selectedBand = `duration >= ${lo} AND duration < ${hi ?? Number.MAX_SAFE_INTEGER}`;
      expect(selected).toContain(selectedBand);
      expect(selected).toMatch(/duration >= 1000\b/);
      expect(selected).toContain('_timestamp < ');
      expect(baseline).toMatch(/duration >= 1000\b/);
      expect(baseline).not.toContain(selectedBand);
      if (hi !== null) expect(baseline).not.toMatch(new RegExp(`duration < ${hi}\\b`));

      const responseText = await (await comparisonResponse).text();
      expect(responseText, 'Comparison hits must carry Selected rows').toContain('"series":"Selected"');
      expect(responseText, 'Comparison hits must carry Baseline rows').toContain('"series":"Baseline"');

      await pm.tracesPage.closeAnalysisDashboard();
      if (live) await pm.tracesPage.setLiveMode(false);
    });
  }
});
