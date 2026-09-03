# API & Caching Audit — TanStack Query Migration Plan

> **HISTORICAL — superseded.** This is the original design study, written
> before the caching layer was built. It describes an intermediate design
> (`defineQuery`, `useOrgQuery`, `useOrgMutation`, tier names) that no longer
> exists in the codebase: the implementation now uses TanStack's own
> `queryOptions` / `mutationOptions` directly, with no wrapper types.
> Kept for the reasoning behind what to cache and what never to cache —
> those conclusions still hold. For how the code actually works today see
> [api-cache-architecture.md](./api-cache-architecture.md) and
> [query-authoring-guide.md](./query-authoring-guide.md).

**Scope:** `web/` (Vue 3 + TS SPA)
**Date:** 2026-08-05
**Status:** Proposal / audit. No code changed by this document.

---

## 1. Executive summary

The frontend has **62 service modules** exposing **463 `http()` call sites**, consumed by
**263 files** across views, components and composables. There is no shared request layer above
axios: every consumer hand-rolls its own `loading` ref, `try/catch`, error toast, race guard and
(sometimes) cache.

Caching today is **five unrelated mechanisms**, each invented for one feature:

| #   | Mechanism                                           | Storage                   | Used by                                                  | TTL         | Eviction                                   |
| --- | --------------------------------------------------- | ------------------------- | -------------------------------------------------------- | ----------- | ------------------------------------------ |
| 1   | Vuex `organizationData.*` maps                      | memory                    | dashboards, alerts, reports, folders, functions, actions | none        | org switch only                            |
| 2   | Vuex `streams` module + in-flight promise singleton | memory                    | 54 files via `useStreams`                                | none        | org switch                                 |
| 3   | `usePanelCache` IndexedDB                           | IndexedDB `PanelCache`    | dashboard panels                                         | none        | manual (`window._o2_removeDashboardCache`) |
| 4   | `fieldValueDB` IndexedDB                            | IndexedDB `o2FieldValues` | log field autocomplete                                   | sliding TTL | TTL + LRU                                  |
| 5   | `RegexPatternCache` / `ModelPricingCache`           | sessionStorage            | 2 settings pages                                         | 1 h / 24 h  | TTL                                        |

Mechanisms 1, 2 and 5 are three different answers to the same question. Mechanism 3 is the most
sophisticated (structural cache key, partial-data flags, time-range awareness) and is the one worth
generalizing — but it is bound to a single feature and its key is not org-scoped.

**Recommendation:** adopt `@tanstack/vue-query` v5 as the single read path, with

- a **query-key factory** rooted at `["org", orgId]` so org switch/logout is one `removeQueries` call;
- **five cache tiers** with fixed `staleTime`/`gcTime` presets, so no page invents its own policy;
- **per-query persisters** (`experimental_createPersister`) — localStorage for small config,
  IndexedDB for heavy payloads — replacing mechanisms 3, 4 and 5;
- two standard composables (`useOrgQuery`, `useServerTable`) covering the client-paginated and
  server-paginated page shapes that account for essentially every list page in the app;
- search/streaming (logs, traces, metrics, panel execution) explicitly **out of scope** for the
  query cache — it keeps its own executor, but gains the IndexedDB persister as a shared primitive.

The repo already ships `@tanstack/vue-table`, `@tanstack/vue-form` and `@tanstack/vue-virtual`, and
`OTable` is TanStack-Table-based, so this is a family the codebase already speaks.

---

## 2. Current architecture

### 2.1 Request layer

[http.ts](../src/services/http.ts) exports a factory that creates a **new axios instance per call**:

```ts
const http = ({ headers } = {} as any) => {
  instance = axios.create({ withCredentials: true, baseURL: store.state.API_ENDPOINT, headers });
  instance.interceptors.response.use(ok, errorHandler); // 401 refresh, 403 grouping
  return instance;
};
```

Every service method calls `http().get(...)`. Consequences:

- a fresh instance + interceptor closure is allocated on every request (463 sites × N calls);
- `baseURL` is captured at call time from the Vuex store — correct, but it means the instance
  cannot be hoisted without care;
- there is **no request-level dedup, retry, cancellation or caching** — the only shared state is
  the token-refresh promise ([http.ts:26](../src/services/http.ts#L26)).

Services are thin URL builders returning raw axios promises. This is actually a _good_ base for
TanStack Query: services stay as-is, and query options wrap them.

### 2.2 Consumption patterns found

Four patterns recur across the 263 consumer files:

**(a) Fetch-on-mount, no cache** — the majority.

```ts
onMounted(async () => {
  loading.value = true;
  try { rows.value = (await someService.list(org)).data.list; }
  catch (e) { toast({ variant: "error", ... }); }
  finally { loading.value = false; }
});
```

Examples: [RegexPatternList.vue:327](../src/components/settings/RegexPatternList.vue#L327),
[CipherKeys.vue:248](../src/components/settings/CipherKeys.vue#L248),
[SloList.vue:722](../src/views/slos/SloList.vue#L722),
[IncidentList.vue:763](../src/components/alerts/IncidentList.vue#L763),
[PipelinesList.vue](../src/components/pipeline/PipelinesList.vue) (`getPipelines()` re-called after
every mutation, 6 sites).

**(b) Fetch-on-mount with a hand-rolled Vuex cache + race guard.**

[AlertList.vue:1385](../src/components/alerts/AlertList.vue#L1385):

```ts
const getAlertsByFolderId = async (store, folderId) => {
  if (!store.state.organizationData.allAlertsListByFolderId[folderId]) {
    await getAlertsFn(store, folderId);
  } else {
    allAlerts.value = store.state.organizationData.allAlertsListByFolderId[folderId];
    loading.value = false; // "cache hit is synchronous, unstick the skeleton"
  }
};
```

…plus a manual race guard after the await
([AlertList.vue:1541](../src/components/alerts/AlertList.vue#L1541)):

```ts
if (folderId != activeFolderId.value && !query) {
  dismiss();
  return;
}
```

[ReportList.vue:487](../src/components/reports/ReportList.vue#L487) is a near-verbatim copy of both
the cache check and the race guard (its comment even cites `AlertList.vue:1574`). This is the exact
pair of problems TanStack Query solves structurally: `isFetching` vs `isPending`, and per-key
result isolation.

**(c) Singleton in-flight promise dedup.**

[useStreams.ts:23](../src/composables/useStreams.ts#L23) keeps a module-level
`getStreamsPromise` ref that all 50 `getStreams()` call sites await before deciding whether to
fetch. This is a hand-written version of TanStack's request deduplication, and it serializes
_unrelated_ stream fetches (a `logs` fetch waits on an in-flight `traces` fetch).

**(d) Structural-key cache with time-range awareness** — dashboards only, see §3.3.

### 2.3 Pagination shapes

Two shapes, both already supported by `OTable`
([OTable.types.ts:199-235](../src/lib/core/Table/OTable.types.ts#L199-L235)):

**Server-side** (`pagination="server"`, 9 surfaces): LogStream, StreamExplorer, AlertHistory,
AlertHistoryDrawer, AlertEvaluationHistory, PipelineHistory, SessionsList, QualityRunsTable.
Backend params are `page_num`/`page_size`/`sort_by`/`desc` (alerts, dashboards, functions, users,
organizations, tickets) or `offset`/`limit`/`keyword`/`sort`/`asc` (streams). LogStream re-fetches
via a watcher on `[currentPage, pageSize, sortBy, sortOrder]`
([LogStream.vue:1026](../src/views/LogStream.vue#L1026)) with no `keepPreviousData`, so every page
change blanks the table.

**Client-side** (`pagination="client"`, ~30 surfaces): alerts, reports, destinations, templates,
functions, enrichment tables, pipelines, IAM (users/groups/roles/service accounts/quota),
organizations, cipher keys, AI toolsets, model pricing, regex patterns, synthetics locations,
backfill jobs, running queries, workflows, incidents. These fetch the **whole list** (often with
`page_size=100000`, e.g. [useFunctions.ts:24](../src/composables/useFunctions.ts#L24)) and paginate
in the browser. These are the pages that benefit most from caching, because the payload is
stable and the fetch is expensive.

### 2.4 Filter shapes

- **Server-applied filters** that must be part of a cache key: alerts
  `alert_name_substring` + `alert_type` + `folder`
  ([alerts.ts:31](../src/services/alerts.ts#L31)); streams `keyword`
  ([useStreams.ts:166](../src/composables/useStreams.ts#L166)); dashboards `title` + `folder`;
  reports `nameQuery` + `isCache`; incidents `status`/`severity`; sessions `from`/`size`.
- **Client-applied filters** that must **not** be part of a cache key: every `OTable`
  `globalFilter`, the alerts tab filter (`filterAlertsByTab`), the incidents `statusFilter` quick
  tabs, and all column filters.

Today the distinction is implicit and inconsistent — AlertList _bypasses_ its cache whenever a
search query is present, and never caches search results at all.

---

## 3. The existing caching mechanisms, in detail

### 3.1 Vuex `organizationData` maps

Declared at [stores/index.ts:36-60](../src/stores/index.ts#L36-L60):
`allDashboardList`, `allDashboardData`, `allDashboardListHash`, `allAlertsListByFolderId`,
`allAlertsListByNames`, `allReportsListByFolderId`, `foldersByType`, `folders`, `functions`,
`actions`, `organizationSettings`.

Invalidation is **manual and scattered**: 20+ dispatch sites spread across
[commons.ts](../src/utils/commons.ts), [AlertList.vue](../src/components/alerts/AlertList.vue),
[ReportList.vue](../src/components/reports/ReportList.vue),
[Dashboards.vue](../src/views/Dashboards/Dashboards.vue),
[AddAlertView.vue](../src/views/AddAlertView.vue). Whole-cache reset happens on org switch
([MainLayout.vue:1426](../src/layouts/MainLayout.vue#L1426)).

**Defects found:**

1. **`getFoldersListByType` destroys sibling caches.**
   [commons.ts:176](../src/utils/commons.ts#L176) dispatches `setFoldersByType` with `{ [type]: … }`,
   and the mutation ([stores/index.ts:248](../src/stores/index.ts#L248)) _replaces_ the whole map.
   Loading reports folders therefore drops the cached `dashboards`, `alerts` and `synthetics`
   folder lists. Ten call sites are affected.
2. **`getFoldersListByType` never checks the cache** — it always hits the API and then overwrites.
   `FolderList.vue`, `SelectFolderDropDown.vue` and `InlineSelectFolderDropdown.vue` each refetch on
   every mount.
3. **`useFunctions.getAllFunctions()` has no cache check** and requests `page_size=100000`. It is
   called from 5 sites, including [useSearchBar.ts:61](../src/composables/useLogs/useSearchBar.ts#L61)
   — i.e. on every Logs page entry.
4. **Cache-hit path duplicates loading semantics.** Both AlertList and ReportList must remember to
   set `loading = false` on the synchronous cache path, with an explanatory comment. Any new page
   copying the pattern will get this wrong.

### 3.2 Vuex `streams` module

[useStreams.ts](../src/composables/useStreams.ts) (778 lines) is the app's most-used data
dependency (54 importers). It maintains `streams[type]`, a `streamsIndexMapping` name→index map, an
`areAllStreamsFetched` flag, and an in-flight promise singleton. `getStream()` lazily upgrades a
cached entry with its schema.

It works, but it is a bespoke normalized cache with manual index maintenance
(`removeStream` shifts array elements one by one,
[useStreams.ts:482-497](../src/composables/useStreams.ts#L482-L497)) and no TTL — a stream created
by another user never appears until org switch or hard reload. `getPaginatedStreams` deliberately
**does not** populate the cache (`addNewStreams` refuses to seed from partial results,
[useStreams.ts:730](../src/composables/useStreams.ts#L730)), which is correct but shows the
cache model straining.

### 3.3 `usePanelCache` — the model worth generalizing

[usePanelCache.ts](../src/composables/dashboard/usePanelCache.ts) is IndexedDB
(`PanelCache`/`panels`), keyed `folderId:dashboardId:panelId`, storing
`{ key, value, cacheTimeRange, timestamp }`.

The interesting part is the **key** and the **restore rules** in
[usePanelDataLoader.ts](../src/composables/dashboard/usePanelDataLoader.ts):

```ts
const getCacheKey = () => ({
  panelSchema: toRaw(panelSchema.value),
  variablesData: [...dependentVars, ...dynamicVars],
  forceLoad,
  dashboardId,
  folderId,
}); // :108
```

On restore ([:733](../src/composables/dashboard/usePanelDataLoader.ts#L733)) it:

- `omit`s volatile schema paths (`version`, `layout`, `htmlContent`, `markdownContent`,
  `customChartResult`);
- **normalizes variables** to only `{name,type,value,scope,multiSelect,query_data}`, dropping
  runtime state (`options`, `isLoading`, …);
- `isEqual`-compares the normalized keys;
- restores `data`, `loading`, `errorDetail`, `metadata`, `resultMetaData`, `annotations`,
  `isPartialData`, `isOperationCancelled`;
- sets `isCachedDataDifferWithCurrentTimeRange` when the **duration** of the selected range differs
  from the cached range — so a relative range ("last 15m") renders instantly from cache and the UI
  flags that it is showing an older window.

This "render stale, mark it, refresh" behaviour is exactly TanStack's stale-while-revalidate, but
with a domain-aware key and a domain-aware staleness signal.

**Defects found:**

1. **No org in the cache key.** `folderId:dashboardId:panelId` is org-agnostic; `folderId` is
   frequently the literal `"default"`. Cross-org collision requires a dashboard-id collision so it
   is unlikely in practice, but the key is wrong in principle and blocks a shared invalidation
   story.
2. **No TTL and no eviction.** Unlike `fieldValueDB`, `PanelCache` grows without bound; the only
   cleanup is the manually invoked `window._o2_removeDashboardCache()`. Panel payloads are the
   largest objects the app stores.
3. **Not cleared on logout or org switch.** `resetOrganizationData` and `resetStreams` do not touch
   IndexedDB.
4. **Deep-copies via `JSON.parse(JSON.stringify(...))` on every save**
   ([usePanelCache.ts:125-127](../src/composables/dashboard/usePanelCache.ts#L125-L127)), on the
   main thread, for potentially multi-MB result sets — and `saveCurrentStateToCache()` is called
   from ~12 places in the SQL executor, including per-partition.

### 3.4 `fieldValueDB` — the best of the existing caches

[fieldValueDB.ts](../src/composables/fieldValueDB.ts) is the only cache with a real eviction story:
composite PK `org|streamType|streamName|fieldName`, a `by_expires` index for TTL sweeps and a
`by_updated` index for LRU trimming, plus a lazily opened and reused connection. Its org-scoped
composite key is the model the rest of the app should follow.

### 3.5 sessionStorage TTL classes

[regexPatternCache.ts](../src/utils/regexPatternCache.ts) and
[modelPricingCache.ts](../src/utils/modelPricingCache.ts) are the same 100-line class with a
different `CACHE_KEY_PREFIX` and TTL (1 h vs 24 h). Both are `static get/set/clear(orgId)` over
`sessionStorage` with a `{data,timestamp,ttl}` envelope. They should be deleted outright in favour
of a persisted query.

---

## 4. Problem catalogue

| ID  | Problem                                                           | Evidence                                                 | Impact                                                                            |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| P1  | No shared request layer; loading/error/race handled per component | 263 consumer files                                       | Every new page re-implements 4 concerns                                           |
| P2  | Five incompatible cache mechanisms                                | §3                                                       | Nothing is reusable; new pages default to "no cache"                              |
| P3  | Cache invalidation is manual and scattered                        | 20+ `store.dispatch("setAll…")` sites                    | Post-mutation staleness bugs; over-refetch after mutations (`getPipelines()` × 6) |
| P4  | `setFoldersByType` wipes sibling folder types                     | [commons.ts:176](../src/utils/commons.ts#L176)           | Redundant refetches; transient `undefined` reads                                  |
| P5  | Folder + function lists never read their cache                    | commons.ts:158, useFunctions.ts:22                       | Duplicate requests on every mount, incl. Logs entry                               |
| P6  | Hand-rolled race guards after `await`                             | AlertList:1541, ReportList:534                           | Copy-paste hazard; only two pages actually have the guard                         |
| P7  | Server pagination blanks the table on page change                 | [LogStream.vue:1026](../src/views/LogStream.vue#L1026)   | Visible flicker; no prefetch of the next page                                     |
| P8  | Search/filtered list results are never cached                     | AlertList bypasses cache when `query` set                | Re-typing a search refetches                                                      |
| P9  | Panel cache key lacks org; no TTL/eviction/logout clear           | §3.3                                                     | Unbounded IndexedDB growth; cross-tenant key ambiguity                            |
| P10 | Stream cache serializes unrelated fetches through one promise     | [useStreams.ts:63](../src/composables/useStreams.ts#L63) | Head-of-line blocking on stream loads                                             |
| P11 | No window-focus / reconnect revalidation anywhere                 | —                                                        | Long-lived tabs show hours-old lists                                              |
| P12 | Duplicated sessionStorage TTL cache classes                       | §3.5                                                     | Two copies of one thing; third copy inevitable                                    |

---

## 5. Target architecture

### 5.1 Layering

```
views / components
        │  (only: useOrgQuery / useServerTable / useOrgMutation)
composables/query/*            ← query options, keys, tiers, persisters
        │
services/*.ts                  ← UNCHANGED: URL builders returning axios promises
        │
services/http.ts               ← UNCHANGED: auth refresh, 401/403 interceptors
```

Services stay untouched. All caching policy lives in one directory. Components never call
`queryClient` directly except in mutation `onSuccess`.

### 5.2 Query client

`web/src/composables/query/queryClient.ts`

```ts
import { QueryClient } from "@tanstack/vue-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // TIER.LIST default — never rely on this, pick a tier
      gcTime: 5 * 60_000,
      retry: (failureCount, err: any) => {
        const s = err?.response?.status;
        if (s === 401 || s === 403 || s === 404 || s === 400) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false, // opt in per tier — see §6
      refetchOnReconnect: true,
    },
    mutations: { retry: false },
  },
});
```

Installed in [main.ts](../src/main.ts) alongside `store` and `router`:

```ts
app.use(VueQueryPlugin, { queryClient });
```

`refetchOnWindowFocus` is **off by default** deliberately: this is an observability console that is
often left open on a wall display, and several endpoints are expensive. It is enabled per-tier for
cheap, volatile lists only.

### 5.3 Query key factory — org-rooted

`web/src/composables/query/queryKeys.ts`

```ts
export const qk = {
  org: (org: string) => ["org", org] as const,

  streams: {
    root: (org: string) => [...qk.org(org), "streams"] as const,
    nameList: (org: string, type: string) => [...qk.streams.root(org), "nameList", type] as const,
    page: (org: string, type: string, p: StreamPageParams) =>
      [...qk.streams.root(org), "page", type, p] as const,
    schema: (org: string, type: string, name: string) =>
      [...qk.streams.root(org), "schema", type, name] as const,
  },

  folders: {
    root: (org: string) => [...qk.org(org), "folders"] as const,
    byType: (org: string, type: FolderType) => [...qk.folders.root(org), type] as const,
  },

  alerts: {
    root: (org: string) => [...qk.org(org), "alerts"] as const,
    listByFolder: (org: string, folderId: string) =>
      [...qk.alerts.root(org), "list", folderId] as const,
    search: (org: string, f: AlertSearchFilters) => [...qk.alerts.root(org), "search", f] as const,
    detail: (org: string, id: string) => [...qk.alerts.root(org), "detail", id] as const,
  },
  // dashboards, reports, pipelines, slos, incidents, iam, settings … same shape
} as const;
```

**Non-negotiable rules:**

1. Every key starts with `["org", orgId]`. Org switch becomes:
   `queryClient.removeQueries({ queryKey: ["org", previousOrg] })`.
2. Logout becomes `queryClient.clear()` + persister purge.
3. Only **server-applied** parameters appear in a key. Client-side filters, sorts and page indexes
   for `pagination="client"` tables never do.
4. Filter objects in keys must have a **stable field order** (build them with a helper, not inline
   literals) — TanStack hashes keys with a deterministic stringify, but stable construction keeps
   DevTools readable and prevents accidental key drift.
5. Keys are produced **only** by `qk.*`. No inline array literals in components — this is what
   makes invalidation greppable and prefix-invalidation safe.

### 5.4 Cache tiers

`web/src/composables/query/tiers.ts` — the only place `staleTime`/`gcTime` numbers exist.

| Tier | Name             | staleTime  | gcTime     | Persist                    | focus refetch | Examples                                                                                                                   |
| ---- | ---------------- | ---------- | ---------- | -------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| T0   | `SESSION_STATIC` | `Infinity` | `Infinity` | localStorage (24 h)        | no            | `/config`, build info, search regions, roles enum, built-in regex patterns, model pricing                                  |
| T1   | `ORG_CONFIG`     | 5 min      | 30 min     | localStorage per-org (1 h) | no            | stream name lists, folders by type, functions, destinations, templates, cipher keys, org settings, nodes, service accounts |
| T2   | `ENTITY_LIST`    | 30 s       | 5 min      | none                       | yes           | alerts, dashboards, reports, pipelines, SLOs, users, groups, roles, workflows, enrichment tables                           |
| T3   | `ENTITY_DETAIL`  | 30 s       | 5 min      | none                       | no            | single dashboard, single alert, pipeline detail, SLO detail, incident detail                                               |
| T4   | `VOLATILE`       | 0          | 60 s       | none                       | yes           | running queries, incident RCA status, cleanup tasks, in-flight polls, quota usage                                          |
| T5   | `HEAVY_RESULT`   | 0 (manual) | 30 min     | **IndexedDB** (24 h + LRU) | no            | dashboard panel results, field values, trace DAG                                                                           |

```ts
export const TIER = {
  SESSION_STATIC: { staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false },
  ORG_CONFIG: { staleTime: 5 * 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: false },
  ENTITY_LIST: { staleTime: 30_000, gcTime: 5 * 60_000, refetchOnWindowFocus: true },
  ENTITY_DETAIL: { staleTime: 30_000, gcTime: 5 * 60_000, refetchOnWindowFocus: false },
  VOLATILE: { staleTime: 0, gcTime: 60_000, refetchOnWindowFocus: true },
  HEAVY_RESULT: { staleTime: 0, gcTime: 30 * 60_000, refetchOnWindowFocus: false },
} as const;
```

A page picks a tier; it does not pick numbers.

### 5.5 Persistence — per-query, not whole-cache

Do **not** use the whole-client `persistQueryClient`: it would write every list to storage,
including per-tenant data on shared machines, and it serializes the entire cache on a debounce.

Use v5's per-query persister so persistence is opt-in at the query level:

```ts
// composables/query/persisters.ts
import { experimental_createPersister } from "@tanstack/query-persist-client-core";
import { idbStorage } from "./idbStorage"; // generalized from usePanelCache

export const localPersister = experimental_createPersister({
  storage: window.localStorage,
  maxAge: 24 * 60 * 60_000,
  prefix: "o2q",
});

export const idbPersister = experimental_createPersister({
  storage: idbStorage, // async storage adapter over IndexedDB
  maxAge: 24 * 60 * 60_000,
  prefix: "o2q-heavy",
});
```

Then `persister: localPersister` is added by the `ORG_CONFIG`/`SESSION_STATIC` tier helpers, and
`persister: idbPersister` by `HEAVY_RESULT`.

**Which pages get localStorage persistence** (survives a reload, the point being instant first
paint):

- App shell / every page: `/config` (T0) — today re-fetched in `main.ts`, `MainLayout`, `Login`,
  `General`, `UsageTab`, `buildVersionChecker`.
- Logs, Traces, Metrics, Dashboards, Stream Explorer, Alerts, Pipelines, SLOs: **stream name list**
  (T1). This is the single highest-value persistence target — 54 importers, needed before first
  paint on most pages.
- Dashboards, Alerts, Reports, Synthetics: **folders by type** (T1) — needed to render the sidebar.
- Logs, Alerts, Pipelines, Dashboard panel editor: **functions list** (T1).
- Alerts, Pipelines: **destinations + templates** (T1).
- Settings: built-in regex patterns, model pricing (T0) — replaces the two sessionStorage classes.

**Which pages get IndexedDB persistence** (large payloads, must not touch the 5 MB localStorage
quota): dashboard panel results, log field values, trace DAG. Everything else: **no persistence**.

Storage keys are namespaced `o2q:<org>:<hash>` so the org-switch purge is a prefix scan.

### 5.6 Standard composables

Three composables cover every page shape in the app.

**(a) `useOrgQuery`** — org-scoped read, client-paginated tables.

```ts
// composables/query/useOrgQuery.ts
export function useOrgQuery<T>(opts: {
  key: (org: string) => readonly unknown[];
  fetch: (org: string) => Promise<T>;
  tier: TierName;
  enabled?: MaybeRef<boolean>;
}) {
  const store = useStore();
  const org = computed(() => store.state.selectedOrganization?.identifier);
  return useQuery({
    queryKey: computed(() => opts.key(org.value)),
    queryFn: () => opts.fetch(org.value),
    enabled: computed(() => !!org.value && (toValue(opts.enabled) ?? true)),
    ...tierOptions(opts.tier),
  });
}
```

Page usage — this replaces the entire AlertList cache block, race guard and loading dance:

```ts
const {
  data: alerts,
  isPending,
  isFetching,
  refetch,
} = useOrgQuery({
  key: (org) => qk.alerts.listByFolder(org, activeFolderId.value),
  fetch: (org) => alertsService.listByFolderId({ org, folder: activeFolderId.value }).then(mapRows),
  tier: "ENTITY_LIST",
});
```

`activeFolderId` is reactive and part of the key, so switching folders switches the cache entry —
the race guard at [AlertList.vue:1541](../src/components/alerts/AlertList.vue#L1541) is deleted, not
ported. `isPending` drives the skeleton (only when there is no cached data); `isFetching` drives a
subtle background-refresh indicator. The "cache hit means set loading=false" comment disappears.

**(b) `useServerTable`** — server pagination + server filter + server sort.

```ts
export function useServerTable<T>(opts: {
  key: (org: string, p: ServerTableParams) => readonly unknown[];
  fetch: (org: string, p: ServerTableParams) => Promise<{ rows: T[]; total: number }>;
  tier?: TierName;
  initialSort?: { by: string; order: "asc" | "desc" };
  debounceMs?: number; // default 300, applied to the text filter only
}) {
  const page = ref(1),
    pageSize = ref(25),
    filter = ref(""),
    sort = ref(opts.initialSort);
  const debouncedFilter = refDebounced(filter, opts.debounceMs ?? 300);
  const params = computed(() => ({
    page: page.value,
    pageSize: pageSize.value,
    filter: debouncedFilter.value,
    ...sort.value,
  }));

  const query = useQuery({
    queryKey: computed(() => opts.key(org.value, params.value)),
    queryFn: () => opts.fetch(org.value, params.value),
    placeholderData: keepPreviousData, // fixes P7 — no blank table on page change
    ...tierOptions(opts.tier ?? "ENTITY_LIST"),
  });

  // prefetch the next page as soon as the current one settles
  watchEffect(() => {
    if (!query.isFetching.value) prefetchNextPage();
  });

  watch([debouncedFilter, pageSize, sort], () => {
    page.value = 1;
  });
  return { page, pageSize, filter, sort, ...query };
}
```

Binds straight onto `OTable`'s server props (`current-page`, `total-count`, `sort-by`,
`sort-order`, `pagination="server"`).

**(c) `useOrgMutation`** — write + declarative invalidation.

```ts
export function useOrgMutation<TVars, TData>(opts: {
  mutate: (org: string, vars: TVars) => Promise<TData>;
  invalidates?: (org: string, vars: TVars) => readonly unknown[][];
  optimistic?: { key: (org, vars) => readonly unknown[]; update: (old: any, vars: TVars) => any };
  successMessage?: string;
}) { … }
```

Usage replaces the "mutate then re-call the loader" pattern
(`await getPipelines()` × 6 in PipelinesList):

```ts
const toggle = useOrgMutation({
  mutate: (org, v) => pipelineService.toggleState(org, v.id, v.enabled),
  invalidates: (org) => [qk.pipelines.root(org)], // prefix — invalidates list + details
  optimistic: {
    key: (org) => qk.pipelines.list(org),
    update: (rows, v) => rows.map((r) => (r.id === v.id ? { ...r, enabled: v.enabled } : r)),
  },
});
```

### 5.7 Org switch, logout, and the Vuex bridge

One place, wired next to the existing reset in
[MainLayout.vue:1420-1432](../src/layouts/MainLayout.vue#L1420-L1432):

```ts
watch(
  () => store.state.selectedOrganization?.identifier,
  (next, prev) => {
    if (prev && prev !== next) {
      queryClient.removeQueries({ queryKey: ["org", prev] });
      purgePersistedOrg(prev); // localStorage + IndexedDB prefix scan
    }
  },
);
// in the logout action / http.ts logout path:
queryClient.clear();
purgeAllPersisted();
```

This also **fixes P9** (panel cache never cleared on org switch/logout) as a side effect, once the
panel cache is behind the same persister.

**During migration**, some pages read Vuex and some read the query cache. Keep them consistent with
a one-way bridge for the caches that are actually shared across pages (streams, folders, functions):

```ts
watch(streamNameListQuery.data, (v) => {
  if (v) store.dispatch("streams/setStreams", v);
});
```

Query cache is the source of truth; Vuex is a read-only mirror until the last consumer is migrated,
then the mirror is deleted. Do **not** bridge in the other direction.

### 5.8 Panel cache migration

The panel cache should be migrated in **two steps**, not one, because the value it stores is not a
query result — it is executor state (`loading`, `isPartialData`, `isOperationCancelled`,
`resultMetaData` per partition, `cacheTimeRange`).

**Step 1 — extract the storage (low risk, do first).**
Generalize [usePanelCache.ts](../src/composables/dashboard/usePanelCache.ts) into
`composables/query/idbStorage.ts`: a generic async key/value store over IndexedDB with

- org-scoped composite keys (`org|folder|dashboard|panel`) — fixes the missing-org defect;
- a `by_expires` TTL index and a `by_updated` LRU index, copied from
  [fieldValueDB.ts](../src/composables/fieldValueDB.ts#L31-L44) — fixes unbounded growth;
- structured-clone writes instead of `JSON.parse(JSON.stringify())` — fixes the main-thread deep
  copy on multi-MB payloads;
- a cached connection, as `fieldValueDB` already does.

`usePanelCache` keeps its exact public API (`getPanelCache`/`savePanelCache`) and delegates.
`fieldValueDB` collapses onto the same primitive. `usePanelDataLoader` is untouched in this step.

**Step 2 — express the panel cache as a persisted query (later, optional).**
`usePanelDataLoader`'s `getCacheKey()` becomes the query key, `restoreFromCache`'s
normalization becomes a `queryKeyHashFn`:

```ts
const panelKey = qk.panels.result(
  org,
  folderId,
  dashboardId,
  panelId,
  normalizePanelKey(schema, vars),
);
useQuery({
  queryKey: panelKey,
  queryFn: runPanelQuery,
  persister: idbPersister,
  ...TIER.HEAVY_RESULT,
});
```

Because the schema object is large, register a custom `queryKeyHashFn` that hashes the normalized
schema to a short digest rather than stringifying it into every key.

**What must be preserved:** the `isCachedDataDifferWithCurrentTimeRange` signal
([usePanelDataLoader.ts:812](../src/composables/dashboard/usePanelDataLoader.ts#L812)). TanStack has
no equivalent — "cached data is for a different time window" is a domain concept. Keep it as
metadata stored alongside the cached value and surfaced through the composable, exactly as today.

**What must not be attempted:** wrapping the streaming/WebSocket search path in `useQuery`. Partial
results arriving over `useSearchWebSocket`/`useStreamingSearch` (20 consumer files) do not fit the
single-promise `queryFn` contract. Those keep their executors; the query cache only owns the
_persisted final state_.

### 5.9 What stays out of TanStack Query

| Area                                                                    | Why                                                                                                                      | What it uses instead                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Logs / Traces / Metrics search (`search.search`, `_around`, partitions) | streaming, partitioned, cancellable, per-partition progress; results are user-scoped ad-hoc queries with near-zero reuse | existing `useLogs`/`useStreamingSearch` + backend `use_cache` |
| WebSocket value fetches (`useValuesWebSocket`, `useFieldValuesStream`)  | push-based                                                                                                               | `fieldValueDB` on the shared IDB primitive                    |
| Panel query execution                                                   | see §5.8                                                                                                                 | executor + IDB persister                                      |
| Mutations to ingestion, login/auth, file uploads                        | one-shot, side-effecting                                                                                                 | `useOrgMutation` (no cache)                                   |
| SSE/AI chat streams                                                     | streaming                                                                                                                | unchanged                                                     |

---

## 6. Per-page cache policy matrix

Legend — **Pag**: `S` = server, `C` = client, `—` = none. **Key extras** are the server-applied
parameters that must be in the query key. **Persist**: `LS` = localStorage, `IDB` = IndexedDB.

### App shell / cross-cutting

| Surface                                                                                     | Endpoint(s)                               | Pag | Key extras   | Tier | Persist | Invalidated by                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------- | --- | ------------ | ---- | ------- | ------------------------------- |
| Every page (`main.ts`, `MainLayout`, `Login`, `General`, `UsageTab`)                        | `config.get_config`                       | —   | —            | T0   | LS      | app version change              |
| Org selector                                                                                | `organizations.os_list`                   | —   | —            | T1   | LS      | org create/rename/delete        |
| Org settings header/banners                                                                 | `organizations.get_organization_settings` | —   | —            | T1   | LS      | settings save                   |
| Sidebar folders (dashboards/alerts/reports/synthetics)                                      | `common.list_Folders`                     | —   | `type`       | T1   | LS      | folder create/edit/delete/move  |
| Stream picker (Logs, Traces, Metrics, Dashboards, Alerts, Pipelines, SLOs, Stream Explorer) | `stream.nameList`                         | —   | `streamType` | T1   | LS      | stream create/delete, ingestion |
| Functions (Logs bar, Alert form, Panel editor, Pipelines)                                   | `jstransform.list`                        | —   | —            | T1   | LS      | function create/update/delete   |

### Observability pages

| Surface                          | Endpoint(s)                                       | Pag   | Key extras                    | Tier                      | Persist | Notes                                                                |
| -------------------------------- | ------------------------------------------------- | ----- | ----------------------------- | ------------------------- | ------- | -------------------------------------------------------------------- |
| Logs (`/logs`)                   | `search.search`, `partition`, WS                  | —     | —                             | **out of scope**          | —       | keep executor; only stream list + functions + saved views are cached |
| Logs — saved views               | `saved_views.get` / `getViewDetail`               | C     | —                             | T2                        | —       | invalidate on `post`/`put`/`delete`                                  |
| Logs — field values              | `stream.fieldValues`                              | —     | stream+field+range            | T5                        | IDB     | already `fieldValueDB`; move onto shared primitive                   |
| Traces (`/traces`)               | `search.get_traces`, `getTraceDAG`                | —     | —                             | out of scope / T5 for DAG | IDB     | DAG is deterministic per trace id → strong cache candidate           |
| Trace detail                     | `getTraceDAG(traceId)`                            | —     | `traceId`                     | T5                        | IDB     | immutable once written; `staleTime: Infinity`                        |
| Metrics explorer                 | `search.metrics_query_range`, `get_promql_series` | —     | —                             | out of scope              | —       | `get_promql_series` (label discovery) → T1                           |
| Stream Explorer                  | `stream.nameList` paginated                       | **S** | offset/limit/keyword/sort/asc | T2                        | —       | `keepPreviousData` + next-page prefetch                              |
| Log Streams (`/streams`)         | `stream.nameList` paginated                       | **S** | offset/limit/keyword/sort/asc | T2                        | —       | same; today re-fetches on every sort with a blank table              |
| Stream schema/settings drawer    | `stream.schema`                                   | —     | `type`,`name`                 | T1                        | —       | invalidate on `updateSettings`                                       |
| RUM sessions                     | `sessions.list`                                   | **S** | from/size/filters             | T2                        | —       |                                                                      |
| RUM error tracking / performance | `search.search` (dashboard-backed)                | —     | —                             | out of scope              | —       |                                                                      |

### Dashboards

| Surface                    | Endpoint(s)                                 | Pag | Key extras               | Tier | Persist | Notes                                                                                               |
| -------------------------- | ------------------------------------------- | --- | ------------------------ | ---- | ------- | --------------------------------------------------------------------------------------------------- |
| Dashboard list             | `dashboards.list`                           | C   | `folderId`, `title?`     | T2   | —       | replaces `allDashboardList` map                                                                     |
| Dashboard folders          | `common.list_Folders("dashboards")`         | —   | —                        | T1   | LS      | fixes P4                                                                                            |
| Single dashboard           | `dashboards.get_Dashboard`                  | —   | `dashboardId`,`folderId` | T3   | —       | keep the `hash` in the cached value for optimistic-concurrency saves (today `allDashboardListHash`) |
| Panel results              | search executor                             | —   | normalized schema + vars | T5   | IDB     | §5.8                                                                                                |
| Panel annotations          | `dashboard_annotations.list`                | —   | dashboard+range          | T3   | —       |                                                                                                     |
| Variable values            | `stream.fieldValues` / WS                   | —   | var+range                | T5   | IDB     | shares field-value store                                                                            |
| Favorites / home dashboard | `useFavoriteDashboards`, `useHomeDashboard` | —   | —                        | T1   | LS      |                                                                                                     |

### Alerts & incidents

| Surface                            | Endpoint(s)                                                    | Pag   | Key extras                   | Tier             | Persist | Notes                                                                                 |
| ---------------------------------- | -------------------------------------------------------------- | ----- | ---------------------------- | ---------------- | ------- | ------------------------------------------------------------------------------------- |
| Alert list (per folder)            | `alerts.listByFolderId`                                        | C     | `folderId`                   | T2               | —       | replaces `allAlertsListByFolderId`; deletes the race guard                            |
| Alert list (search)                | `alerts.listByFolderId` + `alert_name_substring`, `alert_type` | C     | `folderId`,`q`,`type`        | T2 (gcTime 60 s) | —       | **fixes P8** — searches become cached, debounced 300 ms                               |
| Alert detail / edit                | `alerts.get_by_alert_id`                                       | —     | `alertId`                    | T3               | —       |                                                                                       |
| Alert history / evaluation history | `alerts.getHistory`, `list_group_transitions`                  | **S** | page/size/range              | T2               | —       | `keepPreviousData`                                                                    |
| Destinations                       | `alert_destination.list`                                       | C     | `module`                     | T1               | LS      | needed by the alert form → persist                                                    |
| Templates                          | `alert_templates.list`                                         | C     | —                            | T1               | LS      | same                                                                                  |
| External alert sources             | `alert_sources.list`                                           | C     | —                            | T2               | —       |                                                                                       |
| Incident list                      | `incidents.list`                                               | C     | `status`,`severity` (server) | T2               | —       | replaces the `stores/incidents.ts` `cachedData`/`isInitialized`/`shouldRefresh` triad |
| Incident detail + RCA poll         | `incidents.get`, `getRcaHistory`                               | —     | `incidentId`                 | T4               | —       | polling → `refetchInterval` while `analysis_in_flight`                                |
| Incident stats                     | `incidents.getStats`                                           | —     | range                        | T2               | —       |                                                                                       |

### Pipelines, functions, SLOs, synthetics, workflows

| Surface                  | Endpoint(s)                     | Pag   | Key extras      | Tier              | Persist | Notes                                                    |
| ------------------------ | ------------------------------- | ----- | --------------- | ----------------- | ------- | -------------------------------------------------------- |
| Pipelines list           | `pipelines.getPipelines`        | C     | —               | T2                | —       | 6 manual re-fetch sites → 1 `invalidates`                |
| Pipeline detail / editor | `pipelines.getPipeline`         | —     | `id`            | T3                | —       |                                                          |
| Pipeline history         | `pipelines.*history`            | **S** | page/size       | T2                | —       |                                                          |
| Backfill jobs            | `backfill.listBackfillJobs`     | C     | —               | T4                | —       | job status is volatile → `refetchInterval` while running |
| Functions                | `jstransform.list`              | C     | —               | T1                | LS      |                                                          |
| Enrichment tables        | `jstransform.list` (enrichment) | C     | —               | T2                | —       |                                                          |
| SLO list                 | `slos.list`                     | C     | `groupId?`      | T2                | —       |                                                          |
| SLO detail / burndown    | `slos.get` + search             | —     | `sloId`,range   | T3 / out of scope | —       |                                                          |
| Synthetics monitors      | `synthetics.list`               | C     | folder          | T2                | —       |                                                          |
| Synthetics results/runs  | `synthetics.results`            | **S** | page/size/range | T2                | —       |                                                          |
| Workflows                | `workflows.list`                | C     | —               | T2                | —       |                                                          |
| Workflow runs            | `workflows.runs`                | **S** | page/size       | T4                | —       | volatile                                                 |

### IAM & settings

| Surface                                                            | Endpoint(s)                                         | Pag           | Key extras          | Tier | Persist | Notes                                                                                                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------- | ------------- | ------------------- | ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Users                                                              | `users.orgUsers`                                    | C             | —                   | T2   | —       | `User.vue` uses both `onActivated` and `onBeforeMount` today; one query replaces both                                                           |
| Groups / roles                                                     | `iam.*`                                             | C             | —                   | T2   | —       |                                                                                                                                                 |
| Service accounts                                                   | `service_accounts.list`                             | C             | —                   | T2   | —       |                                                                                                                                                 |
| Invitations                                                        | `users.getPendingInvites`                           | C             | —                   | T2   | —       |                                                                                                                                                 |
| Organizations (admin)                                              | `organizations.list`                                | **S**-capable | page/size/sort/name | T2   | —       | currently client-paginated with `page_size=1000000` — good candidate to flip to server                                                          |
| Quota                                                              | `iam.quota`                                         | C             | —                   | T4   | —       |                                                                                                                                                 |
| Org cleanup tasks poll                                             | `organizations.get_cleanup_tasks`                   | —             | —                   | T4   | —       | `refetchInterval` replaces `setInterval` at [OrgCleanupTasksDialog.vue:411](../src/components/iam/organizations/OrgCleanupTasksDialog.vue#L411) |
| Nodes                                                              | `common.list_nodes`                                 | C             | —                   | T1   | —       |                                                                                                                                                 |
| Cipher keys                                                        | `cipher_keys.list`                                  | C             | —                   | T1   | —       |                                                                                                                                                 |
| Regex patterns (custom)                                            | `regex_pattern.list`                                | C             | —                   | T1   | —       |                                                                                                                                                 |
| Regex patterns (built-in)                                          | `regex_pattern.getBuiltInPatterns`                  | —             | —                   | T0   | LS      | **deletes `RegexPatternCache`**                                                                                                                 |
| Model pricing (built-in)                                           | `model_pricing.*`                                   | —             | —                   | T0   | LS      | **deletes `ModelPricingCache`**                                                                                                                 |
| Model pricing (custom)                                             | `model_pricing.list`                                | C             | —                   | T1   | —       |                                                                                                                                                 |
| AI toolsets / LLM providers / GenAI mapping                        | `ai_toolsets.*`, `gen-ai-agent-mapping`             | C             | —                   | T1   | —       |                                                                                                                                                 |
| Domain management, storage settings, correlation settings, license | `domainManagement`, `org_storage`, `license_server` | —             | —                   | T1   | —       |                                                                                                                                                 |
| Running queries                                                    | `search.get_running_queries`                        | C             | —                   | T4   | —       | `refetchInterval: 5s`, never persisted                                                                                                          |
| Query summary/history                                              | `search.get_history`                                | **S**         | range/page          | T2   | —       |                                                                                                                                                 |
| Ingestion pages                                                    | `useIngestion`, org tokens                          | —             | —                   | T1   | LS      | tokens are secrets → **memory only, never persisted**                                                                                           |

---

## 7. Caching policy — the rules

### 7.1 When to cache

Cache a read when **all** of these hold:

1. It is a `GET` with no side effects.
2. Two or more surfaces (or two visits to one surface) can reuse the result inside its `staleTime`.
3. The response is org-scoped or global — never user-input-scoped ad-hoc data.
4. Showing a slightly stale value for `staleTime` is acceptable to the user.

Cache with **persistence** additionally when:

5. The value is needed _before first paint_ on a page users land on directly (stream list, folders,
   config), **and**
6. it contains no secrets (tokens, passcodes, cipher key material, credentials), **and**
7. it is small (localStorage) or the payload justifies IndexedDB (> ~100 KB, or binary-ish result
   sets).

### 7.2 When _not_ to cache

- **Ad-hoc search results** (logs/traces/metrics user queries). Unique per keystroke; the backend
  already has `use_cache`.
- **Secrets and credentials** — ingestion tokens, org passcode, cipher key values, RUM tokens,
  service-account tokens. Memory-only (`gcTime` short), never a persister.
- **Anything the user just mutated** — invalidate, do not patch, unless the optimistic update is
  trivially correct.
- **Volatile operational state** — running queries, job progress, RCA in-flight, cleanup tasks.
  Use `refetchInterval` with `staleTime: 0`, not persistence.
- **Cross-tenant-sensitive lists on shared machines** — anything not org-prefixed. If you cannot
  put it under `["org", orgId]`, do not persist it.

### 7.3 How to cache

1. **Key from `qk.*` only.** Never an inline array literal in a component.
2. **Server params in the key; client params out.** If the server filters it, key it. If `OTable`
   filters it, don't.
3. **Pick a tier, not a number.** If no tier fits, the tier list is wrong — extend `tiers.ts`, don't
   inline `staleTime`.
4. **`placeholderData: keepPreviousData` on every server-paginated table.** Non-negotiable; it is
   the fix for the blank-table flicker.
5. **Debounce server-filtered text at 300 ms** before it enters the key.
6. **Invalidate by prefix.** `queryClient.invalidateQueries({ queryKey: qk.alerts.root(org) })`
   covers list + search + detail. Precise-key invalidation is a bug waiting for a new key variant.
7. **Optimistic updates only for toggles and single-field edits** (enable/disable, star/unstar,
   status change). Anything that reshapes a row: invalidate.
8. **One query per concept, shared by all consumers.** `useStreamNameList()` is imported by pages;
   pages never call `StreamService.nameList` directly. This is what makes dedup real.
9. **Errors keep going through the existing interceptor.** 401/403 handling stays in
   [http.ts](../src/services/http.ts); the query layer only decides retry (never retry 4xx).
10. **Persisted entries are versioned.** Bump a `buster` string when a response shape changes so
    stale localStorage payloads are discarded rather than rendered.

### 7.4 Prefetching

- On sidebar folder hover → `prefetchQuery` the folder's list (alerts/dashboards/reports).
- On server-table settle → prefetch page N+1.
- On app boot, after `/config` resolves → prefetch stream name list + folders for the landing route.
  There is already a [`useRoutePrefetch`](../src/composables/useRoutePrefetch.ts) composable to hang
  this off.

---

## 8. Migration plan

Phased so that each phase is independently shippable and reversible. No phase requires a
big-bang rewrite; old and new coexist behind the Vuex bridge (§5.7).

**Phase 0 — Foundation (1 PR, no page changes).**
Add `@tanstack/vue-query` + `@tanstack/query-persist-client-core`. Create
`composables/query/{queryClient,queryKeys,tiers,persisters,idbStorage,useOrgQuery,useServerTable,useOrgMutation}.ts`.
Install the plugin in `main.ts`. Wire the org-switch/logout purge in `MainLayout`. Add DevTools in
dev builds only. Add the test helper (§9). **Exit criteria:** app behaves identically; zero pages
migrated.

**Phase 1 — Shared cross-page reads (highest ROI).**
`useConfig` (T0), `useStreamNameList` (T1+LS), `useFoldersByType` (T1+LS, **fixes P4/P5**),
`useFunctions` (T1+LS, **fixes P5**), `useDestinations`/`useTemplates` (T1+LS). Bridge each into
Vuex so unmigrated consumers keep working. **Exit criteria:** stream/folder/function requests drop
measurably on a Logs→Dashboards→Alerts navigation; sidebar renders from persisted cache on reload.

**Phase 2 — Delete the bespoke sessionStorage caches.**
Built-in regex patterns and model pricing become T0 persisted queries; delete
`regexPatternCache.ts` and `modelPricingCache.ts` (**fixes P12**).

**Phase 3 — Client-paginated list pages.**
Migrate in this order (cheapest → most entangled): settings lists (cipher keys, regex patterns, AI
toolsets, model pricing, nodes, synthetics locations) → IAM (users, groups, roles, service accounts,
invitations) → SLOs, workflows, enrichment tables → pipelines → reports → dashboards → alerts.
Delete the corresponding Vuex maps and their dispatch sites as each lands (**fixes P3, P6**).
Alerts last, because `AlertList.vue` is the largest and carries the folder/tab/search interplay.

**Phase 4 — Server-paginated tables.**
`useServerTable` for LogStream, StreamExplorer, alert history surfaces, pipeline history,
sessions, quality runs. Add `keepPreviousData` + next-page prefetch (**fixes P7**).

**Phase 5 — Polling → `refetchInterval`.**
Replace `setInterval` fetch loops in `OrgCleanupTasksDialog`, `IncidentDetailDrawer`,
`AwsMarketplaceSetup`, backfill jobs, running queries.

**Phase 6 — Heavy caches onto the shared IDB primitive.**
`usePanelCache` and `fieldValueDB` delegate to `idbStorage` with org-scoped keys, TTL and LRU
(**fixes P9**). `usePanelDataLoader` untouched.

**Phase 7 (optional) — Panel results as persisted queries.**
Only after Phase 6 has been stable for a release. Preserve
`isCachedDataDifferWithCurrentTimeRange`.

**Phase 8 — Retire `useStreams`' bespoke machinery.**
Once all 54 consumers read `useStreamNameList`/`useStreamSchema`, delete the promise singleton and
the manual index-map maintenance (**fixes P10**). Keep `getUpdatedSettings` and the diff helpers —
they are business logic, not caching.

**Suggested sequencing note:** Phases 1–3 deliver most of the user-visible win. Phases 6–8 are
cleanup that pays off in maintenance, not latency.

---

## 9. Testing

The repo has co-located `*.spec.ts` for nearly every service and composable, so the migration must
not break them — and it mostly won't, because services are unchanged.

- **Test helper.** Add `test/unit/helpers/queryClient.ts` exporting a factory that builds a
  `QueryClient` with `retry: false`, `gcTime: Infinity` and a fresh cache per test, plus a
  `withQuery(component)` mount wrapper. Every migrated component spec swaps its service mock
  assertions for this wrapper; the service mocks themselves stay.
- **Isolation.** A fresh `QueryClient` per test — a shared client leaks cached data between tests
  and produces order-dependent failures. This is the single most common migration mistake.
- **Assert on cache behaviour, not call counts alone.** For each migrated page add: (a) renders from
  cache without a second request inside `staleTime`; (b) refetches after the matching mutation's
  invalidation; (c) org switch removes the entry.
- **Key-factory test.** One spec asserting every `qk.*` key starts with `["org", org]` — cheap, and
  it is the invariant the whole invalidation story rests on.
- **Persistence tests** run against a fake storage adapter, not real localStorage/IndexedDB.
- Existing specs for `usePanelCache`, `usePanelDataLoader` and `fieldValueDB` (515 + 3135 + N lines)
  are the regression net for Phases 6–7 — they must pass unchanged.

---

## 10. Risks

| Risk                                                       | Mitigation                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Two sources of truth during migration (Vuex + query cache) | One-way bridge only (§5.7); delete each Vuex map in the same PR that migrates its last consumer                             |
| Persisted cross-tenant data on shared machines             | Every key org-prefixed; purge on org switch and logout; secrets never persisted (§7.2)                                      |
| Stale persisted payloads after a response-shape change     | `buster` string in the persister, bumped with the shape change                                                              |
| localStorage quota (5 MB)                                  | Only T0/T1 config-sized values in LS; everything heavy in IDB with TTL + LRU                                                |
| Over-caching hides fresh data in an ops tool               | Conservative `staleTime`s; `isFetching` background indicator on every migrated list so users can see a refresh is happening |
| Query keys drifting into components                        | Lint rule / review checklist: no array literal passed as `queryKey` outside `queryKeys.ts`                                  |
| Bundle size                                                | `@tanstack/vue-query` ≈ 13 KB gzip; it replaces more hand-written cache code than it adds                                   |
| `AlertList.vue` complexity                                 | Migrate it last, after the pattern has been proven on 10+ simpler pages                                                     |

---

## 11. Appendix — quick reference for reviewers

A migrated page should look like this and nothing else:

```ts
// ✅ read
const {
  data: rows,
  isPending,
  isFetching,
} = useOrgQuery({
  key: (org) => qk.pipelines.list(org),
  fetch: (org) => pipelineService.getPipelines(org).then((r) => r.data.list),
  tier: "ENTITY_LIST",
});

// ✅ write
const del = useOrgMutation({
  mutate: (org, id: string) => pipelineService.deletePipeline(org, id),
  invalidates: (org) => [qk.pipelines.root(org)],
  successMessage: t("pipeline.deleted"),
});
```

Reject in review:

- `const loading = ref(false)` around a service call → use `isPending`/`isFetching`.
- `if (store.state.organizationData.X[id]) { … } else { fetch() }` → that is a query.
- `if (folderId !== activeFolderId.value) return;` after an `await` → the key handles it.
- `await getThings()` after a mutation → `invalidates`.
- `queryKey: ["alerts", org, folderId]` inline → `qk.alerts.listByFolder(org, folderId)`.
- `staleTime: 60000` inline → pick a tier.
- `setInterval(fetch, n)` → `refetchInterval`.
