# Data Fetching & Caching

Every read goes through `web/src/composables/query/`. Services are unchanged —
they are still thin URL builders returning axios promises; queries wrap them.

What is cached where, and what is deliberately not, is in
[data-fetching-inventory.md](data-fetching-inventory.md).

---

## Rules

### The one rule

**A page picks a tier, never a number.** `staleTime: 60000` at a call site is a
review rejection. If no tier fits, extend `tiers.ts` — do not inline.

---

### Where each decision lives

| Decision | File |
|---|---|
| "How long is this fresh?" | `query/tiers.ts` — the only file with numbers |
| "Where is it stored?" | implied by the tier; override with `persist: "none"` |
| "What identifies this read?" | `query/queryKeys.ts` — never an inline array |
| "Which endpoint, what response shape?" | `query/queries/<domain>.ts` |
| "When does this page read it?" | the page — `enabled`, `force`, `refetchInterval` |
| "What is the URL?" | `services/*.ts` — untouched by caching |

### Tiers and their storage

| Tier | staleTime | Storage | Use for |
|---|---|---|---|
| `SESSION_STATIC` | ∞ | localStorage | immutable for the session |
| `ORG_CONFIG` | 5 min | localStorage | streams, folders, functions, destinations |
| `ENTITY_LIST` | 30 s | memory | lists of entities |
| `ENTITY_DETAIL` | 30 s | memory | one entity, opened in an editor |
| `VOLATILE` | 0 | memory | operational state you poll |
| `HEAVY_RESULT` | 0 | IndexedDB | panel results, DAGs, field values |

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
// composables/query/queries/<domain>.ts
export const thingQuery = createOrgListQuery<Thing>({
  key:     (org) => qk.things.list(org),       // from queryKeys.ts
  fetch:   async (org) => (await thingService.list(org)).data?.list ?? [],
  tier:    "ENTITY_LIST",
  persist: "none",                              // only if it carries a secret
});
```

Detail reads use `createDetailQuery`. One query module per **domain** — never a
barrel importing many services: a spec that mocks one service would drag in all
the others and fail at import time.

---

### Rules that are easy to get wrong

1. **`fetchQuery`, not `ensureQueryData`.** The latter returns cached data even
   after `invalidateQueries` — it only fetches when there is *no* data.
2. **Invalidate by prefix, never re-call the page loader.**
   `qk.things.root(org)`, not the exact key: a precise invalidate is a bug
   waiting for the next key variant.
3. **The `force` convention.** Loaders are `getX(force = false)`. Mount and
   route-change reads stay cached; a **Refresh** button, a **post-write reload**
   and an **explicit user search** pass `true`.
4. **Never bind a loader straight to a template event.**
   ```vue
   <!-- WRONG: the DOM event object lands in `force` -->
   <OButton @click="getData" />
   <!-- RIGHT -->
   <OButton @click="refreshData" />   <!-- const refreshData = () => getData(true) -->
   ```
5. **Return the promise from a loader.** `await getData()` must actually wait —
   several loaders silently did not, which only worked while the fetch resolved
   in a single microtask.
6. **A query result may not be `undefined`.** Use `?? null` in the queryFn.
7. **Match the service's export shape** — some are default exports, some named
   (`annotationService`). A wrong import is `undefined` at runtime, not a
   compile error.

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

| Event | Memory | localStorage / IndexedDB |
|---|---|---|
| **Org switch** | **kept** | **purged** for the org being left |
| **Logout** | cleared | purged entirely (incl. `o2FieldValues`) |

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

| # | Layer | File(s) | Owns |
|---|---|---|---|
| 7 | Page / component | `views/…`, `components/…` | *when* to read: `enabled`, the folder id, the `force` flag, `refetchInterval` |
| 6 | Consumption shape | `useOrgQuery` · `useServerTable` · `useOrgMutation` · `createOrgListQuery` | *how* a page consumes — reactive or imperative |
| 5 | Per-API binding | `query/queries/<domain>.ts` | key + fetch + tier + any `persist` override |
| 4 | Storage adapters | `query/persisters.ts` · `query/idbStorage.ts` | localStorage / IndexedDB mechanics |
| 3 | **Policy** | `query/tiers.ts` | `staleTime`, `gcTime`, `persist`, focus-refetch — **the only file with numbers** |
| 2 | Identity | `query/queryKeys.ts` | the key factory; every key rooted at `["org", id]` |
| 1 | Transport | `services/*.ts` → `services/http.ts` | URLs, auth, 401 refresh, 403 grouping |

**The rule that follows from this: a page picks a *tier*, never a number.**
`staleTime: 60000` at a call site is a review rejection — if no tier fits, extend
`tiers.ts`.

Layer 1 was **not modified** by the caching work. Services are still thin URL
builders returning axios promises; queries wrap them.

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
  src/composables/query/queries/folders.ts                 ← LAYER 5: the binding
        │  queryClient.fetchQuery({
        │    queryKey: qk.folders.byType(org, type),       ← LAYER 2: identity
        │    queryFn:  () => commonService.list_Folders(…),
        │    ...tierOptions("ORG_CONFIG"),                 ← LAYER 3: policy
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
        src/services/common.ts     list_Folders(org, type)  ← LAYER 1
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
        │  invalidateFunctions(org)
        ▼
  query/queries/functions.ts
        │  queryClient.invalidateQueries({ queryKey: qk.functions.root(org) })
        ▼
  every key under ["org", org, "functions", …] is now stale
        │
        ▼
  the next fetchFunctions(org) — from anywhere — hits the server
```

Prefix, not exact key, on purpose: `qk.functions.root(org)` also covers the
enrichment-tables list and any future variant. A precise-key invalidate is a bug
waiting for the next key to be added.

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

        In-memory entries are deliberately KEPT — see "Lifecycle" below.
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
const { data: rows, isPending, isFetching } = pipelinesQuery.useList();
// isPending → skeleton (no cached data at all)
// isFetching → subtle background-refresh indicator
```

**(b) Imperative** — for loaders that are not in a `setup()`, or whose page owns
its own `loading` ref.

```ts
const getData = async (force = false) => {
  loading.value = true;
  rows.value = force
    ? await pipelinesQuery.refetchList(org)   // bypasses staleTime
    : await pipelinesQuery.fetchList(org);    // cache hit if fresh
  loading.value = false;
};
```

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

| Decision | File |
|---|---|
| "How long is this fresh?" | `query/tiers.ts` — pick or add a tier |
| "Where is it stored?" | implied by the tier; override with `persist: "none"` in the binding |
| "What identifies this read?" | `query/queryKeys.ts` |
| "Which endpoint, and how is the response shaped?" | `query/queries/<domain>.ts` |
| "When does this page read it?" | the page — `enabled`, `force`, `refetchInterval` |
| "What does this URL look like?" | `services/*.ts` — unchanged by caching |

New endpoint? The decision tree is in the "Adding a new endpoint" section
above.

---


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
  queryClient.clear();          // ← without this the override is ignored
  await wrapper.vm.getData();
  ```
- The query layer defers the queryFn to a microtask. A spec that captures a
  resolver from inside a mock must flush a tick before resolving it.
- Component specs need no per-file plugin setup: the composables pass the app's
  `queryClient` explicitly.
