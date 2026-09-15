# Data Layer Architecture Flow

Why the caching PR is layered the way it is: what `defineQuery` buys over
using the query client directly, what `http()`/axios actually does for us, and
what replacing either would cost. Companion to `CACHING_STANDARD.md`, which
covers the policies; this covers the *architecture rationale*.

---

## 1. The complete flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│ LAYER 6 · Page / component            views/…  components/…              │
│   decides WHEN to read: mount, enabled, force, refetchInterval           │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │  alertsListQuery.load({...}) / .use() / .get()
┌──────────────────────────▼───────────────────────────────────────────────┐
│ LAYER 5 · Consumption shape           the handle defineQuery returns     │
│   get / refresh / load / peek / use / invalidate / remove / patchAll     │
│   + useServerTable (paginated)  + useOrgMutation (writes)                │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │  options(org, ...args) = { queryKey, queryFn, policy }
┌──────────────────────────▼───────────────────────────────────────────────┐
│ LAYER 4 · Per-API binding             defineQuery in services/<domain>.ts│
│   key derivation  ["org", org, ...segments]                              │
│   scope derivation (invalidation prefix)                                 │
│   policy pass-through (only what the declaration states)                 │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │  queryClient.fetchQuery(options)
┌──────────────────────────▼───────────────────────────────────────────────┐
│ LAYER 3 · Cache engine                @tanstack/query-core (singleton)   │
│   staleness check · in-flight dedup by key · structural sharing          │
│   ├── fresh in memory  ──────────────► return, 0 requests                │
│   ├── persisted (L: persisters.ts) ──► hydrate localStorage / IndexedDB  │
│   └── miss or stale ─────────────────► run queryFn                       │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │  def.fetch(org, ...args)  → the service builder
┌──────────────────────────▼───────────────────────────────────────────────┐
│ LAYER 1 · Transport                   services/<domain>.ts → http.ts     │
│   URL building · axios instance · withCredentials · baseURL from store   │
│   401 → single shared dex_refresh, then RETRY the original request       │
│   403 → grouped into useUnauthorizedErrorGrouper                         │
└──────────────────────────┬───────────────────────────────────────────────┘
                           ▼
                    GET /api/{org}/…
```

(Layer 2, `cachePolicy.ts`, is not a runtime box — it is the compile-time
source of every duration the other layers reference.)

Write path: component → service write builder (axios) → on success
`xQuery.invalidate(org)` → next read of the scope refetches.
Purge path: org switch → `purgeOrgQueries` (disk only); logout →
`purgeAllQueries` (everything).

---

## 2. Why `defineQuery` exists — and what "just use the client" would cost

### The question

TanStack already gives us `queryClient.fetchQuery({ queryKey, queryFn })`. Why
wrap it? Why not have each service export plain fetch functions and let pages
call the client directly?

### What the direct-use world looks like

Every call site would write:

```ts
// in some component
const data = await queryClient.fetchQuery({
  queryKey: ["org", store.state.selectedOrganization.identifier, "alerts", "list", folderId],
  queryFn: () => alertsService.listByFolderId(1, 1000, "name", false, "", org, folderId, ""),
  staleTime: 30_000,
});
```

Multiply that by every consumer of every read. Five things break, each of them
exactly the class of bug this PR was fixing:

**a. Key drift — the fatal one.** The key is now a *convention*, retyped at
every call site. Two components that spell the alerts key slightly differently
(`"list"` vs `"alerts-list"`, folderId vs `folderId ?? "all"`) silently get two
cache entries: double fetches, and a refresh in one place that the other never
sees. With `defineQuery` the key exists in exactly one place; a call site
*cannot* construct a divergent key because it never constructs a key at all.

**b. Org rooting becomes unenforceable.** The entire lifecycle system —
org-switch purge, logout purge, scope invalidation — is prefix-matching on
`["org", <id>, ...]`. One call site that forgets the root (or roots with a
different org source) creates an entry the purges cannot find: **cross-tenant
data surviving an org switch** is the concrete failure. `defineQuery` prepends
the root mechanically; it is not possible to opt out.

**c. Policy scatters to call sites.** `staleTime: 30_000` written inline in a
component is precisely the "durations at call sites" disease the standard bans.
Worse, two consumers of the same endpoint can disagree — one says 30 s, one
says 5 min — and the effective behaviour depends on mount order. The
declaration makes the endpoint's policy single-sourced.

**d. Invalidation prefixes become guesswork.** After a write, which keys do
you drop? Direct users must re-derive the prefix by hand at every mutation
site — and a precise-key invalidate that misses a sibling variant is a
stale-data bug that surfaces weeks later when someone adds a filter argument.
`scope` on the declaration is the one authoritative answer, and
`invalidate(org)` is impossible to call with the wrong prefix.

**e. Tests lose their seam.** The `__isQuery` marker is how
`overlayServiceMock` / `automockService` distinguish query handles from
endpoint functions on a service module. With ad-hoc client calls there is no
seam: every spec would need to know each component's private key spelling to
pre-seed or assert on the cache.

### Why not at least merge it into the service functions?

The services *are* where the queries live — `defineQuery` sits in the same
file, below the URL builders. What stays deliberately separate is the raw
builder (`alerts.listByFolderId(...)` returning an axios promise) from the
cached binding (`alertsListQuery`). Merging them — making the service function
itself cache — would cost:

- **Write paths and cache-bypass reads lose their raw door.** Deliberately
  uncached reads (`get_Dashboard` and its concurrency `hash`, read-modify-write
  dialogs) need the un-cached call to still exist. If caching were welded into
  the function, "fetch raw" would need a second function anyway — you'd have
  reinvented the two-export split, just implicitly.
- **The query needs an identity separate from the call.** `invalidate`,
  `peek`, `prime`, `prefetch`, `patchAll` are operations on the *cache entry*,
  not requests. A plain async function has no surface to hang them on.

### Alternatives considered (and where each one lands)

**A. TanStack inside the service function itself** — `getDashboards()`
internally calls `fetchQuery`. This is `defineQuery` hand-inlined per endpoint
with the guarantees removed: every function re-writes the key, the org rooting
and the policy (drift returns, relocated into service files); every cache
operation (`invalidate`, `peek`, a forced refresh) is a separate export that
must rebuild the same key, so the key is spelled 3–4 times per file; the
raw/cached split needs `getX()` / `getXRaw()` naming pairs; and reactive
consumers still can't be served (a service function cannot call `useQuery`).
Strictly more code and more to remember. Rejected.

**B. A composable per domain** (`useDashboards()`) — the idiomatic
TanStack-Vue shape, and half-right: `xQuery.use()` *is* this composable. What
a composable-only layer cannot cover: imperative callers (route guards, write
paths, legacy `utils/commons.ts` entry points, Options API pages) — the very
consumers the migration deliberately did not convert; and it moves key + fetch
into `composables/`, away from the URL builder, so two files drift per
endpoint. Rejected as a replacement.

**B′. The adopted compromise for ergonomics** — where a domain has many
reactive consumers, export a one-line sugar composable *beside the
declaration*, delegating to it:

```ts
export const useDashboards = (folderId: () => string) =>
  dashboardsByFolderQuery.use(() => [folderId()]);
```

Familiar `{ data, isPending }` shape for components; key, policy and
invalidation still declared once. The hard rule: sugar composables may never
contain their own `useQuery({ queryKey, ... })` — a second key source is the
drift bug reborn. An ESLint ban on inline `queryKey` arrays outside
`composables/query/` is the cheap structural guard.

### What the layer costs (honestly)

- ~250 lines in `queryClient.ts` that are ours to maintain, vs. zero if raw
  TanStack were used directly.
- Services now import the query layer (they were dependency-free before) —
  the testing implications section of the standard exists because of this.
- One more concept for new contributors — mitigated by the layer having one
  file and one pattern.

**Verdict: the layer is the enforcement mechanism.** Every rule in
`CACHING_STANDARD.md` is either structurally guaranteed by `defineQuery`
(rooted keys, single key spelling, single policy, correct invalidation prefix)
or merely *hoped for* under direct client use. For a 36-service codebase
migrated incrementally by many hands, convention does not survive; structure
does.

---

## 3. Can `http()` / axios be replaced with `fetch`?

### What `http()` actually provides today (`services/http.ts`, 160 lines)

1. **Per-call axios instance** with `withCredentials` and `baseURL` from the
   store (the API endpoint is runtime state, not build config).
2. **401 handling with retry** — the valuable part. On enterprise SSO, a 401
   triggers `attemptTokenRefresh()`: a module-level shared promise ensures N
   concurrent 401s produce **one** `dex_refresh` request, all callers wait on
   it, and then each **retries its original request** transparently. Cloud and
   non-SSO paths get the logout/reload treatment instead, with auth-endpoint
   loop guards.
3. **403 grouping** — unauthorized responses feed
   `useUnauthorizedErrorGrouper` so a page that fires 10 forbidden calls shows
   one grouped notice, not 10 toasts.
4. **Axios's error/response shape** — `res.data` pre-parsed,
   `err.response.status` / `err.response.data.message` on failures.

Notably *not* used: upload/download progress events (zero occurrences),
axios cancel tokens (services use at most one abort signal), custom
serializers. Streaming/WS already bypass axios by necessity and share the
refresh flow through the exported `attemptTokenRefresh`.

### What a `fetch` replacement must reimplement

`fetch` gives none of the above natively:

| Axios behaviour we rely on          | `fetch` equivalent to be written              |
| ----------------------------------- | --------------------------------------------- |
| Interceptor + retry-original on 401 | wrapper that clones request config, re-issues |
| Rejects on 4xx/5xx                  | manual `if (!res.ok) throw` — fetch resolves on HTTP errors |
| `err.response.status` shape         | a custom error class mimicking axios's        |
| Auto JSON parse / `res.data`        | `await res.json()` + content-type handling    |
| Query-param serialization           | `URLSearchParams` handling incl. arrays       |
| Timeouts                            | `AbortController` + timer per request         |

The wrapper is writable — perhaps 150–250 lines — but the real cost is not
the wrapper. It is that **539 call sites across the app pattern-match on the
axios error shape** (`err.response?.status`, `err.response?.data?.message`).
A replacement either reproduces that shape byte-for-byte (an axios emulator —
all of the risk, none of the win) or every error handler in the app is
touched.

### The actual trade

| Factor          | Keep axios                    | Replace with fetch wrapper                        |
| --------------- | ----------------------------- | ------------------------------------------------- |
| Bundle          | ~13 kB gzip                   | −13 kB                                            |
| Migration churn | 0                             | 36 service files re-tested; 539 error sites at risk |
| Risk surface    | none (battle-tested paths)    | auth refresh + retry is the single most dangerous flow to re-implement — a bug here logs users out or loops |
| Test suite      | MSW intercepts axios fine     | MSW intercepts fetch fine (neutral)               |
| Maintenance     | one dependency, stable 1.x    | ~200 owned lines + an owned error contract        |

### Verdict and the one architectural point that matters

**Not worth it now.** ~13 kB of bundle against re-validating every error path
and the token-refresh retry — the riskiest code in the transport — is a bad
trade with no user-visible payoff.

But the layering makes the question *cheap to revisit*: axios is confined to
Layer 1. `defineQuery`'s `fetch` receives a promise of shaped data; TanStack
does not know axios exists; components (should) know only `res.data` /
`err.response`. If a swap ever becomes worthwhile (axios abandonment, a
must-have fetch feature like streaming responses in the same pipeline), the
migration path is: build the wrapper **inside `http()`** preserving the
response/error contract, flip service files incrementally, leave layers 3–6
untouched. The prerequisite worth doing *today* if the team wants the option:
stop new code from reaching into axios directly (12 files import it outside
`http.ts`) and treat `err.response` as the app's owned error contract rather
than "whatever axios returns".

---

## 4. Summary for discussion

1. **`defineQuery` is not a convenience wrapper — it is where the standard is
   enforced.** Removing it converts five structural guarantees (key identity,
   org rooting, single policy, correct invalidation, test seam) into
   conventions that 36 services and dozens of contributors must uphold by
   discipline. The cost is ~250 owned lines and a service→query-layer import.
2. **axios stays, by economics rather than by attachment.** The features we
   actually use (401-refresh-retry, error shape, 403 grouping) are exactly the
   expensive ones to rebuild, and 539 call sites depend on the error shape.
   The layering already isolates it; the cheap preparatory step is banning new
   direct axios imports outside `http.ts`.
