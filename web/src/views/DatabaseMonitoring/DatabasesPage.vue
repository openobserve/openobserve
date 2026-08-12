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
  Databases overview — every database this org talks to, ranked by the time it
  costs.

  Same grammar as Top queries (one toolbar row, one coverage line, one insight
  strip, dense rows with inline actions) because they are two tabs of one page
  and a reader should not have to relearn the screen when switching.

  What differs, and why:

    • Percentiles here are EXACT. These rows come from per-database totals over
      all calls, never fused from per-query approximations — so the coverage
      line says so plainly instead of borrowing the per-query caveat. That is
      also why the columns can state a speed without qualifying it.

    • The columns say what the number MEANS: "Half are under", "Slow calls",
      "Slowest 1%" rather than p50/p95/p99. A DBA can translate; nobody else
      should have to.

    • "Used by" is the column no product reading database counters can build.
      It comes free because the measurement happens in the application, and it
      is the fastest route from "this database is slow" to "go talk to this
      team".

  Two honesty caveats ride permanently on this page, because both are true of
  the data rather than of a state it happens to be in: health here is what your
  APPLICATIONS experienced (there are no CPU/replication columns until a
  server-side collector lands), and a database here is the ADDRESS the client
  connected to — behind a pooler, several can collapse into one row.

  Sorting happens LOCALLY — the endpoint accepts no sort param and the whole set
  arrives in one response — but this page owns the comparator rather than
  handing it to the table. Each database expands into its own schema → service
  rows, and a table sorting the flattened list would tear those children away
  from the parent they belong to.
-->
<template>
  <OPageLayout
    :title="t('dbm.databases.title')"
    :subtitle="t('dbm.databases.subtitle')"
    icon="database"
    title-data-test="dbm-databases-title"
    tabs-below
    bleed
  >
    <template #header-tabs>
      <DbmSectionTabs
        :database-count="trafficRowCount"
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
        data-test-name="dbm-databases-date-time"
        class="h-8"
        @on:date-change="onDateChange"
      />
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <OTable
        :data="treeRows"
        :columns="columns"
        row-key="rowKey"
        :loading="loading"
        :frame="false"
        :error="error"
        sorting="server"
        :sort-by="sortBy"
        :sort-order="sortOrder"
        pagination="none"
        :show-global-filter="false"
        :column-visibility="defaultColumnVisibility"
        :persist-columns="true"
        table-id="dbm-databases"
        :enable-column-resize="true"
        :row-class="rowClass"
        tree
        :get-row-warning="hasShortfall"
        v-model:expanded-ids="expandedIds"
        custom-pagination-bar
        data-test="dbm-databases-table"
        @sort-change="onSortChange"
        @row-click="onRowClick"
      >
        <!-- ONE toolbar row, the same one Top queries uses. The engine select
             used to sit here bare and full-width; it is now a dimension inside
             the shared filter popover, so both tabs filter the same way. -->
        <template #toolbar>
          <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <div class="w-64 shrink-0">
              <OSearchInput
                ref="searchRef"
                v-model="search"
                :placeholder="t('dbm.databases.searchPlaceholder')"
                clearable
                data-test="dbm-databases-search"
              />
            </div>
            <DbmScopeFilters
              class="min-w-0 flex-1"
              :filters="dimensionFilters"
              @clear="clearScope"
            />
          </div>
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            class="shrink-0"
            data-test="dbm-databases-refresh"
            @click="onRefresh"
          >
            <OTooltip side="bottom" :content="t('dbm.common.reload')" />
          </OButton>
        </template>

        <template #subheader>
          <!-- The totals that used to be crammed into the page subtitle. They
               summarise exactly the rows below, so they belong inside the table
               frame rather than in the header. -->
          <div
            class="px-page-edge border-table-row-divider border-b py-1.5"
            data-test="dbm-databases-summary"
          >
            <OStatStrip :items="summaryStats" :loading="loading" />
          </div>
          <DbmCoverageLine
            :freshness="freshness"
            :hits="rows"
            :top-n-subset="topNSubset"
            :error-count="errorCount"
            exact-percentiles
            data-test="dbm-databases-coverage"
          />
        </template>

        <!-- One name column at three grains: a database, a schema or service
             inside it, and — until the split lands — one placeholder saying
             what is happening to it. -->
        <template #cell-instance="{ row }">
          <div v-if="isBreakdownRow(row)" class="flex min-w-0 items-center gap-1.5">
            <span
              v-if="row.kind === 'status'"
              class="text-2xs truncate italic"
              :class="row.status === 'error' ? 'text-status-error-text' : 'text-text-secondary'"
              :data-test="`dbm-databases-breakdown-status-${row.status}`"
            >
              {{ statusLine(row) }}
            </span>
            <template v-else>
              <DbmServiceList
                v-if="row.kind === 'service' && row.name"
                :services="[row.name]"
                :max="1"
                data-test="dbm-databases-child-service"
              />
              <span v-else-if="row.kind === 'service'" class="text-text-secondary text-2xs italic">
                {{ t("dbm.breakdown.noService") }}
              </span>
              <template v-else>
                <OIcon name="database" size="xs" class="text-text-label shrink-0" />
                <span class="text-text-heading text-2xs min-w-0 truncate font-semibold">
                  {{ row.name ? raw(row.name) : t("dbm.breakdown.noSchema") }}
                </span>
              </template>
              <span class="text-text-label text-3xs shrink-0">
                {{ t("dbm.breakdown.queryCount", { count: row.queryCount }, row.queryCount) }}
              </span>
            </template>
          </div>
          <div v-else class="flex min-w-0 flex-col gap-px">
            <span class="text-text-heading text-compact truncate font-semibold">
              {{ row.db_instance }}
            </span>
            <div class="text-text-label text-3xs flex min-w-0 items-center gap-1 truncate">
              <OTag type="dbSystem" :value="row.db_system" size="xs" />
              <template v-if="row.db_namespace">
                <span class="opacity-45">·</span>
                <span>{{ row.db_namespace }}</span>
              </template>
              <!-- The receiver can reach it, no application asked it anything.
                   That is a finding, not an absence — an idle replica is what
                   the client-vantage list cannot show by construction. -->
              <template v-if="row.trafficless">
                <span class="opacity-45">·</span>
                <span class="text-text-label italic" data-test="dbm-databases-no-traffic">
                  {{ t("dbm.instanceMetrics.noTraffic") }}
                  <OTooltip side="bottom" :content="t('dbm.instanceMetrics.noTrafficHint')" />
                </span>
              </template>
              <DbmRowChips :chips="row.chips" />
            </div>
          </div>
        </template>

        <!-- A placeholder row states no figure in any column: the split is not
             here yet, and a 0 would be a measurement it never made. -->
        <template #cell-calls="{ row }">
          <span
            class="font-mono text-xs tabular-nums"
            :class="isStatusRow(row) ? 'text-text-muted' : 'text-text-body'"
          >
            {{ noQueryFigures(row) ? raw("—") : formatCount(row.calls) }}
          </span>
        </template>

        <!-- A failure rate, not a count: on a database row the question is what
             fraction of traffic is failing, and 454 means nothing without the
             26,177 it came out of.

             Red is gated on the SAME calibrated threshold as the row rail, so
             the number and the rail cannot give two answers to one question:
             one failure in 26,000 is not an emergency, and colouring it as one
             here while the rail stayed neutral read as a contradiction. -->
        <template #cell-errorRate="{ row }">
          <span
            class="font-mono text-xs tabular-nums"
            :class="
              !isBreakdownRow(row) && row.critical
                ? 'text-status-error-text font-semibold'
                : 'text-text-muted'
            "
          >
            <template v-if="noQueryFigures(row)">{{ raw("—") }}</template>
            <template v-else-if="row.errorRate">{{ formatPercent(row.errorRate, 0) }}</template>
            <template v-else>{{ t("dbm.queries.errorsNone") }}</template>
          </span>
        </template>

        <!-- The split's grain reports no p50 and no p99, so those cells are the
             muted em-dash the app uses for a missing fact. A zero would read as
             "instant", which is the one thing they must not say. -->
        <template #cell-p50="{ row }">
          <span
            class="font-mono text-xs tabular-nums"
            :class="missing(row.p50_ns) ? 'text-text-muted' : 'text-text-body'"
          >
            {{ missing(row.p50_ns) ? raw("—") : formatNs(row.p50_ns) }}
          </span>
        </template>
        <template #cell-p95="{ row }">
          <span class="text-compact font-mono font-medium tabular-nums" :class="p95Tone(row)">
            {{ missing(row.p95_ns) ? raw("—") : formatNs(row.p95_ns) }}
          </span>
        </template>
        <template #cell-p99="{ row }">
          <span
            class="font-mono text-xs tabular-nums"
            :class="missing(row.p99_ns) ? 'text-text-muted' : 'text-text-body'"
          >
            {{ missing(row.p99_ns) ? raw("—") : formatNs(row.p99_ns) }}
          </span>
        </template>

        <!-- "Used by" is a database-level fact. A service row IS one caller, so
             restating it here would be the row's own name printed twice. -->
        <template #cell-services="{ row }">
          <DbmServiceList
            v-if="!isBreakdownRow(row)"
            :services="row.calling_services"
            :max="MAX_VISIBLE_SERVICES"
            data-test="dbm-databases-service"
          />
          <span v-else class="text-text-muted">{{ raw("—") }}</span>
        </template>

        <!-- What the server says about itself. A breakdown child is a slice of
             one instance, not an instance, so it states nothing here. -->
        <template #cell-instanceHealth="{ row }">
          <DbmInstanceHealthCell
            v-if="!isBreakdownRow(row) && row.metrics"
            :metrics="row.metrics"
            :engine="row.db_system"
            data-test="dbm-databases-instance-health"
          />
          <span v-else class="text-text-muted block text-right">{{ raw("—") }}</span>
        </template>

        <!-- The health scalar: how close this instance is to a ceiling it
             published, and WHICH ceiling. Deliberately not a composite score —
             a weighted number nobody can decompose is one a reader will not
             act on — so it is the worst single saturation ratio, named.

             An instance with no ratio says so rather than showing 0%: every
             MySQL instance is permanently here, because mysqlreceiver
             publishes no max_connections and dividing by an invented
             denominator would rank a saturated MySQL host as the calmest
             thing on the page. -->
        <template #cell-attention="{ row }">
          <span v-if="isBreakdownRow(row)" class="text-text-muted block text-right">{{
            raw("—")
          }}</span>
          <div v-else class="flex flex-col items-end gap-px" data-test="dbm-databases-attention">
            <span
              class="font-mono text-xs font-medium tabular-nums"
              :class="attentionToneClass(row)"
            >
              {{
                attentionOf(row).ratio === null
                  ? raw("—")
                  : formatPercent(attentionOf(row).ratio, 0)
              }}
            </span>
            <span class="text-text-label text-3xs">{{ attentionLabel(row) }}</span>
          </div>
        </template>

        <!-- A child's share is of its own parent level, which is exactly the
             reading the split exists to give: what fraction of this database
             (or this schema) the row accounts for. -->
        <template #cell-load="{ row }">
          <DbmLoadCell
            v-if="!noQueryFigures(row)"
            :total-time-ns="row.total_time_ns"
            :share="row.share"
            :flagged="!isBreakdownRow(row) && row.drowning"
            :critical="!isBreakdownRow(row) && row.critical"
            data-test="dbm-databases-load"
          />
          <span v-else class="text-text-muted block text-right">{{ raw("—") }}</span>
        </template>

        <!-- Both actions are about queries — opening the query list, or
             alerting on a p95 nothing measured — so a trafficless row offers
             neither rather than offering two dead buttons. -->
        <template #cell-actions="{ row }">
          <DbmRowActions
            v-if="!isBreakdownRow(row) && !row.trafficless"
            :actions="rowActions"
            data-test="dbm-databases-row-actions"
            @action="(id) => onRowAction(id, row)"
          />
        </template>

        <!-- The honesty line, attached to the database it describes: the split's
             grain is top-N truncated, so its rows can add up to less than the
             parent row directly above them. Between the parent and its children
             is the only place that gap can be read where it happens. -->
        <template #tree-warning="{ row }">
          <span
            class="text-banner-warning-text text-3xs"
            :data-test="`dbm-databases-shortfall-${row.rowKey}`"
          >
            {{ shortfallLine(row) }}
          </span>
        </template>

        <template #bottom>
          <div
            class="border-border-default bg-surface-panel text-text-secondary text-2xs px-page-edge flex h-7.5 items-center gap-2.5 border-t"
            data-test="dbm-databases-status-bar"
          >
            <div class="flex-1"></div>
            <div class="flex flex-wrap items-center gap-3">
              <span
                v-for="hint in keyboardHints"
                :key="hint.key"
                class="inline-flex items-center gap-1"
              >
                <kbd
                  class="border-border-default bg-surface-base text-text-label rounded-default min-w-4 border px-1 text-center font-mono"
                  >{{ hint.key }}</kbd
                >
                {{ hint.label }}
              </span>
            </div>
          </div>
        </template>

        <template #empty>
          <DbmEmptyState
            v-if="!loading"
            :permission-ok="permissionOk"
            :enabled="dbmEnabled"
            :never-aggregated="neverAggregated"
            :org="org"
            :filtered="isFiltered"
            @action="onEmptyAction"
          />
        </template>
      </OTable>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import DbmCoverageLine from "@/components/dbm/DbmCoverageLine.vue";
import DbmEmptyState, { type DbmEmptyCauseId } from "@/components/dbm/DbmEmptyState.vue";
import { dbmEmptyAction, DBM_SETUP_ROUTE } from "@/utils/dbm/emptyAction";
import DbmLoadCell from "@/components/dbm/DbmLoadCell.vue";
import DbmRowActions, { type DbmRowAction } from "@/components/dbm/DbmRowActions.vue";
import DbmRowChips, { type DbmRowChip } from "@/components/dbm/DbmRowChips.vue";
import DbmScopeFilters, { type DbmScopeFilter } from "@/components/dbm/DbmScopeFilters.vue";
import DbmServiceList from "@/components/dbm/DbmServiceList.vue";
import DbmSectionTabs from "@/components/dbm/DbmSectionTabs.vue";
import DateTime from "@/components/DateTime.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import dbMonitoringService, {
  type ActivityStateBucket,
  type DbTotalsRow,
  type Freshness,
} from "@/services/db_monitoring";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useDbmRequestSeq } from "@/composables/dbm/useDbmRequestSeq";
import { badgesFrom, DbmPartialCounts, useDbmCountCache } from "@/composables/dbm/useDbmCountCache";
import { useDbmScope, type DbmDateChange } from "@/composables/dbm/useDbmScope";
import {
  contextRegistry,
  createDbmContextProvider,
  DBM_CONTEXT_KEY,
} from "@/composables/contextProviders";
import { activitySampleTotal } from "@/utils/dbm/activity";
import { buildDatabaseBreakdown, type DbmBreakdown } from "@/utils/dbm/breakdown";
import {
  isBreakdownRow,
  showsShortfall,
  toBreakdownRows,
  type DbmBreakdownRow,
} from "@/utils/dbm/breakdownRows";
import {
  countClaim,
  errorRate,
  formatCount,
  formatNs,
  formatPercent,
  type DbmCountClaim,
} from "@/utils/dbm/format";
import DbmInstanceHealthCell from "@/components/dbm/DbmInstanceHealthCell.vue";
import searchService from "@/services/search";
import { collectInstanceMetrics } from "@/utils/dbm/instanceMetricsRead";
import type { DbmInstanceMetricSet, DbmRowMetrics } from "@/utils/dbm/instanceMetrics";
import { unionFleetRows } from "@/utils/dbm/fleetRows";
import { healthScalar, healthSortValue } from "@/utils/dbm/healthScalar";
import { detectDrowningDatabases, isCriticalErrorRate, totalsKey } from "@/utils/dbm/insights";
import { buildDbmPrefill } from "@/utils/alerts/prefill/fromDbm";
import { requestAlertCreation } from "@/composables/alerts/useAlertCreation";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

// Seeded from the URL so the window survives a tab switch and a shared link.
const { range, current, previous, refresh, setRange, queryParams } = useDbmScope(route.query);

// One token for the page, so the per-database breakdown fetches a load starts
// are invalidated by the NEXT load along with the load itself.
const requestSeq = useDbmRequestSeq();

// The sibling-tab badges are the same numbers on every tab, so they are
// fetched once per window and shared across the six routes rather than
// re-fetched on each remount. See useDbmCountCache.
const countCache = useDbmCountCache("databases");

const rows = ref<DatabaseRow[]>([]);
const freshness = ref<Freshness | null>(null);
const topNSubset = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const permissionOk = ref(true);
const search = ref("");
const searchRef = ref<InstanceType<typeof OSearchInput> | null>(null);
// `env` is deliberately absent. The databases endpoint deserializes only
// system/service/stream, so an env filter here could count itself as active and
// still return staging merged with prod — a filter that lies is worse than no
// filter. Top queries is the grain that genuinely accepts `env`.
const systemFilter = ref<string | null>((route.query.system as string) ?? null);
/** Kept so the empty state can say "we haven't finished counting" rather than "no data". */
const neverAggregated = ref(false);
/** Fetched alongside the table so the Top-queries tab badge carries a number. */
const queryCount = ref<number | null>(null);
const deadlockCount = ref<DbmCountClaim | null>(null);
const blockedCount = ref<DbmCountClaim | null>(null);
const tableHealthCount = ref<number | null>(null);
/** `null` until read, and again if the read fails — so the badge stays bare. */
const activityStates = ref<ActivityStateBucket[] | null>(null);
/** Sessions in the window. See `activitySampleTotal` for why not `hits.length`. */
const activityCount = computed(() => activitySampleTotal(activityStates.value));

const org = computed(() => store.state.selectedOrganization?.identifier as string);
const dbmEnabled = computed(() => Boolean(store.state.zoConfig?.database_monitoring_enabled));
/**
 * W4/W4b. Off by default: the join costs a second read across up to eight
 * metric streams per page load, so nobody acquires it by upgrading.
 */
const instanceMetricsEnabled = computed(() =>
  Boolean(store.state.zoConfig?.database_monitoring_instance_metrics),
);

/** What the receiver said, keyed by `(system, host)`. Empty until it answers. */
const instanceMetrics = ref<Map<string, DbmInstanceMetricSet>>(new Map());
/** Streams that errored, so an unmatched row can blame the read and not the DBA. */
const failedMetricStreams = ref<string[]>([]);
/**
 * The query read's own rows, kept so the metrics read can rebuild the table
 * when it lands without refetching them.
 */
const clientHits = ref<DbTotalsRow[]>([]);
const drowningKeys = ref<Set<string>>(new Set());

/** At most this many service chips per row before the cell collapses the rest. */
const MAX_VISIBLE_SERVICES = 3;

/**
 * Queries pulled to build one database's schema → service breakdown. The
 * breakdown is a shape, not a ranking, so the long tail past this adds pixels
 * rather than meaning — and this fires once per row expansion.
 */
const BREAKDOWN_QUERY_LIMIT = 200;

interface DatabaseRow extends Partial<DbTotalsRow> {
  db_system: string;
  db_instance: string;
  /** OTable needs a stable identity; the grain is (system, instance, namespace). */
  rowKey: string;
  share: number;
  errorRate: number | null;
  /**
   * The receiver reports this instance but nothing queried it in this window.
   * Its query columns are empty because nothing measured them — which is
   * itself the answer to "is anything using this replica?".
   */
  trafficless: boolean;
  /** What the server says about itself, or why we could not ask. */
  metrics?: DbmRowMetrics;
  /** This database is slowing down against its own recent normal. */
  drowning: boolean;
  /** Failing enough that the row earns a red rail rather than an amber one. */
  critical: boolean;
  chips: DbmRowChip[];
  /** Absent by construction — the discriminant that tells a database row from
   *  one of the split's rows, which is the only field a cell needs to branch on. */
  kind?: undefined;
}

/** A database row with its split attached, or one of the split's own rows. */
type TableRow = (DatabaseRow & { children: DbmBreakdownRow[] }) | DbmBreakdownRow;

/**
 * Databases applications actually talked to. The tab badge uses this rather
 * than the row count, because the other three badges all count query-vantage
 * things — a badge that silently included idle replicas would not be
 * comparable with the tabs beside it.
 */
const trafficRowCount = computed(() => rows.value.filter((row) => !row.trafficless).length);

const totalCalls = computed(() => rows.value.reduce((acc, row) => acc + (row.calls ?? 0), 0));
const totalTime = computed(() =>
  rows.value.reduce((acc, row) => acc + (row.total_time_ns ?? 0), 0),
);
const errorCount = computed(() => rows.value.reduce((acc, row) => acc + (row.errors ?? 0), 0));

/**
 * The window's totals, over the rows below. Read-only: none of these four is a
 * facet the table can filter to, so making them clickable would promise a
 * behaviour the page does not have.
 */
const summaryStats = computed<StatItem[]>(() => [
  {
    key: "databases",
    label: t("dbm.databases.summary.databases"),
    // The same count the tab badge shows, for the same reason: the three tiles
    // beside this one are all query-vantage totals, so a figure here that
    // silently included idle replicas would not be comparable with them — and
    // two different numbers under one word on one screen is worse than either.
    value: trafficRowCount.value,
    icon: "database",
    tone: "primary",
    dataTest: "dbm-databases-summary-databases",
  },
  {
    key: "calls",
    label: t("dbm.databases.summary.calls"),
    value: formatCount(totalCalls.value),
    icon: "bar-chart",
    tone: "info",
    dataTest: "dbm-databases-summary-calls",
  },
  {
    key: "time",
    label: t("dbm.databases.summary.time"),
    value: formatNs(totalTime.value),
    icon: "timer",
    tone: "teal",
    dataTest: "dbm-databases-summary-time",
  },
  {
    key: "failed",
    label: t("dbm.databases.summary.failed"),
    value: errorCount.value ? formatCount(errorCount.value) : raw("—"),
    icon: "error-outline",
    tone: errorCount.value ? "error" : "neutral",
    dataTest: "dbm-databases-summary-failed",
  },
]);

/**
 * Only shortcuts that are actually bound below. This row previously advertised
 * `↵ open` and `/ search` while the page registered no key listener at all, so
 * both were decoration — a hint that does nothing is worse than no hint.
 */
const keyboardHints = computed(() => [{ key: raw("/"), label: t("dbm.keys.search") }]);

const onKeydown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  const typing =
    target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
  if (typing) return;
  if (event.key === "/") {
    event.preventDefault();
    const el = searchRef.value?.$el?.querySelector?.("input") as HTMLInputElement | undefined;
    el?.focus();
  }
};

const isFiltered = computed(() => !!search.value || !!systemFilter.value);

const optionsFrom = (values: (string | undefined)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].map((value) => ({
    value,
    label: raw(value),
  }));

/**
 * The same popover-and-chips control Top queries uses. Only the dimensions this
 * endpoint actually accepts are offered — a select that silently did nothing
 * would be worse than its absence.
 */
const dimensionFilters = computed<DbmScopeFilter[]>(() => [
  {
    key: "system",
    dimension: t("dbm.filters.dimension.system"),
    value: systemFilter.value,
    placeholder: t("dbm.filters.allEngines"),
    options: optionsFrom(rows.value.map((r) => r.db_system)),
    onChange: (value) => {
      systemFilter.value = (value as string) || null;
      syncUrl();
      load();
    },
  },
]);

/**
 * Free-text over instance, schema and engine, client-side. The engine filter is
 * a request param (the endpoint supports `system`), but there is no server-side
 * text search here and the whole set is already in memory.
 */
const visibleRows = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return rows.value;
  return rows.value.filter((row) =>
    [row.db_instance, row.db_namespace, row.db_system, ...(row.calling_services ?? [])]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(needle)),
  );
});

// ── the in-place breakdown ──────────────────────────────────────────────────
//
// The split renders as TREE CHILD ROWS of this table, not as a panel with a
// table of its own. A nested table has its own headers at its own widths, so
// the same figure landed at two x-positions on one screen and the split could
// not be read against the total it came out of. As child rows the columns are
// literally the same columns, and alignment stops being something anyone
// maintains.
//
// Expansion and navigation stay SEPARATE, and deliberately not the way
// Deadlocks does it. A deadlock row has nowhere to go, so there expand-on-click
// is the only meaning a click can carry. A database row already has a target —
// "see its queries" — that predates this feature, is what the ↵ hint in the
// status bar promises, and is what the row's own `open` action does. Rebinding
// the row click to expand would quietly break all three. So the inline chevron
// in the name column owns expanding, and the row body still navigates.

/** Which rows are open, by `rowKey` — database rows and schema rows alike. */
const expandedIds = ref<string[]>([]);

interface BreakdownState {
  breakdown: DbmBreakdown;
  loading: boolean;
  error: I18nText | null;
}

const EMPTY_BREAKDOWN: BreakdownState = {
  breakdown: buildDatabaseBreakdown([]),
  loading: true,
  error: null,
};

/** Per-row breakdown state, keyed by `rowKey`. */
const breakdowns = ref<Record<string, BreakdownState>>({});

const breakdownFor = (row: DatabaseRow): BreakdownState =>
  breakdowns.value[row.rowKey] ?? EMPTY_BREAKDOWN;

/**
 * The rows the table renders: every database, each carrying its schema →
 * service children.
 *
 * EVERY database gets children, even before its split has been fetched — the
 * table only draws an expand chevron on a row that already has some, so a
 * database with none could never be opened to trigger the fetch in the first
 * place. Until the rows land, that child is a placeholder saying what is
 * happening.
 */
const treeRows = computed<TableRow[]>(() =>
  sortedRows.value.map((row) => {
    const state = breakdowns.value[row.rowKey];
    return {
      ...row,
      // A trafficless instance has no queries to split: the whole point of the
      // row is that nothing queried it. Giving it children would draw a
      // chevron onto a fetch that can only ever come back empty.
      children: row.trafficless
        ? []
        : toBreakdownRows(
            state && { breakdown: state.breakdown, loading: state.loading, failed: !!state.error },
            row.rowKey,
          ),
    };
  }),
);

/**
 * Sorting is owned here rather than by the table, and that is what tree mode
 * requires: OTable sorts the FLATTENED list, which would tear children away
 * from the parent they belong to. Sorting the parents and letting the children
 * ride along keeps the tree intact — the children are already ranked heaviest
 * first by the aggregation, which is the only order they have.
 */
// Most in need of attention first. `load` ranks by total time, which is VOLUME:
// it answers "which database is busiest", and on a real fleet that is the same
// three databases every day and is almost never the incident. `attention` ranks
// by saturation against the ceiling the engine itself publishes, and carries
// instances we cannot assess at the top rather than burying them under healthy
// ones — an instance we cannot see is the risk.
//
// Left empty this fell through to server response order, which carries no
// ranking meaning and made the top row look arbitrary. `load` keeps its column
// and its own sort; this is a change of default, not a removal.
const sortBy = ref("attention");
const sortOrder = ref<"asc" | "desc">("desc");

/**
 * The attention column's three renderings, each a different fact.
 *
 * A percentage is only ever shown against a limit the ENGINE published. The
 * other two states are both dashes, but they carry different sentences: a
 * reading with no ceiling to divide by, and no reading at all.
 */
const attentionOf = (row: TableRow) => healthScalar(isBreakdownRow(row) ? undefined : row.metrics);

const attentionLabel = (row: TableRow): I18nText => {
  const scalar = attentionOf(row);
  if (scalar.state === "measured") return t("dbm.databases.attention.connections");
  // A count arrived; there is simply no published ceiling to express it
  // against. Every MySQL instance is permanently in this state.
  if (scalar.state === "no-limit") return t("dbm.databases.attention.noLimit");
  return t("dbm.databases.attention.unknown");
};

/**
 * Amber before the cliff, not at it: Postgres reserves its last connections
 * for superusers, so an instance refuses application traffic before the ratio
 * reaches 1. The threshold matches DbmInstanceHealthCell's, because two
 * numbers on one row disagreeing about when to worry is worse than either.
 */
const ATTENTION_DANGER = 0.9;

const attentionToneClass = (row: TableRow): string => {
  const scalar = attentionOf(row);
  if (scalar.ratio !== null && scalar.ratio >= ATTENTION_DANGER) return "text-status-error-text";
  // Unknown is not calm — it sorts to the top of this column — but it is not
  // an alarm either, so it reads as the muted dash every unmeasured cell uses.
  return scalar.state === "measured" ? "text-text-heading" : "text-text-muted";
};

/** The value a column sorts on, so the comparator does not switch on strings twice. */
const sortValue = (row: DatabaseRow, column: string): string | number | null => {
  switch (column) {
    case "instance":
      return row.db_instance ?? "";
    case "calls":
      return row.calls ?? 0;
    case "errorRate":
      return row.errorRate ?? -1;
    case "p50":
      return row.p50_ns ?? 0;
    case "p95":
      return row.p95_ns ?? 0;
    case "p99":
      return row.p99_ns ?? 0;
    case "load":
      return row.total_time_ns ?? 0;
    // "Which needs attention first", as against `load`'s "which is busiest".
    // Unknown health sorts ABOVE every measured instance rather than below it:
    // an instance we cannot see is the risk, and burying it under the healthy
    // ones is how a fleet page answers the question with the wrong row.
    case "attention":
      return healthSortValue(row.metrics);
    case "instanceHealth":
      // Sorts on saturation, which is the one instance figure that is
      // comparable across engines and the reason the column exists. A row with
      // no ratio sorts below every measured one rather than above them, so
      // "most saturated first" cannot be led by rows carrying no reading.
      return row.metrics?.saturation.ratio ?? -1;
    default:
      return null;
  }
};

const sortedRows = computed<DatabaseRow[]>(() => {
  const column = sortBy.value;
  if (!column) return visibleRows.value;
  const direction = sortOrder.value === "desc" ? -1 : 1;
  return [...visibleRows.value].sort((a, b) => {
    const left = sortValue(a, column);
    const right = sortValue(b, column);
    if (typeof left === "string" || typeof right === "string") {
      return String(left).localeCompare(String(right)) * direction;
    }
    return ((left as number) - (right as number)) * direction;
  });
});

const onSortChange = ({ column, order }: { column: string; order: "asc" | "desc" }) => {
  sortBy.value = column;
  sortOrder.value = order;
};

/**
 * Whether this database's split falls short of its own total. Only an open
 * database can have one — OTable renders the warning row between a parent and
 * its children, which is exactly where the gap is readable.
 *
 * `showsShortfall` owns the rule, and the case it excludes is the one that made
 * this caveat repeat verbatim under all four databases: nothing attributed puts
 * every row's shortfall at exactly 1, and the `empty` placeholder child already
 * says that better.
 */
const hasShortfall = (row: TableRow): boolean => {
  if (isBreakdownRow(row)) return false;
  const state = breakdowns.value[row.rowKey];
  return showsShortfall(
    state && { breakdown: state.breakdown, loading: state.loading, failed: !!state.error },
  );
};

/**
 * What the shortfall means for the rows below it, with the number attached. A
 * caveat carrying a figure is a disclosure; one without is a disclaimer nobody
 * reads — the rule the coverage line above the table already follows.
 */
const shortfallLine = (row: TableRow): I18nText =>
  isBreakdownRow(row)
    ? raw("")
    : t("dbm.breakdown.shortfall", {
        percent: formatPercent(breakdownFor(row).breakdown.shortfall ?? 0, 0),
      });

/**
 * What the placeholder child says. The failure keeps the server's own wording
 * where there is one, because "load failed" tells a reader less than the reason
 * the backend already gave.
 */
const statusLine = (row: DbmBreakdownRow): I18nText => {
  if (row.status === "error") {
    const parent = rows.value.find((candidate) => row.rowKey === `${candidate.rowKey}/status`);
    return (parent && breakdownFor(parent).error) || t("dbm.common.loadFailed");
  }
  return row.status === "empty"
    ? t("dbm.breakdown.nothingToAttribute")
    : t("dbm.breakdown.loading");
};

/**
 * Fetch one database's queries and roll them up.
 *
 * The `instance` param is all the scoping this needs — the endpoint already
 * accepts it, so the drill-down costs no backend change. The row's own exact
 * total rides along so the aggregation can report its shortfall rather than
 * presenting a sum that silently does not reconcile.
 *
 * It JOINS the load that owns the page rather than starting its own, so a
 * window change discards it along with the parent it describes — otherwise it
 * lands after `load()` cleared the cache and files old-window numbers under a
 * new-window database.
 */
const loadBreakdown = async (row: DatabaseRow, token: number = requestSeq.current()) => {
  if (!org.value) return;
  breakdowns.value = {
    ...breakdowns.value,
    [row.rowKey]: { breakdown: buildDatabaseBreakdown([]), loading: true, error: null },
  };
  try {
    const { data } = await dbMonitoringService.getQueries(org.value, {
      startTime: current.value.startTime,
      endTime: current.value.endTime,
      instance: row.db_instance,
      system: systemFilter.value ?? undefined,
      // Every statement class, not just `query`: the row's total counts them
      // all, so filtering to one class here would manufacture a shortfall.
      stmtClass: "all",
      limit: BREAKDOWN_QUERY_LIMIT,
    });
    // The window or filter moved while this was in flight: `load()` has already
    // cleared the cache, and writing here would re-file the OLD window's split
    // under the new window's parent.
    if (requestSeq.isStale(token)) return;
    breakdowns.value = {
      ...breakdowns.value,
      [row.rowKey]: {
        breakdown: buildDatabaseBreakdown(data.hits ?? [], row.total_time_ns),
        loading: false,
        error: null,
      },
    };
  } catch (err: unknown) {
    if (requestSeq.isStale(token)) return;
    breakdowns.value = {
      ...breakdowns.value,
      [row.rowKey]: {
        breakdown: buildDatabaseBreakdown([]),
        loading: false,
        error:
          raw((err as { response?: { data?: { message?: string } } })?.response?.data?.message) ||
          t("dbm.common.loadFailed"),
      },
    };
  }
};

/**
 * Fetch every open DATABASE row that has no state yet — on open, and after a
 * reload. Open schema rows are in the same set and are skipped here: their
 * children came down with the parent's one request, so there is nothing left to
 * fetch.
 */
const fillOpenBreakdowns = (token: number = requestSeq.current()) => {
  for (const id of expandedIds.value) {
    if (breakdowns.value[id]) continue;
    const row = rows.value.find((candidate) => candidate.rowKey === id);
    if (row) loadBreakdown(row, token);
  }
};

// A re-open reuses what we have; the range or filter changing is what
// invalidates it, and `load()` clears the cache so this refetches. Wrapped so
// the watcher's own arguments cannot land in the token parameter.
watch(expandedIds, () => fillOpenBreakdowns());

/**
 * Build the table from the query rows plus whatever the receiver has told us
 * so far. Runs once with no metrics, then again if and when they land.
 *
 * A trafficless row carries NO query verdict: it was never in the query read,
 * so it has no baseline to be slowing against and no failure rate to be
 * critical about. Deriving either from absent traffic would put a red rail on
 * an idle replica.
 */
const applyInstanceMetrics = () => {
  const hits = clientHits.value;
  const total = hits.reduce((acc, row) => acc + (row.total_time_ns ?? 0), 0);
  // With no metrics the union is the identity over the client rows, which is
  // exactly the page as it shipped.
  rows.value = unionFleetRows(hits, instanceMetrics.value, {
    failedStreams: failedMetricStreams.value,
    system: systemFilter.value,
    // Only this page knows the read never happened. Without it every row on a
    // default install reads as "your collector sent no metric", which accuses a
    // receiver that was never asked and sends the reader to debug nothing.
    enabled: instanceMetricsEnabled.value,
  }).map((row) => {
    const idle = row.trafficless;
    return {
      ...row,
      share: !idle && total > 0 ? (row.total_time_ns ?? 0) / total : 0,
      errorRate: idle ? null : errorRate(row.errors, row.calls),
      drowning: !idle && drowningKeys.value.has(totalsKey(row as DbTotalsRow)),
      critical: !idle && isCriticalErrorRate(row.errors, row.calls),
      chips: idle ? [] : databaseChips(row as DbTotalsRow),
    };
  });
};

/**
 * The receiver's view of the instances, read from the metrics streams the
 * user's collector already writes. Nothing is ingested for this.
 *
 * It is deliberately NOT awaited by `load()`: the query table is the page, and
 * a slow or broken metrics read must never delay or fail it. This resolves on
 * its own and re-renders the rows when it does — or never does, in which case
 * the page is exactly what it is today.
 */
const loadInstanceMetrics = async (token: number) => {
  if (!org.value || !instanceMetricsEnabled.value) return;
  const window = { startTime: current.value.startTime, endTime: current.value.endTime };
  try {
    const collected = await collectInstanceMetrics(async (_stream, sql) => {
      const response = await searchService.search({
        org_identifier: org.value,
        query: {
          query: {
            sql,
            start_time: window.startTime,
            end_time: window.endTime,
            from: 0,
            size: METRIC_SAMPLE_LIMIT,
          },
        },
        page_type: "metrics",
      });
      return (response.data?.hits ?? []) as Record<string, unknown>[];
    }, window);
    if (requestSeq.isStale(token)) return;
    instanceMetrics.value = collected.metricsByKey;
    failedMetricStreams.value = collected.failedStreams;
    // The rows already rendered from the query read alone; re-run the union so
    // they pick up the health columns and the fleet gains its idle instances.
    applyInstanceMetrics();
  } catch {
    // Unreachable by contract — collectInstanceMetrics never rejects — but a
    // metrics failure may not take the query table with it under any
    // circumstances, so the guard stays.
    if (requestSeq.isStale(token)) return;
    instanceMetrics.value = new Map();
    failedMetricStreams.value = [];
  }
};

/**
 * Scrape enough of each metric stream to draw a window. A metric arrives once
 * per collection interval per instance, so this is generous for a fleet.
 */
const METRIC_SAMPLE_LIMIT = 5000;

/**
 * `force` reaches the BADGE cache, not the table: the table is always fetched
 * live. It is what makes the refresh button mean "the numbers may have moved"
 * rather than "re-read the same window" — the one case where the badge cache's
 * same-window-same-answer premise does not hold.
 */
const load = async (force = false) => {
  if (!org.value) return;
  // Claimed BEFORE the cache is cleared, so any breakdown still in flight is
  // already stale by the time it tries to write back into it.
  const token = requestSeq.begin();
  loading.value = true;
  error.value = null;
  refresh();
  // The open rows' numbers describe the OLD window; keeping them would leave
  // two ranges on screen at once. The instance metrics are the same problem:
  // the previous window's saturation rendered beside this window's latency is
  // two ranges on one row.
  breakdowns.value = {};
  instanceMetrics.value = new Map();
  failedMetricStreams.value = [];

  try {
    // Both windows in one round trip: the previous one is what makes the
    // "slowing down against its own normal" claim possible at all.
    const [currentResponse, previousResponse] = await Promise.all([
      dbMonitoringService.getDatabases(org.value, {
        startTime: current.value.startTime,
        endTime: current.value.endTime,
        system: systemFilter.value ?? undefined,
      }),
      dbMonitoringService.getDatabases(org.value, {
        startTime: previous.value.startTime,
        endTime: previous.value.endTime,
        system: systemFilter.value ?? undefined,
      }),
    ]);

    if (requestSeq.isStale(token)) return;

    const hits = currentResponse.data.hits ?? [];
    freshness.value = currentResponse.data.freshness;
    topNSubset.value = currentResponse.data.top_n_subset;
    neverAggregated.value = currentResponse.data.freshness?.data_through === 0;

    const drowning = new Set(
      detectDrowningDatabases(hits, previousResponse.data.hits ?? []).map((d) => totalsKey(d.row)),
    );

    clientHits.value = hits;
    drowningKeys.value = drowning;
    applyInstanceMetrics();
    // Rows that were open before the reload need their split recomputed for
    // the new window; the watcher only fires when the open SET changes.
    fillOpenBreakdowns(token);
    // The metrics read goes LAST and unawaited. It is additive to a table that
    // is already correct, so it must not be ahead of the breakdown fetches in
    // the browser's connection queue.
    void loadInstanceMetrics(token);
    // The sibling tabs' badges describe the SAME window as this table, so they
    // have to be re-read when it moves. They were previously fetched only once
    // at mount, which left every badge stating the mount-time window while the
    // table beside them stated the new one. Unawaited and token-joined, for the
    // same reason as the metrics read: additive to a table that is already
    // correct, and voided together with it if the window moves again.
    void loadQueryCount(token, force);
  } catch (err: unknown) {
    // A superseded request's failure is not this page's failure.
    if (requestSeq.isStale(token)) return;
    const status = (err as { response?: { status?: number } })?.response?.status;
    // 403 is a diagnosis, not a failure — the empty state names it precisely.
    permissionOk.value = status !== 403;
    if (permissionOk.value) {
      error.value =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        t("dbm.common.loadFailed");
    }
    rows.value = [];
  } finally {
    if (!requestSeq.isStale(token)) loading.value = false;
  }
};

/**
 * Only exceptions get a chip.
 *
 * The chip used to say DEADLOCKS for any error class at all, which put "N
 * DEADLOCKS" on Redis — an engine with no transactions, which cannot deadlock.
 * `db_totals` carries a single undifferentiated `errors` count and nothing that
 * identifies a deadlock, so the truthful word is the generic one. A clean row
 * gets no chip: the absence of a problem chip already says it is healthy, and a
 * permanent HEALTHY badge on the majority of rows is decoration, not signal.
 */
const databaseChips = (row: DbTotalsRow): DbmRowChip[] =>
  (row.errors ?? 0) > 0
    ? [
        {
          id: "errors",
          label: t("dbm.databases.failedChip", { count: formatCount(row.errors) }),
          tone: "error",
        },
      ]
    : [];

/**
 * No value for this column, as opposed to a value of zero. The split's grain
 * carries no p50/p99 and may carry no p95, and a `0` there would read as
 * "instant" — the one thing an absent latency must not say.
 */
const missing = (value: number | null | undefined): boolean =>
  value === null || value === undefined;

/** The placeholder standing in for a split that has not arrived — no figures. */
const isStatusRow = (row: TableRow): boolean => isBreakdownRow(row) && row.kind === "status";

/**
 * Rows that must state no query figure at all.
 *
 * A split placeholder has not been measured yet; a trafficless instance was
 * never measured by the client vantage in the first place. In both cases a `0`
 * would be a measurement nobody made — and on a trafficless row it would rank
 * an idle replica as the fastest database in the fleet.
 */
const noQueryFigures = (row: TableRow): boolean =>
  isStatusRow(row) || (!isBreakdownRow(row) && row.trafficless);

/** Amber only where the warning was actually calculated — on a database row. */
const p95Tone = (row: TableRow): string => {
  if (missing(row.p95_ns)) return "text-text-muted";
  if (!isBreakdownRow(row) && row.drowning) return "text-status-warning-text";
  return "text-text-heading";
};

/**
 * A left rail rather than a wash: red when it is failing, amber when slowing.
 * Child rows carry none — the rail states a verdict about a database, and
 * repeating it down the split would count one problem several times.
 */
const rowClass = (row: TableRow) => {
  if (isBreakdownRow(row)) return "";
  if (row.critical) return "shadow-[inset_0.1875rem_0_0_var(--color-status-error-text)]";
  if (row.drowning) return "shadow-[inset_0.1875rem_0_0_var(--color-status-warning-text)]";
  return "";
};

const rowActions = computed<DbmRowAction[]>(() => [
  { id: "open", icon: "chevron-right", label: t("dbm.databases.openQueries") },
  { id: "alert", icon: "shield", label: t("dbm.databases.alertMe") },
]);

const onRowAction = (id: string, row: DatabaseRow) => {
  if (id === "open") {
    openQueries(row);
    return;
  }
  // Database scope, not query scope: this row IS the whole instance, so the
  // alert watches its aggregate p95 rather than any one statement.
  requestAlertCreation(
    buildDbmPrefill({
      scope: "database",
      kind: "latency",
      dbSystem: row.db_system,
      dbInstance: row.db_instance,
      p95Ns: row.p95_ns,
    }),
  );
};

/**
 * Columns. Sorting is client-side over the complete set, so every numeric
 * column can be sorted honestly — unlike the Top queries table, where the
 * server owns the order and only whitelisted keys may claim to be sortable.
 *
 * The percentile headers say what they mean. These are exact per-database
 * figures, so unlike the query grain they need no qualifier.
 */
const columns = computed<OTableColumnDef<TableRow>[]>(() => [
  {
    id: "instance",
    header: t("dbm.databases.columns.instance"),
    accessorKey: "db_instance",
    size: 300,
    sortable: true,
    meta: { isName: true },
  },
  {
    id: "calls",
    header: t("dbm.databases.columns.calls"),
    accessorKey: "calls",
    size: 96,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "errorRate",
    header: t("dbm.databases.columns.errorRate"),
    accessorKey: "errorRate",
    size: 84,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "p50",
    header: t("dbm.databases.columns.p50"),
    accessorKey: "p50_ns",
    size: 108,
    sortable: true,
    meta: {
      align: "right",
      headerSubLabel: raw("p50"),
      headerTooltip: t("dbm.databases.columnHints.p50"),
    },
  },
  {
    id: "p95",
    header: t("dbm.databases.columns.p95"),
    accessorKey: "p95_ns",
    size: 96,
    sortable: true,
    meta: {
      align: "right",
      headerSubLabel: raw("p95"),
      headerTooltip: t("dbm.databases.columnHints.p95"),
    },
  },
  {
    id: "p99",
    header: t("dbm.databases.columns.p99"),
    accessorKey: "p99_ns",
    size: 92,
    sortable: true,
    meta: {
      align: "right",
      headerSubLabel: raw("p99"),
      headerTooltip: t("dbm.databases.columnHints.p99"),
    },
  },
  {
    id: "services",
    header: t("dbm.databases.columns.services"),
    accessorKey: "calling_services",
    size: 200,
  },
  // What the SERVER says about itself, beside what the applications
  // experienced.
  //
  // Rendered ALWAYS, including when the join is switched off. It used to be
  // dropped from the column set in that case, on the reasoning that a
  // permanently empty column is worse than no column. That is true of a column
  // that says nothing — but a feature the user paid for and cannot see reads as
  // a feature nobody built, and the knob is off by DEFAULT, so on a fresh
  // install that was every user. The cell now states the reason and names the
  // setting, which is the same discipline the four unmatched causes follow.
  {
    id: "instanceHealth",
    header: t("dbm.instanceMetrics.columnHeader"),
    size: 150,
    sortable: true,
    meta: {
      align: "right" as const,
      headerTooltip: t("dbm.instanceMetrics.columnHint"),
    },
  },
  // Two adjacent columns of DIFFERENT provenance, which is the one thing this
  // pair must not hide. `load` is client-observed span time — what the
  // applications waited — and `attention` is the server's own saturation
  // against its own published limit. They are not two views of one measurement
  // and must never be read as comparable, so each carries a sub-label naming
  // the vantage it came from.
  {
    id: "attention",
    header: t("dbm.databases.columns.attention"),
    size: 130,
    sortable: true,
    meta: {
      align: "right" as const,
      headerSubLabel: t("dbm.databases.columnSubLabels.attention"),
      headerTooltip: t("dbm.databases.columnHints.attention"),
    },
  },
  {
    id: "load",
    header: t("dbm.databases.columns.load"),
    accessorKey: "total_time_ns",
    size: 190,
    sortable: true,
    meta: {
      align: "right",
      headerSubLabel: t("dbm.databases.columnSubLabels.load"),
      headerTooltip: t("dbm.databases.columnHints.load"),
    },
  },
  {
    id: "actions",
    header: raw(""),
    size: 72,
    sortable: false,
    meta: { align: "right" },
  },
]);

/** Every column in the mockup's set is on: at two rows there is room for all. */
const defaultColumnVisibility = {};

/**
 * The refresh button. A named handler rather than `@click="load"`: that passes
 * the click EVENT as the first argument, which would arrive as a truthy
 * `force` and quietly make every refresh bypass the badge cache.
 */
const onRefresh = () => {
  void load(true);
};

const onDateChange = (value: DbmDateChange) => {
  setRange(value);
  syncUrl();
  load();
};

const clearScope = () => {
  systemFilter.value = null;
  syncUrl();
  load();
};

/** Mirror the scope into the URL so it survives a tab switch and a reload. */
const syncUrl = () => {
  router
    .replace({
      name: route.name as string,
      query: {
        ...route.query,
        ...queryParams.value,
        system: systemFilter.value ?? undefined,
      },
    })
    .catch(() => {});
};

/**
 * Every cause resolves to an action — `not-instrumented` is the default on a
 * fresh install, and it used to fall through here and do nothing, which made
 * the most prominent button on an empty page a dead click.
 */
const onEmptyAction = (cause: DbmEmptyCauseId) => {
  switch (dbmEmptyAction(cause)) {
    case "open-setup":
      router.push({
        name: DBM_SETUP_ROUTE,
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
      return;
    case "clear-filters":
      search.value = "";
      clearScope();
      return;
    case "reload":
      load();
      return;
    case "none":
  }
};

/**
 * The overview's job is to hand off — a row click carries its scope along, so
 * the Top queries tab opens already filtered to the database the user clicked
 * rather than making them re-pick it.
 *
 * `target` is what a breakdown leaf adds: the schema and service the reader
 * picked, so every node of the split is a filter into the query grain rather
 * than a dead end. Its schema wins over the row's, because the leaf is the
 * narrower and more recent statement of what the reader wants.
 */
const openQueries = (
  row: DatabaseRow,
  target?: { namespace: string | null; service: string | null },
) => {
  const namespace = target?.namespace ?? row.db_namespace;
  router
    .push({
      name: "dbmQueries",
      query: {
        ...route.query,
        org_identifier: org.value,
        ...queryParams.value,
        system: row.db_system,
        instance: row.db_instance,
        ...(namespace ? { namespace } : {}),
        ...(target?.service ? { service: target.service } : {}),
      },
    })
    .catch(() => {});
};

/**
 * One click handler for both tiers, because to the reader they are one table.
 *
 * A database row opens its queries; a child opens the same page already scoped
 * to the schema and service that child names — the leaf hand-off the split has
 * always had, now reached by clicking the row rather than a nested button. The
 * child carries only names, so its database is found by the key it was built
 * from.
 */
const onRowClick = (row: TableRow) => {
  if (!isBreakdownRow(row)) {
    // Nothing queried this instance in the window, so its query list is empty
    // by construction — handing off to it would look like a broken link.
    if (row.trafficless) return;
    openQueries(row);
    return;
  }
  // A placeholder names no schema and no service, so it has no scope to hand
  // off — clicking it would silently open the unfiltered query list.
  if (row.kind === "status") return;
  const parent = rows.value.find((candidate) => row.rowKey.startsWith(`${candidate.rowKey}/`));
  if (parent) openQueries(parent, { namespace: row.namespace, service: row.service });
};

/**
 * The Top-queries tab badge. A separate call because the databases endpoint is
 * a different grain and cannot count fingerprints; `limit: 1` because only the
 * server's uncapped `total` is wanted, not the rows.
 */
/**
 * Counts for the *other* tabs' badges. Every DBM page fills in all of them so
 * the tab bar reads the same everywhere — a badge that appears on one tab and
 * vanishes on the next reads as "no data", not "not fetched here".
 */
const loadQueryCount = async (token: number = requestSeq.current(), force = false) => {
  if (!org.value) return;
  const window = {
    startTime: current.value.startTime,
    endTime: current.value.endTime,
  };
  // Through the SHARED cache, keyed on the range. These five badges are the
  // same five numbers on every DBM tab, and the six tabs are separate ROUTES,
  // so before this each switch re-fetched all of them — ~30 requests over six
  // switches for numbers that had not changed. A count is not cheap either:
  // `/activity` measures 1880ms full and 1739ms at `size=1`, because the cost
  // is the scan, not the rows.
  //
  // `token` joins the load that started this rather than claiming the page
  // (`current()`, not `begin()`) — same rule as `loadBreakdown`. The write
  // below re-checks it, so a window change mid-flight discards these counts
  // instead of painting the previous window's badges beside the new table.
  const badges = await badgesFrom(
    countCache.read(
      org.value,
      range.value,
      async () => {
        // CONCURRENT, not sequential. These five badges have no data dependency
        // on each other, and awaited in series their latencies add: measured
        // against a live backend the five took 2967ms serially, and the slowest
        // (activity) is 1600ms of that on its own. `allSettled`, not `all`,
        // because each badge owns its own failure — one endpoint being down
        // must blank ONE badge, not abandon the other four.
        const [queries, deadlocks, blocking, tableHealth, activity] = await Promise.allSettled([
          dbMonitoringService.getQueries(org.value, { ...window, limit: 1 }),
          dbMonitoringService.getDeadlocks(org.value, window),
          dbMonitoringService.getBlocking(org.value, window),
          dbMonitoringService.getTableHealth(org.value, window),
          dbMonitoringService.getActivity(org.value, window),
        ]);
        // A blank badge is the honest rendering when we could not count. The
        // claim objects are built HERE, inside the cached value, so the
        // server's `truncated` survives a hit and the badge still shows `65+`.
        const value = {
          queryCount:
            queries.status === "fulfilled"
              ? (queries.value.data.total ?? queries.value.data.hits?.length ?? 0)
              : null,
          deadlockCount:
            deadlocks.status === "fulfilled"
              ? countClaim(
                  deadlocks.value.data.total ?? deadlocks.value.data.hits?.length ?? 0,
                  deadlocks.value.data.truncated,
                )
              : null,
          blockedCount:
            blocking.status === "fulfilled"
              ? countClaim(
                  blocking.value.data.total ?? blocking.value.data.hits?.length ?? 0,
                  blocking.value.data.truncated,
                )
              : null,
          // `null`, never 0: a failed read has measured nothing, and a zero
          // badge would claim this deployment has no tables.
          tableHealthCount:
            tableHealth.status === "fulfilled"
              ? (tableHealth.value.data.total ?? tableHealth.value.data.hits?.length ?? 0)
              : null,
          // The STATE BREAKDOWN, never `total`/`hits.length`: those are a
          // row-limited sample and would render a constant cap as the
          // population.
          activityStates:
            activity.status === "fulfilled" ? (activity.value.data.by_state ?? []) : null,
        };
        // `allSettled` never rejects, so a fan-out in which a badge failed
        // would otherwise be CACHED — remembering "we could not count" as the
        // answer for the whole window. Throwing keeps it out of the cache; the
        // partial result still reaches the badges below.
        if (
          [queries, deadlocks, blocking, tableHealth, activity].some((r) => r.status === "rejected")
        ) {
          throw new DbmPartialCounts(value);
        }
        return value;
      },
      { force },
    ),
  );

  if (requestSeq.isStale(token) || !badges) return;

  queryCount.value = badges.queryCount;
  deadlockCount.value = badges.deadlockCount;
  blockedCount.value = badges.blockedCount;
  tableHealthCount.value = badges.tableHealthCount;
  activityStates.value = badges.activityStates;
};

// This page carries no "suggest a fix" button — "make my database faster" has no
// single artifact to reason about. It still registers the scope, so a question
// typed into the chat panel from here lands on the right instance and window.
const dbmContext = createDbmContextProvider(
  () => ({
    currentPage: "databases" as const,
    scope: {
      startTime: current.value.startTime,
      endTime: current.value.endTime,
      period: range.value.relativeTimePeriod,
      system: systemFilter.value,
    },
  }),
  store,
);

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  contextRegistry.register(DBM_CONTEXT_KEY, dbmContext);
  contextRegistry.setActive(DBM_CONTEXT_KEY);
  // `load()` fans out to the badge counts itself, so calling `loadQueryCount`
  // here as well would issue all five a second time on every mount.
  load();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  contextRegistry.unregister(DBM_CONTEXT_KEY);
  contextRegistry.setActive("");
});
</script>
