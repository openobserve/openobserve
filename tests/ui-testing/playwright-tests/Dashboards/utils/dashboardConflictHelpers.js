const testLogger = require("../../utils/test-logger.js");

/**
 * Second-actor helpers for the dashboard save-conflict specs. The server only
 * returns HTTP 409 when a save carries a stale `hash`, so "the other user" is
 * simulated as a PUT that carries the *current* hash (fetched immediately
 * before) — the exact pattern from the Setup Contract.
 *
 * All requests go through `apiCleanup._fetch` (the standard authenticated
 * wrapper), which handles both self-hosted Basic Auth and cloud cookie auth.
 */

/** Unique dashboard-name suffix (timestamp + random base36) so each test owns its dashboard. */
export function uniqueSuffix() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Parse dashboardId / folder / panelId from the current URL query string. */
export function getDashboardFromUrl(page) {
  const url = new URL(page.url());
  return {
    dashboardId: url.searchParams.get("dashboard"),
    folder: url.searchParams.get("folder") || "default",
    panelId: url.searchParams.get("panelId") || undefined,
  };
}

/** GET the server's current dashboard document and its version + hash. */
export async function fetchDashboardApi(api, dashboardId, folder) {
  const response = await api._fetch(
    `${api.baseUrl}/api/${api.org}/dashboards/${dashboardId}?folder=${encodeURIComponent(folder)}`,
    {
      method: "GET",
      headers: { Authorization: api.authHeader, "Content-Type": "application/json" },
    }
  );
  if (!response.ok) {
    throw new Error(`fetchDashboardApi: HTTP ${response.status}`);
  }
  const meta = await response.json();
  const inner = meta[`v${meta.version}`] || meta;
  return { data: inner, hash: String(meta.hash), version: meta.version };
}

/**
 * PUT the dashboard after `mutate(data)`, carrying the current hash so the
 * server accepts the write and advances the version (exactly one GET + one PUT).
 */
export async function saveDashboardApi(api, dashboardId, folder, mutate) {
  const { data, hash, version } = await fetchDashboardApi(api, dashboardId, folder);
  const next = JSON.parse(JSON.stringify(data));
  mutate(next);
  const response = await api._fetch(
    `${api.baseUrl}/api/${api.org}/dashboards/${dashboardId}?folder=${encodeURIComponent(folder)}&hash=${encodeURIComponent(hash)}`,
    {
      method: "PUT",
      headers: { Authorization: api.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ version, ...next }),
    }
  );
  return { status: response.status };
}

/** Second actor: rename the dashboard title (panels untouched), advancing the server hash. */
export async function secondActorRenameTitle(api, dashboardId, folder, newTitle) {
  const { status } = await saveDashboardApi(api, dashboardId, folder, (doc) => {
    doc.title = newTitle;
  });
  if (status !== 200) {
    throw new Error(`secondActorRenameTitle: HTTP ${status}`);
  }
  testLogger.info("Second actor renamed dashboard title", { dashboardId, newTitle });
  return status;
}

/** Second actor: mutate a specific panel (matched by id), leaving everything else untouched. */
export async function secondActorTouchPanel(api, dashboardId, folder, panelId, mutatePanel) {
  let touched = false;
  const { status } = await saveDashboardApi(api, dashboardId, folder, (doc) => {
    for (const tab of doc.tabs || []) {
      for (const panel of tab.panels || []) {
        if (String(panel.id) === String(panelId)) {
          mutatePanel(panel);
          touched = true;
        }
      }
    }
  });
  if (!touched) {
    throw new Error(`secondActorTouchPanel: panel ${panelId} not found`);
  }
  if (status !== 200) {
    throw new Error(`secondActorTouchPanel: HTTP ${status}`);
  }
  testLogger.info("Second actor edited the same panel", { dashboardId, panelId });
  return status;
}

/**
 * Drive the two-actor conflict choreography for a panel-editor save: reopen the
 * panel in the editor, make a pending rename, let the "second actor" advance the
 * server hash via API, then click the panel save so the PUT lands with the stale
 * hash and opens the conflict dialog. The spec then asserts on the dialog steps.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} pm - PageManager instance
 * @param {{panelName: string, renamedName: string, secondActor: () => Promise<void>}} opts
 */
export async function triggerPanelEditorConflict(page, pm, { panelName, renamedName, secondActor }) {
  await pm.dashboardPanelEdit.editPanel(panelName);
  await page.waitForURL((url) => url.pathname.includes("add_panel"), { timeout: 30000 });
  await pm.dashboardPanelActions.getPanelSaveBtn().waitFor({ state: "visible", timeout: 30000 });
  await pm.dashboardPanelActions.addPanelName(renamedName);
  await secondActor();
  await pm.dashboardPanelActions.getPanelSaveBtn().click();
}
