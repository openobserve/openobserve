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
  <OPageLayout
    :title="t('dbm.tableHealth.title')"
    :subtitle="t('dbm.tableHealth.subtitle')"
    icon="database"
    title-data-test="dbm-table-health-title"
    tabs-below
    bleed
  >
    <template #header-tabs>
      <DbmSectionTabs
        :database-count="databaseCount"
        :query-count="queryCount"
        :activity-count="activityCount"
        :deadlock-count="deadlockCount"
        :blocked-count="blockedCount"
        :table-health-count="tableHealthCount"
      />
    </template>

    <template #actions>
      <DateTime
        auto-apply
        menu-align="end"
        :default-type="range.type"
        :default-absolute-time="{ startTime: range.startTime, endTime: range.endTime }"
        :default-relative-time="range.relativeTimePeriod ?? undefined"
        data-test-name="dbm-table-health-date-time"
        class="h-8"
        @on:date-change="onDateChange"
      />
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <!-- W11 · Recommendations. Deterministic checks, each showing the
           arithmetic that fired it. The rule line is one hover away rather
           than in the primary reading path: a recommendation you cannot audit
           is one readers learn to scroll past. -->
      <section
        v-if="recommendations.length || recommendationsEmpty"
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

        <ul v-if="recommendations.length" class="flex flex-col gap-1">
          <li
            v-for="rec in recommendations"
            :key="`${rec.id}:${rec.subject}`"
            class="flex items-center gap-2"
            :data-test="`dbm-recommendation-${rec.id}`"
          >
            <span
              class="rounded-default grid size-4.5 shrink-0 place-items-center"
              :class="RECOMMENDATION_TONES[rec.tone].chip"
            >
              <OIcon :name="RECOMMENDATION_TONES[rec.tone].icon" size="xs" />
            </span>
            <span class="text-text-heading text-xs font-semibold whitespace-nowrap">
              {{ t(`dbm.recommendations.${rec.id}.title`) }}
            </span>
            <span class="text-text-secondary text-2xs">{{ recommendationBody(rec) }}</span>
            <!-- The predicate, verbatim. Provenance out of the primary reading
                 path but never out of reach. -->
            <OTooltip side="bottom" :content="recommendationRule(rec)" />
          </li>
        </ul>

        <!-- The two empty states are NOT interchangeable. On an engine whose
             index catalogs are never read, "nothing found" would be an
             all-clear about a check that did not run. -->
        <div
          v-else-if="recommendationsEmpty === 'engine-partial'"
          class="text-text-secondary text-2xs flex items-start gap-1.5"
          data-test="dbm-recommendations-engine-partial"
        >
          <OIcon name="info" class="mt-px shrink-0" size="xs" />
          <span>
            <strong class="font-semibold">{{ t("dbm.recommendations.enginePartialTitle") }}</strong>
            — {{ t("dbm.recommendations.enginePartialDescription") }}
          </span>
        </div>
        <div
          v-else
          class="text-text-secondary text-2xs flex items-start gap-1.5"
          data-test="dbm-recommendations-all-clear"
        >
          <OIcon name="check" class="mt-px shrink-0" size="xs" />
          <span>
            <strong class="font-semibold">{{ t("dbm.recommendations.allClearTitle") }}</strong>
            — {{ t("dbm.recommendations.allClearDescription") }}
          </span>
        </div>

        <!-- Gated on the API's own flag: a build whose response omits it has
             not told us the counters are cumulative, and asserting it anyway
             would invent a disclosure. -->
        <div
          v-if="indexCountersAreCumulative"
          class="text-text-secondary text-2xs flex items-start gap-1.5"
          data-test="dbm-recommendations-cumulative"
        >
          <OIcon name="info" class="mt-px shrink-0" size="xs" />
          <span>{{ t("dbm.recommendations.countersCumulative") }}</span>
        </div>
      </section>

      <OTable
        :data="rows"
        :columns="columns"
        row-key="rowKey"
        :loading="loading"
        :error="error"
        :frame="false"
        sorting="client"
        pagination="none"
        :show-global-filter="false"
        table-id="dbm-table-health"
        persist-columns
        :column-visibility="defaultColumnVisibility"
        custom-pagination-bar
        data-test="dbm-table-health-table"
      >
        <template #toolbar>
          <OSearchInput
            v-model="search"
            :debounce="400"
            clearable
            :placeholder="t('dbm.tableHealth.searchPlaceholder')"
            data-test="dbm-table-health-search"
          />
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="dbm-table-health-refresh"
            @click="load"
          >
            <OTooltip side="bottom" :content="t('dbm.common.reload')" />
          </OButton>
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
            <div
              v-for="line in disclosures"
              :key="line"
              class="text-text-secondary text-2xs flex items-start gap-1.5"
            >
              <OIcon name="info" class="mt-px shrink-0" size="xs" />
              <span>{{ line }}</span>
            </div>
          </div>
        </template>

        <template #bottom>
          <div
            class="border-border-default bg-surface-panel text-text-secondary text-2xs px-page-edge flex h-7.5 items-center gap-2.5 border-t"
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
               collection would send them to fix a non-problem. -->
          <DbmLockEmptyState
            v-else-if="!loading && emptyCause === 'engine-unsupported'"
            :healthy="false"
            :title="t('dbm.tableHealth.engineUnsupportedTitle')"
            :description="t('dbm.tableHealth.engineUnsupportedDescription')"
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
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import DbmLockEmptyState, { type DbmLockCheck } from "@/components/dbm/DbmLockEmptyState.vue";
import DbmSectionTabs from "@/components/dbm/DbmSectionTabs.vue";
import DateTime from "@/components/DateTime.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import dbMonitoringService from "@/services/db_monitoring";
import { useI18nTyped } from "@/types/i18n";
import { useDbmRequestSeq } from "@/composables/dbm/useDbmRequestSeq";
import { useDbmScope, type DbmDateChange } from "@/composables/dbm/useDbmScope";
import { activitySampleTotal } from "@/utils/dbm/activity";
import {
  scanCountDisclosure,
  tableHealthColumns,
  tableHealthEmptyCause,
  tableHealthRows,
  tupleCountDisclosure,
  type TableHealthCoverage,
  type TableHealthEmptyCause,
  type TableHealthRow,
} from "@/utils/dbm/tableHealth";
import {
  buildRecommendations,
  recommendationRuleParams,
  recommendationsEmptyCause,
  type DbmRecommendation,
  type DbmRecommendationTone,
  type IndexHealthRow,
} from "@/utils/dbm/recommendations";
import { formatCount } from "@/utils/dbm/format";
import { formatDurationMs } from "@/utils/dbm/activity";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { ActivitySession, BlockingSample } from "@/services/db_monitoring";
import { tableSizeLabel } from "@/utils/dbm/tableHealth";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();

const { range, current, refresh, setRange } = useDbmScope(route.query);

// The picker and refresh can be in flight at once; this keeps the last request
// the reader made the one that paints.
const requestSeq = useDbmRequestSeq();

const org = computed(() => store.state?.selectedOrganization?.identifier ?? "");

const hits = ref<TableHealthRow[]>([]);
const coverage = ref<TableHealthCoverage>("unknown");
const countersAreCumulative = ref(false);
const tuplesAreEstimated = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const search = ref("");

// Sibling tab badges. Each is `null` until its own request answers — never
// `0`, which would claim a measured absence we have not measured.
const databaseCount = ref<number | null>(null);
const queryCount = ref<number | null>(null);
const activityCount = ref<number | null>(null);
const deadlockCount = ref<number | null>(null);
const blockedCount = ref<number | null>(null);

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
const tableHealthCount = computed(() => (hits.value.length ? hits.value.length : null));

const searchHidEverything = computed(() => allRows.value.length > 0 && rows.value.length === 0);

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

const notCollectingChecks = computed<DbmLockCheck[]>(() => [
  { label: t("dbm.tableHealth.checkRecipe") },
  { label: t("dbm.tableHealth.checkGrant") },
  { label: t("dbm.tableHealth.checkRange") },
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

// ─── W11 · Recommendations ───────────────────────────────────────────────────

/** The three inputs the rules predicate on, beyond the table feed itself. */
const indexHits = ref<IndexHealthRow[]>([]);
const indexCountersAreCumulative = ref(false);
const sessions = ref<ActivitySession[]>([]);
const blockingSamples = ref<BlockingSample[]>([]);

const RECOMMENDATION_TONES: Record<DbmRecommendationTone, { chip: string; icon: IconName }> = {
  error: { chip: "bg-badge-error-soft-bg text-badge-error-soft-text", icon: "error" },
  warning: { chip: "bg-badge-warning-soft-bg text-badge-warning-soft-text", icon: "trending-up" },
  info: { chip: "bg-badge-blue-soft-bg text-badge-blue-soft-text", icon: "insights" },
};

/**
 * The rules, run over whatever arrived. Every predicate lives in
 * `utils/dbm/recommendations.ts` and is unit-tested there; this page only
 * supplies inputs and renders, so the page and the tests cannot disagree about
 * what fires.
 */
const recommendations = computed<DbmRecommendation[]>(() =>
  buildRecommendations({
    indexes: indexHits.value,
    sessions: sessions.value,
    blocking: blockingSamples.value,
    // The high-row-count rule reads ONE statement's server-side counters, which
    // this page does not fetch — it is surfaced on Query detail, where that
    // request already happens. Passing null here states "not evaluated" rather
    // than fabricating an input.
    serverMetrics: null,
  }),
);

/**
 * Which empty state applies, or `null` when there is a list to show. The engine
 * comes off the rows we actually received: on a MySQL-only fleet the index
 * check never ran, and saying "nothing found" would be an all-clear about it.
 */
const recommendationsEmpty = computed(() =>
  recommendationsEmptyCause(recommendations.value, hits.value[0]?.engine ?? ""),
);

/** The headline sentence, with the numbers the rule measured. */
const recommendationBody = (rec: DbmRecommendation) => {
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
    default:
      return raw("");
  }
};

/** The predicate that fired, in words, from the constants it evaluates. */
const recommendationRule = (rec: DbmRecommendation) => {
  const { key, params } = recommendationRuleParams(rec.id);
  return t(key as Parameters<typeof t>[0], params);
};

const load = async () => {
  if (!org.value) return;
  const token = requestSeq.begin();
  loading.value = true;
  error.value = null;
  refresh();

  try {
    const { data } = await dbMonitoringService.getTableHealth(org.value, {
      startTime: current.value.startTime,
      endTime: current.value.endTime,
    });

    if (requestSeq.isStale(token)) return;

    hits.value = data.hits ?? [];
    coverage.value = data.engine_coverage ?? "unknown";
    countersAreCumulative.value = Boolean(data.counters_are_cumulative);
    tuplesAreEstimated.value = Boolean(data.tuples_are_estimated);

    // Index health feeds the unused-index rule. Fetched separately and
    // tolerated separately: a build without the endpoint still renders the
    // table and the rules that do not depend on it.
    try {
      const index = await dbMonitoringService.getIndexHealth(org.value, {
        startTime: current.value.startTime,
        endTime: current.value.endTime,
      });
      if (requestSeq.isStale(token)) return;
      indexHits.value = index.data.hits ?? [];
      indexCountersAreCumulative.value = Boolean(index.data.counters_are_cumulative);
    } catch {
      if (requestSeq.isStale(token)) return;
      indexHits.value = [];
      // No response, no claim: the disclosure must not persist from a previous
      // window and label rows this request never received.
      indexCountersAreCumulative.value = false;
    }
  } catch (err: unknown) {
    if (requestSeq.isStale(token)) return;
    hits.value = [];
    // The flags are claims the API makes; a failed request made none, so they
    // must not persist from a previous window and label stale-free rows.
    countersAreCumulative.value = false;
    tuplesAreEstimated.value = false;
    indexHits.value = [];
    indexCountersAreCumulative.value = false;

    // The endpoint is not on this build yet, or nothing has ever reported a
    // table: "not collecting", not a failure the reader can act on.
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 501) {
      coverage.value = "unknown";
    } else {
      error.value =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        String(err);
    }
  } finally {
    if (!requestSeq.isStale(token)) loading.value = false;
  }
};

/**
 * The sibling tab badges. Independent of each other and of the main read, so
 * one failing endpoint leaves the others populated. Every catch sets `null`,
 * never `0` — a blank badge reads as "unknown", a zero as "nothing there".
 */
const loadContext = async () => {
  if (!org.value) return;
  const window = { startTime: current.value.startTime, endTime: current.value.endTime };

  try {
    const { data } = await dbMonitoringService.getDatabases(org.value, window);
    databaseCount.value = data.total ?? data.hits?.length ?? 0;
  } catch {
    databaseCount.value = null;
  }
  try {
    const { data } = await dbMonitoringService.getQueries(org.value, { ...window, limit: 1 });
    queryCount.value = data.total ?? data.hits?.length ?? 0;
  } catch {
    queryCount.value = null;
  }
  try {
    const { data } = await dbMonitoringService.getActivity(org.value, window);
    activityCount.value = activitySampleTotal(data);
    // Reused by the long-running-query rule rather than fetched again: a second
    // request over the same window could disagree with the badge beside it.
    sessions.value = data.hits ?? [];
  } catch {
    activityCount.value = null;
    sessions.value = [];
  }
  try {
    const { data } = await dbMonitoringService.getDeadlocks(org.value, window);
    deadlockCount.value = data.total ?? data.hits?.length ?? 0;
  } catch {
    deadlockCount.value = null;
  }
  try {
    const { data } = await dbMonitoringService.getBlocking(org.value, window);
    blockedCount.value = data.total ?? data.hits?.length ?? 0;
    // Reused by the high-impact-blocker rule, for the same reason as activity.
    blockingSamples.value = data.hits ?? [];
  } catch {
    blockedCount.value = null;
    blockingSamples.value = [];
  }
};

const onDateChange = (change: DbmDateChange) => {
  setRange(change);
  load();
  loadContext();
};

onMounted(() => {
  load();
  loadContext();
});
</script>
