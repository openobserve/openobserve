# Table Visual Refresh — QA Checklist

Per-table list of what changed, for manual QA. Each row notes the page, the
columns touched, the cell component used, and what to verify. New shared
components are listed first (smoke-test once, they're reused everywhere).

Global checks for every table below:
- [ ] No raw/empty cells — blanks show `—` (or "Never").
- [ ] No grey "disabled-looking" text anywhere.
- [ ] Sorting/filtering still works on the changed columns.
- [ ] Light **and** dark mode both read well.

---

## New shared components (`web/src/lib/core/…`) — smoke test

| Component | File | Verify |
|---|---|---|
| `OTag` (typed badge) | `Badge/OTag.vue` | colour/icon/dot resolve per `type`; unknown value → neutral badge |
| Badge registry | `Badge/badgeGroups.ts` (+ `.spec.ts`) | groups: alertType, alertStatus, incidentStatus, severity, logLevel, pipelineType, streamType, invoiceStatus, evalStatus, queryStatus, serviceStatus, userRole, authType, httpMethod, fieldType, destinationType, enrichmentType, booleanState |
| `OTimeCell` | `Table/cells/OTimeCell.vue` | relative under 30d, absolute date when older; `mode="absolute"` shows full datetime; hover tooltip; respects timezone |
| `ONumberCell` | `Table/cells/ONumberCell.vue` | right-aligned, tabular, formatters (number/bytes/duration/percent) |
| `ODataBarCell` | `Table/cells/ODataBarCell.vue` | number with magnitude bar **below** it; bar scales to per-page max |
| `OCodeCell` | `Table/cells/OCodeCell.vue` | monospace + copy-on-hover |
| `OUserCell` | `Table/cells/OUserCell.vue` | **plain email/name, no avatar, not truncated** (current state) |
| `statusVariant` | `Table/cells/statusVariant.ts` (+ `.spec.ts`) | generic fallback colour mapping |

> Note: `OStatusBadge.vue` was removed and replaced by `OTag`.

---

## Streams & Schema

| Page / File | Columns changed | What to verify |
|---|---|---|
| **Streams list** — `views/LogStream.vue` | `stream_type` → `OTag streamType` (icon badge); `doc_num`/`storage_size`/`compressed_size`/`index_size` → **plain formatted counts** (data bars removed) | type shows logs/metrics/traces/metadata badge with icon; numbers plain & right-aligned, no bars |
| **Stream schema** — `components/logstream/schema.vue` | field `type` → `OTag fieldType` | string/int/float/bool render as colour-coded type badges |

---

## Alerts & Incidents

| Page / File | Columns changed | What to verify |
|---|---|---|
| **Alerts list** — `components/alerts/AlertList.vue` | timestamps (`last_triggered_at`, `last_satisfied_at`, `last_trained_at`) → `OTimeCell`; `status` → `OTag alertStatus`; `owner` → `OUserCell`; blanks → "Never" | relative times, status dot-badges, failed-status tooltip still works, owner is plain email |
| **Incident list** — `components/alerts/IncidentList.vue` | `status` → `OTag incidentStatus`; `severity` → dot badge; `last_alert_at` → `OTimeCell` | open/acknowledged/resolved colours; P1–P4 severity colours |
| **Alert history (full page)** — `components/alerts/AlertHistory.vue` | `timestamp`/`start_time`/`end_time` → `OTimeCell mode="absolute"` | **full datetime**, not relative |
| **Alert history (drawer)** — `components/alerts/AlertHistoryDrawer.vue` | `timestamp` → full datetime inline | **full datetime**, not "x min ago" |
| **Alert history summary** — `components/alerts/AlertHistorySummary.vue` | `current_state` → `OTag`; `last_evaluation` → `OTimeCell` (relative) | state badge; last-evaluation relative is intentional |
| **Destinations** — `components/alerts/AlertsDestinationList.vue` | grey text fix only (type badge already existed) | type/icon unchanged, no grey |
| **Pipeline destinations** — `components/alerts/PipelinesDestinationList.vue` | `destination_type`/`output_format` → soft badge chips | type/format as chips |
| **Anomaly detection** — `components/anomaly_detection/AnomalyDetectionList.vue` | timestamps → `OTimeCell`; grey fixes | relative times; status badge (pre-existing) unchanged |

---

## Pipelines & Functions

| Page / File | Columns changed | What to verify |
|---|---|---|
| **Pipelines list** — `components/pipeline/PipelinesList.vue` | `type` → `OTag pipelineType` | realtime/scheduled badge with icon |
| **Pipeline history** — `components/pipelines/PipelineHistory.vue` | `timestamp`/`start_time`/`end_time` → `OTimeCell mode="absolute"`; `status` → `OTag` (**left-aligned**); `duration` → `ONumberCell durationUs` | full datetimes; status badge left-aligned |
| **Backfill jobs** — `components/pipelines/BackfillJobsList.vue` | `created_at`/`last_triggered_at` → `OTimeCell`; grey fix (progress bar kept) | times relative; progress bar unchanged |
| **Enrichment tables** — `components/functions/EnrichmentTableList.vue` | `type` → `OTag enrichmentType` (file/url icon); `doc_num` → `ONumberCell`; grey fix | file/url badge with icon |

---

## Queries & RUM

| Page / File | Columns changed | What to verify |
|---|---|---|
| **Running queries** — `components/queries/RunningQueriesList.vue` | `status` → `OTag queryStatus`; `user_id` → `OUserCell`; `duration`/`queryRange` formatted | status badge; user plain email |
| **Query summary** — `components/queries/SummaryList.vue` | `user_id` → `OUserCell` | plain email |
| **RUM errors** — `views/RUM/AppErrors.vue` | `events` → `ODataBarCell` (data bar) | count with magnitude bar below |
| **RUM sessions** — `views/RUM/AppSessions.vue` | `error_count` red-tinted when > 0; `user_email` → `OUserCell` | red error counts; plain email |

---

## IAM & Access

| Page / File | Columns changed | What to verify |
|---|---|---|
| **Users** — `components/iam/users/User.vue` | `auth` → `OTag authType`; `roles` → `OTag userRole`; **`email` reverted to plain** | auth/role badges; email column is plain (no avatar) |
| **Invitations** — `components/iam/users/InvitationList.vue` | `role` → `OTag userRole`; `expiry` → `OTimeCell`; `inviter_id` → `OUserCell` | role badge; expiry time; inviter plain email |
| **Service accounts** — `components/iam/serviceAccounts/ServiceAccountsList.vue` | `token` → `OCodeCell`; `email` → `OUserCell` (system badge kept) | token copyable; "system" badge intact |
| **Organizations** — `components/iam/organizations/ListOrganizations.vue` | `identifier` → `OCodeCell` (**copyable Id**); `type`/`plan` → `OTag` | **Id copy button on hover**; type/plan badges |
| **Ingestion tokens** — `components/iam/IngestionTokens.vue` | `token` → `OCodeCell`; `created_by` → `OUserCell`; grey fix | token copyable; created-by plain email |
| **Group users** — `components/iam/groups/GroupUsers.vue` | `email` → `OUserCell` (external-user warning kept) | plain email; warning icon intact |

---

## Settings

| Page / File | Columns changed | What to verify |
|---|---|---|
| **Regex patterns** — `components/settings/RegexPatternList.vue` | `pattern` → `OCodeCell`; `created_at`/`updated_at` → `OTimeCell` | regex monospace + copy; relative times |
| **Discovered services** — `components/settings/DiscoveredServices.vue` | `lastSeen` → `OTimeCell`; grey removed | relative last-seen |
| **Model pricing** — `components/settings/ModelPricingList.vue` | grey text fix (prices already chips) | no grey empty fallback |
| **LLM providers** — `components/settings/LlmProvidersSettings.vue` | `isDefault` → `OTag booleanState`; grey fix | default shown as badge |

---

## Reports & Dashboards

| Page / File | Columns changed | What to verify |
|---|---|---|
| **Reports** — `components/reports/ReportList.vue` | `last_triggered_at` → `OTimeCell`; `owner` → `OUserCell` | relative time; owner plain email |
| **Dashboards list** — `views/Dashboards/Dashboards.vue` | `owner` → `OUserCell`; `created` → `OTimeCell` (relative→absolute) | owner plain email; created shows real dates for old items |
| **Scheduled dashboards** — `views/Dashboards/ScheduledDashboards.vue` | `last_triggered_at`/`created_at` → `OTimeCell` (click preserved) | times relative; row click still works |

---

## Logs / Traces

| Page / File | Columns changed | What to verify |
|---|---|---|
| **Search history** — `plugins/logs/SearchHistory.vue` | `executed_time` → `OTimeCell mode="absolute"`; grey fix | full datetime |
| **Search schedulers** — `plugins/logs/SearchSchedulersList.vue` | `created_at`/`start_time` → `OTimeCell`; `status` → `OTag queryStatus`; `user_id` → `OUserCell` | times, status badge, plain user |
| **Trace sessions** — `plugins/traces/SessionsList.vue` | `userId` → `OUserCell` | plain user/id |

---

## Enterprise (Billing & Evals)

| Page / File | Columns changed | What to verify |
|---|---|---|
| **Invoices** — `enterprise/.../billings/invoiceTable.vue` | `start_date`/`end_date` → `OTimeCell mode="date"`; `status` → `OTag invoiceStatus` | dates (not raw epochs); paid/open/draft badges |
| **Billing groups** — `enterprise/.../billings/BillingGroup.vue` | `invited_by`/`accepted_by`/`inviter_id` → `OUserCell` | plain emails |
| **Eval jobs** — `enterprise/.../onlineEvals/EvalJobList.vue` | `status` → `OTag evalStatus` | active/draft/paused/degraded/archived badges |

---

## Action scripts

| Page / File | Columns changed | What to verify |
|---|---|---|
| **Action scripts** — `components/actionScripts/ActionScripts.vue` | `created_at`/`last_run_at`/`last_successful_at` → `OTimeCell`; `type`/`status` → `OTag`; `created_by` → `OUserCell` | times, type/status badges, plain creator |

---

## Intentionally NOT changed (already rich / nothing to standardize)

These were reviewed and left as-is — note for QA so they're not flagged as misses:

- **Nodes / Cluster** (`components/settings/Nodes.vue`) — CPU/memory already use progress bars.
- **Services catalog** (`plugins/traces/ServicesCatalog.vue`) — already has its own bar cells + status badges.
- **Traces search results** (`plugins/traces/components/TracesSearchResultList.vue`) — already uses dedicated rich cells.
- **AI toolsets** (`components/settings/AiToolsets.vue`) — `kind` already a proper badge.
- **Metrics list, Function list, Role table, App groups, Template list, Cipher keys, Stream explorer** — no status/time/number/person columns to standardize.

---

## Verification status

- `npm run type-check` → **0 errors**.
- Unit specs: `badgeGroups.spec.ts` (8) + `statusVariant.spec.ts` (10) pass.
