# OBadge Migration — UI Verification Checklist

Branch: `feat/ux-badge` vs `feat/ux-revamp-main`
Total occurrences: **127** across **65 files**

## ✅ Verification status

**Unit tests:** 10 spec files, **531/533 tests passed** (2 skipped, 0 failed) — including OBadge.spec.ts, AlertList.spec.ts, AlertHistory.spec.ts, AlertHistoryDrawer.spec.ts, AddAlert.spec.ts, TagInput.spec.ts, CrossLinkManager.spec.ts, TestModelMatchDialog.spec.ts, EnterpriseUpgradeDialog.spec.ts, FeatureComparisonTable.spec.ts.

**ESLint:** 0 `q-badge` violations, 0 `q-chip` violations remaining.

**Pages verified via Chrome DevTools (light + dark theme):**
- ✅ Alerts list — Training badge rendering (yellow/warning variant)
- ✅ Add Alert form — Stream Type / Stream Name / Alert Type dropdowns + all OIcons
- ✅ Add Alert → Advanced tab → Deduplication step — OIcons in Cycle section
- ✅ Notification Destinations — "Custom (Webhook)" default-variant badge
- ✅ Incidents list — P3 severity (warning-soft), Open (error-soft), Acknowledged (warning), Resolved (success-outline), dimension chips (primary-outline / warning-outline)
- ✅ Incident detail drawer — header status (Open), severity (P3), alert count (38 Alerts) badges
- ✅ Reports list — renders cleanly (no PNG/Preview state to verify here)
- ✅ About → Enterprise License Details — "Active" success badge
- ✅ Pipelines list + Pipeline History — clean rendering
- ✅ Predefined Themes drawer — "Applied" success badge for both Light Mode and Dark Mode tabs (× 4 occurrences confirmed)
- ✅ Dashboard Settings → Variables — clean rendering (no variables defined in test dashboard)

**Bugs fixed during verification** (13 distinct fixes — see [Bugs fixed during verification](#bugs-fixed-during-verification) section below).



Each row is one `<OBadge>` instance — visit the listed UI location, verify it renders correctly in **light + dark** themes, and check the browser console for errors/warnings.

## 🗺️ Quick route map

| Area | Primary URL | Sidebar item |
|------|-------------|--------------|
| Alerts / Destinations / Incidents | `/alerts` | **Alerts** |
| Logs / Patterns | `/logs` | **Logs** (→ **Patterns** sub-tab) |
| Traces | `/traces` | **Traces** |
| Dashboards | `/dashboards` | **Dashboards** |
| Reports | `/reports` | **Reports** |
| Pipelines / Backfill | `/pipelines` | **Pipelines** |
| Functions / Enrichment Tables | `/functions` | **Functions** |
| Streams (Performance Fields, Cross Links) | `/streams` | **Streams** |
| Data Sources / Ingestion | `/ingestion` | **Data Sources** |
| Anomaly Detection | `/anomaly` | **Anomaly Detection** |
| RUM | `/rum` | **RUM** |
| IAM (Roles, Service Accounts) | `/iam` | **IAM** |
| Telemetry Correlation | `/correlation` (or via traces side-panel) | **Telemetry Correlation** |
| Management (Settings → Models / Patterns / Service Identity / Nodes / Storage / License / AI Toolsets) | `/settings` | Top-right user menu → **Management** |
| Themes / Appearance | `/settings` → Themes | Top-right user menu → **Profile** / **Appearance** |
| About | `/about` | Top-right user menu → **About** |
| Billings (Enterprise, Pro plans) | `/billings` | Top-right user menu → **Billings** |
| Correlation Demo | `/correlation-demo` | (direct route) |

**Login:** `http://localhost:8081` — user `god@main.ai` / `Kingpin#451`. Compare against main env: `https://main.o2aks1.internal.zinclabs.dev`.

---

## 1. Alerts (`/alerts`)

### 🧭 Navigation paths

| Component | Where to find it in the UI |
|-----------|---------------------------|
| **AlertList** status badge | Left sidebar → **Alerts** → **Alerts** tab → scan the **Status** column (each row) |
| **AddAlert** anomaly badge | Left sidebar → **Alerts** → **Alerts** tab → click **"+ Add Alert"** → switch alert type to **"Anomaly"** → scroll to anomaly section; badge appears once a status value is computed |
| **AddDestination** read-only badge | Left sidebar → **Alerts** → **Destinations** tab → click **"+ Add Destination"** (or edit an existing one) → look for the read-only indicator near "Type" |
| **AlertsDestinationList** badges | Left sidebar → **Alerts** → **Destinations** tab → look at the **Type** column for each row (prebuilt vs custom) |
| **AlertHistory** badges | Left sidebar → **Alerts** → **Alert History** tab → see Status column rows; click a row → side panel opens (second badge in detail) |
| **AlertHistoryDrawer** badge | Left sidebar → **Alerts** → **Alerts** tab → on any alert row click the **"⋮"** (kebab) → **"View History"** → drawer opens → Status column |
| **ImportSemanticGroups** dialog badges | Left sidebar → **Alerts** → **Alerts** tab → click **"⋮"** (top right) or "Import" → **"Import Semantic Groups"** → upload/paste a JSON with additions/modifications/unchanged groups → diff summary chips + per-group field chips appear |
| **ImportSemanticGroupsDrawer** badges | Same as above but the **drawer** variant (depends on layout — appears as a side drawer on smaller widths) |
| **IncidentDetailDrawer** badges | Left sidebar → **Alerts** → **Incidents** tab → click any incident row → drawer opens; badges shown in header (status, severity, alert count) + stream type badge in alert detail section |
| **IncidentAlertTriggersTable** badge | Inside the same Incident drawer → scroll to **Alert Triggers** table → **Correlation Reason** column |
| **TagInput** chips | Anywhere a tag/label input is used in alerts forms (e.g. **+ Add Alert** → labels field) — type and press Enter to add tags |

### Per-row OBadge inventory

| File | Line | Variant | Label / content | Notes | UI condition |
|------|------|---------|---------------|-------|--------------|
| [AddDestination.vue](web/src/components/alerts/AddDestination.vue) | 95 | `default` | `t("alert_destinations.readonly")` | size="sm" | Destination type display (edit mode) |
| [AlertList.vue](web/src/components/alerts/AlertList.vue) | 307 | dyn — `error`/`success`/`warning`/`default` | `props.row[col.field]` | text-transform: capitalize | Status column when row.status exists and ≠ '--' |
| [AlertHistory.vue](web/src/components/alerts/AlertHistory.vue) | 159 | `getStatusVariant(row.status)` | `props.row.status` | size="sm", data-test="alert-history-status-chip" | Status column in alert history table |
| [AlertHistory.vue](web/src/components/alerts/AlertHistory.vue) | 329 | `getStatusVariant(selectedRow.status)` | `selectedRow.status` | size="sm" | Drawer detail when row selected |
| [AddAlert.vue](web/src/components/alerts/AddAlert.vue) | 58 | `anomalyStatusVariant` | `anomalyConfig.status` | v-if anomalyConfig.status, text-caption | When anomaly config has a status value |
| [AlertHistoryDrawer.vue](web/src/components/alerts/AlertHistoryDrawer.vue) | 253 | `getStatusChipVariant(row.status)` | `formatStatus(row.status)` | size="sm", :icon, OTooltip for errors | Drawer history table status column |
| [ImportSemanticGroups.vue](web/src/components/alerts/ImportSemanticGroups.vue) | 83 | `success` | `<strong>{additions.length}</strong>&nbsp;New` | class="summary-chip" | Count of new groups in diff |
| [ImportSemanticGroups.vue](web/src/components/alerts/ImportSemanticGroups.vue) | 88 | `warning` | `<strong>{modifications.length}</strong>&nbsp;Modified` | class="summary-chip" | Count of modified groups in diff |
| [ImportSemanticGroups.vue](web/src/components/alerts/ImportSemanticGroups.vue) | 93 | `default` | `{unchanged.length} Unchanged` | class="summary-chip" | Count of unchanged groups in diff |
| [ImportSemanticGroups.vue](web/src/components/alerts/ImportSemanticGroups.vue) | 146 | `primary` | `norm` | v-if group.normalize, q-ml-xs | When a group is marked as normalized |
| [ImportSemanticGroups.vue](web/src/components/alerts/ImportSemanticGroups.vue) | 251 | `primary` | `{selectedGroup?.fields}` | v-for loop, q-ma-xs | Each field in group detail dialog |
| [ImportSemanticGroups.vue](web/src/components/alerts/ImportSemanticGroups.vue) | 260 | `primary` | `Normalized` | v-if normalize | When group is normalized in detail dialog |
| [ImportSemanticGroups.vue](web/src/components/alerts/ImportSemanticGroups.vue) | 261 | `default` | `Not Normalized` | v-else | When group is not normalized in detail |
| [ImportSemanticGroups.vue](web/src/components/alerts/ImportSemanticGroups.vue) | 280 | `default` | `{field}` (modifications.current) | v-for, size="sm", q-ma-xs | Each current field in modification compare |
| [ImportSemanticGroups.vue](web/src/components/alerts/ImportSemanticGroups.vue) | 295 | dyn — `success` or `default` | `{field}` with OIcon "add" | v-for, isNewField check | Each proposed field (new fields highlighted) |
| [AlertsDestinationList.vue](web/src/components/alerts/AlertsDestinationList.vue) | 130 | `primary` | `getPrebuiltTypeName(row)` | data-test="destination-type-badge-..." | Prebuilt destination type in list |
| [AlertsDestinationList.vue](web/src/components/alerts/AlertsDestinationList.vue) | 143 | `default` | `getCustomDestinationLabel(row)` | data-test="destination-type-badge-custom" | Custom destination label in list |
| [ImportSemanticGroupsDrawer.vue](web/src/components/alerts/ImportSemanticGroupsDrawer.vue) | 58 | `success` | `<strong>{additions.length}</strong>&nbsp;New` | multi-line | Count of new groups (drawer) |
| [ImportSemanticGroupsDrawer.vue](web/src/components/alerts/ImportSemanticGroupsDrawer.vue) | 64 | `warning` | `<strong>{modifications.length}</strong>&nbsp;Modified` | multi-line | Count of modified groups (drawer) |
| [ImportSemanticGroupsDrawer.vue](web/src/components/alerts/ImportSemanticGroupsDrawer.vue) | 70 | `default` | `{unchanged.length} Unchanged` | multi-line | Count of unchanged groups (drawer) |
| [ImportSemanticGroupsDrawer.vue](web/src/components/alerts/ImportSemanticGroupsDrawer.vue) | 263 | `primary` | `{field}` | v-for, q-ma-xs | Each field in group detail drawer |
| [ImportSemanticGroupsDrawer.vue](web/src/components/alerts/ImportSemanticGroupsDrawer.vue) | 290 | `default` | `{field}` (current) | v-for, size="sm", q-ma-xs | Each current field in drawer compare |
| [ImportSemanticGroupsDrawer.vue](web/src/components/alerts/ImportSemanticGroupsDrawer.vue) | 307 | dyn — `success` or `default` | `{field}` with OIcon | v-for, isNewField check | Each proposed field (drawer) |
| [TagInput.vue](web/src/components/alerts/TagInput.vue) | 22 | `default` | `{tag}` | v-for, size="sm", #trailing remove button | Each tag in TagInput |
| [IncidentAlertTriggersTable.vue](web/src/components/alerts/IncidentAlertTriggersTable.vue) | 57 | `getReasonVariant(correlation_reason)` | `getReasonLabel(...)` with q-tooltip | data-test="correlation-reason-badge" | Correlation reason in triggers table |
| [IncidentDetailDrawer.vue](web/src/components/alerts/IncidentDetailDrawer.vue) | 71 | `getStatusVariant(incidentDetails.status)` | `getStatusLabel(...)` with icon | height="33px", OTooltip, icon="info" | Incident status badge in header |
| [IncidentDetailDrawer.vue](web/src/components/alerts/IncidentDetailDrawer.vue) | 84 | `getSeverityVariant(severity)` | `incidentDetails.severity` with icon | height="33px", OTooltip, icon="warning" | Severity badge in header |
| [IncidentDetailDrawer.vue](web/src/components/alerts/IncidentDetailDrawer.vue) | 97 | `primary-outline` | `{triggers.length} Alerts` with icon | height="33px", OTooltip, icon="notifications-active" | Alert count badge in header |
| [IncidentDetailDrawer.vue](web/src/components/alerts/IncidentDetailDrawer.vue) | 917 | `primary` | `alerts[selectedAlertIndex]?.stream_type \|\| 'N/A'` | tw:w-fit | Stream type display in incident detail |

**Subtotal: 29 occurrences**

---

## 2. Settings (`/settings`) + Views + Themes

### 🧭 Navigation paths

| Component | Where to find it in the UI |
|-----------|---------------------------|
| **AiToolsets** kind badge | Top-right user menu → **Management** → **AI Toolsets** tab → look at the **Kind** column for each row (`LLM`/`LOCAL`/`CUSTOM`) |
| **ServiceIdentityConfig** example chips | Top-right user menu → **Management** → **Service Identity** → **Config** sub-section → scroll to the template/help section (k8s-cluster=prod, k8s-deployment=api-server examples) |
| **Nodes** region/cluster badges | Top-right user menu → **Management** → **Nodes** tab → table → **Region** and **Cluster** columns (only if super-cluster mode is enabled) |
| **ServiceIdentitySetup** cardinality badges | Top-right user menu → **Management** → **Service Identity** → **Setup** wizard → open any cardinality field dropdown — each option may show `cardinalityLabel` + `recommended` badges. The 1367/1381 badges appear in the cardinality detail panel after selecting a service. |
| **BuiltInPatternsTab** tag badges | Top-right user menu → **Management** → **Patterns** tab → **Built-in** sub-tab → each pattern card shows up to 3 tag badges; click a pattern → preview modal shows all tags |
| **TestModelMatchDialog** source badge | Top-right user menu → **Management** → **Models** → click **"Test Match"** on any model → enter test data → submit → result section shows source badge |
| **License** status badge | Top-right user menu → **Management** → **License** tab → look at status column (Active/Expired) |
| **OrgStorageSettings** active badge | Top-right user menu → **Management** → **Organization Storage** → configured provider section → badge with check-circle icon next to "Active" |
| **PredefinedThemes** Applied badges | Top-right user menu → **Profile/Settings** → **Themes / Appearance** → light/dark theme grids → currently-applied theme shows "Applied" badge (× 4 — light theme, light custom, dark theme, dark custom) |
| **About license** badge | Top-right user menu → **About** (or `/about`) → License Information row → Active/Expired badge |

### Per-row OBadge inventory

| File | Line | Variant | Label / content | Notes | UI condition |
|------|------|---------|---------------|-------|--------------|
| [AiToolsets.vue](web/src/components/settings/AiToolsets.vue) | 85 | `kindBadgeVariant(row.kind)` | `row.kind.toUpperCase()` | size="sm" | Table cell — toolset kind (LLM/LOCAL/CUSTOM) |
| [ServiceIdentityConfig.vue](web/src/components/settings/ServiceIdentityConfig.vue) | 65 | `primary` | `k8s-cluster=prod` | size="sm", example-chip | Template example dimension 1 |
| [ServiceIdentityConfig.vue](web/src/components/settings/ServiceIdentityConfig.vue) | 73 | `primary` | `k8s-deployment=api-server` | size="sm", example-chip | Template example dimension 2 |
| [ServiceIdentityConfig.vue](web/src/components/settings/ServiceIdentityConfig.vue) | 81 | `success` | `prod/api-server` | size="sm", example-chip | Template example value/correlation |
| [Nodes.vue](web/src/components/settings/Nodes.vue) | 599 | `default` | `row.region` + OTooltip | badge-region q-mr-xs | If super_cluster_enabled — region |
| [Nodes.vue](web/src/components/settings/Nodes.vue) | 603 | `default` | `row.cluster` + OTooltip | badge-cluster | If super_cluster_enabled — cluster |
| [ServiceIdentitySetup.vue](web/src/components/settings/ServiceIdentitySetup.vue) | 430 | dyn — `${cardinalityColor}-outline` | `cardinalityLabel` | v-if, tw:text-[10px] | Dropdown option label |
| [ServiceIdentitySetup.vue](web/src/components/settings/ServiceIdentitySetup.vue) | 437 | `success-outline` | `recommended` | v-if, tw:text-[10px] | Dropdown option flag |
| [ServiceIdentitySetup.vue](web/src/components/settings/ServiceIdentitySetup.vue) | 529 | dyn — `${cardinalityColor}-outline` | `cardinalityLabel` | v-if, tw:text-[10px] | Dropdown option label (2nd usage) |
| [ServiceIdentitySetup.vue](web/src/components/settings/ServiceIdentitySetup.vue) | 536 | `success-outline` | `recommended` | v-if, tw:text-[10px] | Dropdown option flag (2nd usage) |
| [ServiceIdentitySetup.vue](web/src/components/settings/ServiceIdentitySetup.vue) | 1367 | `cardinalityColor(...)` | numeric cardinality | tw:px-2 | Cardinality detail section count |
| [ServiceIdentitySetup.vue](web/src/components/settings/ServiceIdentitySetup.vue) | 1381 | `${cardinalityColor(...)}-outline` | `cardinality_class` or "Unknown" | multi-line | Cardinality classification label |
| [BuiltInPatternsTab.vue](web/src/components/settings/BuiltInPatternsTab.vue) | 118 | `primary` | tag (looped 0-3) | size="sm", v-for | Pattern list item tag badges (up to 3) |
| [BuiltInPatternsTab.vue](web/src/components/settings/BuiltInPatternsTab.vue) | 126 | default | `+{count}` overflow | size="sm", v-if | Count of additional tags if > 3 |
| [BuiltInPatternsTab.vue](web/src/components/settings/BuiltInPatternsTab.vue) | 199 | `primary` | all tags | v-for | Pattern preview modal all tags |
| [TestModelMatchDialog.vue](web/src/components/settings/TestModelMatchDialog.vue) | 150 | `sourceColor(testResult.matched)` | `sourceLabel(testResult.matched)` | tmm-source-badge | Test result — matched model source |
| [License.vue](web/src/components/settings/License.vue) | 102 | `licenseData?.expired ? 'error' : 'success'` | `expired_lbl` / `active_lbl` | — | License table status |
| [OrgStorageSettings.vue](web/src/components/settings/OrgStorageSettings.vue) | 190 | `success` | `storage_settings.active` + check icon | OIcon "check-circle" in slot | Below configured provider — active config |
| [PredefinedThemes.vue](web/src/components/PredefinedThemes.vue) | 63 | `success` | `Applied` | size="sm", v-if | Light mode theme card — currently applied |
| [PredefinedThemes.vue](web/src/components/PredefinedThemes.vue) | 103 | `success` | `Applied` | size="sm", v-if | Light mode custom color card — applied |
| [PredefinedThemes.vue](web/src/components/PredefinedThemes.vue) | 137 | `success` | `Applied` | size="sm", v-if | Dark mode theme card — currently applied |
| [PredefinedThemes.vue](web/src/components/PredefinedThemes.vue) | 177 | `success` | `Applied` | size="sm", v-if | Dark mode custom color card — applied |
| [About.vue](web/src/views/About.vue) | 212 | `licenseData?.expired ? 'error' : 'success'` | `expired_lbl` / `active_lbl` | — | License details table status |

**Subtotal: 23 occurrences**

---

## 3. Traces / Correlation / Patterns

### 🧭 Navigation paths

| Component | Where to find it in the UI |
|-----------|---------------------------|
| **SearchResult** count + error badges | Left sidebar → **Traces** → run a search (any time range) → above the result list, two badges show: total count and (if any errors exist) error count |
| **TraceEvaluationsView** dim/verdict badges | Left sidebar → **Traces** → click any trace that has LLM evaluations → switch the right sidebar to the **Evaluations** tab. Need a trace with at least one evaluation record. Shows: weakest dimension (warning), dimension verdicts (success/error), template badge, exit status. |
| **TraceDetailsSidebar** header toolbar chips | Left sidebar → **Traces** → click any trace → sidebar opens → header toolbar shows: Service, Duration, TTFT (if present), Start, Resends (if present), Span ID (clickable to copy). For LLM spans: observation-type badge + Model / In tokens / Out tokens / Cost / Provider chips + Errors badge (if exception events exist). |
| **LLMContentRenderer** Tool/CallID badges | Left sidebar → **Traces** → open an LLM-instrumented trace → click an LLM span → if it's a tool call, the rendered content shows "Tool: {name}" (warning) and "Call ID: {id}" (default) |
| **TelemetryCorrelationPanel** dimension badges | Left sidebar → **Traces** (or **Logs**) → open any trace/log that has correlation metadata → side panel shows matched dimensions (success) + additional/filter dimensions (default-outline) |
| **TelemetryCorrelationDashboard** badges | Left sidebar → **Telemetry Correlation** (if available, may also reach via `/correlation`) → at top of metric group selector → tab counts + "{count} Traces" badges. The 7 occurrences are spread across header, tabs, dialog, and dimension-correlation section. |
| **TraceDAG** error badge | Left sidebar → **Traces** → open any trace with error spans → switch to **DAG** view (graph icon) → any node with `span_status === 'ERROR'` shows a red "error" badge |
| **ThreadView** thread-chip metrics | Left sidebar → **Traces** → open a multi-turn LLM trace → switch to **Thread** view → top summary panel shows: Steps, Tools, Duration, Cost, Model (dominant model, if any), Errors (if any) |
| **PatternDetailsDialog** badges | Left sidebar → **Logs** → switch to **Patterns** sub-tab → click any pattern → details dialog opens → wildcard tokens (default badges) + variable types table |
| **PatternCard** wildcard badges | Left sidebar → **Logs** → **Patterns** sub-tab → each pattern card shows inline wildcard token badges |

### Per-row OBadge inventory

| File | Line | Variant | Label / content | Notes | UI condition |
|------|------|---------|---------------|-------|--------------|
| [SearchResult.vue](web/src/plugins/traces/SearchResult.vue) | 34 | `default` | total count traces/spans | data-test="traces-count-badge", tw:rounded! | Header — search result count |
| [SearchResult.vue](web/src/plugins/traces/SearchResult.vue) | 39 | `warning` | error count | v-if errorCount > 0, data-test="traces-error-count-badge" | Only when traces have errors |
| [TraceEvaluationsView.vue](web/src/plugins/traces/TraceEvaluationsView.vue) | 220 | `warning` | weakest dimension label | — | Weakest evaluation dimension |
| [TraceEvaluationsView.vue](web/src/plugins/traces/TraceEvaluationsView.vue) | 246 | dyn — `success`/`error` | `getDimVerdict()` (PASS/FAIL) | eval-badge-sm | Template dimensions verdict |
| [TraceEvaluationsView.vue](web/src/plugins/traces/TraceEvaluationsView.vue) | 370 | `primary-outline` | `traces.evaluations.templateBadge` | eval-badge-sm | When dimension is template type |
| [TraceEvaluationsView.vue](web/src/plugins/traces/TraceEvaluationsView.vue) | 378 | dyn — `success`/`error` | `getDimVerdict()` (PASS/FAIL) | eval-badge-sm | Template dimensions verdict display |
| [TraceEvaluationsView.vue](web/src/plugins/traces/TraceEvaluationsView.vue) | 425 | dyn — `success`/`error` | `exit_status?.toUpperCase()` or `UNKNOWN` | size="sm" | Evaluation exit status |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 43 | `getObservationTypeVariant()` | LLM operation type | v-if isLLMSpan, observation-type-badge | LLM span header badge |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 73 | dyn | `Service` | size="sm", #icon slot, toolbar-chip service-chip | Toolbar — service name |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 97 | dyn | `Duration` | size="sm", toolbar-chip duration-chip | Toolbar — span duration |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 109 | dyn | `TTFT` | v-if getTTFT, size="sm", ttft-chip | Optional TTFT metric |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 122 | dyn | `Start` | size="sm", time-chip | Toolbar — start time |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 134 | dyn | `Resends` | v-if spanHttpResendCount, resend-chip | Optional resend count |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 149 | dyn | span ID | clickable, span-id-chip, @click=copySpanId | Clickable span ID with copy icon |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 195 | dyn | LLM model name | icon="psychology", llm-chip model-chip | LLM metrics — model |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 207 | dyn | `In` (input tokens) | llm-chip token-chip input-token-chip | Input token count |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 218 | dyn | `Out` (output tokens) | llm-chip token-chip output-token-chip | Output token count |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 230 | dyn | cost amount | icon="attach_money", llm-chip cost-chip | Total LLM cost |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 244 | `primary` | provider name | v-if span.gen_ai_provider_name, provider-badge | LLM provider |
| [TraceDetailsSidebar.vue](web/src/plugins/traces/TraceDetailsSidebar.vue) | 286 | `error` | exception count | v-if hasExceptionEvents.length, data-test="trace-details-sidebar-tabs-error-count" | Error tab count |
| [LLMContentRenderer.vue](web/src/plugins/traces/LLMContentRenderer.vue) | 22 | `warning` | `Tool: {toolName}` | v-if toolMetadata.name, q-mr-sm | Tool observation metadata |
| [LLMContentRenderer.vue](web/src/plugins/traces/LLMContentRenderer.vue) | 27 | `default` | `Call ID: {callId}` | v-if toolMetadata.callId | Tool call ID metadata |
| [TelemetryCorrelationPanel.vue](web/src/components/TelemetryCorrelationPanel.vue) | 56 | `success` | matched dimension key=value | v-for, size="sm" | Matched dimensions from correlation |
| [TelemetryCorrelationPanel.vue](web/src/components/TelemetryCorrelationPanel.vue) | 80 | `default-outline` | additional dimension key=value | v-for, size="sm" | Optional filter dimensions |
| [TelemetryCorrelationPanel.vue](web/src/components/TelemetryCorrelationPanel.vue) | 97 | dyn | all dimensions (fallback) | v-for, size="sm" | Fallback dimension display |
| [TelemetryCorrelationDashboard.vue](web/src/plugins/correlation/TelemetryCorrelationDashboard.vue) | 225 | `default` | `group.streams.length` | tw:ml-1 | Metric group header count |
| [TelemetryCorrelationDashboard.vue](web/src/plugins/correlation/TelemetryCorrelationDashboard.vue) | 326 | dyn — `primary`/`default` | tab group count | activeMetricGroupTab check, tw:ml-0.5 | Metric tab dynamic badge |
| [TelemetryCorrelationDashboard.vue](web/src/plugins/correlation/TelemetryCorrelationDashboard.vue) | 505 | `primary` | `{count} Traces` | — | Dimension-based correlation trace count |
| [TelemetryCorrelationDashboard.vue](web/src/plugins/correlation/TelemetryCorrelationDashboard.vue) | 707 | `default` | `group.streams.length` | tw:ml-1 | Metric selector dialog group header |
| [TelemetryCorrelationDashboard.vue](web/src/plugins/correlation/TelemetryCorrelationDashboard.vue) | 816 | dyn — `primary`/`default` | tab group count | tw:ml-0.5 | Metric group tabs dynamic badge |
| [TelemetryCorrelationDashboard.vue](web/src/plugins/correlation/TelemetryCorrelationDashboard.vue) | 975 | `primary` | `{count} Traces` | — | Dimension-based correlation section |
| [TelemetryCorrelationDashboard.vue](web/src/plugins/correlation/TelemetryCorrelationDashboard.vue) | 1084 | `default` | `group.streams.length` | tw:ml-1 | Metric selector dialog group count |
| [TraceDAG.vue](web/src/plugins/traces/TraceDAG.vue) | 66 | `error` | error indicator | v-if span_status === 'ERROR', size="sm", error-chip | Error status in DAG node |
| [ThreadView.vue](web/src/plugins/traces/ThreadView.vue) | 35 | dyn | `Steps` | size="sm", thread-chip thread-chip--steps | LLM step count in thread summary |
| [ThreadView.vue](web/src/plugins/traces/ThreadView.vue) | 45 | dyn | `Tools` | size="sm", thread-chip--tools | Tool call count in thread |
| [ThreadView.vue](web/src/plugins/traces/ThreadView.vue) | 51 | dyn | `Duration` | size="sm", thread-chip--duration | Total duration in thread |
| [ThreadView.vue](web/src/plugins/traces/ThreadView.vue) | 59 | dyn | `Cost` | size="sm", thread-chip--cost | Total cost in thread |
| [ThreadView.vue](web/src/plugins/traces/ThreadView.vue) | 67 | dyn | dominantModel name | v-if, size="sm", thread-chip--model, :title | Dominant LLM model badge |
| [ThreadView.vue](web/src/plugins/traces/ThreadView.vue) | 78 | dyn | `Errors` | v-if errorCount > 0, size="sm", thread-chip--error | Error count in thread |
| [PatternDetailsDialog.vue](web/src/plugins/logs/patterns/PatternDetailsDialog.vue) | 149 | `default` | wildcard token | size="sm", wildcard-chip-detail, dyn styling via wildcardChipColor() | Pattern wildcard token in dialog |
| [PatternDetailsDialog.vue](web/src/plugins/logs/patterns/PatternDetailsDialog.vue) | 190 | `default` | variable type name | size="sm", theme-conditional styling | Pattern variable type badge in table |
| [PatternCard.vue](web/src/plugins/logs/patterns/PatternCard.vue) | 62 | `default` | wildcard token | size="sm", wildcard-chip, dyn styling | Inline pattern wildcard token |

**Subtotal: 41 occurrences**

---

## 4. Dashboards / Pipelines / RUM / Reports / Functions / IAM / Cross-link / Anomaly / Ingestion / AI Toolsets / Billing / Logstream

### 🧭 Navigation paths

| Component | Where to find it in the UI |
|-----------|---------------------------|
| **VariableSettings** scope badges | Left sidebar → **Dashboards** → open any dashboard → top-right gear ⚙ → **Variables** tab → each variable row shows scope: Global / Tabs (count) / Panels (count) |
| **BackfillJobDetails** status badges | Left sidebar → **Pipelines** → **Backfill Jobs** sub-tab → click any job → details view → top status badge + deletion-status badge in details card |
| **PipelineHistory** status badges | Left sidebar → **Pipelines** → click any pipeline → **History** tab → Status column (table) + Status in side-panel when a row is clicked |
| **FrustrationBadge** count | Left sidebar → **RUM** → **User Sessions** → any row with frustration count > 0 shows the badge (also shown in dashboards/widgets that include this component) |
| **FrustrationEventBadge** type chips | Left sidebar → **RUM** → **User Sessions** → click a session → event timeline shows frustration event types |
| **ReportList** PNG / Preview badges | Left sidebar → **Reports** → table → **Type** column (PNG) + **Preview** column |
| **EnrichmentTableList** URL job status | Left sidebar → **Functions** → **Enrichment Tables** sub-tab → URL-import jobs section → status badge per job |
| **ServiceAccountsList** system badges | Left sidebar → **IAM** → **Service Accounts** → "system" badge in name column for system accounts + "System Managed" in actions cell |
| **CrossLinkManager** Stream/Global + field badges | Left sidebar → **Logs/Streams** → open a stream → **Cross Links** tab (or stream settings) → each link shows Stream/Global badge + truncated field names |
| **CrossLinkDialog** field chips | Same as above → click **"+ Add Cross Link"** or edit one → dialog opens → "Fields" input shows each selected field as a removable OBadge |
| **AnomalyDetectionList** status + spinner | Left sidebar → **Anomaly Detection** (or `/anomaly`) → table → Status column. For rows with status `training`, the badge contains an inline spinner. |
| **AnomalyAlerting** selected-item chips | Left sidebar → **Anomaly Detection** → **Create / Edit** → **Alerting** step → in the "Destinations" multi-select → each selected destination renders as an OBadge chip with close button |
| **AWSQuickSetup** primary chips | Left sidebar → **Data Sources** / **Ingestion** → **Recommended** → **AWS Quick Setup** → 3 badges: service-selection count, target-regions count, per-region chip list |
| **AddAiToolset** clickable preset chips | Top-right user menu → **AI Toolsets** → click **"+ Add Toolset"** → CLI presets section → clickable badges (one per preset) |
| **PerformanceFieldsDialog** field chips | Left sidebar → **Streams** → open any stream → **Stream Details** → "Performance Fields" / "Full-text Search Fields" dialog → each configured field shows as a removable OBadge |
| **enterprisePlan** discount badge | Top-right user menu → **Billings** → Enterprise plan card → top discount tag chip |
| **plans.vue** AI-credits / Marketplace | Top-right user menu → **Billings** → Plans grid → AI credits status badge + (if Marketplace billing) AWS/Azure Marketplace badge |
| **proPlan** Marketplace badges | Top-right user menu → **Billings** → Pro plan card → AWS/Azure Marketplace badges (only visible when billingProvider matches) |
| **CorrelationDemo** demo badges | Visit `/correlation-demo` directly → "Current Status" section → Service Streams enabled (success) / disabled (error) |

### Per-row OBadge inventory

| File | Line | Variant | Label / content | Notes | UI condition |
|------|------|---------|---------------|-------|--------------|
| [VariableSettings.vue](web/src/components/dashboards/settings/VariableSettings.vue) | 111 | `primary` | `Global` | scope-type indicator | When `getScopeType(variable) === 'global'` |
| [VariableSettings.vue](web/src/components/dashboards/settings/VariableSettings.vue) | 117 | `primary-soft` | `{tabs?.length \|\| 0} Tabs` | count of tabs | When `getScopeType(variable) === 'tabs'` |
| [VariableSettings.vue](web/src/components/dashboards/settings/VariableSettings.vue) | 123 | `primary-outline` | `{panels?.length \|\| 0} Panels` | count of panels | When `getScopeType(variable) === 'panels'` |
| [BackfillJobDetails.vue](web/src/components/pipelines/BackfillJobDetails.vue) | 32 | `getStatusColor(status, deletion_status)` | `getStatusLabel(...)` | text-lg q-pa-sm | Job status header — dynamic color |
| [BackfillJobDetails.vue](web/src/components/pipelines/BackfillJobDetails.vue) | 113 | `getDeletionStatusColor(deletion_status)` | `getDeletionStatusLabel(...)` | details card | Deletion job status in details card |
| [PipelineHistory.vue](web/src/components/pipelines/PipelineHistory.vue) | 172 | `getStatusVariant(row.status)` | `props.row.status` | size="sm" | Pipeline status table cell |
| [PipelineHistory.vue](web/src/components/pipelines/PipelineHistory.vue) | 314 | `getStatusVariant(selectedRow.status)` | `selectedRow.status` | size="sm" | Status in side-panel for selected row |
| [FrustrationBadge.vue](web/src/components/rum/FrustrationBadge.vue) | 19 | `badgeVariant` | `{count}` | v-if count > 0, tooltip, data-test | Frustration count when > 0 |
| [FrustrationEventBadge.vue](web/src/components/rum/FrustrationEventBadge.vue) | 22 | `getBadgeVariant(type)` | `getBadgeLabel(type)` | v-for over frustrationTypes, tooltip | Each frustration event type |
| [ReportList.vue](web/src/components/reports/ReportList.vue) | 185 | `primary-outline` | `PNG` | conditional | When `report_type === 'png'` |
| [ReportList.vue](web/src/components/reports/ReportList.vue) | 192 | `default-outline` | `Preview` | conditional | When `imagePreview` truthy |
| [EnrichmentTableList.vue](web/src/components/functions/EnrichmentTableList.vue) | 317 | dyn — `success`/`error`/`primary`/`default` | `job.status` | in q-item-label | URL job status (completed/failed/processing/default) |
| [ServiceAccountsList.vue](web/src/components/iam/serviceAccounts/ServiceAccountsList.vue) | 82 | `primary-soft` | `system` | size="sm" | When `row.is_system` is true (name column) |
| [ServiceAccountsList.vue](web/src/components/iam/serviceAccounts/ServiceAccountsList.vue) | 104 | `default` | `t('serviceAccounts.systemManaged')` | OTooltip slot | When `row.is_system` true (actions cell) |
| [CrossLinkManager.vue](web/src/components/cross-linking/CrossLinkManager.vue) | 36 | `link._source === 'stream' ? 'primary' : 'default'` | `Stream` / `Global` | — | Cross-link source type |
| [CrossLinkManager.vue](web/src/components/cross-linking/CrossLinkManager.vue) | 50 | (default) | `field.name` | v-for, truncated | Each field name from `link.fields` |
| [CrossLinkDialog.vue](web/src/components/cross-linking/CrossLinkDialog.vue) | 52 | `default` | `field.name` | size="sm", v-for, #trailing close button, data-test | Removable field badges in dialog |
| [AnomalyDetectionList.vue](web/src/components/anomaly_detection/AnomalyDetectionList.vue) | 49 | `statusColor(row)` | `statusLabel(row)` | conditional OSpinner slot for `training` | Anomaly detection status (spinner if training) |
| [AnomalyAlerting.vue](web/src/components/anomaly_detection/steps/AnomalyAlerting.vue) | 75 | `primary` | (preset/selected-item label) | size="sm" | `#selected-item` template in alerts.destination select |
| [PerformanceFieldsDialog.vue](web/src/components/logstream/PerformanceFieldsDialog.vue) | 29 | `primary-soft` | `field.name` | size="sm", v-for, #trailing close button, q-mr-xs q-mb-xs | Full-text search fields — removable badges |
| [enterprisePlan.vue](web/src/enterprise/components/billings/enterprisePlan.vue) | 24 | `primary-soft` | `t('billing.discountTag')` | border-radius: 0px | Discount tag at top of plan card |
| [plans.vue](web/src/enterprise/components/billings/plans.vue) | 38 | `aiModeBadgeVariant` | `aiModeLabel` | width: fit-content, q-mt-sm | AI credits mode in billing cards |
| [plans.vue](web/src/enterprise/components/billings/plans.vue) | 74 | `success-soft` | `Managed via AWS Marketplace` | icon="check_circle", q-px-md q-py-sm | When `billingProvider === 'aws'` |
| [plans.vue](web/src/enterprise/components/billings/plans.vue) | 86 | `success-soft` | `Managed via Azure Marketplace` | icon="check_circle", q-px-md q-py-sm | When `billingProvider === 'azure'` |
| [proPlan.vue](web/src/enterprise/components/billings/proPlan.vue) | 78 | `success-soft` | `Managed via AWS Marketplace` | icon="check_circle" | AWS Marketplace badge |
| [proPlan.vue](web/src/enterprise/components/billings/proPlan.vue) | 84 | `success-soft` | `Managed via Azure Marketplace` | icon="check_circle" | Azure Marketplace badge |

### Verified line numbers from second pass

| File | Line | Variant | Label / content | Notes | UI condition |
|------|------|---------|---------------|-------|--------------|
| [AnomalyAlerting.vue](web/src/components/anomaly_detection/steps/AnomalyAlerting.vue) | 97 | `default` | `opt.name` or `opt` | v-if index < visibleChipCount, size="sm", #trailing close button | `#selected-item` template in q-select multi-chip (alerts destination) |
| [AddAiToolset.vue](web/src/components/ai_toolsets/AddAiToolset.vue) | 181 | `primary-soft` | `preset.label` | v-for CLI_PRESETS, clickable, cursor-pointer, @click=applyPreset, data-test | Clickable preset chips in Add AI Toolset |
| [AWSQuickSetup.vue](web/src/components/ingestion/recommended/AWSQuickSetup.vue) | 75 | `primary` | `{enabledServices.length} / {QUICK_SETUP_SERVICES.length} selected` | size="sm" | Service-selection count badge |
| [AWSQuickSetup.vue](web/src/components/ingestion/recommended/AWSQuickSetup.vue) | 157 | `primary` | `{targetRegions.length} selected` | v-if targetRegions.length > 0, size="sm" | Target-regions count badge |
| [AWSQuickSetup.vue](web/src/components/ingestion/recommended/AWSQuickSetup.vue) | 323 | `primary` | `{r}` (region name) | v-for targetRegions, size="sm" | Each region chip in "deployment targets" list |
| [CorrelationDemo.vue](web/src/views/CorrelationDemo.vue) | 78 | `success` | `Service Streams: Enabled` | v-if isServiceStreamsEnabled | When service streams are enabled (demo) |
| [CorrelationDemo.vue](web/src/views/CorrelationDemo.vue) | 84 | `error` | `Service Streams: Disabled` | v-else | When service streams are disabled (demo) |

### TelemetryCorrelationDashboard (additional 7 OBadges — found via re-grep)

The 3rd agent found 7 entries (above). All 7 line numbers confirmed by re-grep: **225, 326, 505, 707, 816, 975, 1084**.
The migration doc listed lines 544 and 1026 as `q-chip` replacements — those are now at lines 505 and 975 after the file shifted (which match the `primary "{count} Traces"` rows in section 3).

### Files modified in this branch but NOT OBadge changes

| File | Reason it appears in `git status` |
|------|-----------------------------------|
| [SummaryList.vue](web/src/components/queries/SummaryList.vue) | Removed unused `X` component import only — **no badge** |
| [RoleTable.vue](web/src/components/iam/roles/RoleTable.vue) | `q-icon` → `OIcon` migration only — **no badge** |

---

## 5. Files modified for tests / styles / config (no UI badge)

| File | Purpose |
|------|---------|
| [OBadge.vue](web/src/lib/core/Badge/OBadge.vue) | Core component — added soft variants |
| [OBadge.types.ts](web/src/lib/core/Badge/OBadge.types.ts) | Types for soft variants |
| [OBadge.spec.ts](web/src/lib/core/Badge/OBadge.spec.ts) | Unit tests for soft variants |
| [OIcon.icons.ts](web/src/lib/core/Icon/OIcon.icons.ts) | Icon registry adjustments |
| [component.css](web/src/lib/styles/tokens/component.css) | Light-mode soft variant tokens |
| [dark.css](web/src/lib/styles/tokens/dark.css) | Dark-mode soft variant tokens |
| [eslint.config.js](web/eslint.config.js) | q-badge / q-chip deprecation rules |
| [useAlertForm.ts](web/src/composables/useAlertForm.ts) | Helper used by alerts forms |
| [MIGRATION-badge-chip.md](web/MIGRATION-badge-chip.md) | Migration tracking doc |
| [EnterpriseUpgradeDialog.spec.ts](web/src/components/EnterpriseUpgradeDialog.spec.ts) | Spec updates |
| [FeatureComparisonTable.spec.ts](web/src/components/about/FeatureComparisonTable.spec.ts) | Spec updates |
| [AlertList.spec.ts](web/src/components/alerts/AlertList.spec.ts) | Spec updates |
| [AlertHistory.spec.ts](web/src/components/alerts/AlertHistory.spec.ts) | Spec updates |
| [AlertHistoryDrawer.spec.ts](web/src/components/alerts/AlertHistoryDrawer.spec.ts) | Spec updates |
| [AddAlert.spec.ts](web/src/components/alerts/AddAlert.spec.ts) | Spec updates |
| [TagInput.spec.ts](web/src/components/alerts/TagInput.spec.ts) | Spec updates |
| [TestModelMatchDialog.spec.ts](web/src/components/settings/TestModelMatchDialog.spec.ts) | Spec updates |
| [CrossLinkManager.spec.ts](web/src/components/cross-linking/CrossLinkManager.spec.ts) | q-chip mocks removed |

---

## How to verify each row

1. **Log in** to `http://localhost:8081` as `god@main.ai` / `Kingpin#451`
2. **Open the route** from the route map above
3. **Follow the navigation path** in the section "🧭 Navigation paths" for each component
4. **Trigger the UI condition** in the row so the badge actually renders (e.g. for `v-if errorCount > 0` you need a trace with errors)
5. **Open DevTools Console** — filter for `error|warning|deprecation`
6. **Toggle light ↔ dark theme** — verify both states (top-right user menu → theme toggle)
7. **Compare against** `https://main.o2aks1.internal.zinclabs.dev` (main env) for visual baseline

### Data prerequisites for trickier badges

Some badges only render when specific data is present — set these up before verifying:

| Badge | Data needed |
|-------|-------------|
| AlertList status `failed` | An alert that has run and errored — check `/alerts` History tab first |
| AlertList status `training` | An anomaly-type alert during initial training window |
| Incident drawer | At least one incident in `/alerts` → Incidents tab |
| AlertHistory drawer error tooltip | A history row with `status === 'failed'` and a `last_error` value |
| FrustrationBadge / FrustrationEventBadge | A RUM session with rage clicks / dead clicks |
| TraceDetailsSidebar LLM chips (model/in/out/cost) | A trace span with GenAI attributes (`gen_ai.*` keys) |
| TraceDetailsSidebar error badge | A trace with at least one exception event |
| TraceEvaluationsView | A trace that has run through the eval pipeline |
| TraceDAG error node | A trace with a span where `span_status === 'ERROR'` |
| ThreadView dominant model / errors | A multi-turn LLM thread with `dominantModel` populated / errors |
| Nodes region/cluster | Super-cluster mode must be enabled |
| OrgStorageSettings active | Org storage must be configured |
| PredefinedThemes "Applied" | The currently-selected theme card shows the badge |
| AWSQuickSetup region chips | Select ≥1 region in the regions selector |
| AnomalyDetectionList training spinner | A detector currently in `training` status |
| TelemetryCorrelationPanel matched dimensions | Open a trace/log that has correlation metadata |
| Marketplace badges (plans/proPlan) | Billing provider must be `aws` or `azure` |
| CrossLinkDialog field chips | Open the dialog and add fields to "Fields" input |
| TagInput chips | Type a value and press Enter in an alert form's labels field |

---

## Bugs fixed during verification

These pre-existing bugs surfaced while verifying the badge migration (most were not introduced by the migration itself; they were latent issues that the migration's broader testing exposed). All fixed:

| # | File | Bug | Fix |
|---|------|-----|-----|
| 1 | [AddAlert.vue](web/src/components/alerts/AddAlert.vue) | `OTooltip`, `OInput`, `OSelect` imported but not in `components: {}` block — "Failed to resolve component" warnings | Added 3 components to the registration block |
| 2 | [Deduplication.vue](web/src/components/alerts/steps/Deduplication.vue) | `OIcon` imported but no `components: {}` block at all | Added `components: { OIcon }` |
| 3 | [MainLayout.vue](web/src/layouts/MainLayout.vue) | `aiChatPayload` ref defined in setup() but missing from return → "accessed during render but not defined on instance" | Added `aiChatPayload` to setup() return |
| 4 | [AlertList.vue](web/src/components/alerts/AlertList.vue) | `showAddUpdateFn` `const` was referenced by an `immediate: true` watcher before being defined → TDZ ReferenceError on direct navigation to `?action=add` | Moved `const showAddUpdateFn = async (props) => {...}` to be defined **above** the watcher (keeps arrow-function style consistent; makes dependency order explicit) |
| 5 | [eslint.config.js](web/eslint.config.js) | Duplicate `q-dialog` entry in `vue/no-restricted-html-elements` → ESLint failed to start | Removed duplicate entry |
| 6 | [logs/IndexList.vue](web/src/plugins/logs/IndexList.vue) | `OTooltip` imported but not in `components:` block | Added `OTooltip` to registration |
| 7 | [DashboardErrors.vue](web/src/components/dashboards/addPanel/DashboardErrors.vue) | `OIcon` imported but no `components:` block | Added `components: { OIcon }` |
| 8 | [AlertContextMenu.vue](web/src/components/dashboards/AlertContextMenu.vue) | `OIcon` imported but no `components:` block | Added `components: { OIcon }` |
| 9 | [HorizontalStepper.vue](web/src/components/alerts/HorizontalStepper.vue) | `OIcon` imported but no `components:` block | Added `components: { OIcon }` |
| 10 | [MetricsSummaryCard.vue](web/src/components/query-plan/MetricsSummaryCard.vue) | `OIcon` imported but no `components:` block | Added `components: { OIcon }` |
| 11 | [QueryPlanNode.vue](web/src/components/query-plan/QueryPlanNode.vue) | `OIcon` imported but no `components:` block | Added `components: { OIcon }` |
| 12 | [TracesMetricsContextMenu.vue](web/src/plugins/traces/metrics/TracesMetricsContextMenu.vue) | `OIcon` imported but no `components:` block | Added `components: { OIcon }` |
| 13 | [ScheduledDashboards.vue](web/src/views/Dashboards/ScheduledDashboards.vue) | `<AppTabs>` used in template but never imported in `<script setup>` | Added `import AppTabs from "@/components/common/AppTabs.vue"` |

## Pre-existing warnings NOT related to badge migration

These continue to appear in the console across all pages — they originate from third-party deps (mostly Quasar in `chunk-UN224CTY.js`) or pre-existing app-level code, NOT from the badge migration scope:

- `Vue warn: onBeforeUnmount/onActivated/onMounted is called when there is no active component instance` — third-party `inject()`/lifecycle usage outside Vue setup()
- `Vue warn: inject() can only be used inside setup() or functional components`
- `Vue Router warn: The route named "ai-integrations" has a child without a name and an empty path`
- `Vue warn: setup() return property "$q" should not start with "$"` — in `ComponentSearchSearchBar`
- `Vue warn: Extraneous non-props attributes (style) were passed to component but could not be automatically inherited` — for OTooltip used inside OButton (component renders fragment root)
- `ECharts: Can't get DOM width or height` — chart container sizing issue

These should be addressed separately and are outside the badge migration scope.
