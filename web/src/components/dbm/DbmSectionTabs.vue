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
  DbmSectionTabs — the L2 switcher between the two views of one dataset.

  Structurally a copy of PipelineSectionTabs: the active tab is derived from the
  route (never from local state, so a deep link and the back button both land
  lit correctly), and clicking pushes. Two departures, both load-bearing:

    • The CURRENT SCOPE travels in `to`. Databases and Top queries describe the
      same databases over the same window, so switching tab must not silently
      reset the filters the user just set — that is the "scope carries across
      tabs and pivots via the URL" rule. Everything except the routing params
      is spread through.

    • The BADGE COUNTS ARE NOT ALL THE SAME GRAIN, deliberately. Overview and
      Top queries count their own rows, but Deadlocks counts EVENTS while its
      table shows query pairs. A tab label answers "how much is happening";
      the rows answer "what is wrong". 43 deadlocks from 2 pairs would read as
      a quiet tab if the badge said 2, and row 1 saying "39 times" already
      makes the relationship self-evident.

  The query detail route maps back to the Top queries tab (see `ROUTE_TO_TAB`),
  so drilling into a query does not unlight the tab it was opened from.
-->
<template>
  <OTabs :model-value="activeTab" align="left" data-test="dbm-section-tabs" @change="navigate">
    <OTab
      v-for="section in sections"
      :key="section.key"
      :name="section.key"
      :data-test="`dbm-section-tab-${section.key}`"
    >
      <span>{{ section.label }}</span>
      <!-- The count is what the tab is about, so the reader can see the shape
           of the other views without opening them. -->
      <span
        v-if="section.count != null"
        class="text-2xs rounded-full px-1.5 py-1 leading-none font-bold"
        :class="
          section.key === activeTab
            ? 'bg-badge-primary-soft-bg text-badge-primary-soft-text'
            : 'bg-surface-subtle text-text-secondary'
        "
        >{{ section.count }}</span
      >
      <OTooltip v-if="section.hint" side="bottom" :content="section.hint" />
    </OTab>
  </OTabs>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";

import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = defineProps<{
  /** Row count shown on the Overview tab. */
  databaseCount?: number | null;
  /** Row count shown on the Top queries tab. */
  queryCount?: number | null;
  /**
   * DEADLOCK EVENTS in the window — not the number of query pairs the table
   * shows. The badge answers "how much is happening".
   */
  deadlockCount?: number | null;
  /** Sessions currently waiting on a lock. */
  blockedCount?: number | null;
  /**
   * Sessions in the window, from the SQL breakdown — NOT `hits.length`, which
   * is a row-limited sample and would read as a constant cap on a busy
   * instance. Same "how much is happening" grain as the deadlock badge.
   */
  activityCount?: number | null;
  /**
   * Relations reported in the window. POSTGRES-ONLY, so `null` on a fleet with
   * no Postgres is honest rather than `0` — the badge must not claim zero
   * tables for an engine the recipe never queries.
   */
  tableHealthCount?: number | null;
}>();

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();

/**
 * Route name → tab key. The detail route resolves to the tab it was opened
 * from, so the highlight follows what the user is looking at rather than the
 * literal route — the same reason PipelineSectionTabs maps its editor and
 * history routes back to `streamPipelines`.
 */
const ROUTE_TO_TAB: Record<string, string> = {
  dbmDatabases: "overview",
  dbmQueries: "queries",
  dbmQueryDetail: "queries",
  dbmActivity: "activity",
  dbmDeadlocks: "deadlocks",
  dbmBlocking: "blocked",
  dbmTableHealth: "tableHealth",
};

const activeTab = computed(() => ROUTE_TO_TAB[route.name as string] ?? "overview");

interface Section {
  key: string;
  label: I18nText;
  to: RouteLocationRaw | null;
  count?: number | null;
  /** What the count means, when that is not obvious from the label. */
  hint?: I18nText;
}

/**
 * Everything the user has set — filters, search, time range — rides along, so
 * the two tabs read as two views of ONE scope. `fingerprint` and `stream` are
 * dropped: they identify a single query on the detail page and mean nothing on
 * a list, so carrying them would put a stale row id in the URL of a table.
 */
const carriedQuery = computed(() => {
  const { fingerprint, stream, ...rest } = route.query;
  void fingerprint;
  void stream;
  return rest;
});

const sections = computed<Section[]>(() => [
  {
    key: "overview",
    label: t("dbm.page.tabs.overview"),
    to: { name: "dbmDatabases", query: carriedQuery.value },
    count: props.databaseCount ?? null,
  },
  {
    key: "queries",
    label: t("dbm.page.tabs.queries"),
    to: { name: "dbmQueries", query: carriedQuery.value },
    count: props.queryCount ?? null,
  },
  {
    // Before the two lock tabs: "what is happening now" is the question a
    // reader asks before drilling into any one query.
    key: "activity",
    label: t("dbm.page.tabs.activity"),
    to: { name: "dbmActivity", query: carriedQuery.value },
    count: props.activityCount ?? null,
    hint: t("dbm.page.tabs.activityHint"),
  },
  {
    key: "deadlocks",
    label: t("dbm.page.tabs.deadlocks"),
    to: { name: "dbmDeadlocks", query: carriedQuery.value },
    count: props.deadlockCount ?? null,
    hint: t("dbm.page.tabs.deadlocksHint"),
  },
  {
    key: "blocked",
    label: t("dbm.page.tabs.blocked"),
    to: { name: "dbmBlocking", query: carriedQuery.value },
    count: props.blockedCount ?? null,
    hint: t("dbm.page.tabs.blockedHint"),
  },
  {
    // LAST: schema health is the slow-moving background question, read after
    // the four "what is happening right now" views rather than before them.
    key: "tableHealth",
    label: t("dbm.page.tabs.tableHealth"),
    to: { name: "dbmTableHealth", query: carriedQuery.value },
    count: props.tableHealthCount ?? null,
    hint: t("dbm.page.tabs.tableHealthHint"),
  },
]);

const navigate = (key: string | number) => {
  if (key === activeTab.value) return;
  const section = sections.value.find((s) => s.key === key);
  if (!section?.to) return;
  router.push(section.to).catch(() => {});
};
</script>
