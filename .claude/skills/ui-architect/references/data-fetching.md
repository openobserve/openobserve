# Data Fetching & Caching

Every cached read is a plain **`queryOptions()`** object declared in
`services/<domain>.queries.ts`, beside the transport module that owns the URL.
There is no wrapper type and no house vocabulary: `useQuery`, `useMutation`,
`queryClient.fetchQuery`, `invalidateQueries` are TanStack's own API, called
directly.

What is cached where, and what is deliberately not, is in
[data-fetching-inventory.md](data-fetching-inventory.md). The full call flow,
purge paths and the reasoning behind the layout live in `web/docs/` —
[api-cache-architecture.md](../../../../web/docs/api-cache-architecture.md) and
[query-authoring-guide.md](../../../../web/docs/query-authoring-guide.md).

---

## The three files per domain

```
services/<domain>.ts            transport only — axios, URLs, nothing else
services/<domain>.querykeys.ts  keys; imports nothing but `orgKey`
services/<domain>.queries.ts    queryOptions / mutationOptions
```

Never collapse these. The transport is separate so a normal
`vi.mock("@/services/<domain>")` reaches a `queryFn` — when they shared a file
the reference was intra-module and no module mock could intercept it. The keys
are separate again so a write in one domain can drop another's scope without
dragging that domain's transport along and forming an import cycle.

---

## Rules

### The one rule

**Durations live in `cachePolicy.ts`, never at a call site.** A bare
`staleTime: 60000` in a declaration or a page is a review rejection: most reads
want the client default and say nothing at all, and the few that differ name a
constant.

### Where each decision lives

| Decision                               | File                                                     |
| -------------------------------------- | -------------------------------------------------------- |
| "How long is this fresh?"              | `query/cachePolicy.ts` — the only file with numbers      |
| "Where is it stored?"                  | the `persister` option; omit it for memory only          |
| "What identifies this read?"           | the key factory in `services/<domain>.querykeys.ts`      |
| "Which endpoint, what response shape?" | the `queryOptions()` in `services/<domain>.queries.ts`   |
| "What does a write invalidate?"        | that write's `meta.invalidates` — never the component    |
| "When does this page read it?"         | the page — `enabled`, `refetchInterval`                  |
| "What is the URL?"                     | `services/<domain>.ts` — untouched by caching            |

### Policy by shape of read

| Read                            | `staleTime`                 | `persister`             |
| ------------------------------- | --------------------------- | ----------------------- |
| anything not listed below       | client default (30 s)       | —                       |
| org config: streams, folders, … | `CONFIG_STALE_TIME` (5 min) | `localStoragePersister` |
| immutable for the session       | `SESSION_STALE_TIME`        | `localStoragePersister` |
| operational state you poll      | `0`                         | —                       |
| heavy result payloads           | `0`                         | `indexedDbPersister`    |

### Adding a new endpoint

```
├─ Not a GET, or streaming, or a single-use URL? ──► no cache. mutationOptions for writes.
└─ GET, reused across surfaces or visits?
   ├─ Immutable for the session?        ──► SESSION_STALE_TIME  localStorage
   ├─ Org configuration?                ──► CONFIG_STALE_TIME   localStorage
   ├─ A list of entities / one entity?  ──► client default      memory
   ├─ Operational state you poll?       ──► staleTime 0         memory + refetchInterval
   └─ Large result payload?             ──► staleTime 0         IndexedDB
        │
        └─ then, whatever the duration:
           carries a token, key or passcode? ──yes──► no persister
```

**Verify the duration against the payload, not the endpoint name.** `/api/license`
sounds static but carries live usage counters; the node list sounds like config
but is cluster state that must not be served from disk.

---

## The template

```ts
// services/things.querykeys.ts
import { orgKey } from "@/composables/query/keys";

export const thingKeys = {
  all: (org: string) => orgKey(org, "things"), // ← the invalidation scope
  list: (org: string) => orgKey(org, "things", "list"),
  detail: (org: string, id: string) => orgKey(org, "things", "detail", id),
};
```

```ts
// services/things.queries.ts
import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import thingService from "./things";
import { thingKeys } from "./things.querykeys";

export const thingsQuery = (org: string) =>
  queryOptions({
    queryKey: thingKeys.list(org),
    queryFn: async (): Promise<Thing[]> => (await thingService.list(org)).data?.list ?? [],
  });

export const deleteThingMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => thingService.delete(org, id),
    meta: { invalidates: [thingKeys.all(org)], removes: [thingKeys.all(org)] },
  });
```

`orgKey` roots every key at `["org", <id>, …]`. The org-switch purge, the logout
purge and the persister's storage prefix all scan that shape — build a key by
hand and it silently opts out of all three. A read that is **not** org-scoped
(`/config`, the license) uses `globalKey`.

---

## Consuming

### In a component — subscribe

```ts
const org = useOrgId();
const q = useQuery(() => Object.assign(thingsQuery(org.value), { enabled: !!org.value }));

const rows = computed(() => q.data.value ?? []);
const loading = q.isLoading; // cold read in flight → OTable skeleton
const fetching = q.isFetching; // any request → refresh-button spinner
```

The rows **are** the query. Anything that invalidates the scope repaints them
with no wiring at the call site.

### Writing

```ts
const del = useMutation(() => deleteThingMutation(org.value));
await del.mutateAsync(id);
```

The component never names a cache. `meta` is applied centrally by a
`MutationCache` in `query/queryClient.ts`:

| field            | effect                                                                |
| ---------------- | --------------------------------------------------------------------- |
| `invalidates`    | `invalidateQueries` per scope — prefer a domain's `all`                |
| `removes`        | `removeQueries({ type: "inactive" })` — use after a delete             |
| `successMessage` | success toast via the notifier injected in `main.ts`                   |
| `silentError`    | suppress the default error toast when the call site renders its own    |

### Outside a component

Route guards, Vuex actions, plain utils — same object, read imperatively:

```ts
await queryClient.fetchQuery(thingsQuery(org));
await queryClient.fetchQuery({ ...thingsQuery(org), staleTime: 0 }); // force
queryClient.getQueryData(thingKeys.list(org)); // peek, no request
```

`fetchInto(options, { apply, loading, fetching })` drives refs a component
already owns. It writes a **snapshot** — an invalidation elsewhere will not
repaint it — so prefer `useQuery` wherever the component can host it. Only four
modules should be using it.

---

## Rules that are easy to get wrong

1. **`Object.assign`, not a spread.** `queryOptions()` brands its `queryKey`
   with the result type; spreading into a fresh literal drops the brand and
   `data` silently degrades to `unknown`. It still compiles.
2. **`isLoading`, not `isPending`, for a gated query.** A query with
   `enabled: false` is pending forever. `isLoading` is pending **and** fetching.
3. **`enabled: false` does not stop the options factory running.** A key built
   from a nullable parameter needs a placeholder or it throws.
4. **`refetch()` resolves, it does not reject.** Read failures from
   `query.error`. It also resolves *before* vue-query propagates into its
   reactive refs — a caller reading `q.data` straight after needs `nextTick()`.
5. **`mutateAsync` settles a tick later than a bare service promise.** A handler
   that does not `return` its chain stops being awaitable. If synchronous work
   follows the chain (analytics), hold the promise, run the tail, then return it.
6. **Invalidate on success, never before the write.** Declaring `meta` does this
   for you; a hand-written `invalidateQueries` before an `await` races the
   refetch against the request.
7. **`fetchQuery`, not `ensureQueryData`.** The latter returns cached data even
   after `invalidateQueries` — it only fetches when there is *no* data.
8. **Nothing reachable from `queryClient.ts` may import UI or i18n at runtime.**
   The test setup imports it eagerly; a runtime edge to `@/types/i18n` defeats
   `vi.mock("vue-i18n")` in every spec that uses it. Toasts are injected via
   `setMutationNotifier` from `main.ts`.
9. **A query result may not be `undefined`.** Use `?? null` in the queryFn.
10. **Match the service's export shape** — some are default exports, some named
    (`annotationService`). A wrong import is `undefined` at runtime, not a
    compile error.

---

## When a component resists conversion

Four shapes block deriving rows from the cache. Fix the shape, don't work
around it:

| Shape                                                    | Fix                                                                                        | Example              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------- |
| Shaping function **mutates** its argument                | Make it pure — deriving would rewrite the cached entry in place                             | `PipelinesList`      |
| Page owns state **seeded** from the response              | Gate the query behind `enabled` so it cannot fire before init; `await q.suspense()` first   | `Nodes`              |
| Rows carry **user state** (a `selected` flag)             | Keep the list local, drive it from a `watch` on `q.data` that preserves that state          | `BuiltInPatternsTab` |
| Read is **parameterised per call** (folder, page, filter) | Hold the parameters in a `ref` so the key forks per shape — this also deletes any stale-response guard | `ReportList`, `SloList` |

Also check: **unstable row identity.** A row keyed by `getUUID()` cannot be
painted twice. Derive the identity from the entity first.

A page that already looks instant is not evidence it is cached — rows often
survive a remount in shared component state while the request still fires every
time. Check the network, not the flicker.

---

## Never cache

Ad-hoc search (`search.search`, `_around`, partitions, WS), AI chat streams,
single-use URLs and page tokens, and **any GET that mutates** (billing's
`unsubscribe` / `resume_subscription`).

Also uncached on purpose: `dashboards.get_Dashboard` (its `hash` drives
optimistic-concurrency saves) and read-modify-write reads such as
`WorkflowLinkAlertsDialog`.

## Never persist

Ingestion tokens, org passcode, cipher key material, RUM tokens,
service-account tokens, synthetics agent tokens. Omit the `persister` **on the
query** rather than relying on its duration — the override has to survive
someone changing the file's policy later.

---

## Lifecycle — what survives what

Every key is rooted at `["org", id]`, which is what makes both events safe.

| Event          | Memory   | localStorage / IndexedDB          |
| -------------- | -------- | --------------------------------- |
| **Org switch** | **kept** | **purged** for the org being left |
| **Logout**     | cleared  | purged entirely                   |

Memory is kept across an org switch on purpose: one org's data can never be
served to another, and `gcTime` collects it anyway. Disk is purged because it is
a ~5 MB budget shared with the whole app, and the previous tenant's names should
not sit on a possibly shared machine.

Implemented in `purgeOrgQueries` / `purgeAllQueries` (`query/queryClient.ts`).

---

## Testing

- `setupTests.ts` installs `VueQueryPlugin` with the app's client and, in
  `afterEach`, calls `queryClient.clear()` **and** `purgeAllPersisted()`.
  `clear()` alone leaves localStorage entries the next test restores from,
  silently skipping its service mock. Do not duplicate any of this per file.
- **Mock the transport with a plain `vi.mock`.** Declarations reach it through a
  normal import, so this is all that is needed:
  ```ts
  vi.mock("@/services/reports", () => ({
    default: { listByFolderId: vi.fn() },
  }));
  ```
  The old `overlayServiceMock` / `automockService` / `queryStub` helpers existed
  because queries used to live *inside* the transport module. `queryStub` and
  the `__isQuery` marker are gone; the two overlay helpers remain only for specs
  that stub part of a service and want the rest of the real module.
- A spec that mounts a component and then wants a **different** service response
  must clear the cache or force the reload — the mount already warmed it:
  ```ts
  vi.mocked(service.list).mockResolvedValue({ data: [] });
  queryClient.clear(); // ← without this the override is ignored
  await wrapper.vm.getData();
  ```
- The query layer defers its `queryFn` to a microtask, and `mutateAsync` settles
  a tick later still. A spec that captures a resolver from inside a mock, or
  awaits a handler, must flush a tick before asserting.

---

## Before you push

`npm run lint` and `npm run format:check` are **different gates**. ESLint's
prettier rule does not cover everything CI checks, so a scripted or bulk edit
can pass lint and still fail `format:check`. Run both, plus `type-check`.
