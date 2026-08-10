# API Cache Inventory — what is cached, where it is stored, what is left

**Companion to** [api-caching-audit.md](./api-caching-audit.md) (the design) and
[api-cache-architecture.md](./api-cache-architecture.md) (the call flow — which
file calls what, and where the payload goes).

This document is the **register**: every read API, its module, its cache tier,
and the physical storage its payload lands in.

---

## 1. How to read the "Storage" column

Storage is decided by the **tier**, not by the page. `tiers.ts` is the only file
with `staleTime`/`gcTime` numbers, and it also chooses the persister.

| Tier                  | staleTime | gcTime | Storage                    | Survives reload? | Focus refetch |
| --------------------- | --------- | ------ | -------------------------- | ---------------- | ------------- |
| `SESSION_STATIC` (T0) | ∞         | ∞      | **localStorage** (24 h)    | yes              | no            |
| `ORG_CONFIG` (T1)     | 5 min     | 30 min | **localStorage** (24 h)    | yes              | no            |
| `ENTITY_LIST` (T2)    | 30 s      | 5 min  | **memory only**            | no               | yes           |
| `ENTITY_DETAIL` (T3)  | 30 s      | 5 min  | **memory only**            | no               | no            |
| `VOLATILE` (T4)       | 0         | 60 s   | **memory only**            | no               | yes           |
| `HEAVY_RESULT` (T5)   | 0         | 30 min | **IndexedDB** (24 h + LRU) | yes              | no            |

Any query can override its tier's storage with `persist: "none"` — used for
anything carrying a secret (see §5).

### Physical layout

| Where                                     | Key shape                                                | Written by              |
| ----------------------------------------- | -------------------------------------------------------- | ----------------------- |
| `localStorage`                            | `o2q-["org","<org>",…]`                                  | T0/T1 query persister   |
| IndexedDB `o2Cache` → `kv`                | `o2q-heavy-["org","<org>",…]`                            | T5 query persister      |
| IndexedDB `o2Cache` → `kv`                | `panel\|<org>\|<folder>\|<dashboard>\|<panel>\|<digest>` | dashboard panel results |
| IndexedDB `o2FieldValues` → `fieldValues` | `<org>\|<streamType>\|<stream>\|<field>`                 | log field autocomplete  |
| memory                                    | —                                                        | T2/T3/T4                |

### Lifecycle — what survives what

Every key carries the org, which is what makes the two events below safe.

| Event          | Memory   | localStorage / IndexedDB                |
| -------------- | -------- | --------------------------------------- |
| **Org switch** | **kept** | **purged** for the org being left       |
| **Logout**     | cleared  | purged entirely (incl. `o2FieldValues`) |

Memory is deliberately kept across an org switch: keys are rooted at
`["org", id]`, so one org's data can never be served to another, and `gcTime`
collects it anyway. The payoff is that switching back to a recent org inside its
`staleTime` costs **no requests at all**.

Disk is purged because it is a different budget: localStorage is ~5 MB shared
with the whole app, so persisting every org visited would eventually hit quota —
silently, since the storage wrapper swallows the error — and the previous
tenant's stream, folder and function names would sit on a possibly shared
machine.

Measured on a two-org instance: switching to a never-visited org costs 3
requests; switching **back** to the previous one costs **0**.

Two consequences of splitting memory from disk this way:

- Switching back is free **in-session only**. The org's disk entry was purged on
  the way out and is not rewritten by a cache hit (nothing fetched), so after a
  page reload that org fetches again. Expected — the disk copy is a first-paint
  optimisation for the _current_ org, not a per-org archive.
- If a user's access to an org is revoked while they are elsewhere, switching
  back renders cached rows until the refetch 403s. Inherent to any cache within
  `staleTime`, not specific to this choice.

Implemented in `purgeOrgQueries` / `purgeAllQueries` (`queryClient.ts`).

---

## 2. Migrated — currently cached

63 cached reads are declared with `defineQuery`, each in the service file that
owns its URL,
plus the two pre-existing IndexedDB caches now folded into the same purge path.

### App shell

| Module               | API           | Tier | Storage                                                     |
| -------------------- | ------------- | ---- | ----------------------------------------------------------- |
| `services/config.ts` | `GET /config` | T0   | **memory only** — payload carries the RUM client token (§5) |

### Streams

| Module                                  | API                                               | Tier | Storage          |
| --------------------------------------- | ------------------------------------------------- | ---- | ---------------- |
| `services/stream.ts` → `streamNameList` | `GET /api/{org}/streams?type=`                    | T1   | **localStorage** |
| `services/stream.ts` → `streamPage`     | same, paginated (`offset/limit/keyword/sort/asc`) | T2   | memory           |

### Folders & functions

| Module                    | API                                | Tier | Storage          |
| ------------------------- | ---------------------------------- | ---- | ---------------- |
| `services/common.ts`      | `GET /api/v2/{org}/folders/{type}` | T1   | **localStorage** |
| `services/jstransform.ts` | `GET /api/{org}/functions`         | T1   | **localStorage** |

### Alerts

| Module                                                | API                                               | Tier | Storage          |
| ----------------------------------------------------- | ------------------------------------------------- | ---- | ---------------- |
| `services/alerts.ts`                                  | `GET /api/v2/{org}/alerts` (folder + name search) | T2   | memory           |
| `services/alert_destination.ts` → `destinationsQuery` | `GET /api/{org}/alerts/destinations`              | T1   | **localStorage** |
| `services/alert_templates.ts` → `templatesQuery`      | `GET /api/{org}/alerts/templates`                 | T1   | **localStorage** |
| `services/alerts.ts`                                  | `GET /api/v2/{org}/alerts/history`                | T2   | memory           |
| `services/alert_sources.ts`                           | `GET /api/v2/{org}/incidents/integrations`        | T2   | memory           |

### Dashboards

| Module                       | API                                 | Tier | Storage                                    |
| ---------------------------- | ----------------------------------- | ---- | ------------------------------------------ |
| `services/dashboards.ts`     | `GET /api/{org}/dashboards?folder=` | T2   | memory                                     |
| `dashboard/usePanelCache.ts` | panel execution results             | —    | **IndexedDB** (`panel\|…`, 24 h + LRU 200) |

### Lists

| Module                                                  | API                                               | Tier | Storage |
| ------------------------------------------------------- | ------------------------------------------------- | ---- | ------- |
| `services/reports.ts`                                   | `GET /api/v2/{org}/reports` (folder + tab + name) | T2   | memory  |
| `services/pipelines.ts`                                 | `GET /api/{org}/pipelines`                        | T2   | memory  |
| `services/slos.ts`                                      | `GET /api/{org}/slos`                             | T2   | memory  |
| `services/workflows.ts`                                 | `GET /api/{org}/workflows`                        | T2   | memory  |
| `services/synthetics.ts`                                | `GET /api/{org}/synthetics`                       | T2   | memory  |
| `services/users.ts` → `orgUsersQuery`                   | `GET /api/{org}/users`                            | T2   | memory  |
| `services/service_accounts.ts` → `serviceAccountsQuery` | `GET /api/{org}/service_accounts`                 | T2   | memory  |

### Settings

| Module                                             | API                                   | Tier | Storage                             |
| -------------------------------------------------- | ------------------------------------- | ---- | ----------------------------------- |
| `services/cipher_keys.ts` → `cipherKeysQuery`      | `GET /api/{org}/cipher_keys`          | T1   | **memory only** — key material (§5) |
| `services/regex_pattern.ts` → `regexPatternsQuery` | `GET /api/{org}/re_patterns`          | T1   | **localStorage**                    |
| `services/ai_toolsets.ts` → `aiToolsetsQuery`      | `GET /api/{org}/ai/toolsets`          | T1   | **localStorage**                    |
| `services/model_pricing.ts` → `modelPricingQuery`  | `GET /api/{org}/llm/models`           | T1   | **localStorage**                    |
| `services/regex_pattern.ts` → built-in             | `GET /api/{org}/re_patterns/built-in` | T0   | **localStorage**                    |

### App settings & org metadata

| Module                                     | API                                              | Tier | Storage                                                  |
| ------------------------------------------ | ------------------------------------------------ | ---- | -------------------------------------------------------- |
| `services/settings.ts` → favourites        | `GET /api/{org}/settings/v2/favorite_dashboards` | T1   | **localStorage** (key includes the user id)              |
| `services/settings.ts` → home dashboard    | `GET /api/{org}/settings/v2/home_dashboard`      | T1   | **localStorage**                                         |
| `services/organizations.ts` → org settings | `GET /api/{org}/settings`                        | T1   | **localStorage**                                         |
| `services/common.ts` → nodes               | `GET /api/{org}/node/list`                       | T1   | memory — cluster state is more confusing stale than slow |
| `services/license_server.ts` → license     | `GET /api/license`                               | T4   | memory — carries live usage counters (see below)         |
| `services/action_scripts.ts`               | `GET /api/{org}/actions`                         | T1   | **localStorage** — read on every Logs entry              |
| `services/saved_views.ts`                  | `GET /api/{org}/savedviews`                      | T2   | memory                                                   |

### Credentials — cached, never persisted

Each of these pins `persist: "none"` explicitly, on the
query, so the override survives anyone re-tiering these later.

| Module                                               | API                                      | Tier | Storage     |
| ---------------------------------------------------- | ---------------------------------------- | ---- | ----------- |
| `services/organizations.ts` → `ingestionTokensQuery` | `GET /api/{org}/ingestion-tokens`        | T2   | memory only |
| `services/organizations.ts` → `orgPasscodeQuery`     | `GET /api/{org}/passcode`                | T2   | memory only |
| `services/api_keys.ts` → `rumTokensQuery`            | `GET /api/{org}/rumtoken`                | T2   | memory only |
| `services/synthetics.ts` → `agentTokensQuery`        | `GET /api/{org}/synthetics/agent-tokens` | T2   | memory only |
| `services/cipher_keys.ts` → `cipherKeysQuery`        | (already listed above)                   | T1   | memory only |
| `services/config.ts`                                 | (already listed above)                   | T0   | memory only |

### IAM

| Module                               | API                                       | Tier | Storage                      |
| ------------------------------------ | ----------------------------------------- | ---- | ---------------------------- |
| `services/iam.ts` → groups           | `GET /api/{org}/groups`                   | T2   | memory                       |
| `services/iam.ts` → roles            | `GET /api/{org}/roles`                    | T2   | memory                       |
| `services/iam.ts` → resources        | `GET /api/{org}/resources`                | T1   | **localStorage** — enum-like |
| `services/iam.ts` → role permissions | `GET /api/{org}/roles/{name}/permissions` | T3   | memory                       |
| `services/iam.ts` → pending invites  | `GET /api/invites`                        | T2   | memory                       |

### Traces

| Module                                             | API                                          | Tier                      | Storage                                                                        |
| -------------------------------------------------- | -------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `services/jstransform.ts` → query functions        | `GET /api/{org}/query_functions`             | T1                        | **localStorage** — SQL-editor autocomplete catalogue                           |
| `services/alerts.ts` → alert detail                | `GET /api/v2/{org}/alerts/{id}`              | T3                        | memory                                                                         |
| `services/pipelines.ts` → pipeline detail          | `GET /api/{org}/pipelines/{name}`            | T3                        | memory                                                                         |
| `services/slos.ts` → SLO detail                    | `GET /api/{org}/slos/{id}`                   | T3                        | memory                                                                         |
| `services/synthetics.ts` → monitor detail          | `GET /api/{org}/synthetics/{id}`             | T3                        | memory                                                                         |
| `services/reports.ts` → report detail              | `GET /api/v2/{org}/reports/{id}`             | T3                        | memory                                                                         |
| `services/cipher_keys.ts` → `cipherKeyDetailQuery` | `GET /api/{org}/cipher_keys/{name}`          | T3                        | memory                                                                         |
| `services/dashboards.ts` → annotations             | `GET /api/{org}/dashboards/{id}/annotations` | T3                        | memory                                                                         |
| `services/search.ts` → trace DAG                   | `GET /api/{org}/{stream}/traces/{id}/dag`    | T5, `staleTime: Infinity` | **IndexedDB** — a trace is immutable, so each time window is cacheable forever |

### Enterprise

| Module                                             | API                                         | Tier | Storage          |
| -------------------------------------------------- | ------------------------------------------- | ---- | ---------------- |
| `services/online-evals.service.ts` → providers     | `GET /api/{org}/providers`                  | T1   | **localStorage** |
| `services/online-evals.service.ts` → score configs | `GET /api/{org}/score_configs`              | T2   | memory           |
| `services/online-evals.service.ts` → scorers       | `GET /api/{org}/scorers`                    | T2   | memory           |
| `services/online-evals.service.ts` → eval jobs     | `GET /api/{org}/eval_jobs`                  | T2   | memory           |
| `services/billings.ts` → subscription              | `GET /api/{org}/billings/list_subscription` | T2   | memory only      |
| `services/billings.ts` → invoices                  | `GET /api/{org}/billings/invoices`          | T2   | memory only      |
| `services/billings.ts` → AI usage                  | `GET /api/{org}/ai/usage`                   | T2   | memory only      |
| `services/billings.ts` → billing group members     | `GET /api/{org}/billing_group/members`      | T2   | memory only      |

### Server-paginated (all now share one cached page query per surface)

| Module                                                                            | API                                | Tier | Storage |
| --------------------------------------------------------------------------------- | ---------------------------------- | ---- | ------- |
| `services/alerts.ts` — also used by AlertHistoryDrawer and AlertEvaluationHistory | `GET /api/v2/{org}/alerts/history` | T2   | memory  |

### Polling

| Module                  | API                                      | Tier                       | Storage |
| ----------------------- | ---------------------------------------- | -------------------------- | ------- |
| `OrgCleanupTasksDialog` | `GET /api/_meta/org_cleanup_tasks/{org}` | T4 + `refetchInterval: 5s` | memory  |

### Pre-existing cache kept as-is

| Module            | API                                         | Storage                                                                            |
| ----------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `fieldValueDB.ts` | log field values (Values API + search hits) | **IndexedDB** `o2FieldValues`, sliding TTL + LRU. Now purged on org switch/logout. |

---

## 3. Not migrated — proposed tier and storage

Ordered by value. **Storage** is what the proposed tier implies.

### 3a. High value — shared, stable, cheap to cache

> Two proposals in this section were wrong and were corrected while migrating:
> **license** is T4/memory, not T0/localStorage — the payload carries live
> ingestion-usage counters and the key is replaceable from the settings page, so
> freezing it would show stale entitlement right after an update. **Nodes** is
> memory, not persisted — stale cluster topology is more confusing than a second
> of loading. Treat the tiers below as proposals to verify against the payload,
> not as decisions already made.

| #   | Module / page           | API                                                              | Proposed | Storage          | Why                                                                         |
| --- | ----------------------- | ---------------------------------------------------------------- | -------- | ---------------- | --------------------------------------------------------------------------- |
| 3   | `settings.listSettings` | `GET /api/{org}/settings/v2`                                     | T1       | **localStorage** | Backs both of the above; one query could serve all user settings.           |
| 6   | Stream schema drawer    | `GET /api/{org}/streams/{name}/schema`                           | T1       | memory           | Per-stream; a schema changes rarely but is re-fetched on every drawer open. |
| 7   | Enrichment table status | `GET /api/{org}/enrichment_tables/status`                        | T2       | memory           | Paired with the enrichment list on every mount.                             |
| 12  | Domain management       | `GET /api/{metaOrg}/domain_management`                           | T1       | memory           | Settings page.                                                              |
| 13  | Org storage settings    | `GET /api/{org}/storage`                                         | T1       | memory           | Settings page.                                                              |
| 15  | GenAI agent mapping     | `GET /api/{org}/settings/gen_ai/agent_mapping`, `/gen_ai/agents` | T1       | **localStorage** | Settings page.                                                              |
| 16  | Service streams         | `GET /api/{org}/service_streams`, `/config/identity`             | T1       | memory           | Service catalog; stable.                                                    |

### 3b. IAM — one query per resource

| #   | Page                | API                                                                 | Proposed | Storage |
| --- | ------------------- | ------------------------------------------------------------------- | -------- | ------- |
| 22  | User roles / groups | `GET /api/{org}/users/{email}/roles`, `/groups`, `/users/roles/all` | T2       | memory  |

### 3c. Detail reads (open one entity)

| #   | Entity                                      | API                                          | Proposed | Storage                                               |
| --- | ------------------------------------------- | -------------------------------------------- | -------- | ----------------------------------------------------- |
| 23  | Single dashboard                            | `GET /api/{org}/dashboards/{id}`             | T3       | memory (keep `hash` for optimistic-concurrency saves) |
| 24  | Single alert                                | `GET /api/v2/{org}/alerts/{id}`              | T3       | memory                                                |
| 25  | Single pipeline                             | `GET /api/{org}/pipelines/{name}`            | T3       | memory                                                |
| 26  | Single SLO + groups                         | `GET /api/{org}/slos/{id}`, `/groups`        | T3       | memory                                                |
| 27  | Single monitor                              | `GET /api/{org}/synthetics/{id}`             | T3       | memory                                                |
| 28  | Single report                               | `GET /api/v2/{org}/reports/{id}`             | T3       | memory                                                |
| 29  | Single cipher key / regex / toolset / model | `…/{name\|id}`                               | T3       | memory                                                |
| 30  | Dashboard annotations                       | `GET /api/{org}/dashboards/{id}/annotations` | T3       | memory                                                |

### 3d. Server-paginated tables still on hand-rolled pagination

Each needs `useServerTable` (or the `fetch/refetch/prefetch` trio) for
`keepPreviousData` + next-page prefetch — the fix for the blank-table flicker.

| #   | Table                 | API                                                                                             | Proposed | Storage                                                      |
| --- | --------------------- | ----------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| 33  | PipelineHistory       | `GET /api/{org}/pipelines/history` — called inline via `http()`, not through a service          | T2       | memory                                                       |
| 34  | Workflow runs         | `GET /api/{org}/workflows/{id}/history`                                                         | T4       | memory (volatile)                                            |
| 35  | Synthetics runs       | `GET /api/{org}/synthetics/{id}/runs`                                                           | T2       | memory                                                       |
| 36  | RUM SessionsList      | `GET /api/{org}/{stream}/traces/session`                                                        | T2       | memory                                                       |
| 37  | QualityRunsTable      | `GET /api/{org}/eval_jobs`                                                                      | T2       | memory                                                       |
| 38  | Organizations (admin) | `GET /api/organizations`                                                                        | T2       | memory (currently client-paginated with `page_size=1000000`) |
| 39  | Query history         | `POST /api/{org}/_search_history` — a POST-shaped read; cacheable, but the body must be the key | T2       | memory                                                       |
| 40  | Tickets / attachments | `GET /api/tickets`                                                                              | T2       | memory                                                       |

### 3e. Polling — mostly a false premise, verified

Only `OrgCleanupTasksDialog` had the defect this section was written for (a
timer that had to be started, stopped and torn down by hand). Checked against
the source:

- **Running queries** and **backfill jobs** have no `setInterval` at all. There
  is nothing to convert, and no dedup to win — a single caller with
  `staleTime: 0` gains nothing. Deliberately not migrated.
- **Incident RCA** and **AWS marketplace activation** do poll, but both already
  clear their own timer on every terminal state. Converting them means
  rewriting a working state machine on flows that are hard to exercise, for no
  behavioural gain. Deliberately not migrated.

| #   | Where                         | API                                                   | Proposed                      | Storage |
| --- | ----------------------------- | ----------------------------------------------------- | ----------------------------- | ------- |
| 41  | IncidentDetailDrawer RCA poll | `GET /api/v2/{org}/alerts/incidents/{id}/rca/history` | T4 + interval while in flight | memory  |
| 42  | Running queries               | `GET /api/{org}/query_manager/status`                 | T4 + 5 s                      | memory  |
| 43  | Backfill jobs                 | `GET /api/{org}/pipelines/backfill`                   | T4 + interval while running   | memory  |
| 44  | AwsMarketplaceSetup           | `GET /api/{org}/aws-marketplace/activation-status`    | T4                            | memory  |

### 3f. Incidents

| #   | Surface                               | API                                  | Proposed                    | Storage |
| --- | ------------------------------------- | ------------------------------------ | --------------------------- | ------- |
| 45  | Incident list                         | `GET /api/v2/{org}/alerts/incidents` | T2 (status/severity in key) | memory  |
| 46  | Incident detail                       | `…/incidents/{id}`                   | T3                          | memory  |
| 47  | Incident stats                        | `…/incidents/stats`                  | T2                          | memory  |
| 48  | Incident events                       | `…/incidents/{id}/events`            | T3                          | memory  |
| 49  | Alert insights (5 endpoints)          | `/api/{org}/alerts/insights/*`       | T2                          | memory  |
| 50  | Anomaly detection list/config/history | `/api/{org}/anomaly_detection*`      | T2 / T3                     | memory  |

### 3g. Heavy results — IndexedDB candidates

| #   | Surface                   | API                                                | Proposed | Storage                                      |
| --- | ------------------------- | -------------------------------------------------- | -------- | -------------------------------------------- |
| 52  | Service graph topology    | `/api/{org}/traces/service_graph/topology/current` | T5       | **IndexedDB**                                |
| 53  | Dashboard variable values | `stream.fieldValues` / WS                          | T5       | **IndexedDB** (shares the field-value store) |
| 54  | PromQL label discovery    | `get_promql_series`, `/prometheus/api/v1/metadata` | T1       | memory                                       |

---

### 3h. Enterprise modules (`src/enterprise/`) — none migrated

Nothing under `src/enterprise/` was touched by the migration. Note the
distinction: enterprise-_gated_ features that live outside that tree — cipher
keys, AI toolsets, regex patterns, IAM groups and roles — **are** migrated;
they sit in `src/components` and are gated at runtime by `config.isEnterprise`.
It is the `src/enterprise/` tree itself that is untouched.

**Online Evals** — `src/enterprise/components/onlineEvals` (35 files, 49 imports
of `online-evals.service`). The cleanest area to migrate: four plain org-scoped
lists behind one service.

| #   | Surface               | API                                          | Proposed | Storage |
| --- | --------------------- | -------------------------------------------- | -------- | ------- |
| 57  | Score config versions | `GET /api/{org}/score_configs/{id}/versions` | T3       | memory  |

Writes (`create` / `update` / `delete` / `activate` / `pause` / `manual_eval`)
become `useOrgMutation` with a prefix invalidate. `scorers/test` and
`llm_judge/output_schema` are POST previews — never cache.

**AI Observability** — `src/enterprise/{views,components}/AIObservability`
(20 files).

| #   | Surface             | API                                                              | Proposed | Storage                                               |
| --- | ------------------- | ---------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| 60  | Agent signals       | `GET /api/{org}/traces/agent_signals`                            | T2       | memory — reads a small derived stream, not raw traces |
| 61  | GenAI agent mapping | `GET /api/{org}/settings/gen_ai/agent_mapping`, `/gen_ai/agents` | T1       | **localStorage** — same rows as §3a #15               |

The rest of these pages run `search.search`, which stays **out of scope** (§4).

**Billings** — `src/enterprise/components/billings` (12 files). This one needs
triage, not bulk conversion: **most billing GETs are one-shot and must not be
cached.**

| #   | Surface         | API                                       | Proposed | Storage |
| --- | --------------- | ----------------------------------------- | -------- | ------- |
| 64  | Quota threshold | `GET /api/{org}/billings/quota_threshold` | T1       | memory  |

**Never cache in billings** — each returns a single-use URL, token or a
state-changing result despite the GET verb:
`hosted_subscription_url`, `billing_portal`, `hosted_page_status/{id}`,
`change_payment_detail/{id}`, `list_paymentsource` (payment instrument data),
`unsubscribe` and `resume_subscription` (both mutate through a GET).

### 3i. Deliberately left uncached — decisions, not backlog

Verified against the source while working through §3. These are **not** pending
items; migrating them would be wrong or a net loss.

| Surface                                              | Why not                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Single dashboard (`get_Dashboard`)                   | Read inside the save path, where its `hash` drives optimistic concurrency. A cached hash means a spurious save conflict. |
| Running queries, backfill jobs                       | No `setInterval` to convert and a single caller, so `staleTime: 0` buys nothing.                                         |
| Incident RCA poll, AWS marketplace poll              | Already self-limiting; the timers clear on every terminal state.                                                         |
| Read-modify-write reads (`WorkflowLinkAlertsDialog`) | Reads an alert then immediately writes it back. A cached read would overwrite someone else's edit.                       |
| Billing single-use URLs and GET-mutations            | Listed in `services/billings.ts`; caching any of them is a correctness bug.                                              |

## 4. Explicitly out of scope — do not cache

Per audit §5.9. These are not "to be migrated"; they must stay uncached.

| Area                                                             | API                                        | Why                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Logs / Traces / Metrics search                                   | `search.search`, `_around`, partitions, WS | Streaming, partitioned, cancellable, per-partition progress. Ad-hoc per keystroke, near-zero reuse; the backend already has `use_cache`. |
| Stream Explorer table                                            | `search.search` (SQL)                      | Same — it is a search, not a list.                                                                                                       |
| RUM error tracking / performance                                 | dashboard-backed `search.search`           | Same.                                                                                                                                    |
| SSE / AI chat streams                                            | `ai_chat.*`                                | Streaming.                                                                                                                               |
| Ingestion, login, file upload                                    | `POST`/`PUT`/`DELETE`                      | One-shot, side-effecting. Use `useOrgMutation` — invalidate, never cache.                                                                |
| Short URL resolve, `verify_identifier`, billing hosted-page URLs | one-shot                                   | Single-use tokens/URLs.                                                                                                                  |

---

## 5. Never persisted — memory only, whatever the tier

These are org config by shape, so they would land in localStorage by default.
They must pass `persist: "none"`.

| Value                   | API                                         | Status                                                             |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| RUM client token        | inside `GET /config`                        | **done** — `services/config.ts`                                    |
| Cipher key material     | `GET /api/{org}/cipher_keys`                | **done** — `services/cipher_keys.ts`                               |
| Ingestion tokens        | `GET /api/{org}/ingestion-tokens`           | to do                                                              |
| Org passcode            | `GET /api/{org}/passcode`                   | to do                                                              |
| User / RUM API keys     | `GET /api/usertoken`, `/api/{org}/rumtoken` | to do                                                              |
| Service-account tokens  | inside `GET /api/{org}/service_accounts`    | to do — currently T2, so memory-only anyway, but pin it explicitly |
| Synthetics agent tokens | `GET /api/{org}/synthetics/agent-tokens`    | to do                                                              |

---

## 6. Adding a new one

```ts
// services/<domain>.ts — below the URL builders it calls
export const thingQuery = defineQuery<[], Thing[]>({
  key: ["things", "list"], // → ["org", <org>, "things", "list"]
  fetch: async (org) => (await thingService.list(org)).data?.list ?? [],
  tier: "ENTITY_LIST", // pick a tier, never a staleTime
  persist: "none", // only if it carries a secret
});
```

Then in the page: `thingQuery.get(org)` for the mount path,
`thingQuery.refresh(org)` behind a refresh button, and
`thingQuery.invalidate(org)` after every write.

Loaders take a `force` flag — mount stays cached, refresh and post-write reloads
pass `true`. Never bind a loader straight to a template event
(`@click="getX"`): the event object lands in `force`.

---

## 7. Where the rules live — done

The conventions are written down in two places, and the difference matters:

| File                                                      | Why there                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `.claude/rules/fe-data-fetching.md`                       | Rules are auto-loaded into every session, so this is what actually enforces the convention on new code. Untracked mirror. |
| `.claude/skills/ui-architect/references/data-fetching.md` | The canonical, tracked copy, reached from the `ui-architect` skill. `data-fetching-inventory.md` beside it is this file.  |

Both carry: the layer table, the decision tree below, the `defineQuery` template
from §6, the `force` convention and the `@click="getX"` trap, "invalidate by
prefix, never re-call the loader", and the never-cache / never-persist lists from
§4 and §5.

### The decision tree — where a new endpoint goes

```
New endpoint
├─ Not a GET, or streaming, or a single-use URL? ──────► no cache.
│                                                        useOrgMutation for writes.
└─ GET, reused across surfaces or across visits?
   ├─ Immutable for the session (config, license, built-ins)? ──► T0  localStorage
   ├─ Org configuration (streams, folders, functions)?         ──► T1  localStorage
   ├─ A list of entities?                                      ──► T2  memory
   ├─ One entity?                                              ──► T3  memory
   ├─ Operational state you poll?                              ──► T4  memory
   │                                                                 + refetchInterval
   └─ Large result payload (panel, DAG, field values)?         ──► T5  IndexedDB
        │
        └─ then, regardless of tier:
           does the payload carry a token, key or passcode? ──yes──► persist: "none"
```

---

## 8. Listing surfaces — what paints from cache

§2 says which **endpoints** are cached. This section says which **screens**
actually benefit, which is not the same question: a page can call a cached
endpoint and still blank, and a page can look instant while calling an uncached
one. Both happen in this codebase.

Every component rendering `OTable` / `q-table` was audited against the service
it imports. 60 surfaces, four states.

**The measurement.** Visit the page, leave, let the entry pass its `staleTime`,
return, and sample the row count every 20ms against the network timing. A page
passes when rows are on screen _before_ the response lands.

| Page              | Rows painted | Response           |     |
| ----------------- | ------------ | ------------------ | --- |
| Streams           | 83 ms        | 543 ms             | ✅  |
| Dashboards        | 56 ms        | no request (fresh) | ✅  |
| IAM users, before | 528 ms       | 490 ms             | ❌  |
| IAM users, after  | 64 ms        | 534 ms             | ✅  |

---

### a. Cached and stale-while-revalidate (19)

The rows already in hand paint first, the refetch runs behind them. Only a cold
cache shows a spinner.

`AlertHistory` · `AlertList` · `ExternalAlertSourcesList` · `IngestionTokens` ·
`SyntheticsTokens` · `AppGroups` · `GroupRoles` · `ServiceAccountsList` ·
`User` · `PipelinesList` · `ReportList` · `AiToolsets` · `CipherKeys` ·
`ModelPricingList` · `Nodes` · `RegexPatternList` · `WorkflowsList` ·
`LogStream` · `SloList`

Two of these needed structural work before a second paint was safe:

- **`AlertList`** minted `getUUID()` per row, and the uuid keys
  `alertStateLoadingMap` and the enable/disable match — so repainting handed
  every alert a new identity. Uuids are stable per alert now.
- **`User`** opens the edit dialog for a `?email=` deep link from inside its
  response handler and merges cloud invited-members. The row mapping is split
  out, the deep link is latched, and the invited-members merge stays on the
  fresh pass — so a cached paint is org members alone.

### b. Cached, but still awaits the network (4)

These read through a query, so the request is deduped and shared, but the
component paints only after it resolves.

| Surface                  | Why it was left                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `Quota`                  | Mints `getUUID()` per role row, so a second paint churns identities. A settings form, not a list.   |
| `AlertHistoryDrawer`     | A drawer opened per alert — there is rarely a previous result for _this_ alert to show.             |
| `AlertEvaluationHistory` | Same shape as the drawer. The Alert History **page** is in (a).                                     |
| `invoiceTable`           | Billing history, opened rarely; the win is small and the payload is not worth a second render pass. |

### c. Never cached, by design (7)

Ad-hoc search results, session replay and running-query inspection. Caching
these would serve someone a previous query's answer. See §4.

`ScheduledPipeline` · `PlayerTracesTab` · `AgentSignalDetailPanel` ·
`SearchHistory` · `SearchJobInspector` · `SearchSchedulersList` · `AppSessions`

### d. Uncached — the remaining gap (30)

These call their service directly and re-request on every visit. They **cannot**
show stale data: there is nothing cached to show. For most of them the query
already exists and is used by other consumers (a form, a picker, the Logs
sidebar) — the list page was simply never switched over.

| Area           | Surfaces                                                                                                                                | Query that already exists                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Reliability    | `TemplateList` · `AlertsDestinationList` · `PipelinesDestinationList` · `IncidentList` · `IncidentAlertTriggersTable` · `ActionScripts` | `templatesQuery`, `destinationsQuery`, `incidentsQuery`, `actionsQuery` |
| Data           | `FunctionList` · `EnrichmentTableList` · `PipelineHistory` · `ServicesCatalog` · `StreamExplorer`                                       | `functionsQuery`, `pipelinesQuery`                                      |
| IAM / Settings | `ListOrganizations` · `OrganizationManagement` · `InvitationList` · `SyntheticsLocationsList` · `LlmProvidersSettings`                  | `orgListQuery`, `pendingInvitesQuery`                                   |
| Synthetics/SLO | `MonitorRuns` · `PrivateLocationDetail` · `SloDetail` · `WorkflowRunsPanel`                                                             | `slosQuery`, `workflowsQuery`                                           |
| Enterprise     | 7 online-evals tables · `BillingGroup`                                                                                                  | `providersQuery`, `scoreConfigsQuery`, `scorersQuery`, `evalJobsQuery`  |
| Logs           | `SearchBar` (saved views + functions half)                                                                                              | `savedViewsQuery`, `functionsQuery`                                     |

**A page here can still look instant, and that is a trap.** `TemplateList`
painted at 49 ms against an 836 ms response, and `SearchHistory` at 42 ms
against 865 ms — not because anything is cached, but because their rows survive
a remount in shared component state. The screen is fine; the request still goes
out every time. Do not read "no flicker" as "cached".

---

### How to close a gap in (d)

The query exists, so it is the §6 conversion plus a `swr()` call:

```ts
const { cached, fresh } = templatesQuery.swr(org);
if (cached) applyRows(cached);
else loading.value = true;
applyRows(await fresh);
```

Two things to check before converting a page:

1. **Does the response handler have side effects?** Opening a dialog, firing a
   second request, minting a row id. If so, split the pure row mapping out and
   leave the effects on the fresh pass — `AlertList` and `User` are the worked
   examples. If it cannot be split, use `peek()` to skip the spinner instead,
   and accept that a cold surface still waits.
2. **Is the row identity stable?** A row keyed by `getUUID()` cannot be painted
   twice. Give it an identity derived from the entity first.
