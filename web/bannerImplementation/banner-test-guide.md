# OBanner Migration — Manual Test Guide

> Tests to verify all 8 `q-banner` → `OBanner` migrations.
> All paths are relative to your OpenObserve base URL, e.g. `http://localhost:5173/default/`.
> Replace `default` with your actual org identifier.

---

## How to trigger a banner

Most banners are error/warning states — they only appear when something goes wrong or specific data is present.
Each entry below tells you **exactly what to do** to make the banner visible.

---

## 1. Error Banner — Logs Search Job Inspector

**File**: `src/plugins/logs/SearchJobInspector.vue`
**Variant**: `error` (red background, white text, error icon)

**UI Path**:
```
/default/logs/inspector
```

**How to trigger**:
1. Navigate to **Logs** → run a scheduled/async search job
2. Click the **Inspector** button in the search results toolbar — this opens the Search Job Inspector page directly at `/default/logs/inspector`
3. The error banner appears at the top when a job fetch fails (e.g., invalid job ID in the URL query params, or network error)

**What to verify**:
- Banner has red background with white text
- Error icon (⚠) appears on the left
- `data-test="inspector-error-banner"` attribute is present (check DevTools)
- No `q-banner` class on the root element — should be `obanner obanner--error`

---

## 2. Error Banner — Trace DAG

**File**: `src/plugins/traces/TraceDAG.vue`
**Variant**: `error` (red background, white text, error icon)

**UI Path**:
```
/default/traces/trace-details?trace_id=<any-trace-id>
```

**How to trigger**:
1. Navigate to **Traces** (`/default/traces`)
2. Click on any trace to open **Trace Details**
3. In the Trace Details view, look for the **DAG tab** (Directed Acyclic Graph)
4. The error banner appears inside the DAG panel if the DAG fetch fails (e.g., pass an invalid/non-existent trace ID in the URL)

**What to verify**:
- Banner shows `"Failed to load DAG: <error message>"`
- Red background, error icon on the left
- No `q-banner` class — root element has `obanner obanner--error`

---

## 3. Error Banner — Query Plan Dialog

**File**: `src/components/QueryPlanDialog.vue`
**Variant**: `error` (red background, white text, error icon)

**UI Path**:
```
/default/logs
```

**How to trigger**:
1. Navigate to **Logs** (`/default/logs`)
2. In the search bar, click the **Explain** / **Query Plan** button (the icon next to the Run button)
3. The Query Plan dialog opens
4. The error banner appears inside the dialog if the query plan fetch fails — trigger by running an invalid SQL query before opening the dialog

**What to verify**:
- Banner appears inside the dialog body
- Red background, error icon
- No `q-banner` class

---

## 4. Warning Banner — Confirm Dialog

**File**: `src/components/ConfirmDialog.vue`
**Variant**: `warning` (amber/orange background, warning icon)

**UI Path** (multiple locations — easiest):
```
/default/logs
```

**How to trigger**:
1. Navigate to **Logs** (`/default/logs`)
2. Open the sidebar and try to **delete a folder** — this triggers a ConfirmDialog with a `warningMessage`
3. Alternatively: go to **Dashboards** → try to delete a dashboard tab

**What to verify**:
- Warning banner appears inside the confirm dialog body (below the main message)
- Amber/yellow-orange background in light mode, dark amber in dark mode — handled automatically by OBanner design tokens (no manual `store.state.theme` switching)
- Warning icon on the left
- No `q-banner` class — root element has `obanner obanner--warning`

---

## 5. Warning Banner — Custom Chart Confirm Dialog

**File**: `src/components/dashboards/addPanel/customChartExamples/CustomChartConfirmDialog.vue`
**Variant**: `warning` (amber/orange background, warning icon)

**UI Path**:
```
/dashboards/add_panel?dashboard=<dashboard-id>&folder=<folder-id>&panelId=<panel-id>&org_identifier=<org>
```
> Easiest entry: open any dashboard → add or edit a panel → select **Custom Chart** as the chart type.

**How to trigger**:
1. Navigate to **Dashboards** (`/default/dashboards`)
2. Open any existing dashboard and **Edit** a panel, or click **Add Panel**
3. In the Panel Editor, set the chart type to **Custom** (the custom chart editor opens)
4. With an existing query/code already in the editor, click a **different custom chart type example** in the chart type selector panel
5. A confirm dialog appears — the warning banner is shown inside it when `warningMessage` is non-empty (the dialog warns that existing chart code will be replaced)

**What to verify**:
- Warning banner appears inside the confirm dialog body
- Amber/orange background in light mode, dark amber in dark mode — via OBanner design tokens (no `store.state.theme` logic)
- Warning icon on the left
- Checkbox "Also replace query with example query" is visible below the banner (when a query exists)
- No `q-banner` class — root element has `obanner obanner--warning`

---

## 6. Warning Banner — Service Identity Setup
**Variant**: `warning` (amber background with border, warning icon, list of warnings)

**UI Path**:
```
/default/settings/correlation
```

**How to trigger**:
1. Navigate to **Settings** → **Correlation** tab (`/default/settings/correlation`)
2. The Service Identity Setup component is embedded here
3. Configure service identity fields that trigger validation warnings (e.g., conflicting field mappings or missing required fields)
4. The warning banner appears in "Section 3: Warnings" when `warnings.length > 0`

**What to verify**:
- Amber background with border (via OBanner `variant="warning"` design tokens)
- Warning icon on the left
- Multi-line list of warning strings rendered in the default slot
- `data-test="service-identity-warnings-banner"` present
- No `q-banner` class

---

## 7. Info Banner — Create Report (PNG note)

**File**: `src/components/reports/CreateReport.vue`
**Variant**: `info` (blue background, info icon, static text)

**UI Path**:
```
/reports/create
```
> Note: Reports are only available when `config.isCloud === "false"` (self-hosted / OSS builds).

**How to trigger**:
1. Navigate to **Reports** (`/reports`)
2. Click **Create Report**
3. In the report creation form, when adding a dashboard, select **PNG** as the report type
4. The info banner appears immediately below the PNG type selector

**What to verify**:
- Banner shows: *"PNG captures only the first visible page of the dashboard. Use PDF if the dashboard spans multiple pages."*
- Blue/info-toned background (OBanner `variant="info"`)
- Info icon on the left
- No `rounded`, `style="font-size"`, or Quasar color classes (`bg-orange-1`, `text-orange-9`)

---

## 8. Info Banner — Pipeline Condition Node

**File**: `src/components/pipeline/NodeForm/Condition.vue`
**Variant**: `info` (blue background, dense, inline icon rows)

**UI Path**:
```
/default/pipeline/pipelines
```

**How to trigger**:
1. Navigate to **Pipeline** → **Pipelines** (`/default/pipeline/pipelines`)
2. Open an existing pipeline or create a new one
3. In the pipeline editor, add or click a **Condition** node
4. The info banner ("Condition value Guidelines") appears in the Condition node form panel

**What to verify**:
- Info-styled banner with reduced padding (`dense`)
- Multiple icon+text rows inside the default slot (OIcon components inline in content)
- No `inline`, `class="note-info"` props — root element has `obanner obanner--info obanner--dense`
- Info and warning icons are inline inside the content rows, not in the `#icon` slot

---

## 9. Info Banner — Pipeline Associate Function Node

**File**: `src/components/pipeline/NodeForm/AssociateFunction.vue`
**Variant**: `info` (blue background, dense, inline icon rows)

**UI Path**:
```
/default/pipeline/pipelines
```

**How to trigger**:
1. Navigate to **Pipeline** → **Pipelines** (`/default/pipeline/pipelines`)
2. Open an existing pipeline or create a new one
3. In the pipeline editor, add or click a **Function** node
4. The info banner ("Function Execution Guidelines") appears in the Function node form panel

**What to verify**:
- Info-styled banner with reduced padding (`dense`)
- Two rows: RBF (Run Before Flattening) and RAF (Run After Flattening) explanations
- No `inline`, `class="note-info"` — root element has `obanner obanner--info obanner--dense`

---

## Quick Checklist

| # | File | UI Path | Variant | Banner Trigger | Done |
|---|---|---|---|---|---|
| 1 | `SearchJobInspector.vue` | `/default/logs/inspector` | error | Job fetch failure | [ ] |
| 2 | `TraceDAG.vue` | `/default/traces/trace-details?trace_id=...` | error | DAG fetch failure | [ ] |
| 3 | `QueryPlanDialog.vue` | `/default/logs` → Explain button | error | Query plan fetch failure | [ ] |
| 4 | `ConfirmDialog.vue` | `/default/logs` → delete a folder | warning | Delete confirmation with warning | [ ] |
| 5 | `CustomChartConfirmDialog.vue` | `/dashboards/add_panel` → Custom chart → switch type | warning | Chart type switch with existing query | [ ] |
| 6 | `ServiceIdentitySetup.vue` | `/default/settings/correlation` | warning | Validation warnings in form | [ ] |
| 7 | `CreateReport.vue` | `/reports/create` | info | Select PNG report type | [ ] |
| 8 | `Condition.vue` | `/default/pipeline/pipelines` → Condition node | info | Open Condition node form | [ ] |
| 9 | `AssociateFunction.vue` | `/default/pipeline/pipelines` → Function node | info | Open Function node form | [ ] |

---

## What to check in DevTools for every banner

1. **No `q-banner` tag** — inspect the DOM, the element should be a `<div>` not a Quasar component
2. **CSS classes** — root element should have `obanner obanner--<variant>` (and `obanner--dense` where applicable)
3. **ARIA role** — `role="alert"` for error/warning variants; `role="status"` for info
4. **No manual color classes** — no `bg-negative`, `text-white`, `bg-orange-1`, `note-info`, `tw:bg-amber-*`, `tw:border-yellow-*`
5. **Dark mode** — toggle dark mode in the UI; colors should switch automatically via CSS variables without any JS logic
