# Frontend Caching Standard

How every cached read in the web app gets its `staleTime`, its `gcTime`, its
storage, and its invalidation — and what each page surface (list, refresh
button, detail, edit) is required to do with it.

This is the developer-facing contract. The mechanics live in
`src/composables/query/` (client, policy, persisters); each cached read is a
TanStack `queryOptions()` declared next to the service that owns its URL
(`src/services/<domain>.queries.ts`, keys in `<domain>.querykeys.ts`). The full
rationale per endpoint is in
`.claude/skills/ui-architect/references/data-fetching-inventory.md`.

---

## 1. The three knobs

| Knob            | Question it answers                             | Where it is set                                                            |
| --------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `staleTime`     | How long is a cached value served **without** a request? | On every declaration: a named tier constant from `src/composables/query/cachePolicy.ts`, or `0` — never another bare number |
| `gcTime`        | How long does an unused value stay in memory before it is collected? | Once, on the query client (`GC_TIME`). No declaration sets it; only the panel-result cache uses `PANEL_GC_TIME` |
| Invalidation    | Which writes make which reads refetch?          | The mutation's `meta.invalidates` / `meta.removes`, naming a `<domain>Keys.all(org)` scope |

`cachePolicy.ts` is **the only file in the app allowed to contain durations**.
A `staleTime: 60000` at a call site or in a declaration is a review rejection —
if none of the constants fit, add a new named constant there.

### The constants (current values)

Since 2026-09-15. `DEFAULT_STALE_TIME`, `CONFIG_STALE_TIME` and `LONG_GC_TIME`
no longer exist.

| Constant             | Value      | Meaning                                                        |
| -------------------- | ---------- | -------------------------------------------------------------- |
| `LIVE_STALE_TIME`    | 1 min      | Live state: alerts, incidents, SLOs, synthetics monitors, anomaly detection, job statuses. Also the client default — only a safety net for a declaration that forgets its tier |
| `MEDIUM_STALE_TIME`  | 5 min      | Streams, saved views, traces, service correlation, org summary, AI observability, online evals |
| `NORMAL_STALE_TIME`  | 1 h        | Dashboards, pipelines, functions, workflows, reports, IAM, tokens, settings, alert destinations and templates |
| `SESSION_STALE_TIME` | `Infinity` | Immutable for the session: `/config` only          |
| `0` _(literal)_      | 0          | Payloads that must never be served cached: license usage, cleanup tasks |
| `GC_TIME`            | 3 h        | Set once on the client: how long an unused result stays in memory |
| `PANEL_GC_TIME`      | 30 min     | Dashboard panel-result cache only (large, and on IndexedDB anyway) |

`refetchOnWindowFocus` and `refetchOnReconnect` are `false` on the client and no
declaration turns them on: the console is often left open on a wall display and
several endpoints are expensive.

---

## 2. The tiers

Every read falls into exactly one tier, and **the tier is decided by the module
the read belongs to**, not by the endpoint's shape. The tier sets `staleTime`
only: `gcTime` is `GC_TIME` for every query, storage is memory, and nothing
refetches on window focus or reconnect.

| Tier              | `staleTime`                  | `gcTime`                 | Storage                                   | Focus / reconnect refetch | Typical member                  |
| ----------------- | ---------------------------- | ------------------------ | ----------------------------------------- | ------------------------- | ------------------------------- |
| **LIVE**          | `LIVE_STALE_TIME` (1 min)    | `GC_TIME` (3 h)          | memory                                    | no                        | alerts list, incidents          |
| **MEDIUM**        | `MEDIUM_STALE_TIME` (5 min)  | `GC_TIME`                | memory                                    | no                        | stream names, saved views       |
| **NORMAL**        | `NORMAL_STALE_TIME` (1 h)    | `GC_TIME`                | memory                                    | no                        | dashboards in folder, functions |
| **SESSION**       | `SESSION_STALE_TIME` (∞)     | `GC_TIME`                | memory                                    | no                        | `/config`                       |
| **ZERO**          | `0`                          | `GC_TIME`                | memory                                    | no                        | license usage, cleanup tasks    |
| **PANEL_RESULT**  | `Infinity`                   | `PANEL_GC_TIME` (30 min) | **IndexedDB**                             | no                        | dashboard panel results         |

Notes:

- **Storage: memory. No `queryOptions()` declaration persists anything.** The
  only persisted cache is the dashboard panel-result cache (`idbPersister`,
  IndexedDB), which is not a query declaration; log field values have their own
  separate IndexedDB database. **A new query must never add a `persister`.**
  localStorage persistence was removed on 2026-09-15 and the trace DAG's
  IndexedDB persistence on 2026-09-16, both for the same reason: a persisted
  read with no `useQuery` observer is restored without any age check — a 12 h
  old saved DAG was served with zero fetches (browser-verified 2026-09-16, only
  a >24 h copy re-fetched) — and the DAG tab has no refresh control, so a trace
  still receiving spans could show a partial DAG for up to a day.
- **Every declaration names its tier.** The client default (`LIVE_STALE_TIME`)
  is a safety net that errs on the fresh side, not a tier to rely on.
- **Verify the tier against the payload, not the endpoint name** —
  `/api/license` sounds static but carries live usage counters, so it is `0`.
- **Credential-bearing reads** (ingestion/RUM/agent tokens, passcode, cipher
  keys, destinations with auth headers) are memory only like every list and must
  never gain a `persister`. Pin this with a comment on the declaration (see
  `src/services/api_keys.queries.ts`, `src/services/alert_destination.queries.ts`).

### Decision tree for a new endpoint

```
Not a GET / streaming / single-use URL / a GET that mutates / read-modify-write?
      └── no cache at all. mutationOptions() with meta for writes.
GET, reused across surfaces or visits?
      ├── Carries live counters or job state that
      │   must never be served cached?                         → 0
      ├── Immutable for the session (/config)?                 → SESSION_STALE_TIME
      └── otherwise, by the module it belongs to:
            ├── alerts, incidents, SLOs, synthetics monitors,
            │   anomaly detection, job statuses?               → LIVE_STALE_TIME
            ├── streams, saved views, traces, service correlation,
            │   org summary, AI observability, online evals?   → MEDIUM_STALE_TIME
            └── dashboards, pipelines, functions, workflows,
                reports, IAM, tokens, settings, destinations,
                templates?                                      → NORMAL_STALE_TIME

Storage, whatever the tier: memory. No declaration takes a persister — the
dashboard panel-result cache is the only persisted cache in the app.
```

---

## 3. Module inventory — who has what today

Derived from the `staleTime` on every `queryOptions()` in
`src/services/*.queries.ts`. Scopes are the domain's `all` key from its
`querykeys` file, shown without the `["org", <org>]` root. Every query below is
memory only; the panel-result cache at the end is not a query declaration. When
you add a query, add its row here.

### LIVE — 1 min stale, memory

| Module / service                                     | Query                                                                                                                       | Invalidation scope          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Alerts (`alerts.queries.ts`)                         | `alertsListQuery(folderId, query, alertType)`, `alertDetailQuery(id)`, `alertDependenciesQuery`, `alertHistoryQuery(query)` | `["alerts"]`                |
| External alert sources (`alert_sources.queries.ts`)  | `alertSourcesQuery`                                                                                                         | `["alerts","sources"]`      |
| Anomaly detection (`anomaly_detection.queries.ts`)   | `anomalyConfigsQuery`, `anomalyHistoryQuery(limit)`                                                                         | `["anomalyDetection"]`      |
| Incidents (`incidents.queries.ts`)                   | `incidentsQuery(status, limit, offset)`                                                                                     | `["incidents"]`             |
| SLOs (`slos.queries.ts`)                             | `slosQuery(folder)`                                                                                                         | `["slos"]`                  |
| Synthetics (`synthetics.queries.ts`)                 | `syntheticsMonitorsQuery(folderId)`                                                                                         | `["synthetics","monitors"]` |
| Enrichment tables (`jstransform.queries.ts`)         | `enrichmentTableStatusesQuery` (URL-import job statuses)                                                                    | `["functions"]`             |

### MEDIUM — 5 min stale, memory

| Module / service                                     | Query                                                                                                             | Invalidation scope             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Streams (`stream.queries.ts`)                        | `streamNameListQuery(type)`, `streamPageQuery(type, params)` (server table), `streamSchemaQuery(streamName, type)` | `["streams"]`                  |
| Saved views (`saved_views.queries.ts`)               | `savedViewsQuery`                                                                                                 | `["search","savedViews"]`      |
| Service graph (`service_graph.queries.ts`)           | `serviceTopologyQuery(range)` (time-bucketed key)                                                                 | `["traces","topology"]`        |
| Traces (`search.queries.ts`)                         | `traceDagQuery(streamName, traceId, startTime, endTime)`                                                          | `["traces","dag"]`             |
| Service streams (`service_streams.queries.ts`)       | `semanticGroupsQuery`, `identityConfigQuery`                                                                      | `["serviceStreams"]`           |
| Org (`organizations.queries.ts`)                     | `orgSummaryQuery`                                                                                                 | `["organizations","summary"]`  |
| LLM datasets (`llm-datasets.service.queries.ts`)     | `llmDatasetsQuery`                                                                                                | `["llm","datasets"]`           |
| LLM experiments (`llm-experiments.queries.ts`)       | `experimentsListQuery(datasetId?)`, `remoteTasksListQuery`                                                        | `["experiments"]`, `["remoteTasks"]` |
| LLM queues (`llm-queues.service.queries.ts`)         | `llmQueuesQuery`                                                                                                  | `["llm","queues"]`             |
| GenAI agents (`gen-ai-agent-mapping.queries.ts`)     | `genAiAgentsQuery(startTime, endTime)`                                                                            | `["genAiAgents"]`              |
| Online evals (`online-evals.service.queries.ts`)     | `providersQuery`, `scoreConfigsQuery`, `scorersQuery`, `evalJobsQuery`                                            | `["onlineEvals"]`              |

### NORMAL — 1 h stale, memory

| Module / service                                           | Query                                                        | Invalidation scope                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Dashboards (`dashboards.queries.ts`)                       | `dashboardsByFolderQuery(folderId)`                          | `["dashboards"]`                                                     |
| Dashboard annotations (`dashboard_annotations.queries.ts`) | `dashboardAnnotationsQuery(dashboardId, params)`             | `["dashboards"]`                                                     |
| Folders (`common.queries.ts`)                              | `foldersQuery(type)`                                         | `["folders"]` — all types                                            |
| Nodes (`common.queries.ts`)                                | `nodesQuery`                                                 | `["settings","nodes"]`                                               |
| Per-key settings (`settings.queries.ts`)                   | `settingQuery(key, userId)`                                  | `["settings","setting"]`                                             |
| Pipelines (`pipelines.queries.ts`)                         | `pipelinesQuery`, `pipelineHistoryQuery(params)`             | `["pipelines"]`                                                      |
| Functions (`jstransform.queries.ts`)                       | `functionsQuery`                                             | `["functions"]`                                                      |
| SQL function catalogue (`query_functions.queries.ts`)      | `queryFunctionsQuery`                                        | `["functions"]`                                                      |
| Workflows (`workflows.queries.ts`)                         | `workflowsQuery`                                             | `["workflows"]`                                                      |
| Reports (`reports.queries.ts`)                             | `reportsQuery(filters)`                                      | `["reports"]`                                                        |
| IAM (`iam.queries.ts`)                                     | `groupsQuery`, `rolesQuery`, `resourcesQuery`                | `["iam","groups"]`, `["iam","roles"]`, `["iam","resources"]`         |
| IAM users (`users.queries.ts`)                             | `orgUsersQuery`, `assignableRolesQuery`, `allUserRolesQuery` | `["iam","users"]`                                                    |
| Service accounts (`service_accounts.queries.ts`)           | `serviceAccountsQuery`                                       | `["iam","serviceAccounts"]`                                          |
| Ingestion tokens, passcode (`organizations.queries.ts`)    | `ingestionTokensQuery`, `orgPasscodeQuery`                   | `["organizations","ingestionTokens"]`, `["organizations","passcode"]` |
| RUM token (`api_keys.queries.ts`)                          | `rumTokensQuery`                                             | `["organizations","rumTokens"]`                                      |
| Synthetics agent tokens (`synthetics.queries.ts`)          | `agentTokensQuery`                                           | `["synthetics","agentTokens"]`                                       |
| Regex patterns (`regex_pattern.queries.ts`)                | `regexPatternsQuery`, `builtInRegexPatternsQuery`            | `["settings","regexPatterns"]`, `["settings","builtInRegexPatterns"]` |
| Cipher keys (`cipher_keys.queries.ts`)                     | `cipherKeysQuery`                                            | `["settings","cipherKeys"]`                                          |
| AI toolsets (`ai_toolsets.queries.ts`)                     | `aiToolsetsQuery`                                            | `["settings","aiToolsets"]`                                          |
| Model pricing (`model_pricing.queries.ts`)                 | `modelPricingQuery`                                          | `["settings","modelPricing"]`                                        |
| Org settings (`organizations.queries.ts`)                  | `orgSettingsQuery`                                           | `["organizations","settings"]`                                       |
| Alert destinations (`alert_destination.queries.ts`)        | `destinationsQuery(module)`                                  | `["alerts","destinations"]`                                          |
| Alert templates (`alert_templates.queries.ts`)             | `templatesQuery`                                             | `["alerts","templates"]`                                             |

### SESSION — fresh forever within the session

| Module                              | Query                                                  | Storage                                  |
| ----------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| App config (global)                 | `configQuery`                                          | memory                                   |
| Full org config (`config.queries.ts`) | `configFullQuery`                                    | memory                                   |

### ZERO — `staleTime: 0`, memory

| Module        | Query                                   | Why                                                          |
| ------------- | --------------------------------------- | ------------------------------------------------------------ |
| License       | `licenseQuery` (global)                 | carries live usage counters                                  |
| Cleanup tasks | `cleanupTasksQuery(targetOrg, metaOrg)` | operational job state; the dialog polls every 5 s until done |

### PANEL_RESULT — `Infinity` stale, IndexedDB, 30 min gc

| Module           | Where                                        | Options                                                                |
| ---------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| Dashboard panels | `src/composables/dashboard/usePanelCache.ts` | `staleTime: Infinity`, `gcTime: PANEL_GC_TIME`, `persister: idbPersister.persisterFn` |

This is a hand-built cache entry, not a `queryOptions()` declaration, and it is
the only persisted cache in the app: 24 h `maxAge`, an `IDB_BUSTER` string bumped
when the response shape changes, and an LRU trim in `idbStorage.ts`. A dashboard
has its own refresh control, which is what makes persisting its panels safe.

### SECRET — memory only, never a persister

`ingestionTokensQuery`, `orgPasscodeQuery`, `rumTokensQuery`,
`agentTokensQuery`, `cipherKeysQuery`, `destinationsQuery` (webhook auth
headers and integration keys), plus service-account tokens wherever they
appear. No list is persisted anyway; these carry a comment so it stays that way.

### Never cached at all

Ad-hoc search (`search.search`, `_around`, partitions, WebSocket), AI chat
streams, single-use URLs and page tokens, any GET that mutates (billing
`unsubscribe` / `resume_subscription`), billing reads (there are no billing
query declarations: the billing pages call `BillingService` directly),
`dashboards.get_Dashboard`, and read-modify-write dialogs (e.g.
`WorkflowLinkAlertsDialog`).

---

## 4. Query key anatomy — how every module's keys are defined

Every key in the app follows one grammar:

```
["org", <org-id>, <domain>, <kind>, ...identity args]
   │        │        │        │         └── the same args `fetch` takes after org, normalized
   │        │        │        └── list | detail | search | history | page | <config noun>
   │        │        └── module segment — doubles as the invalidation scope prefix
   │        └── added automatically ( "__global__" for defineGlobalQuery )
   └── added automatically by defineQuery
```

The `["org", <id>]` root is never written by hand — `defineQuery` prepends it.
That rooting is what makes everything else work: the org-switch purge, the
logout purge, and scope invalidation are all prefix matches on it.

### The six key rules

1. **Declared once, next to the endpoint.** The key lives in the `defineQuery`
   in the service file. An inline key array anywhere else is a rejection.
2. **Static array for singletons, function for parameterised reads** — and the
   function takes *exactly* the arguments `fetch` takes after `org`, in the
   same order. Key identity ≡ fetch identity; if an argument changes the
   response, it must be in the key, and nothing else may be.
3. **Normalize optional arguments to one sentinel** so "not passed" maps to a
   single canonical entry instead of `undefined`-shaped near-duplicates:
   `folder ?? "all"`, `folderId ?? "__all__"`, `userId ?? "__org__"`.
4. **Filter objects go through `stableFilters()`** (sorts fields, drops
   empty/undefined) so two call sites building the same filter hash to the same
   entry and DevTools stays readable.
5. **Time ranges are quantized, never raw.** `serviceTopologyQuery` keys on
   `quantizeRange(start, end, OVERVIEW_BUCKET_MS)` — a "last 15 min" window
   that shifts every second would otherwise mint a new key per render and
   never hit cache.
6. **A user search is its own `kind`.** The alerts list keys
   `["alerts", "list", folderId]` but a search keys
   `["alerts", "search", folderId, { q }]` — so searching never overwrites the
   plain list entry, and clearing the search repaints instantly from cache.

### Real keys, per pattern

| Pattern                | Example (module)   | Key as declared                                              |
| ---------------------- | ------------------ | ------------------------------------------------------------ |
| Singleton list         | Pipelines          | `["pipelines", "list"]`                                      |
| Folder-scoped list     | Dashboards         | `(folderId) => ["dashboards", "list", folderId]`             |
| List + search variant  | Alerts             | `["alerts", "list", folderId]` / `["alerts", "search", folderId, { q }]` |
| Filtered list          | Reports            | `["reports", "list", folder ?? "__all__", stableFilters({...})]` |
| Paginated server table | Incidents          | `["incidents", "list", { status, limit, offset }]`           |
| Detail                 | Reports            | `(id) => ["reports", "detail", id]`                          |
| Sub-entity detail      | IAM roles          | `(role) => ["iam", "roles", "permissions", role]`            |
| Config catalog         | Functions          | `["functions", "list"]`                                      |
| Typed catalog          | Folders            | `(type) => ["folders", type]`                                |
| Per-key setting        | Settings           | `(key, userId) => ["settings", "setting", key, userId ?? "__org__"]` |
| Time-bucketed result   | Service topology   | `["traces", "topology", quantizeRange(start, end, BUCKET)]`  |
| Result keyed by inputs | Trace DAG          | `["traces", "dag", traceId, stream, start, end]`             |
| Global singleton       | `/config`, license | `["config", "get"]`, `["license"]` → rooted at `["org", "__global__"]` |

---

## 5. Module shapes — what modules have in common

Every module is one of four shapes. The shape tells you which queries it
declares, what its detail/edit surface reads, and what a save invalidates.
**When adding a module, pick the shape and copy its reference member.**

### Shape A — list-only

One list query. There is either no detail surface, the edit dialog is seeded
from the row the list already has, or the detail read is deliberately uncached.
Save/delete → `invalidate(org)` / `remove(org)` on the module scope.

| Module            | List key(s)                                            | Detail/edit surface reads                  |
| ----------------- | ------------------------------------------------------ | ------------------------------------------ |
| **Dashboards**    | `["dashboards","list",folderId]`, `["dashboards","annotations",id,params]` | raw `get_Dashboard` — uncached on purpose (`hash` = concurrency token) |
| Workflows         | `["workflows","list"]`                                 | row data; link-alerts dialog reads raw (read-modify-write) |
| Incidents         | `["incidents","list",{status,limit,offset}]`           | row data                                   |
| Anomaly detection | `["anomalyDetection","list"]`, `[…,"history",limit]`   | row data                                   |
| Streams           | `["streams","page",type,params]` (server table)        | schema fetched raw on demand               |
| Saved views       | `["search","savedViews"]`                              | row data                                   |
| IAM users         | `["iam","users"]`, `["iam","invitations"]`, `["iam","serviceAccounts"]`, `["iam","groups"]` | row data / raw group fetch |
| LLM               | `["llm","datasets","list"]`, `["llm","queues","list"]` | row data                                   |
| Online evals      | `["onlineEvals","scoreConfigs" \| "scorers" \| "jobs"]`| row data                                   |
| Org (state reads) | `["organizations","summary" \| "cleanupTasks" \| "ingestionTokens" \| "passcode" \| "rumTokens"]` | — |

**Reference member to copy: `workflows.ts`** (simplest) or `incidents.ts`
(paginated).

### Shape B — list + detail (the full CRUD module)

A list query and a detail query **sharing one scope**. The detail *page* and
the *edit form* both seed from `detailQuery.get(org, id)`; a save invalidates
the shared scope, which drops list **and** detail in one call, so neither can
go stale independently.

| Module      | List key                              | Detail key                            | Extras                          |
| ----------- | ------------------------------------- | ------------------------------------- | ------------------------------- |
| **Alerts**  | `["alerts","list",folderId]` (+ search variant) | `["alerts","detail",id]`      | `["alerts","history",id,filters]` |
| Reports     | `["reports","list",folder,filters]`   | `["reports","detail",id]`             |                                 |
| Pipelines   | `["pipelines","list"]`                | `["pipelines","detail",name]`         |                                 |
| SLOs        | `["slos","list",folder]`              | `["slos","detail",id]`                |                                 |
| Synthetics  | `["synthetics","monitors",folderId]`  | `["synthetics","detail",id,folderId]` | `["synthetics","agentTokens"]` (credential, memory only) |
| IAM roles   | `["iam","roles"]`                     | `["iam","roles","permissions",role]`  |                                 |
| Cipher keys | `["settings","cipherKeys"]`           | `[…,"cipherKeys","detail",name]`      | credential — memory only        |

**Reference member to copy: `reports.ts` or `slos.ts`** — the canonical pair.

### Shape C — config catalog

One unparameterised (or type-keyed) read, consumed by *other* modules' forms
and pickers, not by its own CRUD page alone. Its tier comes from its module like
any other read (§3), and it is held in memory only. The managing page's save
invalidates the catalog so every consumer refetches.

Members: folders `(type)`, stream names `(type)`, functions, the SQL function
catalogue, alert templates, destinations `(module)`, org settings, per-key
settings, regex patterns, AI toolsets, model pricing, IAM resources, eval
providers, nodes, cipher keys.

**Reference member to copy: `jstransform.ts` (`functionsQuery`).**

### Shape D — global / result singletons

Non-org reads (`configQuery`, `licenseQuery`, keyed with `globalKey`) and
result payloads keyed by their inputs (`traceDagQuery`, `serviceTopologyQuery`).
No CRUD surface; no invalidation from writes — freshness comes from the tier
(`SESSION_STALE_TIME` for config, `MEDIUM_STALE_TIME` for the trace DAG and
service topology, `0` for license).

### Known inconsistencies (open for discussion)

These pre-date the standard; new code follows the rules above, and these are
candidates to align:

- `syntheticsMonitorsQuery` uses kind `"monitors"` where every other list uses
  `"list"`.
- `foldersQuery` keys `["folders", type]` with no kind segment.
- Sentinels for "no folder" differ per module: `"all"` (SLOs), `"__all__"`
  (reports, alerts search), `""` (synthetics detail). One spelling should win.
- `incidentsQuery` embeds pagination as an object literal in the key, while
  streams uses the `"page"` kind with a params object — same idea, two shapes.

---

## 6. The surface contract — what each user action does

This is the part every page must implement the same way. Only **three** things
are allowed to bypass the cache (`force = true`): a **Refresh button**, a
**post-write reload**, and an **explicit user-initiated search**. Everything
else reads cached.

| Surface / action              | Call                                    | Network behaviour                                              |
| ----------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| List page mount, route change | `xQuery.load({ org, apply, loading })` or `xQuery.get(org)` | Cached rows paint instantly; a request fires only if stale |
| **Refresh button click**      | named handler → loader with `force: true` → `xQuery.refresh(org)` | **Always hits the server** (staleTime bypassed), spinner via `isFetching`/`loading` |
| Detail page open              | `detailQuery.get(org, id)`              | Cached within the module's `staleTime` (1 min for alerts); otherwise fetches |
| Edit form open                | `detailQuery.get(org, id)` — or the raw service call when the payload carries concurrency state (dashboard `hash`) | Same as detail; a form that must not start from stale data uses `refresh()` |
| Save (create/update)          | service write → `xQuery.invalidate(org)` | Next read of the whole `scope` refetches — list *and* detail   |
| Delete                        | service delete → `xQuery.remove(org)` (via `useOrgMutation`'s `removes`) | Also drops inactive detail entries so a re-opened detail can't serve the deleted entity |
| Explicit search / filter submit | loader with `force: true`             | Hits the server                                                |
| Window refocus                | nothing (`refetchOnWindowFocus: false` for every query) | No request                             |
| Network reconnect             | nothing (`refetchOnReconnect: false` for every query)   | No request                             |
| Browser reload                | nothing to restore — every query is memory only | Every query fetches on its first read; only dashboard panel results come back from IndexedDB |
| Org switch                    | automatic (`purgeOrgQueries`)           | Memory kept (keys are org-rooted, `gcTime` collects it); IndexedDB entries (panel results, field values) purged for the org being left and for orgs left behind by older sessions |
| Logout                        | automatic (`purgeAllQueries`)           | Everything cleared, memory and disk                            |

### The refresh-button rule, spelled out

A refresh click must reach the server **and** keep whatever filter/search/folder
state the user has on screen. The recurring bugs (see the `fix(alerts)`,
`fix(nodes,reports)` commits on this branch) all came from violating one of
these:

```vue
<!-- WRONG: the DOM click event object lands in `force` — truthy, but by accident,
     and the loader signature can never change safely -->
<OButton @click="getData" />

<!-- RIGHT: a named handler makes the force explicit -->
<OButton @click="refreshData" />
```

```ts
const getData = (force = false) =>
  alertsListQuery.load({
    org,
    args: [folderId.value, searchQuery.value], // current UI state, not defaults
    apply: (list) => (rows.value = list),
    loading,
    force,
  });

const refreshData = () => getData(true);
```

- The refresh handler passes the **current** folder/filter/search arguments —
  refreshing must never reset the user's view.
- Keyboard shortcuts for refresh route through the same button handler, not a
  separate code path.
- The spinner: `load()` shows cached rows immediately and only sets `loading`
  when there is nothing to show; use `isFetching` (reactive form) for the
  subtle "refreshing" indicator.

### Detail and edit pages, spelled out

- **Detail view** (read-only): `detailQuery.get(org, id)`. Within the module's
  `staleTime` (1 min for alerts) of the list visit or the last open, this costs
  zero requests.
- **Edit form**: also `detailQuery.get(org, id)` for the common case. *Every
  write from this client invalidates the scope*, so the cached value can only
  miss other users' edits made within the module's `staleTime` (up to 1 h on the
  NORMAL tier); a form that must not start from that uses `refresh()`. If the domain needs
  optimistic-concurrency (dashboards' `hash`) or does read-modify-write on a
  shared object, **do not cache the read at all** — fetch raw.
- **After save**: `invalidate(org)` on the scope, then navigate. Do not
  hand-patch the cached list; do not re-call the page loader from the write
  path — the next mount refetches by itself. If the same page stays open and
  repaints, its post-write reload passes `force: true`.
- **After delete**: `remove(org)` (or `useOrgMutation` with `removes`) —
  invalidation alone leaves the dead entity's detail entry ready to serve the
  next reader.

### Invalidation rules

1. **Invalidate by scope prefix, never the exact key.** `invalidate(org)`
   drops everything under the declaration's `scope`. A precise-key invalidate
   is a bug waiting for the next key variant (a new filter argument, a new
   sibling query).
2. **Scope groups siblings that must move together.** All alert queries share
   scope `["alerts"]`, so saving an alert refetches the list, the detail, and
   the history without three calls. Cross-domain writes state the foreign
   scope explicitly on their own declaration.
3. **Writes go through `useOrgMutation`** where possible — it wires
   `invalidates` / `removes` / optimistic `prime()` in one place.

---

## 7. Declaring a new cached read — the template

Keys go in `src/services/<domain>.querykeys.ts`; the read and its writes go in
`src/services/<domain>.queries.ts`:

```ts
// things.querykeys.ts — keys only, so another domain can drop this scope without importing the transport
import { orgKey } from "@/composables/query/keys";

export const thingKeys = {
  all: (org: string) => orgKey(org, "things"), // the invalidation scope
  list: (org: string) => orgKey(org, "things", "list"),
};
```

```ts
// things.queries.ts
import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import thingService from "./things";
import { thingKeys } from "./things.querykeys";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";

// Name the module's tier (§3). No gcTime, no persister, no refetchOn* flags.
export const thingsQuery = (org: string) =>
  queryOptions({
    queryKey: thingKeys.list(org),
    queryFn: async (): Promise<Thing[]> => (await thingService.list(org)).data?.list ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

export const saveThingMutation = (org: string) =>
  mutationOptions({
    mutationFn: (payload: Thing) => thingService.save(org, payload),
    meta: { invalidates: [thingKeys.all(org)] },
  });
```

Rules the template encodes:

- **Every declaration names its tier** — `LIVE_STALE_TIME`, `MEDIUM_STALE_TIME`,
  `NORMAL_STALE_TIME` or `SESSION_STALE_TIME` by module (§3), or `0` for a
  payload with live counters. Leaving it out falls back to `LIVE_STALE_TIME`,
  which is a safety net, not a choice.
- **No `gcTime` on a declaration.** `GC_TIME` (3 h) is set once on the client;
  only the panel-result cache sets `PANEL_GC_TIME`.
- **No `refetchOnWindowFocus` / `refetchOnReconnect`.** Both are `false` on the
  client for every query.
- **No `persister`, on any query.** No declaration persists; the dashboard
  panel-result cache is the only persisted cache and it is not a declaration.
- The queryFn never returns `undefined` — `?? null` / `?? []`.
- A parameterised key is a function of the same args the queryFn uses, lives in
  the `querykeys` file, and sits under the domain's `all` scope so siblings
  invalidate together.
- `globalKey` for the rare non-org read (`/config`, license).
- A credential-bearing read gets a comment on the declaration saying it must
  never gain a persister (see `api_keys.queries.ts`).
- Components read with `useQuery(thingsQuery(org))`. `fetchInto` is only for
  Options API components and imperative flows; it writes a snapshot that an
  invalidation elsewhere will not repaint.

---

## 8. Review checklist

Reject a PR that:

- [ ] has a numeric `staleTime`/`gcTime` outside `cachePolicy.ts` (the literal
      `staleTime: 0` is the one exception)
- [ ] declares a query without naming its tier, or sets `gcTime`,
      `refetchOnWindowFocus` or `refetchOnReconnect` on a declaration
- [ ] binds a loader straight to a template event (`@click="getData"`)
- [ ] passes `force: true` from anywhere except a Refresh button, a post-write
      reload, or an explicit user search
- [ ] invalidates an exact key instead of the scope, or re-calls a page loader
      from a write path
- [ ] adds a `persister` to any `queryOptions()` declaration — the dashboard
      panel-result cache is the only persisted cache
- [ ] gives a payload with live counters or job state a cached tier because its
      *name* sounded like config
- [ ] caches a GET that mutates, a single-use URL, or a read-modify-write read
- [ ] uses `ensureQueryData` (returns stale data after invalidation — the
      layer uses `fetchQuery`)
- [ ] adds a query without a row in §3 of this document
