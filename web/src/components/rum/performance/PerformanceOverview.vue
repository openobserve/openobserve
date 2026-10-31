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

<template>
  <OContent
    y
    class="flex flex-col gap-4"
    :aria-label="t('rum.overviewPage.regionLabel')"
    role="region"
    data-test="rum-overview"
  >
    <div
      v-if="visibleFilters.length"
      class="flex flex-wrap items-center gap-2"
      data-test="rum-overview-filters"
    >
      <OSelect
        v-for="f in visibleFilters"
        :key="f.key"
        :model-value="filters[f.key]"
        :options="filterOptions[f.key]"
        multiple
        searchable
        size="sm"
        width="md"
        label-position="inside"
        :label="t(f.label)"
        :placeholder="t('rum.overviewPage.filterAll')"
        :data-test="`rum-overview-filter-${f.key}`"
        @update:model-value="setFilter(f.key, $event)"
      />
    </div>

    <div v-if="pageState === 'error'" role="alert" data-test="rum-overview-page-error">
      <OEmptyState size="compact" preset="load-error">
        <template #title>{{ t("rum.overviewPage.pageErrorTitle") }}</template>
        <template #description>{{ t("rum.overviewPage.pageErrorBody") }}</template>
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            icon-left="refresh"
            data-test="rum-overview-page-retry"
            @click="loadAll"
          >
            {{ t("rum.overviewPage.retry") }}
          </OButton>
        </template>
      </OEmptyState>
    </div>

    <OEmptyState
      v-else-if="pageState === 'forbidden'"
      size="compact"
      preset="no-access"
      data-test="rum-overview-page-forbidden"
    >
      <template #title>{{ t("rum.overviewPage.pageForbiddenTitle") }}</template>
      <template #description>{{ t("rum.overviewPage.forbiddenBody") }}</template>
    </OEmptyState>

    <OEmptyState
      v-else-if="pageState === 'empty'"
      size="compact"
      data-test="rum-overview-page-empty"
    >
      <template #title>{{ t("rum.overviewPage.stateEmptyTitle") }}</template>
      <template #description>
        {{
          filtersActive
            ? t("rum.overviewPage.stateEmptyFiltered")
            : t("rum.overviewPage.stateEmptyQuiet")
        }}
      </template>
      <template #actions>
        <OButton
          v-if="filtersActive"
          variant="primary"
          size="sm"
          data-test="rum-overview-page-clear-filters"
          @click="clearFilters"
        >
          {{ t("rum.overviewPage.clearFilters") }}
        </OButton>
        <OButton
          :variant="filtersActive ? 'ghost' : 'outline'"
          size="sm"
          data-test="rum-overview-page-setup"
          @click="openSetup"
        >
          {{ t("rum.overviewPage.stateEmptyAction") }}
        </OButton>
      </template>
    </OEmptyState>

    <div v-else class="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div class="flex min-w-0 flex-col gap-4">
        <OverviewPanelState
          :status="status.verdict"
          :busy="busy.verdict"
          :panel-label="t('rum.overviewPage.panelVitals')"
          :low-count="vitals?.views ?? 0"
          data-test="rum-overview-verdict"
          @retry="retry('verdict')"
        >
          <VerdictCard
            v-if="vitals"
            v-model:percentile="percentile"
            :vitals="vitals"
            :prev="prevUsable ? vitalsPrev : null"
            :sessions="status.kpis === 'ok' ? (totals.cur?.sessions ?? null) : null"
            :hide-verdict="status.verdict === 'low'"
            :sessions-link="sessionsLink"
          />
        </OverviewPanelState>

        <OverviewPanelState
          :status="status.kpis"
          :busy="busy.kpis"
          :panel-label="t('rum.overviewPage.panelKpis')"
          :empty-title="t('rum.overviewPage.kpiEmptyTitle')"
          :empty-body="t('rum.overviewPage.kpiEmptyBody')"
          data-test="rum-overview-kpis"
          @retry="retry('kpis')"
        >
          <ul
            class="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 2xl:grid-cols-4"
            :aria-label="t('rum.overviewPage.kpiRegion')"
          >
            <li v-for="k in kpis" :key="k.key">
              <KpiTile v-bind="k" />
            </li>
          </ul>
        </OverviewPanelState>

        <OverviewPanelState
          v-if="chartQuery && chartInterval && range"
          :status="status.chart"
          :busy="busy.chart"
          :panel-label="t('rum.overviewPage.chartTitle')"
          :empty-title="t('rum.overviewPage.kpiEmptyTitle')"
          :empty-body="t('rum.overviewPage.kpiEmptyBody')"
          data-test="rum-overview-chart"
          @retry="retry('chart')"
        >
          <SessionsErrorsChart
            :sql="chartQuery"
            :interval="chartInterval"
            :range="range"
            :points="series"
            :hits="chartHits"
            :marker="releaseMarker"
          />
        </OverviewPanelState>

        <div ref="pagesEl">
          <OverviewPanelState
            :status="status.pages"
            :busy="busy.pages"
            :panel-label="t('rum.overviewPage.panelPages')"
            :empty-title="t('rum.overviewPage.pagesEmptyTitle')"
            :empty-body="t('rum.overviewPage.pagesEmptyBody', { n: MIN_VIEWS })"
            data-test="rum-overview-pages"
            @retry="retry('pages')"
          >
            <PagesToFix
              :pages="pages"
              :sessions-link="sessionsLink"
              :errors-link="errorsLink"
              :all-pages-link="allPagesLink"
              :schema="schema ?? new Set()"
            />
          </OverviewPanelState>
        </div>
      </div>

      <aside class="flex min-w-0 flex-col gap-4" :aria-label="t('rum.overviewPage.asideLabel')">
        <OverviewPanelState
          :status="status.segments"
          :busy="busy.segments"
          :panel-label="t('rum.overviewPage.panelSegments')"
          :empty-title="t('rum.overviewPage.segEmptyTitle')"
          :empty-body="t('rum.overviewPage.segEmptyBody')"
          data-test="rum-overview-segments"
          @retry="retry('segments')"
        >
          <SegmentPanel
            :segments="segments"
            :difference="difference"
            :sessions-link="sessionsLink"
          />
        </OverviewPanelState>

        <OverviewPanelState
          :status="status.release"
          :busy="busy.release"
          :panel-label="t('rum.overviewPage.panelRelease')"
          :empty-title="t('rum.overviewPage.releaseEmptyTitle')"
          :empty-body="t('rum.overviewPage.releaseEmptyBody')"
          data-test="rum-overview-release"
          @retry="retry('release')"
        >
          <ReleaseComparison v-if="release" :release="release" :errors-link="errorsLink" />
        </OverviewPanelState>

        <OverviewPanelState
          :status="status.frustration"
          :busy="busy.frustration"
          :panel-label="t('rum.overviewPage.panelFrustration')"
          data-test="rum-overview-frustration"
          @retry="retry('frustration')"
        >
          <FrustrationPanel
            :cur="frustration.cur"
            :prev="prevUsable ? frustration.prev : null"
            :sessions-link="sessionsLink"
            :replays-link="drill('Sessions', '', { health: 'frustrated' })"
          />
        </OverviewPanelState>
      </aside>
    </div>
  </OContent>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import type { RouteLocationRaw } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import FrustrationPanel from "@/components/rum/performance/overview/FrustrationPanel.vue";
import KpiTile from "@/components/rum/performance/overview/KpiTile.vue";
import OverviewPanelState from "@/components/rum/performance/overview/OverviewPanelState.vue";
import PagesToFix from "@/components/rum/performance/overview/PagesToFix.vue";
import ReleaseComparison from "@/components/rum/performance/overview/ReleaseComparison.vue";
import SegmentPanel from "@/components/rum/performance/overview/SegmentPanel.vue";
import SessionsErrorsChart from "@/components/rum/performance/overview/SessionsErrorsChart.vue";
import VerdictCard from "@/components/rum/performance/overview/VerdictCard.vue";
import useRumOverviewData from "@/composables/rum/useRumOverviewData";
import type { RumTabDateTime } from "@/composables/rum/useRumPerformanceTab";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import { b64EncodeUnicode } from "@/utils/zincutils";
import {
  MIN_VIEWS,
  analyticsQuery,
  drillQuery,
  formatCount,
  formatPercent,
  kpiDelta,
  previousUsable,
  queryFromState,
  scopeWhere,
  sparkValues,
  stateFromQuery,
  withoutOverviewState,
  type OverviewFilters,
  type Percentile,
  type PickerRange,
} from "@/utils/rum/performanceOverview";

const props = defineProps<{
  dateTime?: RumTabDateTime;
  schema: Set<string> | null;
  selectedDate?: PickerRange | null;
}>();
const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

const FILTERS: { key: keyof OverviewFilters; label: I18nKey }[] = [
  { key: "service", label: "rum.overviewPage.filterService" },
  { key: "env", label: "rum.overviewPage.filterEnv" },
  { key: "version", label: "rum.overviewPage.filterVersion" },
];

const {
  pageState,
  chartInterval,
  chartQuery,
  filters,
  filterOptions,
  range,
  status,
  vitals,
  vitalsPrev,
  totals,
  series,
  pages,
  segments,
  difference,
  release,
  releaseMarker,
  frustration,
  chartHits,
  busy,
  loadAll,
  retry,
  markPagesVisible,
  abortAll,
} = useRumOverviewData(toRef(props, "dateTime"), toRef(props, "schema"));

const restored = stateFromQuery(route.query);
filters.value = restored.filters;
const percentile = ref<Percentile>(restored.percentile);

// A filter on a column the stream lacks would only select nothing.
const visibleFilters = computed(() => FILTERS.filter((f) => props.schema?.has(f.key)));

const setFilter = (key: keyof OverviewFilters, value: unknown) => {
  filters.value = { ...filters.value, [key]: Array.isArray(value) ? value.map(String) : [] };
};

// Primitive keys, so a new object with the same range, schema or filters does not rerun the queries.
const rangeKey = () =>
  `${(props.dateTime?.start_time as Date | undefined)?.getTime?.()}-${(props.dateTime?.end_time as Date | undefined)?.getTime?.()}`;
const schemaKey = () => [...(props.schema ?? [])].sort().join(",");

// The picker hands over a new object on every Refresh, even when the absolute range is unchanged.
watch(
  [rangeKey, schemaKey, () => JSON.stringify(filters.value), () => props.dateTime],
  () => {
    loadAll();
  },
  { immediate: true },
);

// Filters and percentile live in the URL so Share, reload and deep links restore them.
watch([() => JSON.stringify(filters.value), percentile], () => {
  router.replace({
    query: {
      ...withoutOverviewState(route.query),
      ...queryFromState(filters.value, percentile.value),
    },
  });
});

const pagesEl = ref<HTMLElement | null>(null);
let pagesObserver: IntersectionObserver | null = null;
// Without an observer (jsdom) the pages load eagerly rather than never.
watch(pagesEl, (el) => {
  pagesObserver?.disconnect();
  pagesObserver = null;
  if (!el) return;
  if (typeof IntersectionObserver === "undefined") {
    markPagesVisible();
    return;
  }
  pagesObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      markPagesVisible();
      pagesObserver?.disconnect();
      pagesObserver = null;
    },
    // eslint-disable-next-line local/no-hardcoded-px -- IntersectionObserver rootMargin parses px/% only — a rem value throws SyntaxError
    { rootMargin: "200px 0px" },
  );
  pagesObserver.observe(el);
});
onBeforeUnmount(() => {
  pagesObserver?.disconnect();
  abortAll();
});

const drill = (name: string, filter: string, extra?: Record<string, string>): RouteLocationRaw => ({
  name,
  query: drillQuery({
    org: String(store.state.selectedOrganization.identifier),
    filter,
    scope: scopeWhere({ schema: props.schema ?? new Set(), filters: filters.value }),
    range: range.value,
    picker: props.selectedDate,
    extra,
    encode: b64EncodeUnicode,
  }),
});
const openSetup = () =>
  router.push({
    name: "frontendMonitoring",
    query: { org_identifier: String(store.state.selectedOrganization.identifier) },
  });
const sessionsLink = (filter: string) => drill("Sessions", filter);
const allPagesLink = computed<RouteLocationRaw>(() => ({
  name: PA_ROUTES.overview,
  query: analyticsQuery({
    org: String(store.state.selectedOrganization.identifier),
    range: range.value,
    picker: props.selectedDate,
  }),
}));
const errorsLink = (filter: string) => drill("ErrorTracking", filter);

const prevUsable = computed(() =>
  previousUsable(
    { views: vitalsPrev.value?.views, sessions: totals.value.prev?.sessions },
    { views: vitals.value?.views, sessions: totals.value.cur?.sessions },
  ),
);

const filtersActive = computed(() => Object.values(filters.value).some((v) => v.length));
const clearFilters = () => {
  filters.value = { service: [], env: [], version: [] };
};

const kpis = computed(() => {
  const cur = totals.value.cur;
  const prev = prevUsable.value ? totals.value.prev : null;
  const spark = (pick: Parameters<typeof sparkValues>[1]) => sparkValues(series.value, pick);
  return [
    {
      key: "sessions",
      label: t("rum.overviewPage.kpiSessions"),
      value: raw(formatCount(cur?.sessions)),
      delta: kpiDelta(cur?.sessions ?? null, prev?.sessions ?? null, { higherIsBetter: true }),
      spark: spark("sessions"),
      sparkTone: "default" as const,
      to: drill("Sessions", ""),
    },
    {
      key: "errorFree",
      label: t("rum.overviewPage.kpiErrorFree"),
      value: raw(formatPercent(cur?.errorFree)),
      delta: kpiDelta(cur?.errorFree ?? null, prev?.errorFree ?? null, {
        higherIsBetter: true,
        points: true,
      }),
      points: true,
      spark: sparkValues(series.value, "errorFree"),
      sparkTone: "success" as const,
      to: drill("Sessions", "", { health: "clean" }),
    },
    {
      key: "errors",
      label: t("rum.overviewPage.kpiErrors"),
      value: raw(formatCount(cur?.errors)),
      delta: kpiDelta(cur?.errors ?? null, prev?.errors ?? null, { higherIsBetter: false }),
      spark: spark("errors"),
      sparkTone: "danger" as const,
      to: errorsLink(""),
    },
    {
      key: "unhandled",
      label: t("rum.overviewPage.kpiUnhandled"),
      value: raw(formatCount(cur?.unhandled)),
      delta: kpiDelta(cur?.unhandled ?? null, prev?.unhandled ?? null, { higherIsBetter: false }),
      spark: spark("unhandled"),
      sparkTone: "warning" as const,
      to: errorsLink("error_handling='unhandled'"),
    },
  ].map((k) => ({
    ...k,
    dataTest: `rum-overview-kpi-${k.key}`,
    ariaLabel: t(
      k.key === "errors" || k.key === "unhandled"
        ? "rum.overviewPage.tileOpenErrors"
        : "rum.overviewPage.tileOpenSessions",
      { label: k.label, value: k.value },
    ),
  }));
});
</script>
