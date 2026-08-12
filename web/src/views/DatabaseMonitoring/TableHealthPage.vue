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

  No recommendations, no scoring, no "needs vacuum" verdicts — that is W11 and
  builds on this page rather than living in it.
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
import { formatCount } from "@/utils/dbm/format";
import {
  scanCountDisclosure,
  tableHealthEmptyCause,
  tableHealthRows,
  tableSizeLabel,
  tupleCountDisclosure,
  vacuumLabel,
  type TableHealthCoverage,
  type TableHealthEmptyCause,
  type TableHealthRow,
} from "@/utils/dbm/tableHealth";

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

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "qualifiedName",
    header: t("dbm.tableHealth.columns.relation"),
    accessorKey: "qualifiedName",
  },
  { id: "instance", header: t("dbm.tableHealth.columns.instance"), accessorKey: "instance" },
  {
    id: "total_bytes",
    header: t("dbm.tableHealth.columns.totalBytes"),
    accessorKey: "total_bytes",
    cell: ({ row }) => tableSizeLabel(row.original.total_bytes),
  },
  {
    id: "heap_bytes",
    header: t("dbm.tableHealth.columns.heapBytes"),
    accessorKey: "heap_bytes",
    cell: ({ row }) => tableSizeLabel(row.original.heap_bytes),
  },
  {
    id: "overheadBytes",
    header: t("dbm.tableHealth.columns.overheadBytes"),
    accessorKey: "overheadBytes",
    cell: ({ row }) => tableSizeLabel(row.original.overheadBytes),
  },
  {
    id: "live_tuples",
    header: t("dbm.tableHealth.columns.liveTuples"),
    accessorKey: "live_tuples",
    cell: ({ row }) => formatCount(row.original.live_tuples),
  },
  {
    id: "dead_tuples",
    header: t("dbm.tableHealth.columns.deadTuples"),
    accessorKey: "dead_tuples",
    cell: ({ row }) => formatCount(row.original.dead_tuples),
  },
  {
    id: "dead_tup_pct",
    header: t("dbm.tableHealth.columns.deadTupPct"),
    accessorKey: "dead_tup_pct",
    cell: ({ row }) =>
      row.original.dead_tup_pct == null ? "—" : `${row.original.dead_tup_pct.toFixed(2)}%`,
  },
  {
    id: "mod_since_analyze",
    header: t("dbm.tableHealth.columns.modSinceAnalyze"),
    accessorKey: "mod_since_analyze",
    cell: ({ row }) => formatCount(row.original.mod_since_analyze),
  },
  // The header carries "(lifetime)" as well as the subheader disclosure: a
  // reader who sorts by this column and screenshots it takes the header with
  // them and leaves the disclosure behind.
  {
    id: "seq_scan_count",
    header: t("dbm.tableHealth.columns.seqScanCount"),
    accessorKey: "seq_scan_count",
    cell: ({ row }) => formatCount(row.original.seq_scan_count),
  },
  {
    id: "seq_tup_read",
    header: t("dbm.tableHealth.columns.seqTupRead"),
    accessorKey: "seq_tup_read",
    cell: ({ row }) => formatCount(row.original.seq_tup_read),
  },
  {
    id: "idx_scan_count",
    header: t("dbm.tableHealth.columns.idxScanCount"),
    accessorKey: "idx_scan_count",
    cell: ({ row }) => formatCount(row.original.idx_scan_count),
  },
  {
    id: "autovacuum_count",
    header: t("dbm.tableHealth.columns.autovacuumCount"),
    accessorKey: "autovacuum_count",
    cell: ({ row }) => formatCount(row.original.autovacuum_count),
  },
  {
    id: "frozen_xid_age",
    header: t("dbm.tableHealth.columns.frozenXidAge"),
    accessorKey: "frozen_xid_age",
    cell: ({ row }) => formatCount(row.original.frozen_xid_age),
  },
  {
    id: "last_autovacuum",
    header: t("dbm.tableHealth.columns.lastAutovacuum"),
    accessorKey: "last_autovacuum",
    cell: ({ row }) => vacuumLabel(row.original.last_autovacuum, t),
  },
  {
    id: "last_vacuum",
    header: t("dbm.tableHealth.columns.lastVacuum"),
    accessorKey: "last_vacuum",
    cell: ({ row }) => vacuumLabel(row.original.last_vacuum, t),
  },
  {
    id: "last_analyze",
    header: t("dbm.tableHealth.columns.lastAnalyze"),
    accessorKey: "last_analyze",
    cell: ({ row }) => vacuumLabel(row.original.last_analyze, t),
  },
]);

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
  } catch (err: unknown) {
    if (requestSeq.isStale(token)) return;
    hits.value = [];
    // The flags are claims the API makes; a failed request made none, so they
    // must not persist from a previous window and label stale-free rows.
    countersAreCumulative.value = false;
    tuplesAreEstimated.value = false;

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
  } catch {
    activityCount.value = null;
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
  } catch {
    blockedCount.value = null;
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
