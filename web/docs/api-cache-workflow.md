# How a request travels — frontend to backend, and where the cache sits

**Companion to** [api-cache-architecture.md](./api-cache-architecture.md) (what
each layer owns) and [api-cache-inventory.md](./api-cache-inventory.md) (what is
cached, and what is not).

This document follows one read all the way down and all the way back, then does
the same for a write, a delete, and a logout. If you want to know _where your
data comes from_ — or why a screen showed something stale — start here.

---

## 1. The whole path

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 1  COMPONENT                       views/… · components/…              │
  │    A loader decides WHEN to read, and with what arguments.             │
  │      const { cached, fresh } = pipelinesQuery.swr(org)                 │
  └───────────────────────────────┬────────────────────────────────────────┘
                                  │
  ┌───────────────────────────────▼────────────────────────────────────────┐
  │ 2  QUERY DECLARATION               services/<domain>.ts                │
  │    defineQuery binds four things to one endpoint:                      │
  │      key    → identity     ["org", org, "pipelines", "list"]           │
  │      fetch  → how to call it and how to shape the response             │
  │      staleTime / persister → TanStack options, defaulted by the client │
  │      scope  → what a write invalidates                                 │
  └───────────────────────────────┬────────────────────────────────────────┘
                                  │
  ┌───────────────────────────────▼────────────────────────────────────────┐
  │ 3  CACHE                           @tanstack/query-core                │
  │    Looks the key up and takes ONE of three branches (§3).              │
  │    In-memory Map, plus an optional disk copy via the persister.        │
  └───────────────────────────────┬────────────────────────────────────────┘
                                  │  only on miss or stale
  ┌───────────────────────────────▼────────────────────────────────────────┐
  │ 4  SERVICE (URL builder)           services/<domain>.ts                │
  │    Same file as step 2, above the declaration. Builds the path.        │
  │      http().get(`/api/${org}/pipelines`)                               │
  └───────────────────────────────┬────────────────────────────────────────┘
                                  │
  ┌───────────────────────────────▼────────────────────────────────────────┐
  │ 5  TRANSPORT                       services/http.ts                    │
  │    axios instance: baseURL = store.state.API_ENDPOINT,                 │
  │    withCredentials: true. Response interceptor handles 401 / 403.      │
  └───────────────────────────────┬────────────────────────────────────────┘
                                  │  HTTP
  ┌───────────────────────────────▼────────────────────────────────────────┐
  │ 6  BACKEND                                                             │
  │    GET {API_ENDPOINT}/api/{org}/pipelines                              │
  └────────────────────────────────────────────────────────────────────────┘
```

The response returns up the same path. Step 3 stores it — in memory always, on
disk if the declaration names a persister — and step 2's `fetch` shapes it before anyone sees
it, so the component never handles a raw axios response.

**Steps 2 and 4 are the same file on purpose.** A cached read is declared
directly beneath the URL it calls, so adding an endpoint means editing one file.

---

## 2. What each hop actually does

### 1 · Component — _when_ to read

The only decision here is timing. Mount, route change, folder switch, refresh
button, poll tick. The loader picks a **member**, and the member encodes intent:

| Member      | Intent                                                       |
| ----------- | ------------------------------------------------------------ |
| `get()`     | I need one settled value (route guard, write path)           |
| `swr()`     | I am painting a list — give me what you have, then the truth |
| `refresh()` | The user asked, or I just wrote — go to the server           |
| `peek()`    | Is there anything to show? (no request)                      |

### 2 · Declaration — _what_ the read is

```ts
export const pipelinesQuery = defineQuery<[], Pipeline[]>({
  key: ["pipelines", "list"],
  fetch: async (org) => (await pipelines.getPipelines(org)).data?.list ?? [],
  scope: ["pipelines"],
});
```

`key` is prefixed with `["org", orgId]` by `defineQuery` — every key in the app
is org-rooted, which is what makes the purges in §6 possible and what stops one
tenant's data ever being served to another.

### 3 · Cache — _whether to ask at all_

A declaration passes TanStack's own `staleTime`, `gcTime` and `persister`
options straight through. Most say nothing and inherit the client's
`DEFAULT_STALE_TIME`; the few that differ name a constant from
`query/cachePolicy.ts`, the only file in the codebase with durations in it.

| Read                            | `staleTime`                 | `persister`             |
| ------------------------------- | --------------------------- | ----------------------- |
| anything not listed below       | client default (30 s)       | —                       |
| org config: streams, folders, … | `CONFIG_STALE_TIME` (5 min) | `localStoragePersister` |
| immutable for the session       | `SESSION_STALE_TIME`        | `localStoragePersister` |
| operational state you poll      | `0`                         | —                       |
| heavy result payloads           | `0`                         | `indexedDbPersister`    |

Disk keys are the query key, prefixed: `o2q-["org","acme","folders",…]` in
localStorage, `o2q-heavy-…` in IndexedDB. Entries expire after a day, and
`PERSIST_BUSTER` in `query/persisters.ts` invalidates every persisted entry at
once when a payload shape changes.

### 4 · Service — _which URL_

Untouched by the caching work. Thin wrappers returning axios promises.

### 5 · Transport — _auth and failure_

`http()` builds an axios instance per call with `baseURL` from
`store.state.API_ENDPOINT` and `withCredentials: true`, then installs one
response interceptor:

- **401, SSO enterprise** → `attemptTokenRefresh()`. A module-level
  `refreshPromise` means concurrent 401s share **one** `/config/dex_refresh`,
  and each original request is retried once after it resolves. If the refresh
  fails, it logs out and reloads.
- **401, cloud or non-SSO** → straight to logout + reload.
- **403** → collected by `addUnauthorizedError` so a burst of them becomes one
  message instead of a stack of toasts.

**The cache does not retry 4xx.** `queryClient`'s `retry` returns false for
400/401/403/404 — retrying those only multiplies the error.

---

## 3. The three outcomes of a read

This is the part worth internalising, because it is what the user sees.

```
  swr(org) called
        │
        ├── FRESH — inside its staleTime
        │     cached: the data.  fresh: resolves from cache, no HTTP.
        │     → 0 requests. Paints instantly.
        │
        ├── STALE — entry exists, staleTime elapsed
        │     cached: the previous data, returned SYNCHRONOUSLY.
        │     fresh:  hits the network, resolves ~300–800 ms later.
        │     → the list keeps its rows and swaps when the answer lands.
        │
        └── COLD — nothing in memory
              ├─ persisted copy on disk? hydrate it, then revalidate if stale
              └─ otherwise cached: undefined → the page shows its spinner
                    → 1 request. This is the only case a user waits.
```

Measured on a stale entry: rows painted at 52 ms, response at 459 ms. The
distinction that matters is that **`get()` does not do this** — on a stale entry
it waits for the network, so a loader that flips `loading` around it blanks the
list. That is why lists use `swr()`.

### Concurrency is free

Three components mounting at once produce **one** request. `fetchQuery` shares
the in-flight promise by key, so the second and third callers await the first.

---

## 4. Write path

A write never re-calls the page loader. It changes what the cache holds, and the
next read follows §3.

```
  AddFunction.vue
        │  jsTransformService.create(org, payload)     ← normal service call
        │
        │  functionsQuery.invalidate(org)              ← mark the scope stale
        ▼
  every key under ["org", org, "functions", …] is stale
        │
        ▼
  the next read from anywhere goes to the server
```

Invalidation is by **prefix**, not exact key: `scope` covers the list, any
filtered variant, and whatever key is added next.

Two rules that follow:

1. **A write that stays on the page** reloads with `force` — `getX(true)`, which
   calls `refresh()` and updates the same key. Sufficient on its own.
2. **A write that navigates away** must `invalidate()` before it goes, or the
   page it lands on paints a cached list that predates the write.

---

## 5. Delete path — why it is not just an invalidate

`invalidate()` marks an entry stale but **keeps the data**. For a delete that is
exactly wrong: the next visit paints the deleted rows from cache, and inside
`staleTime` there is no refetch to correct them.

So a delete **rewrites** the cache instead:

```
  removeStreamsFromTable(items)
        │  prune the rows on screen
        │
        │  streamPageQuery.patchAll(org, page => ({ ...page, list: pruned }))
        ▼
  every cached page under the scope is corrected in place — no request
        │
        ▼
  the next visit paints an already-correct list
```

`patchAll` exists because a row can sit in several cached entries at once — page
1 and page 2, one per sort order, one per filter. `prime` is the single-key
version, used where the key is known (`pruneDashboardQueryCache`).

| Situation                          | Use                      |
| ---------------------------------- | ------------------------ |
| Created or edited, staying on page | `refresh()` via `force`  |
| Created or edited, navigating away | `invalidate(org)`        |
| Deleted, key known                 | `prime(org, pruned, …)`  |
| Deleted, many cached pages         | `patchAll(org, updater)` |

---

## 6. Purge path — org switch and logout

Every key starts `["org", id]`, which is what makes both of these one-liners.

```
  ORG SWITCH   MainLayout.changeOrganizationIdentifier(next, previous)
        └─ purgeOrgQueries(previous)      → disk only
              ├─ localStorage   o2q-["org","<prev>"…
              ├─ IndexedDB      o2q-heavy-["org","<prev>"…  and  panel|<prev>|…
              └─ fieldValueDB.clearOrg(prev)

        In-memory entries are KEPT. One org's data can never be served to
        another — the key prevents it — and gcTime collects them anyway, so
        switching back inside staleTime costs nothing.

  LOGOUT       stores/index.ts  logout action
        └─ purgeAllQueries()
              ├─ queryClient.clear()      → memory
              └─ purgeAllPersisted()      → all disk, incl. o2FieldValues
```

Disk is purged on org switch because it is a different budget: localStorage is
~5 MB shared with the whole app, and the previous tenant's stream and folder
names should not sit on a possibly shared machine.

---

## 7. Worked example — the sidebar folder list

```
  FolderList.vue
        │  getFoldersListByType(store, "dashboards")
        ▼
  utils/commons.ts                       ← legacy entry point, ~10 call sites
        │  foldersQuery.get(org, type)
        │  …then dispatches setFoldersByType (a Vuex bridge, not a cache)
        ▼
  services/common.ts                     ← declaration
        │  key:   (type) => ["folders", type]
        │  staleTime: CONFIG_STALE_TIME  → 5 min fresh, localStorage
        ▼
  query-core
        ├─ fresh?     → return it, 0 requests
        ├─ persisted? → hydrate from localStorage, revalidate if stale
        └─ miss       → run fetch
              ▼
        services/common.ts  list_Folders(org, type)     ← same file, above
              ▼
        services/http.ts    axios + 401 refresh + 403 grouping
              ▼
        GET {API_ENDPOINT}/api/v2/{org}/folders/dashboards
              ▼
        stored in memory + written to localStorage by the persister
```

The Vuex dispatch is a **bridge, not a cache**. It exists so components still
reading `organizationData.foldersByType` keep working, and it is deleted with the
last of them. Where it was treated as a cache — `getAllDashboardsByFolderId`
short-circuiting on the store — it silently became a second cache layer that
never revalidated, and a folder fetched once stayed frozen for the whole session.

---

## 8. Reading a screen's behaviour

When something looks wrong, the branch in §3 usually explains it:

| Symptom                          | Where to look                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| Blanks and spins on every visit  | Loader uses `get()`, or the page is not cached at all (inventory §8)                        |
| Deleted row comes back           | The delete invalidated instead of pruning — §5                                              |
| New item missing after create    | The write navigated away without invalidating — §4 rule 2                                   |
| Refresh button does nothing      | It is not passing `force`, so it is a cache hit                                             |
| Stale after an edit elsewhere    | Cross-key: the other page's write did not invalidate this scope                             |
| Looks instant but still requests | Not cached — rows survived a remount in component state. Check the network, not the flicker |
