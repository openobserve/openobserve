// Copyright 2026 OpenObserve Inc.
/** REST seeding and cleanup for RegressionSet specs: metrics, PromQL dashboards, orgs, logs streams and saved views. */
const { expect } = require('@playwright/test');
const testLogger = require('./test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');
const { getHeaders, getIngestionUrl } = require('./data-ingestion.js');

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
  ingestLogRows,
  deleteLogStreamQuietly,
  createLogsSavedView,
  getSavedView,
  deleteSavedViewQuietly,
  listSavedViewIds,
};
