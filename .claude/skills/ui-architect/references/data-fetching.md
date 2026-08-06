# Data Fetching & Caching

Every read goes through `web/src/composables/query/`. Services are unchanged —
they are still thin URL builders returning axios promises; queries wrap them.

Reference docs: [api-cache-architecture.md](../../../../web/docs/api-cache-architecture.md)
(call flow) · [api-cache-inventory.md](../../../../web/docs/api-cache-inventory.md)
(what is cached where).

---

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

### Testing

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
