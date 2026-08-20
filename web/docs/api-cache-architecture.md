# API Cache Architecture — the call flow

**Companion to** [query-authoring-guide.md](./query-authoring-guide.md) (how to
add one, and the TanStack behaviours that bite),
[api-cache-inventory.md](./api-cache-inventory.md) (what is cached where),
[api-cache-workflow.md](./api-cache-workflow.md) (the request traced end to end,
frontend to backend) and [api-caching-audit.md](./api-caching-audit.md) (the
original design study — historical).

This document answers one question: **a component needs data — which file does it
call, what happens next, and where does the payload end up?**

---

## 1. The layers, and what each one owns

Layered by rate of change. Each decision has exactly one home.

| #   | Layer            | File(s)                                        | Owns                                                                             |
| --- | ---------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| 5   | Page / component | `views/…`, `components/…`                      | _when_ to read: `enabled`, the folder id, `refetchInterval`, and the render       |
| 4   | Declaration      | `services/<domain>.queries.ts`                 | one `queryOptions()` / `mutationOptions()` per endpoint                          |
| 3   | Identity         | `services/<domain>.querykeys.ts`               | the key factory — `all` (invalidation scope) plus one entry per read              |
| 2   | **Policy**       | `query/cachePolicy.ts`                         | `staleTime`, `gcTime` — **the only file with durations in it**                    |
| 1   | Transport        | `services/<domain>.ts` → `services/http.ts`    | URLs, auth, 401 refresh, 403 grouping                                            |

There is **no wrapper type**. A declaration is a plain TanStack options object,
so the same value works reactively (`useQuery(fooQuery(org))`) and imperatively
(`queryClient.fetchQuery(fooQuery(org))`). Everything a component needs —
`fetchQuery`, `getQueryData`, `invalidateQueries`, `setQueriesData` — is
TanStack's own API, called directly.

**Why three files per domain, not one.**

- Splitting the declaration from the transport makes the reference between them
  a normal module import, so `vi.mock("@/services/x")` reaches a query's
  `queryFn`. When both lived in one file that reference was intra-module and no
  module mock could intercept it — which is why the bespoke `overlayServiceMock`
  / `__isQuery` machinery existed. It is gone.
- Splitting the keys out again keeps them a dependency-free leaf. A write in one
  domain routinely drops another's scope; importing `<domain>.queries.ts` to
  reach a key would drag that domain's transport along and, once two domains
  invalidate each other, form a cycle.

**The rule that follows: durations live in `cachePolicy.ts`.** `staleTime: 60000`
at a call site is a review rejection — if no constant fits, add one.

**And one more: nothing reachable from `query/queryClient.ts` may import UI or
i18n at runtime.** The unit-test setup imports that module eagerly, so a runtime
edge to `@/types/i18n` evaluates it before a spec's `vi.mock("vue-i18n")` can
replace it — which silently breaks every spec that mocks i18n. Mutation toasts
are injected via `setMutationNotifier` from `main.ts` for exactly this reason.

---

## 2. Read path — worked example

The sidebar folder list, traced through every file it touches.

```
  src/components/common/sidebar/FolderList.vue
        │  await getFoldersListByType(store, props.type)
        ▼
  src/utils/commons.ts                          ← legacy entry point, kept so
        │  fetchInto(foldersQuery(org, type), …)   ~10 call sites need no edit
        ▼
  src/services/common.queries.ts                ← LAYER 4: the declaration
        │  foldersQuery = (org, type) => queryOptions({
        │    queryKey: folderKeys.list(org, type),   ← LAYER 3: identity
        │    queryFn:  () => common.list_Folders(org, type)…,
        │    staleTime: CONFIG_STALE_TIME,           ← LAYER 2: policy
        │  })
        ▼
  @tanstack/query-core  (via src/composables/query/queryClient.ts)
        │
        ├── in memory and fresh (< 5 min)? ─────────► return it. 0 requests.
        │
        ├── nothing in memory, but persisted?
        │     └─ persisters.ts reads
        │        localStorage["o2q-[\"org\",\"acme\",\"folders\",\"dashboards\"]"]
        │        └─► hydrate, return; refetch in the background only if stale
        │
        └── miss, or stale ──► run queryFn
              │
              ▼
        src/services/common.ts     list_Folders(org, type)   ← LAYER 1
              │
              ▼
        src/services/http.ts       axios + 401 refresh + 403 grouping
              │
              ▼
        GET /api/v2/{org}/folders/{type}
              │
              ▼
        stored in memory, and — because this read persists — written to
        localStorage by the persister
```

Two consequences worth internalising:

- **Concurrency is free.** Three components mounting at once produce one
  request; `fetchQuery` shares the in-flight promise by key.
- **`useQuery` is a subscription; `fetchInto` is a snapshot.** A component that
  reads through `useQuery` repaints when anything invalidates its scope. One
  that reads through `fetchInto` (the imperative escape hatch, for Options API
  and hand-sequenced flows) copies into its own refs and will not. Prefer
  `useQuery`; every remaining `fetchInto` caller is a conversion candidate.

---

## 3. Write path

A write never re-calls the page loader, and never names a cache. It declares
what it invalidates next to the endpoint, and the mutation cache applies it.

```
  AddFunction.vue
        │  saveFunction.mutateAsync(payload)         ← knows nothing about caches
        ▼
  services/jstransform.queries.ts
        │  mutationOptions({
        │    mutationFn: (p) => jstransform.create(org, p),
        │    meta: { invalidates: [functionKeys.all(org)] },   ← the blast radius
        │  })
        ▼
  query/queryClient.ts   MutationCache.onSuccess
        │  reads mutation.meta, once, for every mutation in the app
        ▼
  every key under ["org", org, "functions", …] is now stale
        │
        ▼
  any MOUNTED useQuery on that scope refetches itself — no wiring at the call site
```

`meta` is typed by augmenting TanStack's `Register` interface, so `invalidates`
is checked rather than `any`. The fields:

| field            | effect                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| `invalidates`    | `invalidateQueries` per scope. Prefer a domain's `all` over a precise key |
| `removes`        | `removeQueries({ type: "inactive" })` — use after a delete               |
| `successMessage` | success toast, via the injected notifier                                |
| `silentError`    | suppress the default error toast when the call site renders its own      |

A mutation that declares no `meta` is left entirely alone.

---

## 4. Purge path

```
  ORG SWITCH  ── MainLayout.vue  changeOrganizationIdentifier(next, previous)
        │
        └─ purgeOrgQueries(previous)          ← query/queryClient.ts
              └─ purgePersistedOrg(previous)  ← query/persisters.ts
                    ├─ localStorage keys starting  o2q-["org","<prev>"
                    ├─ IndexedDB o2Cache keys      o2q-heavy-["org","<prev>"
                    ├─ IndexedDB o2Cache keys      panel|<prev>|…
                    └─ fieldValueDB.clearOrg(prev) → o2FieldValues  <prev>|…

        In-memory entries are deliberately KEPT — see inventory §1 "Lifecycle".
        So switching back is free in-session, but the disk copy is gone: a
        cache hit fetches nothing, so nothing re-persists until the next real
        fetch for that org.

  LOGOUT  ── stores/index.ts  logout action  (the single choke point for
        │                                     all 12 dispatch sites)
        └─ purgeAllQueries()
              ├─ queryClient.clear()
              └─ purgeAllPersisted()  → localStorage o2q-*  +  o2Cache  +
                                        fieldValueDB.clearAll()
```

---

## 5. The two consumption shapes

Both are legitimate; they differ in whether the caller is inside a `setup()`.

**(a) Reactive** — the target shape. The component renders from the query.

```ts
const org = useOrgId();
const { data, isPending, isFetching, refetch } = useQuery(() =>
  Object.assign(pipelinesQuery(org.value), { enabled: !!org.value }),
);
const rows = computed(() => data.value ?? []);
// isPending  → skeleton (nothing cached at all)
// isFetching → refresh spinner (a request with rows already on screen)
```

`Object.assign`, not a spread: `queryOptions()` brands its `queryKey` with the
result type, and copying into a fresh object literal drops the brand — the code
still compiles, `data` just silently degrades to `unknown`.

**(b) Imperative** — outside a `setup()` (route guards, Vuex actions), or where a
page hand-sequences the read against toasts:

```ts
// non-reactive read of the very same declaration
const rows = await queryClient.fetchQuery(pipelinesQuery(org));

// or, to drive refs a component already owns
await fetchInto(pipelinesQuery(org), {
  apply: (list) => (rows.value = list),
  loading,
  fetching,
  force, // refresh button, post-write reload
});
```

`fetchInto` writes a **snapshot** — an invalidation elsewhere will not repaint
it. Prefer `useQuery` wherever the component can host it.

---

## 6. Where a decision goes — quick reference

| Decision                                          | File                                                      |
| ------------------------------------------------- | --------------------------------------------------------- |
| "How long is this fresh?"                         | `query/cachePolicy.ts` — pick or add a constant           |
| "Where is it stored?"                             | the `persister` option; omit it for memory only           |
| "What identifies this read?"                      | the key factory in `services/<domain>.querykeys.ts`       |
| "Which endpoint, and how is the response shaped?" | the `queryOptions()` in `services/<domain>.queries.ts`    |
| "When does this page read it?"                    | the page — `enabled`, `force`, `refetchInterval`          |
| "What does this URL look like?"                   | `services/*.ts` — unchanged by caching                    |

New endpoint? The decision tree lives in
[api-cache-inventory.md](./api-cache-inventory.md#7-after-the-migration-completes--update-the-skills-and-rules).

---

## 7. Declaring a query — the layout as implemented

Three files per domain, all siblings in `services/`.

```ts
// services/saved_views.ts — transport only
const savedViews = {
  get: (org: string) => http().get(`/api/${org}/savedviews`),
};
export default savedViews;
```

```ts
// services/saved_views.querykeys.ts — identity, dependency-free
import { orgKey } from "@/composables/query/keys";

export const savedViewKeys = {
  all: (org: string) => orgKey(org, "search", "savedViews"), // the invalidation scope
  list: (org: string) => orgKey(org, "search", "savedViews"),
};
```

```ts
// services/saved_views.queries.ts — the declaration
import { queryOptions } from "@tanstack/vue-query";
import savedViews from "./saved_views";
import { savedViewKeys } from "./saved_views.querykeys";

export const savedViewsQuery = (org: string) =>
  queryOptions({
    queryKey: savedViewKeys.list(org),
    queryFn: async () => (await savedViews.get(org)).data?.views ?? [],
  });
```

Call sites use TanStack directly — there is no house vocabulary to learn:

```ts
useQuery(savedViewsQuery(org));                                   // reactive
await queryClient.fetchQuery(savedViewsQuery(org));               // cached read
await queryClient.fetchQuery({ ...savedViewsQuery(org), staleTime: 0 }); // force
queryClient.getQueryData(savedViewKeys.list(org));                // peek, no request
queryClient.invalidateQueries({ queryKey: savedViewKeys.all(org) });     // after a write
queryClient.removeQueries({ queryKey: savedViewKeys.all(org), type: "inactive" });
```

A read that is **not** org-scoped (`/config`, the license) uses `globalKey`
instead of `orgKey`: the key is rooted at `["org", GLOBAL_SCOPE, …]`, so the
logout purge still reaches it while the org-switch purge deliberately does not.

### The final file layout

```
composables/query/
  queryClient.ts   client, mutation-meta handling, purges
  keys.ts          orgKey / globalKey — the whole key convention
  cachePolicy.ts   the only file with staleTime/gcTime numbers
  persisters.ts    localStorage + IndexedDB adapters
  idbStorage.ts    shared IndexedDB primitive
  panelKey.ts      panel-result digest (a genuine special case)
  useOrgId.ts · useServerTable.ts · fetchInto.ts

services/
  <domain>.ts            transport
  <domain>.querykeys.ts  keys
  <domain>.queries.ts    queryOptions / mutationOptions
```

`stableFilters` and `quantizeRange` live in `queryClient.ts`; `ServerTableParams`
lives in `useServerTable.ts`.

### What this costs

- **Services are no longer dependency-free.** They import `queryClient`.
  `setupTests.ts` already imports the query layer for every spec, so no test
  pays a new import.
- **A spec can no longer replace a service module wholesale** — that would take
  the query exports with it, and stubbing around the service object would leave
  the query calling the real endpoint. Specs overlay their stubs onto the real
  module instead; see §8.
- **Cross-domain invalidation is explicit.** Three declarations in one domain
  each state `scope: ["alerts"]` — same behaviour as one central handle, the
  prefix written three times instead of once.

---

## 8. Testing implications

- The app's `queryClient` is a **module singleton**. `setupTests.ts` calls
  `queryClient.clear()` **and** `purgeAllPersisted()` in `afterEach` — `clear()`
  alone leaves localStorage entries that the next test restores from, silently
  skipping its service mock.
- The composables pass that client **explicitly** rather than relying on plugin
  injection, so component specs need no per-file setup.
- A spec that mounts a component and then wants a _different_ service response
  must force the reload (`getData(true)`) or invalidate first — otherwise the
  mount already warmed the cache and the new mock is never called.

### Mocking a service that declares queries

A query holds a direct reference to the service object, so replacing the module
wholesale takes the query exports with it and stubbing around the object leaves
the query calling the real endpoint. Overlay the stubs onto the real module
instead — `src/test/unit/helpers/mockService.ts`:

```ts
vi.mock("@/services/reports", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { listByFolderId: vi.fn() },
  });
});
```

Everything on an overlaid object is stubbed, not just what the factory names —
a method left real would reach the network. Three helpers cover the cases:

| Helper                              | For                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `overlayServiceMock(actual, stubs)` | the normal `vi.mock` factory                                                                                                                                                         |
| `automockService(actual)`           | the bare `vi.mock("@/services/x")` automock, queries left real                                                                                                                       |
| `queryStub(fetch, map?)`            | services whose endpoints are **bare function exports** (`@/services/iam`) — those cannot be intercepted from outside the module, so the query is pointed back at the spec's own stub |

- The query layer defers its fetch a microtask. A spec that captures a resolver
  from inside a mock must flush a tick before asserting on what follows.
