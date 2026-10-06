// tracesTriageLoop.spec.js — select spans on a RED chart, compare them in Drill down, filter, repeat.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');

const USER_FILTER = "duration >= '1ms'";
const DURATION_UNIT_US = { us: 1, ms: 1000, s: 1000000 };
const MINUTE_US = 60 * 1000000;
const HOUR_US = 60 * MINUTE_US;

function decodedSqlOf(request) {
  if (request.method() !== 'POST' || !/_search/.test(request.url())) return null;
  const body = request.postDataJSON?.() ?? null;
  const query = body?.query ?? {};
  if (typeof query.sql !== 'string') return null;
  const base64 = body.encoding === 'base64' || query.encoding === 'base64';
  return {
    sql: base64 ? Buffer.from(query.sql, 'base64').toString('utf8') : query.sql,
    start: query.start_time,
    end: query.end_time,
  };
}

// The comparison sends its own counts and LIMIT 4000 samples; nothing else does.
const isComparison = (q) => /^SELECT count\(\*\) AS n FROM/.test(q.sql) || /LIMIT 4000$/.test(q.sql);
const isCount = (q) => /^SELECT count\(\*\) AS n FROM/.test(q.sql);
// The table search: spans mode posts a base64 `SELECT *` SQL.
const isTableSearch = (q) => /^SELECT \* FROM/.test(q.sql);

// The band's bounds in µs as the SQL writes them; a missing side is absent.
function bandSql(editorBand) {
  const toUs = (m) => (m ? Number(m[1]) * DURATION_UNIT_US[m[2]] : null);
  const lo = toUs(editorBand.match(/duration >= '(\d+)(us|ms|s)'/));
  const hi = toUs(editorBand.match(/duration < '(\d+)(us|ms|s)'/));
  return [lo ? `duration >= ${lo}` : '', hi !== null ? `duration < ${hi}` : ''].filter(Boolean).join(' AND ');
}

test.describe('Traces triage loop', () => {
  let pm;
  let queries;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    try {
      await ingestTraces(page, 6, { forceScenario: 'error' });
      await ingestTraces(page, 10, { forceScenario: 'success' });
    } catch (e) {
      testLogger.warn('Trace seeding failed (continuing)', { error: e.message });
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    queries = [];
    page.on('request', (r) => {
      const q = decodedSqlOf(r);
      if (q) queries.push(q);
    });
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle');
    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.isStreamSelectVisible();
    await pm.tracesPage.selectTraceStream('default');
    await page.waitForTimeout(2000);
    await pm.tracesPage.switchToSpansMode();
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  async function searchWith(filter, range = '15m') {
    await pm.tracesPage.setTimeRange(range);
    expect(await pm.tracesPage.typeTraceQuery(filter), 'Filter must land in the editor').toBeTruthy();
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();
    expect(await pm.tracesPage.ensureMetricsDashboardVisible(), 'RED charts must be visible').toBeTruthy();
    expect((await pm.tracesPage.waitForMetricsPanels()).includes('Duration'), 'Heatmap must render').toBeTruthy();
    // A drag while the charts still re-render after the search is dropped.
    await pm.tracesPage.page.waitForTimeout(2000);
  }

  for (const live of [true, false]) {
    test(`P1: box → Drill down → filter, then box again (live mode ${live ? 'on' : 'off'})`, {
      tag: ['@tracesTriageLoop', '@traces', '@functional', '@P1', '@all'],
    }, async ({ page }) => {
      test.setTimeout(240000);
      const liveSet = await pm.tracesPage.setLiveMode(live);
      test.skip(live && !liveSet, 'auto_query_enabled is off here, so live mode cannot be turned on');
      await searchWith(USER_FILTER);
      const preBox = queries.filter(isTableSearch).at(-1);

      // Step 2: box; manual mode sends no table search for it.
      const beforeBox = queries.length;
      expect(await pm.tracesPage.zoomDurationBand(), 'Heatmap must accept the box drag').toBeTruthy();
      await page.waitForTimeout(2000);
      const editor = (await pm.tracesPage.getQueryEditorContent()).trim();
      expect(editor.startsWith(`(${USER_FILTER}) and `), `Editor keeps the user filter: ${editor}`).toBeTruthy();
      const band = bandSql(editor.slice(`(${USER_FILTER}) and `.length));
      if (!live) {
        expect(queries.slice(beforeBox).filter(isTableSearch), 'Manual mode must not search on a box').toHaveLength(0);
      }

      // Step 3: Drill down runs on the pending selection, without Run.
      const beforeOpen = queries.length;
      expect(await pm.tracesPage.openComparison()).toBe(pm.tracesPage.comparisonPage);
      const opened = queries.slice(beforeOpen).filter(isComparison);
      const counts = opened.filter(isCount);
      const samples = opened.filter((q) => !isCount(q));
      testLogger.info('Comparison requests', { opened: opened.map((q) => q.sql.slice(0, 200)) });
      expect(counts).toHaveLength(2);
      expect(samples).toHaveLength(2);
      const selection = samples.find((q) => !q.sql.includes('NOT ('));
      const baseline = samples.find((q) => q.sql.includes('NOT ('));
      expect(selection.sql).toContain(band);
      expect(selection.sql).toContain(`_timestamp >= ${selection.start} AND _timestamp < ${selection.end}`);
      expect(baseline.sql).toContain(band);
      for (const q of samples) {
        expect(q.sql).toMatch(/duration >= 1000\b/);
        expect(q.sql).toMatch(/LIMIT 4000$/);
      }
      for (const c of counts) {
        const own = samples.find((s) => s.sql.includes('NOT (') === c.sql.includes('NOT ('));
        expect([c.start, c.end], 'Each count runs over its own population window').toEqual([own.start, own.end]);
      }

      // Step 4: cards are ranked.
      await expect(page.locator(pm.tracesPage.comparisonPage)).toBeVisible();
      const cards = await pm.tracesPage.getComparisonCards();
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) expect(cards[0].score).toBeGreaterThanOrEqual(card.score);

      // Step 5: the "just before" baseline refetches only its own count and sample.
      const beforeToggle = queries.length;
      await page.locator(pm.tracesPage.comparisonBaselineBefore).click();
      await expect(page.locator(pm.tracesPage.comparisonPage)).toBeVisible({ timeout: 120000 });
      await page.waitForTimeout(1000);
      const toggled = queries.slice(beforeToggle).filter(isComparison);
      expect(toggled).toHaveLength(2);
      expect(toggled.filter(isCount)).toHaveLength(1);
      expect(toggled.find((q) => !isCount(q)).end).toBe(selection.start);

      // Step 6: filter to the top value — closes the page, restores the range, searches (manual mode too).
      const beforeApply = queries.length;
      const top = (await pm.tracesPage.getComparisonCards())[0];
      await pm.tracesPage.includeFirstComparisonValue(top.name);
      await expect(page.locator(pm.tracesPage.comparisonPage)).toBeHidden({ timeout: 15000 });
      await page.waitForTimeout(2000);
      const applied = (await pm.tracesPage.getQueryEditorContent()).trim();
      expect(applied.startsWith(`(${USER_FILTER}) and `), `Editor after apply: ${applied}`).toBeTruthy();
      expect(applied).toContain(top.name);
      const tableAfter = queries.slice(beforeApply).filter(isTableSearch);
      expect(tableAfter.length, 'Applying a value must search').toBeGreaterThan(0);
      const restored = tableAfter.at(-1);
      // A relative range is re-anchored to "now" by each search, so allow a few seconds of drift.
      expect(Math.abs(restored.start - preBox.start)).toBeLessThan(10000000);
      expect(Math.abs(restored.end - preBox.end)).toBeLessThan(10000000);

      // Step 7: the heatmap is back and accepts another box.
      expect((await pm.tracesPage.waitForMetricsPanels()).includes('Duration')).toBeTruthy();
      expect(await pm.tracesPage.zoomDurationBand()).toBeTruthy();
      await page.waitForTimeout(1500);
      expect((await pm.tracesPage.getQueryEditorContent()).trim()).toMatch(/duration (>=|<) '\d+(us|ms|s)'$/);
      if (live) await pm.tracesPage.setLiveMode(false);
    });
  }

  // The box sits late in the range, where the generator's data is, and more than 3 h from either end.
  test('P2: the outside baseline is capped to 3 h either side of a box in a 24 h range', {
    tag: ['@tracesTriageLoop', '@traces', '@functional', '@P2', '@all'],
  }, async ({ page }) => {
    test.setTimeout(300000);
    await searchWith('', '24h');
    expect(
      await pm.tracesPage.zoomOnMetricsPanel('Duration', { startRatio: 0.8, endRatio: 0.84, yStartRatio: 0.15, yEndRatio: 0.85 }),
    ).toBeTruthy();
    await page.waitForTimeout(2000);
    const beforeOpen = queries.length;
    expect(await pm.tracesPage.openComparison()).toBe(pm.tracesPage.comparisonPage);
    const samples = queries.slice(beforeOpen).filter((q) => isComparison(q) && !isCount(q));
    const selection = samples.find((q) => !q.sql.includes('NOT ('));
    const baseline = samples.find((q) => q.sql.includes('NOT ('));
    expect(baseline.end - baseline.start).toBeLessThanOrEqual(6 * HOUR_US + (selection.end - selection.start));
    await expect(page.locator(pm.tracesPage.comparisonSampleNote)).toContainText('up to 3 h either side');
  });

  test('P1: an Errors brush compares error spans with the rest of its window', {
    tag: ['@tracesTriageLoop', '@traces', '@functional', '@P1', '@all'],
  }, async ({ page }) => {
    test.setTimeout(240000);
    await searchWith('');
    const preBox = queries.filter(isTableSearch).at(-1);
    expect(await pm.tracesPage.zoomOnMetricsPanel('Errors')).toBeTruthy();
    await page.waitForTimeout(2000);
    const beforeOpen = queries.length;
    expect(await pm.tracesPage.openComparison()).toBe(pm.tracesPage.comparisonPage);
    const samples = queries.slice(beforeOpen).filter((q) => isComparison(q) && !isCount(q));
    const selection = samples.find((q) => q.sql.includes("span_status = 'ERROR'") && !q.sql.includes('COALESCE'));
    const baseline = samples.find((q) => q.sql.includes("COALESCE(span_status, '') != 'ERROR'"));
    expect(selection, 'The selection samples error spans').toBeTruthy();
    expect(baseline, 'The baseline samples the window without errors').toBeTruthy();
    expect([baseline.start, baseline.end]).toEqual([selection.start, selection.end]);
    // A brush value is already the picker's wall clock: a second zone shift would move it hours outside the range.
    expect(selection.start).toBeGreaterThanOrEqual(preBox.start - 1000000);
    expect(selection.end).toBeLessThanOrEqual(preBox.end + 1000000);
  });

  test('P1: a Rate brush compares its window with the rest of the range', {
    tag: ['@tracesTriageLoop', '@traces', '@functional', '@P1', '@all'],
  }, async ({ page }) => {
    test.setTimeout(240000);
    await searchWith('');
    expect(await pm.tracesPage.zoomOnMetricsPanel('Rate')).toBeTruthy();
    await page.waitForTimeout(2000);
    const beforeOpen = queries.length;
    expect(await pm.tracesPage.openComparison()).toBe(pm.tracesPage.comparisonPage);
    const samples = queries.slice(beforeOpen).filter((q) => isComparison(q) && !isCount(q));
    const selection = samples.find((q) => !q.sql.includes('NOT ('));
    const baseline = samples.find((q) => q.sql.includes('NOT ('));
    const where = selection.sql.split(' WHERE ')[1];
    expect(where).not.toMatch(/duration (>=|<)/);
    expect(where).not.toContain('span_status');
    expect(baseline.sql).toContain('NOT (_timestamp >= ');
  });

  test('P2: Drill down without a selection asks for one', {
    tag: ['@tracesTriageLoop', '@traces', '@functional', '@P2', '@all'],
  }, async () => {
    await searchWith('');
    expect(await pm.tracesPage.openComparison()).toBe(pm.tracesPage.comparisonNoSelection);
  });
});

test.describe('Traces triage loop across time zones', () => {
  test.use({ timezoneId: 'UTC' });

  test('P2: an Errors brush under an Asia/Kolkata app zone keeps the brushed window', {
    tag: ['@tracesTriageLoop', '@traces', '@functional', '@P2', '@all'],
  }, async ({ page }) => {
    test.setTimeout(240000);
    const queries = [];
    page.on('request', (r) => {
      const q = decodedSqlOf(r);
      if (q) queries.push(q);
    });
    await page.addInitScript(() => localStorage.setItem('timezone', 'Asia/Kolkata'));
    await navigateToBase(page);
    const pm = new PageManager(page);
    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.isStreamSelectVisible();
    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.switchToSpansMode();
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();
    await pm.tracesPage.waitForMetricsPanels();
    // A drag while the charts still re-render after the search is dropped.
    await page.waitForTimeout(2000);
    const preBox = queries.filter(isTableSearch).at(-1);
    expect(await pm.tracesPage.zoomOnMetricsPanel('Errors')).toBeTruthy();
    await page.waitForTimeout(2000);
    const beforeOpen = queries.length;
    expect(await pm.tracesPage.openComparison()).toBe(pm.tracesPage.comparisonPage);
    const selection = queries
      .slice(beforeOpen)
      .find((q) => isComparison(q) && !isCount(q) && !q.sql.includes('COALESCE'));
    expect(selection.start).toBeGreaterThanOrEqual(preBox.start - 1000000);
    expect(selection.end).toBeLessThanOrEqual(preBox.end + 1000000);
  });
});
