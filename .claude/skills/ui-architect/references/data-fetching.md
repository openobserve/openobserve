# Data Fetching & Caching

Every cached read is a `defineQuery` declared in the service file that owns the
URL. `web/src/composables/query/` holds the client, the tiers and the storage
adapters — not a per-endpoint module per domain.

What is cached where, and what is deliberately not, is in
[data-fetching-inventory.md](data-fetching-inventory.md).

---

## Rules

### The one rule

**A page picks a tier, never a number.** `staleTime: 60000` at a call site is a
review rejection. If no tier fits, extend `tiers.ts` — do not inline.

---

### Where each decision lives

| Decision                               | File                                                    |
| -------------------------------------- | ------------------------------------------------------- |
| "How long is this fresh?"              | `query/tiers.ts` — the only file with numbers           |
| "Where is it stored?"                  | implied by the tier; override with `persist: "none"`    |
| "What identifies this read?"           | the `key` of its `defineQuery` — never an inline array  |
| "Which endpoint, what response shape?" | the same `defineQuery`, in `services/<domain>.ts`       |
| "When does this page read it?"         | the page — `enabled`, `force`, `refetchInterval`        |
| "What is the URL?"                     | `services/*.ts` — the builders are untouched by caching |

### Tiers and their storage

| Tier             | staleTime | Storage      | Use for                                   |
| ---------------- | --------- | ------------ | ----------------------------------------- |
| `SESSION_STATIC` | ∞         | localStorage | immutable for the session                 |
| `ORG_CONFIG`     | 5 min     | localStorage | streams, folders, functions, destinations |
| `ENTITY_LIST`    | 30 s      | memory       | lists of entities                         |
| `ENTITY_DETAIL`  | 30 s      | memory       | one entity, opened in an editor           |
| `VOLATILE`       | 0         | memory       | operational state you poll                |
| `HEAVY_RESULT`   | 0         | IndexedDB    | panel results, DAGs, field values         |

---

### Adding a new endpoint

```
├─ Not a GET, or streaming, or a single-use URL? ──► no cache. useOrgMutation for writes.
└─ GET, reused across surfaces or visits?
   ├─ Immutable for the session?        ──► SESSION_STATIC   localStorage
   ├─ Org configuration?                ──► ORG_CONFIG       localStorage
   ├─ A list of entities?               ──► ENTITY_LIST      memory
   ├─ One entity?                       ──► ENTITY_DETAIL    memory
   ├─ Operational state you poll?       ──► VOLATILE         memory + refetchInterval
   └─ Large result payload?             ──► HEAVY_RESULT     IndexedDB
        │
        └─ then, regardless of tier:
           carries a token, key or passcode? ──yes──► persist: "none"
```

**Verify the tier against the payload, not the endpoint name.** Two proposals in
the inventory were wrong for exactly this reason: `/api/license` sounds static
but carries live usage counters, and the node list sounds like config but is
cluster state that must not be served from disk.

### The template

```ts
// services/<domain>.ts — below the URL builders it calls
import { defineQuery } from "@/composables/query/queryClient";

export const thingQuery = defineQuery<[], Thing[]>({
  key: ["things", "list"], // → ["org", <org>, "things", "list"]
  fetch: async (org) => (await thingService.list(org)).data?.list ?? [],
  tier: "ENTITY_LIST",
  persist: "none", // only if it carries a secret
});
```

A parameterised key is a function of the same arguments `fetch` takes after the
org, and states its `scope` so siblings in the domain invalidate together:

```ts
export const thingDetailQuery = defineQuery<[id: string], Thing>({
  key: (id) => ["things", "detail", id],
  fetch: async (org, id) => (await thingService.get(org, id)).data ?? null,
  tier: "ENTITY_DETAIL",
  scope: ["things"],
});
```

Use `defineGlobalQuery` for a read that is **not** org-scoped (`/config`, the
license): same declaration, no `org` argument at the call site.

---

### Rules that are easy to get wrong

1. **`fetchQuery`, not `ensureQueryData`.** The latter returns cached data even
   after `invalidateQueries` — it only fetches when there is _no_ data.
2. **Invalidate by prefix, never re-call the page loader.** `invalidate(org)`
   drops the declaration's whole `scope`, not the exact key: a precise
   invalidate is a bug waiting for the next key variant.
3. **The `force` convention.** Loaders are `getX(force = false)`. Mount and
   route-change reads stay cached; a **Refresh** button, a **post-write reload**
   and an **explicit user search** pass `true`.
4. **Never bind a loader straight to a template event.**
   ```vue
   <!-- WRONG: the DOM event object lands in `force` -->
   <OButton @click="getData" />
   <!-- RIGHT -->
   <OButton @click="refreshData" />
   <!-- const refreshData = () => getData(true) -->
   ```
5. **Return the promise from a loader.** `await getData()` must actually wait —
   several loaders silently did not, which only worked while the fetch resolved
   in a single microtask.
6. **A query result may not be `undefined`.** Use `?? null` in the queryFn.
7. **Match the service's export shape** — some are default exports, some named
   (`annotationService`). A wrong import is `undefined` at runtime, not a
   compile error.
8. **A spec cannot replace a query-carrying service module wholesale.** Overlay
   the stubs onto the real module — see "Testing" at the end.

### Before you put a list on `swr()`

Two things make a second paint unsafe. Check both:

1. **Side effects in the response handler** — opening a dialog, firing a second
   request, minting a row id. Split the pure row mapping out and leave the
   effects on the fresh pass. If it cannot be split, use `peek()` to skip the
   spinner instead and accept that a cold surface waits.
2. **Unstable row identity** — a row keyed by `getUUID()` cannot be painted
   twice; the second paint renames every row. Derive the identity from the
   entity first.

Which screens paint from cache today, which do not and why, is in
`data-fetching-inventory.md` under "Listing surfaces".

### Never cache

Ad-hoc search (`search.search`, `_around`, partitions, WS), AI chat streams,
single-use URLs and page tokens, and **any GET that mutates** (billing's
`unsubscribe` / `resume_subscription`).

Also uncached on purpose, with reasons in inventory §3i:
`dashboards.get_Dashboard` (its `hash` drives optimistic-concurrency saves) and
read-modify-write reads such as `WorkflowLinkAlertsDialog`.

### Never persist

Ingestion tokens, org passcode, cipher key material, RUM tokens,
service-account tokens, synthetics agent tokens. Pin `persist: "none"` **on the
query**, not by relying on its tier — the override has to survive someone
re-tiering the file later.

---

## Lifecycle — what survives what

Every key is rooted at `["org", id]`, which is what makes both events safe.

| Event          | Memory   | localStorage / IndexedDB                |
| -------------- | -------- | --------------------------------------- |
| **Org switch** | **kept** | **purged** for the org being left       |
| **Logout**     | cleared  | purged entirely (incl. `o2FieldValues`) |

Memory is kept across an org switch on purpose: one org's data can never be
served to another, and `gcTime` collects it anyway, so switching back to a
recent org inside its `staleTime` costs no requests at all. Disk is purged
because it is a different budget — localStorage is ~5 MB shared with the whole
app, and the previous tenant's stream, folder and function names should not sit
on a possibly shared machine.

Consequence: switching back is free **in-session only**. The disk copy was
purged on the way out and a cache hit fetches nothing, so nothing re-persists
until that org next fetches for real.

Implemented in `purgeOrgQueries` / `purgeAllQueries` (`query/queryClient.ts`).

---

## Architecture — the call flow

### The layers, and what each one owns

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

### Read path — worked example

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

### Write path

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

### Purge path

```
  ORG SWITCH  ── MainLayout.vue  changeOrganizationIdentifier(next, previous)
        │
        └─ purgeOrgQueries(previous)          ← query/queryClient.ts
              └─ purgePersistedOrg(previous)  ← query/persisters.ts
                    ├─ localStorage keys starting  o2q-["org","<prev>"
                    ├─ IndexedDB o2Cache keys      o2q-heavy-["org","<prev>"
                    ├─ IndexedDB o2Cache keys      panel|<prev>|…
                    └─ fieldValueDB.clearOrg(prev) → o2FieldValues  <prev>|…

        In-memory entries are deliberately KEPT — see "Lifecycle" above.
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

### The two consumption shapes

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

#### The `force` convention

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

### Where a decision goes — quick reference

| Decision                                          | File                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| "How long is this fresh?"                         | `query/tiers.ts` — pick or add a tier                             |
| "Where is it stored?"                             | implied by the tier; override with `persist: "none"` on the query |
| "What identifies this read?"                      | the `key` of its `defineQuery`, in `services/<domain>.ts`         |
| "Which endpoint, and how is the response shaped?" | the same `defineQuery`'s `fetch`                                  |
| "When does this page read it?"                    | the page — `enabled`, `force`, `refetchInterval`                  |
| "What does this URL look like?"                   | `services/*.ts` — unchanged by caching                            |

New endpoint? The decision tree is in the "Adding a new endpoint" section
above.

---

### Declaring a query — the layout as implemented

Every cached read is one `defineQuery` in the service file that owns the URL.
There is no `queries/` folder and no central key registry: the key is derived
from the declaration, and `scope` **is** the invalidation prefix.

```ts
// services/saved_views.ts
import http from "./http";
import { defineQuery } from "@/composables/query/queryClient";

const savedViews = {
  get: (org: string) => http().get(`/api/${org}/savedviews`),
  post: (org: string, body: unknown) =>
    http().post(`/api/${org}/savedviews`, body),
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
  fetch: async (org, type: string) =>
    normalize((await common.list_Folders(org, type)).data.list),
  tier: "ORG_CONFIG",
  scope: ["folders"], // what invalidate() drops — defaults to key[0]
});
```

#### What a query exposes

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

#### The final file layout

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

#### What this costs

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

### Testing implications

- The app's `queryClient` is a **module singleton**. `setupTests.ts` calls
  `queryClient.clear()` **and** `purgeAllPersisted()` in `afterEach` — `clear()`
  alone leaves localStorage entries that the next test restores from, silently
  skipping its service mock.
- The composables pass that client **explicitly** rather than relying on plugin
  injection, so component specs need no per-file setup.
- A spec that mounts a component and then wants a _different_ service response
  must force the reload (`getData(true)`) or invalidate first — otherwise the
  mount already warmed the cache and the new mock is never called.

#### Mocking a service that declares queries

A query holds a direct reference to the service object, so replacing the module
wholesale takes the query exports with it and stubbing around the object leaves
the query calling the real endpoint. Overlay the stubs onto the real module
instead — `src/test/unit/helpers/mockService.ts`:

```ts
vi.mock("@/services/reports", async (importOriginal) => {
  const { overlayServiceMock } =
    await import("@/test/unit/helpers/mockService");
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

---

## Before you push

`npm run lint` and `npm run format:check` are **different gates**. ESLint's
prettier rule does not cover everything CI checks, so a scripted or bulk edit
can pass lint and still fail `format:check`. Run both, plus `type-check`.

## Testing

- `setupTests.ts` already clears the query client **and** purges persisted
  storage between tests. Do not duplicate it.
- A spec that mounts a component and then wants a **different** service response
  must clear the cache or force the reload — the mount already warmed it, so the
  new mock never runs.
  ```ts
  vi.mocked(service.list).mockResolvedValue({ data: [] });
  queryClient.clear(); // ← without this the override is ignored
  await wrapper.vm.getData();
  ```
- The query layer defers the queryFn to a microtask. A spec that captures a
  resolver from inside a mock must flush a tick before resolving it.
- Component specs need no per-file plugin setup: the composables pass the app's
  `queryClient` explicitly.
- **Never replace a query-carrying service module wholesale** — that takes the
  query exports with it, and stubbing around the service object leaves the query
  calling the real endpoint. Overlay onto the real module instead:
  ```ts
  vi.mock("@/services/reports", async (importOriginal) => {
    const { overlayServiceMock } =
      await import("@/test/unit/helpers/mockService");
    return overlayServiceMock(await importOriginal(), {
      default: { listByFolderId: vi.fn() },
    });
  });
  ```
  Everything on an overlaid object is stubbed, not just what the factory names.
  `automockService(actual)` is the bare-automock equivalent, and `queryStub` is
  for services whose endpoints are **bare function exports** (`@/services/iam`)
  — those cannot be intercepted from outside the module, so the query is pointed
  back at the spec's own stub.
