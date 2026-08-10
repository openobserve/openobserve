# API Cache Architecture — the call flow

**Companion to** [api-caching-audit.md](./api-caching-audit.md) (the design) and
[api-cache-inventory.md](./api-cache-inventory.md) (what is cached where).

This document answers one question: **a component needs data — which file does it
call, what happens next, and where does the payload end up?**

---

## 1. The layers, and what each one owns

Layered by rate of change. Each decision has exactly one home.

| #   | Layer             | File(s)                                                          | Owns                                                                             |
| --- | ----------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 6   | Page / component  | `views/…`, `components/…`                                        | _when_ to read: `enabled`, the folder id, the `force` flag, `refetchInterval`    |
| 5   | Consumption shape | `<x>Query.get/refresh/use` · `useServerTable` · `useOrgMutation` | _how_ a page consumes — reactive or imperative                                   |
| 4   | Per-API binding   | `defineQuery` in `services/<domain>.ts`                          | key + fetch + tier + any `persist` override; the key derives identity            |
| 3   | Storage adapters  | `query/persisters.ts` · `query/idbStorage.ts`                    | localStorage / IndexedDB mechanics                                               |
| 2   | **Policy**        | `query/tiers.ts`                                                 | `staleTime`, `gcTime`, `persist`, focus-refetch — **the only file with numbers** |
| 1   | Transport         | `services/*.ts` → `services/http.ts`                             | URLs, auth, 401 refresh, 403 grouping                                            |

Layers 1 and 4 share a file on purpose: a cached read is declared directly
beside the endpoint it calls, so adding one means editing one file.

**The rule that follows from this: a page picks a _tier_, never a number.**
`staleTime: 60000` at a call site is a review rejection — if no tier fits, extend
`tiers.ts`.

The URL builders themselves were **not modified** by the caching work — they are
still thin wrappers returning axios promises. What the caching work added to a
service file is a `defineQuery` declaration per cached read, below the builders.

---

## 2. Read path — worked example

The sidebar folder list, traced through every file it touches.

```
  src/components/common/sidebar/FolderList.vue
        │  await getFoldersListByType(store, props.type)
        ▼
  src/utils/commons.ts                                     ← legacy entry point,
        │  fetchFoldersByType(org, type)                      kept so ~10 call
        │  …then dispatches setFoldersByType (Vuex bridge)    sites need no edit
        ▼
  src/services/common.ts                                   ← LAYER 4: the binding
        │  foldersQuery = defineQuery({
        │    key:   (type) => ["folders", type],           ← identity, rooted at
        │                                                     ["org", org, …]
        │    fetch: (org, type) => common.list_Folders(…),
        │    tier:  "ORG_CONFIG",                          ← LAYER 2: policy
        │  })
        ▼
  @tanstack/query-core  (via src/composables/query/queryClient.ts)
        │
        ├── data in memory and fresh (< 5 min)? ──────────► return it. 0 requests.
        │
        ├── nothing in memory, but persisted?
        │     └─ persisters.ts reads
        │        localStorage["o2q-[\"org\",\"acme\",\"folders\",\"dashboards\"]"]
        │        └─► hydrate, return; refetch in the background only if stale
        │
        └── miss, or stale ──► run queryFn
              │
              ▼
        src/services/common.ts     list_Folders(org, type)  ← LAYER 1, same file
              │
              ▼
        src/services/http.ts       axios + 401 refresh + 403 grouping
              │
              ▼
        GET /api/v2/{org}/folders/{type}
              │
              ▼
        result stored in memory, and — because ORG_CONFIG persists —
        written to localStorage by the persister
```

Two consequences worth internalising:

- **Concurrency is free.** Three components mounting at once produce one
  request; `fetchQuery` shares the in-flight promise by key.
- **The Vuex dispatch is a bridge, not a cache.** It exists so components that
  still read `organizationData.foldersByType` keep working. It is deleted along
  with the last such consumer.

---

## 3. Write path

A write never re-calls the page loader. It invalidates a **prefix**, and the
next read goes to the server.

```
  AddFunction.vue
        │  jsTransformService.create(org, payload)      ← LAYER 1, unchanged
        │
        │  functionsQuery.invalidate(org)
        ▼
  services/jstransform.ts
        │  invalidateQueries({ queryKey: ["org", org, ...scope] })
        ▼
  every key under ["org", org, "functions", …] is now stale
        │
        ▼
  the next functionsQuery.get(org) — from anywhere — hits the server
```

Prefix, not exact key, on purpose: the declaration's `scope` (defaulting to the
first key segment) also covers the enrichment-tables list and any future
variant. A precise-key invalidate is a bug waiting for the next key to be added.

For deletes, `useOrgMutation`'s `removes` additionally calls `removeQueries({
type: "inactive" })` — invalidation alone leaves the deleted entity's detail
query cached and ready to serve the next reader.

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
const { data: rows, isPending, isFetching } = pipelinesQuery.use(() => []);
// isPending → skeleton (no cached data at all)
// isFetching → subtle background-refresh indicator
```

**(b) Imperative** — for loaders that are not in a `setup()`, or whose page owns
its own `loading` ref.

```ts
const getData = async (force = false) => {
  if (force) {
    loading.value = true;
    rows.value = await pipelinesQuery.refresh(org); // bypasses staleTime
    return;
  }
  // Stale-while-revalidate: cached rows stay on screen while the refetch runs.
  const { cached, fresh } = pipelinesQuery.swr(org);
  if (cached) rows.value = cached;
  else loading.value = true;
  rows.value = await fresh;
  loading.value = false;
};
```

**`get()` waits; `swr()` does not.** `get()` on a _stale_ entry blocks on the
network — the cached value is still in the cache, but a loader that flips
`loading` around it blanks the list and spins until the response lands. `swr()`
hands the cached value back first and revalidates behind it. Use `get()` when
the caller genuinely needs one settled value (a route guard, a write path);
use `swr()` for anything that paints a list.

`swr()` starts the refetch eagerly, so never call it just to peek at `cached` —
that fires a request. Call it once and use both halves.
`swr()` starts its refetch eagerly. When a loader's response handler has side
effects and so cannot be run twice — it opens a dialog, fires a second request —
use `peek()` instead: it reads the cache without fetching, so the page can skip
the spinner while still reading once.

**Current state is a deliberate hybrid.** Most migrated pages use (b), because
converting each page's data flow to (a) carried more regression risk than the
caching itself. Policy is fully centralised in `tiers.ts`; consumption is not yet
uniform. Converting the imperative pages to (a) is a follow-up that changes no
policy and no keys.

### The `force` convention

Only three things pass `force = true`: an explicit **Refresh** button, a
**post-write reload**, and an explicit **user-initiated search**. Mount and
route-change reads stay cached.

```ts
// WRONG — the DOM event object lands in `force`, so this always refetches
<OButton @click="getData" />

// RIGHT — a named handler makes the intent explicit
const refreshData = () => getData(true);
<OButton @click="refreshData" />
```

---

## 6. Where a decision goes — quick reference

| Decision                                          | File                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| "How long is this fresh?"                         | `query/tiers.ts` — pick or add a tier                             |
| "Where is it stored?"                             | implied by the tier; override with `persist: "none"` on the query |
| "What identifies this read?"                      | the `key` of its `defineQuery`, in `services/<domain>.ts`         |
| "Which endpoint, and how is the response shaped?" | the same `defineQuery`'s `fetch`                                  |
| "When does this page read it?"                    | the page — `enabled`, `force`, `refetchInterval`                  |
| "What does this URL look like?"                   | `services/*.ts` — unchanged by caching                            |

New endpoint? The decision tree lives in
[api-cache-inventory.md](./api-cache-inventory.md#7-after-the-migration-completes--update-the-skills-and-rules).

---

## 7. Declaring a query — the layout as implemented

Every cached read is one `defineQuery` in the service file that owns the URL.
There is no `queries/` folder and no central key registry: the key is derived
from the declaration, and `scope` **is** the invalidation prefix.

```ts
// services/saved_views.ts
import http from "./http";
import { defineQuery } from "@/composables/query/queryClient";

const savedViews = {
  get: (org: string) => http().get(`/api/${org}/savedviews`),
  post: (org: string, body: unknown) => http().post(`/api/${org}/savedviews`, body),
};
export default savedViews;

export const savedViewsQuery = defineQuery({
  key: ["search", "savedViews"], // → ["org", <org>, "search", "savedViews"]
  fetch: async (org) => (await savedViews.get(org)).data?.views ?? [],
  tier: "ENTITY_LIST",
});
```

Call sites read the same everywhere:

```ts
await savedViewsQuery.get(org); // cached
await savedViewsQuery.refresh(org); // bypasses staleTime — refresh button, post-write
savedViewsQuery.invalidate(org); // after a write
```

Parameterised keys are a function of the same arguments `fetch` takes after the
org:

```ts
export const foldersQuery = defineQuery({
  key: (type: string) => ["folders", type],
  fetch: async (org, type: string) => normalize((await common.list_Folders(org, type)).data.list),
  tier: "ORG_CONFIG",
  scope: ["folders"], // what invalidate() drops — defaults to key[0]
});
```

### What a query exposes

| Member                | Use                                                                                |
| --------------------- | ---------------------------------------------------------------------------------- |
| `get(org, …)`         | cached read — no request while fresh                                               |
| `refresh(org, …)`     | bypasses `staleTime`: refresh button, post-write reload, explicit search           |
| `swr(org, …)`         | `{ cached, fresh }` — paint the cached value now, swap when the refetch lands      |
| `peek(org, …)`        | the cached value or undefined — **no request**; for handlers that cannot run twice |
| `invalidate(org)`     | after a write; drops the whole `scope`                                             |
| `remove(org)`         | after a delete; drops inactive entries outright                                    |
| `prime(org, data, …)` | seed a value the caller already applied optimistically                             |
| `use(argsFn, opts)`   | reactive form for a `setup()` that wants `isPending` / `isFetching`                |
| `prefetch(org, …)`    | warm an entry without rendering it                                                 |
| `options` / `key`     | the raw pieces, for one-off client calls                                           |

`defineGlobalQuery` is the same declaration for a read that is **not**
org-scoped — `/config`, the license. Its members drop the `org` argument; the key
is rooted at `["org", GLOBAL_SCOPE, …]` so the logout purge still reaches it
while the org-switch purge deliberately does not.

### The final file layout

```
composables/query/
  queryClient.ts   client, purges, defineQuery/defineGlobalQuery, key helpers
  tiers.ts         the only file with staleTime/gcTime numbers
  persisters.ts    localStorage + IndexedDB adapters
  idbStorage.ts    shared IndexedDB primitive
  panelKey.ts      panel-result digest (a genuine special case)
  useOrgId.ts · useServerTable.ts · useOrgMutation.ts
```

`stableFilters`, `quantizeRange` and `GLOBAL_SCOPE` live in `queryClient.ts`;
`ServerTableParams` lives in `useServerTable.ts`.

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
