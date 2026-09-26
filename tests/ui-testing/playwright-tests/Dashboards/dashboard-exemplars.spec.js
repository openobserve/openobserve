// Dashboard exemplars E2E (openobserve#14894); fixtures are self-ingested so request counts only see this suite.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
  newRun,
  ingestExemplarFixtures,
  waitForExemplars,
  panel,
  createExemplarDashboard,
  getDashboardJson,
  deleteDashboard,
  deleteRunStreams,
  requestLog,
} = require('../utils/exemplar-fixtures.js');
import PageManager from "../../pages/page-manager";

const RUN = newRun();
const { HIST, COUNTER, SPARSE, NOTRACE, SPIKE } = RUN;

const ORG = process.env.ORGNAME || 'default';
const P99 = `histogram_quantile(0.99, sum by (le) (rate(${HIST}_bucket[5m])))`;
const P50 = `histogram_quantile(0.5, sum by (le) (rate(${HIST}_bucket[5m])))`;
const COUNTER_RATE = `sum(rate(${COUNTER}[5m]))`;

const dashboardUrl = (id, extra = '') =>
  `/web/dashboards/view?org_identifier=${ORG}&dashboard=${id}&folder=default${extra.includes('period=') ? '' : '&period=30m'}${extra}`;

test.describe('Dashboard exemplars', () => {
  test.describe.configure({ mode: 'serial' });

  let fixtures;
  let pm;
  const created = [];

  test.beforeAll(async () => {
    fixtures = await ingestExemplarFixtures(RUN, 32);
    const ready = await waitForExemplars(RUN);
    testLogger.info('Exemplars queryable', { ready });
  });

  test.afterAll(async () => {
    for (const id of created) await deleteDashboard(id);
    await deleteRunStreams(RUN);
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  async function makeDashboard(title, panels) {
    const id = await createExemplarDashboard(`${title} ${Date.now()}`, panels);
    created.push(id);
    return id;
  }

  test('off panel sends no query_exemplars', { tag: ['@dashboards', '@exemplars', '@P0', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-off', [panel('p_off', { title: 'Off', queries: [{ query: P99 }] })]);
    const log = requestLog(page);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await pm.dashboardExemplars.waitForChart('p_off');
    await pm.dashboardExemplars.refreshBtn.click();
    await pm.dashboardExemplars.waitForChart('p_off');
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash, '&period=45m'));
    await pm.dashboardExemplars.waitForChart('p_off');
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash, '&refresh=5s'));
    await page.waitForTimeout(7_000);
    expect(log.exemplars()).toHaveLength(0);
    await expect(pm.dashboardExemplars.points('p_off')).toHaveCount(0);
  });

  test('draws one marker per in-window exemplar', { tag: ['@dashboards', '@exemplars', '@P0', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-on', [panel('p_on', { title: 'On', queries: [{ query: P99 }], showExemplars: true })]);
    const log = requestLog(page);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await pm.dashboardExemplars.waitForChart('p_on');
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_on'), { timeout: 30_000 }).toBeGreaterThan(0);
    const requests = log.exemplars();
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('query')).toBe(P99);
    const start = Number(requests[0].searchParams.get('start'));
    const end = Number(requests[0].searchParams.get('end'));
    expect(end - start).toBeGreaterThan(1_700_000_000);
    expect(await pm.dashboardExemplars.markerCount('p_on')).toBe(fixtures.ids.length);
    expect(log.traceLookups()).toHaveLength(0);
  });

  test("two-query panel draws both queries' markers", { tag: ['@dashboards', '@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-two', [
      panel('p_distinct', { title: 'Distinct', queries: [{ query: P99 }, { query: COUNTER_RATE }], showExemplars: true }),
      panel('p_shared', { title: 'Shared', queries: [{ query: P99 }, { query: P50 }], showExemplars: true, layoutY: 14 }),
    ]);
    const log = requestLog(page);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_distinct'), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_shared'), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(log.exemplars()).toHaveLength(4);

    const distinct = await pm.dashboardExemplars.point('p_distinct').evaluateAll((els) => els.map((e) => e.getAttribute('data-query-index')));
    expect(distinct).toEqual(expect.arrayContaining(['0', '1']));

    const shared = await pm.dashboardExemplars.point('p_shared').evaluateAll((els) => els.map((e) => [e.getAttribute('data-query-index'), e.getAttribute('data-trace-id')]));
    expect(shared.every(([idx]) => idx === '0,1')).toBe(true);
    expect(new Set(shared.map(([, t]) => t)).size).toBe(shared.length);
  });

  test('count-rate panel rides markers on its line and shows values in the metric unit', { tag: ['@dashboards', '@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const COUNT_RATE = `sum(rate(${HIST}_count[5m]))`;
    const dash = await makeDashboard('exemplars-line', [
      panel('p_line', { title: 'Line', queries: [{ query: COUNT_RATE }], showExemplars: true, unit: 'custom', unitCustom: 'c/s' }),
      panel('p_value', { title: 'Value', queries: [{ query: P99 }], showExemplars: true, layoutY: 14 }),
    ]);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_line'), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_value'), { timeout: 30_000 }).toBeGreaterThan(0);

    const line = await pm.dashboardExemplars.point('p_line').evaluateAll((els) => els.map((e) => [e.getAttribute('data-placement'), e.getAttribute('data-clamped'), Number(e.getAttribute('data-y-px'))]));
    expect(line.every(([placement, clamped]) => placement === 'line' && clamped === null)).toBe(true);
    // Each line-mode marker sits on its query's drawn line; polled because the series may still be streaming in.
    await pm.dashboardExemplars.markerPoint('p_line');
    let offsets = [];
    await expect.poll(async () => {
      offsets = await pm.dashboardExemplars.lineMarkerOffsets('p_line');
      return Math.max(...offsets);
    }, { timeout: 15_000 }).toBeLessThanOrEqual(3);
    testLogger.info('line-mode marker offsets from the line (px)', { offsets });
    const value = await pm.dashboardExemplars.point('p_value').evaluateAll((els) => els.map((e) => e.getAttribute('data-placement')));
    expect(value.every((placement) => placement === 'value')).toBe(true);

    const point = await pm.dashboardExemplars.markerPoint('p_line', 3);
    await page.mouse.move(point.x, point.y);
    const shown = pm.dashboardExemplars.exemplarValue;
    await expect(shown).toContainText('ms');
    await expect(shown).not.toContainText('c/s');
  });

  test('exemplar 500 keeps series and offers Retry', { tag: ['@dashboards', '@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-500', [panel('p_err', { title: 'Err', queries: [{ query: P99 }], showExemplars: true })]);
    await page.route('**/prometheus/api/v1/query_exemplars**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'exemplar scan exploded' }) }));
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await pm.dashboardExemplars.waitForChart('p_err');
    const warning = pm.dashboardExemplars.errorTag('p_err');
    await expect(warning).toBeVisible({ timeout: 30_000 });
    await expect(pm.dashboardExemplars.noData).toHaveCount(0);
    await expect(pm.dashboardExemplars.toast).toHaveCount(0);
    await page.unroute('**/prometheus/api/v1/query_exemplars**');
    await warning.hover();
    await expect(pm.dashboardExemplars.exemplarErrorMessage).toContainText('exemplar scan exploded');
    await pm.dashboardExemplars.retry.click();
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_err'), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test('empty window shows indicator', { tag: ['@dashboards', '@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const query = `histogram_quantile(0.99, sum by (le) (rate(${SPARSE}_bucket[5m])))`;
    const dash = await makeDashboard('exemplars-empty', [panel('p_empty', { title: 'Empty', queries: [{ query }], showExemplars: true })]);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    const tag = pm.dashboardExemplars.emptyTag('p_empty');
    await expect(tag).toBeVisible({ timeout: 30_000 });
    await expect(tag).toHaveAttribute('aria-label', 'No exemplars in this time range');
  });

  test('hover opens exemplar card', { tag: ['@dashboards', '@exemplars', '@P0', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-hover', [panel('p_hover', { title: 'Hover', queries: [{ query: P99 }], showExemplars: true })]);
    const log = requestLog(page);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_hover'), { timeout: 30_000 }).toBeGreaterThan(0);
    const point = await pm.dashboardExemplars.markerPoint('p_hover');
    await page.mouse.move(point.x, point.y);
    const card = pm.dashboardExemplars.card;
    await expect(card).toBeVisible();
    await expect(pm.dashboardExemplars.exemplarValue).toContainText('ms');
    await expect(pm.dashboardExemplars.exemplarTraceId).toHaveText(point.traceId);
    await expect(pm.dashboardExemplars.exemplarLabelSpan).toHaveCount(0);
    await expect(pm.dashboardExemplars.exemplarSeriesLabels).toHaveCount(0);
    await expect(pm.dashboardExemplars.exemplarQuery.first()).toBeVisible();
    await expect.poll(() => log.traceLookups().length, { timeout: 10_000 }).toBe(1);
    await expect(card).not.toHaveAttribute('data-trace-state', 'checking', { timeout: 15_000 });
  });

  test('not-available card wraps inside itself and the viewport', { tag: ['@dashboards', '@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-unavailable', [panel('p_na', { title: 'NA', queries: [{ query: P99 }], showExemplars: true })]);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_na'), { timeout: 30_000 }).toBeGreaterThan(0);
    const missing = new Set(fixtures.missing.map((m) => m.traceId));
    const points = pm.dashboardExemplars.point('p_na');
    let index = -1;
    for (let i = (await points.count()) - 1; i >= 0; i--) {
      if (missing.has(await points.nth(i).getAttribute('data-trace-id'))) { index = i; break; }
    }
    expect(index).toBeGreaterThanOrEqual(0);
    const point = await pm.dashboardExemplars.markerPoint('p_na', index);
    await page.mouse.move(point.x, point.y);
    const card = pm.dashboardExemplars.card;
    await expect(card).toHaveAttribute('data-trace-state', 'not_available', { timeout: 20_000 });
    await expect(pm.dashboardExemplars.exemplarTraceUnavailable).toContainText('Trace not available');
    await expect(pm.dashboardExemplars.exemplarTraceId).toHaveText(point.traceId);
    const layout = await pm.dashboardExemplars.cardLayout();
    testLogger.info('not-available card layout', layout);
    expect(layout.scroll).toBeLessThanOrEqual(layout.client);
    expect(layout.overflowing).toBe(0);
    expect(layout.box.left).toBeGreaterThanOrEqual(0);
    expect(layout.box.top).toBeGreaterThanOrEqual(0);
    expect(layout.box.right).toBeLessThanOrEqual(layout.vw);
    expect(layout.box.bottom).toBeLessThanOrEqual(layout.vh);
  });

  test('marker click opens span', { tag: ['@dashboards', '@exemplars', '@P0', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-click', [panel('p_click', { title: 'Click', queries: [{ query: P99 }], showExemplars: true })]);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_click'), { timeout: 30_000 }).toBeGreaterThan(0);
    const point = await pm.dashboardExemplars.firstFoundMarker('p_click', fixtures.found);
    await page.mouse.move(point.x, point.y);
    await expect(pm.dashboardExemplars.card).toHaveAttribute('data-trace-state', 'found', { timeout: 20_000 });
    await page.mouse.click(point.x, point.y);
    await page.waitForURL(/traces\/trace-details|traceDetails|trace_id=/, { timeout: 20_000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('trace_id')).toBe(point.traceId);
    expect(url.searchParams.get('span_id')).toBe(point.spanId);
    await expect(pm.dashboardExemplars.traceSpansCount.first()).toBeVisible({ timeout: 30_000 });
    await expect(pm.dashboardExemplars.traceSidebar).toBeVisible();
  });

  test('Back restores dashboard, range and markers', { tag: ['@dashboards', '@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-back', [panel('p_back', { title: 'Back', queries: [{ query: P99 }] })]);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash, '&period=45m'));
    await pm.dashboardExemplars.waitForChart('p_back');
    const toggle = pm.dashboardExemplars.toggle('p_back');
    await pm.dashboardExemplars.container('p_back').hover();
    await toggle.click();
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_back'), { timeout: 30_000 }).toBeGreaterThan(0);
    const point = await pm.dashboardExemplars.firstFoundMarker('p_back', fixtures.found);
    await page.mouse.move(point.x, point.y);
    await expect(pm.dashboardExemplars.card).toHaveAttribute('data-trace-state', 'found', { timeout: 20_000 });
    await page.mouse.click(point.x, point.y);
    await page.waitForURL(/trace_id=/, { timeout: 20_000 });
    // TraceDetails redirects to the traces search if its own load is cut short, so Back waits for the trace to load.
    await expect(pm.dashboardExemplars.traceSpansCount.first()).toBeVisible({ timeout: 30_000 });
    await page.goBack();
    await page.waitForURL(/dashboards\/view/);
    expect(new URL(page.url()).searchParams.get('period')).toBe('45m');
    await expect(pm.dashboardExemplars.toggle('p_back')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_back'), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test('editor switch previews and persists', { tag: ['@dashboards', '@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-editor', [panel('p_edit', { title: 'Edit', queries: [{ query: P99 }] })]);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await pm.dashboardExemplars.editDropdown.click();
    await pm.dashboardExemplars.editPanelItem.click();
    // The editor normalises an API-built panel's query fields on open, so the preview starts out of date.
    const outdated = pm.dashboardExemplars.outdatedText();
    await expect(outdated).toBeVisible({ timeout: 15_000 });
    await pm.dashboardExemplars.applyBtn.click();
    await expect(outdated).toHaveCount(0, { timeout: 30_000 });
    await expect(pm.dashboardExemplars.points('p_edit')).toHaveCount(0);
    await pm.dashboardExemplars.sidebarCollapsed.click();
    await pm.dashboardExemplars.configSearchInput.fill('exemplars');
    const sw = pm.dashboardExemplars.showExemplarsSwitch;
    await expect(sw).toBeVisible({ timeout: 20_000 });
    await sw.click();
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_edit'), { timeout: 30_000 }).toBeGreaterThan(0);
    await pm.dashboardExemplars.saveBtn.click();
    await page.waitForURL(/dashboards\/view/);
    const saved = await getDashboardJson(dash);
    const inner = saved[`v${saved.version}`] || saved;
    const savedPanel = inner.tabs[0].panels.find((p) => p.id === 'p_edit');
    expect(savedPanel.config.show_exemplars).toBe(true);
    await expect(pm.dashboardExemplars.toggle('p_edit')).toHaveAttribute('aria-pressed', 'true');
  });

  test('header toggle overrides without saving', { tag: ['@dashboards', '@exemplars', '@P0', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-toggle', [panel('p_tog', { title: 'Tog', queries: [{ query: P99 }] })]);
    const log = requestLog(page);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await pm.dashboardExemplars.waitForChart('p_tog');
    const before = JSON.stringify(await getDashboardJson(dash));
    await pm.dashboardExemplars.container('p_tog').hover();
    const toggle = pm.dashboardExemplars.toggle('p_tog');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_tog'), { timeout: 30_000 }).toBeGreaterThan(0);
    const stored = await page.evaluate(([org, d]) => sessionStorage.getItem(`o2.exemplars.${org}.${d}.p_tog`), [ORG, dash]);
    expect(stored).toBe('1');
    expect(JSON.stringify(await getDashboardJson(dash))).toBe(before);

    await pm.dashboardExemplars.fullscreenBtn('p_tog').click();
    const viewToggle = pm.dashboardExemplars.viewpanelToggle;
    await expect(viewToggle).toHaveAttribute('aria-pressed', 'true');
    await viewToggle.click();
    await expect(viewToggle).toHaveAttribute('aria-pressed', 'false');
    await pm.dashboardExemplars.viewpanelCloseBtn.click();
    await expect(pm.dashboardExemplars.toggle('p_tog')).toHaveAttribute('aria-pressed', 'false');
    await expect(pm.dashboardExemplars.points('p_tog')).toHaveCount(0);
    expect(log.exemplars().length).toBeGreaterThan(0);
  });

  test('spike to span within budget', { tag: ['@dashboards', '@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-budget', [
      panel('p_b_off', { title: 'BudgetOff', queries: [{ query: P99 }] }),
      panel('p_b_on', { title: 'BudgetOn', queries: [{ query: P99 }], showExemplars: true, layoutY: 14 }),
    ]);
    let interactions = 0;
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await pm.dashboardExemplars.waitForChart('p_b_off');
    await pm.dashboardExemplars.container('p_b_off').hover();
    await pm.dashboardExemplars.toggle('p_b_off').click(); interactions++;
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_b_off'), { timeout: 30_000 }).toBeGreaterThan(0);
    let point = await pm.dashboardExemplars.firstFoundMarker('p_b_off', fixtures.found);
    await page.mouse.move(point.x, point.y); interactions++;
    await expect(pm.dashboardExemplars.card).toHaveAttribute('data-trace-state', 'found', { timeout: 20_000 });
    await page.mouse.click(point.x, point.y); interactions++;
    await page.waitForURL(/trace_id=/, { timeout: 20_000 });
    expect(interactions).toBeLessThanOrEqual(3);

    interactions = 0;
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_b_on'), { timeout: 30_000 }).toBeGreaterThan(0);
    point = await pm.dashboardExemplars.firstFoundMarker('p_b_on', fixtures.found);
    await page.mouse.move(point.x, point.y); interactions++;
    await expect(pm.dashboardExemplars.card).toHaveAttribute('data-trace-state', 'found', { timeout: 20_000 });
    await page.mouse.click(point.x, point.y); interactions++;
    await page.waitForURL(/trace_id=/, { timeout: 20_000 });
    expect(interactions).toBeLessThanOrEqual(2);
  });

  test('markers are distinct in light and dark', { tag: ['@dashboards', '@exemplars', '@P2', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-theme', [panel('p_theme', { title: 'Theme', queries: [{ query: P99 }], showExemplars: true })]);
    const luminance = ([r, g, b]) => {
      const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => localStorage.setItem('theme', t), theme);
      await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
      await expect.poll(() => pm.dashboardExemplars.markerCount('p_theme'), { timeout: 30_000 }).toBeGreaterThan(0);
      const point = await pm.dashboardExemplars.markerPoint('p_theme');
      const [marker, background] = await pm.dashboardExemplars.markerPixelColors('p_theme', point);
      testLogger.info('marker pixel', { theme, marker, background });
      expect(marker).not.toEqual(background);
      expect(contrast(marker, background)).toBeGreaterThanOrEqual(3);
    }
  });

  test("exemplar with no trace_id shows 'No trace_id on this exemplar'", { tag: ['@dashboards', '@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const NOTRACE_QUERY = `histogram_quantile(0.99, sum by (le) (rate(${NOTRACE}_bucket[5m])))`;
    const dash = await makeDashboard('exemplars-none', [panel('p_none', { title: 'None', queries: [{ query: NOTRACE_QUERY }], showExemplars: true })]);
    const log = requestLog(page);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_none'), { timeout: 30_000 }).toBeGreaterThan(0);
    const point = await pm.dashboardExemplars.markerPoint('p_none');
    await page.mouse.move(point.x, point.y);
    await expect(pm.dashboardExemplars.card).toHaveAttribute('data-trace-state', 'none', { timeout: 20_000 });
    await expect(pm.dashboardExemplars.exemplarNoTrace).toContainText('No trace_id on this exemplar');
    expect(log.traceLookups()).toHaveLength(0);
    await expect(pm.dashboardExemplars.exemplarOpenTrace).toHaveCount(0);
    await expect(pm.dashboardExemplars.exemplarOpenTraceUnverified).toHaveCount(0);
  });

  test('trace lookup failure shows the unverified button with its reason', { tag: ['@dashboards', '@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-unverified', [panel('p_unv', { title: 'Unverified', queries: [{ query: P99 }], showExemplars: true })]);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_unv'), { timeout: 30_000 }).toBeGreaterThan(0);

    const foundIds = new Set(fixtures.found.map((f) => f.traceId));
    const points = pm.dashboardExemplars.point('p_unv');
    const foundIndexes = [];
    for (let i = 0; i < (await points.count()); i++) {
      if (foundIds.has(await points.nth(i).getAttribute('data-trace-id'))) foundIndexes.push(i);
    }
    expect(foundIndexes.length).toBeGreaterThanOrEqual(2);

    // A 403 maps to `forbidden`; the forbidden verdict is cached per trace_id, so the timeout half uses a second marker.
    await page.route('**/traces/time_range**', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }));
    let point = await pm.dashboardExemplars.markerPoint('p_unv', foundIndexes[0]);
    await page.mouse.move(point.x, point.y);
    await expect(pm.dashboardExemplars.card).toHaveAttribute('data-trace-state', 'unverified', { timeout: 20_000 });
    const unverifiedButton = pm.dashboardExemplars.exemplarOpenTraceUnverified;
    await expect(unverifiedButton).toBeVisible();
    await expect(unverifiedButton).toHaveAttribute('data-reason', 'forbidden');
    await page.unroute('**/traces/time_range**');

    // Holding the response past the 8 s lookup cap trips the client abort, which maps to `timeout`.
    await page.route('**/traces/time_range**', async (route) => {
      await new Promise((r) => setTimeout(r, 9_000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) }).catch(() => {});
    });
    point = await pm.dashboardExemplars.markerPoint('p_unv', foundIndexes[1]);
    await page.mouse.move(point.x, point.y);
    await expect(pm.dashboardExemplars.card).toHaveAttribute('data-trace-state', 'unverified', { timeout: 15_000 });
    await expect(unverifiedButton).toHaveAttribute('data-reason', 'timeout');
    await page.unroute('**/traces/time_range**');
  });

  test('value above the y-extent clamps the marker to the top and shows the clamped note', { tag: ['@dashboards', '@exemplars', '@P2', '@all'] }, async ({ page }) => {
    const SPIKE_QUERY = `histogram_quantile(0.99, sum by (le) (rate(${SPIKE}_bucket[5m])))`;
    const dash = await makeDashboard('exemplars-clamp', [panel('p_clamp', { title: 'Clamp', queries: [{ query: SPIKE_QUERY }], showExemplars: true })]);
    await pm.dashboardExemplars.openDashboard(dashboardUrl(dash));
    await expect.poll(() => pm.dashboardExemplars.markerCount('p_clamp'), { timeout: 30_000 }).toBeGreaterThan(0);
    const clamped = await pm.dashboardExemplars.clampedPoints('p_clamp').evaluateAll((els) => els.map((e) => e.getAttribute('data-clamped')));
    expect(clamped).toContain('top');
    const point = await pm.dashboardExemplars.markerPoint('p_clamp', 0);
    await page.mouse.move(point.x, point.y);
    await expect(pm.dashboardExemplars.card).toBeVisible();
    await expect(pm.dashboardExemplars.exemplarClampedNote).toContainText('Above the chart range');
  });
});
