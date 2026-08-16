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
  <DbmPageChrome
    :title="t('dbm.databases.title')"
    :subtitle="t('dbm.databases.subtitle')"
    title-data-test="dbm-databases-title"
    date-time-data-test="dbm-databases-date-time"
    :tab-counts="tabCounts"
    :range="range"
    @date-change="onDateChange"
  >
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
        :show-global-filter="false"
        :column-visibility="defaultColumnVisibility"
        :persist-columns="true"
        table-id="dbm-databases"
        :enable-column-resize="true"
        :row-class="rowClass"
        tree
        :get-row-warning="hasShortfall"
        v-model:expanded-ids="expandedIds"
        data-test="dbm-databases-table"
        @sort-change="onSortChange"
        @row-click="onRowClick"
      >
        <!-- ONE toolbar row, the same one Top queries uses. The engine select
             is a dimension inside the shared filter popover rather than a bare
             full-width select, so both tabs filter the same way. -->
        <template #toolbar>
          <DbmTableToolbar
            v-model:search="search"
            :placeholder="t('dbm.databases.searchPlaceholder')"
            search-data-test="dbm-databases-search"
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
            data-test="dbm-databases-refresh"
            @refresh="onRefresh"
          />
        </template>

        <template #subheader>
          <!-- The window's totals live inside the table frame, not in the page
               header: they summarise exactly the rows below. -->
          <DbmSubheaderBand data-test="dbm-databases-summary">
            <OStatStrip :items="summaryStats" :loading="loading" />
          </DbmSubheaderBand>
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
             here yet, and a 0 would be a measurement it never made.

             Through DbmOverlapValue because a call count exists in BOTH
             vantages: the cell refuses to print a figure it cannot qualify, so
             there is no path here that shows a number without saying whose
             count it is. -->
        <template #cell-calls="{ row }">
          <DbmOverlapValue
            :value="noQueryFigures(row) ? null : formatCount(row.calls)"
            source="client"
            :qualifier-key="CLIENT_OBSERVED"
            :engine="engineOf(row)"
            data-test="dbm-databases-calls"
          />
        </template>

        <!-- FR-1: the same traffic as a RATE, so a 15-minute view and a 4-hour
             view stay comparable at a glance — a raw count doubles when the
             window doubles; a rate does not. Server-computed over the exact
             window this response answered; a breakdown child derives the same
             division from its own calls. -->
        <template #cell-qps="{ row }">
          <span
            class="font-mono text-xs tabular-nums"
            :class="isStatusRow(row) ? 'text-text-muted' : 'text-text-body'"
          >
            {{ noQueryFigures(row) ? raw("—") : formatRate(rowQps(row)) }}
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

             An instance with no ratio says so rather than showing 0%: a
             MySQL instance sits here until the setup card's connection-limit
             recipe (mysql_connection_max) is installed, because mysqlreceiver
             publishes no max_connections on its own and dividing by an
             invented denominator would rank a saturated MySQL host as the
             calmest thing on the page. -->
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
             (or this schema) the row accounts for. Number and share only, no
             bar — on this page the share is context for the duration, not a
             magnitude to compare visually row-to-row, so a bar per row was
             ink without a reading. -->
        <!-- The share STAYS here, unlike the queries list where it was
             suppressed: there the duration became a server figure and the
             share divided it by a traced total, two populations. Here both the
             duration and the scope total are the same client vantage, so the
             fraction is honest. -->
        <template #cell-load="{ row }">
          <span
            v-if="!noQueryFigures(row)"
            class="flex flex-col items-end leading-tight"
            data-test="dbm-databases-load"
          >
            <span class="flex items-baseline justify-end gap-1">
              <span class="text-text-heading text-compact font-mono font-medium tabular-nums">
                {{ formatNs(row.total_time_ns) }}
              </span>
              <span class="text-text-label text-3xs font-mono tabular-nums">
                {{ formatPercent(row.share, 0) }}
              </span>
            </span>
            <!-- The other overlap measure, and the one where an absent
                 qualifier is most costly: a duration under "Load" with no
                 vantage named reads as time the ENGINE spent, which on
                 MySQL/MariaDB would be wait time. This is span time, and it
                 includes network and pool wait the server never sees (T7). -->
            <span
              class="text-text-label text-3xs"
              :title="t('dbm.detail.overlap.clientObserved', { engine: engineOf(row) ?? '' })"
              data-test="dbm-databases-load-qualifier"
            >
              {{ t("dbm.list.overlap.clientObserved") }}
            </span>
          </span>
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

        <template #empty>
          <DbmEmptyState
            v-if="!loading"
            :permission-ok="permissionOk"
            :enabled="dbmEnabled"
            :trace-count="traceCount"
            :never-aggregated="neverAggregated"
            :org="org"
            :filtered="isFiltered"
            @action="onEmptyAction"
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
defineOptions({ name: "DbmDatabasesPage" });

import { computed, ref, watch, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import DbmCoverageLine from "@/components/dbm/DbmCoverageLine.vue";
import DbmEmptyState, { type DbmEmptyCauseId } from "@/components/dbm/DbmEmptyState.vue";
import DbmInstanceHealthCell from "@/components/dbm/DbmInstanceHealthCell.vue";
import DbmPageChrome from "@/components/dbm/DbmPageChrome.vue";
import DbmRefreshButton from "@/components/dbm/DbmRefreshButton.vue";
import DbmRowActions, { type DbmRowAction } from "@/components/dbm/DbmRowActions.vue";
import DbmRowChips, { type DbmRowChip } from "@/components/dbm/DbmRowChips.vue";
import DbmScopeFilters, { type DbmScopeFilter } from "@/components/dbm/DbmScopeFilters.vue";
import DbmServiceList from "@/components/dbm/DbmServiceList.vue";
import DbmSubheaderBand from "@/components/dbm/DbmSubheaderBand.vue";
import DbmTableToolbar from "@/components/dbm/DbmTableToolbar.vue";
import { dbmEmptyAction, DBM_SETUP_ROUTE } from "@/utils/dbm/emptyAction";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import dbMonitoringService, {
  type DbTotalsRow,
  type Freshness,
  type QueryStatsRow,
} from "@/services/db_monitoring";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useDbmTracePresence } from "@/composables/dbm/useDbmTracePresence";
import { tabCountProps, withOwnCount } from "@/composables/dbm/useDbmTabCounts";
import { useDbmListPage } from "@/composables/dbm/useDbmListPage";
import { createDbmContextProvider } from "@/composables/contextProviders";
import { buildDatabaseBreakdown, type DbmBreakdown } from "@/utils/dbm/breakdown";
import {
  isBreakdownRow,
  showsShortfall,
  toBreakdownRows,
  type DbmBreakdownRow,
} from "@/utils/dbm/breakdownRows";
import {
  computeQps,
  errorRate,
  formatCount,
  formatNs,
  formatPercent,
  formatRate,
  overlapTile,
} from "@/utils/dbm/format";
import { createDbmFilterEntry, optionsFrom } from "@/utils/dbm/filters";
import searchService from "@/services/search";
import useStreams from "@/composables/useStreams";
import streamService from "@/services/stream";
import { collectInstanceMetrics, DBM_METRIC_STREAM_NAMES } from "@/utils/dbm/instanceMetricsRead";
import type { DbmInstanceMetricSet, DbmRowMetrics } from "@/utils/dbm/instanceMetrics";
import { unionFleetRows, type DbmServerInstanceRef } from "@/utils/dbm/fleetRows";
import { healthScalar, healthSortValue } from "@/utils/dbm/healthScalar";
import { detectDrowningDatabases, isCriticalErrorRate, totalsKey } from "@/utils/dbm/insights";
import DbmOverlapValue from "@/components/dbm/DbmOverlapValue.vue";
import { hasDbmTraceVantage } from "@/composables/dbm/useDbmTraceVantage";
import { buildDbmPrefill } from "@/utils/alerts/prefill/fromDbm";
import { requestAlertCreation } from "@/composables/alerts/useAlertCreation";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

// The shared list-page spine: scope from the URL, the request-sequence guard
// (one token for the page, so the per-database breakdown fetches a load starts
// are invalidated by the NEXT load along with the load itself), the shell's
// badge snapshot, refresh/date-change handlers and the load envelope. This
// page's `system` filter is written to the URL by `syncUrl`, which is how the
// shell learns to refetch under it. See useDbmListPage.
const {
  scope: { range, current, previous, queryParams },
  requestSeq,
  tabCountsContext,
  loading,
  error,
  search,
  org,
  dbmEnabled,
  run,
  onRefresh,
  onDateChange,
} = useDbmListPage({
  load: () => load(),
  syncUrl: () => syncUrl(),
  context: () => dbmContext,
});

const rows = shallowRef<DatabaseRow[]>([]);
const freshness = ref<Freshness | null>(null);
const topNSubset = ref(false);
const permissionOk = ref(true);
// `env` is deliberately absent. The databases endpoint deserializes only
// system/service/stream, so an env filter here could count itself as active and
// still return staging merged with prod — a filter that lies is worse than no
// filter. Top queries is the grain that genuinely accepts `env`.
const systemFilter = ref<string | null>((route.query.system as string) ?? null);
/** Kept so the empty state can say "we haven't finished counting" rather than "no data". */
const neverAggregated = ref(false);
/**
 * The sibling badges, from the shell's shared fan-out, plus THIS tab's own
 * count in place of the shared one.
 *
 * `fleetRowCount` is not the same number the shared fan-out produces, and the
 * difference is the point: it counts the rows this page is SHOWING — the
 * fleet union, trafficless instances included — never the raw `hits.length`,
 * which cannot see the instances the metrics join discovered.
 */
const tabCounts = computed(() =>
  // `undefined` while loading: the page has no better number YET, and stamping
  // a transient 0 over the shared snapshot's zero-trace fallback would flash
  // the badge wrong on every first paint. The exact fleet count takes over the
  // moment the union settles.
  tabCountProps(
    withOwnCount(
      tabCountsContext.counts.value,
      "databaseCount",
      loading.value ? undefined : fleetRowCount.value,
    ),
  ),
);

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
const clientHits = shallowRef<DbTotalsRow[]>([]);
const drowningKeys = ref<Set<string>>(new Set());

/** At most this many service chips per row before the cell collapses the rest. */
const MAX_VISIBLE_SERVICES = 3;

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
 * Every database this page shows — trafficless rows INCLUDED. The badge and
 * the Databases tile must count the rows beneath them: on a fleet the
 * applications never queried (a server-vantage-only org), a traffic-only
 * count reads "0" directly above rendered rows, which denies working data.
 * The neighbouring query-vantage badges legitimately read 0 there; an idle
 * replica is still a database, so it counts here and nowhere else.
 */
const fleetRowCount = computed(() => rows.value.length);

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
const summaryStats = computed<StatItem[]>(() => {
  // Both figures are summed over the CLIENT hits, so the trace vantage is the
  // population signal: no trace rows means nobody measured, and the sums are
  // `[].reduce(+, 0)` rather than a fleet that ran nothing. `traceVantage`
  // keeps the tiles rendering while loading or after a failed read, so they do
  // not flicker out — see useDbmTraceVantage.
  const calls = overlapTile(totalCalls.value, traceVantage.value, formatCount);
  const time = overlapTile(totalTime.value, traceVantage.value, formatNs);

  return [
    {
      key: "databases",
      label: t("dbm.databases.summary.databases"),
      // The same count the tab badge shows: two different numbers under one
      // word on one screen is worse than either. Trafficless rows count — see
      // fleetRowCount — and this is a SERVER-side fleet count, so it stands on
      // its own when the trace vantage is empty rather than being withheld
      // with the two query-vantage tiles beside it.
      value: fleetRowCount.value,
      icon: "database",
      tone: "primary",
      dataTest: "dbm-databases-summary-databases",
    },
    {
      key: "calls",
      label: t("dbm.databases.summary.calls"),
      value: calls.value ?? raw("—"),
      icon: "bar-chart",
      tone: "info",
      dataTest: "dbm-databases-summary-calls",
    },
    {
      key: "time",
      label: t("dbm.databases.summary.time"),
      value: time.value ?? raw("—"),
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
  ];
});

const isFiltered = computed(() => !!search.value || !!systemFilter.value);

// Every filter change publishes the scope to the URL BEFORE reloading — the
// factory owns the handler, so no entry can forget the URL half.
const filterEntry = createDbmFilterEntry(() => {
  syncUrl();
  load();
});

/**
 * The same popover-and-chips control Top queries uses. Only the dimensions this
 * endpoint actually accepts are offered — a select that silently did nothing
 * would be worse than its absence.
 */
const dimensionFilters = computed<DbmScopeFilter[]>(() => [
  filterEntry({
    key: "system",
    dimension: t("dbm.filters.dimension.system"),
    placeholder: t("dbm.filters.allEngines"),
    options: optionsFrom(rows.value.map((r) => r.db_system)),
    model: systemFilter,
  }),
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
// The default must be explicit: left empty, the order falls through to server
// response order, which carries no ranking meaning and makes the top row look
// arbitrary. `load` keeps its column and its own sort.
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

/**
 * The engine that reported a row, for the client-observed attribution tooltip.
 *
 * Only a database row carries one: a breakdown row is a schema or service
 * *within* a database, so it has no engine of its own and must not borrow its
 * parent's — the tooltip would then attribute the figure to something the row
 * does not name. `undefined` is the honest answer and is what `DbmOverlapValue`
 * already defaults to.
 */
const engineOf = (row: TableRow): string | undefined =>
  isBreakdownRow(row) ? undefined : row.db_system;

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
    case "qps":
      return rowQps(row) ?? 0;
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
    const parentKey = row.rowKey.slice(0, -"/status".length);
    return breakdowns.value[parentKey]?.error || t("dbm.common.loadFailed");
  }
  return row.status === "empty"
    ? t("dbm.breakdown.nothingToAttribute")
    : t("dbm.breakdown.loading");
};

/**
 * The per-instance splits the LAST load brought down, keyed by `db_instance` —
 * exactly the shape `include_breakdown` returns.
 *
 * This used to be one `GET /queries?instance=<row>&stmt_class=all` PER EXPANDED
 * ROW, re-fired for every open row on every window change: opening six
 * databases and moving the range cost six requests, all answering a question
 * the overview's own read had already paid for. `include_breakdown=true` folds
 * them into the response that draws the table, so expanding a row is now a
 * lookup rather than a fetch. `null` means the section was not in the response
 * at all (an older server, or the read failing) — which is what the row's error
 * placeholder is for.
 */
const instanceBreakdowns = shallowRef<Record<string, QueryStatsRow[]> | null>(null);
const breakdownFailed = ref(false);

/**
 * File one database's split from what the last load returned.
 *
 * The row's own exact total rides along so the aggregation can report its
 * shortfall rather than presenting a sum that silently does not reconcile. The
 * split is keyed by INSTANCE, and that is the grain it always had: the
 * per-row request scoped on `instance` alone, so two namespace rows on one
 * instance received the same response then and read the same entry now.
 */
const fileBreakdown = (row: DatabaseRow) => {
  const section = instanceBreakdowns.value;
  if (!section || breakdownFailed.value) {
    breakdowns.value = {
      ...breakdowns.value,
      [row.rowKey]: {
        breakdown: buildDatabaseBreakdown([]),
        loading: false,
        error: t("dbm.common.loadFailed"),
      },
    };
    return;
  }
  breakdowns.value = {
    ...breakdowns.value,
    [row.rowKey]: {
      // An instance with no rows in the split is an EMPTY breakdown, not a
      // failure: nothing was attributable, which the `empty` placeholder
      // already says better than an error would.
      breakdown: buildDatabaseBreakdown(section[row.db_instance] ?? [], row.total_time_ns),
      loading: false,
      error: null,
    },
  };
};

/**
 * File every open DATABASE row that has no state yet — on open, and after a
 * reload. Open schema rows are in the same set and are skipped here: their
 * children came from their parent's entry, so there is nothing left to file.
 *
 * No longer async and no longer takes a request token: there is no request to
 * be stale against. The split and the table it describes came down together,
 * so the pair cannot disagree about which window it is.
 */
const fillOpenBreakdowns = () => {
  for (const id of expandedIds.value) {
    if (breakdowns.value[id]) continue;
    const row = rows.value.find((candidate) => candidate.rowKey === id);
    if (row) fileBreakdown(row);
  }
};

// A re-open reuses what we have; the range or filter changing is what
// invalidates it, and `load()` clears the cache so this re-files. Wrapped so
// the watcher's own arguments cannot land in a parameter.
watch(expandedIds, () => fillOpenBreakdowns());

/**
 * Every instance the SERVER vantage has named, read off the shell's shared
 * badge snapshot — the activity and blocking samples are `dbm_server` rows and
 * each carries the instance it was sampled on. No new request: the shell
 * already paid for these to draw the tab badges, and a second read over the
 * same window could disagree with the badge beside it.
 *
 * Identity only. The union must not carry any figure from these rows onto the
 * overview — the server vantage measured no query traffic, and the fleet union
 * marks what it adds as `trafficless` for exactly that reason.
 */
const serverKnownInstances = computed<DbmServerInstanceRef[]>(() => {
  const counts = tabCountsContext.counts.value;
  return [...counts.sessions, ...counts.blockingSamples].map((row) => ({
    db_system: row.db_system,
    db_instance: row.db_instance,
  }));
});

// The shell's fan-out lands on its own schedule — often after this page's own
// read. Rebuild the union when it does, so server-known instances appear
// without a refresh. Mid-load the rebuild is skipped: `load()` re-runs the
// union itself when it settles, and rebuilding here would pair the new
// snapshot with the OLD window's client rows.
watch(serverKnownInstances, () => {
  if (!loading.value) applyInstanceMetrics();
});

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
    // The instances the SERVER vantage knows, from data the shell already
    // fetched for the tab badges. This is what keeps the overview honest for
    // the user who wired up collector recipes but has no APM: their fleet is
    // one no application ever queried, and without this source the page would
    // be empty while working server-vantage data sits one tab away.
    serverInstances: serverKnownInstances.value,
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

const { getStreams } = useStreams(t);

/**
 * Whether this org has EVER sent a trace, for the empty state's checklist.
 * Without it a never-instrumented org reads the "we haven't finished counting"
 * row — a promise of numbers in "a few minutes" that will never arrive —
 * instead of being told database monitoring is built from traces it has not
 * sent. Probed only when a load ends with nothing to show; see `load`.
 */
const { traceCount, probeTracePresence } = useDbmTracePresence(getStreams);

/**
 * The metric streams that exist here, from the session-cached catalog. `null`
 * on failure or an empty catalog — both mean "we don't know", and the caller
 * falls back to sweeping the full spec list rather than trusting a blank.
 */
const metricStreamNames = async (): Promise<ReadonlySet<string> | null> => {
  try {
    const response = (await getStreams("metrics", false, false)) as { list?: { name: string }[] };
    const names = (response?.list ?? []).map((stream) => stream.name).filter(Boolean);
    return names.length ? new Set(names) : null;
  } catch {
    return null;
  }
};

/**
 * Each existing metric stream's actual columns, so the sweep's SQL is built
 * from what the collector REALLY writes rather than from the spec's claim
 * about it — the claim has been wrong before (`db_namespace` vs the
 * receiver's `postgresql_database_name`), and a renamed column then fails as
 * a 400 on every load. Cached per (org, stream) for the session: schemas move
 * on collector upgrades, not between refreshes. A failed fetch caches as
 * `null` and that stream keeps the trust-then-retry path.
 */
const metricSchemaCache = new Map<string, Promise<ReadonlySet<string> | null>>();

const metricStreamFields = async (
  existingStreams: ReadonlySet<string> | null,
): Promise<ReadonlyMap<string, ReadonlySet<string>> | null> => {
  if (!existingStreams?.size) return null;
  const wanted = DBM_METRIC_STREAM_NAMES.filter((stream) => existingStreams.has(stream));
  if (!wanted.length) return null;
  const entries = await Promise.all(
    wanted.map(async (stream) => {
      const key = `${org.value}|${stream}`;
      let pending = metricSchemaCache.get(key);
      if (!pending) {
        pending = streamService
          .schema(org.value, stream, "metrics")
          .then((response: { data?: { schema?: { name?: string }[] } }) => {
            const fields = (response.data?.schema ?? [])
              .map((field) => field.name)
              .filter((name): name is string => Boolean(name));
            return fields.length ? new Set(fields) : null;
          })
          .catch(() => null);
        metricSchemaCache.set(key, pending);
      }
      return [stream, await pending] as const;
    }),
  );
  const byStream = new Map<string, ReadonlySet<string>>();
  for (const [stream, fields] of entries) {
    if (fields) byStream.set(stream, fields);
  }
  return byStream.size ? byStream : null;
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
  // Ask the (session-cached) stream catalog which of the eight metric streams
  // exist before sweeping, so a deployment carrying two of them fires two
  // searches instead of two hits and six guaranteed 400s on every load. On any
  // catalog failure the sweep runs unfiltered — see collectInstanceMetrics.
  const existingStreams = await metricStreamNames();
  // Then ask each existing stream's schema (also session-cached) which columns
  // it really carries, so the SQL never names a field the collector renamed.
  const fieldsByStream = await metricStreamFields(existingStreams);
  try {
    const collected = await collectInstanceMetrics(
      async (_stream, sql) => {
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
      },
      window,
      { existingStreams, fieldsByStream },
    );
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
 * This page's OWN read. It takes no `force`: the table was always fetched live,
 * so the flag only ever reached the badge cache — and the badges are the
 * shell's now. `onRefresh` forces them directly.
 */
const load = () =>
  run(
    async (token) => {
      // Both windows in ONE request — the server reads them concurrently and
      // returns the baseline as `baseline_hits`. The previous window is what
      // makes the "slowing down against its own normal" claim possible at all;
      // if its read failed server-side the drowning detection goes quiet rather
      // than comparing against an empty set it would misread as recovery.
      const { data } = await dbMonitoringService.getDatabases(org.value, {
        startTime: current.value.startTime,
        endTime: current.value.endTime,
        system: systemFilter.value ?? undefined,
        baselineStartTime: previous.value.startTime,
        baselineEndTime: previous.value.endTime,
        // The per-instance split rides along, so expanding a row costs no
        // request. It is folded from the `query_stats` rows this response
        // already reads to name each row's calling services — the same rows
        // the per-row `GET /queries` used to re-fetch, once per open row, on
        // every window change.
        includeBreakdown: true,
      });

      if (requestSeq.isStale(token)) return;

      const hits = data.hits ?? [];
      freshness.value = data.freshness;
      topNSubset.value = data.top_n_subset;
      neverAggregated.value = data.freshness?.data_through === 0;

      const drowning = data.baseline_read_failed
        ? new Set<string>()
        : new Set(
            detectDrowningDatabases(hits, data.baseline_hits ?? []).map((d) => totalsKey(d.row)),
          );

      clientHits.value = hits;
      drowningKeys.value = drowning;
      instanceBreakdowns.value = data.breakdown ?? null;
      breakdownFailed.value = !!data.breakdown_read_failed;
      applyInstanceMetrics();
      // Rows that were open before the reload need their split re-filed for
      // the new window; the watcher only fires when the open SET changes.
      fillOpenBreakdowns();
      // The metrics read goes LAST and unawaited. It is additive to a table that
      // is already correct, so it must not be ahead of the breakdown fetches in
      // the browser's connection queue.
      void loadInstanceMetrics(token);
      // The sibling badges are NOT fetched here. DbmShell watches the window
      // and the `system` filter in the URL — both of which this page publishes
      // via `syncUrl` — and refetches them itself, once for every tab. A call
      // here would restore the per-page fan-out. The one thing the shell cannot
      // infer is a REFRESH, since the URL does not change: that is why
      // `onRefresh` forces explicitly.
    },
    {
      // The open rows' numbers describe the OLD window; keeping them would
      // leave two ranges on screen at once. Both the cache and the section it
      // is filed from are cleared, so an open row shows its loading
      // placeholder until the new response re-files it. The instance metrics
      // are the same problem: the previous window's saturation rendered beside
      // this window's latency is two ranges on one row.
      before: () => {
        breakdowns.value = {};
        instanceBreakdowns.value = null;
        breakdownFailed.value = false;
        instanceMetrics.value = new Map();
        failedMetricStreams.value = [];
      },
      reset: () => {
        rows.value = [];
      },
      // 403 is a diagnosis, not a failure — the empty state names it precisely.
      onForbidden: () => {
        permissionOk.value = false;
      },
      onError: (serverMessage) => {
        permissionOk.value = true;
        error.value = serverMessage ?? t("dbm.common.loadFailed");
      },
      settled: () => {
        // The trace-presence probe answers a question only the empty state
        // asks, so it runs exactly when the empty state is about to render — a
        // load that produced rows never pays for it. Unawaited: the checklist
        // gains its trace row when the (session-cached) catalog answers.
        if (!rows.value.length) void probeTracePresence();
      },
    },
  );

/**
 * Only exceptions get a chip.
 *
 * `db_totals` carries a single undifferentiated `errors` count and nothing
 * that identifies a deadlock, so the truthful word is the generic one — a
 * DEADLOCKS chip here would put "N DEADLOCKS" on Redis, an engine with no
 * transactions, which cannot deadlock. A clean row gets no chip: the absence
 * of a problem chip already says it is healthy, and a permanent HEALTHY badge
 * on the majority of rows is decoration, not signal.
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

/**
 * Does THIS window have a trace vantage at all?
 *
 * Every figure this page ranks on — calls, load, the percentiles, the error
 * rate — comes from `db_totals`, which is trace-derived. So when the trace
 * read answers successfully with nothing, the latency columns are not "zero
 * latency", they are a vantage that was never there, and D3 says hide them
 * rather than paint a column of dashes a reader will average to "fast".
 *
 * `loading`/`error` keep the vantage PRESENT deliberately: a failed read is
 * not an observation of absence, and hiding on it would make columns vanish
 * and reappear on every refresh. See useDbmTraceVantage.
 */
const traceVantage = computed(() =>
  hasDbmTraceVantage({
    rows: clientHits.value,
    readFailed: !!error.value,
    loading: loading.value,
  }),
);

/**
 * The two OVERLAP measures on this page — the call count and the database
 * time — carry no server counterpart, and the qualifier says so.
 *
 * This page's grain is the DATABASE, not the statement. The only server-side
 * per-statement feed (`/server_queries`) is a top-N ranked BY CALLS and comes
 * back `truncated` even at its 200-row cap on the live `default` org, so
 * folding it up to a database total would publish a floor as a total (trap
 * T8) — and its MySQL rows carry no `db_namespace` at all, so they cannot be
 * attributed to a database row in the first place. There is therefore no
 * honest server value to resolve to here, and inventing one is worse than
 * labelling the one we have.
 *
 * So the resolver's server branch is unreachable at this grain and these
 * render as `clientObserved`. That is not a placeholder for a future server
 * number: it is the true provenance, and it is exactly what D2 demands be
 * said out loud, because "Calls" with no qualifier reads as what the DATABASE
 * counted when it is what our instrumented callers counted — a number the
 * live fleet shows to be ~3.7x smaller.
 */
const CLIENT_OBSERVED = "clientObserved";

/**
 * Calls-per-second for one row. Database rows carry the server-computed rate
 * (`qps`, stamped over the exact window the response answered); a breakdown
 * child carries only its calls, so the same division runs here over the same
 * window. `null` — never 0 — when there is no count to divide.
 */
const rowQps = (row: DatabaseRow | TableRow): number | null => {
  if (!isBreakdownRow(row) && row.qps !== undefined) return row.qps;
  return computeQps(row.calls, current.value.startTime, current.value.endTime);
};

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
const allColumns = computed<OTableColumnDef<TableRow>[]>(() => [
  {
    id: "instance",
    header: t("dbm.databases.columns.instance"),
    accessorKey: "db_instance",
    size: 300,
    sortable: true,
    meta: { isName: true },
  },
  // An OVERLAP measure: both vantages count calls, so the column may not stay
  // silent about which one it is quoting (D2). The header states the
  // provenance once — it is constant for every row this endpoint returns —
  // and the per-row marker in the cell states what the number IS, which is the
  // half that cannot be hoisted into a header on a table that mixes engines.
  {
    id: "calls",
    header: t("dbm.databases.columns.calls"),
    accessorKey: "calls",
    size: 96,
    sortable: true,
    meta: {
      align: "right",
      headerSubLabel: t("dbm.databases.columnSubLabels.calls"),
    },
  },
  {
    id: "qps",
    header: t("dbm.databases.columns.qps"),
    size: 84,
    sortable: true,
    meta: {
      align: "right",
      headerTooltip: t("dbm.databases.columnHints.qps"),
    },
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
  // Rendered ALWAYS, including when the join is switched off. Dropping the
  // column in that case sounds right — a permanently empty column is worse
  // than no column — but a feature the user paid for and cannot see reads as
  // a feature nobody built, and the knob is off by DEFAULT, so on a fresh
  // install that is every user. The cell states the reason and names the
  // setting, which is the same discipline the four unmatched causes follow.
  {
    id: "instanceHealth",
    header: t("dbm.instanceMetrics.columnHeader"),
    // Width 200: the cell carries a sparkline, the ratio, the "N of M
    // connections" line AND the secondary chips (cache hit, lag, deadlocks);
    // at 150 the chips wrap into a third line.
    size: 200,
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

/**
 * Columns only the TRACE vantage can fill. Percentiles are trace-only for us
 * by collection choice — neither receiver ships a quantile column — and the
 * failure rate counts what the CALLER saw, including timeouts and pool
 * exhaustion that never reached the database and so left no server row.
 */
const TRACE_ONLY_COLUMNS = new Set(["p50", "p95", "p99", "errorRate"]);

/**
 * D3: when this window has no trace vantage, the trace-only columns are
 * REMOVED rather than filled with dashes.
 *
 * A column of "—" invites exactly the reading it should prevent: a reader
 * scanning a latency column of dashes concludes the databases are idle, when
 * what actually happened is that nothing instrumented called them. Dropping
 * the column states the same fact without offering a number-shaped blank to
 * misread. The server-vantage columns (attention, instance health) are
 * untouched — they had no trace input to lose, and on a zero-trace fleet they
 * are the entire value of the page.
 */
const columns = computed<OTableColumnDef<TableRow>[]>(() =>
  traceVantage.value
    ? allColumns.value
    : allColumns.value.filter((column) => !TRACE_ONLY_COLUMNS.has(column.id)),
);

/** Every column in the mockup's set is on: at two rows there is room for all. */
const defaultColumnVisibility = {};

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
    // A trafficless row navigates too: the query list is no longer empty by
    // construction for it — Top queries falls back to the database-reported
    // list, and the system/instance scope this handoff carries filters that
    // list to exactly this row. The earlier early-return here predates the
    // fallback and had turned the whole fleet into dead rows on a no-APM org.
    openQueries(row);
    return;
  }
  // A placeholder names no schema and no service, so it has no scope to hand
  // off — clicking it would silently open the unfiltered query list.
  if (row.kind === "status") return;
  const parent = rows.value.find((candidate) => row.rowKey.startsWith(`${candidate.rowKey}/`));
  if (parent) openQueries(parent, { namespace: row.namespace, service: row.service });
};

// This page carries no "suggest a fix" button — "make my database faster" has no
// single artifact to reason about. It still registers the scope (via
// useDbmListPage's lifecycle), so a question typed into the chat panel from
// here lands on the right instance and window.
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
</script>
