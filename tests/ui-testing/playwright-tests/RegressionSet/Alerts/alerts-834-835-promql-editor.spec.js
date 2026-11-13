const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');
const PageManager = require('../../../pages/page-manager.js');

const API_BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || 'default';
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const METRIC = `ovn_b2_promql_${suffix}_total`;
const PROMQL = `sum(rate(${METRIC}[5m]))`;

async function api(method, path, body) {
  const res = await fetch(`${API_BASE}/api/${ORG()}${path}`, {
    method,
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch (_) { return text; }
}

async function ingestCounter() {
  const now = Date.now();
  const rows = Array.from({ length: 20 }, (_, i) => ({
    __name__: METRIC,
    __type__: 'counter',
    job: 'ovn-b2',
    value: i * 10,
    _timestamp: (now - (20 - i) * 30_000) * 1000,
  }));
  await api('POST', '/ingest/metrics/_json', rows);
}

async function createPromqlDashboard() {
  const result = await api('POST', '/dashboards?folder=default', {
    version: 8,
    title: `ovn-b2-promql-${suffix}`,
    description: '',
    tabs: [{
      tabId: 'default',
      name: 'Default',
      panels: [{
        id: 'Panel_ID1',
        type: 'line',
        title: 'promql panel',
        description: '',
        queryType: 'promql',
        config: { show_legends: true, decimals: 2, unit: 'default' },
        queries: [{
          query: PROMQL,
          customQuery: true,
          // Create alert stays disabled for a panel query without a stream.
          fields: { stream: METRIC, stream_type: 'metrics', x: [], y: [], z: [], filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] } },
          config: { promql_legend: '', query_type: 'range' },
        }],
        layout: { x: 0, y: 0, w: 96, h: 14, i: 1 },
      }],
    }],
  });
  const inner = result[`v${result.version}`] || result;
  return inner.dashboardId || inner.dashboard_id;
}

test.describe('PromQL editor opened from a dashboard panel alert (ENT#834, ENT#835)', () => {
  test.describe.configure({ mode: 'serial' });
  let dashboardId;
  let pm;

  test.beforeAll(async () => {
    await ingestCounter();
    dashboardId = await createPromqlDashboard();
    testLogger.info(`Created dashboard ${dashboardId} for ${METRIC}`);
  });

  test.afterAll(async () => {
    if (dashboardId) {
      await api('DELETE', `/dashboards/${dashboardId}?folder=default`).catch((e) => testLogger.warn(`Dashboard cleanup failed: ${e.message}`));
    }
    await api('DELETE', `/streams/${METRIC}?type=metrics&delete_all=true`).catch((e) => testLogger.warn(`Stream cleanup failed: ${e.message}`));
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test('Run query sends the PromQL text as query=, not [object Object] (ENT#835)', {
    tag: ['@bug-835', '@P1', '@regression', '@alertsRegression'],
  }, async () => {
    const dialog = pm.alertPromqlEditorDialogPage;
    await dialog.openFromDashboardPanel(process.env.ZO_BASE_URL, ORG(), dashboardId);
    await dialog.expectEditorText(PROMQL);

    const response = await dialog.runQueryAndCaptureRangeResponse();
    const sent = new URL(response.url()).searchParams.get('query');
    expect(sent).toBe(PROMQL);
    expect(response.url()).not.toContain('%5Bobject%20Object%5D');
    expect(response.status()).toBe(200);
    // The response is an event stream; pre-fix it carried the parse error instead of samples.
    expect(await response.text()).not.toContain('unexpected character');
    await dialog.expectEventsFound();
  });

  test('wheel scrolling inside the PromQL editor does not scroll endlessly (ENT#834)', {
    tag: ['@bug-834', '@P2', '@regression', '@alertsRegression'],
  }, async ({ page }) => {
    const dialog = pm.alertPromqlEditorDialogPage;
    const resizeErrors = [];
    page.on('console', (msg) => { if (/ResizeObserver loop/i.test(msg.text())) resizeErrors.push(msg.text()); });
    page.on('pageerror', (err) => { if (/ResizeObserver loop/i.test(err.message)) resizeErrors.push(err.message); });

    await dialog.openFromDashboardPanel(process.env.ZO_BASE_URL, ORG(), dashboardId);
    await dialog.expectEditorText(PROMQL);
    const before = await dialog.measureEditor();

    await dialog.wheelOverEditor(10, 2000, 150);
    // Pre-fix the editor kept growing after the wheel stopped, so it is measured twice over a settle window.
    await page.waitForTimeout(1500);
    const after = await dialog.measureEditor();
    await page.waitForTimeout(2000);
    const settled = await dialog.measureEditor();

    expect(after.height).toBe(before.height);
    expect(settled.height).toBe(before.height);
    expect(after.scrolled).toBe(0);
    await dialog.expectFirstLineInsideEditor();
    expect(resizeErrors).toEqual([]);
  });
});
