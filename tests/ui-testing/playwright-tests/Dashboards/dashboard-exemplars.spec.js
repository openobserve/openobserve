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

const RUN = newRun();
const { HIST, COUNTER, SPARSE } = RUN;

const ORG = process.env.ORGNAME || 'default';
const P99 = `histogram_quantile(0.99, sum by (le) (rate(${HIST}_bucket[5m])))`;
const P50 = `histogram_quantile(0.5, sum by (le) (rate(${HIST}_bucket[5m])))`;
const COUNTER_RATE = `sum(rate(${COUNTER}[5m]))`;

const sel = {
  container: (id) => `[data-test="dashboard-panel-container"][data-test-panel-id="${id}"]`,
  toggle: '[data-test="dashboard-panel-exemplars-toggle"]',
  points: '[data-test="dashboard-panel-exemplar-points"]',
  point: '[data-test="dashboard-panel-exemplar-point"]',
  card: '[data-test="dashboard-panel-exemplar-tooltip"]',
  empty: '[data-test="dashboard-panel-exemplars-empty"]',
  error: '[data-test="dashboard-panel-exemplars-error"]',
  retry: '[data-test="dashboard-panel-exemplars-retry"]',
  openTrace: '[data-test="dashboard-panel-exemplar-open-trace"]',
};

const dashboardUrl = (id, extra = '') =>
  `/web/dashboards/view?org_identifier=${ORG}&dashboard=${id}&folder=default${extra.includes('period=') ? '' : '&period=30m'}${extra}`;

async function openDashboard(page, id, extra = '') {
  await page.goto(dashboardUrl(id, extra));
  await page.locator('[data-test="dashboard-panel-container"]').first().waitFor({ state: 'visible', timeout: 30_000 });
}

async function waitForChart(page, panelId) {
  await expect.poll(async () =>
    page.locator(`${sel.container(panelId)} [_echarts_instance_]`).count(), { timeout: 30_000 }).toBeGreaterThan(0);
}

async function markerCount(page, panelId) {
  const list = page.locator(`${sel.container(panelId)} ${sel.points}`);
  if (!(await list.count())) return 0;
  return Number(await list.getAttribute('data-count'));
}

/** Absolute page coordinates of a marker, from the hidden list's canvas-relative pixels. */
async function markerPoint(page, panelId, index = 0) {
  const point = page.locator(`${sel.container(panelId)} ${sel.point}`).nth(index);
  // Positions are recomputed after each chart paint, so wait until two reads agree.
  let last = '';
  await expect.poll(async () => {
    const now = `${await point.getAttribute('data-x-px')},${await point.getAttribute('data-y-px')}`;
    const stable = now === last;
    last = now;
    return stable;
  }, { timeout: 15_000, intervals: [750] }).toBe(true);
  const x = Number(await point.getAttribute('data-x-px'));
  const y = Number(await point.getAttribute('data-y-px'));
  const box = await page.locator(`${sel.container(panelId)} [_echarts_instance_]`).first().boundingBox();
  return { x: box.x + x, y: box.y + y, traceId: await point.getAttribute('data-trace-id'), spanId: await point.getAttribute('data-span-id') };
}

async function firstFoundMarker(page, panelId, found) {
  const ids = new Set(found.map((f) => f.traceId));
  const points = page.locator(`${sel.container(panelId)} ${sel.point}`);
  const n = await points.count();
  for (let i = 0; i < n; i++) {
    if (ids.has(await points.nth(i).getAttribute('data-trace-id'))) return markerPoint(page, panelId, i);
  }
  throw new Error('no marker points at an ingested trace');
}

test.describe('Dashboard exemplars', () => {
  test.describe.configure({ mode: 'serial' });

  let fixtures;
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
  });

  async function makeDashboard(title, panels) {
    const id = await createExemplarDashboard(`${title} ${Date.now()}`, panels);
    created.push(id);
    return id;
  }

  test('off panel sends no query_exemplars', { tag: ['@exemplars', '@P0', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-off', [panel('p_off', { title: 'Off', queries: [{ query: P99 }] })]);
    const log = requestLog(page);
    await openDashboard(page, dash);
    await waitForChart(page, 'p_off');
    await page.locator('[data-test="dashboard-refresh-btn"]').click();
    await waitForChart(page, 'p_off');
    await openDashboard(page, dash, '&period=45m');
    await waitForChart(page, 'p_off');
    await openDashboard(page, dash, '&refresh=5s');
    await page.waitForTimeout(7_000);
    expect(log.exemplars()).toHaveLength(0);
    await expect(page.locator(`${sel.container('p_off')} ${sel.points}`)).toHaveCount(0);
  });

  test('draws one marker per in-window exemplar', { tag: ['@exemplars', '@P0', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-on', [panel('p_on', { title: 'On', queries: [{ query: P99 }], showExemplars: true })]);
    const log = requestLog(page);
    await openDashboard(page, dash);
    await waitForChart(page, 'p_on');
    await expect.poll(() => markerCount(page, 'p_on'), { timeout: 30_000 }).toBeGreaterThan(0);
    const requests = log.exemplars();
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('query')).toBe(P99);
    const start = Number(requests[0].searchParams.get('start'));
    const end = Number(requests[0].searchParams.get('end'));
    expect(end - start).toBeGreaterThan(1_700_000_000);
    expect(await markerCount(page, 'p_on')).toBeLessThanOrEqual(fixtures.ids.length);
    expect(log.traceLookups()).toHaveLength(0);
  });

  test("two-query panel draws both queries' markers", { tag: ['@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-two', [
      panel('p_distinct', { title: 'Distinct', queries: [{ query: P99 }, { query: COUNTER_RATE }], showExemplars: true }),
      panel('p_shared', { title: 'Shared', queries: [{ query: P99 }, { query: P50 }], showExemplars: true, layoutY: 14 }),
    ]);
    const log = requestLog(page);
    await openDashboard(page, dash);
    await expect.poll(() => markerCount(page, 'p_distinct'), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => markerCount(page, 'p_shared'), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(log.exemplars()).toHaveLength(4);

    const distinct = await page.locator(`${sel.container('p_distinct')} ${sel.point}`).evaluateAll((els) => els.map((e) => e.getAttribute('data-query-index')));
    expect(distinct).toEqual(expect.arrayContaining(['0', '1']));

    const shared = await page.locator(`${sel.container('p_shared')} ${sel.point}`).evaluateAll((els) => els.map((e) => [e.getAttribute('data-query-index'), e.getAttribute('data-trace-id')]));
    expect(shared.every(([idx]) => idx === '0,1')).toBe(true);
    expect(new Set(shared.map(([, t]) => t)).size).toBe(shared.length);
  });

  test('count-rate panel rides markers on its line and shows values in the metric unit', { tag: ['@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const COUNT_RATE = `sum(rate(${HIST}_count[5m]))`;
    const dash = await makeDashboard('exemplars-line', [
      panel('p_line', { title: 'Line', queries: [{ query: COUNT_RATE }], showExemplars: true, unit: 'custom', unitCustom: 'c/s' }),
      panel('p_value', { title: 'Value', queries: [{ query: P99 }], showExemplars: true, layoutY: 14 }),
    ]);
    await openDashboard(page, dash);
    await expect.poll(() => markerCount(page, 'p_line'), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => markerCount(page, 'p_value'), { timeout: 30_000 }).toBeGreaterThan(0);

    const line = await page.locator(`${sel.container('p_line')} ${sel.point}`).evaluateAll((els) => els.map((e) => [e.getAttribute('data-placement'), e.getAttribute('data-clamped'), Number(e.getAttribute('data-y-px'))]));
    expect(line.every(([placement, clamped]) => placement === 'line' && clamped === null)).toBe(true);
    // Each line-mode marker sits on its query's drawn line; polled because the series may still be streaming in.
    await markerPoint(page, 'p_line');
    let offsets = [];
    await expect.poll(async () => {
      const markers = await page.locator(`${sel.container('p_line')} ${sel.point}`).evaluateAll((els) => els.map((e) => [Number(e.getAttribute('data-y-px')), Number(e.getAttribute('data-x-px'))]));
      offsets = await page.locator(`${sel.container('p_line')} [data-test="chart-renderer"]`).evaluate((host, list) => {
        const chart = host.__vueParentComponent?.setupState?.chart;
        const all = chart?.getOption()?.series ?? [];
        const seriesIndex = all.findIndex((s) => s.type === 'line' && Array.isArray(s.data) && s.data.length > 1);
        if (seriesIndex < 0) return [Infinity];
        const pts = all[seriesIndex].data
          .filter((d) => d[1] !== null && d[1] !== undefined)
          .map((d) => chart.convertToPixel({ seriesIndex }, d))
          .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
          .map((p) => [p[0], p[1]])
          .sort((a, b) => a[0] - b[0]);
        if (pts.length < 2) return [Infinity];
        return list.map(([y, x]) => {
          const i = pts.findIndex((p) => p[0] >= x);
          if (i <= 0) return Math.abs(pts[i < 0 ? pts.length - 1 : 0][1] - y);
          const [a, b] = [pts[i - 1], pts[i]];
          return Math.abs(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]) - y);
        });
      }, markers);
      return Math.max(...offsets);
    }, { timeout: 15_000 }).toBeLessThanOrEqual(3);
    testLogger.info('line-mode marker offsets from the line (px)', { offsets });
    const value = await page.locator(`${sel.container('p_value')} ${sel.point}`).evaluateAll((els) => els.map((e) => e.getAttribute('data-placement')));
    expect(value.every((placement) => placement === 'value')).toBe(true);

    const point = await markerPoint(page, 'p_line', 3);
    await page.mouse.move(point.x, point.y);
    const shown = page.locator('[data-test="dashboard-panel-exemplar-value"]');
    await expect(shown).toContainText('ms');
    await expect(shown).not.toContainText('c/s');
  });

  test('exemplar 500 keeps series and offers Retry', { tag: ['@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-500', [panel('p_err', { title: 'Err', queries: [{ query: P99 }], showExemplars: true })]);
    await page.route('**/prometheus/api/v1/query_exemplars**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'exemplar scan exploded' }) }));
    await openDashboard(page, dash);
    await waitForChart(page, 'p_err');
    const warning = page.locator(`${sel.container('p_err')} ${sel.error}`);
    await expect(warning).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-test="no-data"]')).toHaveCount(0);
    await expect(page.locator('.o2-toast, [data-test="o-toast"]')).toHaveCount(0);
    await page.unroute('**/prometheus/api/v1/query_exemplars**');
    await warning.hover();
    await expect(page.locator('[data-test="dashboard-panel-exemplars-error-message"]')).toContainText('exemplar scan exploded');
    await page.locator(sel.retry).click();
    await expect.poll(() => markerCount(page, 'p_err'), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test('empty window shows indicator', { tag: ['@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const query = `histogram_quantile(0.99, sum by (le) (rate(${SPARSE}_bucket[5m])))`;
    const dash = await makeDashboard('exemplars-empty', [panel('p_empty', { title: 'Empty', queries: [{ query }], showExemplars: true })]);
    await openDashboard(page, dash);
    const tag = page.locator(`${sel.container('p_empty')} ${sel.empty}`);
    await expect(tag).toBeVisible({ timeout: 30_000 });
    await expect(tag).toHaveAttribute('aria-label', 'No exemplars in this time range');
  });

  test('hover opens exemplar card', { tag: ['@exemplars', '@P0', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-hover', [panel('p_hover', { title: 'Hover', queries: [{ query: P99 }], showExemplars: true })]);
    const log = requestLog(page);
    await openDashboard(page, dash);
    await expect.poll(() => markerCount(page, 'p_hover'), { timeout: 30_000 }).toBeGreaterThan(0);
    const point = await markerPoint(page, 'p_hover');
    await page.mouse.move(point.x, point.y);
    const card = page.locator(sel.card);
    await expect(card).toBeVisible();
    await expect(page.locator('[data-test="dashboard-panel-exemplar-value"]')).toContainText('ms');
    await expect(page.locator('[data-test="dashboard-panel-exemplar-trace-id"]')).toHaveText(point.traceId);
    await expect(page.locator('[data-test="dashboard-panel-exemplar-label-span_id"]')).toHaveCount(0);
    await expect(page.locator('[data-test="dashboard-panel-exemplar-series-labels"]')).toHaveCount(0);
    await expect(page.locator('[data-test="dashboard-panel-exemplar-query"]').first()).toBeVisible();
    await expect.poll(() => log.traceLookups().length, { timeout: 10_000 }).toBe(1);
    await expect(card).not.toHaveAttribute('data-trace-state', 'checking', { timeout: 15_000 });
  });

  test('not-available card wraps inside itself and the viewport', { tag: ['@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-unavailable', [panel('p_na', { title: 'NA', queries: [{ query: P99 }], showExemplars: true })]);
    await openDashboard(page, dash);
    await expect.poll(() => markerCount(page, 'p_na'), { timeout: 30_000 }).toBeGreaterThan(0);
    const missing = new Set(fixtures.missing.map((m) => m.traceId));
    const points = page.locator(`${sel.container('p_na')} ${sel.point}`);
    let index = -1;
    for (let i = (await points.count()) - 1; i >= 0; i--) {
      if (missing.has(await points.nth(i).getAttribute('data-trace-id'))) { index = i; break; }
    }
    expect(index).toBeGreaterThanOrEqual(0);
    const point = await markerPoint(page, 'p_na', index);
    await page.mouse.move(point.x, point.y);
    const card = page.locator(sel.card);
    await expect(card).toHaveAttribute('data-trace-state', 'not_available', { timeout: 20_000 });
    await expect(page.locator('[data-test="dashboard-panel-exemplar-trace-unavailable"]')).toContainText('Trace not available');
    await expect(page.locator('[data-test="dashboard-panel-exemplar-trace-id"]')).toHaveText(point.traceId);
    const layout = await card.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const overflowing = [...el.querySelectorAll('*')].filter((c) => c.getBoundingClientRect().right > box.right + 0.5).length;
      return { scroll: el.scrollWidth, client: el.clientWidth, overflowing, box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, vw: window.innerWidth, vh: window.innerHeight };
    });
    testLogger.info('not-available card layout', layout);
    expect(layout.scroll).toBeLessThanOrEqual(layout.client);
    expect(layout.overflowing).toBe(0);
    expect(layout.box.left).toBeGreaterThanOrEqual(0);
    expect(layout.box.top).toBeGreaterThanOrEqual(0);
    expect(layout.box.right).toBeLessThanOrEqual(layout.vw);
    expect(layout.box.bottom).toBeLessThanOrEqual(layout.vh);
  });

  test('marker click opens span', { tag: ['@exemplars', '@P0', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-click', [panel('p_click', { title: 'Click', queries: [{ query: P99 }], showExemplars: true })]);
    await openDashboard(page, dash);
    await expect.poll(() => markerCount(page, 'p_click'), { timeout: 30_000 }).toBeGreaterThan(0);
    const point = await firstFoundMarker(page, 'p_click', fixtures.found);
    await page.mouse.move(point.x, point.y);
    await expect(page.locator(sel.card)).toHaveAttribute('data-trace-state', 'found', { timeout: 20_000 });
    await page.mouse.click(point.x, point.y);
    await page.waitForURL(/traces\/trace-details|traceDetails|trace_id=/, { timeout: 20_000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('trace_id')).toBe(point.traceId);
    expect(url.searchParams.get('span_id')).toBe(point.spanId);
    await expect(page.locator('[data-test="trace-details-spans-count"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-test="trace-details-sidebar"]')).toBeVisible();
  });

  test('Back restores dashboard, range and markers', { tag: ['@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-back', [panel('p_back', { title: 'Back', queries: [{ query: P99 }] })]);
    await openDashboard(page, dash, '&period=45m');
    await waitForChart(page, 'p_back');
    const toggle = page.locator(`${sel.container('p_back')} ${sel.toggle}`);
    await page.locator(sel.container('p_back')).hover();
    await toggle.click();
    await expect.poll(() => markerCount(page, 'p_back'), { timeout: 30_000 }).toBeGreaterThan(0);
    const point = await firstFoundMarker(page, 'p_back', fixtures.found);
    await page.mouse.move(point.x, point.y);
    await expect(page.locator(sel.card)).toHaveAttribute('data-trace-state', 'found', { timeout: 20_000 });
    await page.mouse.click(point.x, point.y);
    await page.waitForURL(/trace_id=/, { timeout: 20_000 });
    // TraceDetails redirects to the traces search if its own load is cut short, so Back waits for the trace to load.
    await expect(page.locator('[data-test="trace-details-spans-count"]').first()).toBeVisible({ timeout: 30_000 });
    await page.goBack();
    await page.waitForURL(/dashboards\/view/);
    expect(new URL(page.url()).searchParams.get('period')).toBe('45m');
    await expect(page.locator(`${sel.container('p_back')} ${sel.toggle}`)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => markerCount(page, 'p_back'), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  test('editor switch previews and persists', { tag: ['@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-editor', [panel('p_edit', { title: 'Edit', queries: [{ query: P99 }] })]);
    await openDashboard(page, dash);
    await page.locator('[data-test="dashboard-edit-panel-Edit-dropdown"]').click();
    await page.locator('[data-test="dashboard-edit-panel"]').click();
    // The editor normalises an API-built panel's query fields on open, so the preview starts out of date.
    const outdated = page.getByText('Your chart is not up to date');
    await expect(outdated).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-test="dashboard-apply"]').click();
    await expect(outdated).toHaveCount(0, { timeout: 30_000 });
    expect(await page.locator(sel.points).count()).toBe(0);
    await page.locator('[data-test="panel-sidebar-header-collapsed"]').click();
    await page.locator('[data-test="dashboard-config-panel-search"] input').fill('exemplars');
    const sw = page.locator('[data-test="dashboard-config-show-exemplars"]');
    await expect(sw).toBeVisible({ timeout: 20_000 });
    await sw.click();
    await expect.poll(async () => {
      const list = page.locator(sel.points);
      return (await list.count()) ? Number(await list.first().getAttribute('data-count')) : 0;
    }, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.locator('[data-test="dashboard-panel-save"]').click();
    await page.waitForURL(/dashboards\/view/);
    const saved = await getDashboardJson(dash);
    const inner = saved[`v${saved.version}`] || saved;
    const savedPanel = inner.tabs[0].panels.find((p) => p.id === 'p_edit');
    expect(savedPanel.config.show_exemplars).toBe(true);
    await expect(page.locator(`${sel.container('p_edit')} ${sel.toggle}`)).toHaveAttribute('aria-pressed', 'true');
  });

  test('header toggle overrides without saving', { tag: ['@exemplars', '@P0', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-toggle', [panel('p_tog', { title: 'Tog', queries: [{ query: P99 }] })]);
    const log = requestLog(page);
    await openDashboard(page, dash);
    await waitForChart(page, 'p_tog');
    const before = JSON.stringify(await getDashboardJson(dash));
    await page.locator(sel.container('p_tog')).hover();
    const toggle = page.locator(`${sel.container('p_tog')} ${sel.toggle}`);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => markerCount(page, 'p_tog'), { timeout: 30_000 }).toBeGreaterThan(0);
    const stored = await page.evaluate(([org, d]) => sessionStorage.getItem(`o2.exemplars.${org}.${d}.p_tog`), [ORG, dash]);
    expect(stored).toBe('1');
    expect(JSON.stringify(await getDashboardJson(dash))).toBe(before);

    await page.locator(`${sel.container('p_tog')} [data-test="dashboard-panel-fullscreen-btn"]`).click();
    const viewToggle = page.locator('[data-test="dashboard-viewpanel-exemplars-toggle"]');
    await expect(viewToggle).toHaveAttribute('aria-pressed', 'true');
    await viewToggle.click();
    await expect(viewToggle).toHaveAttribute('aria-pressed', 'false');
    await page.locator('[data-test="dashboard-viewpanel-close-btn"]').click();
    await expect(page.locator(`${sel.container('p_tog')} ${sel.toggle}`)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(`${sel.container('p_tog')} ${sel.points}`)).toHaveCount(0);
    expect(log.exemplars().length).toBeGreaterThan(0);
  });

  test('spike to span within budget', { tag: ['@exemplars', '@P1', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-budget', [
      panel('p_b_off', { title: 'BudgetOff', queries: [{ query: P99 }] }),
      panel('p_b_on', { title: 'BudgetOn', queries: [{ query: P99 }], showExemplars: true, layoutY: 14 }),
    ]);
    let interactions = 0;
    await openDashboard(page, dash);
    await waitForChart(page, 'p_b_off');
    await page.locator(sel.container('p_b_off')).hover();
    await page.locator(`${sel.container('p_b_off')} ${sel.toggle}`).click(); interactions++;
    await expect.poll(() => markerCount(page, 'p_b_off'), { timeout: 30_000 }).toBeGreaterThan(0);
    let point = await firstFoundMarker(page, 'p_b_off', fixtures.found);
    await page.mouse.move(point.x, point.y); interactions++;
    await expect(page.locator(sel.card)).toHaveAttribute('data-trace-state', 'found', { timeout: 20_000 });
    await page.mouse.click(point.x, point.y); interactions++;
    await page.waitForURL(/trace_id=/, { timeout: 20_000 });
    expect(interactions).toBeLessThanOrEqual(3);

    interactions = 0;
    await openDashboard(page, dash);
    await expect.poll(() => markerCount(page, 'p_b_on'), { timeout: 30_000 }).toBeGreaterThan(0);
    point = await firstFoundMarker(page, 'p_b_on', fixtures.found);
    await page.mouse.move(point.x, point.y); interactions++;
    await expect(page.locator(sel.card)).toHaveAttribute('data-trace-state', 'found', { timeout: 20_000 });
    await page.mouse.click(point.x, point.y); interactions++;
    await page.waitForURL(/trace_id=/, { timeout: 20_000 });
    expect(interactions).toBeLessThanOrEqual(2);
  });

  test('markers are distinct in light and dark', { tag: ['@exemplars', '@P2', '@all'] }, async ({ page }) => {
    const dash = await makeDashboard('exemplars-theme', [panel('p_theme', { title: 'Theme', queries: [{ query: P99 }], showExemplars: true })]);
    const luminance = ([r, g, b]) => {
      const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => localStorage.setItem('theme', t), theme);
      await openDashboard(page, dash);
      await expect.poll(() => markerCount(page, 'p_theme'), { timeout: 30_000 }).toBeGreaterThan(0);
      const point = await markerPoint(page, 'p_theme');
      const [marker, background] = await page.locator(`${sel.container('p_theme')} [_echarts_instance_] canvas`).first().evaluate((canvas, [ax, ay]) => {
        const rect = canvas.getBoundingClientRect();
        const dpr = canvas.width / rect.width;
        const ctx = canvas.getContext('2d');
        // The canvas is transparent, so the visible background is the first painted ancestor.
        let el = canvas;
        let bg = [255, 255, 255];
        while (el) {
          const c = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
          if (c.length >= 3 && (c.length < 4 || c[3] > 0)) { bg = c.slice(0, 3); break; }
          el = el.parentElement;
        }
        const lum = (rgb) => {
          const c = rgb.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        };
        const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
        // Symbol 10 px, halo 1.5 px and edge blur 2 px (applyExemplarSeries): only the marker's own disc is sampled.
        const radius = (10 / 2 + 1.5 + 2) * dpr;
        const reach = Math.ceil(radius);
        const cx = Math.round((ax - rect.left) * dpr);
        const cy = Math.round((ay - rect.top) * dpr);
        const data = ctx.getImageData(cx - reach, cy - reach, 2 * reach + 1, 2 * reach + 1).data;
        let best = bg;
        const side = 2 * reach + 1;
        for (let i = 0; i < data.length; i += 4) {
          const px0 = (i / 4) % side - reach;
          const py0 = Math.floor(i / 4 / side) - reach;
          if (px0 * px0 + py0 * py0 > radius * radius) continue;
          const a = data[i + 3] / 255;
          const px = [0, 1, 2].map((k) => Math.round(data[i + k] * a + bg[k] * (1 - a)));
          if (ratio(px, bg) > ratio(best, bg)) best = px;
        }
        return [best, bg];
      }, [point.x, point.y]);
      testLogger.info('marker pixel', { theme, marker, background });
      expect(marker).not.toEqual(background);
      expect(contrast(marker, background)).toBeGreaterThanOrEqual(3);
    }
  });
});
