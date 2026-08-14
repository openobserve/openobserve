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
  DbmSectionTabs — the L2 switcher across the seven views of one database
  scope: Overview, Top queries, Slowest calls, Activity, Deadlocks, Blocked
  queries and Table health.

  Structurally a copy of PipelineSectionTabs: the active tab is derived from the
  route (never from local state, so a deep link and the back button both land
  lit correctly), and clicking pushes. Two departures, both load-bearing:

    • The CURRENT SCOPE travels in `to`. Every tab describes the same databases
      over the same window, so switching tab must not silently reset the
      filters the user just set — that is the "scope carries across tabs and
      pivots via the URL" rule. Everything except the routing params is spread
      through.

    • THE BADGE-GRAIN RULE (stated once, here; the count props defer to it).
      The badge answers "how much is happening"; the table shows a cut of that
      population, and the two are deliberately NOT the same number — deadlocks:
      events vs query pairs; activity: population vs sampled rows; samples:
      finished calls vs a capped top-list. 43 deadlocks from 2 pairs would read
      as a quiet tab if the badge said 2, and a capped row count would render
      as a meaningless constant beside the real totals.

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
           of the other views without opening them.

           An OVERLAP count (calls) carries its vantage as a suffix on the
           badge itself — `141,984 client` — because D2 makes the qualifier
           mandatory wherever an overlap value renders, and this badge is the
           one place the same number appears on all eight pages. The suffix is
           absent for the counts that exist in one vantage only: qualifying a
           deadlock count would imply a choice between feeds that was never
           available. -->
      <span
        v-if="section.count != null"
        class="text-2xs inline-flex items-baseline gap-1 rounded-full px-1.5 py-1 leading-none font-bold"
        :class="
          section.key === activeTab
            ? 'bg-badge-primary-soft-bg text-badge-primary-soft-text'
            : 'bg-surface-subtle text-text-secondary'
        "
        :data-test="`dbm-section-tab-badge-${section.key}`"
        ><span>{{ section.count }}</span
        ><span
          v-if="section.vantageLabel"
          class="text-3xs font-normal opacity-80"
          :data-test="`dbm-section-tab-vantage-${section.key}`"
          >{{ section.vantageLabel }}</span
        ></span
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
import { badgeCount, countVantage, type DbmCountClaim } from "@/utils/dbm/format";

/**
 * A badge count is either a plain number (no cap to report) or a
 * [`DbmCountClaim`], which also says whether the read that produced it was
 * capped. A capped count renders `100+` rather than `100` — see `badgeCount`.
 */
type BadgeCount = DbmCountClaim | number | null;

const props = defineProps<{
  /** Row count shown on the Overview tab. */
  databaseCount?: BadgeCount;
  /** Row count shown on the Top queries tab. */
  queryCount?: BadgeCount;
  /**
   * FINISHED CALLS in the window, for the Slowest-calls tab — not that page's
   * capped top-list row count. See the header's badge-grain rule.
   */
  sampleCallsCount?: BadgeCount;
  /**
   * DEADLOCK EVENTS in the window — not the query pairs the table shows. See
   * the header's badge-grain rule.
   *
   * Pass a `DbmCountClaim` where the read can be capped: the deadlocks and
   * blocking endpoints cap at `limit` and disclose it with `truncated`, and a
   * bare number there prints the cap as if it were the total.
   */
  deadlockCount?: BadgeCount;
  /** Sessions currently waiting on a lock. */
  blockedCount?: BadgeCount;
  /**
   * Sessions in the window, from the SQL breakdown — not the row-limited
   * `hits.length`. See the header's badge-grain rule.
   */
  activityCount?: BadgeCount;
  /**
   * Relations reported in the window. POSTGRES-ONLY, so `null` on a fleet with
   * no Postgres is honest rather than `0` — the badge must not claim zero
   * tables for an engine the recipe never queries.
   */
  tableHealthCount?: BadgeCount;
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
  dbmSamples: "samples",
  dbmActivity: "activity",
  dbmDeadlocks: "deadlocks",
  dbmBlocking: "blocked",
  dbmTableHealth: "tableHealth",
};

/**
 * The detail route can be entered from four tabs, and the highlight must
 * follow the one the reader actually came from (`?from=`, set by the origin
 * page) — an Activity reader drilling into a session must not see Top queries
 * light up. Values outside this set (absent, stale, hand-edited) fall back to
 * the static map's `queries`, the detail page's natural parent.
 */
const DETAIL_ORIGIN_TABS = new Set(["queries", "activity", "samples", "deadlocks"]);

const activeTab = computed(() => {
  if (route.name === "dbmQueryDetail") {
    const from = String(route.query.from ?? "");
    if (DETAIL_ORIGIN_TABS.has(from)) return from;
  }
  return ROUTE_TO_TAB[route.name as string] ?? "overview";
});

interface Section {
  key: string;
  label: I18nText;
  to: RouteLocationRaw;
  /**
   * The badge as it will be PRINTED — `"43"`, `"100+"`, or `null` for a count
   * we do not have. Resolved through `badgeCount` so a capped read cannot
   * reach the template as a bare total.
   */
  count?: string | null;
  /**
   * The vantage suffix printed beside an OVERLAP count, or `undefined` for a
   * count with only one possible source. Resolved from the count itself, so a
   * badge cannot be qualified with a vantage that did not produce it.
   */
  vantageLabel?: I18nText;
  /** What the count means, when that is not obvious from the label. */
  hint?: I18nText;
}

/**
 * The qualifier and the sentence for an overlap badge, chosen by the vantage
 * that actually produced the number.
 *
 * The hint is resolved with the count rather than stated once in the locale
 * file because the SAME badge is fed by three different reads — the trace
 * rollup, the database's own slowest-statement list, and a page's own
 * override — and a hint fixed at one of them is false in the other two. The
 * old copy ("Every finished call in this window") was the trace sentence
 * printed over all three: false for a server-fed badge, and false even for the
 * trace one, which counts every finished INSTRUMENTED call.
 */
const overlapBadge = (
  count: DbmCountClaim | number | null | undefined,
): { vantageLabel?: I18nText; hint: I18nText } => {
  const vantage = countVantage(count);
  if (vantage === "server") {
    return {
      vantageLabel: t("dbm.list.overlap.serverCounted"),
      hint: t("dbm.page.tabs.samplesHintServer"),
    };
  }
  if (vantage === "client") {
    return {
      vantageLabel: t("dbm.list.overlap.clientObserved"),
      hint: t("dbm.page.tabs.samplesHintClient"),
    };
  }
  // No vantage travelled with the count, so nothing about its source can be
  // claimed. The hint says what the tab is FOR and asserts no population.
  return { hint: t("dbm.page.tabs.samplesHintUnknown") };
};

/** The Top-queries badge's source marker, on the same terms as the overlap one. */
const queriesVantageLabel = computed<I18nText | undefined>(() => {
  const vantage = countVantage(props.queryCount);
  if (vantage === "server") return t("dbm.list.overlap.serverCounted");
  if (vantage === "client") return t("dbm.list.overlap.clientObserved");
  return undefined;
});

/**
 * Everything the user has set — filters, search, time range — rides along, so
 * the tabs read as views of ONE scope. `fingerprint`, `stream` and `from` are
 * dropped: the first two identify a single query on the detail page and mean
 * nothing on a list, and `from` records which tab opened the detail page —
 * carrying any of them would put a stale detail-page key in a table's URL.
 */
const carriedQuery = computed(() => {
  const { fingerprint, stream, from, ...rest } = route.query;
  void fingerprint;
  void stream;
  void from;
  return rest;
});

const sections = computed<Section[]>(() => [
  {
    key: "overview",
    label: t("dbm.page.tabs.overview"),
    to: { name: "dbmDatabases", query: carriedQuery.value },
    count: badgeCount(props.databaseCount),
  },
  {
    key: "queries",
    label: t("dbm.page.tabs.queries"),
    to: { name: "dbmQueries", query: carriedQuery.value },
    count: badgeCount(props.queryCount),
    // Not an overlap MEASURE (a distinct-statement count is not calls or
    // database time), but its provenance swaps between the trace rollup and
    // the database-reported list exactly as the samples badge's does — so the
    // reader is told which list was counted, on the same terms.
    vantageLabel: queriesVantageLabel.value,
  },
  {
    // Beside Top queries, deliberately: the aggregate and the per-execution
    // view of the same client-observed data.
    key: "samples",
    label: t("dbm.page.tabs.samples"),
    to: { name: "dbmSamples", query: carriedQuery.value },
    count: badgeCount(props.sampleCallsCount),
    // A CALL COUNT — one of the exactly two overlap measures — so it carries
    // its vantage rather than the generic population claim it used to make.
    ...overlapBadge(props.sampleCallsCount),
  },
  {
    // Before the two lock tabs: "what is happening now" is the question a
    // reader asks before drilling into any one query.
    key: "activity",
    label: t("dbm.page.tabs.activity"),
    to: { name: "dbmActivity", query: carriedQuery.value },
    count: badgeCount(props.activityCount),
    hint: t("dbm.page.tabs.activityHint"),
  },
  {
    key: "deadlocks",
    label: t("dbm.page.tabs.deadlocks"),
    to: { name: "dbmDeadlocks", query: carriedQuery.value },
    count: badgeCount(props.deadlockCount),
    hint: t("dbm.page.tabs.deadlocksHint"),
  },
  {
    key: "blocked",
    label: t("dbm.page.tabs.blocked"),
    to: { name: "dbmBlocking", query: carriedQuery.value },
    count: badgeCount(props.blockedCount),
    hint: t("dbm.page.tabs.blockedHint"),
  },
  {
    // LAST: schema health is the slow-moving background question, read after
    // the four "what is happening right now" views rather than before them.
    key: "tableHealth",
    label: t("dbm.page.tabs.tableHealth"),
    to: { name: "dbmTableHealth", query: carriedQuery.value },
    count: badgeCount(props.tableHealthCount),
    hint: t("dbm.page.tabs.tableHealthHint"),
  },
]);

const navigate = (key: string | number) => {
  if (key === activeTab.value) return;
  const section = sections.value.find((s) => s.key === key);
  if (!section) return;
  router.push(section.to).catch(() => {});
};
</script>
