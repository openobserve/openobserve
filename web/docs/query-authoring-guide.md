# Query authoring guide

How to add a cached read or a write, and the handful of TanStack behaviours that
will bite you if you don't know them.

**Companion to** [api-cache-architecture.md](./api-cache-architecture.md) (the
layers and the call flow) and [api-cache-inventory.md](./api-cache-inventory.md)
(what is cached, and what must never be).

---

## The one-line version

A cached read is a **plain `queryOptions()` object** declared beside the endpoint
it calls. There is no wrapper type, no house vocabulary, and nothing to learn
beyond TanStack's own API.

---

## 1. The three files

Every domain has three siblings in `services/`:

```
services/<domain>.ts            transport only — axios, URLs, nothing else
services/<domain>.querykeys.ts  keys — imports nothing but `orgKey`
services/<domain>.queries.ts    queryOptions / mutationOptions
```

**Why the transport is separate.** The declaration reaches it through a normal
module import, so `vi.mock("@/services/<domain>")` intercepts what a `queryFn`
calls. When both lived in one file that reference was intra-module and no module
mock could reach it — which is why a bespoke `overlayServiceMock` / `__isQuery`
helper used to exist. It is gone.

**Why the keys are separate again.** A write in one domain routinely drops
another's scope. If keys lived in `<domain>.queries.ts`, reaching one would drag
that domain's transport along and — once two domains invalidate each other —
form an import cycle. A dependency-free leaf module cannot participate in one.

[DependencyImpactDialog.vue](../src/components/alerts/DependencyImpactDialog.vue)
is the payoff: it picks one of three domains' scopes at runtime with zero
transport imports.

---

## 2. Adding a read

```ts
// services/widgets.querykeys.ts
import { orgKey } from "@/composables/query/keys";

export const widgetKeys = {
  all: (org: string) => orgKey(org, "widgets"), // ← the invalidation scope
  list: (org: string) => orgKey(org, "widgets", "list"),
  detail: (org: string, id: string) => orgKey(org, "widgets", "detail", id),
};
```

```ts
// services/widgets.queries.ts
import { queryOptions } from "@tanstack/vue-query";
import widgets from "./widgets";
import { widgetKeys } from "./widgets.querykeys";

export const widgetsQuery = (org: string) =>
  queryOptions({
    queryKey: widgetKeys.list(org),
    queryFn: async (): Promise<Widget[]> => (await widgets.list(org)).data?.list ?? [],
    // Say nothing about freshness unless this read is genuinely different.
    // If it is, name a constant from query/cachePolicy.ts — never a bare number.
  });
```

Every key is rooted at `["org", <id>, …]` by `orgKey`. Three things depend on
that: the org-switch purge, the logout purge, and the persister's storage
prefix. Build a key by hand and it silently opts out of all three.

A read that is **not** org-scoped (`/config`, the license) uses `globalKey`
instead: rooted at `["org", GLOBAL_SCOPE, …]`, so logout still reaches it while
the org-switch purge deliberately does not.

---

## 3. Consuming a read

### In a component — subscribe

```ts
const org = useOrgId();
const q = useQuery(() => Object.assign(widgetsQuery(org.value), { enabled: !!org.value }));

const rows = computed(() => q.data.value ?? []);
const loading = q.isLoading; // cold read in flight → OTable skeleton
const fetching = q.isFetching; // any request → refresh-button spinner
```

The rows **are** the query. Anything that invalidates the scope — this page's
writes, another page's, an org switch — repaints them with no wiring here.

### Outside one — read imperatively

Route guards, Vuex actions, plain utils. Same object, no second declaration:

```ts
const rows = await queryClient.fetchQuery(widgetsQuery(org));
const fresh = await queryClient.fetchQuery({ ...widgetsQuery(org), staleTime: 0 });
const cached = queryClient.getQueryData(widgetKeys.list(org)); // no request
```

`fetchInto(options, { apply, loading, fetching })` exists for imperative flows
that must drive refs a component already owns. It writes a **snapshot** — an
invalidation elsewhere will not repaint it — so prefer `useQuery` wherever the
component can host it.

---

## 4. Adding a write

The write declares its own blast radius, next to the endpoint. The component
never names a cache.

```ts
// services/widgets.queries.ts
export const deleteWidgetMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => widgets.delete(org, id),
    meta: {
      invalidates: [widgetKeys.all(org)],
      removes: [widgetKeys.all(org)], // after a delete — see below
      successMessage: t("widgets.deleted"),
    },
  });
```

```ts
const del = useMutation(() => deleteWidgetMutation(org.value));
await del.mutateAsync(id);
```

`meta` is typed by augmenting TanStack's `Register` interface, so `invalidates`
is checked, not `any`. A `MutationCache` in
[queryClient.ts](../src/composables/query/queryClient.ts) applies it once,
centrally, for every mutation in the app.

| field            | effect                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| `invalidates`    | `invalidateQueries` per scope. Prefer a domain's `all` over a precise key |
| `removes`        | `removeQueries({ type: "inactive" })` — invalidation alone leaves a deleted entity's detail query cached and ready to serve |
| `successMessage` | success toast, via the notifier injected in `main.ts`                     |
| `silentError`    | suppress the default error toast when the call site renders its own       |

A mutation that declares no `meta` is left entirely alone.

**Invalidate on success, never before the write.** Seven components used to call
`invalidateQueries` *before* awaiting the request, racing the refetch against
the write. The declarative form makes the ordering correct by construction.

---

## 5. Things that will bite you

### `Object.assign`, not a spread

`queryOptions()` brands its `queryKey` with the result type. Copying into a fresh
object literal drops the brand — it still compiles, `data` just silently
degrades to `unknown`.

```ts
useQuery(() => Object.assign(widgetsQuery(org.value), { enabled: !!org.value })); // ✅
useQuery(() => ({ ...widgetsQuery(org.value), enabled: !!org.value })); //           ❌ data: unknown
```

### `isLoading`, not `isPending`, for a gated query

A query with `enabled: false` reports `isPending: true` forever — it has no data
and never will until enabled. `isLoading` is pending **and** fetching, i.e. a
cold read actually in flight. That is what a skeleton wants.

### `enabled: false` does not stop the options factory running

The getter still evaluates, so the key builder still runs. If your key is built
from a nullable parameter, give it a placeholder:

```ts
const q = useQuery(() =>
  Object.assign(historyQuery(org.value, params.value ?? EMPTY_PARAMS), {
    enabled: !!params.value,
  }),
);
```

### `refetch()` resolves — it does not reject

Read failures from `query.error`, not a `try/catch` around the call:

```ts
watch(q.error, (e) => {
  if (e) showError(e);
});
```

It also resolves **before** vue-query has propagated the new value into its
reactive refs. A caller that reads `q.data` straight after needs a `nextTick()`.

### `mutateAsync` settles a tick later than a bare service promise

Any handler that doesn't `return` its chain silently stops being awaitable —
tests that `await someHandler()` will pass their assertions too early. Return the
chain. If the function has synchronous work *after* the chain (analytics, say),
hold the promise, run the tail, then return it:

```ts
const request = save.mutateAsync(payload).then(onSuccess).catch(onError);
segment.track("Button Click", { ... }); // must still run synchronously
return request;
```

### Nothing reachable from `queryClient.ts` may import UI or i18n at runtime

The unit-test setup imports that module eagerly. A runtime edge to
`@/types/i18n` evaluates it before a spec's `vi.mock("vue-i18n")` can replace it,
which silently breaks every spec that mocks i18n — 43 files, in one commit that
type-checked cleanly. Mutation toasts are injected via `setMutationNotifier`
from `main.ts` for exactly this reason.

---

## 6. When a component resists conversion

Four shapes need handling before the rows can be derived from the cache:

| Shape | Fix | Example |
| ----- | --- | ------- |
| Shaping function **mutates** its argument | Make it pure — deriving would rewrite the cached entry in place | `PipelinesList` |
| Page owns state **seeded** from the response (filter bounds) | Gate the query behind an `enabled` flag so it cannot fire before the component finishes initialising; `await q.suspense()` on the first read | `Nodes` |
| Rows carry **user state** (a `selected` flag) | Keep the list local, drive it from a `watch` on `q.data` that preserves the user's state | `BuiltInPatternsTab` |
| Read is **parameterised per call** (folder, page, filter) | Hold the parameters in a `ref` so the key forks per shape; this also deletes any "is this response stale?" guard | `ReportList`, `AlertHistory`, `SloList` |

A lazily-opened picker is the `enabled`-gate case too: nothing is read until it
is first opened, and after that the query is live.

---

## 7. Where the rules live

| File | Why there |
| ---- | --------- |
| `.claude/rules/fe-data-fetching.md` | Auto-loaded into every session — this is what enforces the convention on new code. Untracked mirror. |
| `.claude/skills/ui-architect/references/data-fetching.md` | The canonical, tracked copy, reached from the `ui-architect` skill. |

Both should carry: the three-file layout, the `Object.assign` rule, "durations
only in `cachePolicy.ts`", "invalidate by declaring `meta`, never by hand in a
component", and the never-cache / never-persist lists from the inventory.
