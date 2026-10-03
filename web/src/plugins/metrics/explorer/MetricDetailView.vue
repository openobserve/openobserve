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
  One metric, in detail: its current query at full width, then Breakdown (which
  label value is it?) and Related (what else is nearby?).

  Driven by the URL's `metric` parameter, not by a page mode — the parent swaps
  this in for the grid and pauses the grid while it is open.
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
          label: t('metrics.explorer.detail.close'),
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
            class="text-text-secondary shrink-0 text-xs"
            data-test="metrics-detail-unit"
            >{{ unitLabel }}</span
          >
        </template>
        <template #actions>
          <OButton
            variant="outline"
            size="sm-toolbar"
            icon-left="edit"
            data-test="metrics-detail-open-visualize"
            @click="$emit('open-visualize')"
          >
            {{ t("metrics.explorer.detail.openInVisualize") }}
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
        <OContent class="py-3">
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

          <div v-else class="min-w-0 overflow-x-auto" data-test="metrics-detail-related">
            <OEmptyState
              v-if="!related.length"
              size="inline"
              icon="search-off"
              :title="t('metrics.explorer.detail.related.empty')"
            />
            <OTable
              v-else
              :data="related"
              :columns="relatedColumns"
              row-key="name"
              pagination="none"
              sorting="none"
              :show-global-filter="false"
              :fill-height="false"
              horizontal-scroll
              row-class="cursor-pointer"
              @row-click="(row: RelatedRow) => $emit('open-related', row.name)"
            >
              <template #cell="{ row, column }">
                <span v-if="column.id === 'name'" class="font-mono text-xs">{{
                  row.original.name
                }}</span>
                <OTag
                  v-else-if="column.id === 'type'"
                  type="metricType"
                  :value="row.original.typeFilterBucket"
                />
                <span v-else-if="column.id === 'unit'" class="text-text-secondary text-xs">{{
                  row.original.unitLabel
                }}</span>
                <span v-else-if="column.id === 'shared'" class="text-text-secondary text-xs">{{
                  row.original.sharedLabels.length
                    ? row.original.sharedLabels.join(", ")
                    : t("metrics.explorer.detail.related.noSharedLabels")
                }}</span>
              </template>
            </OTable>
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
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { parseSearchError } from "@/utils/query/searchError";
import { supportsBreakdown, toO2Unit } from "@/utils/metrics/metricDefaults";
import { UNIT_LABELS } from "@/utils/metrics/metricPalette";
import { rankRelatedMetrics, relatedCandidates } from "@/utils/metrics/relatedMetrics";
import type { DetailTab } from "@/utils/metrics/explorerUrlState";
import type { MetricCard as MetricCardModel } from "@/utils/metrics/metricFamily";
import { isCancelled } from "@/composables/metrics/useMetricsPreviewQueue";
import { hasSamples, type LabelFilter } from "@/composables/metrics/useMetricsExplorerGrid";

/** Related metrics shown — a ranked list, no charts. */
const RELATED_LIMIT = 12;

interface RelatedRow {
  name: string;
  sharedLabels: string[];
  typeFilterBucket: string;
  unitLabel: string;
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
    OPageHeader,
    OContent,
    OButton,
    OIcon,
    OTag,
    OTable,
    OTabs,
    OTab,
    OEmptyState,
    OSkeleton,
    OSpinner,
    OTooltip,
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
    overview: {
      type: Object as PropType<{
        queries: any[];
        chartType: string;
        unit: string;
        bucketUnit: string | null;
      }>,
      required: true,
    },
    isFavorite: { type: Boolean, default: false },
    allCards: { type: Array as PropType<MetricCardModel[]>, required: true },
    labelsByStream: { type: Object as PropType<Record<string, string[]>>, required: true },
    prefixOf: { type: Function as PropType<(name: string) => string>, required: true },
    familyOf: { type: Function as PropType<(name: string) => string>, required: true },
    filters: { type: Array as PropType<LabelFilter[]>, required: true },
    timeRange: {
      type: Object as PropType<{ start_time: number; end_time: number }>,
      required: true,
    },
    rateWindow: { type: String, required: true },
    nanGuard: { type: Boolean, default: false },
    color: { type: String, required: true },
    runQuery: { type: Function as PropType<(expr: string) => Promise<any>>, required: true },
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

    const unitLabel = computed(() => raw(UNIT_LABELS[props.card?.unit ?? ""] ?? ""));

    const breakdownSupported = computed(
      () => !!props.card && supportsBreakdown(props.card.cardKind),
    );
    /** Breakdown is the default; a kind without one lands on Related. */
    const activeTab = computed<DetailTab>(() =>
      breakdownSupported.value ? (props.tab ?? "breakdown") : "related",
    );

    /* --------------------------------------------------------- overview */

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

    watch(
      () => [
        props.loading,
        props.card?.name,
        props.overview.queries.map((query: any) => query.expr).join("\n"),
        props.timeRange.start_time,
        props.timeRange.end_time,
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

    /* ---------------------------------------------------------- related */

    const related = computed<RelatedRow[]>(() => {
      const card = props.card;
      if (!card) return [];
      const byName = new Map(props.allCards.map((c) => [c.name, c]));
      const candidates = relatedCandidates(card.name, [...byName.keys()], props.prefixOf);
      return rankRelatedMetrics(card.name, candidates, props.labelsByStream, props.familyOf)
        .slice(0, RELATED_LIMIT)
        .map(({ name, sharedLabels }) => {
          const other = byName.get(name);
          return {
            name,
            sharedLabels,
            typeFilterBucket: other?.typeFilterBucket ?? "other",
            unitLabel: UNIT_LABELS[other?.unit ?? ""] ?? "",
          };
        });
    });

    const relatedColumns = computed<OTableColumnDef<RelatedRow>[]>(() => [
      {
        id: "name",
        header: t("metrics.explorer.detail.related.name"),
        size: 360,
        meta: { isName: true },
      },
      { id: "type", header: t("metrics.explorer.detail.related.type"), size: 120 },
      { id: "unit", header: t("metrics.explorer.detail.related.unit"), size: 100 },
      { id: "shared", header: t("metrics.explorer.detail.related.sharedLabels"), size: 320 },
    ]);

    return {
      raw,
      t,
      unitLabel,
      breakdownSupported,
      activeTab,
      overviewState,
      overviewHasSamples,
      overviewUnit,
      overviewBucketUnit,
      loadOverview,
      onOverviewRenderError,
      related,
      relatedColumns,
    };
  },
});
</script>
