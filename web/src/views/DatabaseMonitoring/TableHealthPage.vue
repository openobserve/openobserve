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
  W10 — Table health. The newest snapshot of every relation, largest first.

  THE TWO SENTENCES THIS PAGE MUST NOT GET WRONG, both rendered as a persistent
  subheader rather than a tooltip, because a reader who misses them draws a
  stronger conclusion than the data supports:

    • The scan and vacuum counts are LIFETIME totals since the last
      `pg_stat_reset()`. They are NOT counts for the selected time range, and
      the column headers say "(lifetime)" for the same reason.
    • The row counts and bloat percentage are planner ESTIMATES, not exact
      counts.

  Both come off the API's response envelope rather than being hardcoded here —
  see `scanCountDisclosure`/`tupleCountDisclosure`.

  POSTGRES-ONLY, and the empty state says which of the two reasons applies. A
  MySQL user seeing an unexplained empty table reads it as "no problems found"
  about a check that never ran, which is the one wrong answer this surface can
  give.

  W11 adds a RECOMMENDATIONS strip above the table: deterministic checks over
  the same feed plus index stats, activity and blocking. Each states what it
  measured and which threshold it crossed, and none asserts a cause — see
  `utils/dbm/recommendations.ts`. They are plain predicates, NOT AI, and are
  deliberately not gated on `ai_enabled`/`isEnterprise`: DBM is all-OSS.
-->
<template>
  <DbmPageChrome
    :title="t('dbm.tableHealth.title')"
    :subtitle="t('dbm.tableHealth.subtitle')"
    title-data-test="dbm-table-health-title"
    date-time-data-test="dbm-table-health-date-time"
    :tab-counts="tabCounts"
    :range="range"
    @date-change="onDateChange"
  >
    <div class="flex min-h-0 flex-1 flex-col">
      <!-- W11 · Recommendations. Deterministic checks, each showing the
           arithmetic that fired it. The rule line is one hover away rather
           than in the primary reading path: a recommendation you cannot audit
           is one readers learn to scroll past. -->
      <!-- Gated on `!loading`, like every other verdict on this page: the
           inner branches always have something to say (a list, or one of the
           two empty states), and "All clear" on first paint would assert a
           verdict before any data has answered. -->
      <section
        v-if="!loading"
        class="border-border-subtle bg-surface-base px-page-edge flex flex-col gap-1.5 border-b py-2"
        data-test="dbm-recommendations"
      >
        <div class="flex items-baseline gap-2">
          <span class="text-text-heading text-xs font-semibold">
            {{ t("dbm.recommendations.title") }}
          </span>
          <span class="text-text-secondary text-2xs">
            {{ t("dbm.recommendations.subtitle") }}
          </span>
        </div>

        <!-- ONE ROW PER RULE, not one per detected item. `buildRecommendations`
             emits an entry for every blocker and every long-running session, so
             a busy database produced dozens of list items and the strip stopped
             being read at all. `collapseRecommendations` keeps the WORST item of
             each rule and reports how many it stands for — the remainder is
             disclosed in the row rather than dropped, because a strip that
             quietly showed a subset would present itself as more complete than
             it is. -->
        <ul v-if="collapsedRecommendations.length" class="flex flex-col gap-1">
          <li
            v-for="entry in collapsedRecommendations"
            :key="entry.rec.id"
            class="flex items-center gap-2"
            :data-test="`dbm-recommendation-${entry.rec.id}`"
          >
            <span
              class="rounded-default grid size-4.5 shrink-0 place-items-center"
              :class="DBM_SOFT_TONES[entry.rec.tone]"
            >
              <OIcon :name="DBM_TONE_ICONS[entry.rec.tone]" size="xs" />
            </span>
            <span class="text-text-heading text-xs font-semibold whitespace-nowrap">
              {{ t(`dbm.recommendations.${entry.rec.id}.title`) }}
            </span>
            <span class="text-text-secondary text-2xs">{{ recommendationBody(entry.rec) }}</span>
            <!-- What the shown row stands for. Present ONLY when something is
                 actually hidden, so it never claims a remainder that is not
                 there. -->
            <span
              v-if="entry.hiddenCount > 0"
              class="text-text-secondary text-2xs whitespace-nowrap italic"
              :data-test="`dbm-recommendation-more-${entry.rec.id}`"
            >
              {{ t("dbm.recommendations.andMore", { count: entry.hiddenCount }) }}
            </span>
            <!-- The predicate, verbatim. Provenance out of the primary reading
                 path but never out of reach. -->
            <OTooltip side="bottom" :content="recommendationRule(entry.rec)" />
          </li>
        </ul>

        <!-- The two empty states are NOT interchangeable. On an engine whose
             index catalogs are never read, "nothing found" would be an
             all-clear about a check that did not run. -->
        <DbmDisclosureLine
          v-else-if="recommendationsEmpty === 'engine-partial'"
          data-test="dbm-recommendations-engine-partial"
        >
          <strong class="font-semibold">{{ t("dbm.recommendations.enginePartialTitle") }}</strong>
          — {{ t("dbm.recommendations.enginePartialDescription") }}
        </DbmDisclosureLine>
        <DbmDisclosureLine v-else icon="check" data-test="dbm-recommendations-all-clear">
          <strong class="font-semibold">{{ t("dbm.recommendations.allClearTitle") }}</strong>
          — {{ t("dbm.recommendations.allClearDescription") }}
        </DbmDisclosureLine>

        <!-- Gated on the API's own flag: a build whose response omits it has
             not told us the counters are cumulative, and asserting it anyway
             would invent a disclosure. -->
        <DbmDisclosureLine
          v-if="indexCountersAreCumulative"
          data-test="dbm-recommendations-cumulative"
        >
          {{ t("dbm.recommendations.countersCumulative") }}
        </DbmDisclosureLine>
      </section>

      <OTable
        :data="rows"
        :columns="columns"
        row-key="rowKey"
        :loading="loading"
        :error="error"
        :frame="false"
        sorting="client"
        :show-global-filter="false"
        table-id="dbm-table-health"
        :total-count-exact="!truncated"
        persist-columns
        :column-visibility="defaultColumnVisibility"
        data-test="dbm-table-health-table"
      >
        <!-- Magnitude bars. The bar ACCOMPANIES the formatted number, never
             replaces it: `tableSizeLabel` and the two-decimal percentage are
             the honest measurements, and the bar only makes their relative size
             scannable. Which columns qualify, and why the lifetime counters do
             not, is argued at `TableHealthBarScale`. -->
        <!-- The three byte columns are one cell three times: same formatter,
             same tone, each scaled to its OWN column's worst row (a shared
             reference would make the heap bar a copy of the total bar). Only
             the field and the data-test differ, so they are a loop. -->
        <template
          v-for="column in SIZE_BAR_COLUMNS"
          :key="column.key"
          #[`cell-${column.key}`]="{ row }"
        >
          <ODataBarCell
            :value="row[column.key]"
            :max="sizeColumnMax[column.key]"
            :display="tableSizeLabel(row[column.key])"
            :data-test="`dbm-table-health-${column.dataTest}-${row.rowKey}`"
          />
        </template>

        <!-- Already a 0-100 proportion, so its 100% reference is the literal
             100 — NOT the worst row. Scaling bloat to the column max would
             paint a 3%-bloated table as a full bar just for topping a healthy
             list.

             The 20% danger tone is Postgres's own default
             `autovacuum_vacuum_scale_factor` (0.2) — the point at which the
             server itself considers the table due for a vacuum. The 10%
             warning is simply half of it, a lead-in and not a threshold any
             rule fires on. Neither claims the table NEEDS action: they tint a
             bar, and the recommendation strip is where a threshold becomes a
             stated finding. -->
        <template #cell-dead_tup_pct="{ row }">
          <ODataBarCell
            :value="row.dead_tup_pct"
            :max="100"
            :display="row.dead_tup_pct == null ? '—' : `${row.dead_tup_pct.toFixed(2)}%`"
            :variant="
              (row.dead_tup_pct ?? 0) >= 20
                ? 'danger'
                : (row.dead_tup_pct ?? 0) >= 10
                  ? 'warning'
                  : 'default'
            "
            :data-test="`dbm-table-health-dead-tup-pct-${row.rowKey}`"
          />
        </template>

        <template #toolbar>
          <DbmTableToolbar
            v-model:search="search"
            :placeholder="t('dbm.tableHealth.searchPlaceholder')"
            :debounce="400"
            search-data-test="dbm-table-health-search"
          >
            <DbmScopeFilters
              class="min-w-0 flex-1"
              :filters="dimensionFilters"
              @clear="clearScope"
            />
          </DbmTableToolbar>
        </template>

        <template #toolbar-trailing>
          <DbmRefreshButton
            :loading="loading"
            :last-run-at="lastRunAt"
            data-test="dbm-table-health-refresh"
            @refresh="onRefresh"
          />
        </template>

        <!-- The disclosures live here, always visible, never behind a hover.
             A reader who does not see them will read a lifetime counter as a
             per-window one. -->
        <template #subheader>
          <div
            v-if="disclosures.length"
            class="border-border-default bg-surface-subtle px-page-edge flex flex-col gap-1 border-b py-2"
            data-test="dbm-table-health-disclosures"
          >
            <DbmDisclosureLine v-for="line in disclosures" :key="line">
              {{ line }}
            </DbmDisclosureLine>
          </div>
        </template>

        <template #bottom>
          <div
            class="text-text-secondary flex w-full items-center gap-2.5"
            data-test="dbm-table-health-status-bar"
          >
            <span>{{ countLine }}</span>
          </div>
        </template>

        <template #empty>
          <!-- A search that matched nothing is not an absence of tables. -->
          <OEmptyState
            v-if="!loading && searchHidEverything"
            preset="no-search-results"
            data-test="dbm-table-health-no-matches"
            @action="search = ''"
          />
          <!-- The engine has no such recipe. Telling this reader to switch on
               collection would send them to fix a non-problem — which is why
               the checklist here is EMPTY: the "to start collecting" steps are
               Postgres steps, and offering them to a MySQL user is the exact
               wrong answer this state exists to avoid. -->
          <DbmLockEmptyState
            v-else-if="!loading && emptyCause === 'engine-unsupported'"
            :healthy="false"
            :title="t('dbm.tableHealth.engineUnsupportedTitle')"
            :description="t('dbm.tableHealth.engineUnsupportedDescription')"
            :checklist-title="raw('')"
            :checks="[]"
            data-test="dbm-table-health-engine-unsupported"
          />
          <!-- The engine supports it and nothing arrived: actionable. -->
          <DbmLockEmptyState
            v-else-if="!loading && emptyCause === 'not-collecting'"
            :healthy="false"
            :title="t('dbm.tableHealth.notCollectingTitle')"
            :description="t('dbm.tableHealth.notCollectingDescription')"
            :checklist-title="t('dbm.tableHealth.checklistTitle')"
            :checks="notCollectingChecks"
            data-test="dbm-table-health-not-collecting"
          />
        </template>
      </OTable>
    </div>
  </DbmPageChrome>
</template>

<script setup lang="ts">
// Explicit name so <keep-alive :include> in DbmShell.vue matches this view.
// Without it the name is inferred from the FILENAME, so a rename would
// silently drop the page from the cache and bring back the refetch-on-return.
defineOptions({ name: "DbmTableHealthPage" });

import { computed, ref, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";

import DbmDisclosureLine from "@/components/dbm/DbmDisclosureLine.vue";
import DbmLockEmptyState, { type DbmLockCheck } from "@/components/dbm/DbmLockEmptyState.vue";
import DbmPageChrome from "@/components/dbm/DbmPageChrome.vue";
import DbmRefreshButton from "@/components/dbm/DbmRefreshButton.vue";
import DbmScopeFilters from "@/components/dbm/DbmScopeFilters.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
// The shared in-cell magnitude bar from the core Table library — the same one
// QueryDetailPage already uses. Preferred over the traces plugin's
// ServiceCatalogBarCell, which is equivalent but lives under plugins/traces/
// and would make this the first DBM view reaching across a plugin boundary.
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import DbmTableToolbar from "@/components/dbm/DbmTableToolbar.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import dbMonitoringService from "@/services/db_monitoring";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { tabCountProps } from "@/composables/dbm/useDbmTabCounts";
import { useDbmListPage } from "@/composables/dbm/useDbmListPage";
import { useDbmScopeFilters } from "@/composables/dbm/useDbmScopeFilters";
import { useDbmSearchEmpty } from "@/composables/dbm/useDbmSearchEmpty";
import {
  scanCountDisclosure,
  tableHealthColumns,
  tableHealthEmptyCause,
  tableHealthRows,
  tableSizeLabel,
  tupleCountDisclosure,
  type TableHealthCoverage,
  type TableHealthEmptyCause,
  type TableHealthRow,
} from "@/utils/dbm/tableHealth";
import {
  buildRecommendations,
  collapseRecommendations,
  recommendationRuleParams,
  recommendationsEmptyCause,
  type DbmRecommendation,
  type IndexHealthRow,
} from "@/utils/dbm/recommendations";
import { countClaim, formatCount } from "@/utils/dbm/format";
import { formatDurationMs } from "@/utils/dbm/activity";
import { DBM_SOFT_TONES, DBM_TONE_ICONS } from "@/utils/dbm/tones";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();

// The shared list-page spine: scope from the URL, the request-sequence guard,
// the shell's badge snapshot, refresh/date-change handlers and the load
// envelope. See useDbmListPage.
//
// This page used to pass `syncUrl: null` — it read the URL but never wrote it.
// That was defensible while it had no filters of its own: there was nothing to
// publish beyond the range. Now that it carries scope, silence would be a bug:
// the reader's engine/database pick would apply to the table but vanish from
// the URL, so a tab switch or a shared link would reopen an unfiltered page
// while the chip had promised otherwise.
const {
  scope: { range, current, queryParams },
  requestSeq,
  tabCountsContext,
  loading,
  error,
  search,
  lastRunAt,
  org,
  run,
  onRefresh,
  onDateChange,
} = useDbmListPage({
  load: () => load(),
  syncUrl: () => syncUrl(),
  // The relations this page actually loaded, published so the badge reads the
  // same from every tab rather than only while standing here.
  // `undefined` until this page has actually read. `tableHealthCount` is
  // `null` before the rows land, and `null` is an assertion of unknown that
  // would BLANK the shell's real count rather than defer to it.
  ownCounts: [
    {
      key: "tableHealthCount",
      value: () => (lastRunAt.value === null ? undefined : (tableHealthCount.value ?? undefined)),
    },
  ],
});

const hits = shallowRef<TableHealthRow[]>([]);
const truncated = ref(false);
const coverage = ref<TableHealthCoverage>("unknown");
const countersAreCumulative = ref(false);
const tuplesAreEstimated = ref(false);

/**
 * The sibling badges from the shell's shared fan-out, plus THIS tab's own
 * count in place of the shared one. `tableHealthCount` is defined below, off
 * the relations this page actually loaded.
 */
/** Every badge, from the shell's shared snapshot — this page's own included. */
const tabCounts = computed(() => tabCountProps(tabCountsContext.counts.value));

const allRows = computed(() => tableHealthRows(hits.value));

/** Free-text over the qualified name and the instance. */
const rows = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return allRows.value;
  return allRows.value.filter(
    (r) =>
      r.qualifiedName.toLowerCase().includes(needle) ||
      (r.instance ?? "").toLowerCase().includes(needle),
  );
});

/** This tab's own badge: relations reported, not the row-limited render. */
// A CLAIM, so a capped read renders `100+` rather than printing the cap as
// the population — the same disclosure the deadlocks and blocking badges make.
const tableHealthCount = computed(() =>
  hits.value.length ? countClaim(hits.value.length, truncated.value) : null,
);

const searchHidEverything = useDbmSearchEmpty(search, allRows, rows);

const emptyCause = computed<TableHealthEmptyCause | null>(() =>
  tableHealthEmptyCause({ engine_coverage: coverage.value, hits: hits.value }),
);

/**
 * The persistent disclosures. Both are gated on the API having made the claim,
 * so a build whose response omits them renders no sentence rather than an
 * invented one.
 */
const disclosures = computed(() =>
  [
    scanCountDisclosure({ counters_are_cumulative: countersAreCumulative.value }, t),
    tupleCountDisclosure({ tuples_are_estimated: tuplesAreEstimated.value }, t),
  ].filter((line): line is NonNullable<typeof line> => line != null),
);

const countLine = computed(() => t("dbm.tableHealth.countLine", { count: rows.value.length }));

/**
 * The "to start collecting" steps, in the checklist shape DbmLockEmptyState
 * renders (`title` is the visible line; a shapeless `{ label }` here would
 * paint three blank rows). All three are `note`: they are instructions, not
 * observations, and a ✓ or ✕ would claim a check this page never ran. Each key
 * carries the whole sentence, so the detail slot stays empty.
 */
const notCollectingChecks = computed<DbmLockCheck[]>(() => [
  { id: "recipe", status: "note", title: t("dbm.tableHealth.checkRecipe"), detail: raw("") },
  { id: "grant", status: "note", title: t("dbm.tableHealth.checkGrant"), detail: raw("") },
  { id: "range", status: "note", title: t("dbm.tableHealth.checkRange"), detail: raw("") },
]);

/**
 * Sizes lead, because "which table is eating the disk" is the question that
 * opens this page. The lifetime counters are present but hidden by default:
 * they are the columns most easily misread, and W11 is what turns them into a
 * verdict.
 */
const defaultColumnVisibility = {
  seq_tup_read: false,
  frozen_xid_age: false,
  last_analyze: false,
  mod_since_analyze: false,
};

const columns = computed<OTableColumnDef[]>(() => tableHealthColumns(t));

/**
 * The 100% reference for each barred size column, taken over the rows CURRENTLY
 * RENDERED (post-search) rather than the full feed — a bar has to be readable
 * against what is on screen, and scaling to a filtered-out row would leave every
 * visible bar stubby for no reason the reader can see.
 *
 * Only the size columns need one. `dead_tup_pct` is already a percentage and is
 * scaled against 100 in the template; see `TableHealthBarScale` for why the
 * lifetime counters get no bar at all.
 */
/** The byte columns that carry a magnitude bar. */
type SizeBarColumn = "total_bytes" | "heap_bytes" | "overheadBytes";

/**
 * The byte columns that render as a magnitude bar. The `data-test` is spelled
 * out rather than derived: `overheadBytes` would kebab to `overhead-bytes` and
 * `total_bytes` would not, so a derivation here would be two rules pretending
 * to be one.
 */
const SIZE_BAR_COLUMNS: { key: SizeBarColumn; dataTest: string }[] = [
  { key: "total_bytes", dataTest: "total-bytes" },
  { key: "heap_bytes", dataTest: "heap-bytes" },
  { key: "overheadBytes", dataTest: "overhead-bytes" },
];

const sizeColumnMax = computed(() => {
  const max = (key: SizeBarColumn) => rows.value.reduce((acc, r) => Math.max(acc, r[key] ?? 0), 0);
  return {
    total_bytes: max("total_bytes"),
    heap_bytes: max("heap_bytes"),
    overheadBytes: max("overheadBytes"),
  };
});

// ─── W11 · Recommendations ───────────────────────────────────────────────────

/** The three inputs the rules predicate on, beyond the table feed itself. */
const indexHits = shallowRef<IndexHealthRow[]>([]);
const indexCountersAreCumulative = ref(false);
/**
 * The two rule inputs that are PROJECTIONS of the shared fan-out's own
 * responses — the long-running-query rule reads the activity sample, the
 * high-impact-blocker rule the blocking sample. Read from the snapshot rather
 * than refetched: a second request over the same window could disagree with
 * the badge sitting beside it.
 *
 * Always arrays, never `undefined`. This is the exact field that once arrived
 * unset from a cross-page cache hit and threw `samples is not iterable` out of
 * `chainsFromSamples`; the snapshot's uniform shape is what makes that
 * unrepresentable now. See useDbmTabCounts.
 */
const sessions = computed(() => tabCountsContext.counts.value.sessions);
const blockingSamples = computed(() => tabCountsContext.counts.value.blockingSamples);

/**
 * The rules, run over whatever arrived. Every predicate lives in
 * `utils/dbm/recommendations.ts` and is unit-tested there; this page only
 * supplies inputs and renders, so the page and the tests cannot disagree about
 * what fires.
 */
const recommendations = computed<DbmRecommendation[]>(() =>
  buildRecommendations({
    indexes: indexHits.value,
    // Copied out of the snapshot: it exposes readonly arrays (no reader may
    // mutate the shared state), and the rule inputs are mutable types. The
    // session copy is per-row because `blocking_pids` is itself a readonly
    // array in the snapshot.
    sessions: sessions.value.map((row) => ({
      ...row,
      blocking_pids: row.blocking_pids ? [...row.blocking_pids] : row.blocking_pids,
    })),
    blocking: [...blockingSamples.value],
    // The high-row-count rule reads ONE statement's server-side counters, which
    // this page does not fetch — it is surfaced on Query detail, where that
    // request already happens. Passing null here states "not evaluated" rather
    // than fabricating an input.
    serverMetrics: null,
  }),
);

/**
 * One row per RULE for rendering. The rules emit one entry per detected item,
 * which on a busy database is dozens of lines; each collapsed entry carries the
 * count it stands for so the strip can say how many it is not showing.
 */
const collapsedRecommendations = computed(() => collapseRecommendations(recommendations.value));

/**
 * Which empty state applies, or `null` when there is a list to show. The engine
 * comes off the rows we actually received: on a MySQL-only fleet the index
 * check never ran, and saying "nothing found" would be an all-clear about it.
 *
 * Predicated on the UNCOLLAPSED list: collapsing never empties a non-empty
 * list, so the two agree, and this keeps the empty-state decision tied to
 * whether any rule actually fired.
 */
const recommendationsEmpty = computed(() =>
  recommendationsEmptyCause(recommendations.value, hits.value[0]?.engine ?? ""),
);

/**
 * The headline sentence, with the numbers the rule measured. The switch is
 * exhaustive over the closed `DbmRecommendationId` union — no default, so a
 * new rule id fails to compile here instead of rendering silently blank.
 */
const recommendationBody = (rec: DbmRecommendation): I18nText => {
  const e = rec.evidence;
  switch (rec.id) {
    case "unused-index": {
      const [schema, relation, index] = rec.subject.split(".");
      return t("dbm.recommendations.unused-index.body", {
        index: index ?? rec.subject,
        relation: [schema, relation].filter(Boolean).join("."),
        size: tableSizeLabel(e.indexBytes),
      });
    }
    case "long-running-query":
      return t("dbm.recommendations.long-running-query.body", {
        pid: e.pid ?? rec.subject,
        duration: formatDurationMs(e.runningMs),
      });
    case "high-impact-blocker":
      return t("dbm.recommendations.high-impact-blocker.body", {
        pid: e.pid ?? rec.subject,
        count: e.blockedCount ?? 0,
      });
    case "high-row-count":
      return t("dbm.recommendations.high-row-count.body", {
        rows: formatCount(e.rowsPerCall),
        calls: formatCount(e.calls),
      });
  }
};

/** The predicate that fired, in words, from the constants it evaluates. */
const recommendationRule = (rec: DbmRecommendation) => {
  const { key, params } = recommendationRuleParams(rec.id);
  return t(key as Parameters<typeof t>[0], params);
};

// ─── Filters ─────────────────────────────────────────────────────────────────

/**
 * TWO dimensions, not three. `/table_health` takes no `namespace`: the feed
 * carries no database at all (the recipe reads per-database catalogs and never
 * names one), so a schema select here would return nothing for every value a
 * reader could pick. That is DatabasesPage's rule — only the dimensions the
 * endpoint ACTUALLY accepts are offered — and `useDbmScopeFilters` enforces it,
 * withholding `namespace` from the request as well as from the toolbar.
 *
 * A `namespace` carried in the URL from a sibling tab still SURVIVES a visit
 * here (see the composable's `queryParams`), so stepping through the tabs does
 * not silently strip the reader's scope.
 */
const {
  filters: dimensionFilters,
  requestParams: scopeParams,
  queryParams: scopeQuery,
  clear: clearScopeModels,
} = useDbmScopeFilters({
  query: route.query,
  // Re-read on activation: this page is kept alive, so its setup-time seed
  // above goes stale the moment a sibling tab changes the scope.
  liveQuery: () => route.query,
  // Adopting a sibling tab's scope changes the chip; only this changes the rows.
  onScopeAdopted: () => void load(),
  dimensions: ["instance", "system"],
  // The rows spell these `engine`/`instance`, not `db_system`/`db_instance` —
  // this feed's own vocabulary. The filter KEYS stay `system`/`instance`
  // because those are what the endpoint and the URL are named.
  options: () => ({
    system: hits.value.map((h) => h.engine),
    instance: hits.value.map((h) => h.instance),
  }),
  apply: () => {
    syncUrl();
    load();
  },
});

const clearScope = () => {
  clearScopeModels();
  search.value = "";
  syncUrl();
  load();
};

/**
 * Mirror the scope into the URL so it survives a tab switch, a reload and a
 * paste into someone else's chat window. Replace rather than push: a filter
 * change is not a navigation the back button should have to walk through.
 */
const syncUrl = () => {
  router
    .replace({
      name: route.name as string,
      query: {
        ...route.query,
        ...queryParams.value,
        ...scopeQuery.value,
        search: search.value || undefined,
      },
    })
    .catch(() => {});
};

const load = () =>
  run(
    async (token) => {
      // ONE request for both sections — the index search runs concurrently
      // with the table search server-side. A separate endpoint would cost a
      // full extra round trip for the same stream.
      const { data } = await dbMonitoringService.getTableHealth(org.value, {
        startTime: current.value.startTime,
        endTime: current.value.endTime,
        includeIndexes: true,
        ...scopeParams.value,
      });

      if (requestSeq.isStale(token)) return;

      hits.value = data.hits ?? [];
      // The read caps at `limit`; without this the count below is a ceiling
      // printed as a population.
      truncated.value = Boolean(data.truncated);
      coverage.value = data.engine_coverage ?? "unknown";
      countersAreCumulative.value = Boolean(data.counters_are_cumulative);
      tuplesAreEstimated.value = Boolean(data.tuples_are_estimated);

      // Index health feeds the unused-index rule, and still degrades
      // independently: `index_read_failed` is the server saying the index search
      // failed while the tables succeeded, so the rules that need no index data
      // keep rendering and no disclosure is claimed for rows never received.
      indexHits.value = data.index_read_failed ? [] : (data.index_hits ?? []);
      indexCountersAreCumulative.value =
        !data.index_read_failed && Boolean(data.index_counters_are_cumulative);
    },
    {
      reset: () => {
        hits.value = [];
        // The flags are claims the API makes; a failed request made none, so
        // they must not persist from a previous window and label stale-free
        // rows.
        countersAreCumulative.value = false;
        tuplesAreEstimated.value = false;
        indexHits.value = [];
        indexCountersAreCumulative.value = false;
      },
      // This page has no `notCollecting` ref — an unknown coverage IS its
      // "nothing has ever reported a table" state.
      onNotCollecting: () => {
        coverage.value = "unknown";
      },
    },
  );
</script>
