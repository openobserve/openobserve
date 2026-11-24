// Copyright 2026 OpenObserve Inc.
/** REST seeding and cleanup for RegressionSet specs: metrics, PromQL dashboards, orgs, logs streams and saved views. */
const { expect } = require('@playwright/test');
const testLogger = require('./test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');
const { getHeaders, getIngestionUrl } = require('./data-ingestion.js');
const { ingestBase } = require('./ingest-url.js');

const ingestionBase = () => (process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/$/, '');
const apiBase = () => process.env.ZO_BASE_URL_SC || process.env.ZO_BASE_URL;
const orgId = () => getOrgIdentifier() || 'default';

/** Authenticated fetch against `<ingestion base>/api<path>`; throws on a non-2xx and returns parsed JSON (or text). */
async function apiFetch(method, path, body) {
  const res = await fetch(`${ingestionBase()}/api${path}`, {
    method,
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch (_) { return text; }
}

/** Ingest 20 rising counter samples, 30s apart, ending now. */
async function ingestPromCounter(metric, job) {
  const now = Date.now();
  const rows = Array.from({ length: 20 }, (_, i) => ({
    __name__: metric,
    __type__: 'counter',
    job,
    value: i * 10,
    _timestamp: (now - (20 - i) * 30_000) * 1000,
  }));
  await apiFetch('POST', `/${orgId()}/ingest/metrics/_json`, rows);
}

/** Create a one-panel dashboard whose line panel runs `promql` over `metric`; resolves to its dashboard id. */
async function createPromqlPanelDashboard(title, metric, promql) {
  const result = await apiFetch('POST', `/${orgId()}/dashboards?folder=default`, {
    version: 8,
    title,
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
          query: promql,
          customQuery: true,
          // Create alert stays disabled for a panel query without a stream.
          fields: { stream: metric, stream_type: 'metrics', x: [], y: [], z: [], filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] } },
          config: { promql_legend: '', query_type: 'range' },
        }],
        layout: { x: 0, y: 0, w: 96, h: 14, i: 1 },
      }],
    }],
  });
  const inner = result[`v${result.version}`] || result;
  return inner.dashboardId || inner.dashboard_id;
}

/** POST `rows` to the logs stream through the ingest base, then poll until a last-hour count returns all of them (rows search only after the WAL flush). */
async function ingestLogRowsAndWaitForCount(stream, rows, timeout = 60000) {
  const res = await fetch(`${ingestBase(ingestionBase())}/api/${orgId()}/${stream}/_json`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(rows),
  });
  expect(res.ok, `Precondition: ingest ${stream} -> ${res.status}`).toBe(true);
  const now = Date.now() * 1000;
  await expect.poll(async () => {
    const body = await apiFetch('POST', `/${orgId()}/_search?type=logs`, {
      query: { sql: `SELECT count(*) as c FROM "${stream}"`, start_time: now - 3_600_000_000, end_time: now + 60_000_000, from: 0, size: 1 },
    }).catch(() => null);
    return body?.hits?.[0]?.c ?? 0;
  }, { timeout }).toBe(rows.length);
}

const treemapField = (alias, column, functionName = null) => ({
  label: column,
  alias,
  column,
  color: null,
  functionName,
  args: [{ type: 'field', value: { field: column, streamAlias: null } }],
  isDerived: false,
  sortBy: null,
});

/** A builder-mode treemap query on `stream`: `levels` as nested groups, sized by `sum(bytes)` or, for `value` "count", `count(_timestamp)`. */
function treemapPanelQuery(stream, levels, value) {
  const x = levels.map((column, i) => treemapField(`x_axis_${i + 1}`, column));
  const y = value === 'count' ? treemapField('y_axis_1', '_timestamp', 'count') : treemapField('y_axis_1', 'bytes', 'sum');
  const select = [
    ...x.map((f) => `${f.column} as "${f.alias}"`),
    value === 'count' ? 'count(_timestamp) as "y_axis_1"' : 'sum(bytes) as "y_axis_1"',
  ].join(', ');
  return {
    query: `SELECT ${select} FROM "${stream}" GROUP BY ${x.map((f) => f.alias).join(', ')}`,
    customQuery: false,
    fields: {
      stream,
      stream_type: 'logs',
      x,
      y: [y],
      z: [],
      breakdown: [],
      filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] },
    },
    config: { promql_legend: '', layer_type: 'scatter', weight_fixed: 1, limit: 0, min: 0, max: 100 },
  };
}

/** Create a dashboard titled `title` whose one treemap panel (id `panelId`) runs `queries`; resolves to its dashboard id. */
async function createTreemapDashboard(title, panelTitle, queries, panelId = 'p_treemap') {
  const result = await apiFetch('POST', `/${orgId()}/dashboards?folder=default`, {
    version: 8,
    title,
    description: 'treemap e2e',
    tabs: [{
      tabId: 'default',
      name: 'Default',
      panels: [{
        id: panelId,
        type: 'treemap',
        title: panelTitle,
        description: '',
        queryType: 'sql',
        config: { show_legends: true, unit: 'default', decimals: 0 },
        queries,
        layout: { x: 0, y: 0, w: 96, h: 20, i: 1 },
      }],
    }],
  });
  const inner = result[`v${result.version}`] || result;
  return inner.dashboardId || inner.dashboard_id;
}

async function deleteDashboardQuietly(dashboardId) {
  await apiFetch('DELETE', `/${orgId()}/dashboards/${dashboardId}?folder=default`).catch((e) => testLogger.warn(`Dashboard cleanup failed: ${e.message}`));
}

async function deleteStreamQuietly(stream, type) {
  await apiFetch('DELETE', `/${orgId()}/streams/${stream}?type=${type}&delete_all=true`).catch((e) => testLogger.warn(`Stream cleanup failed: ${e.message}`));
}

/** Resolve the identifier of the org named `name`, creating it if missing. */
async function ensureOrg(name) {
  const list = await apiFetch('GET', '/organizations');
  const found = (list.data || []).find((o) => o.name === name);
  if (found) return found.identifier;
  const created = await apiFetch('POST', '/organizations', { name });
  return created.identifier;
}

async function ingestLogRowsFetch(stream, rows) {
  await apiFetch('POST', `/${orgId()}/${stream}/_json`, rows);
}

/** Ingest `rows` into a logs stream through `request` and return the response. */
async function ingestLogRows(request, stream, rows) {
  return request.post(getIngestionUrl(orgId(), stream), { headers: getHeaders(), data: rows });
}

async function deleteLogStreamQuietly(request, stream) {
  await request.delete(`${apiBase()}/api/${orgId()}/streams/${stream}?type=logs`, { headers: getAuthHeaders() }).catch(() => {});
}

/** Create a logs saved view holding `query`, assert 200, and resolve to its view_id. */
async function createLogsSavedView(request, name, query) {
  const resp = await request.post(`${apiBase()}/api/${orgId()}/savedviews`, {
    headers: getAuthHeaders(),
    data: { view_name: name, view_type: 'logs', data: { query } },
  });
  expect(resp.status(), `Precondition: saved view ${name} must be created`).toBe(200);
  return (await resp.json()).view_id;
}

async function getSavedView(request, id) {
  return request.get(`${apiBase()}/api/${orgId()}/savedviews/${id}`, { headers: getAuthHeaders() });
}

async function deleteSavedViewQuietly(request, id) {
  await request.delete(`${apiBase()}/api/${orgId()}/savedviews/${id}`, { headers: getAuthHeaders() }).catch(() => {});
}

async function listSavedViewIds(request) {
  const resp = await request.get(`${apiBase()}/api/${orgId()}/savedviews`, { headers: getAuthHeaders() });
  return ((await resp.json()).views || []).map((v) => v.view_id);
}

module.exports = {
  orgId,
  ingestPromCounter,
  createPromqlPanelDashboard,
  deleteDashboardQuietly,
  deleteStreamQuietly,
  ensureOrg,
  ingestLogRowsFetch,
  ingestLogRowsAndWaitForCount,
  treemapPanelQuery,
  createTreemapDashboard,
  ingestLogRows,
  deleteLogStreamQuietly,
  createLogsSavedView,
  getSavedView,
  deleteSavedViewQuietly,
  listSavedViewIds,
};
