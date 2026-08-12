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

  The six DBM tabs are separate ROUTES, so every switch destroyed the outgoing
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
-->
<template>
  <router-view v-slot="{ Component }">
    <keep-alive :include="CACHED_DBM_VIEWS">
      <component :is="Component" />
    </keep-alive>
  </router-view>
</template>

<script setup lang="ts">
/**
 * The six list tabs, by COMPONENT name (each page declares its own via
 * `defineOptions`, so a file rename cannot silently drop it from this list).
 *
 * QueryDetailPage is absent on purpose. It is opened per fingerprint, so
 * retaining it would cache one query's detail and show it for the next — and
 * unlike the list tabs it is not somewhere the reader repeatedly returns.
 */
const CACHED_DBM_VIEWS = [
  "DbmDatabasesPage",
  "DbmQueriesPage",
  "DbmActivityPage",
  "DbmDeadlocksPage",
  "DbmBlockedQueriesPage",
  "DbmTableHealthPage",
];
</script>
