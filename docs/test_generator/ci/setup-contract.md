# Test Setup Contract: Dashboard Save Conflict Resolution  (area: Dashboards)

Spec: `tests/ui-testing/playwright-tests/Dashboards/dashboard-save-conflict.spec.js`

The single hard precondition for this feature is a **real HTTP 409** on a dashboard save, which the
server only returns when the PUT carries a **stale `hash`**. That requires two actors: one that
loaded the dashboard and edits it ("mine"), and another that saved it first ("theirs"). Everything
below establishes exactly that.

## Streams / data the spec must establish

Dashboards are not stream-backed for save purposes, so **no ingestion is required**. A conflict only
needs a dashboard object on the server.

- **`<dashboardName>`** (unique per test, e.g. `save-conflict-${Date.now()}`) **[per-test]** — a v8
  dashboard with at least one panel so an edit can be made and (for Merge) a `panelId` exists.
  Why: every conflict workflow edits and re-saves this dashboard.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### 1. Create the dashboard + one panel (UI path)
```js
import { setupTestDashboard, addSimplePanel } from "./utils/dashCreation.js";
await setupTestDashboard(page, pm, dashboardName);          // list → create → wait empty-state ready
await addSimplePanel(pm, "Panel A", { chartType: "line", streamName: "e2e_automate", yAxisField: "kubernetes_pod_name" });
```
Reference: `tests/ui-testing/playwright-tests/Dashboards/utils/dashCreation.js:356-371` (`setupTestDashboard`)
and `:405-435` (`addSimplePanel`). The default stream `e2e_automate` is already ingested by the shared
setup (see the many dashboard specs that call `addSimplePanel` without seeding).

### 2. Create the dashboard via API (alternative, deterministic ID)
```js
import { createDashboardViaApi } from "../../pages/dashboardPages/dashCreation.js";
const { dashboard } = await createDashboardViaApi(api, dashboardName, "default");
// returns { dashboard_id, title, tabs }; open it at /web/dashboards/view?dashboard=<id>&folder=default
```
Reference: `tests/ui-testing/pages/dashboardPages/dashCreation.js:197-248`. Uses `api._fetch`
(`pages/apiCleanup.js:33`), which is the standard authenticated request wrapper.

### 3. Simulate "another user saved" — advance the server hash (THE critical step)
The dialog will never open unless a *different* actor saves the dashboard after "mine" loaded it.
Two equivalent patterns; prefer **(a)** for determinism:

**(a) API PUT with the current hash** (recommended — no second UI to drive):
```js
// 1. read current version + hash
const res = await api._fetch(`${api.baseUrl}/api/${api.org}/dashboards/${dashboardId}?folder=default`);
const meta = await res.json();
const inner = meta[`v${meta.version}`] || meta;
const hash = String(meta.hash);
// 2. bump something trivial on a deep copy, then PUT with the CURRENT hash so the server accepts it
const body = { version: meta.version, ...inner, description: (inner.description || "") + " (edited by other user)" };
await api._fetch(
  `${api.baseUrl}/api/${api.org}/dashboards/${dashboardId}?folder=default&hash=${encodeURIComponent(hash)}`,
  { method: "PUT", headers: { Authorization: api.authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(body) }
);
```
Reference for the endpoint shape: `web/src/services/dashboards.ts:68-73` (PUT `?folder=&hash=`).
Reference for the GET + `hash`/`v${version}` envelope: `web/src/utils/commons.ts:649-661`
(`fetchServerDashboard`) and `dashCreation.js:230-240` (unwrapping `v${version}`).

**(b) Second browser page in the same context** (fully UI-driven):
```js
// context is a fixture; page2 is an independent JS realm (separate in-memory hash state)
const page2 = await context.newPage();
await navigateToBase(page2);
// open the SAME dashboard in page2, make a small edit (e.g. rename via GeneralSettings), save.
```
Why same-context works: each page runs a separate Vuex store + module registry, so
`loadedDashboardVersions` (`utils/commons.ts:43`) is independent per page — exactly two "users".
Auth is shared (same cookies). `navigateToBase` is exported from
`tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:161`.

### 4. Trigger the conflict on "mine"
With the dashboard open in `page` (loaded **before** step 3) and an unsaved edit pending, click the
save path:
- **Rename / settings edit** → GeneralSettings save (`settings/GeneralSettings.vue:228`).
- **Layout move** → enter edit mode (`dashboard-edit-btn`), move a panel, Save (`dashboard-edit-save-btn`)
  → `RenderDashboardCharts.vue:867`.
- **Panel editor (for Merge)** → open a panel in the panel editor, edit it, Save → `AddPanel.vue:1521`
  (this is the only save site that passes `panelId`, which unlocks Merge).

The PUT will carry the stale load-time hash → **409** → dialog opens.

### Auth / org
- `ORGNAME` = the shared org (`process.env.ORGNAME`); auth comes from the global-session context fixture
  (`tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js:24-47`) or, for API calls,
  `getAuthHeaders()` / `getOrgIdentifier()` from `tests/ui-testing/playwright-tests/utils/cloud-auth.js`
  (used inside `apiCleanup`).

### Timing / waits
- After clicking a save button, wait for the dialog, not a toast:
  `page.locator('[data-test="dashboard-save-conflict-dialog"]').waitFor({ state: "visible" })`.
- The dialog briefly shows `step=loading` while `loadLatest` runs; the main actions appear only when
  `step=main`. Wait for a main-step marker before asserting buttons:
  `page.locator('[data-test="dashboard-save-conflict-saved-by"]').waitFor()`.
- `apiCleanup._fetch` on cloud goes through `page.evaluate` (cookies); on self-hosted it uses node-fetch
  with Basic Auth. It already handles both — just pass the relative URL to `_fetch`.

## Preconditions / toggles
- No SQL/quick-mode or feature toggle gates this dialog; it is OSS and always available once a 409 occurs.
- The **Merge** button appears only when the save came from the **panel editor** AND the other user did
  **not** touch that same panel. For a Merge test, make the "other user" edit (step 3a/3b) change
  something **other** than the panel being edited (e.g. `description` via API, or a different panel).
- To test **Overwrite's "Remove and overwrite"** wording, make the other user **add** a panel/tab/variable
  that "mine" does not have (so `impact.removes` is non-empty).

## Gotchas (so the Healer/Engineer don't rediscover them)
- **Hash must match on the "other user" PUT.** If the API PUT omits or passes a stale `hash`, it returns
  409 instead of advancing the version, and "mine" then saves cleanly (no conflict). Always fetch the
  `hash` from the GET immediately before the PUT (step 3a).
- **Load order matters.** "Mine" must load the dashboard (or make its edit) **before** the other actor's
  save. If "mine" reloads after them, it picks up the new hash and there is no conflict.
- **Closing without resolving leaves the banner.** `close()` does not clear `unresolvedDashboardId`, so
  after an X/Esc/backdrop close the dashboard view shows `dashboard-unsaved-conflict-banner`. This is
  intended (Workflow 4), not a bug.
- **`addSimplePanel` navigates back to the dashboard view and saves** the panel. For the panel-editor
  conflict, you must be *inside* the panel editor (AddPanel) at save time, not the dashboard view.
- **A `data-test` on `<ODialog>` lands on the panel root** (`ODialog.vue:423`), so scope footer buttons
  with the dialog selector: `[data-test="dashboard-save-conflict-dialog"] [data-test="dashboard-save-conflict-reload"]`.
- **Don't assert on toasts as the sole success signal** — the overwrite/merge/reload toasts are transient
  (default timeout, and 15s for reload). Assert on the dialog closing + dashboard re-render / banner
  disappearing instead; the toast text is a secondary check.
