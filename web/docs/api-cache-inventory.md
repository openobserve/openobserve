# API Cache Inventory — what is cached, where it is stored, what is left

**Companion to** [api-caching-audit.md](./api-caching-audit.md) (the design).
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

Every key carries the org, so **org switch** is one `removeQueries` + a prefix
scan per store, and **logout** clears all of it.

---

## 2. Migrated — currently cached

17 query modules live in `web/src/composables/query/queries/`, covering 26 reads,
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

| # | Module / page | API | Proposed | Storage | Why |
|---|---|---|---|---|---|
| 1 | `useFavoriteDashboards` | `GET /api/{org}/settings/v2/favorite_dashboards` | T1 | **localStorage** | Fetched on every Dashboards mount; drives the favorites-first landing decision, so it blocks first paint. |
| 2 | `useHomeDashboard` | `GET /api/{org}/settings/v2/home_dashboard` | T1 | **localStorage** | Same shape; read on MainLayout mount for the pinned-dashboard button. |
| 3 | `settings.listSettings` | `GET /api/{org}/settings/v2` | T1 | **localStorage** | Backs both of the above; one query could serve all user settings. |
| 4 | Org settings | `GET /api/{org}/settings` | T1 | **localStorage** | Refetched on every org switch by MainLayout. |
| 5 | Org selector | `GET /api/organizations` (`os_list`) | T1 | **localStorage** | Header dropdown; re-requested on several routes. |
| 6 | Stream schema drawer | `GET /api/{org}/streams/{name}/schema` | T1 | memory | Per-stream; a schema changes rarely but is re-fetched on every drawer open. |
| 7 | Enrichment table status | `GET /api/{org}/enrichment_tables/status` | T2 | memory | Paired with the enrichment list on every mount. |
| 8 | Nodes | `GET /api/{org}/node/list` | T1 | memory | Cluster topology; stable within a session. |
| 9 | Saved views (Logs) | `GET /api/{org}/savedviews` | T2 | memory | Re-fetched on each Logs entry. |
| 10 | Query functions | `GET /api/{org}/query_functions` | T1 | **localStorage** | Same class as `functions`. |
| 11 | Action scripts | `GET /api/{org}/actions` | T2 | memory | Replaces the `organizationData.actions` Vuex map. |
| 12 | Domain management | `GET /api/{metaOrg}/domain_management` | T1 | memory | Settings page. |
| 13 | Org storage settings | `GET /api/{org}/storage` | T1 | memory | Settings page. |
| 14 | License | `GET /api/license` | T0 | **localStorage** | Immutable for the session. |
| 15 | GenAI agent mapping | `GET /api/{org}/settings/gen_ai/agent_mapping`, `/gen_ai/agents` | T1 | **localStorage** | Settings page. |
| 16 | Service streams | `GET /api/{org}/service_streams`, `/config/identity` | T1 | memory | Service catalog; stable. |

### 3b. IAM — one query per resource

| # | Page | API | Proposed | Storage |
|---|---|---|---|---|
| 17 | Groups | `GET /api/{org}/groups` (+ `/{name}`) | T2 / T3 | memory |
| 18 | Roles | `GET /api/{org}/roles` (+ `/{id}`) | T2 / T3 | memory |
| 19 | Role permissions | `GET /api/{org}/roles/{name}/permissions` | T3 | memory |
| 20 | Resources | `GET /api/{org}/resources` | T1 | **localStorage** (enum-like) |
| 21 | Invitations | `GET /api/invites`, `/api/{org}/invites` | T2 | memory |
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
| 31 | AlertHistoryDrawer | `GET /api/v2/{org}/alerts/history` | T2 | memory |
| 32 | AlertEvaluationHistory | `GET /api/v2/{org}/alerts/{id}/groups/transitions` | T2 | memory |
| 33 | PipelineHistory | `GET /api/{org}/pipelines/history` — called inline via `http()`, not through a service | T2 | memory |
| 34 | Workflow runs | `GET /api/{org}/workflows/{id}/history` | T4 | memory (volatile) |
| 35 | Synthetics runs | `GET /api/{org}/synthetics/{id}/runs` | T2 | memory |
| 36 | RUM SessionsList | `GET /api/{org}/{stream}/traces/session` | T2 | memory |
| 37 | QualityRunsTable | `GET /api/{org}/eval_jobs` | T2 | memory |
| 38 | Organizations (admin) | `GET /api/organizations` | T2 | memory (currently client-paginated with `page_size=1000000`) |
| 39 | Query history | `POST /api/{org}/_search_history` — a POST-shaped read; cacheable, but the body must be the key | T2 | memory |
| 40 | Tickets / attachments | `GET /api/tickets` | T2 | memory |

### 3e. Polling → `refetchInterval` (still on `setInterval`)

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
| 51 | Trace DAG | `GET /api/{org}/{stream}/traces/{traceId}/dag` | T5, `staleTime: Infinity` | **IndexedDB** — immutable once written |
| 52 | Service graph topology | `/api/{org}/traces/service_graph/topology/current` | T5 | **IndexedDB** |
| 53 | Dashboard variable values | `stream.fieldValues` / WS | T5 | **IndexedDB** (shares the field-value store) |
| 54 | PromQL label discovery | `get_promql_series`, `/prometheus/api/v1/metadata` | T1 | memory |

---

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
