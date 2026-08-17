<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  The DBM parent route's host, and deliberately nothing else.

  The DBM tabs are separate ROUTES, so every switch destroyed the outgoing
  page and mounted the incoming one from scratch — re-running its whole fan-out
  and discarding its filters, sort and scroll. Measured on one landing: eight
  requests, seven sharing a `start_time` and an eighth 22ms later, because the
  badge fan-out and the page's own read resolved the clock at different moments.

  The routes were ALREADY flagged `meta.keepAlive: true`. Nothing read the flag:
  the parent route had no component, so there was no `<router-view>` to wrap and
  no cache to hold anything. The intent was recorded and never wired.

  This is that wiring, and it is the same pattern RUM uses in
  RealUserMonitoring.vue — including the trap documented there: ONE keep-alive,
  always rendered. It must NOT sit inside a `v-if`, because `<keep-alive>` holds
  its cache in its OWN instance, so toggling the element throws the cache away
  with it. `include` decides what is retained; the element itself stays put.

  NO page header, NO layout, NO padding. Each DBM page renders its own
  OPageLayout, and a shell that contributed a header would nest two of them and
  push the child's header down — the bug the router comment warns about at
  Functions.vue:18-22, which is exactly why this parent had no component before.
  A bare `<router-view>` adds no DOM of its own, so that reasoning still holds.

  It does, however, own the TAB BADGE COUNTS. Every page renders the shared tab
  strip, and the strip takes every tab's count, so each page used to fan out to
  the sibling endpoints to fill them in — once per tab for numbers that are
  identical on every tab. That fan-out now happens here, once per (org, window,
  filters), and the pages inject the result. The MARKUP stays on the pages: the
  strip belongs to each page's own header slot, and hoisting it here would move
  it above their titles, which is the layout bug above. See useDbmTabCounts.ts.
-->
<template>
  <router-view v-slot="{ Component }">
    <keep-alive :include="CACHED_DBM_VIEWS">
      <component :is="Component" />
    </keep-alive>
  </router-view>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import { provideDbmTabCounts } from "@/composables/dbm/dbmTabCounts";
import {
  DBM_COUNT_FILTER_KEYS,
  useDbmTabCounts,
  type DbmCountFilters,
  type DbmTabCountsLoadOptions,
} from "@/composables/dbm/useDbmTabCounts";
import { rangeFromQuery, periodToMinutes } from "@/composables/dbm/useDbmScope";

/**
 * The list tabs, by COMPONENT name (each page declares its own via
 * `defineOptions`, so a file rename cannot silently drop it from this list).
 *
 * QueryDetailPage is absent on purpose. It is opened per fingerprint, so
 * retaining it would cache one query's detail and show it for the next — and
 * unlike the list tabs it is not somewhere the reader repeatedly returns.
 */
const CACHED_DBM_VIEWS = [
  "DbmDatabasesPage",
  "DbmQueriesPage",
  "DbmSamplesPage",
  "DbmActivityPage",
  "DbmDeadlocksPage",
  "DbmBlockedQueriesPage",
  "DbmTableHealthPage",
];

/**
 * The routes that actually RENDER the tab strip, by route name — what the
 * shell can see, where `CACHED_DBM_VIEWS` above names components.
 *
 * `dbmQueryDetail` is absent here too, and for a different reason than the
 * cache list: the detail page renders no `DbmSectionTabs`, so a fan-out on
 * that route spends its reads on badges nobody paints. It was not
 * hypothetical — opening a row ADDS the row's engine as `?system=` to the URL,
 * which re-keyed the watcher below and fired every count on every detail
 * entry (and again on every window change made there). The strip routes fetch
 * as before; returning to one re-triggers the watcher, which serves the cached
 * snapshot when the window is unchanged and refetches when it moved.
 */
const DBM_TAB_STRIP_ROUTES = new Set([
  "dbmDatabases",
  "dbmQueries",
  "dbmSamples",
  "dbmActivity",
  "dbmDeadlocks",
  "dbmBlocking",
  "dbmTableHealth",
]);

const route = useRoute();
const store = useStore();

const rendersTabStrip = computed(() => DBM_TAB_STRIP_ROUTES.has(String(route.name ?? "")));

const { counts, load, publishOwnCount } = useDbmTabCounts();

const org = computed(() => (store.state.selectedOrganization?.identifier as string) ?? "");

/**
 * The window, read from the URL rather than from a lifted `useDbmScope`.
 *
 * The route query is ALREADY how the tabs agree on a window — each page
 * seeds its scope from it and writes its picks back (see `useDbmScopeSync`), so
 * it is the section's existing source of truth and not a new one invented here.
 * Reading it means the shell needs no ownership of the pages' scope objects,
 * and a page changing the range publishes that change to the shell by the same
 * `router.replace` it already performed.
 */
const range = computed(() => rangeFromQuery(route.query));

/**
 * The reader's SCOPE, read from the route for the same reason the window is.
 *
 * All five dimensions, not `system` alone. The badges endpoint forwards each
 * to exactly the slices whose endpoint accepts it, so a badge counts what its
 * tab would show — and a dimension the shell never reads could never get
 * there. That was the bug: a URL carrying `instance=postgres` produced the
 * same badges as one without it, while the Slowest-calls TAB it labelled had
 * already narrowed from 73 rows to 0.
 */
const scopeFilters = computed<DbmCountFilters>(() => ({
  system: (route.query.system as string) ?? null,
  instance: (route.query.instance as string) ?? null,
  namespace: (route.query.namespace as string) ?? null,
  env: (route.query.env as string) ?? null,
  service: (route.query.service as string) ?? null,
}));

const MINUTE_US = 60_000_000;

/**
 * The bounds the endpoints take.
 *
 * A relative range is resolved against `Date.now()` HERE rather than against
 * `useDbmScope`'s shared anchor. The anchor exists so that every request in one
 * page's refresh cycle describes one instant; this fan-out is its own cycle and
 * has no delta to corrupt. Resolving here also keeps the shell from having to
 * instantiate a scope whose `refresh()` would re-pin the anchor behind the
 * active page's back.
 */
const window = computed(() => {
  if (range.value.type === "absolute") {
    return { startTime: range.value.startTime, endTime: range.value.endTime };
  }
  const end = Date.now() * 1000;
  return {
    startTime: end - periodToMinutes(range.value.relativeTimePeriod) * MINUTE_US,
    endTime: end,
  };
});

/**
 * Refetch under whatever the URL currently says.
 *
 * The pages' refresh buttons call this. They pass `force` and nothing else —
 * the scope is the shell's, so a page cannot ask for a window other than the
 * one on screen.
 */
const refresh = (options: DbmTabCountsLoadOptions = {}) => {
  // Guarded HERE rather than only in the watcher so no caller — present or
  // future — can spend the fan-out's reads on a route with no badges to fill.
  if (!rendersTabStrip.value) return;
  void load(org.value, range.value, window.value, scopeFilters.value, options);
};

/**
 * Fetch on arrival and whenever the QUESTION changes.
 *
 * Keyed on the org, the chosen range and the filter — never on `window`, whose
 * relative bounds are recomputed from the clock on every access and would fire
 * this watcher forever. `immediate` covers the initial landing, so no page has
 * to trigger the first fan-out. `rendersTabStrip` is in the key so LEAVING the
 * detail route re-fires it: the counts skipped while there are fetched the
 * moment a strip is back on screen to show them (a cache hit when the window
 * did not move).
 */
watch(
  () => [
    org.value,
    range.value.type,
    range.value.relativeTimePeriod,
    range.value.startTime,
    range.value.endTime,
    // Every dimension, or a cache keyed on less than it sends would serve the
    // first scope's answer to every later one.
    ...DBM_COUNT_FILTER_KEYS.map((key) => scopeFilters.value[key]),
    rendersTabStrip.value,
  ],
  () => refresh(),
  { immediate: true },
);

// `publishOwnCount` rides along so a page can write the badge IT measured
// better than the fan-out can into the shared snapshot — the thing that makes
// a refined count visible from every tab and not only from the page that
// produced it. See useDbmListPage's `ownCounts`.
provideDbmTabCounts({ counts, refresh, publishOwnCount });
</script>
