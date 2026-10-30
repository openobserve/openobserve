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

// API fixtures for the dashboard layout edit mode spec (openobserve#15215).
const { getAuthHeaders, getOrgIdentifier } = require("../../utils/cloud-auth.js");

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || "http://localhost:5080").replace(/\/$/, "");
const ORG = () => getOrgIdentifier() || process.env.ORGNAME || "default";
const STREAM = "e2e_automate";
const SECOND_TAB_ID = "layout_tab_2";

// The grid has 192 columns, so w: 96 puts the two panels side by side on one row.
const PANEL_A = { title: "Layout Panel A", layout: { x: 0, y: 0, w: 96, h: 9 } };
const PANEL_B = { title: "Layout Panel B", layout: { x: 96, y: 0, w: 96, h: 9 } };

function countPanel(id, { title, layout }, seq) {
  const axis = (alias) => ({ label: "", alias, column: alias, type: "custom", color: null, functionName: null, args: [] });
  return {
    id,
    type: "table",
    title,
    description: "",
    queryType: "sql",
    config: { show_legends: true, legends_position: null },
    queries: [{
      query: `SELECT kubernetes_namespace_name as "ns", count(*) as "cnt" FROM "${STREAM}" GROUP BY "ns"`,
      vrlFunctionQuery: "",
      customQuery: true,
      fields: {
        stream: STREAM,
        stream_type: "logs",
        x: [axis("ns")],
        y: [axis("cnt")],
        z: [],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
      },
      config: { promql_legend: "" },
    }],
    layout: { ...layout, i: seq },
  };
}

function unwrap(body) {
  return body[`v${body.version}`] || body;
}

async function createLayoutDashboard(title) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const panelIds = [`Panel_ID_A${suffix}`, `Panel_ID_B${suffix}`];
  const res = await fetch(`${BASE}/api/${ORG()}/dashboards?folder=default`, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 8,
      title,
      description: "layout edit mode e2e",
      variables: { list: [], showDynamicFilters: false },
      tabs: [
        { tabId: "default", name: "Default", panels: [countPanel(panelIds[0], PANEL_A, 1), countPanel(panelIds[1], PANEL_B, 2)] },
        { tabId: SECOND_TAB_ID, name: "Second", panels: [] },
      ],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`create dashboard -> ${res.status}: ${JSON.stringify(body)}`);
  const inner = unwrap(body);
  return { dashboardId: inner.dashboardId || inner.dashboard_id, panelIds };
}

// Returns { [panelId]: { x, y, w, h } } for the default tab as last saved on the server.
async function getSavedLayouts(dashboardId) {
  const res = await fetch(`${BASE}/api/${ORG()}/dashboards/${dashboardId}?folder=default`, {
    headers: getAuthHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`get dashboard -> ${res.status}: ${JSON.stringify(body)}`);
  const tab = (unwrap(body).tabs || []).find((t) => t.tabId === "default");
  const layouts = {};
  for (const panel of tab?.panels || []) {
    const { x, y, w, h } = panel.layout;
    layouts[panel.id] = { x, y, w, h };
  }
  return layouts;
}

function trackDashboardPuts(page) {
  const state = { count: 0 };
  page.on("request", (req) => {
    if (req.method() === "PUT" && /\/dashboards\/[^/?]+/.test(new URL(req.url()).pathname)) state.count += 1;
  });
  return state;
}

module.exports = {
  PANEL_A,
  PANEL_B,
  SECOND_TAB_ID,
  createLayoutDashboard,
  getSavedLayouts,
  trackDashboardPuts,
};
