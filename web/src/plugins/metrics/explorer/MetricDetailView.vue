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
  <div class="flex min-h-0 flex-1 flex-col" data-test="metrics-detail">
    <div
      v-if="loading"
      class="flex flex-1 flex-col items-center justify-center gap-2.5 opacity-80"
      data-test="metrics-detail-loading"
    >
      <OSpinner size="lg" />
      <span>{{ t("metrics.explorer.detail.loading") }}</span>
    </div>

    <OEmptyState
      v-else-if="!card"
      size="block"
      icon="search-off"
      :title="t('metrics.explorer.detail.notFound')"
      :description="t('metrics.explorer.detail.notFoundDesc', { name: metricName })"
      :action-label="t('metrics.explorer.detail.close')"
      data-test="metrics-detail-not-found"
      @action="$emit('close')"
    />

    <template v-else>
      <OPageHeader
        :title="raw(card.name)"
        :subtitle="card.help ? raw(card.help) : undefined"
        title-data-test="metrics-detail-title"
        :back="{
          label: t('metrics.explorer.detail.backTo'),
          onClick: () => $emit('close'),
          dataTest: 'metrics-detail-close',
        }"
      >
        <template #title-trail>
          <OTag
            type="metricType"
            :value="card.typeFilterBucket"
            class="shrink-0"
            data-test="metrics-detail-badge"
          />
          <span
            v-if="unitLabel"
            class="text-text-secondary shrink-0 text-xs max-md:hidden"
            data-test="metrics-detail-unit"
            >{{ unitLabel }}</span
          >
        </template>
        <template #actions>
          <OButton
            variant="outline"
            size="sm-toolbar"
            icon-left="edit"
            :aria-label="t('metrics.explorer.detail.openInVisualize')"
            data-test="metrics-detail-open-visualize"
            @click="$emit('open-visualize')"
          >
            <span class="max-md:hidden">{{ t("metrics.explorer.detail.openInVisualize") }}</span>
            <OTooltip :content="t('metrics.explorer.detail.openInVisualize')" />
          </OButton>
          <OButton
            variant="ghost"
            size="icon-toolbar"
            :icon-left="isFavorite ? 'star' : 'star-outline'"
            :class="isFavorite ? 'text-favorite' : ''"
            :aria-label="
              isFavorite
                ? t('metrics.explorer.card.favoriteRemoveAria', { name: card.name })
                : t('metrics.explorer.card.favoriteAddAria', { name: card.name })
            "
            :aria-pressed="String(isFavorite)"
            data-test="metrics-detail-favorite"
            @click="$emit('toggle-favorite')"
          >
            <OTooltip
              :content="
                isFavorite
                  ? t('metrics.explorer.card.favoriteRemoveTooltip')
                  : t('metrics.explorer.card.favoriteAddTooltip')
              "
            />
          </OButton>
        </template>
      </OPageHeader>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <OContent class="flex flex-col gap-3 py-3">
          <!-- The engine ignores matchers on labels the metric lacks, so the chart is unfiltered by these. -->
          <OBanner
            v-if="inapplicableFilters.length"
            variant="info"
            icon="info"
            dense
            :content="
              t(
                'metrics.explorer.detail.filtersNotApplied',
                { filters: inapplicableFiltersText },
                inapplicableFilters.length,
              )
            "
            data-test="metrics-detail-filters-not-applied"
          />
          <section
            class="border-border-default rounded-surface relative h-60 border"
            data-test="metrics-detail-overview"
          >
            <div
              v-if="overviewState.status === 'error'"
              class="text-text-secondary flex h-full flex-col items-center justify-center gap-1 text-xs"
              :title="overviewState.error"
            >
              <OIcon name="error" size="sm" class="text-error-600" />
              <span>{{ t("metrics.explorer.queryFailed") }}</span>
              <OButton variant="ghost-primary" size="xs" @click="loadOverview">
                {{ t("metrics.explorer.retry") }}
              </OButton>
            </div>
            <div
              v-else-if="!overview.queries.length"
              class="text-text-secondary flex h-full items-center justify-center text-xs"
            >
              {{ t("metrics.explorer.card.noPreview") }}
            </div>
            <div
              v-else-if="overviewState.status === 'done' && !overviewHasSamples"
              class="text-text-secondary flex h-full items-center justify-center text-xs"
            >
              {{ t("metrics.explorer.noData") }}
            </div>
            <MetricCardChart
              v-else-if="overviewState.status === 'done'"
              :results="overviewState.results"
              :queries="overview.queries"
              :chart-type="overview.chartType"
              :unit="overviewUnit.unit"
              :unit-custom="overviewUnit.unitCustom ?? undefined"
              :bucket-unit="overviewBucketUnit.unit ?? undefined"
              :bucket-unit-custom="overviewBucketUnit.unitCustom ?? undefined"
              :color="color"
              :time-range="timeRange"
              @error="onOverviewRenderError"
            />
            <OSkeleton v-else class="h-full" animation="wave" />
          </section>
        </OContent>

        <OTabs
          :model-value="activeTab"
          class="border-border-default border-b"
          data-test="metrics-detail-tabs"
          @update:model-value="$emit('update:tab', $event)"
        >
          <OTab
            v-if="breakdownSupported"
            name="breakdown"
            :label="t('metrics.explorer.detail.tabBreakdown')"
          />
          <OTab name="related" :label="t('metrics.explorer.detail.tabRelated')" />
        </OTabs>

        <OContent class="py-3">
          <MetricBreakdown
            v-if="activeTab === 'breakdown'"
            :card="card"
            :labels-by-stream="labelsByStream"
            :filters="filters"
            :time-range="timeRange"
            :selected-label="breakdownLabel"
            :rate-window="rateWindow"
            :nan-guard="nanGuard"
            :color="color"
            :run-query="runQuery"
            :cancel-queries="cancelQueries"
            @update:selected-label="$emit('update:breakdownLabel', $event)"
            @add-filter="$emit('add-filter', $event)"
          />

          <div v-else data-test="metrics-detail-related">
            <OEmptyState
              v-if="!related.length"
              size="inline"
              icon="search-off"
              :title="t('metrics.explorer.detail.related.empty')"
              data-test="metrics-detail-related-empty"
            />
            <div
              v-else
              class="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-md:grid-cols-1"
              data-test="metrics-detail-related-grid"
            >
              <MetricChartTile
                v-for="row in related"
                :key="row.name"
                class="hover:border-primary h-56 cursor-pointer"
                :queries="row.chart.queries"
                :chart-type="row.chart.chartType"
                :unit="row.chart.unit"
                :bucket-unit="row.chart.bucketUnit"
                :color="row.color"
                :time-range="timeRange"
                :run-query="row.runQuery"
                :cancel-queries="cancelQueries"
                :data-test="`metrics-detail-related-card-${row.name}`"
                @click="$emit('open-related', row.name)"
              >
                <template #header>
                  <div class="flex min-w-0 flex-1 flex-col py-0.5">
                    <div class="flex min-w-0 items-center gap-1.5">
                      <OButton
                        variant="ghost"
                        size="chip"
                        class="min-w-0"
                        :aria-label="t('metrics.explorer.card.detailsAria', { name: row.name })"
                        :data-test="`metrics-detail-related-open-${row.name}`"
                        @click.stop="$emit('open-related', row.name)"
                      >
                        <span class="truncate" :title="row.name">{{ row.name }}</span>
                      </OButton>
                      <OTag type="metricType" :value="row.typeFilterBucket" class="shrink-0" />
                    </div>
                    <span
                      class="text-2xs text-text-secondary block truncate px-1.5 font-normal"
                      :title="row.sharedLabels.join(', ')"
                      :data-test="`metrics-detail-related-shared-${row.name}`"
                      >{{
                        row.sharedLabels.length
                          ? t("metrics.explorer.detail.related.sharedLabels", {
                              labels: row.sharedLabels.join(", "),
                            })
                          : t("metrics.explorer.detail.related.noSharedLabels")
                      }}</span
                    >
                  </div>
                </template>
              </MetricChartTile>
            </div>
          </div>
        </OContent>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, ref, watch, type PropType } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import MetricCardChart from "./MetricCardChart.vue";
import MetricBreakdown from "./MetricBreakdown.vue";
import MetricChartTile, { type TileQuery } from "./MetricChartTile.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { parseSearchError } from "@/utils/query/searchError";
import { supportsBreakdown, toO2Unit } from "@/utils/metrics/metricDefaults";
import { UNIT_LABELS, cardColorForIndex } from "@/utils/metrics/metricPalette";
import useTheme from "@/composables/useTheme";
import { rankRelatedMetrics, relatedCandidates } from "@/utils/metrics/relatedMetrics";
import type { DetailTab } from "@/utils/metrics/explorerUrlState";
import type { MetricCard as MetricCardModel } from "@/utils/metrics/metricFamily";
import { isCancelled } from "@/composables/metrics/useMetricsPreviewQueue";
import { hasSamples, type LabelFilter } from "@/composables/metrics/useMetricsExplorerGrid";

const RELATED_LIMIT = 12;

/** A metric's chart as its explorer card draws it. */
export interface DetailChart {
  queries: TileQuery[];
  chartType: string;
  unit: string;
  bucketUnit: string | null;
}

interface RelatedRow {
  name: string;
  sharedLabels: string[];
  typeFilterBucket: string;
  chart: DetailChart;
  color: string;
  runQuery: (expr: string) => Promise<any>;
}

interface OverviewState {
  status: "idle" | "loading" | "done" | "error";
  results: any[];
  error: string;
}

const IDLE: OverviewState = { status: "idle", results: [], error: "" };

export default defineComponent({
  name: "MetricDetailView",
  components: {
    MetricCardChart,
    MetricBreakdown,
    MetricChartTile,
    OPageHeader,
    OContent,
    OButton,
    OIcon,
    OTag,
    OTabs,
    OTab,
    OEmptyState,
    OSkeleton,
    OSpinner,
    OTooltip,
    OBanner,
  },
  props: {
    /** `null` while loading, or when the URL names a metric that does not exist. */
    card: { type: Object as PropType<MetricCardModel | null>, default: null },
    metricName: { type: String, required: true },
    /** The stream list or the label schemas are still loading. */
    loading: { type: Boolean, default: false },
    tab: { type: String as PropType<DetailTab | null>, default: null },
    breakdownLabel: { type: String as PropType<string | null>, default: null },
    /** The card's current query — its ⚙ override included — resolved by the grid. */
    overview: { type: Object as PropType<DetailChart>, required: true },
    /** Any metric's chart as the grid would draw it, for the Related cards. */
    chartOf: {
      type: Function as PropType<(card: MetricCardModel) => DetailChart>,
      required: true,
    },
    isFavorite: { type: Boolean, default: false },
    allCards: { type: Array as PropType<MetricCardModel[]>, required: true },
    labelsByStream: { type: Object as PropType<Record<string, string[]>>, required: true },
    prefixOf: { type: Function as PropType<(name: string) => string>, required: true },
    familyOf: { type: Function as PropType<(name: string) => string>, required: true },
    filters: { type: Array as PropType<LabelFilter[]>, required: true },
    /** The active filters this metric cannot apply: its chart ignores them. */
    inapplicableFilters: { type: Array as PropType<LabelFilter[]>, default: () => [] },
    /** Whether a metric can apply every active filter — Related offers only those. */
    isLabelEligible: {
      type: Function as PropType<(card: MetricCardModel) => boolean>,
      default: () => true,
    },
    timeRange: {
      type: Object as PropType<{ start_time: number; end_time: number }>,
      required: true,
    },
    rateWindow: { type: String, required: true },
    nanGuard: { type: Boolean, default: false },
    color: { type: String, required: true },
    /** Runs one PromQL query on the scheduler, stepped for `card` (default: this view's metric). */
    runQuery: {
      type: Function as PropType<(expr: string, card?: MetricCardModel) => Promise<any>>,
      required: true,
    },
    cancelQueries: { type: Function as PropType<(exprs: string[]) => void>, required: true },
  },
  emits: [
    "close",
    "open-visualize",
    "toggle-favorite",
    "update:tab",
    "update:breakdownLabel",
    "open-related",
    "add-filter",
  ],
  setup(props) {
    const { t } = useI18nTyped();
    const { isDark } = useTheme();

    const unitLabel = computed(() => raw(UNIT_LABELS[props.card?.unit ?? ""] ?? ""));

    const inapplicableFiltersText = computed(() =>
      props.inapplicableFilters.map((f) => `${f.label}${f.operator ?? "="}"${f.value}"`).join(", "),
    );

    const breakdownSupported = computed(
      () => !!props.card && supportsBreakdown(props.card.cardKind),
    );
    /** Breakdown is the default; a kind without one lands on Related. */
    const activeTab = computed<DetailTab>(() =>
      breakdownSupported.value ? (props.tab ?? "breakdown") : "related",
    );

    const overviewState = ref<OverviewState>(IDLE);
    const overviewHasSamples = computed(() => overviewState.value.results.some(hasSamples));
    const overviewUnit = computed(() => toO2Unit(props.overview.unit));
    const overviewBucketUnit = computed(() =>
      props.overview.bucketUnit
        ? toO2Unit(props.overview.bucketUnit)
        : { unit: null, unitCustom: null },
    );

    /** A resolution from a previous card or window must never land. */
    let generation = 0;
    let activeExprs: string[] = [];

    const cancelActive = () => {
      if (activeExprs.length) props.cancelQueries(activeExprs);
      activeExprs = [];
    };

    const loadOverview = async () => {
      const mine = ++generation;
      cancelActive();
      const exprs: string[] = props.overview.queries.map((query: any) => query.expr);
      if (props.loading || !props.card || !exprs.length) {
        overviewState.value = IDLE;
        return;
      }
      activeExprs = exprs;
      overviewState.value = { status: "loading", results: [], error: "" };
      try {
        const results = await Promise.all(exprs.map((expr) => props.runQuery(expr)));
        if (mine !== generation) return;
        overviewState.value = { status: "done", results, error: "" };
      } catch (error: any) {
        if (mine !== generation || isCancelled(error)) return;
        overviewState.value = {
          status: "error",
          results: [],
          error: parseSearchError(error).message,
        };
      }
    };

    // Sources compared one by one: a getter returning a fresh array re-fires on every card rebuild.
    watch(
      [
        () => props.loading,
        () => props.card?.name,
        () => props.overview.queries.map((query: any) => query.expr).join("\n"),
        () => props.timeRange,
      ],
      loadOverview,
      { immediate: true },
    );

    const onOverviewRenderError = (error: any) => {
      overviewState.value = {
        status: "error",
        results: [],
        error: String(error || t("metrics.functionConfigDialog.failedToRenderChart")),
      };
    };

    onBeforeUnmount(() => {
      generation += 1;
      cancelActive();
    });

    const related = computed<RelatedRow[]>(() => {
      const card = props.card;
      if (!card) return [];
      // A metric the filters do not apply to is hidden from the grid, so it is no neighbour here.
      const byName = new Map(
        props.allCards.filter((c) => props.isLabelEligible(c)).map((c) => [c.name, c]),
      );
      const candidates = relatedCandidates(card.name, [...byName.keys()], props.prefixOf);
      return rankRelatedMetrics(card.name, candidates, props.labelsByStream, props.familyOf)
        .slice(0, RELATED_LIMIT)
        .flatMap(({ name, sharedLabels }, index) => {
          const other = byName.get(name);
          if (!other) return [];
          return [
            {
              name,
              sharedLabels,
              typeFilterBucket: other.typeFilterBucket ?? "other",
              chart: props.chartOf(other),
              color: cardColorForIndex(index, isDark.value),
              runQuery: (expr: string) => props.runQuery(expr, other),
            },
          ];
        });
    });

    return {
      raw,
      t,
      unitLabel,
      inapplicableFiltersText,
      breakdownSupported,
      activeTab,
      overviewState,
      overviewHasSamples,
      overviewUnit,
      overviewBucketUnit,
      loadOverview,
      onOverviewRenderError,
      related,
    };
  },
});
</script>
