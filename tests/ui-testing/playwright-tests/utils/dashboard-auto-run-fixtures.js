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

// API fixtures and request tracking for the dashboard Auto Run spec (openobserve#15216).
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const STREAM = 'e2e_automate';
// Namespaces present in test-data/logs_data.json, so panels render real rows per value.
const NAMESPACES = ['ziox', 'ingress-nginx', 'velero'];
const NAMESPACE_FIELD = 'kubernetes_namespace_name';
const CONTAINER_FIELD = 'kubernetes_container_name';
// Each fixture namespace has exactly one container, so a chained child value is known per parent.
const CONTAINER_OF = { ziox: 'ziox', 'ingress-nginx': 'controller', velero: 'velero' };

let layoutSeq = 0;
const createdDashboardIds = [];

function customAxis(alias) {
  return { label: '', alias, column: alias, type: 'custom', color: null, functionName: null, args: [] };
}

// The "<key>_cnt" alias is unique per panel, so a captured request maps back to its panel.
function namespaceTablePanel(id, key, where = '') {
  const ns = `${key}_ns`;
  const cnt = `${key}_cnt`;
  const filter = where ? ` WHERE ${where}` : '';
  return {
    id,
    type: 'table',
    title: id,
    description: '',
    queryType: 'sql',
    config: { show_legends: true, legends_position: null },
    queries: [{
      query: `SELECT kubernetes_namespace_name as "${ns}", count(*) as "${cnt}" FROM "${STREAM}"${filter} GROUP BY "${ns}"`,
      vrlFunctionQuery: '',
      customQuery: true,
      fields: {
        stream: STREAM,
        stream_type: 'logs',
        x: [customAxis(ns)],
        y: [customAxis(cnt)],
        z: [],
        filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] },
      },
      config: { promql_legend: '' },
    }],
    layout: { x: 0, y: layoutSeq * 10, w: 96, h: 10, i: ++layoutSeq },
  };
}

async function createDashboard(title, { panels }) {
  const res = await fetch(`${BASE}/api/${ORG()}/dashboards?folder=default`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: 8,
      title,
      description: 'auto run e2e',
      variables: { list: [], showDynamicFilters: false },
      tabs: [{ tabId: 'default', name: 'Default', panels }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`create dashboard -> ${res.status}: ${JSON.stringify(body)}`);
  const inner = body[`v${body.version}`] || body;
  const id = inner.dashboardId || inner.dashboard_id;
  createdDashboardIds.push(id);
  return id;
}

async function deleteDashboard(dashboardId) {
  if (!dashboardId) return;
  await fetch(`${BASE}/api/${ORG()}/dashboards/${dashboardId}?folder=default`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  }).catch(() => {});
}

// UI-created dashboards join the same API cleanup, so a failing test still deletes them in afterAll.
function trackDashboard(dashboardId) {
  if (dashboardId) createdDashboardIds.push(dashboardId);
}

async function deleteCreatedDashboards() {
  while (createdDashboardIds.length) await deleteDashboard(createdDashboardIds.pop());
}

// ZO_AUTO_QUERY_ENABLED is read once at server start, so it is pinned in the config response instead of needing its own shard.
async function pinAutoQuery(page, enabled) {
  await page.route(/\/api\/[^/]+\/config(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json().catch(() => ({}));
    await route.fulfill({ response, json: { ...body, auto_query_enabled: enabled } });
  });
}

// SQL is sent URL-safe base64 with "." padding when sql_base64_enabled is on.
function decodeSql(body) {
  const query = body && typeof body.query === 'object' ? body.query : body;
  const sql = query?.sql;
  if (typeof sql !== 'string') return '';
  if (body.encoding !== 'base64') return sql;
  const std = sql.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '=');
  return Buffer.from(std, 'base64').toString('utf8');
}

function trackPanelRuns(page) {
  const runs = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST') return;
    if (!/\/_search(_stream)?$/.test(new URL(req.url()).pathname)) return;
    try {
      runs.push(decodeSql(JSON.parse(req.postData() || '{}')));
    } catch {
      /* not a JSON search body */
    }
  });
  return {
    of: (key) => runs.filter((sql) => sql.includes(`"${key}_cnt"`)),
    from: (stream) => runs.filter((sql) => sql.includes(`"${stream}"`)),
  };
}

module.exports = {
  ORG,
  STREAM,
  NAMESPACES,
  NAMESPACE_FIELD,
  CONTAINER_FIELD,
  CONTAINER_OF,
  namespaceTablePanel,
  createDashboard,
  deleteDashboard,
  deleteCreatedDashboards,
  trackDashboard,
  pinAutoQuery,
  trackPanelRuns,
};
