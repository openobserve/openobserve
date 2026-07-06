# TanStack Query for the Stream Module — Implementation Plan

Branch: `feat/tanstack-query-streams`

> **Status: Phase 1 implemented.** Files added: `src/plugins/vue-query.ts`,
> `src/composables/queries/streamKeys.ts`, `src/composables/queries/useStreamsListQuery.ts`,
> `src/test/unit/helpers/withVueQuery.ts`. Files changed: `src/main.ts` (plugin
> registration), `src/App.vue` (dev-gated Devtools), `src/views/LogStream.vue`
> (list + Refresh Stats + delete now query-driven). Deps: `@tanstack/vue-query@^5`,
> `@tanstack/vue-query-devtools@^5` (dev). Phase 2 (migrating the cache-based
> `getStreams`/`getStream`/`getMultiStreams` in `useStreams.ts`) is still open.

This document describes how to introduce **[TanStack Query](https://tanstack.com/query/latest/docs/framework/vue/overview) (`@tanstack/vue-query`)** as the data-fetching + caching layer for the **streams** module, replacing the hand-rolled promise-dedup + Vuex cache that lives in `useStreams.ts`.

Goal behaviour (as requested):

- The streams list page (`LogStream.vue`) shows **all streams**.
- Clicking **Refresh Stats** re-fetches. While fetching, a **loading indicator** shows (background refetch spinner) — the already-cached rows stay on screen.
- If the data is **still fresh** (within `staleTime`), navigating back to the page serves **instantly from cache** with no network call.
- If the data is **stale**, TanStack Query serves cache immediately *and* refetches in the background (stale-while-revalidate), swapping in new rows if anything changed.
- The **TanStack Query Devtools** panel is **enabled** so we can inspect query state, cache, and staleness during development.

---

## 1. Current state (as-is)

| Concern | Where | How it works today |
|---|---|---|
| API calls | `web/src/services/stream.ts` | `StreamService.nameList(org, type, schema, offset, limit, keyword, sort, asc)`, `.schema()`, `.delete()`, `.updateSettings()`, `.createStream()` |
| Fetch + cache | `web/src/composables/useStreams.ts` (832 lines) | Manual cache in Vuex + a module-level `getStreamsPromise` ref for in-flight dedup |
| Cache store | `web/src/stores/streams.ts` | Vuex module: one slot per stream type (`logs`, `metrics`, `traces`, `enrichment_tables`, `index`, `metadata`), plus `streamsIndexMapping` and `areAllStreamsFetched` |
| List page | `web/src/views/LogStream.vue` | Calls `getPaginatedStreams(...)` on mount and on Refresh Stats (`getLogStream(true)`, `log-stream-refresh-stats-btn`). Manual `loadingState` ref toggled in `.then/.catch/.finally` |
| App entry | `web/src/main.ts` | `createApp` → `app.use(i18n)` → `app.use(store).use(router)` → `app.mount("#app")` |

Key detail: **`LogStream.vue` uses `getPaginatedStreams`**, which is *server-paginated and does not touch the Vuex cache at all* — every mount/refresh hits the network. That is exactly the surface we want TanStack Query to own first (clean win, no cache-coherency entanglement with the logs page).

The cache-based `getStreams()` (fetch-all-types, dedup, `areAllStreamsFetched`) is consumed widely (logs, dashboards, pipelines, alerts). **We do not rip that out in phase 1** — see §9 for coexistence.

---

## 2. Dependencies

Install matching v5 lines (v5 is the stable, widely-documented line; peer dep allows Vue `^3.3.0`, we are on 3.5):

```bash
cd web
npm install @tanstack/vue-query@^5
npm install -D @tanstack/vue-query-devtools@^5
```

> `@tanstack/vue-table` / `vue-virtual` / `vue-form` are already present but are **unrelated** packages — do not confuse them with `vue-query`.

---

## 3. Setup — QueryClient + plugin + Devtools (ON)

Create a single QueryClient with sane global defaults.

**`web/src/plugins/vue-query.ts`** (new):

```ts
// Copyright 2026 OpenObserve Inc.
//
// ... (AGPL license header — copy from any existing file) ...

import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Served from cache without a refetch for this long → "get from cache".
      staleTime: 30_000, // 30s — tune per query below
      // Keep unused cache around before GC (formerly cacheTime).
      gcTime: 5 * 60_000, // 5 min
      retry: 1,
      refetchOnWindowFocus: false, // O2 has long-lived tabs; opt in per-query if needed
    },
  },
});

export const vueQueryPluginOptions = {
  queryClient,
  // Enable devtools wiring; the panel itself is mounted as a component (see below).
  enableDevtoolsV6Plugin: true,
};
```

**Register in `web/src/main.ts`** — add after the store/router registration (around line 46):

```ts
import { VueQueryPlugin } from "@tanstack/vue-query";
import { vueQueryPluginOptions } from "@/plugins/vue-query";

app.use(store).use(router);
app.use(VueQueryPlugin, vueQueryPluginOptions); // <-- add
```

**Turn Devtools ON.** Mount the devtools component in `App.vue` (dev-gated so it never ships to prod bundles). In `App.vue`'s `<template>`:

```vue
<VueQueryDevtools v-if="isDev" :initial-is-open="false" button-position="bottom-right" />
```

```ts
import { VueQueryDevtools } from "@tanstack/vue-query-devtools";
const isDev = import.meta.env.DEV; // Vite flag — tree-shaken out of prod builds
```

> The floating 🌸 TanStack button appears in the corner in `npm run dev`. This satisfies "tanstack debugger should also be on."

---

## 4. Query key design

Keys must fully describe the request so the cache is correct and invalidation is targeted. Include the org identifier — switching org must not show another org's cache.

```ts
// web/src/composables/queries/streamKeys.ts
export const streamKeys = {
  all: (org: string) => ["streams", org] as const,

  // Paginated list used by LogStream.vue
  list: (
    org: string,
    params: {
      type: string;
      offset: number;
      limit: number;
      keyword: string;
      sort: string;
      asc: boolean;
    },
  ) => ["streams", org, "list", params] as const,

  // Full un-paginated fetch of a single stream type (cache-based path)
  byType: (org: string, type: string) =>
    ["streams", org, "type", type] as const,

  // Single stream schema
  schema: (org: string, type: string, name: string) =>
    ["streams", org, "type", type, "schema", name] as const,
};
```

TanStack Query hashes the key object deterministically (key order doesn't matter), so `list(org, {type, offset, limit, keyword, sort, asc})` gives one cache entry **per page/filter/sort combination** — paging back to a visited page is instant.

---

## 5. New composable — `useStreamsListQuery`

Wraps the paginated list fetch with `useQuery`. This is what `LogStream.vue` consumes.

**`web/src/composables/queries/useStreamsListQuery.ts`** (new):

```ts
// Copyright 2026 OpenObserve Inc.
// ... license header ...

import { computed, type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { useStore } from "vuex";
import StreamService from "@/services/stream";
import { streamKeys } from "./streamKeys";

interface StreamListParams {
  type: Ref<string>;
  offset: Ref<number>;
  limit: Ref<number>;
  keyword: Ref<string>;
  sort: Ref<string>;
  asc: Ref<boolean>;
}

export function useStreamsListQuery(params: StreamListParams) {
  const store = useStore();
  const org = computed(
    () => store.state.selectedOrganization?.identifier as string,
  );

  // Reactive key — when any ref changes, the query re-runs (and caches per combo).
  const queryKey = computed(() =>
    streamKeys.list(org.value, {
      type: params.type.value,
      offset: params.offset.value,
      limit: params.limit.value,
      keyword: params.keyword.value,
      sort: params.sort.value,
      asc: params.asc.value,
    }),
  );

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await StreamService.nameList(
        org.value,
        params.type.value === "all" ? "" : params.type.value,
        false, // schema — never fetched in the list
        params.offset.value,
        params.limit.value,
        params.keyword.value,
        params.sort.value,
        params.asc.value,
      );
      return { list: res.data.list, total: res.data.total };
    },
    enabled: computed(() => !!org.value), // don't fire until an org is selected
    staleTime: 30_000, // "get from cache" window for the list
    placeholderData: keepPreviousData, // keep old page visible while next page loads
  });

  return query; // { data, isLoading, isFetching, isError, error, refetch, ... }
}
```

Return-value semantics that map directly to the requested UX:

| TanStack field | Meaning | UI use |
|---|---|---|
| `isLoading` | first load, **no cached data yet** | full-page skeleton/spinner |
| `isFetching` | any fetch in flight, **including background refetch** | small **refresh spinner** on the Refresh Stats button while cache stays visible |
| `isStale` | current data is past `staleTime` | optional "stale" badge / auto-refetch trigger |
| `data` | cached or fresh result | table rows |
| `refetch()` | force a network call | wired to the Refresh Stats button |

---

## 6. Migrating `LogStream.vue`

Replace the manual `getPaginatedStreams` + `loadingState` machinery (`web/src/views/LogStream.vue:479-581`) with the query composable.

**Before** (simplified): `loadingState` ref, `getLogStream()` builds a promise, `.then` maps rows, `.finally` clears loading, `getLogStream(true)` on Refresh.

**After:**

```ts
import { useStreamsListQuery } from "@/composables/queries/useStreamsListQuery";

// currentPage / pageSize / filterQuery / sortBy / sortOrder / selectedStreamType
// already exist as refs in this component.
const offset = computed(() =>
  Math.max(0, (currentPage.value - 1) * pageSize.value),
);

const {
  data,
  isLoading,
  isFetching,
  isError,
  error,
  refetch,
} = useStreamsListQuery({
  type: selectedStreamType,
  offset,
  limit: pageSize,
  keyword: filterQuery,
  sort: sortBy,
  asc: computed(() => sortOrder.value === "asc"),
});

// Rows for the OTable — same shape mapping as today (lines 518-541).
const logStream = computed(() =>
  (data.value?.list ?? []).map((d: any) => ({
    _rowKey: `${d.name}-${d.stream_type}`,
    name: d.name,
    doc_num: d.stats ? d.stats.doc_num : "--",
    storage_size: d.stats ? `${d.stats.storage_size} MB` : "--",
    compressed_size: d.stats ? `${d.stats.compressed_size} MB` : "",
    index_size: d.stats ? `${d.stats.index_size} MB` : "",
    storage_type: d.storage_type,
    actions: "action buttons",
    schema: d.schema ?? [],
    stream_type: d.stream_type,
  })),
);

const totalCount = computed(() => data.value?.total ?? 0);
```

Template wiring:

```vue
<!-- Refresh Stats button: spin + disable while a fetch is in flight -->
<OButton
  data-test="log-stream-refresh-stats-btn"
  variant="outline"
  size="sm-action"
  :loading="isFetching"
  @click="refetch()"
>
  {{ t('logStream.refreshStats') }}
</OButton>

<!-- Table: isLoading is the *first* load (no cache); isFetching keeps cache on screen -->
<OTable
  data-test="log-stream-table"
  :data="logStream"
  :total-count="totalCount"
  :loading="isLoading"
  ...
/>
```

- **Server pagination/sort/filter still work**: changing `currentPage`, `pageSize`, `sortBy`, `sortOrder`, or `filterQuery` changes the reactive `queryKey`, which triggers a fetch for that combination and caches it.
- **`keepPreviousData`** means paging/sorting shows the previous page's rows (dimmed via `isFetching`) instead of an empty flash.
- Error toast moves into a `watch(isError, ...)` (respecting the existing `err.response?.status != 403` suppression).

Remove: the `getLogStream` function, the `loadingState` ref, the imperative `dismiss()` toasts, and the `getPaginatedStreams` import from this component.

---

## 7. Org switching

The org identifier is baked into every query key, so a switch naturally produces a **cache miss** and refetch. To also drop the previous org's cached entries, invalidate on switch (wherever the org change is handled — e.g. a `watch` on `store.state.selectedOrganization.identifier`):

```ts
import { useQueryClient } from "@tanstack/vue-query";
const qc = useQueryClient();

watch(
  () => store.state.selectedOrganization?.identifier,
  (newOrg, oldOrg) => {
    if (oldOrg && newOrg !== oldOrg) {
      qc.removeQueries({ queryKey: ["streams", oldOrg] });
    }
  },
);
```

This replaces the `resetStreams()` call path for the query-backed data.

---

## 8. Mutations → cache invalidation

Create/delete/update-settings should invalidate the list so the table reflects reality. Use `useMutation`:

```ts
import { useMutation, useQueryClient } from "@tanstack/vue-query";

const qc = useQueryClient();
const org = computed(() => store.state.selectedOrganization.identifier);

const deleteStream = useMutation({
  mutationFn: (v: { name: string; type: string }) =>
    StreamService.delete(org.value, v.name, v.type, true),
  onSuccess: () => {
    // Invalidate every streams query for this org → list refetches.
    qc.invalidateQueries({ queryKey: streamKeys.all(org.value) });
  },
});
```

Apply the same pattern to create (`AddStream`) and settings updates (`Schema.vue` / `updateSettings`). Existing delete/create UI just calls `deleteStream.mutate({...})` instead of the raw service + manual `getLogStream(true)`.

---

## 9. Coexistence with the existing `useStreams` cache

`useStreams.getStreams()` (fetch-all-types + Vuex cache) is used far beyond this page. **Phase 1 does not touch it.** Two independent caches temporarily coexist:

- **TanStack Query** owns the `LogStream.vue` paginated list (and any new consumers).
- **Vuex `streams` module** continues to serve logs/dashboards/pipelines via `getStreams`/`getStream`.

To avoid drift while both exist, after a mutation invalidates the query cache, **also** call the existing `resetStreams()` / `resetStreamType(type)` so the Vuex cache re-fetches on next use. Track full migration of `getStreams`/`getStream`/`getMultiStreams` to `useQuery` as **phase 2** (larger, higher-risk — schema-on-demand and `streamsIndexMapping` logic must be preserved).

---

## 10. Testing

- **Unit (Vitest)** — wrap mounts with a `QueryClient`. Add a helper `web/src/test/unit/helpers/withVueQuery.ts`:

  ```ts
  import { VueQueryPlugin, QueryClient } from "@tanstack/vue-query";
  export function vueQueryTestPlugin() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return { plugins: [[VueQueryPlugin, { queryClient }]], queryClient };
  }
  ```

  Then in `LogStream.spec.ts`, add the plugin to `global.plugins`. MSW already intercepts `*/api/*/streams` (see `handlers.ts`) — assert the loading state (`isFetching`), the rendered rows via `data-test="log-stream-table"`, and that Refresh triggers a refetch.

- Follow the project test rules: `data-test` selectors only, `await flushPromises()`, no `setTimeout`, reuse `mockData/streams.ts`.
- Run: `cd web && npm run test:unit -- src/views/LogStream.spec.ts --reporter=verbose`.

---

## 11. Rollout checklist

- [ ] `npm install @tanstack/vue-query@^5` + `-D @tanstack/vue-query-devtools@^5`
- [ ] Add `web/src/plugins/vue-query.ts` (QueryClient + defaults)
- [ ] Register `VueQueryPlugin` in `main.ts`
- [ ] Mount `<VueQueryDevtools>` in `App.vue`, dev-gated (**devtools ON**)
- [ ] Add `streamKeys.ts`
- [ ] Add `useStreamsListQuery.ts`
- [ ] Migrate `LogStream.vue` list + Refresh Stats to the query (remove `loadingState`/`getLogStream`)
- [ ] Invalidate on org switch
- [ ] Convert create/delete/settings to `useMutation` + `invalidateQueries`
- [ ] Keep Vuex `useStreams` cache in sync after mutations (phase-1 bridge)
- [ ] Update/added specs pass; `npm run lint`; `npm run type-check`
- [ ] Verify in `npm run dev`: cache-hit is instant, Refresh spins the button while cache stays visible, Devtools shows `fresh`/`stale`/`fetching` transitions

---

## 12. Notes & conventions

- License header `// Copyright 2026 OpenObserve Inc.` on every new/changed file.
- `<script setup lang="ts">`, no `// @ts-nocheck`, avoid `any` in new code.
- `@/` alias, `rem`/`%` units (no `px`), `data-test` on interactive elements.
- Run `npm run lint` then `npm run type-check` after changes. Never run `npm run build`.
- `staleTime` is the dial for "serve from cache vs. refetch". Start at `30s` for the list; raise it for rarely-changing data, lower it if stats must feel live.
