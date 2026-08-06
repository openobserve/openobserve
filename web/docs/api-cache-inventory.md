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

| Tier | staleTime | gcTime | Storage | Survives reload? | Focus refetch |
|---|---|---|---|---|---|
| `SESSION_STATIC` (T0) | ∞ | ∞ | **localStorage** (24 h) | yes | no |
| `ORG_CONFIG` (T1) | 5 min | 30 min | **localStorage** (24 h) | yes | no |
| `ENTITY_LIST` (T2) | 30 s | 5 min | **memory only** | no | yes |
| `ENTITY_DETAIL` (T3) | 30 s | 5 min | **memory only** | no | no |
| `VOLATILE` (T4) | 0 | 60 s | **memory only** | no | yes |
| `HEAVY_RESULT` (T5) | 0 | 30 min | **IndexedDB** (24 h + LRU) | yes | no |

Any query can override its tier's storage with `persist: "none"` — used for
anything carrying a secret (see §5).

### Physical layout

| Where | Key shape | Written by |
|---|---|---|
| `localStorage` | `o2q-["org","<org>",…]` | T0/T1 query persister |
| IndexedDB `o2Cache` → `kv` | `o2q-heavy-["org","<org>",…]` | T5 query persister |
| IndexedDB `o2Cache` → `kv` | `panel\|<org>\|<folder>\|<dashboard>\|<panel>\|<digest>` | dashboard panel results |
| IndexedDB `o2FieldValues` → `fieldValues` | `<org>\|<streamType>\|<stream>\|<field>` | log field autocomplete |
| memory | — | T2/T3/T4 |

### Lifecycle — what survives what

Every key carries the org, which is what makes the two events below safe.

| Event | Memory | localStorage / IndexedDB |
|---|---|---|
| **Org switch** | **kept** | **purged** for the org being left |
| **Logout** | cleared | purged entirely (incl. `o2FieldValues`) |

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
  optimisation for the *current* org, not a per-org archive.
- If a user's access to an org is revoked while they are elsewhere, switching
  back renders cached rows until the refetch 403s. Inherent to any cache within
  `staleTime`, not specific to this choice.

Implemented in `purgeOrgQueries` / `purgeAllQueries` (`queryClient.ts`).

---

## 2. Migrated — currently cached

26 query modules live in `web/src/composables/query/queries/`, covering 63 reads,
plus the two pre-existing IndexedDB caches now folded into the same purge path.

### App shell

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/config.ts` | `GET /config` | T0 | **memory only** — payload carries the RUM client token (§5) |

### Streams

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/streams.ts` → `streamNameList` | `GET /api/{org}/streams?type=` | T1 | **localStorage** |
| `queries/streams.ts` → `streamPage` | same, paginated (`offset/limit/keyword/sort/asc`) | T2 | memory |

### Folders & functions

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/folders.ts` | `GET /api/v2/{org}/folders/{type}` | T1 | **localStorage** |
| `queries/functions.ts` | `GET /api/{org}/functions` | T1 | **localStorage** |

### Alerts

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/alerts.ts` | `GET /api/v2/{org}/alerts` (folder + name search) | T2 | memory |
| `queries/alertMeta.ts` → destinations | `GET /api/{org}/alerts/destinations` | T1 | **localStorage** |
| `queries/alertMeta.ts` → templates | `GET /api/{org}/alerts/templates` | T1 | **localStorage** |
| `queries/alertHistory.ts` | `GET /api/v2/{org}/alerts/history` | T2 | memory |
| `queries/alertSources.ts` | `GET /api/v2/{org}/incidents/integrations` | T2 | memory |

### Dashboards

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/dashboards.ts` | `GET /api/{org}/dashboards?folder=` | T2 | memory |
| `dashboard/usePanelCache.ts` | panel execution results | — | **IndexedDB** (`panel\|…`, 24 h + LRU 200) |

### Lists

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/reports.ts` | `GET /api/v2/{org}/reports` (folder + tab + name) | T2 | memory |
| `queries/pipelines.ts` | `GET /api/{org}/pipelines` | T2 | memory |
| `queries/slos.ts` | `GET /api/{org}/slos` | T2 | memory |
| `queries/workflows.ts` | `GET /api/{org}/workflows` | T2 | memory |
| `queries/synthetics.ts` | `GET /api/{org}/synthetics` | T2 | memory |
| `queries/iamLists.ts` → users | `GET /api/{org}/users` | T2 | memory |
| `queries/iamLists.ts` → service accounts | `GET /api/{org}/service_accounts` | T2 | memory |

### Settings

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/settingsLists.ts` → cipher keys | `GET /api/{org}/cipher_keys` | T1 | **memory only** — key material (§5) |
| `queries/settingsLists.ts` → regex patterns | `GET /api/{org}/re_patterns` | T1 | **localStorage** |
| `queries/settingsLists.ts` → AI toolsets | `GET /api/{org}/ai/toolsets` | T1 | **localStorage** |
| `queries/settingsLists.ts` → model pricing | `GET /api/{org}/llm/models` | T1 | **localStorage** |
| `queries/regexPatterns.ts` → built-in | `GET /api/{org}/re_patterns/built-in` | T0 | **localStorage** |

### App settings & org metadata

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/userSettings.ts` → favourites | `GET /api/{org}/settings/v2/favorite_dashboards` | T1 | **localStorage** (key includes the user id) |
| `queries/userSettings.ts` → home dashboard | `GET /api/{org}/settings/v2/home_dashboard` | T1 | **localStorage** |
| `queries/orgMeta.ts` → org settings | `GET /api/{org}/settings` | T1 | **localStorage** |
| `queries/orgMeta.ts` → nodes | `GET /api/{org}/node/list` | T1 | memory — cluster state is more confusing stale than slow |
| `queries/orgMeta.ts` → license | `GET /api/license` | T4 | memory — carries live usage counters (see below) |
| `queries/actions.ts` | `GET /api/{org}/actions` | T1 | **localStorage** — read on every Logs entry |
| `queries/savedViews.ts` | `GET /api/{org}/savedviews` | T2 | memory |

### Credentials — cached, never persisted

Every query in `queries/tokens.ts` pins `persist: "none"` explicitly, on the
query, so the override survives anyone re-tiering these later.

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/tokens.ts` → ingestion tokens | `GET /api/{org}/ingestion-tokens` | T2 | memory only |
| `queries/tokens.ts` → org passcode | `GET /api/{org}/passcode` | T2 | memory only |
| `queries/tokens.ts` → RUM tokens | `GET /api/{org}/rumtoken` | T2 | memory only |
| `queries/tokens.ts` → agent tokens | `GET /api/{org}/synthetics/agent-tokens` | T2 | memory only |
| `queries/settingsLists.ts` → cipher keys | (already listed above) | T1 | memory only |
| `queries/config.ts` | (already listed above) | T0 | memory only |

### IAM

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/iam.ts` → groups | `GET /api/{org}/groups` | T2 | memory |
| `queries/iam.ts` → roles | `GET /api/{org}/roles` | T2 | memory |
| `queries/iam.ts` → resources | `GET /api/{org}/resources` | T1 | **localStorage** — enum-like |
| `queries/iam.ts` → role permissions | `GET /api/{org}/roles/{name}/permissions` | T3 | memory |
| `queries/iam.ts` → pending invites | `GET /api/invites` | T2 | memory |

### Traces

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/functions.ts` → query functions | `GET /api/{org}/query_functions` | T1 | **localStorage** — SQL-editor autocomplete catalogue |
| `queries/alerts.ts` → alert detail | `GET /api/v2/{org}/alerts/{id}` | T3 | memory |
| `queries/pipelines.ts` → pipeline detail | `GET /api/{org}/pipelines/{name}` | T3 | memory |
| `queries/slos.ts` → SLO detail | `GET /api/{org}/slos/{id}` | T3 | memory |
| `queries/synthetics.ts` → monitor detail | `GET /api/{org}/synthetics/{id}` | T3 | memory |
| `queries/reports.ts` → report detail | `GET /api/v2/{org}/reports/{id}` | T3 | memory |
| `queries/settingsLists.ts` → cipher key detail | `GET /api/{org}/cipher_keys/{name}` | T3 | memory |
| `queries/dashboards.ts` → annotations | `GET /api/{org}/dashboards/{id}/annotations` | T3 | memory |
| `queries/traces.ts` → trace DAG | `GET /api/{org}/{stream}/traces/{id}/dag` | T5, `staleTime: Infinity` | **IndexedDB** — a trace is immutable, so each time window is cacheable forever |

### Enterprise

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/onlineEvals.ts` → providers | `GET /api/{org}/providers` | T1 | **localStorage** |
| `queries/onlineEvals.ts` → score configs | `GET /api/{org}/score_configs` | T2 | memory |
| `queries/onlineEvals.ts` → scorers | `GET /api/{org}/scorers` | T2 | memory |
| `queries/onlineEvals.ts` → eval jobs | `GET /api/{org}/eval_jobs` | T2 | memory |
| `queries/billing.ts` → subscription | `GET /api/{org}/billings/list_subscription` | T2 | memory only |
| `queries/billing.ts` → invoices | `GET /api/{org}/billings/invoices` | T2 | memory only |
| `queries/billing.ts` → AI usage | `GET /api/{org}/ai/usage` | T2 | memory only |
| `queries/billing.ts` → billing group members | `GET /api/{org}/billing_group/members` | T2 | memory only |

### Server-paginated (all now share one cached page query per surface)

| Module | API | Tier | Storage |
|---|---|---|---|
| `queries/alertHistory.ts` — also used by AlertHistoryDrawer and AlertEvaluationHistory | `GET /api/v2/{org}/alerts/history` | T2 | memory |

### Polling

| Module | API | Tier | Storage |
|---|---|---|---|
| `OrgCleanupTasksDialog` | `GET /api/_meta/org_cleanup_tasks/{org}` | T4 + `refetchInterval: 5s` | memory |

### Pre-existing cache kept as-is

| Module | API | Storage |
|---|---|---|
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

| # | Module / page | API | Proposed | Storage | Why |
|---|---|---|---|---|---|
| 3 | `settings.listSettings` | `GET /api/{org}/settings/v2` | T1 | **localStorage** | Backs both of the above; one query could serve all user settings. |
| 6 | Stream schema drawer | `GET /api/{org}/streams/{name}/schema` | T1 | memory | Per-stream; a schema changes rarely but is re-fetched on every drawer open. |
| 7 | Enrichment table status | `GET /api/{org}/enrichment_tables/status` | T2 | memory | Paired with the enrichment list on every mount. |
| 12 | Domain management | `GET /api/{metaOrg}/domain_management` | T1 | memory | Settings page. |
| 13 | Org storage settings | `GET /api/{org}/storage` | T1 | memory | Settings page. |
| 15 | GenAI agent mapping | `GET /api/{org}/settings/gen_ai/agent_mapping`, `/gen_ai/agents` | T1 | **localStorage** | Settings page. |
| 16 | Service streams | `GET /api/{org}/service_streams`, `/config/identity` | T1 | memory | Service catalog; stable. |

### 3b. IAM — one query per resource

| # | Page | API | Proposed | Storage |
|---|---|---|---|---|
| 22 | User roles / groups | `GET /api/{org}/users/{email}/roles`, `/groups`, `/users/roles/all` | T2 | memory |

### 3c. Detail reads (open one entity)

| # | Entity | API | Proposed | Storage |
|---|---|---|---|---|
| 23 | Single dashboard | `GET /api/{org}/dashboards/{id}` | T3 | memory (keep `hash` for optimistic-concurrency saves) |
| 24 | Single alert | `GET /api/v2/{org}/alerts/{id}` | T3 | memory |
| 25 | Single pipeline | `GET /api/{org}/pipelines/{name}` | T3 | memory |
| 26 | Single SLO + groups | `GET /api/{org}/slos/{id}`, `/groups` | T3 | memory |
| 27 | Single monitor | `GET /api/{org}/synthetics/{id}` | T3 | memory |
| 28 | Single report | `GET /api/v2/{org}/reports/{id}` | T3 | memory |
| 29 | Single cipher key / regex / toolset / model | `…/{name\|id}` | T3 | memory |
| 30 | Dashboard annotations | `GET /api/{org}/dashboards/{id}/annotations` | T3 | memory |

### 3d. Server-paginated tables still on hand-rolled pagination

Each needs `useServerTable` (or the `fetch/refetch/prefetch` trio) for
`keepPreviousData` + next-page prefetch — the fix for the blank-table flicker.

| # | Table | API | Proposed | Storage |
|---|---|---|---|---|
| 33 | PipelineHistory | `GET /api/{org}/pipelines/history` — called inline via `http()`, not through a service | T2 | memory |
| 34 | Workflow runs | `GET /api/{org}/workflows/{id}/history` | T4 | memory (volatile) |
| 35 | Synthetics runs | `GET /api/{org}/synthetics/{id}/runs` | T2 | memory |
| 36 | RUM SessionsList | `GET /api/{org}/{stream}/traces/session` | T2 | memory |
| 37 | QualityRunsTable | `GET /api/{org}/eval_jobs` | T2 | memory |
| 38 | Organizations (admin) | `GET /api/organizations` | T2 | memory (currently client-paginated with `page_size=1000000`) |
| 39 | Query history | `POST /api/{org}/_search_history` — a POST-shaped read; cacheable, but the body must be the key | T2 | memory |
| 40 | Tickets / attachments | `GET /api/tickets` | T2 | memory |

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


| # | Where | API | Proposed | Storage |
|---|---|---|---|---|
| 41 | IncidentDetailDrawer RCA poll | `GET /api/v2/{org}/alerts/incidents/{id}/rca/history` | T4 + interval while in flight | memory |
| 42 | Running queries | `GET /api/{org}/query_manager/status` | T4 + 5 s | memory |
| 43 | Backfill jobs | `GET /api/{org}/pipelines/backfill` | T4 + interval while running | memory |
| 44 | AwsMarketplaceSetup | `GET /api/{org}/aws-marketplace/activation-status` | T4 | memory |

### 3f. Incidents

| # | Surface | API | Proposed | Storage |
|---|---|---|---|---|
| 45 | Incident list | `GET /api/v2/{org}/alerts/incidents` | T2 (status/severity in key) | memory |
| 46 | Incident detail | `…/incidents/{id}` | T3 | memory |
| 47 | Incident stats | `…/incidents/stats` | T2 | memory |
| 48 | Incident events | `…/incidents/{id}/events` | T3 | memory |
| 49 | Alert insights (5 endpoints) | `/api/{org}/alerts/insights/*` | T2 | memory |
| 50 | Anomaly detection list/config/history | `/api/{org}/anomaly_detection*` | T2 / T3 | memory |

### 3g. Heavy results — IndexedDB candidates

| # | Surface | API | Proposed | Storage |
|---|---|---|---|---|
| 52 | Service graph topology | `/api/{org}/traces/service_graph/topology/current` | T5 | **IndexedDB** |
| 53 | Dashboard variable values | `stream.fieldValues` / WS | T5 | **IndexedDB** (shares the field-value store) |
| 54 | PromQL label discovery | `get_promql_series`, `/prometheus/api/v1/metadata` | T1 | memory |

---

### 3h. Enterprise modules (`src/enterprise/`) — none migrated

Nothing under `src/enterprise/` was touched by the migration. Note the
distinction: enterprise-*gated* features that live outside that tree — cipher
keys, AI toolsets, regex patterns, IAM groups and roles — **are** migrated;
they sit in `src/components` and are gated at runtime by `config.isEnterprise`.
It is the `src/enterprise/` tree itself that is untouched.

**Online Evals** — `src/enterprise/components/onlineEvals` (35 files, 49 imports
of `online-evals.service`). The cleanest area to migrate: four plain org-scoped
lists behind one service.

| # | Surface | API | Proposed | Storage |
|---|---|---|---|---|
| 57 | Score config versions | `GET /api/{org}/score_configs/{id}/versions` | T3 | memory |

Writes (`create` / `update` / `delete` / `activate` / `pause` / `manual_eval`)
become `useOrgMutation` with a prefix invalidate. `scorers/test` and
`llm_judge/output_schema` are POST previews — never cache.

**AI Observability** — `src/enterprise/{views,components}/AIObservability`
(20 files).

| # | Surface | API | Proposed | Storage |
|---|---|---|---|---|
| 60 | Agent signals | `GET /api/{org}/traces/agent_signals` | T2 | memory — reads a small derived stream, not raw traces |
| 61 | GenAI agent mapping | `GET /api/{org}/settings/gen_ai/agent_mapping`, `/gen_ai/agents` | T1 | **localStorage** — same rows as §3a #15 |

The rest of these pages run `search.search`, which stays **out of scope** (§4).

**Billings** — `src/enterprise/components/billings` (12 files). This one needs
triage, not bulk conversion: **most billing GETs are one-shot and must not be
cached.**

| # | Surface | API | Proposed | Storage |
|---|---|---|---|---|
| 64 | Quota threshold | `GET /api/{org}/billings/quota_threshold` | T1 | memory |

**Never cache in billings** — each returns a single-use URL, token or a
state-changing result despite the GET verb:
`hosted_subscription_url`, `billing_portal`, `hosted_page_status/{id}`,
`change_payment_detail/{id}`, `list_paymentsource` (payment instrument data),
`unsubscribe` and `resume_subscription` (both mutate through a GET).

### 3i. Deliberately left uncached — decisions, not backlog

Verified against the source while working through §3. These are **not** pending
items; migrating them would be wrong or a net loss.

| Surface | Why not |
|---|---|
| Single dashboard (`get_Dashboard`) | Read inside the save path, where its `hash` drives optimistic concurrency. A cached hash means a spurious save conflict. |
| Running queries, backfill jobs | No `setInterval` to convert and a single caller, so `staleTime: 0` buys nothing. |
| Incident RCA poll, AWS marketplace poll | Already self-limiting; the timers clear on every terminal state. |
| Read-modify-write reads (`WorkflowLinkAlertsDialog`) | Reads an alert then immediately writes it back. A cached read would overwrite someone else's edit. |
| Billing single-use URLs and GET-mutations | Listed in `queries/billing.ts`; caching any of them is a correctness bug. |

## 4. Explicitly out of scope — do not cache

Per audit §5.9. These are not "to be migrated"; they must stay uncached.

| Area | API | Why |
|---|---|---|
| Logs / Traces / Metrics search | `search.search`, `_around`, partitions, WS | Streaming, partitioned, cancellable, per-partition progress. Ad-hoc per keystroke, near-zero reuse; the backend already has `use_cache`. |
| Stream Explorer table | `search.search` (SQL) | Same — it is a search, not a list. |
| RUM error tracking / performance | dashboard-backed `search.search` | Same. |
| SSE / AI chat streams | `ai_chat.*` | Streaming. |
| Ingestion, login, file upload | `POST`/`PUT`/`DELETE` | One-shot, side-effecting. Use `useOrgMutation` — invalidate, never cache. |
| Short URL resolve, `verify_identifier`, billing hosted-page URLs | one-shot | Single-use tokens/URLs. |

---

## 5. Never persisted — memory only, whatever the tier

These are org config by shape, so they would land in localStorage by default.
They must pass `persist: "none"`.

| Value | API | Status |
|---|---|---|
| RUM client token | inside `GET /config` | **done** — `queries/config.ts` |
| Cipher key material | `GET /api/{org}/cipher_keys` | **done** — `queries/settingsLists.ts` |
| Ingestion tokens | `GET /api/{org}/ingestion-tokens` | to do |
| Org passcode | `GET /api/{org}/passcode` | to do |
| User / RUM API keys | `GET /api/usertoken`, `/api/{org}/rumtoken` | to do |
| Service-account tokens | inside `GET /api/{org}/service_accounts` | to do — currently T2, so memory-only anyway, but pin it explicitly |
| Synthetics agent tokens | `GET /api/{org}/synthetics/agent-tokens` | to do |

---

## 6. Adding a new one

```ts
// composables/query/queries/<domain>.ts
export const thingQuery = createOrgListQuery<Thing>({
  key:   (org) => qk.things.list(org),      // from queryKeys.ts — never an inline array
  fetch: async (org) => (await thingService.list(org)).data?.list ?? [],
  tier:  "ENTITY_LIST",                     // pick a tier, never a staleTime
  persist: "none",                          // only if it carries a secret
});
```

Then in the page: `thingQuery.fetchList(org)` for the mount path,
`thingQuery.refetchList(org)` behind a refresh button, and
`thingQuery.invalidateList(org)` after every write.

Loaders take a `force` flag — mount stays cached, refresh and post-write reloads
pass `true`. Never bind a loader straight to a template event
(`@click="getX"`): the event object lands in `force`.

---

## 7. After the migration completes — update the skills and rules

**Do this last**, once §3 is empty. The point of these files is that they
describe what the codebase *is*, so writing them while half the app is still on
the old pattern would document intent rather than reality.

Two places, and the difference matters:

| File | Why there |
|---|---|
| `.claude/rules/fe-data-fetching.md` *(new)* | Rules are auto-loaded into every session, so this is what actually enforces the convention on new code. |
| `.claude/skills/ui-architect/SKILL.md` | Add a house rule cross-referencing the above, so anyone building a new page meets the data layer alongside the O2-component and design-token rules. |

The rule file should carry:

1. The layer table from [api-cache-architecture.md](./api-cache-architecture.md)
   — which file owns which decision.
2. The decision tree below.
3. The `createOrgListQuery` template from §6.
4. The `force` convention, and the `@click="getX"` trap (a bound event object
   lands in `force`).
5. "Invalidate by prefix, never re-call the loader."
6. The never-cache list from §4 and the never-persist list from §5.

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
