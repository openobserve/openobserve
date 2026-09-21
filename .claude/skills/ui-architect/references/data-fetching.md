# Data fetching & caching (TanStack Query)

How a screen reads and writes server data. The app uses **TanStack Query v5**
(`@tanstack/vue-query`) with one shared client; every server read a page shows
goes through a declared query, and every write declares what it makes stale.
Follow this for any new page, panel, dialog or picker that talks to the backend.

## Table of contents

- [The model](#the-model)
- [Where the code goes](#where-the-code-goes)
- [Keys](#keys)
- [Freshness tiers (by module)](#freshness-tiers-by-module)
- [Declaring a read and a write](#declaring-a-read-and-a-write)
- [Reading in a component](#reading-in-a-component)
- [The refresh rule](#the-refresh-rule)
- [Invalidation: what a write must expire](#invalidation-what-a-write-must-expire)
- [Anti-patterns (each one shipped as a bug)](#anti-patterns-each-one-shipped-as-a-bug)
- [What is never cached](#what-is-never-cached)
- [Org switch, logout, errors](#org-switch-logout-errors)
- [Testing](#testing)
- [Checklist](#checklist)

---

## The model

- **One client:** `web/src/composables/query/queryClient.ts`. Its defaults are
  the policy: fallback `staleTime` = the live tier, `gcTime` = `GC_TIME` (3 h),
  **`refetchOnWindowFocus` and `refetchOnReconnect` are off everywhere**,
  400/401/403/404 and 501 are never retried (other failures retry twice),
  mutations never retry.
- **Memory only.** No declaration has a `persister`. The one disk cache is the
  dashboard panel-result cache (`usePanelCache` + IndexedDB) and the log
  field-values database; neither is a pattern to copy.
- **Stale time is pull-based.** Nothing fires when an entry turns stale. The next
  read decides: a fresh entry is served with no request, a stale one is
  re-fetched. So a screen only sees fresh data if it *asks* on mount — see
  [Anti-patterns](#anti-patterns-each-one-shipped-as-a-bug).
- **Changes made outside this tab never expire this tab's cache** — another tab
  (every "Create destination/workflow" link opens one), another user, the API,
  ingestion. The user's recourse is the Refresh button, which is why
  [the refresh rule](#the-refresh-rule) is strict.

## Where the code goes

| File | Holds | Never holds |
| --- | --- | --- |
| `services/<domain>.ts` | the transport — one function per endpoint, via `http()` | caching, keys, durations |
| `services/<domain>.querykeys.ts` | the key factory (`xKeys`) — imports only `orgKey` | the transport (so another domain can import the keys without an import cycle) |
| `services/<domain>.queries.ts` | `queryOptions()` reads and `mutationOptions()` writes | component state |
| `composables/query/cachePolicy.ts` | **the only durations in the app** | — |
| `composables/query/keys.ts` | `orgKey`, `globalKey`, `GLOBAL_SCOPE` | — |
| components / composables | `useQuery` / `useMutation` / `queryClient.fetchQuery` calls | `http`/axios calls, bare `staleTime` numbers, hand-made keys |

Before declaring a new query, **grep `services/*.queries.ts`** — most lists
already have one (functions, destinations, templates, folders, streams, users,
roles, pipelines, workflows…). Reuse it; a second uncached path to the same list
is a bug (it never expires with the rest).

## Keys

```ts
// services/things.querykeys.ts
import { orgKey } from "@/composables/query/keys";

export const thingKeys = {
  all: (org: string) => orgKey(org, "things"), // the invalidation scope
  list: (org: string, folderId: string) => orgKey(org, "things", "list", folderId),
  detail: (org: string, id: string) => orgKey(org, "things", "detail", id),
};
```

- **Every key is rooted at `["org", <id>, …]`** through `orgKey` (or
  `globalKey` for reads that are not org-scoped, e.g. `/config`). The org-switch
  and logout purges depend on that shape; a hand-built key opts out silently.
- **`all` is what writes drop.** Every other key sits beneath it.
- **Put every input that changes the result in the key**: folder, page, sort,
  filters (`stableFilters(params)` keeps the order stable and drops empty
  values), search term, time range.
- **Time ranges are bucketed:** `quantizeRange(start, end)` in the query
  factory. A range built from `Date.now()` is new on every mount, so a raw
  timestamp in a key never hits. Bucket the key; send the exact range in the
  request when the last minute of data matters (see `workflowRunsQuery`).

## Freshness tiers (by module)

A query's `staleTime` comes from the **module** it belongs to, not from how it is
read. Every declaration names its tier from `cachePolicy.ts`; never write a
number.

| Tier | Constant | Modules (current declarations) |
| --- | --- | --- |
| 1 min | `LIVE_STALE_TIME` | alerts (list, detail, history, dependencies), alert sources, anomaly detection, incidents, SLOs, synthetics monitors, enrichment-table job statuses, on-call **state** (who is on call, team overview, escalation preview + progress, responses, deliveries, coverage gaps, unrouted signals, my on-call) |
| 5 min | `MEDIUM_STALE_TIME` | logs & streams (name list, stream page, schema), saved views, traces (DAG, service graph), service correlation (semantic groups, identity config), org summary counts, AI observability (agents, experiments, remote tasks, datasets, queues), online evals, on-call **derived** (reachability, config risks, team load, resolved schedule, overrides, unavailability, ownership stats), DB monitoring instances |
| 1 h | `NORMAL_STALE_TIME` | dashboards (+ annotations), pipelines (+ history), functions, query functions, workflows (folder lists, search, run history), reports, folders, nodes, IAM (users, roles, groups, resources, service accounts), ingestion/RUM tokens, org passcode, cipher keys, org settings, settings KV, alert destinations + templates, regex patterns, model pricing, AI toolsets, synthetics agent tokens, on-call **config** (teams, members, schedule, policy, presets, routing config, ownership rules, response history + prior causes) |
| ∞ | `SESSION_STALE_TIME` | the two `/config` reads |
| 0 | `staleTime: 0` | license, org cleanup-task poll (`refetchInterval` while its dialog is open) |

- A new query joins its module's row. A new module: pick the row whose data
  changes at the same speed, and name it in the table above.
- A module may span rows where its data genuinely changes at different speeds.
  On-call is the worked example: the ladder is config (1 h), but who it would
  wake right now moves at the next handover with no write behind it (1 min), so
  the two cannot share a tier however closely they are read together.
- **Never set `gcTime` on a declaration** — the client owns it. (The panel cache
  keeps its own `PANEL_GC_TIME`.)
- Billing is not cached at all (no declarations; the billing pages call
  `BillingService` directly).

## Declaring a read and a write

```ts
// services/things.queries.ts
import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import things from "./things";
import { thingKeys } from "./things.querykeys";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";

export const thingsQuery = (org: string, folderId: string) =>
  queryOptions({
    queryKey: thingKeys.list(org, folderId),
    queryFn: async (): Promise<Thing[]> => (await things.list(org, folderId)).data?.list ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

export const saveThingMutation = (org: string, isUpdate: () => boolean) =>
  mutationOptions({
    mutationFn: (payload: Thing) =>
      isUpdate() ? things.update(org, payload) : things.create(org, payload),
    // The form renders its own toasts.
    meta: { invalidates: [thingKeys.all(org)], silentError: true },
  });
```

`meta` is applied centrally by the client's `MutationCache` — a component never
repeats it:

| `meta` field | Effect |
| --- | --- |
| `invalidates: [key…]` | on success, marks those scopes stale (active observers refetch now, the rest on next read). Use the domain's `all` key, plus any **other** domain whose data the write changes. |
| `removes: [key…]` | on success, drops those scopes' *inactive* entries — after a delete, so a cached detail can't serve the deleted entity. |
| `successMessage` | the success toast. |
| `silentError` | the call site renders the failure itself; suppresses the default error toast. 403s are never toasted here (the http interceptor reports them). |

Unwrap envelopes in `queryFn` (`?.list ?? []`, `Array.isArray(data) ? …`) so every
consumer gets the same shape.

## Reading in a component

### Preferred: `useQuery`

```ts
const orgId = useOrgId(); // computed org, so the key follows an org switch
const thingsList = useQuery(() =>
  Object.assign(thingsQuery(orgId.value, folderId.value), {
    // Gate until every key input is resolved, or the first key fires with a placeholder and double-fetches.
    enabled: !!orgId.value && folderId.value !== undefined,
  }),
);
// The rows ARE the query — a computed, never a copy in a ref.
const rows = computed(() => thingsList.data.value ?? []);
// Top-level consts, because a template only unwraps top-level refs.
const loading = thingsList.isPending;
const fetching = thingsList.isFetching;
const lastUpdatedAt = thingsList.dataUpdatedAt;
const forbidden = computed(() => {
  const e: any = thingsList.error.value;
  return e?.status === 403 || e?.response?.status === 403;
});
// Named handler: `@click="thingsList.refetch"` would pass the MouseEvent in.
const refreshThings = () => thingsList.refetch();
const saveThing = useMutation(() => saveThingMutation(orgId.value, () => isEdit.value));
```

| UI need | Source |
| --- | --- |
| table skeleton (nothing to show yet) | `isPending` — false whenever cached data exists |
| refresh-button spinner | `isFetching` — true for any request, including one with rows on screen |
| `ORefreshButton :last-run-at` | `dataUpdatedAt` (the fetch time, not `Date.now()`) |
| Refresh click | a named handler calling `refetch()` (always hits the server) **plus** a forced read of every secondary list on the view |
| `:forbidden` | the query's `error` status (this list's own request only) |

`FunctionList.vue` and `TemplateList.vue` are reference list pages.

If something must react to a reload (rebuild a derived structure), watch
`dataUpdatedAt`, not `data`: an unchanged refetch keeps the same object and a
value watcher never fires.

### Imperative: `queryClient.fetchQuery`

For Options-API components and flows that sequence a read against other work.
Same declaration, same cache:

```ts
// Named handler: `@click="load"` would pass the MouseEvent as `force`.
const refresh = () => load(true);

const load = async (force = false) => {
  const options = thingsQuery(orgId.value, folderId.value);
  // Stale-while-revalidate: paint what the cache has before the request.
  const cached = queryClient.getQueryData(options.queryKey);
  if (cached) rows.value = cached;
  loading.value = !cached; // skeleton only on a cold read
  fetching.value = true;
  try {
    // Force by invalidating the exact entry — never by passing `staleTime: 0`.
    if (force) {
      await queryClient.invalidateQueries({ queryKey: options.queryKey, exact: true, refetchType: "none" });
    }
    rows.value = await queryClient.fetchQuery(options);
    lastUpdatedAt.value = queryClient.getQueryState(options.queryKey)?.dataUpdatedAt ?? Date.now();
  } finally {
    loading.value = false;
    fetching.value = false;
  }
};
```

- A list whose key changes under the user (folder switch, cross-folder search)
  needs a **newest-read guard** (a counter checked after the `await`), so a slow
  earlier response can't overwrite the current list. `WorkflowsList.vue` is the
  reference.
- Repaint from the cache only when **switching** lists; a reload of the same list
  keeps the rows on screen (an in-place toggle must not flicker back).
- `fetchInto()` (`composables/query/fetchInto.ts`) wraps this pattern for the
  remaining legacy callers. Don't add new callers — prefer `useQuery`.
- Server-paginated tables: page, size, sort and filters go in the key; prefetch
  the next page with `queryClient.prefetchQuery` (see `LogStream.vue`,
  `AlertHistory.vue`).

## The refresh rule

**A user-initiated refresh reaches the server for everything that view shows.**
Everything else reads the cache.

| Trigger | Reads |
| --- | --- |
| Refresh button, `r` shortcut, a section/table/picker refresh icon, Retry, an error state's action | **forced** — the list **and every secondary read on the same screen**: counts ("Used by", member counts, usage), summary strips, dropdown options, agent/filter lists |
| Page open, revisit, tab switch, route back | cache (`fetchQuery` / `useQuery`) |
| Paging, sorting, searching, filtering, date-window change | cache for the new key; the key change is what fetches |
| After a write in this tab | the mutation's `invalidates` expires it; a plain read then fetches |

- **Thread `force` only from the refresh path.** A shared loader that other
  triggers also call (search, paging, mount) needs a separate flag for the
  secondary reads, or every page click refetches them (`SessionsList.vue`
  `forceAgents`).
- A child component's refresh icon that emits to a parent must reach a **forced**
  loader in the parent: `@refresh="load(true)"`, not `@refresh="load"`.
- When the page's own list was just re-read, don't force it again for a derived
  structure — force only the inputs the page doesn't own
  (`useDependencyGraph().loadGraph(org, ["alerts", "templates"])`).

## Invalidation: what a write must expire

- Every write is a `mutationOptions()` with `meta.invalidates` — including
  writes in dialogs, drawers, import flows and bulk actions.
- A write that changes **another** domain's data invalidates that domain too
  (keys are imported from the other domain's `querykeys` file).
- A write whose effect **lands later** (a queued retry, a job, a test run that
  records history) expires the affected scope again when the page observes it
  settle, and expires derived lists (run history) at submit.
- A side-effect write that isn't a user save but changes rows other screens seed
  from (e.g. the workflow canvas persisting test badges) still invalidates the
  domain.
- A write still made through a raw service call (not yet a mutation) must call
  `queryClient.invalidateQueries({ queryKey: xKeys.all(org) })` right after it.

## Anti-patterns (each one shipped as a bug)

| Don't | Because | Do |
| --- | --- | --- |
| `if (!store.state.organizationData.things) await getThings()` — a Vuex copy guarding the fetch | the copy never expires, so the query's `staleTime` is never consulted: a folder another user created never appears | call the loader every time; the cache decides whether it costs a request. No server list lives in Vuex. |
| A module-level "load once per org" map | never refreshed until a full reload (a changed destination URL kept showing the old one) | read the shared query (`destinationsQuery(org, "pipeline")`) |
| `fetchQuery({ ...opts, staleTime: 0 })` | the passed `staleTime` is stored on the query permanently | `invalidateQueries({ exact: true, refetchType: "none" })`, then `fetchQuery(opts)` |
| A raw `Date.now()` range in a key | a new key on every mount — the cache never hits | `quantizeRange()` in the factory |
| A reactive key that fires before the folder/org resolves | two requests per mount (placeholder key, then real key) | `enabled` gate on every key input |
| Copying `data` into a ref from a watcher without `immediate` | a warm remount paints an empty table | a `computed` over `data` (or `immediate: true`, keyed on `dataUpdatedAt`) |
| A `persister:` on a declaration | a restored copy is served without any age check | memory only |
| `refetchOnWindowFocus: true` on a query | off globally on purpose (wall displays, expensive endpoints) | a Refresh button |
| Calling the service for a list another page already caches | a second, uncached path that never expires with the first | reuse the declared query |
| `@click="load"` where `load(force)` / `load(folderId)` | the MouseEvent becomes the argument | a named no-arg handler |
| Refresh that forces the main list only | secondary lists stay stale for up to their tier | force every read on the view |

## What is never cached

- Log/metric/trace **search** (`search.search`, partitions, streaming/WebSocket
  search), AI chat streams, single-use URLs and page tokens, GETs that mutate.
- **Billing** reads (no declarations exist).
- **Read-modify-write dialogs** (e.g. `WorkflowLinkAlertsDialog`) — they must
  start from the server's copy.
- Detail reads that carry a **concurrency token**: `dashboardService.get_Dashboard`
  (`hash`).
- **Editor cold loads** from a deep link (pipeline and workflow editors read
  fresh before editing). Opening an editor from a list row seeds it from the row.
- Single run / execution detail reads (workflow run errors, synthetics run
  results) and the IAM role editor's per-entity permission lists.
- Anything with `staleTime: 0` in the tier table.

If a new read belongs here, call the service directly and leave a one-line
comment saying why it is uncached.

## Org switch, logout, errors

- **Org switch** (`MainLayout` → `purgeOrgQueries`): memory is kept — keys are
  org-rooted, so switching back inside the tier costs nothing — and disk entries
  for other orgs are dropped. Read the org through `useOrgId()` so reactive keys
  follow the switch; inside an imperative call `store.state.selectedOrganization.identifier`
  is fine.
- **Logout** (`purgeAllQueries`): everything cleared, memory and disk.
- **Errors:** a failed query keeps its previous data. Surface 403 as the table's
  `:forbidden` from *this* list's own request; mutation errors toast by default
  unless `silentError`.

## Testing

- Unit tests run against the **real app `queryClient`** (installed by
  `web/src/test/unit/helpers/setupTests.ts`, cleared after every test). Mock the
  **service module** (`overlayServiceMock` from `@/test/unit/helpers/mockService`),
  never the query.
- Assert request counts, not implementation: a revisit/remount → **0** calls; a
  refresh → **1**; a read after a write → **1**; a secondary list on refresh → **1**.
  A test for a forced path should fail when the `force` is removed — check it.
- Assert write invalidation with
  `vi.spyOn(queryClient, "invalidateQueries")` and the domain's `all` key.
- `ORefreshButton` runs an interval; stub it in specs that call
  `vi.runAllTimers()`.
- **Browser check:** the live client is
  `document.querySelector("#app").__vue_app__._context.provides.VUE_QUERY_CLIENT`.
  Record requests with an in-page XHR wrapper, and test a tier boundary by
  ageing an entry: `qc.setQueryData(key, qc.getQueryData(key), { updatedAt: Date.now() - 61 * 60_000 })`.
  A plain reload empties the cache — re-install the recorder after one.

## Checklist

- [ ] Every read the view shows is a declared `queryOptions()` in
      `services/<domain>.queries.ts` (an existing one if the list is already
      declared), keyed with `orgKey` and every result-changing input.
- [ ] `staleTime` names the module's tier from `cachePolicy.ts`; no `gcTime`,
      no `persister`, no focus/reconnect refetch.
- [ ] Components use `useQuery` (rows as a `computed`, `enabled` gate) or
      `fetchQuery`; no `http`/axios, no Vuex copy of the list, no load-once map.
- [ ] Skeleton from `isPending`, refresh spinner from `isFetching`,
      `ORefreshButton :last-run-at` from `dataUpdatedAt`.
- [ ] Refresh (button, `r`, section icons, Retry) forces **every** read on the
      view through a named handler; paging/search/mount don't force.
- [ ] Every write is a `mutationOptions()` with `meta.invalidates` covering the
      domain and any other domain it changes; delayed effects expire again when
      they settle.
- [ ] Time ranges in keys go through `quantizeRange`.
- [ ] Specs assert 0 requests on revisit and 1 on refresh/after a write.
