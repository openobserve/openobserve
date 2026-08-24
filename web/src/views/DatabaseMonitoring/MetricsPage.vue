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
  Metrics — the databases' own gauges and counters over the window, plus the
  Datadog-style load-by-wait-event chart.

  Every chart is a SELF-QUERYING dashboard panel: this page calls no
  `db_monitoring` endpoint for chart data. The only fetch it owns is the
  metric-stream LIST — which streams the DB receivers ship — and the panel
  schemas built from it (utils/dbm/metricsPanels) each fire their own query
  through the shared dashboards engine. That is what makes a new receiver
  metric appear here without a code change, and what keeps "all metrics" honest:
  the grid is enumerated from the org's streams, not a hardcoded chart list.

  The load chart reads the server-vantage activity samples instead — sampled
  sessions stacked by wait event, NULL-on-active named CPU — so it renders even
  on a fleet whose receivers ship no metrics at all. The two failure modes are
  therefore separated: an empty grid indicts the metric receivers, never the
  activity feed, and vice versa.
-->
<template>
  <DbmPageChrome
    :title="t('dbm.metrics.title')"
    :subtitle="t('dbm.metrics.subtitle')"
    title-data-test="dbm-metrics-title"
    date-time-data-test="dbm-metrics-date-time"
    :tab-counts="tabCounts"
    :range="range"
    @date-change="onDateChange"
  >
    <div class="min-h-0 flex-1 overflow-y-auto" data-test="dbm-metrics-body">
      <OContent class="flex flex-col gap-2.5 py-2.5">
        <div class="flex flex-wrap items-center gap-2">
          <DbmScopeFilters class="min-w-0 flex-1" :filters="dimensionFilters" @clear="clearScope" />
          <DbmRefreshButton
            :loading="loading"
            shrink
            :last-run-at="lastRunAt"
            data-test="dbm-metrics-refresh"
            @refresh="onRefresh"
          />
        </div>

        <DbmSection :title="t('dbm.metrics.load.title')" header-align="center">
          <template #hint>
            <!-- Reads as part of the heading — "Database load · By user ▾" —
                 the way the folder picker reads inside a page description. -->
            <OSelect
              v-model="loadBreakdown"
              :options="breakdownOptions"
              size="sm"
              appearance="inline"
              :searchable="false"
              class="shrink-0"
              data-test="dbm-metrics-load-breakdown"
            />
            <span class="text-text-secondary min-w-0 truncate text-xs">{{
              t("dbm.metrics.load.hint")
            }}</span>
          </template>
          <template #actions>
            <OButton
              variant="outline"
              size="sm"
              icon-right="arrow-forward"
              data-test="dbm-metrics-view-activity"
              @click="openActivity"
            >
              {{ t("dbm.metrics.load.viewActivity") }}
            </OButton>
          </template>
          <div class="h-64 w-full px-3 pb-3" data-test="dbm-metrics-load-chart">
            <PanelSchemaRenderer
              class="h-full w-full"
              :panel-schema="loadPanelSchema"
              :selected-time-obj="selectedTimeObj"
              :variables-data="{}"
              search-type="ui"
              :allow-annotations-add="false"
              :allow-annotations-a-p-i="false"
              :key="`load::${chartEpoch}::${loadBreakdown}`"
              @updated:data-zoom="onChartZoom"
            />
          </div>
        </DbmSection>

        <!-- The themed catalog. Rendered OUTSIDE the metric-stream branch:
             Activity's rollup and Blocks' server counters read DBM streams,
             so they answer even on an org whose receivers ship no metrics. -->
        <DbmSection
          v-for="section in catalogSections"
          :key="`catalog-${section.key}`"
          :title="t(`dbm.metrics.catalog.${section.key}.title`)"
          header-align="baseline"
        >
          <template #hint>
            <span class="text-text-secondary text-xs">{{
              t(`dbm.metrics.catalog.${section.key}.desc`)
            }}</span>
          </template>
          <div class="grid gap-2.5 p-3 pt-1 md:grid-cols-2 xl:grid-cols-3">
            <DbmMetricPanel
              v-for="p in catalogPanelsBySection[section.key] ?? []"
              :key="`${section.key}:${p.entry.key}::${chartEpoch}::${p.by}`"
              :panel-key="`${section.key}-${p.entry.key}`"
              :title="p.entry.title"
              :help="p.entry.help"
              :schema="p.entry.schema"
              :identifier="false"
              :start-time="current.startTime"
              :end-time="current.endTime"
              :by-options="p.byOptions"
              :by="p.by"
              :explore-url="p.exploreUrl"
              @update:by="catalogBy[p.entry.key] = $event"
              @zoom="onChartZoom"
            />
          </div>
        </DbmSection>

        <template v-if="loading && !hasMetricStreams">
          <div class="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" data-test="dbm-metrics-skeleton">
            <OSkeleton v-for="n in 6" :key="n" type="rect" class="rounded-surface h-55 w-full" />
          </div>
        </template>

        <!-- A failed stream LIST is not an empty org: without this branch the
             error fell through to the not-collecting state below, blaming the
             receivers for a fetch that never landed. -->
        <OEmptyState
          v-else-if="error"
          preset="load-error"
          data-test="dbm-metrics-load-error"
          @action="onRefresh"
        />

        <!-- The grid's emptiness indicts the METRIC receivers specifically:
             the load chart above still answers from the activity feed, so this
             state must not claim the whole pipeline is down. -->
        <DbmLockEmptyState
          v-else-if="!hasMetricStreams"
          :healthy="false"
          :title="t('dbm.metrics.notCollecting.title')"
          :description="t('dbm.metrics.notCollecting.description')"
          :checklist-title="t('dbm.metrics.notCollecting.checklistTitle')"
          :checks="notCollectingChecks"
          size="block"
          data-test="dbm-metrics-not-collecting"
        />

        <template v-else>
          <DbmSection
            v-if="sections.featured.length"
            :title="t('dbm.metrics.sections.featured')"
            header-align="baseline"
          >
            <!-- auto-fit: one panel owns the whole line, several wrap into
                 columns — a fixed column count strands a lone card beside a
                 row of empty space. -->
            <div class="grid grid-cols-[repeat(auto-fit,minmax(22rem,1fr))] gap-2.5 p-3 pt-1">
              <DbmMetricPanel
                v-for="entry in sections.featured"
                :key="`${entry.key}::${chartEpoch}`"
                :panel-key="entry.key"
                :title="entry.title"
                :help="entry.help"
                :schema="entry.schema"
                :start-time="current.startTime"
                :end-time="current.endTime"
                @zoom="onChartZoom"
              />
            </div>
          </DbmSection>

          <div v-if="sections.groups.length" class="flex items-center justify-end">
            <OInput
              v-model="panelSearch"
              size="sm"
              icon-left="search"
              :placeholder="t('dbm.metrics.searchPlaceholder')"
              class="w-60"
              data-test="dbm-metrics-panel-search"
            />
          </div>

          <DbmSection
            v-for="group in filteredGroups"
            :key="group.system"
            :title="groupTitle(group.system)"
            header-align="baseline"
          >
            <template #hint>
              <span class="text-text-label text-2xs">{{ t("dbm.metrics.triageOrder") }}</span>
            </template>
            <div class="grid grid-cols-[repeat(auto-fit,minmax(22rem,1fr))] gap-2.5 p-3 pt-1">
              <DbmMetricPanel
                v-for="entry in group.panels"
                :key="`${entry.key}::${chartEpoch}`"
                :panel-key="entry.key"
                :title="entry.title"
                :help="entry.help"
                :schema="entry.schema"
                :start-time="current.startTime"
                :end-time="current.endTime"
                @zoom="onChartZoom"
              />
            </div>
          </DbmSection>
        </template>
      </OContent>
    </div>
  </DbmPageChrome>
</template>

<script setup lang="ts">
// Explicit name so <keep-alive :include> in DbmShell.vue matches this view.
defineOptions({ name: "DbmMetricsPage" });

import { computed, defineAsyncComponent, ref, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";

import DbmLockEmptyState, { type DbmLockCheck } from "@/components/dbm/DbmLockEmptyState.vue";
import DbmMetricPanel from "@/components/dbm/DbmMetricPanel.vue";
import DbmPageChrome from "@/components/dbm/DbmPageChrome.vue";
import DbmRefreshButton from "@/components/dbm/DbmRefreshButton.vue";
import DbmScopeFilters from "@/components/dbm/DbmScopeFilters.vue";
import DbmSection from "@/components/dbm/DbmSection.vue";
import { tabCountProps } from "@/composables/dbm/useDbmTabCounts";
import { useDbmListPage } from "@/composables/dbm/useDbmListPage";
import { useDbmScopeFilters } from "@/composables/dbm/useDbmScopeFilters";
import useStreams from "@/composables/useStreams";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  availableDbmSections,
  buildDbmSectionPanel,
  catalogConsumedStreams,
  type DbmSectionDef,
  type DbmSectionPanelDef,
} from "@/utils/dbm/metricSections";
import {
  buildDbmLoadPanelSchema,
  buildDbmMetricsSections,
  DBM_LOAD_BREAKDOWNS,
  filterDbmMetricPanels,
  filterDbmMetricStreams,
  type DbmLoadBreakdown,
  type DbmMetricsScope,
} from "@/utils/dbm/metricsPanels";
import { buildMetricsUrl } from "@/utils/metrics/buildMetricsUrl";
import type { MetricStream } from "@/utils/metrics/metricFamily";

const PanelSchemaRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/PanelSchemaRenderer.vue"),
);

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const { getStreams } = useStreams(t);

const {
  scope: { range, current, queryParams },
  requestSeq,
  tabCountsContext,
  loading,
  error,
  lastRunAt,
  org,
  dbmEnabled,
  run,
  onRefresh,
  onDateChange,
} = useDbmListPage({
  load: () => load(),
  syncUrl: () => syncUrl(),
});

const streams = shallowRef<MetricStream[]>([]);

const tabCounts = computed(() => tabCountProps(tabCountsContext.counts.value));

const {
  filters: dimensionFilters,
  requestParams: scopeParams,
  queryParams: scopeQuery,
  clear: clearScopeModels,
} = useDbmScopeFilters({
  query: route.query,
  liveQuery: () => route.query,
  // The panels re-key on the scope, so adopting a sibling tab's scope needs no
  // reload — only the stream list is fetched here, and scope never narrows it
  // by less than the engine, which the sections computed re-derives.
  onScopeAdopted: () => {},
  fleetWindow: () => ({
    org: org.value,
    startTime: current.value.startTime,
    endTime: current.value.endTime,
  }),
  // The stream list carries engines but no per-dimension values worth offering;
  // instance/system come from the fleet read, namespace stays free-text-less.
  options: () => ({ system: [], instance: [], namespace: [] }),
  apply: () => {
    syncUrl();
  },
});

const scope = computed<DbmMetricsScope>(() => ({
  system: scopeParams.value.system ?? null,
  instance: scopeParams.value.instance ?? null,
  namespace: scopeParams.value.namespace ?? null,
}));

/** DB metric streams within the engine scope — what the catalog checks against. */
const metricStreamNames = computed(
  () => new Set(filterDbmMetricStreams(streams.value, scope.value.system).map((s) => s.name)),
);

const catalogSections = computed<DbmSectionDef[]>(() =>
  availableDbmSections(metricStreamNames.value),
);

/** Per-panel slicer state; a panel absent here sits on its default dimension. */
const catalogBy = ref<Record<string, string>>({});

interface CatalogPanelVm {
  entry: ReturnType<typeof buildDbmSectionPanel>;
  by: string;
  byOptions: SelectOption[];
  exploreUrl?: string;
}

const catalogPanelsBySection = computed<Record<string, CatalogPanelVm[]>>(() =>
  Object.fromEntries(
    catalogSections.value.map((section) => [
      section.key,
      section.panels.map((def: DbmSectionPanelDef) => {
        const by = catalogBy.value[def.key] ?? def.byDims[0];
        const entry = buildDbmSectionPanel(def, by, scope.value, t);
        return {
          entry,
          by,
          byOptions: def.byDims.map((d) => ({
            label: t(`dbm.metrics.byDims.${d}`),
            value: d,
          })),
          exploreUrl: entry.explore
            ? buildMetricsUrl({
                orgId: org.value,
                queries: [entry.explore],
                queryType: "promql",
                time: { from: current.value.startTime, to: current.value.endTime },
              }).toString()
            : undefined,
        };
      }),
    ]),
  ),
);

const sections = computed(() =>
  buildDbmMetricsSections(streams.value, scope.value, t, {
    // The remainder grid never repeats what a catalog section already charts.
    excludeStreams: catalogConsumedStreams(metricStreamNames.value),
  }),
);

const hasMetricStreams = computed(
  () => sections.value.featured.length > 0 || sections.value.groups.length > 0,
);

/** Which dimension the load chart stacks by — the Datadog-style slicer. */
const loadBreakdown = ref<DbmLoadBreakdown>("waitEvent");

const breakdownOptions = computed<SelectOption[]>(() =>
  DBM_LOAD_BREAKDOWNS.map((dim) => ({
    label: t(`dbm.metrics.load.breakdowns.${dim}`),
    value: dim,
  })),
);

/** The long-tail filter needle; matches titles, metric ids and exporter help. */
const panelSearch = ref("");

const filteredGroups = computed(() =>
  sections.value.groups
    .map((group) => ({ ...group, panels: filterDbmMetricPanels(group.panels, panelSearch.value) }))
    .filter((group) => group.panels.length > 0),
);

const loadPanelSchema = computed(() =>
  buildDbmLoadPanelSchema(
    scope.value,
    {
      time: t("dbm.metrics.load.timeAxis"),
      sessions: t("dbm.metrics.load.sessionsAxis"),
      segment: t(`dbm.metrics.load.breakdowns.${loadBreakdown.value}`),
    },
    loadBreakdown.value,
  ),
);

/**
 * Drag-selecting a spike narrows the SHARED window every DBM tab reads — the
 * same gesture dashboards support, wired to the same handler a date pick uses.
 * The engine emits milliseconds; the scope stores microseconds.
 */
const onChartZoom = (event: { start?: number; end?: number }) => {
  const start = Number(event?.start);
  const end = Number(event?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  onDateChange({
    startTime: Math.round(start * 1000),
    endTime: Math.round(end * 1000),
    valueType: "absolute",
    userChangedValue: true,
  });
};

/** The correlation hop: Activity on the SAME window and scope, one click. */
const openActivity = () => {
  router
    .push({
      name: "dbmActivity",
      query: { ...route.query, ...queryParams.value, ...scopeQuery.value },
    })
    .catch(() => {});
};

/**
 * Remount key for every chart. The dashboards engine fetches on mount, so a
 * new window, scope or refresh must produce a NEW key — same technique as LLM
 * Insights. `lastRunAt` folds the refresh button in: a relative window's
 * bounds move on refresh anyway, but an absolute one's do not.
 */
const chartEpoch = computed(() =>
  [
    current.value.startTime,
    current.value.endTime,
    scope.value.system ?? "",
    scope.value.instance ?? "",
    scope.value.namespace ?? "",
    lastRunAt.value ?? 0,
  ].join(":"),
);

const selectedTimeObj = computed(() => ({
  // `new Date(microseconds)` on purpose — the dashboards pipeline round-trips
  // the µs count through .getTime(). See DbmMetricPanel.
  start_time: new Date(current.value.startTime),
  end_time: new Date(current.value.endTime),
}));

const groupTitle = (system: string): I18nText => {
  if (system === "postgresql") return t("dbm.metrics.sections.postgresql");
  if (system === "mysql") return t("dbm.metrics.sections.mysql");
  return raw(system);
};

const notCollectingChecks = computed<DbmLockCheck[]>(() => [
  {
    id: "receivers",
    status: "fail",
    title: t("dbm.metrics.notCollecting.checks.receivers.no"),
    detail: t("dbm.metrics.notCollecting.checks.receivers.noDetail"),
  },
  {
    id: "enabled",
    status: dbmEnabled.value ? "ok" : "fail",
    title: dbmEnabled.value
      ? t("dbm.metrics.notCollecting.checks.enabled.ok")
      : t("dbm.metrics.notCollecting.checks.enabled.no"),
    detail: dbmEnabled.value
      ? t("dbm.metrics.notCollecting.checks.enabled.okDetail")
      : t("dbm.metrics.notCollecting.checks.enabled.noDetail"),
  },
]);

const clearScope = () => {
  clearScopeModels();
  syncUrl();
};

const syncUrl = () => {
  router
    .replace({
      name: route.name as string,
      query: { ...route.query, ...queryParams.value, ...scopeQuery.value },
    })
    .catch(() => {});
};

const load = () =>
  run(
    async (token) => {
      const response = (await getStreams("metrics", false, false)) as {
        list?: MetricStream[];
      };
      if (requestSeq.isStale(token)) return;
      streams.value = response?.list ?? [];
    },
    {
      reset: () => {
        streams.value = [];
      },
    },
  );
</script>
