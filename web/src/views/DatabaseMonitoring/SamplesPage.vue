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
  <DbmPageChrome
    :title="t('dbm.samples.title')"
    :subtitle="t(serverListShown ? 'dbm.samples.subtitleServer' : 'dbm.samples.subtitle')"
    title-data-test="dbm-samples-title"
    date-time-data-test="dbm-samples-date-time"
    :tab-counts="tabCounts"
    :range="range"
    @date-change="onDateChange"
  >
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
          <DbmTableToolbar
            v-model:search="search"
            :placeholder="t('dbm.samples.searchPlaceholder')"
            :debounce="400"
            search-data-test="dbm-samples-search"
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
            data-test="dbm-samples-refresh"
            @refresh="onRefresh"
          />
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
            <ChartRenderer :data="scatterData" @click="onScatterClick" />
          </div>
        </template>

        <!-- The statement, with where it ran under it. -->
        <template #cell-query="{ row }">
          <DbmQueryCell
            :text="raw(row.queryText)"
            :title-attr="row.queryText"
            :db-system="row.dbSystem"
            :meta-items="[
              { key: 'instance', label: raw(row.dbInstance ?? '') },
              { key: 'namespace', label: raw(row.dbNamespace ?? '') },
            ]"
          />
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
            <DbmTableToolbar
              v-model:search="search"
              :placeholder="t('dbm.samples.searchPlaceholder')"
              :debounce="400"
              search-data-test="dbm-server-samples-search"
            />
          </template>
          <template #toolbar-trailing>
            <DbmRefreshButton
              :loading="loading"
              data-test="dbm-server-samples-refresh"
              @refresh="onRefresh"
            />
          </template>
          <template #cell-query="{ row }">
            <DbmQueryCell
              :text="raw(row.query ?? '')"
              :title-attr="row.query ?? undefined"
              :db-system="row.db_system"
              :meta-items="[
                { key: 'instance', label: raw(row.db_instance ?? '') },
                { key: 'namespace', label: raw(row.db_namespace ?? '') },
              ]"
            />
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
  </DbmPageChrome>
</template>

<script setup lang="ts">
// Explicit name so <keep-alive :include> in DbmShell.vue matches this view.
// Without it the name is inferred from the FILENAME, so a rename would
// silently drop the page from the cache and bring back the refetch-on-return.
defineOptions({ name: "DbmSamplesPage" });

import { computed, defineAsyncComponent, ref, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import DbmEmptyState, { type DbmEmptyCauseId } from "@/components/dbm/DbmEmptyState.vue";
import DbmPageChrome from "@/components/dbm/DbmPageChrome.vue";
import DbmQueryCell from "@/components/dbm/DbmQueryCell.vue";
import DbmRefreshButton from "@/components/dbm/DbmRefreshButton.vue";
import DbmScopeFilters, { type DbmScopeFilter } from "@/components/dbm/DbmScopeFilters.vue";
import DbmTableToolbar from "@/components/dbm/DbmTableToolbar.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import dbMonitoringService, { type ServerSampleRow } from "@/services/db_monitoring";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useDbmTracePresence } from "@/composables/dbm/useDbmTracePresence";
import useStreams from "@/composables/useStreams";
import { useDbmQueryDetailHop } from "@/composables/dbm/useDbmQueryDetailHop";
import { tabCountProps, withOwnCount } from "@/composables/dbm/useDbmTabCounts";
import { useDbmListPage } from "@/composables/dbm/useDbmListPage";
import { useDbmChartTheme } from "@/composables/dbm/useDbmChartTheme";
import { useDbmSearchEmpty } from "@/composables/dbm/useDbmSearchEmpty";
import { dbmEmptyAction, DBM_SETUP_ROUTE } from "@/utils/dbm/emptyAction";
import { createDbmFilterEntry, optionsFrom } from "@/utils/dbm/filters";
import { countClaim, formatNs } from "@/utils/dbm/format";
import { buildSamplesOption } from "@/utils/dbm/historyChart";
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

// The shared list-page spine: scope from the URL, the request-sequence guard,
// the shell's badge snapshot, refresh/date-change handlers and the load
// envelope. This page's own `syncUrl` rides the date change so the five
// filters survive in the URL. See useDbmListPage.
const {
  scope: { range, current, rangeMinutes, queryParams },
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
} = useDbmListPage({ load: () => load(), syncUrl: () => syncUrl() });

// The page's own client rows never override the badge — they are a capped
// top-list, not the population (see `sampleCallsCount` in useDbmTabCounts.ts).
// The ONE override is fallback mode: with zero client rows and a
// database-reported list rendered beneath the badge, the shared `0` would
// deny working data — so the badge counts the reported list as a capped claim
// (`100+`), the same false-zero rule the fleet badge follows.
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

const allRows = shallowRef<DbmSampleRow[]>([]);
const truncated = ref(false);
const streamsFailed = ref(0);
const permissionOk = ref(true);

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
const serverRows = shallowRef<ServerSampleRow[]>([]);

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
// The list→detail hop: the seed hand-off plus the push, in one place. See
// useDbmQueryDetailHop.
const { openDbmQueryDetail } = useDbmQueryDetailHop({ router, route, org, range, queryParams });

/** The reader's own filter emptied the table — not the window being quiet. */
const searchHidEverything = useDbmSearchEmpty(search, allRows, rows);

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

// `loadServerSamples` lived here — a second, sequential request to
// `/server_samples` issued once this page's own read came back empty. The
// server runs that conditional itself now (`include_server_fallback`), so the
// rows arrive with the response that decides they are needed, and a failed or
// denied fallback is a flag on that response rather than a swallowed catch.

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
  openDbmQueryDetail({
    seed: row.query
      ? {
          fingerprint: row.fingerprint,
          query_norm: row.query,
          db_system: row.db_system,
          db_instance: row.db_instance ?? "",
          db_namespace: row.db_namespace ?? undefined,
        }
      : null,
    target: {
      fingerprint: row.fingerprint,
      system: row.db_system,
      ...(row.db_instance ? { instance: row.db_instance } : {}),
      ...(row.db_namespace ? { namespace: row.db_namespace } : {}),
    },
    from: "samples",
  });
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
const chartTheme = useDbmChartTheme();

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

const scatterData = computed(() => ({ options: samplesOption.value }));

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

// Every filter change publishes the scope to the URL BEFORE reloading — the
// factory owns the handler, so no entry can forget the URL half.
const filterEntry = createDbmFilterEntry(() => {
  syncUrl();
  load();
});

const dimensionFilters = computed<DbmScopeFilter[]>(() => [
  filterEntry({
    key: "instance",
    dimension: t("dbm.filters.dimension.instance"),
    placeholder: t("dbm.filters.allInstances"),
    options: optionsFrom(allRows.value.map((r) => r.dbInstance)),
    model: instanceFilter,
  }),
  filterEntry({
    key: "env",
    dimension: t("dbm.filters.dimension.env"),
    placeholder: t("dbm.filters.allEnvs"),
    options: optionsFrom(allRows.value.map((r) => r.env)),
    model: envFilter,
  }),
  filterEntry({
    key: "system",
    dimension: t("dbm.filters.dimension.system"),
    placeholder: t("dbm.filters.allEngines"),
    options: optionsFrom(allRows.value.map((r) => r.dbSystem)),
    model: systemFilter,
  }),
  filterEntry({
    key: "service",
    dimension: t("dbm.filters.dimension.service"),
    placeholder: t("dbm.filters.allServices"),
    options: optionsFrom(allRows.value.map((r) => r.serviceName)),
    model: serviceFilter,
  }),
  filterEntry({
    key: "namespace",
    dimension: t("dbm.filters.dimension.namespace"),
    placeholder: t("dbm.filters.allNamespaces"),
    options: optionsFrom(allRows.value.map((r) => r.dbNamespace)),
    model: namespaceFilter,
  }),
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

const load = () =>
  run(
    async (token) => {
      const { data } = await dbMonitoringService.getSamples(org.value, {
        startTime: current.value.startTime,
        endTime: current.value.endTime,
        system: systemFilter.value ?? undefined,
        instance: instanceFilter.value ?? undefined,
        namespace: namespaceFilter.value ?? undefined,
        env: envFilter.value ?? undefined,
        service: serviceFilter.value ?? undefined,
        // The database-reported fallback rides THIS response when the client
        // answer is an exact zero — it used to be a second, sequential request
        // fired once this one came back empty, which is two round trips on the
        // deployment where it always fires.
        includeServerFallback: true,
      });

      // A newer window or refresh already owns the page.
      if (requestSeq.isStale(token)) return;

      const hits = data.hits ?? [];
      allRows.value = buildSampleRows(hits);
      truncated.value = Boolean(data.truncated);
      streamsFailed.value = data.streams_failed ?? 0;
      // The server list answers ONLY the empty page: populated client rows
      // clear it, since in-engine durations under a live client list would
      // read as traced calls that never existed.
      //
      // It arrives WITH this response now, so the skeleton covers it for free
      // — there is no second read for the spinner to race. That timing used to
      // be delicate: the empty client answer lands in milliseconds on an org
      // with no trace streams, so clearing `loading` before the fallback
      // returned popped the empty state with no visible loading at all.
      //
      // The server also refuses to fall back on a PARTIAL answer: an empty
      // list with a failed stream read is unknown, not zero, and the page's
      // own `streams_failed` disclosure is what the reader should see there.
      if (hits.length) {
        serverRows.value = [];
        serverTruncated.value = false;
      } else {
        const fallback = data.server_fallback;
        serverRows.value = (fallback?.hits ?? []) as ServerSampleRow[];
        serverTruncated.value = Boolean(fallback?.truncated);
      }
      // Only probed when there is an empty state about to explain itself.
      if (!allRows.value.length) void probeTracePresence();
    },
    {
      // A fresh load withdraws the previous permission diagnosis until the
      // response says otherwise.
      before: () => {
        permissionOk.value = true;
      },
      reset: () => {
        allRows.value = [];
        truncated.value = false;
        streamsFailed.value = 0;
        serverRows.value = [];
        serverTruncated.value = false;
      },
      // 403 is a diagnosis the empty state names, not an error banner.
      onForbidden: () => {
        permissionOk.value = false;
      },
    },
  );
</script>
