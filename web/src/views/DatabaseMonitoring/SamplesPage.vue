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
  Slowest calls (FR-6) — the slowest individual database calls in the window,
  across every system, instance and query.

  Top queries answers "which KIND of query costs the most, in aggregate"; this
  page answers the question that starts an incident — "what were the worst
  calls anywhere, just now?" — before the reader knows which query to blame.
  Every row is ONE real completed execution with its trace attached, so the
  path is: spot the outlier → open its trace → see the whole request around it.

  Honesty requirements this page carries:

    • Client-observed, FINISHED calls only. A query still running, or one that
      hung and never came back, emits no span and is not here — stated in the
      subtitle, not buried.
    • The answer is a CUT, and says so: the server returns the slowest N and
      discloses `truncated` when more qualifying calls existed. The count line
      says "the slowest N" rather than implying the table is everything.
    • A partial read is disclosed too: when some stream could not be read the
      answer may be missing rows, and the count line says so instead of
      presenting the remainder as complete.

  The scatter above the table is the same drawing the query-detail page uses:
  it spreads the samples across time AND duration, so "one spike at 14:02" and
  "everything is slow" — which demand different responses — look different.
-->
<template>
  <OPageLayout
    :title="t('dbm.samples.title')"
    :subtitle="t(serverListShown ? 'dbm.samples.subtitleServer' : 'dbm.samples.subtitle')"
    icon="database"
    title-data-test="dbm-samples-title"
    tabs-below
    bleed
  >
    <template #header-tabs>
      <DbmSectionTabs v-bind="tabCounts" />
    </template>

    <template #actions>
      <DateTime
        auto-apply
        menu-align="end"
        :default-type="range.type"
        :default-absolute-time="{ startTime: range.startTime, endTime: range.endTime }"
        :default-relative-time="range.relativeTimePeriod ?? undefined"
        data-test-name="dbm-samples-date-time"
        class="h-8"
        @on:date-change="onDateChange"
      />
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <!-- In fallback mode the client table UNMOUNTS: its tall empty-state
           checklist would otherwise consume the viewport and squeeze the
           database-reported list to nothing. The section below carries its
           own toolbar (same search/refresh bindings), and its subtitle states
           why the usual list is empty. -->
      <OTable
        v-if="!serverListShown"
        :data="rows"
        :columns="columns"
        row-key="rowKey"
        :loading="loading"
        :frame="false"
        :error="error"
        sorting="client"
        :show-global-filter="false"
        table-id="dbm-samples"
        :total-count-exact="!truncated"
        data-test="dbm-samples-table"
        @row-click="onRowClick"
      >
        <template #toolbar>
          <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <div class="w-64 shrink-0">
              <OSearchInput
                v-model="search"
                :placeholder="t('dbm.samples.searchPlaceholder')"
                clearable
                :debounce="400"
                data-test="dbm-samples-search"
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
            data-test="dbm-samples-refresh"
            @click="onRefresh"
          >
            <OTooltip side="bottom" :content="t('dbm.common.reload')" />
          </OButton>
        </template>

        <template #subheader>
          <!-- The scatter — inside the table frame because it draws exactly
               the rows below it. Hidden while empty: an axis with no points
               would push the empty state's explanation below the fold. -->
          <div
            v-if="scatterSamples.length"
            class="px-page-edge border-table-row-divider h-50 w-full border-b py-1.5"
            data-test="dbm-samples-scatter"
          >
            <ChartRenderer :data="{ options: samplesOption }" @click="onScatterClick" />
          </div>
        </template>

        <!-- The statement, with where it ran under it. -->
        <template #cell-query="{ row }">
          <div class="flex min-w-0 flex-col gap-px">
            <span
              class="text-text-code min-w-0 truncate font-mono text-xs"
              :title="row.queryText"
              >{{ raw(row.queryText || "—") }}</span
            >
            <div class="text-text-label text-3xs flex min-w-0 items-center gap-1 truncate">
              <OTag v-if="row.dbSystem" type="dbSystem" :value="row.dbSystem" size="xs" />
              <template v-if="row.dbInstance">
                <span class="opacity-45">·</span>
                <span>{{ raw(row.dbInstance) }}</span>
              </template>
              <template v-if="row.dbNamespace">
                <span class="opacity-45">·</span>
                <span>{{ raw(row.dbNamespace) }}</span>
              </template>
            </div>
          </div>
        </template>

        <template #cell-timestamp="{ row }">
          <span class="tabular-nums">{{ formatWhen(row.timestamp) }}</span>
        </template>

        <template #cell-duration="{ row }">
          <span
            v-if="row.durationNs !== null"
            class="text-text-heading text-compact font-mono font-semibold tabular-nums"
          >
            {{ formatNs(row.durationNs) }}
          </span>
          <span v-else class="text-text-muted">{{ raw("—") }}</span>
        </template>

        <template #cell-service="{ row }">
          <span class="text-text-body block truncate text-xs">{{
            raw(row.serviceName || "—")
          }}</span>
        </template>

        <!-- Failed calls carry the driver's status code when there is one;
             a healthy call stays quiet rather than shouting OK 100 times. -->
        <template #cell-status="{ row }">
          <OTag
            v-if="row.isError"
            type="dataConfidence"
            value="gap"
            :label="
              row.statusCode
                ? t('dbm.samples.failedWithCode', { code: row.statusCode })
                : t('dbm.samples.failed')
            "
          />
          <span v-else class="text-text-muted">{{ raw("—") }}</span>
        </template>

        <template #cell-actions="{ row }">
          <OButton
            v-if="sampleTraceFilter(row)"
            variant="ghost"
            size="icon-sm"
            icon-left="open-in-new"
            :data-test="`dbm-samples-trace-${row.rowKey}`"
            @click.stop="openSampleTrace(row)"
          >
            <OTooltip side="left" :content="t('dbm.samples.viewTrace')" />
          </OButton>
        </template>

        <template #bottom>
          <div
            class="text-text-secondary flex w-full items-center gap-2.5"
            data-test="dbm-samples-status-bar"
          >
            <span>{{ countLine }}</span>
            <span
              v-if="streamsFailed > 0"
              class="text-status-warning-text"
              data-test="dbm-samples-partial"
            >
              {{ t("dbm.samples.partial") }}
            </span>
            <div class="flex-1"></div>
            <span class="text-text-label flex shrink-0 items-center gap-1">
              <OIcon name="info-outline" class="size-3 shrink-0" />
              {{ t("dbm.samples.disclosureShort") }}
              <OTooltip side="top" :content="t('dbm.samples.disclosureDetail')" />
            </span>
          </div>
        </template>

        <template #empty>
          <!-- The reader's own search emptied the table — not a quiet window. -->
          <OEmptyState
            v-if="!loading && searchHidEverything"
            preset="no-search-results"
            data-test="dbm-samples-no-matches"
            @action="search = ''"
          />
          <DbmEmptyState
            v-else-if="!loading"
            :permission-ok="permissionOk"
            :enabled="dbmEnabled"
            :trace-count="traceCount"
            :org="org"
            :filtered="isFiltered"
            @action="onEmptyAction"
          />
        </template>
      </OTable>

      <!-- The database-reported list, ONLY when the client table above is
           honestly empty. Its own heading and its own table: these durations
           are measured inside the database at statement completion, and mixing
           them into the client table would read as traced calls that never
           existed. The empty state above stays — it explains WHY the usual
           list is empty; this section answers what the databases saw
           meanwhile. Mirrors the QueriesPage server section. -->
      <section
        v-if="!loading && !rows.length && filteredServerRows.length"
        class="flex min-h-0 flex-1 flex-col gap-2 pt-4"
        data-test="dbm-server-samples-section"
      >
        <div class="px-page-edge flex flex-col gap-0.5">
          <h2 class="text-text-heading text-sm font-semibold">
            {{ t("dbm.samples.serverList.title") }}
          </h2>
          <p class="text-text-label text-xs">
            {{ t("dbm.samples.serverList.subtitle") }}
          </p>
        </div>
        <OTable
          :data="filteredServerRows"
          :columns="serverColumns"
          row-key="rowKey"
          :frame="false"
          sorting="client"
          :show-global-filter="false"
          table-id="dbm-server-samples"
          :total-count-exact="!serverTruncated"
          data-test="dbm-server-samples-table"
          @row-click="openServerSampleDetail"
        >
          <!-- The section owns the page in fallback mode (the client table is
               unmounted), so it carries the toolbar — same search and refresh
               bindings. -->
          <template #toolbar>
            <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <div class="w-64 shrink-0">
                <OSearchInput
                  v-model="search"
                  :placeholder="t('dbm.samples.searchPlaceholder')"
                  clearable
                  :debounce="400"
                  data-test="dbm-server-samples-search"
                />
              </div>
            </div>
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              class="shrink-0"
              data-test="dbm-server-samples-refresh"
              @click="onRefresh"
            >
              <OTooltip side="bottom" :content="t('dbm.common.reload')" />
            </OButton>
          </template>
          <template #cell-query="{ row }">
            <div class="flex min-w-0 flex-col gap-px">
              <span
                class="text-text-code min-w-0 truncate font-mono text-xs"
                :title="row.query ?? undefined"
                >{{ raw(row.query || "—") }}</span
              >
              <div class="text-text-label text-3xs flex min-w-0 items-center gap-1 truncate">
                <OTag v-if="row.db_system" type="dbSystem" :value="row.db_system" size="xs" />
                <template v-if="row.db_instance">
                  <span class="opacity-45">·</span>
                  <span>{{ raw(row.db_instance) }}</span>
                </template>
                <template v-if="row.db_namespace">
                  <span class="opacity-45">·</span>
                  <span>{{ raw(row.db_namespace) }}</span>
                </template>
              </div>
            </div>
          </template>
          <template #cell-when="{ row }">
            <span class="tabular-nums">{{ formatWhen(row.timestamp) }}</span>
          </template>
          <template #cell-took="{ row }">
            <span
              v-if="row.duration_ms !== null"
              class="text-text-heading text-compact font-mono font-semibold tabular-nums"
            >
              {{ formatNs(row.duration_ms * 1e6) }}
            </span>
            <span v-else class="text-text-muted">{{ raw("—") }}</span>
          </template>
          <template #cell-user="{ row }">
            <span class="text-text-body block truncate text-xs">{{ raw(row.db_user || "—") }}</span>
          </template>
          <template #bottom>
            <div v-if="serverTruncated" class="text-text-label px-page-edge py-1.5 text-xs">
              {{ t("dbm.samples.serverList.truncated", { count: serverRows.length }) }}
            </div>
          </template>
        </OTable>
      </section>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
// Explicit name so <keep-alive :include> in DbmShell.vue matches this view.
// Without it the name is inferred from the FILENAME, so a rename would
// silently drop the page from the cache and bring back the refetch-on-return.
defineOptions({ name: "DbmSamplesPage" });

import { computed, defineAsyncComponent, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import DbmEmptyState, { type DbmEmptyCauseId } from "@/components/dbm/DbmEmptyState.vue";
import DbmScopeFilters, { type DbmScopeFilter } from "@/components/dbm/DbmScopeFilters.vue";
import DbmSectionTabs from "@/components/dbm/DbmSectionTabs.vue";
import DateTime from "@/components/DateTime.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import dbMonitoringService, { type ServerSampleRow } from "@/services/db_monitoring";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useDbmRequestSeq } from "@/composables/dbm/useDbmRequestSeq";
import { useDbmTracePresence } from "@/composables/dbm/useDbmTracePresence";
import useStreams from "@/composables/useStreams";
import { setDbmQueryDetailSeed } from "@/composables/dbm/dbmQueryDetailSeed";
import { useDbmTabCountsContext } from "@/composables/dbm/dbmTabCounts";
import { tabCountProps, withOwnCount } from "@/composables/dbm/useDbmTabCounts";
import { useDbmScopeSync } from "@/composables/dbm/useDbmScopeSync";
import { useDbmScope, type DbmDateChange } from "@/composables/dbm/useDbmScope";
import { chartColor } from "@/utils/chartTheme";
import { dbmEmptyAction, DBM_SETUP_ROUTE } from "@/utils/dbm/emptyAction";
import { countClaim, formatNs } from "@/utils/dbm/format";
import { buildSamplesOption, type DbmChartTheme } from "@/utils/dbm/historyChart";
import {
  buildSampleRows,
  sampleQueryDetailTarget,
  sampleTraceFilter,
  type DbmSampleRow,
} from "@/utils/dbm/samples";

/**
 * Same async seam as the query-detail scatter, for the same reason: the chart
 * bundle is heavy and the table must not wait for it.
 */
const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

// The window arrives from the URL, so a tab switch, a back button and a shared
// link all land on the SAME scope rather than resetting to the default.
const { range, current, rangeMinutes, refresh, setRange, queryParams } = useDbmScope(route.query);

// Search, filters, the picker and refresh can all be in flight at once; this
// keeps the last request the reader made the one that paints.
const requestSeq = useDbmRequestSeq();

// The sibling-tab badges are the same numbers on every tab, so DbmShell
// fetches them ONCE per window for every route and this page reads the
// snapshot. The page's own client rows never override the badge — they are a
// capped top-list, not the population (see `sampleCallsCount` in
// useDbmTabCounts.ts). The ONE override is fallback mode: with zero client
// rows and a database-reported list rendered beneath the badge, the shared
// `0` would deny working data — so the badge counts the reported list as a
// capped claim (`100+`), the same false-zero rule the fleet badge follows.
const tabCountsContext = useDbmTabCountsContext();
const tabCounts = computed(() =>
  tabCountProps(
    withOwnCount(
      tabCountsContext.counts.value,
      "sampleCallsCount",
      allRows.value.length || !serverRows.value.length
        ? undefined
        : countClaim(serverRows.value.length, serverTruncated.value),
    ),
  ),
);

const org = computed(() => store.state.selectedOrganization?.identifier as string);
const dbmEnabled = computed(() => Boolean(store.state.zoConfig?.database_monitoring_enabled));

const allRows = ref<DbmSampleRow[]>([]);
const truncated = ref(false);
const streamsFailed = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const permissionOk = ref(true);
const search = ref("");

/**
 * The database-reported fallback list (`/server_samples`). Populated ONLY
 * when the client read comes back empty: the databases log their own slowest
 * completed statements with exact durations, so on a deployment with the
 * collector wired but no traced application traffic, this is the
 * Slowest-calls answer that actually exists. Rendered under its own heading
 * with its provenance stated — an in-engine duration sitting unlabelled in
 * the client table would read as a traced call that never existed. What
 * appears is governed by the database's own logging threshold, and the copy
 * says so.
 */
const serverRows = ref<ServerSampleRow[]>([]);

/**
 * Fallback mode: the database-reported list is what the reader sees, so the
 * page subtitle must not claim "as their callers measured them" over rows no
 * caller measured — the header follows the table it sits above.
 */
const serverListShown = computed(
  () => !loading.value && !allRows.value.length && serverRows.value.length > 0,
);
const serverTruncated = ref(false);

const { getStreams } = useStreams(t);
/** Whether this org has EVER sent a trace — for the empty state's checklist. */
const { traceCount, probeTracePresence } = useDbmTracePresence(getStreams);

/** Scope carried in from the other tabs, when the user drilled in. */
const systemFilter = ref<string | null>((route.query.system as string) ?? null);
const instanceFilter = ref<string | null>((route.query.instance as string) ?? null);
const namespaceFilter = ref<string | null>((route.query.namespace as string) ?? null);
const envFilter = ref<string | null>((route.query.env as string) ?? null);
const serviceFilter = ref<string | null>((route.query.service as string) ?? null);

/**
 * Filtering is client-side over what was loaded: the endpoint takes no
 * `search` param, so sending one would silently do nothing.
 */
const rows = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return allRows.value;
  return allRows.value.filter((row) =>
    [row.queryText, row.serviceName, row.dbInstance, row.dbNamespace, row.dbSystem]
      .filter((field): field is string => !!field)
      .some((field) => field.toLowerCase().includes(needle)),
  );
});

/** The reader's own filter emptied the table — not the window being quiet. */
const searchHidEverything = computed(
  () => !!search.value.trim() && allRows.value.length > 0 && rows.value.length === 0,
);

const isFiltered = computed(
  () =>
    !!search.value ||
    !!systemFilter.value ||
    !!instanceFilter.value ||
    !!namespaceFilter.value ||
    !!envFilter.value ||
    !!serviceFilter.value,
);

const columns = computed<OTableColumnDef<DbmSampleRow>[]>(() => [
  {
    id: "query",
    accessorKey: "queryText",
    header: t("dbm.samples.columns.query"),
    sortable: false,
  },
  {
    id: "timestamp",
    accessorKey: "timestamp",
    header: t("dbm.samples.columns.when"),
    size: 140,
    sortable: true,
  },
  {
    id: "duration",
    accessorKey: "durationNs",
    header: t("dbm.samples.columns.duration"),
    size: 120,
    sortable: true,
    meta: {
      align: "right",
      headerTooltip: t("dbm.samples.columnHints.duration"),
    },
  },
  {
    id: "service",
    accessorKey: "serviceName",
    header: t("dbm.samples.columns.service"),
    size: 144,
    sortable: true,
  },
  {
    id: "status",
    accessorKey: "isError",
    header: t("dbm.samples.columns.status"),
    size: 120,
    sortable: true,
  },
  { id: "actions", header: raw(""), size: 60, isAction: true },
]);

// ─── The database-reported fallback list ─────────────────────────────────────

const loadServerSamples = async (token: number) => {
  try {
    const { data } = await dbMonitoringService.getServerSamples(org.value, {
      startTime: current.value.startTime,
      endTime: current.value.endTime,
      system: systemFilter.value ?? undefined,
      instance: instanceFilter.value ?? undefined,
      namespace: namespaceFilter.value ?? undefined,
    });
    if (requestSeq.isStale(token)) return;
    serverRows.value = data.hits ?? [];
    serverTruncated.value = Boolean(data.truncated);
  } catch {
    // Supplementary: its absence is not a claim, and the empty state above it
    // already tells the reader whether call data is arriving at all.
    if (requestSeq.isStale(token)) return;
    serverRows.value = [];
    serverTruncated.value = false;
  }
};

/**
 * Two executions can legitimately share a timestamp and a statement, so the
 * row key is positional — the list is a server-ranked snapshot, not an
 * identity-keyed collection.
 */
type ServerSampleTableRow = ServerSampleRow & { rowKey: string };
const serverRowsKeyed = computed<ServerSampleTableRow[]>(() =>
  serverRows.value.map((row, index) => ({ ...row, rowKey: `${row.timestamp}-${index}` })),
);

/** The page's search box narrows this list too — same client-side contract as the main table. */
const filteredServerRows = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return serverRowsKeyed.value;
  return serverRowsKeyed.value.filter((row) =>
    [row.query, row.db_system, row.db_namespace, row.db_instance, row.db_user]
      .filter((field): field is string => !!field)
      .some((field) => field.toLowerCase().includes(needle)),
  );
});

const serverColumns = computed<OTableColumnDef<ServerSampleTableRow>[]>(() => [
  {
    id: "query",
    accessorKey: "query",
    header: t("dbm.samples.serverList.columns.query"),
    sortable: false,
  },
  {
    id: "when",
    accessorKey: "timestamp",
    header: t("dbm.samples.serverList.columns.when"),
    size: 140,
    sortable: true,
  },
  {
    id: "took",
    accessorKey: "duration_ms",
    header: t("dbm.samples.serverList.columns.took"),
    size: 120,
    sortable: true,
    meta: {
      align: "right",
      headerTooltip: t("dbm.samples.serverList.columnHints.took"),
    },
  },
  {
    id: "user",
    accessorKey: "db_user",
    header: t("dbm.samples.serverList.columns.user"),
    size: 120,
    sortable: true,
  },
]);

/**
 * Same destination as a client row: the detail page's server-side sections
 * resolve from these URL params alone, so the drill-down works even when no
 * client row exists anywhere. No stream is sent — a server record cannot
 * know one — and the origin marker brings the reader back here.
 */
const openServerSampleDetail = (row: ServerSampleTableRow) => {
  if (!row.fingerprint || !row.db_system) return;
  // The statement travels as a seed, exactly as the Activity hop does: with
  // no client row anywhere, the detail header would otherwise paint the bare
  // hash. Only fields this row truly knows — no stats, no stream.
  if (row.query) {
    setDbmQueryDetailSeed({
      row: {
        fingerprint: row.fingerprint,
        query_norm: row.query,
        db_system: row.db_system,
        db_instance: row.db_instance ?? "",
        db_namespace: row.db_namespace ?? undefined,
      },
      org: org.value,
      range: { ...range.value },
    });
  }
  router
    .push({
      name: "dbmQueryDetail",
      query: {
        ...route.query,
        org_identifier: route.query.org_identifier ?? org.value,
        ...queryParams.value,
        fingerprint: row.fingerprint,
        system: row.db_system,
        ...(row.db_instance ? { instance: row.db_instance } : {}),
        ...(row.db_namespace ? { namespace: row.db_namespace } : {}),
        from: "samples",
      },
    })
    .catch(() => {});
};

/**
 * When the call ran. Clock-only inside a one-day window; with the date once
 * the window spans days, because "14:02" alone is ambiguous over a week.
 */
const spansDays = computed(() => rangeMinutes.value > 24 * 60);
const formatWhen = (micros: number): string =>
  new Date(Math.floor(micros / 1000)).toLocaleString(
    undefined,
    spansDays.value
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  );

// ─── Scatter ─────────────────────────────────────────────────────────────────

/**
 * Read the registered `--color-*` tokens so the scatter follows the theme.
 * ECharts renders to a canvas with no CSS cascade, so a class cannot reach it.
 * Depends on the theme state so the colours re-resolve on a light/dark flip.
 */
const chartTheme = computed<DbmChartTheme>(() => {
  void store.state.theme;
  return {
    calls: chartColor("--color-chart-series-1"),
    errors: chartColor("--color-severity-error-color"),
    axisLabel: chartColor("--color-text-secondary"),
    splitLine: chartColor("--color-border-default"),
  };
});

/** The rows the scatter can place — a sample without a duration has no y. */
const scatterSamples = computed(() =>
  rows.value
    .filter((row) => row.durationNs !== null)
    .map((row) => ({
      timestamp: row.timestamp,
      durationNs: row.durationNs as number,
      isError: row.isError,
    })),
);

const samplesOption = computed(() =>
  buildSamplesOption(scatterSamples.value, chartTheme.value, formatNs, formatWhen, {
    ok: t("dbm.samples.scatterOk"),
    error: t("dbm.samples.failed"),
  }),
);

/** ECharts hands back the datum; map it to the sample that produced it. */
const onScatterClick = (params: unknown) => {
  const value = (params as { value?: [number, number] })?.value;
  if (!value) return;
  const sample = rows.value.find(
    (row) => row.timestamp === value[0] && row.durationNs === value[1],
  );
  if (sample) openSampleTrace(sample);
};

// ─── Filters ─────────────────────────────────────────────────────────────────

const optionsFrom = (values: (string | undefined)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].map((value) => ({
    value,
    label: raw(value),
  }));

const dimensionFilters = computed<DbmScopeFilter[]>(() => [
  {
    key: "instance",
    dimension: t("dbm.filters.dimension.instance"),
    value: instanceFilter.value,
    placeholder: t("dbm.filters.allInstances"),
    options: optionsFrom(allRows.value.map((r) => r.dbInstance)),
    onChange: (value) => {
      instanceFilter.value = (value as string) || null;
      syncUrl();
      load();
    },
  },
  {
    key: "env",
    dimension: t("dbm.filters.dimension.env"),
    value: envFilter.value,
    placeholder: t("dbm.filters.allEnvs"),
    options: optionsFrom(allRows.value.map((r) => r.env)),
    onChange: (value) => {
      envFilter.value = (value as string) || null;
      syncUrl();
      load();
    },
  },
  {
    key: "system",
    dimension: t("dbm.filters.dimension.system"),
    value: systemFilter.value,
    placeholder: t("dbm.filters.allEngines"),
    options: optionsFrom(allRows.value.map((r) => r.dbSystem)),
    onChange: (value) => {
      systemFilter.value = (value as string) || null;
      syncUrl();
      load();
    },
  },
  {
    key: "service",
    dimension: t("dbm.filters.dimension.service"),
    value: serviceFilter.value,
    placeholder: t("dbm.filters.allServices"),
    options: optionsFrom(allRows.value.map((r) => r.serviceName)),
    onChange: (value) => {
      serviceFilter.value = (value as string) || null;
      syncUrl();
      load();
    },
  },
  {
    key: "namespace",
    dimension: t("dbm.filters.dimension.namespace"),
    value: namespaceFilter.value,
    placeholder: t("dbm.filters.allNamespaces"),
    options: optionsFrom(allRows.value.map((r) => r.dbNamespace)),
    onChange: (value) => {
      namespaceFilter.value = (value as string) || null;
      syncUrl();
      load();
    },
  },
]);

const clearScope = () => {
  systemFilter.value = null;
  instanceFilter.value = null;
  namespaceFilter.value = null;
  envFilter.value = null;
  serviceFilter.value = null;
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
        system: systemFilter.value ?? undefined,
        instance: instanceFilter.value ?? undefined,
        namespace: namespaceFilter.value ?? undefined,
        env: envFilter.value ?? undefined,
        service: serviceFilter.value ?? undefined,
        search: search.value || undefined,
      },
    })
    .catch(() => {});
};

// ─── Count line ──────────────────────────────────────────────────────────────

/**
 * The claim under the table. A truncated answer says "the slowest N of more"
 * — never a bare count that reads as everything. The truncation claim is
 * about the SERVER's read, so it is stated over the unfiltered row count.
 */
const countLine = computed<I18nText>(() => {
  const total = allRows.value.length;
  if (truncated.value) return t("dbm.samples.counts.truncated", { count: total });
  return search.value.trim()
    ? t("dbm.samples.counts.filtered", { count: rows.value.length, total })
    : t("dbm.samples.counts.complete", { count: total });
});

// ─── Pivots ──────────────────────────────────────────────────────────────────

/** The traces route hydrates from `stream`/`filter`/`from`/`to` query params. */
const openSampleTrace = (row: DbmSampleRow) => {
  const filter = sampleTraceFilter(row);
  if (!filter) return;
  router
    .push({
      name: "traces",
      query: {
        org_identifier: route.query.org_identifier ?? org.value,
        stream: row.traceStreamName,
        filter,
        from: String(current.value.startTime),
        to: String(current.value.endTime),
      },
    })
    .catch(() => {});
};

/**
 * A row opens the query it is an execution of. The helper owns the refusal: a
 * row without a fingerprint or a stream has no detail page that would load,
 * and pushing one would open a page keyed on nothing.
 */
const onRowClick = (row: DbmSampleRow) => {
  const target = sampleQueryDetailTarget(row);
  if (!target) return;
  router
    .push({
      name: "dbmQueryDetail",
      query: {
        ...route.query,
        org_identifier: route.query.org_identifier ?? org.value,
        ...queryParams.value,
        ...target,
        // The back affordance and the tab strip both honor the origin — a
        // Slowest-calls reader must not be handed back to Top queries.
        from: "samples",
      },
    })
    .catch(() => {});
};

const onEmptyAction = (cause: DbmEmptyCauseId) => {
  switch (dbmEmptyAction(cause)) {
    case "open-setup":
      router.push({
        name: DBM_SETUP_ROUTE,
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
      return;
    case "clear-filters":
      clearScope();
      return;
    case "reload":
      load();
      return;
    case "none":
  }
};

// ─── Loading ─────────────────────────────────────────────────────────────────

// Named handler, not `@click="load"`: a refresh must ALSO force the shell's
// badge cache alongside the page's own load — the URL does not change on a
// refresh, so the shell cannot see one on its own.
const onRefresh = () => {
  void load();
  tabCountsContext.refresh({ force: true });
};

const onDateChange = (value: DbmDateChange) => {
  setRange(value);
  syncUrl();
  // Fetch only on a genuine pick — `onMounted` already loads, and the picker's
  // mount replay would otherwise double every request. See
  // `DbmDateChange.userChangedValue`.
  if (value?.userChangedValue !== false) load();
};

const load = async () => {
  if (!org.value) return;
  const token = requestSeq.begin();
  loading.value = true;
  error.value = null;
  permissionOk.value = true;
  refresh();

  try {
    const { data } = await dbMonitoringService.getSamples(org.value, {
      startTime: current.value.startTime,
      endTime: current.value.endTime,
      system: systemFilter.value ?? undefined,
      instance: instanceFilter.value ?? undefined,
      namespace: namespaceFilter.value ?? undefined,
      env: envFilter.value ?? undefined,
      service: serviceFilter.value ?? undefined,
    });

    // A newer window or refresh already owns the page.
    if (requestSeq.isStale(token)) return;

    const hits = data.hits ?? [];
    allRows.value = buildSampleRows(hits);
    truncated.value = Boolean(data.truncated);
    streamsFailed.value = data.streams_failed ?? 0;
    // The server list answers ONLY the empty page: populated client rows
    // clear it (in-engine durations under a live client list would read as
    // traced calls that never existed), and the fetch fires only on the
    // empty branch so a page with rows never pays for it. Awaited, so the
    // skeleton covers the read: the empty client answer arrives in
    // milliseconds on an org with no trace streams, and clearing `loading`
    // then would pop the empty state with no visible loading at all, only
    // for the fallback table to appear beneath it half a second later.
    if (hits.length) {
      serverRows.value = [];
      serverTruncated.value = false;
    } else {
      await loadServerSamples(token);
    }
    // Only probed when there is an empty state about to explain itself.
    if (!allRows.value.length) void probeTracePresence();
  } catch (err: unknown) {
    if (requestSeq.isStale(token)) return;
    // The previous window's rows are no longer an answer to the question on
    // screen — leaving them would put stale samples under an error banner.
    allRows.value = [];
    truncated.value = false;
    streamsFailed.value = 0;
    serverRows.value = [];
    serverTruncated.value = false;
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 403) {
      permissionOk.value = false;
    } else {
      error.value =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        String(err);
    }
  } finally {
    if (!requestSeq.isStale(token)) loading.value = false;
  }
};

// Only this page's OWN read. The badges are DbmShell's, fetched once for
// every tab — a call here would put the fan-out back on every mount.
onMounted(() => {
  load();
});

// Kept alive by DbmShell.vue, so `onMounted` above runs once for the whole
// session on this tab. The URL is how the tabs agree on a window, so re-read it
// on return and reload ONLY if it actually moved.
useDbmScopeSync({
  route,
  current: () => range.value,
  adopt: (next) =>
    setRange({
      startTime: next.startTime,
      endTime: next.endTime,
      relativeTimePeriod: next.relativeTimePeriod,
    }),
  reload: () => load(),
});
</script>
