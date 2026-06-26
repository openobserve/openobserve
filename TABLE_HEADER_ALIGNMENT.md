# Table Column Header & Cell Alignment — Audit & Policy

Single source of truth for **how every table column is aligned** across the app.
The goal is consistency: a column's header and its cell values share the same
alignment, and that alignment is decided by the column's **semantic type**, not
per-table whim.

> Mechanism: `OTableHeader` reads `meta.align` and applies it to the header
> label **and** the sort icon (fixed so the header follows the values). The
> column body cell already honours `meta.align`. Default when unset is `left`
> (`columnDefBuilder.ts` → `align: col.meta?.align ?? "left"`).

---

## 1. Alignment policy by semantic type

| Type | What it is | Align | Rationale |
|---|---|---|---|
| **text** | names, titles, ids, emails, URLs, tokens, descriptions, labels | **left** | reading order |
| **number** | counts, sizes/bytes, percentages, scores, versions, prices, req/s limits, numeric latency rendered as a bare number | **right** | digits/decimals line up for comparison |
| **interval** | human duration labels — frequency, period ("10 Mins", "1 Hours") | **left** | label-like, mixed units don't benefit from right-align |
| **badge** | status / type / tag / severity / boolean chips (`OTag`, `OBadge`) | **left** | starts at a predictable left edge, like text |
| **datetime** | timestamps & dates (`OTimeCell`), relative or absolute | **left** | standard for date columns; works for relative + absolute |
| **icon** | leading icon indicator, play button, status dot | **left** | treated as content, consistent with text |
| **progress** | a horizontal progress **bar** (± inline % / count) filling the cell | **left** | the bar is a visual indicator anchored left, not a bare number |
| **index** | `#` row number | **left** | standard |
| **select** | checkbox column | **center** | narrow structural column; checkbox centers in its box |
| **actions** | row action icon buttons | **center** | structural; already consistent app-wide |

**The rule in one line:** `number → right`; `select`/`actions` → `center`;
**everything else → left**. `center` is *never* used for data-type columns.

---

## 2. Per-column audit

Legend: ✓ already correct · ★ fixed (was → now).

### Alerts & Incidents
| File | Column | Type | Align |
|---|---|---|---|
| AlertList.vue | name, owner | text | left ✓ |
| AlertList.vue | frequency | interval | left ✓ |
| AlertList.vue | **period** (Look back) | interval | ★ center → left |
| AlertList.vue | **folder_name** | text | ★ center → left |
| AlertList.vue | last_triggered_at, last_satisfied_at, last_trained_at | datetime | left ✓ |
| AlertList.vue | status | badge | left ✓ |
| IncidentList.vue | title, dimensions | text | left ✓ |
| IncidentList.vue | severity, status | badge | left ✓ |
| IncidentList.vue | **alert_count** | number | ★ center → right |
| IncidentList.vue | last_alert_at | datetime | left ✓ |
| AlertHistory.vue | **is_realtime, is_silenced, dedup** | icon | ★ center → left |
| AlertHistory.vue | **retries** | number | ★ center → right |
| AlertHistory.vue | **duration** | number (numeric latency) | right ✓ (kept) |
| AlertHistory.vue | timestamp/start/end | datetime | left ✓ |
| AlertHistory.vue | status | badge | left ✓ |
| AlertHistorySummary.vue | **total_evaluations, firing_count** | number | ★ center → right |
| AlertHistorySummary.vue | **current_state** | badge | ★ center → left |
| AlertHistorySummary.vue | **frequency** | interval | ★ center → left |
| AlertHistorySummary.vue | **last_evaluation** | datetime | ★ center → left |
| AlertHistoryDrawer.vue | anomaly_count | number | right ✓ |
| IncidentAlertTriggersTable.vue | **correlation_reason** | badge | ★ right → left |
| AlertsDestinationList.vue, PipelinesDestinationList.vue, TemplateList.vue | (all) | text/badge | left ✓ |

### Pipelines & Functions & Streams
| File | Column | Type | Align |
|---|---|---|---|
| PipelinesList.vue | (all) | text/interval/badge | left ✓ |
| PipelineHistory.vue | **is_realtime, is_silenced, is_partial** | icon | ★ center → left |
| PipelineHistory.vue | **retries** | number | ★ center → right |
| PipelineHistory.vue | duration, delay_in_secs, evaluation_took, query_took | number | right ✓ |
| PipelineHistory.vue | timestamps, status | datetime/badge | left ✓ |
| BackfillJobsList.vue | progress_percent (progress **bar** + chunk count) | progress/visual | **left** (bar is a visual indicator, not a bare number) |
| EnrichmentTableList.vue | **doc_num, storage_size, compressed_size** | number | ★ left → right |
| AssociatedStreamFunction.vue | **doc_num, storage_size, compressed_size, order** | number | ★ left → right |
| ActionScripts.vue | **created_by** | text | ★ center → left |
| LogStream.vue | doc_num, storage_size, compressed_size, index_size | number | right ✓ |
| logstream/schema.vue | name, type (fieldType), index_type, patterns | text/badge | left ✓ |

### Queries, RUM & Traces
| File | Column | Type | Align |
|---|---|---|---|
| RunningQueriesList.vue | (all) | text/interval/badge | left ✓ |
| SummaryList.vue | **numOfQueries** | number | ★ left → right |
| ErrorsList.vue | **error_count** | number | ★ left → right |
| rum/SessionsList.vue | **action_play** | icon | ★ center → left |
| rum/SessionsList.vue | **error_count** | number | ★ left → right |
| AppErrors.vue | **events** (ODataBarCell) | number | ★ left → right |
| AppSessions.vue | **action_play** | icon | ★ center → left |
| AppSessions.vue | **error_count** | number | ★ left → right |
| SourceMaps.vue | **file_count** | number | ★ left → right |
| PlayerTracesTab.vue | **duration** | interval | ★ right → left |
| plugins/traces/SessionsList.vue | **turns, tokens, cost** | number | ★ center → right |
| plugins/traces/SessionsList.vue | **durationNanos** | interval | ★ center → left |
| plugins/traces/SessionsList.vue | **status** | badge | ★ center → left |
| useTracesTableColumns.ts | **spans** | number | ★ center → right |
| useTracesTableColumns.ts | **span_kind** | text | ★ center → left |
| useTracesTableColumns.ts | **span_status, status** | badge | ★ center → left |
| useTracesTableColumns.ts | input_tokens, output_tokens, cost | number | right ✓ |

### IAM
| File | Column | Type | Align |
|---|---|---|---|
| User.vue, InvitationList.vue, ServiceAccountsList.vue, ListOrganizations.vue | (data cols) | text/badge/datetime | left ✓ |
| IngestionTokens.vue | **name, token, created_by** | text | ★ none → left (explicit) |
| Quota.vue | **list, get, create, update, delete** (×2 tables, Req/s) | number | ★ center → right |
| GroupUsers/GroupRoles/GroupServiceAccounts/Entity/Permissions | checkbox cols | select | center (kept — structural) |
| RoleTable.vue, AppGroups.vue | actions | actions | left (kept — structural*) |

\* Action columns are structural; left vs center is a separate, lower-priority
normalization (see §3).

### Settings & Enterprise
| File | Column | Type | Align |
|---|---|---|---|
| RegexPatternList, DiscoveredServices, ModelPricingList, LlmProvidersSettings, AiToolsets, CipherKeys, OrganizationManagement | (all) | text/badge/datetime | left ✓ |
| Nodes.vue | **version** | text | ★ center → left |
| Nodes.vue | **cpu, memory, tcp** | number | ★ left → right |
| Nodes.vue | id (#) | index | left (kept) |
| EvalTemplateList.vue | **version** | number | ★ center → right |
| invoiceTable.vue | **amount, paid** | number | ★ left → right |
| EvalJobList.vue | **scorers** | number | ★ left → right |
| ScoreConfigList.vue | **version, usedBy** | number | ★ left → right |
| ScorerList.vue | **version, usedBy** | number | ★ left → right |
| QualityScoreConfigsTable.vue | **totalScores, coverage** | number | ★ left → right |
| BillingGroup.vue | (all) | text/badge/datetime | left ✓ |

### Dashboards & Reports
| File | Column | Type | Align |
|---|---|---|---|
| Dashboards.vue, ScheduledDashboards.vue | (all) | text/datetime/badge | left ✓ |
| ReportList.vue | **description** | text | ★ center → left |
| ReportList.vue | # | index | center → left (normalized) |

---

## 3. Known out-of-scope / deferred

- **Action & index/select columns**: a few tables use `left` or `center`
  inconsistently for the structural `#`, checkbox, and `actions` columns. These
  aren't data-type columns; standard is index=`left`, select=`center`,
  actions=`center`. Normalizing every one is a separate low-risk pass.
- **Permission checkbox grids** (PermissionsTable, EntityPermissionTable): the
  Allow* columns are checkbox/select type; left/center is structural, left as-is.

---

## 4. Where to verify each table (UI paths)

Routes are relative to the app root (append `?org_identifier=default`). Tab-based
tables are reached via the page's toolbar tabs.

| Table file | Nav path | URL / how to reach |
|---|---|---|
| AlertList.vue | Alerts → All | `/web/alerts` |
| AlertHistory.vue / AlertHistorySummary.vue / AlertHistoryDrawer.vue | Alerts → open an alert → History | from `/web/alerts`, row → history |
| AlertsDestinationList.vue | Alerts → Destinations | `/web/alerts/destinations` |
| TemplateList.vue | Alerts → Templates | `/web/alerts/templates` |
| PipelinesDestinationList.vue | Pipelines → Destinations | `/web/pipeline` → Destinations |
| IncidentList.vue / IncidentAlertTriggersTable.vue | Incidents | `/web/incidents` (triggers = expand a row) |
| PipelinesList.vue | Pipelines | `/web/pipeline` |
| PipelineHistory.vue / BackfillJobsList.vue | Pipelines → open a pipeline → History / Backfill | within a pipeline |
| FunctionList.vue | Pipelines → Functions | `/web/functions` |
| EnrichmentTableList.vue / EnrichmentSchema.vue | Pipelines → Enrichment Tables | `/web/enrichment-tables` |
| AssociatedStreamFunction.vue | Data → Streams → stream → Functions | from `/web/streams` |
| ActionScripts.vue | Actions | `/web/actions` |
| LogStream.vue | Data → Streams | `/web/streams` |
| logstream/schema.vue | Data → Streams → schema icon | `/web/streams` → row schema |
| RunningQueriesList.vue / SummaryList.vue / QueryList.vue | Management → Query Management | `/web/management` → Queries |
| ErrorsList.vue / SessionsList.vue (rum) | RUM | `/web/rum` |
| AppErrors.vue / AppSessions.vue / SourceMaps.vue | RUM → Errors / Sessions / Source Maps | `/web/rum` tabs |
| plugins/traces/SessionsList.vue / useTracesTableColumns.ts | Traces (sessions/spans) | `/web/traces` |
| User.vue / ServiceAccountsList.vue / GroupUsers/Roles/SA / RoleTable / PermissionsTable / EntityPermissionTable | IAM | `/web/iam` → tabs (Users / Service Accounts / Groups / Roles) |
| InvitationList.vue | IAM → Users → Invitations | `/web/iam` → Users |
| ListOrganizations.vue | IAM → Organizations | `/web/iam` → Organizations |
| IngestionTokens.vue | IAM → Ingestion / Tokens | `/web/iam` → Tokens |
| Quota.vue | IAM → Quota | `/web/iam` → Quota |
| RegexPatternList.vue / DiscoveredServices.vue / ModelPricingList.vue / BuiltInModelPricingTab.vue / LlmProvidersSettings.vue / AiToolsets.vue / CipherKeys.vue / Nodes.vue / OrganizationManagement.vue | Settings | `/web/settings` → respective tab |
| EvalTemplateList.vue / EvalJobList.vue / ScoreConfigList.vue / ScorerList.vue / QualityScoreConfigsTable.vue | Online Evaluations (Enterprise) | `/web/online_evaluations` tabs |
| BillingGroup.vue / invoiceTable.vue | Billing (Enterprise/Cloud) | `/web/billings` |
| Dashboards.vue / ScheduledDashboards.vue | Dashboards | `/web/dashboards` |
| ReportList.vue | Reports | `/web/reports` |

> Quick visual checks done in-browser during this change: **Streams**
> (`/web/streams`) numeric columns right-aligned with headers; **Alerts**
> (`/web/alerts`) Look back window + Check every both left-aligned & consistent.

---

## 5. QA checklist

- [ ] Every numeric column (counts, sizes, %, scores, versions, prices) is **right**-aligned, header included.
- [ ] No data column uses `center` (only `select`/`actions` may).
- [ ] Interval labels (frequency/period) are **left**, consistently across tables.
- [ ] Badges, datetimes, text, icons are **left**.
- [ ] Header label + sort icon sit on the same side as the values.
