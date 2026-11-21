// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Data, dashboard API and request tracking for the Query Values variable specs (openobserve#15355).
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');
const { ingestBase } = require('./ingest-url.js');
const testLogger = require('./test-logger.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || process.env.ORGNAME || 'default';

// Fixed names: every spec ingests the same rows, so distinct values stay exact however often it runs.
const LOGS_STREAM = 'e2e_query_vars';
const METRIC_UP = 'e2e_qv_up';
const METRIC_INFO = 'e2e_qv_pod_info';

// service_id is a string column; "007" checks a numeric-looking value keeps its leading zero.
const LOG_ROWS = [
  { service_name: 'checkout', level: 'error', k8s_cluster: 'prod-eu', k8s_namespace: 'payments', service_id: '101', message: 'checkout timeout error' },
  { service_name: 'payments', level: 'error', k8s_cluster: 'prod-us', k8s_namespace: 'payments', service_id: '102', message: 'payments failed' },
  { service_name: 'search', level: 'warn', k8s_cluster: 'prod-us', k8s_namespace: 'search', service_id: '103', message: 'search slow' },
  { service_name: 'cart', level: 'info', k8s_cluster: 'prod-eu', k8s_namespace: 'checkout', service_id: '104', message: 'cart ok' },
  { service_name: 'auth', level: 'debug', k8s_cluster: 'staging', k8s_namespace: 'default', service_id: '105', message: 'auth debug' },
  { service_name: 'inventory', level: 'error', k8s_cluster: 'staging', k8s_namespace: 'default', service_id: '106', message: 'inventory error' },
  { service_name: 'email', level: 'info', k8s_cluster: 'prod-us', k8s_namespace: 'monitoring', service_id: '007', message: 'email sent' },
  { service_name: 'frontend', level: 'warn', k8s_cluster: 'prod-eu', k8s_namespace: 'monitoring', message: 'frontend timeout' },
  { service_name: 'cart', level: 'error', k8s_cluster: 'prod-eu', k8s_namespace: 'checkout', service_id: '104', message: 'cart error' },
];

const ALL_SERVICES = ['auth', 'cart', 'checkout', 'email', 'frontend', 'inventory', 'payments', 'search'];

// Series of the up metric; the pod_info metric repeats them so metrics() lists two names.
const METRIC_SERIES = [
  { cluster: 'prod-eu', namespace: 'payments', pod: 'payments-0', job: 'kubelet' },
  { cluster: 'prod-eu', namespace: 'checkout', pod: 'checkout-0', job: 'kubelet' },
  { cluster: 'prod-us', namespace: 'payments', pod: 'payments-1', job: 'node' },
  { cluster: 'prod-us', namespace: 'search', pod: 'search-0', job: 'kubelet' },
  { cluster: 'staging', namespace: 'default', pod: 'default-0', job: 'node' },
];

let layoutSeq = 0;
const createdDashboardIds = [];

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api/${ORG()}${path}`, {
    method,
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch (_) { /* plain text body */ }
  return { status: res.status, ok: res.ok, data };
}

async function ingestPost(path, body) {
  const res = await fetch(`${ingestBase(BASE)}/api/${ORG()}${path}`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ingest ${path} -> ${res.status}: ${await res.text()}`);
}

function sqlCount(rows) {
  return rows?.data?.hits?.[0]?.c ?? 0;
}

async function waitForLogs(minRows, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const end = Date.now() * 1000;
    const res = await api('POST', '/_search?type=logs', {
      query: { sql: `SELECT count(*) AS c FROM "${LOGS_STREAM}"`, start_time: end - 3_600_000_000, end_time: end + 60_000_000, size: 1 },
    });
    if (sqlCount(res) >= minRows) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`logs stream ${LOGS_STREAM} never reached ${minRows} rows`);
}

async function waitForMetrics(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const end = Math.floor(Date.now() / 1000);
    const match = encodeURIComponent(`${METRIC_UP}{cluster="prod-eu"}`);
    const res = await api('GET', `/prometheus/api/v1/label/pod/values?match[]=${match}&start=${end - 3600}&end=${end + 60}`);
    if ((res.data?.data ?? []).length >= 2) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`metric ${METRIC_UP} never became queryable`);
}

/** Ingests the logs and metrics every Query Values spec reads, stamped inside the last few minutes. */
async function ingestQueryVariableData() {
  const now = Date.now() * 1000;
  const before = sqlCount(await api('POST', '/_search?type=logs', {
    query: { sql: `SELECT count(*) AS c FROM "${LOGS_STREAM}"`, start_time: now - 3_600_000_000, end_time: now + 60_000_000, size: 1 },
  }).catch(() => ({})));
  const logs = LOG_ROWS.map((row, i) => ({ _timestamp: now - (i + 1) * 1_000_000, ...row }));
  await ingestPost(`/${LOGS_STREAM}/_json`, logs);
  const metrics = [];
  for (let minute = 0; minute < 10; minute++) {
    const ts = now - minute * 60_000_000;
    for (const labels of METRIC_SERIES) {
      metrics.push({ __name__: METRIC_UP, __type__: 'gauge', ...labels, _timestamp: ts, value: 1 });
      metrics.push({ __name__: METRIC_INFO, __type__: 'gauge', ...labels, _timestamp: ts, value: 1 });
    }
  }
  await ingestPost('/ingest/metrics/_json', metrics);
  await waitForLogs(before + LOG_ROWS.length);
  await waitForMetrics();
  testLogger.info('Query variable fixtures ingested', { logs: logs.length, metrics: metrics.length });
}

function customAxis(alias) {
  return { label: '', alias, column: alias, type: 'custom', color: null, functionName: null, args: [] };
}

/** A table panel running `sql` on the logs stream; its alias makes its requests easy to pick out. */
function logsTablePanel(id, sql, { stream = LOGS_STREAM, x = 'service_name', y = 'cnt' } = {}) {
  return {
    id,
    type: 'table',
    title: id,
    description: '',
    queryType: 'sql',
    config: { show_legends: true, legends_position: null },
    queries: [{
      query: sql,
      vrlFunctionQuery: '',
      customQuery: true,
      fields: {
        stream,
        stream_type: 'logs',
        x: [customAxis(x)],
        y: [customAxis(y)],
        z: [],
        filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] },
      },
      config: { promql_legend: '' },
    }],
    layout: { x: 0, y: layoutSeq * 10, w: 96, h: 10, i: ++layoutSeq },
  };
}

/** A Query Values variable in the saved v8 shape; `query_data` is stored as given. */
function queryValuesVariable(name, queryData, extra = {}) {
  return {
    type: 'query_values',
    name,
    label: name,
    query_data: queryData,
    value: '',
    options: [],
    multiSelect: false,
    hideOnDashboard: false,
    selectAllValueForMultiSelect: 'first',
    customMultiSelectValue: [],
    escapeSingleQuotes: true,
    ...extra,
  };
}

function customVariable(name, values, extra = {}) {
  return {
    type: 'custom',
    name,
    label: name,
    value: values[0],
    options: values.map((value, i) => ({ label: value, value, selected: i === 0 })),
    multiSelect: false,
    hideOnDashboard: false,
    selectAllValueForMultiSelect: 'first',
    customMultiSelectValue: [],
    escapeSingleQuotes: true,
    ...extra,
  };
}

function dashboardBody(title, { variables = [], panels = [] } = {}) {
  return {
    version: 8,
    title,
    description: 'query variables e2e',
    role: '',
    tabs: [{ tabId: 'default', name: 'Default', panels }],
    variables: { list: variables, showDynamicFilters: false },
  };
}

// A create/get body carries `version` + `v<N>`; a list row only has the `v1`..`v<N>` keys, all but one null.
function innerDashboard(body) {
  if (!body) return body;
  if (body[`v${body.version}`]) return body[`v${body.version}`];
  const versioned = Object.keys(body).filter((k) => /^v\d+$/.test(k) && body[k]);
  return versioned.length ? body[versioned[0]] : body;
}

async function createDashboard(body) {
  const res = await api('POST', '/dashboards?folder=default', body);
  if (!res.ok) throw new Error(`create dashboard -> ${res.status}: ${JSON.stringify(res.data)}`);
  const inner = innerDashboard(res.data);
  const id = inner.dashboardId || inner.dashboard_id;
  createdDashboardIds.push(id);
  return id;
}

async function getDashboard(dashboardId) {
  const res = await api('GET', `/dashboards/${dashboardId}?folder=default`);
  if (!res.ok) throw new Error(`get dashboard -> ${res.status}`);
  return innerDashboard(res.data);
}

async function getVariable(dashboardId, name) {
  const dashboard = await getDashboard(dashboardId);
  return (dashboard.variables?.list ?? []).find((v) => v.name === name);
}

async function findDashboardId(title) {
  const res = await api('GET', '/dashboards?folder=default');
  const list = res.data?.dashboards ?? res.data?.list ?? [];
  const match = list.map(innerDashboard).find((d) => d?.title === title);
  return match?.dashboardId || match?.dashboard_id;
}

async function deleteDashboard(dashboardId) {
  if (!dashboardId) return;
  await api('DELETE', `/dashboards/${dashboardId}?folder=default`).catch(() => {});
}

function trackDashboard(dashboardId) {
  if (dashboardId) createdDashboardIds.push(dashboardId);
}

async function deleteCreatedDashboards() {
  while (createdDashboardIds.length) await deleteDashboard(createdDashboardIds.pop());
}

function dashboardUrl(dashboardId, extra = '') {
  const period = extra.includes('period=') || extra.includes('from=') ? '' : '&period=30m';
  return `/web/dashboards/view?org_identifier=${ORG()}&dashboard=${dashboardId}&folder=default&tab=default${period}${extra}`;
}

// SQL is sent URL-safe base64 with "." padding when sql_base64_enabled is on.
function decodeSql(sql, encoding) {
  if (typeof sql !== 'string') return '';
  const looksEncoded = !/\s/.test(sql) && /^[A-Za-z0-9_\-.+/=]+$/.test(sql);
  if (encoding !== 'base64' && !looksEncoded) return sql;
  return Buffer.from(sql.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '='), 'base64').toString('utf8');
}

/** Records the SQL of every search and values request and every PromQL lookup URL from now on. */
function trackQueries(page) {
  const searches = [];
  const searchRequests = [];
  const values = [];
  const promql = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.includes('/prometheus/api/v1/')) {
      promql.push(decodeURIComponent(url.pathname + url.search));
      return;
    }
    if (req.method() !== 'POST') return;
    let body;
    try { body = JSON.parse(req.postData() || '{}'); } catch (_) { return; }
    if (/\/_values_stream$/.test(url.pathname)) {
      values.push(decodeSql(body.sql, body.encoding));
    } else if (/\/_search(_stream)?$/.test(url.pathname)) {
      const query = typeof body.query === 'object' ? body.query : body;
      const sql = decodeSql(query?.sql, body.encoding);
      searches.push(sql);
      searchRequests.push({ sql, startTime: query?.start_time, endTime: query?.end_time });
    }
  });
  return {
    searches: () => [...searches],
    searchRequests: () => [...searchRequests],
    values: () => [...values],
    promql: () => [...promql],
    all: () => [...searches, ...values, ...promql],
    clear: () => { searches.length = 0; searchRequests.length = 0; values.length = 0; promql.length = 0; },
  };
}

/** Polls until a recorded search SQL matches `test`; a failure lists every SQL seen. */
async function waitForSearch(queries, test, { timeout = 30000, kind = 'searches' } = {}) {
  const match = (sql) => (typeof test === 'function' ? test(sql) : test instanceof RegExp ? test.test(sql) : sql.includes(test));
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hit = queries[kind]().find(match);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no ${kind} request matched ${test}; seen:\n${queries[kind]().join('\n')}`);
}

module.exports = {
  waitForSearch,
  ORG,
  LOGS_STREAM,
  METRIC_UP,
  METRIC_INFO,
  LOG_ROWS,
  ALL_SERVICES,
  METRIC_SERIES,
  ingestQueryVariableData,
  logsTablePanel,
  queryValuesVariable,
  customVariable,
  dashboardBody,
  innerDashboard,
  createDashboard,
  getDashboard,
  getVariable,
  findDashboardId,
  deleteDashboard,
  trackDashboard,
  deleteCreatedDashboards,
  dashboardUrl,
  decodeSql,
  trackQueries,
};
