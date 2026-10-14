// API helpers for the dashboard save-conflict specs: seed a dashboard, play the other user's save, read the server copy.
const testLogger = require("../../utils/test-logger.js");

const STREAM = "e2e_automate";

// v8 lays panels out on a 192-column grid.
const HALF_WIDTH = 96;
const PANEL_HEIGHT = 18;

/**
 * A minimal v8 SQL line panel on the e2e stream.
 * @param {string} id - Panel id, unique within the dashboard
 * @param {string} title - Panel title, also used in the panel menu data-test
 * @param {number} index - Position on the tab; drives layout x/y and the integer layout.i
 */
function buildPanel(id, title, index) {
  return {
    id,
    type: "line",
    title,
    description: "",
    config: { show_legends: true, decimals: 2 },
    queryType: "sql",
    queries: [
      {
        query: `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "${STREAM}" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`,
        vrlFunctionQuery: "",
        customQuery: false,
        fields: {
          stream: STREAM,
          stream_type: "logs",
          x: [{ label: "Timestamp", alias: "x_axis_1", column: "_timestamp", color: null, aggregationFunction: "histogram" }],
          y: [{ label: "Count", alias: "y_axis_1", column: "_timestamp", color: "#5960b2", aggregationFunction: "count" }],
          z: [],
          breakdown: [],
          filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
        },
        config: { promql_legend: "", layer_type: "scatter", weight_fixed: 1, limit: 0, min: 0, max: 100 },
      },
    ],
    layout: {
      x: (index % 2) * HALF_WIDTH,
      y: Math.floor(index / 2) * PANEL_HEIGHT,
      w: HALF_WIDTH,
      h: PANEL_HEIGHT,
      i: index + 1,
    },
  };
}

/**
 * Creates a v8 dashboard with one tab ("default") holding the named panels.
 * @param {Object} api - pm.apiCleanup instance
 * @param {string} title - Dashboard title
 * @param {string[]} panelTitles - Panel titles, in grid order
 * @param {Object} [options]
 * @param {string} [options.description]
 * @param {Object[]} [options.variables] - variables.list entries
 * @returns {Promise<string>} dashboardId
 */
async function createConflictDashboard(api, title, panelTitles, options = {}) {
  const suffix = Date.now();
  const payload = {
    version: 8,
    title,
    description: options.description ?? "save-conflict e2e",
    // cleanup.spec.js only sweeps dashboards owned by the automation user.
    owner: api.email,
    tabs: [
      {
        tabId: "default",
        name: "Overview",
        panels: panelTitles.map((panelTitle, i) => buildPanel(`Panel_ID${suffix}${i}`, panelTitle, i)),
      },
    ],
    variables: { showDynamicFilters: false, list: options.variables ?? [] },
    defaultDatetimeDuration: { type: "relative", relativeTimePeriod: "15m", startTime: 0, endTime: 0 },
  };
  const response = await api._fetch(`${api.baseUrl}/api/${api.org}/dashboards?folder=default`, {
    method: "POST",
    headers: { Authorization: api.authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`createConflictDashboard: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  const result = await response.json();
  const inner = result[`v${result.version}`] || result;
  const dashboardId = inner.dashboardId || inner.dashboard_id;
  testLogger.info("Created save-conflict dashboard", { title, dashboardId, panelTitles });
  return dashboardId;
}

/**
 * The server's current copy of a dashboard and the hash a save must carry.
 * @returns {Promise<{hash: string, dashboard: Object}>}
 */
async function getServerDashboard(api, dashboardId) {
  const response = await api._fetch(`${api.baseUrl}/api/${api.org}/dashboards/${dashboardId}?folder=default`, {
    method: "GET",
    headers: { Authorization: api.authHeader, "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`getServerDashboard: HTTP ${response.status}`);
  const body = await response.json();
  return { hash: String(body.hash), dashboard: body[`v${body.version}`] };
}

/**
 * Plays "another user" saving the dashboard: reads the latest copy, applies `mutate`, saves it with the current hash.
 * Every browser already showing the dashboard is now one version behind and its next save gets a 409.
 * @param {Object} api - pm.apiCleanup instance
 * @param {string} dashboardId
 * @param {(dashboard: Object) => void} mutate - edits the dashboard object in place
 */
async function otherUserSaves(api, dashboardId, mutate) {
  const { hash, dashboard } = await getServerDashboard(api, dashboardId);
  mutate(dashboard);
  const response = await api._fetch(
    `${api.baseUrl}/api/${api.org}/dashboards/${dashboardId}?folder=default&hash=${encodeURIComponent(hash)}`,
    {
      method: "PUT",
      headers: { Authorization: api.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(dashboard),
    },
  );
  if (!response.ok) {
    throw new Error(`otherUserSaves: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  testLogger.info("Other user saved the dashboard", { dashboardId });
}

/** Plays "another user" deleting a panel by title. */
async function removePanelOnServer(api, dashboardId, panelTitle) {
  await otherUserSaves(api, dashboardId, (dashboard) => {
    for (const tab of dashboard.tabs || []) {
      tab.panels = (tab.panels || []).filter((p) => p.title !== panelTitle);
    }
  });
}

const panelTitlesOf = (dashboard) => (dashboard.tabs || []).flatMap((tab) => (tab.panels || []).map((p) => p.title));

const tabNamesOf = (dashboard) => (dashboard.tabs || []).map((tab) => tab.name);

module.exports = {
  createConflictDashboard,
  getServerDashboard,
  otherUserSaves,
  removePanelOnServer,
  panelTitlesOf,
  tabNamesOf,
};
