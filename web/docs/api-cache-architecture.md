# API Cache Architecture — the call flow

**Companion to** [api-caching-audit.md](./api-caching-audit.md) (the design) and
[api-cache-inventory.md](./api-cache-inventory.md) (what is cached where).

This document answers one question: **a component needs data — which file does it
call, what happens next, and where does the payload end up?**

---

## 1. The layers, and what each one owns

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

## 3. Write path

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

| Decision | File |
|---|---|
| "How long is this fresh?" | `query/tiers.ts` — pick or add a tier |
| "Where is it stored?" | implied by the tier; override with `persist: "none"` in the binding |
| "What identifies this read?" | `query/queryKeys.ts` |
| "Which endpoint, and how is the response shaped?" | `query/queries/<domain>.ts` |
| "When does this page read it?" | the page — `enabled`, `force`, `refetchInterval` |
| "What does this URL look like?" | `services/*.ts` — unchanged by caching |

New endpoint? The decision tree lives in
[api-cache-inventory.md](./api-cache-inventory.md#7-after-the-migration-completes--update-the-skills-and-rules).

---

## 7. Testing implications

- The app's `queryClient` is a **module singleton**. `setupTests.ts` calls
  `queryClient.clear()` **and** `purgeAllPersisted()` in `afterEach` — `clear()`
  alone leaves localStorage entries that the next test restores from, silently
  skipping its service mock.
- The composables pass that client **explicitly** rather than relying on plugin
  injection, so component specs need no per-file setup.
- A spec that mounts a component and then wants a *different* service response
  must force the reload (`getData(true)`) or invalidate first — otherwise the
  mount already warmed the cache and the new mock is never called.
