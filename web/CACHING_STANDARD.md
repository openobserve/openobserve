# Frontend Caching Standard

How every cached read in the web app gets its `staleTime`, its `gcTime`, its
storage, and its invalidation — and what each page surface (list, refresh
button, detail, edit) is required to do with it.

This is the developer-facing contract. The mechanics live in
`src/composables/query/` (client, policy, persisters); each cached read is a
`defineQuery` declared in the service file that owns its URL
(`src/services/<domain>.ts`). The full rationale per endpoint is in
`.claude/skills/ui-architect/references/data-fetching-inventory.md`.

---

## 1. The three knobs

| Knob            | Question it answers                             | Where it is set                                                            |
| --------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `staleTime`     | How long is a cached value served **without** a request? | A named constant from `src/composables/query/cachePolicy.ts` — never a bare number |
| `gcTime`        | How long does an unused value stay in memory before it is collected? | Same file, same rule                                                       |
| Invalidation    | Which writes make which reads refetch?          | The query's `scope` (a key prefix) + `invalidate()` calls after writes     |

`cachePolicy.ts` is **the only file in the app allowed to contain durations**.
A `staleTime: 60000` at a call site or in a declaration is a review rejection —
if none of the constants fit, add a new named constant there.

### The constants (current values)

| Constant             | Value      | Meaning                                                        |
| -------------------- | ---------- | -------------------------------------------------------------- |
| `DEFAULT_STALE_TIME` | 30 s       | Set on the query client. Every query that says nothing gets it |
| `CONFIG_STALE_TIME`  | 5 min      | Org configuration read on nearly every page                    |
| `SESSION_STALE_TIME` | `Infinity` | Immutable for the session                                      |
| `LONG_GC_TIME`       | 30 min     | Keep-in-memory for reads that are expensive to rebuild         |
| _(no `gcTime` set)_  | 5 min      | TanStack's default — what every ordinary query gets            |

---

## 2. The tiers

Every read falls into exactly one tier. The tier decides all three knobs at
once — you never pick `staleTime` and `gcTime` independently.

| Tier              | `staleTime`          | `gcTime`      | Storage                 | Focus refetch | Typical member                     |
| ----------------- | -------------------- | ------------- | ----------------------- | ------------- | ---------------------------------- |
| **ENTITY_LIST**   | default (30 s)       | default (5 m) | memory                  | **yes**       | alerts list, dashboards in folder  |
| **ENTITY_DETAIL** | default (30 s)       | default (5 m) | memory                  | no            | one alert, one report              |
| **ORG_CONFIG**    | `CONFIG_STALE_TIME`  | `LONG_GC_TIME`| **localStorage**        | no            | folders, stream names, functions   |
| **SESSION_STATIC**| `SESSION_STALE_TIME` | `SESSION_STALE_TIME` | localStorage or memory | no     | `/config`, built-in regex patterns |
| **VOLATILE**      | `0`                  | 60 s          | memory                  | yes           | license usage, cleanup tasks       |
| **HEAVY_RESULT**  | `0`                  | `LONG_GC_TIME`| **IndexedDB**           | no            | trace DAG payloads                 |
| **SECRET**        | tier of its shape    | tier's        | **memory only — never persisted** | per tier | ingestion tokens, passcode |

Notes on the two storage exceptions inside a tier:

- **`nodesQuery`** uses ORG_CONFIG durations but is *not* persisted: it is
  cluster state, and serving yesterday's node list from disk is worse than a
  second of loading. **Verify the tier against the payload, not the endpoint
  name** — `/api/license` sounds static but carries live usage counters.
- **SECRET** is not a duration tier — it is a storage override. A credential
  list keeps whatever freshness its shape deserves but must never gain a
  `persister`. Pin this with a comment on the declaration (see
  `src/services/api_keys.ts`) so a later edit to the file's durations cannot
  silently start persisting it.

### Decision tree for a new endpoint

```
Not a GET / streaming / single-use URL / a GET that mutates?
      └── no cache at all. useOrgMutation for writes.
GET, reused across surfaces or visits?
      ├── Immutable for the session?            → SESSION_STATIC
      ├── Org configuration (names, folders,
      │   templates, destinations, settings)?   → ORG_CONFIG
      ├── A list of entities users CRUD?        → ENTITY_LIST
      ├── One entity (detail / edit form)?      → ENTITY_DETAIL
      ├── Operational state you poll or that
      │   must never be a minute old?           → VOLATILE
      └── Large result payload (MBs)?           → HEAVY_RESULT
            │
            └── whatever the tier: carries a token, key,
                or passcode? → memory only, never persisted
```

---

## 3. Module inventory — who has what today

Derived from the `defineQuery` declarations in `src/services/`. When you add a
query, add its row here.

### ORG_CONFIG — 5 min stale, 30 min gc, localStorage

| Module / service            | Query                       | Invalidation scope             |
| --------------------------- | --------------------------- | ------------------------------ |
| Folders (`common.ts`)       | `foldersQuery(type)`        | `["folders"]` — all types      |
| Streams (`stream.ts`)       | `streamNameListQuery(type)` | `["streams"]`                  |
| Functions (`jstransform.ts`)| `functionsQuery`            | `["functions"]`                |
| Functions (`query_functions.ts`) | `queryFunctionsQuery`  | `["functions"]`                |
| Alert templates             | `templatesQuery`            | `["alerts","templates"]`       |
| Destinations                | `destinationsQuery(module)` | `["alerts","destinations"]`    |
| Org settings                | `orgSettingsQuery`          | `["organizations","settings"]` |
| Org list                    | `orgListQuery`              | `["organizations","list"]`     |
| Per-key settings            | `settingQuery(key, userId)` | `["settings","setting"]`       |
| Regex patterns              | `regexPatternsQuery`        | `["settings","regexPatterns"]` |
| AI toolsets                 | `aiToolsetsQuery`           | `["settings","aiToolsets"]`    |
| Model pricing               | `modelPricingQuery`         | `["settings","modelPricing"]`  |
| Actions                     | `actionsQuery`              | `["actions"]`                  |
| IAM resources               | `resourcesQuery`            | `["iam","resources"]`          |
| Eval providers              | `providersQuery`            | `["onlineEvals"]`              |

ORG_CONFIG durations but **memory only** (deliberate — see §2 notes):

| Module      | Query            | Why not persisted                       |
| ----------- | ---------------- | --------------------------------------- |
| Nodes       | `nodesQuery`     | live cluster state, stale disk copy misleads |
| Cipher keys | `cipherKeysQuery`, `cipherKeyDetailQuery` | key material — SECRET override |

### SESSION_STATIC — fresh forever within the session

| Module              | Query                       | Storage       |
| ------------------- | --------------------------- | ------------- |
| App config (global) | `configQuery`               | memory (payload too small to be worth disk) |
| Built-in patterns   | `builtInRegexPatternsQuery` | localStorage  |

### ENTITY_LIST / ENTITY_DETAIL — 30 s stale, memory

Lists set `refetchOnWindowFocus: true`; details do not.

| Domain        | List queries                                        | Detail queries               |
| ------------- | --------------------------------------------------- | ---------------------------- |
| Alerts        | `alertsListQuery(folderId, query, alertType)`, `alertSourcesQuery`, `alertHistoryQuery` | `alertDetailQuery(id)` |
| Dashboards    | `dashboardsByFolderQuery(folderId)`, `dashboardAnnotationsQuery` | — (`get_Dashboard` deliberately uncached: its `hash` drives concurrency control) |
| Reports       | `reportsQuery(filters)`                             | `reportDetailQuery(id)`      |
| Pipelines     | `pipelinesQuery`                                    | `pipelineDetailQuery(name)`  |
| SLOs          | `slosQuery(folder)`                                 | `sloDetailQuery(id)`         |
| Synthetics    | `syntheticsMonitorsQuery(folderId)`                 | `monitorDetailQuery(id)`     |
| Workflows     | `workflowsQuery`                                    | —                            |
| Incidents     | `incidentsQuery(status, limit, offset)`             | —                            |
| Anomaly       | `anomalyConfigsQuery`, `anomalyHistoryQuery(limit)` | —                            |
| Streams       | `streamPageQuery(type, params)` (server table)      | —                            |
| Saved views   | `savedViewsQuery`                                   | —                            |
| Service graph | `serviceTopologyQuery(range)` (time-bucketed key)   | —                            |
| Org           | `orgSummaryQuery`                                   | —                            |
| Billing       | `subscriptionQuery`, `invoiceHistoryQuery`, `aiUsageQuery`, `billingGroupMembersQuery` | — |
| IAM           | `orgUsersQuery`, `pendingInvitesQuery`, `serviceAccountsQuery`, `groupsQuery`, `rolesQuery` | `rolePermissionsQuery(role)` |
| LLM / Evals   | `llmDatasetsQuery`, `llmQueuesQuery`, `scoreConfigsQuery`, `scorersQuery`, `evalJobsQuery` | — |

### VOLATILE — 0 s stale, 60 s gc

| Module        | Query                          | Why                              |
| ------------- | ------------------------------ | -------------------------------- |
| License       | `licenseQuery` (global)        | carries live usage counters      |
| Cleanup tasks | `cleanupTasksQuery(targetOrg)` | operational job state            |

### HEAVY_RESULT — 0 s stale, IndexedDB, 30 min gc

| Module | Query                                     |
| ------ | ----------------------------------------- |
| Traces | `traceDagQuery(stream, traceId, from, to)`|

### SECRET — memory only, never a persister

`ingestionTokensQuery`, `orgPasscodeQuery`, `rumTokensQuery`,
`agentTokensQuery`, `cipherKeysQuery` / `cipherKeyDetailQuery`, plus RUM and
service-account tokens wherever they appear.

### Never cached at all

Ad-hoc search (`search.search`, `_around`, partitions, WebSocket), AI chat
streams, single-use URLs and page tokens, any GET that mutates (billing
`unsubscribe` / `resume_subscription`), `dashboards.get_Dashboard`, and
read-modify-write dialogs (e.g. `WorkflowLinkAlertsDialog`).

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
| Heavy result           | Trace DAG          | `["traces", "dag", traceId, stream, start, end]`             |
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
| Billing           | `["billing","subscription" \| "invoices" \| "aiUsage" \| "groupMembers"]` | — (read-only surfaces)      |
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
| Synthetics  | `["synthetics","monitors",folderId]`  | `["synthetics","detail",id,folderId]` | `["synthetics","agentTokens"]` (SECRET) |
| IAM roles   | `["iam","roles"]`                     | `["iam","roles","permissions",role]`  |                                 |
| Cipher keys | `["settings","cipherKeys"]`           | `[…,"cipherKeys","detail",name]`      | SECRET — memory only            |

**Reference member to copy: `reports.ts` or `slos.ts`** — the canonical pair.

### Shape C — config catalog

One unparameterised (or type-keyed) read on the ORG_CONFIG tier, consumed by
*other* modules' forms and pickers, not by its own CRUD page alone. The managing
page's save invalidates the catalog so every consumer refetches.

Members: folders `(type)`, stream names `(type)`, functions, alert templates,
destinations `(module)`, org settings, org list, per-key settings, regex
patterns, AI toolsets, model pricing, actions, IAM resources, eval providers —
plus the two memory-only exceptions, nodes and cipher keys (§3).

**Reference member to copy: `jstransform.ts` (`functionsQuery`).**

### Shape D — global / result singletons

Non-org reads (`configQuery`, `licenseQuery` via `defineGlobalQuery`) and
result payloads keyed by their inputs (`traceDagQuery`, `serviceTopologyQuery`).
No CRUD surface; no invalidation from writes — freshness comes from the tier
(`SESSION_STALE_TIME` or `0`).

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
| Detail page open              | `detailQuery.get(org, id)`              | Cached within 30 s of the last visit; otherwise fetches        |
| Edit form open                | `detailQuery.get(org, id)` — or the raw service call when the payload carries concurrency state (dashboard `hash`) | Same as detail; a form that must not start from stale data uses `refresh()` |
| Save (create/update)          | service write → `xQuery.invalidate(org)` | Next read of the whole `scope` refetches — list *and* detail   |
| Delete                        | service delete → `xQuery.remove(org)` (via `useOrgMutation`'s `removes`) | Also drops inactive detail entries so a re-opened detail can't serve the deleted entity |
| Explicit search / filter submit | loader with `force: true`             | Hits the server                                                |
| Window refocus                | automatic, lists only (`refetchOnWindowFocus`) | Background refetch if stale — no spinner                  |
| Org switch                    | automatic (`purgeOrgQueries`)           | Memory kept (keys are org-rooted, `gcTime` collects it), disk purged for the org being left |
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

- **Detail view** (read-only): `detailQuery.get(org, id)`. Within 30 s of the
  list visit or the last open, this costs zero requests — that is the point of
  ENTITY_DETAIL.
- **Edit form**: also `detailQuery.get(org, id)` for the common case. The 30 s
  window is short enough that a form seeded from it is safe, *because every
  write invalidates the scope* — so the cached value can only be stale by 30 s
  of someone else's edits, same as before caching existed. If the domain needs
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

In the service file that owns the URL, below the builders:

```ts
import { defineQuery } from "@/composables/query/queryClient";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

// ENTITY_LIST: say nothing about durations — the client default is the tier.
export const thingsQuery = defineQuery<[], Thing[]>({
  key: ["things", "list"], // rooted at ["org", <org>, ...] automatically
  fetch: async (org) => (await thingService.list(org)).data?.list ?? [],
  refetchOnWindowFocus: true,
  scope: ["things"],
});

// ORG_CONFIG: the named constants plus the persister — all three or none.
export const thingCatalogQuery = defineQuery<[], Catalog>({
  key: ["things", "catalog"],
  fetch: async (org) => (await thingService.catalog(org)).data ?? null,
  staleTime: CONFIG_STALE_TIME,
  gcTime: LONG_GC_TIME,
  persister: localStoragePersister,
  scope: ["things"],
});
```

Rules the template encodes:

- **Defaults are silence.** An ENTITY tier query states no durations at all.
- **A tier is atomic.** ORG_CONFIG is the constant pair *and* the persister
  together; don't mix a 5-minute staleTime with the default gcTime.
- The queryFn never returns `undefined` — `?? null`.
- A parameterised key is a function of the same args `fetch` takes after `org`,
  and states its `scope` so siblings invalidate together.
- `defineGlobalQuery` for the rare non-org read (`/config`, license).
- A credential-bearing read gets a `// never persisted — <what it carries>`
  comment where the persister would go.

---

## 8. Review checklist

Reject a PR that:

- [ ] has a numeric `staleTime`/`gcTime` outside `cachePolicy.ts`
- [ ] binds a loader straight to a template event (`@click="getData"`)
- [ ] passes `force: true` from anywhere except a Refresh button, a post-write
      reload, or an explicit user search
- [ ] invalidates an exact key instead of the scope, or re-calls a page loader
      from a write path
- [ ] persists a query whose payload carries a token, key, or passcode
- [ ] gives operational/cluster state a persister or a non-zero staleTime
      because its *name* sounded like config
- [ ] caches a GET that mutates, a single-use URL, or a read-modify-write read
- [ ] uses `ensureQueryData` (returns stale data after invalidation — the
      layer uses `fetchQuery`)
- [ ] adds a query without a row in §3 of this document
