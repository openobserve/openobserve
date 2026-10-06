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
  <div class="flex min-h-0 flex-col gap-3" data-test="metrics-breakdown">
    <OEmptyState
      v-if="!labels.length"
      size="inline"
      icon="label"
      :title="t('metrics.explorer.detail.breakdown.noLabels')"
      data-test="metrics-breakdown-no-labels"
    />

    <template v-else-if="activeLabel">
      <div>
        <OButton
          variant="ghost"
          size="sm"
          icon-left="arrow-back"
          data-test="metrics-breakdown-back"
          @click="$emit('update:selectedLabel', null)"
        >
          {{ t("metrics.explorer.detail.breakdown.allLabels") }}
        </OButton>
      </div>

      <MetricChartTile
        ref="focusedTile"
        :class="heatmap ? 'min-h-60' : 'h-60'"
        :queries="heatmap ? heatmapQueries : queriesByLabel[activeLabel]"
        :chart-type="chartType"
        :unit="unit"
        :color="color"
        :time-range="timeRange"
        :run-query="heatmap ? runHeatmapQuery : runQuery"
        legend
        allow-alert-creation
        :compare="compare"
        :forecast="forecast"
        :step-seconds="stepSeconds"
        data-test="metrics-breakdown-chart"
        @results="focused = $event"
      >
        <template #header>
          <span class="truncate">{{ focusedTitle }}</span>
          <OTag
            v-if="topkByLabel[activeLabel] || (heatmap && heatmapStats.size > TOPK)"
            variant="default-outline"
            size="sm"
            class="shrink-0"
            data-test="metrics-breakdown-topk"
            >{{ t("metrics.explorer.detail.breakdown.topk", { count: TOPK }) }}</OTag
          >
          <div class="flex-1" />
          <!-- Only once the chart has drawn: the panel's decimals come from its values. -->
          <OButton
            variant="ghost"
            size="xs"
            icon-left="dashboard-customize"
            class="shrink-0"
            :disabled="focused.status !== 'done' || (heatmap && selectedValue === null)"
            data-test="metrics-breakdown-add-to-dashboard"
            @click="openAddToDashboard"
          >
            {{ t("metrics.explorer.detail.breakdown.addToDashboard") }}
          </OButton>
        </template>
        <template v-if="heatmap" #chart="{ timeRange: drawnRange, onRenderError }">
          <div class="flex flex-col gap-2 p-2">
            <div
              v-for="value in heatmapValues"
              :key="value"
              class="rounded-default flex h-44 flex-col border"
              :class="value === selectedValue ? 'border-primary' : 'border-transparent'"
              :data-selected="value === selectedValue"
              :data-test="`metrics-breakdown-heatmap-${value}`"
            >
              <span class="text-2xs text-text-secondary truncate px-1 font-mono" :title="value">{{
                value
              }}</span>
              <div class="min-h-0 flex-1">
                <MetricCardChart
                  :results="[heatmapResponses.get(value)]"
                  :queries="heatmapQueries ?? []"
                  chart-type="heatmap"
                  :unit="o2HeatmapUnit.unit"
                  :unit-custom="o2HeatmapUnit.unitCustom ?? undefined"
                  :bucket-unit="o2BucketUnit.unit ?? undefined"
                  :bucket-unit-custom="o2BucketUnit.unitCustom ?? undefined"
                  :visual-map-range="heatmapRange"
                  :decimals="heatmapDecimals"
                  :color="color"
                  :time-range="drawnRange"
                  @error="onRenderError"
                />
              </div>
            </div>
          </div>
        </template>
      </MetricChartTile>

      <section
        class="border-border-default rounded-surface flex flex-col overflow-hidden border"
        data-test="metrics-breakdown-values"
      >
        <PanelBar class="min-w-0 gap-2">
          <span class="truncate">{{
            t("metrics.explorer.detail.breakdown.valuesOf", { label: activeLabel })
          }}</span>
          <span
            v-if="distinctText(activeLabel)"
            class="text-2xs text-text-secondary shrink-0 font-normal tabular-nums"
            :data-test="`metrics-breakdown-distinct-${activeLabel}`"
            >{{ distinctText(activeLabel) }}</span
          >
        </PanelBar>

        <div class="p-2">
          <OBanner
            v-if="activeCounts.failed"
            variant="error-soft"
            dense
            inline-actions
            :content="
              t('metrics.explorer.detail.breakdown.countsFailed', {
                error: raw(activeCounts.error),
              })
            "
            data-test="metrics-breakdown-values-error"
          >
            <template #actions>
              <OButton
                variant="ghost-primary"
                size="xs"
                data-test="metrics-breakdown-values-retry"
                @click="retryCounts"
              >
                {{ t("metrics.explorer.retry") }}
              </OButton>
            </template>
          </OBanner>

          <OSkeleton
            v-else-if="!activeCounts.ready"
            class="h-16"
            animation="wave"
            data-test="metrics-breakdown-values-loading"
          />

          <p
            v-else-if="!rows.length"
            class="text-text-secondary px-1 text-xs"
            data-test="metrics-breakdown-values-empty"
          >
            {{ t("metrics.explorer.noData") }}
          </p>

          <OTable
            v-else
            :data="rows"
            :columns="columns"
            row-key="value"
            :frame="false"
            :fill-height="false"
            pagination="none"
            sorting="none"
            :show-global-filter="false"
            dense
            :key="heatmap ? 'heatmap' : 'line'"
            :row-class="heatmap ? heatmapRowClass : undefined"
            data-test="metrics-breakdown-table"
            v-on="heatmap ? { rowClick: pickRow } : {}"
            @row-mouseenter="(row) => highlight(row, 'highlight')"
            @row-mouseleave="(row) => highlight(row, 'downplay')"
          >
            <template #cell-value="{ row }">
              <span
                class="text-text-body block truncate font-mono text-xs"
                :title="row.value"
                :data-test="`metrics-breakdown-value-${activeLabel}-${row.value}`"
                >{{ row.value }}</span
              >
            </template>

            <template #cell-trend="{ row }">
              <div :data-test="`metrics-breakdown-trend-${activeLabel}-${row.value}`">
                <OSkeleton
                  v-if="statsLoading"
                  class="h-3 w-full"
                  data-test="metrics-breakdown-stat-loading"
                />
                <!-- Inline, not OSparkline: it has no colour prop, and the line must match its series. -->
                <svg
                  v-else-if="row.trend"
                  viewBox="0 0 100 24"
                  preserveAspectRatio="none"
                  class="text-text-secondary block h-5 w-full"
                  aria-hidden="true"
                >
                  <path
                    :d="row.trend"
                    fill="none"
                    :stroke="row.color ?? 'currentColor'"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    vector-effect="non-scaling-stroke"
                  />
                </svg>
                <span v-else class="text-text-secondary text-xs">{{ ABSENT }}</span>
              </div>
            </template>

            <template v-for="stat in STAT_COLUMNS" :key="stat" #[`cell-${stat}`]="{ row }">
              <span
                class="text-text-body block text-xs tabular-nums"
                :data-test="`metrics-breakdown-${stat}-${activeLabel}-${row.value}`"
              >
                <OSkeleton
                  v-if="statsLoading"
                  class="ms-auto h-3 w-12"
                  data-test="metrics-breakdown-stat-loading"
                />
                <template v-else>{{ row[stat] ?? ABSENT }}</template>
              </span>
            </template>

            <template #cell-actions="{ row }">
              <div class="flex items-center justify-end gap-1">
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  icon-left="add-circle-outline"
                  :aria-label="
                    t('metrics.explorer.detail.breakdown.addToFilterAria', {
                      label: activeLabel,
                      value: row.value,
                    })
                  "
                  :data-test="`metrics-breakdown-add-${activeLabel}-${row.value}`"
                  @click="addFilter(activeLabel, row.value, '=')"
                >
                  <OTooltip :content="t('metrics.explorer.detail.breakdown.addToFilter')" />
                </OButton>
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  icon-left="block"
                  :aria-label="
                    t('metrics.explorer.detail.breakdown.excludeAria', {
                      label: activeLabel,
                      value: row.value,
                    })
                  "
                  :data-test="`metrics-breakdown-exclude-${activeLabel}-${row.value}`"
                  @click="addFilter(activeLabel, row.value, '!=')"
                >
                  <OTooltip :content="t('metrics.explorer.detail.breakdown.exclude')" />
                </OButton>
              </div>
            </template>
          </OTable>
        </div>
      </section>
    </template>

    <template v-else>
      <OBanner
        v-if="headError"
        variant="error-soft"
        dense
        inline-actions
        :content="t('metrics.explorer.detail.breakdown.countsFailed', { error: raw(headError) })"
        data-test="metrics-breakdown-counts-error"
      >
        <template #actions>
          <OButton
            variant="ghost-primary"
            size="xs"
            data-test="metrics-breakdown-counts-retry"
            @click="retryCounts"
          >
            {{ t("metrics.explorer.retry") }}
          </OButton>
        </template>
      </OBanner>

      <p class="text-text-secondary text-xs">
        {{ t("metrics.explorer.detail.breakdown.selectHint") }}
      </p>

      <div
        class="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-md:grid-cols-1"
        data-test="metrics-breakdown-grid"
      >
        <MetricChartTile
          v-for="label in labels"
          :key="label"
          class="hover:border-primary h-56 cursor-pointer"
          :queries="queriesByLabel[label]"
          :chart-type="chartType"
          :unit="unit"
          :color="color"
          :time-range="timeRange"
          :run-query="runQuery"
          :data-test="`metrics-breakdown-card-${label}`"
          @select="select(label)"
        >
          <template #header>
            <span class="min-w-0 truncate font-mono" :title="label">{{
              heatmap ? titleOf(label) : label
            }}</span>
            <span
              v-if="distinctText(label)"
              class="text-2xs text-text-secondary shrink-0 font-normal tabular-nums"
              :data-test="`metrics-breakdown-distinct-${label}`"
              >{{ distinctText(label) }}</span
            >
            <OTag
              v-if="topkByLabel[label]"
              variant="default-outline"
              size="sm"
              class="shrink-0"
              :data-test="`metrics-breakdown-topk-${label}`"
              >{{ t("metrics.explorer.detail.breakdown.topk", { count: TOPK }) }}</OTag
            >
            <div class="flex-1" />
            <OButton
              variant="ghost-primary"
              size="xs"
              icon-left="open-in-full"
              class="shrink-0"
              :aria-label="t('metrics.explorer.detail.breakdown.drillDownAria', { label })"
              :data-test="`metrics-breakdown-select-${label}`"
              @click.stop="select(label)"
            >
              {{ t("metrics.explorer.detail.breakdown.drillDown") }}
            </OButton>
          </template>
        </MetricChartTile>
      </div>
    </template>

    <AddToDashboard
      v-model:open="dashboardDialogOpen"
      :dashboard-panel-data="dashboardPanel"
      :default-panel-title="dashboardPanelTitle"
      @save="dashboardDialogOpen = false"
    />
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  ref,
  watch,
  type ComponentPublicInstance,
  type PropType,
} from "vue";
import { getInstanceByDom, type ECharts } from "echarts/core";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import MetricChartTile, {
  type TileCompare,
  type TileForecast,
  type TileQuery,
} from "./MetricChartTile.vue";
import MetricCardChart from "./MetricCardChart.vue";
import AddToDashboard from "../AddToDashboard.vue";
import PanelBar from "@/components/common/PanelBar.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import streamService from "@/services/stream";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { parseSearchError } from "@/utils/query/searchError";
import {
  baseNameOf,
  breakdownLabelsOf,
  BREAKDOWN_LABEL_LIMIT,
  breakdownTitleKey,
  buildBreakdownQuery,
  buildHeatmapBreakdownQuery,
  buildHeatmapValueQuery,
  breakdownQueryOf,
  CARD_KIND,
  toO2Unit,
} from "@/utils/metrics/metricDefaults";
import {
  adaptiveDecimals,
  decimalsForMax,
  heatmapResponsesByValue,
  heatmapStatsByValue,
  seriesStatsByValue,
  sharedHeatmapRange,
  topValuesByRate,
  type HeatmapStats,
  type SeriesStats,
} from "@/utils/metrics/breakdownStats";
import { operandStreamsOf, type MetricCard as MetricCardModel } from "@/utils/metrics/metricFamily";
import { labelFiltersToSql } from "@/utils/metrics/labelFilterSql";
import { buildPanelDataForCard } from "@/utils/metrics/metricsHandoff";
import type { LabelFilter, QueryWindow } from "@/composables/metrics/useMetricsExplorerGrid";

interface BreakdownVariant {
  /** `builder` names the stream a query reads when it is not the card's own. */
  queries: Array<TileQuery & { builder?: { metric: string } }>;
  chartType: string;
  unit: string;
  bucketUnit?: string | null;
  footerLabel?: string;
}

/** 21, not 20: a 21st value is how "more than 20" is known. */
const VALUES_SIZE = 21;
/** Series kept for a label with "20+" values — beyond it the chart is a smear. Also the heatmaps shown. */
const TOPK = 10;

interface LabelCounts {
  /** Its counts have answered, or will never be asked for. */
  ready: boolean;
  /** Its values were requested; past `BREAKDOWN_LABEL_LIMIT` only the selected label's are. */
  counted: boolean;
  failed: boolean;
  error: string;
  values: any[];
}

/**
 * Values add up, so one value's share of their total means something, only under an outer
 * `sum` or `count` that is not one side of a ratio. Read off the query the chart runs, which
 * follows the configured function; a quantile or an average never starts this way.
 */
const ADDITIVE_QUERY = /^(sum|count) by \(/;
const isAdditive = (expr: string | undefined) =>
  !!expr && ADDITIVE_QUERY.test(expr) && !expr.includes(" / ");

const STAT_COLUMNS = ["avg", "latest", "share", "rate", "p50", "p90", "p99"] as const;

const ABSENT = raw("—");

interface BreakdownRow {
  value: string;
  /** Formatted like the chart's y-axis; `null` when the value has no series. */
  avg: string | null;
  latest: string | null;
  share: string | null;
  /** A heatmap's observation rate and percentiles over the window. */
  rate: string | null;
  p50: string | null;
  p90: string | null;
  p99: string | null;
  /** Sparkline path in a 100×24 box, one subpath per unbroken run. */
  trend: string | null;
  color: string | null;
}

/**
 * Spaced by sample index, and drawn straight through a gap, as the focused chart connects nulls.
 * A lone real point is a zero-length segment its round cap draws as a dot. Scaled from zero, like
 * OSparkline, so a flat series with a 0.01% dip reads as flat rather than as a crash; all zeros
 * sit mid-height.
 */
const trendOf = (points: (number | null)[]): string | null => {
  const real = points.filter((p): p is number => p !== null);
  if (!real.length) return null;
  const min = Math.min(...real, 0);
  const range = Math.max(...real, 0) - min;
  const step = points.length > 1 ? 100 / (points.length - 1) : 0;
  const xy = points.flatMap((p, i) =>
    p === null
      ? []
      : [`${(i * step).toFixed(2)} ${(range ? 22 - ((p - min) / range) * 20 : 12).toFixed(2)}`],
  );
  return xy.length === 1 ? `M${xy[0]} l0 0` : `M${xy.join(" L")}`;
};

const PENDING: LabelCounts = { ready: false, counted: true, failed: false, error: "", values: [] };
const UNCOUNTED: LabelCounts = {
  ready: true,
  counted: false,
  failed: false,
  error: "",
  values: [],
};

export default defineComponent({
  name: "MetricBreakdown",
  components: {
    MetricChartTile,
    MetricCardChart,
    AddToDashboard,
    PanelBar,
    OButton,
    OTag,
    OEmptyState,
    OBanner,
    OSkeleton,
    OTooltip,
    OTable,
  },
  props: {
    card: { type: Object as PropType<MetricCardModel>, required: true },
    labelsByStream: { type: Object as PropType<Record<string, string[]>>, required: true },
    filters: { type: Array as PropType<LabelFilter[]>, required: true },
    /** The Explorer's window, µs. */
    timeRange: {
      type: Object as PropType<{ start_time: number; end_time: number }>,
      required: true,
    },
    selectedLabel: { type: String as PropType<string | null>, default: null },
    /** The card's concrete rate window, so the breakdown measures like the card. */
    rateWindow: { type: String, required: true },
    /** What the dashboard panel rates over: a widened card's concrete window, else `$__rate_interval`. */
    panelRateWindow: { type: String, required: true },
    /** The card's own query needed the NaN guard. */
    nanGuard: { type: Boolean, default: false },
    color: { type: String, required: true },
    /** The overview's function: the breakdown splits it. Absent, the kind's default measure. */
    variant: { type: Object as PropType<BreakdownVariant | null>, default: null },
    /** `variant`'s queries at the panel's rate window, for Add to dashboard. */
    panelQueries: { type: Array as PropType<TileQuery[]>, default: () => [] },
    /** Runs one PromQL query on the detail view's scheduler slot. */
    runQuery: {
      type: Function as PropType<
        (
          expr: string,
          signal: AbortSignal,
          opts?: { maxSeries?: number; window?: QueryWindow },
        ) => Promise<any>
      >,
      required: true,
    },
    compare: { type: Object as PropType<TileCompare | null>, default: null },
    forecast: { type: Object as PropType<TileForecast | null>, default: null },
    stepSeconds: { type: Number, default: 0 },
  },
  emits: ["update:selectedLabel", "add-filter"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();

    /** The stream the card's default query reads — `_count` for the exp fallback. */
    const valuesStream = computed(() => operandStreamsOf(props.card)[0]);

    const labels = computed(() => {
      // The exp fallback measures `_count`, whose labels can differ from the card's `_bucket`.
      const measured =
        valuesStream.value === props.card.name
          ? undefined
          : props.labelsByStream[valuesStream.value];
      const own = measured ?? props.card.labels ?? props.labelsByStream[props.card.name];
      // A label on only one side of `_sum / _count` would split half the ratio.
      const alsoOn =
        props.card.cardKind === CARD_KIND.MEAN_PAIR
          ? (props.labelsByStream[`${baseNameOf(props.card.name)}_count`] ?? [])
          : undefined;
      return breakdownLabelsOf(own, alsoOn);
    });

    /** The selected label, if the breakdown offers it: a deep link can name any label. */
    const activeLabel = computed(() =>
      props.selectedLabel && labels.value.includes(props.selectedLabel)
        ? props.selectedLabel
        : null,
    );

    /** SQL rejects a column the stream lacks (PromQL ignores the matcher), so such filters are dropped. */
    const applicableFilters = computed(() => {
      const known =
        props.labelsByStream[valuesStream.value] ??
        (valuesStream.value === props.card.name ? props.card.labels : undefined);
      return known ? props.filters.filter((f) => known.includes(String(f.label))) : props.filters;
    });

    const headLoaded = ref(false);
    const headError = ref("");
    const headCounts = ref<{ fields: string[]; hits: any[] } | null>(null);
    let headGeneration = 0;

    const headLabels = computed(() => labels.value.slice(0, BREAKDOWN_LABEL_LIMIT));

    // Counted on a request of its own, so selecting it never re-scans the labels under the cap.
    const pastCapLabel = computed(() =>
      activeLabel.value && !headLabels.value.includes(activeLabel.value) ? activeLabel.value : null,
    );
    const extraCounts = ref<{
      label: string;
      status: "loading" | "done" | "error";
      values: any[];
      error: string;
    }>({ label: "", status: "done", values: [], error: "" });
    let extraGeneration = 0;

    const fetchValues = (fields: string[]) =>
      streamService.fieldValues({
        org_identifier: store.state.selectedOrganization?.identifier,
        stream_name: valuesStream.value,
        fields,
        size: VALUES_SIZE,
        start_time: props.timeRange.start_time,
        end_time: props.timeRange.end_time,
        type: "metrics",
        query_context:
          b64EncodeUnicode(labelFiltersToSql(valuesStream.value, applicableFilters.value)) ?? "",
      });

    /** `keep`: only the window moved, so the counts shown stay up until the new ones land. */
    const loadHead = async (keep = false) => {
      const generation = ++headGeneration;
      const fields = headLabels.value;
      if (!keep || headError.value) {
        headError.value = "";
        headLoaded.value = false;
      }
      if (!fields.length) {
        headCounts.value = { fields, hits: [] };
        headLoaded.value = true;
        return;
      }
      try {
        const response = await fetchValues(fields);
        if (generation !== headGeneration) return;
        headCounts.value = { fields, hits: response?.data?.hits ?? [] };
      } catch (error: any) {
        if (generation !== headGeneration) return;
        headCounts.value = null;
        headError.value = parseSearchError(error).message;
      } finally {
        if (generation === headGeneration) headLoaded.value = true;
      }
    };

    const loadExtra = async (keep = false) => {
      const generation = ++extraGeneration;
      const label = pastCapLabel.value;
      if (!label) {
        extraCounts.value = { label: "", status: "done", values: [], error: "" };
        return;
      }
      if (!keep || extraCounts.value.status !== "done")
        extraCounts.value = { label, status: "loading", values: [], error: "" };
      try {
        const response = await fetchValues([label]);
        if (generation !== extraGeneration) return;
        const hits: any[] = response?.data?.hits ?? [];
        const values = hits.find((hit) => hit?.field === label)?.values ?? [];
        extraCounts.value = { label, status: "done", values, error: "" };
      } catch (error: any) {
        if (generation !== extraGeneration) return;
        extraCounts.value = {
          label,
          status: "error",
          values: [],
          error: parseSearchError(error).message,
        };
      }
    };

    /** Repeats only the failed request. */
    const retryCounts = () => {
      if (headError.value) loadHead();
      if (extraCounts.value.status === "error") loadExtra();
    };

    /** A window-only change keeps the shown counts, so a refresh does not blank every chart. */
    const windowOnly = (now: unknown[], before: unknown[] | undefined) =>
      !!before && now.slice(0, -1).every((value, i) => value === before[i]);

    // Sources compared one by one: a getter returning a fresh array re-fires on every card rebuild.
    const countSources = [
      valuesStream,
      () => JSON.stringify(applicableFilters.value),
      () => props.timeRange,
    ];
    watch(
      [() => headLabels.value.join(","), ...countSources],
      (now, before) => loadHead(windowOnly(now, before)),
      { immediate: true },
    );
    watch([pastCapLabel, ...countSources], (now, before) => loadExtra(windowOnly(now, before)), {
      immediate: true,
    });

    const countsFor = (label: string): LabelCounts => {
      if (label === pastCapLabel.value) {
        const extra = extraCounts.value;
        if (extra.label !== label || extra.status === "loading") return PENDING;
        return {
          ready: true,
          counted: true,
          failed: extra.status === "error",
          error: extra.error,
          values: extra.values,
        };
      }
      if (!headLabels.value.includes(label)) return UNCOUNTED;
      if (!headLoaded.value) return PENDING;
      if (headError.value)
        return { ready: true, counted: true, failed: true, error: headError.value, values: [] };
      const values = headCounts.value?.hits.find((hit) => hit?.field === label)?.values ?? [];
      return { ready: true, counted: true, failed: false, error: "", values };
    };

    const countsByLabel = computed(() =>
      Object.fromEntries(labels.value.map((label) => [label, countsFor(label)])),
    );

    // Without counts a label's cardinality is unknown, so it gets the conservative cap.
    const topkByLabel = computed<Record<string, boolean>>(() =>
      Object.fromEntries(
        Object.entries(countsByLabel.value).map(([label, c]) => [
          label,
          c.ready && (!c.counted || c.failed || c.values.length >= VALUES_SIZE),
        ]),
      ),
    );

    /**
     * The breakdown splits the function the overview charts. A heatmap holds one series, and
     * every summary function already splits by quantile, so those keep the kind's own measure.
     */
    const follows = computed(
      () =>
        !!props.variant?.queries.length &&
        props.variant.chartType !== "heatmap" &&
        props.card.cardKind !== CARD_KIND.SUMMARY_QUANTILES,
    );
    const chartType = computed(() => (follows.value ? props.variant!.chartType : "line"));
    const unit = computed(() => (follows.value ? props.variant!.unit : props.card.unit));

    /** A percentile, or one line of a several-line function, is named rather than its family. */
    const fnLabel = computed(() => {
      const queries = props.variant?.queries ?? [];
      const legend = queries[0]?.legendTemplate ?? "";
      return queries.length > 1 || /^p\d+$/.test(legend)
        ? legend
        : (props.variant?.footerLabel ?? "");
    });
    const titleOf = (label: string) =>
      follows.value
        ? t("metrics.explorer.detail.breakdown.titleFn", { fn: raw(fnLabel.value), label })
        : t(breakdownTitleKey(props.card.cardKind), { label });

    /** `panel`: at the dashboard panel's rate window rather than the tile's. */
    const queriesFor = (label: string, panel = false): TileQuery[] | null => {
      if (!countsByLabel.value[label].ready) return null;
      const topk = topkByLabel.value[label] ? { topk: TOPK } : undefined;
      // Several-line functions chart their first line: a tile is one series per label value.
      const source = follows.value
        ? (panel ? props.panelQueries : props.variant!.queries)[0]?.expr
        : undefined;
      const expr = follows.value
        ? source
          ? breakdownQueryOf(source, label, topk)
          : null
        : buildBreakdownQuery(
            props.card.cardKind,
            {
              metricName: props.card.name,
              filters: props.filters,
              rateWindow: panel ? props.panelRateWindow : props.rateWindow,
              applyNanGuard: props.nanGuard,
            },
            label,
            topk,
          );
      const stream =
        (follows.value && props.variant!.queries[0]?.builder?.metric) || props.card.name;
      return expr ? [{ expr, legendTemplate: `{${label}}`, stream }] : [];
    };

    /** `null` until the label's counts answer: only they know whether to cap at top 10. */
    const queriesByLabel = computed<Record<string, TileQuery[] | null>>(() =>
      Object.fromEntries(labels.value.map((label) => [label, queriesFor(label)])),
    );

    const distinctText = (label: string) => {
      const c = countsByLabel.value[label];
      if (!c?.ready || !c.counted || c.failed) return null;
      return c.values.length >= VALUES_SIZE
        ? t("metrics.explorer.detail.breakdown.distinctMany", { count: VALUES_SIZE - 1 })
        : t(
            "metrics.explorer.detail.breakdown.distinctCount",
            { count: c.values.length },
            c.values.length,
          );
    };

    const activeCounts = computed(() =>
      activeLabel.value ? countsByLabel.value[activeLabel.value] : PENDING,
    );
    const activeValues = computed(() =>
      activeCounts.value.values.slice(0, VALUES_SIZE - 1).map((v) => String(v?.zo_sql_key ?? "")),
    );

    /** The focused chart's fetched series: the table summarises them rather than querying again. */
    const focused = ref<{ status: string; results: any[] }>({ status: "idle", results: [] });
    const statsLoading = computed(
      () => focused.value.status === "idle" || focused.value.status === "loading",
    );
    const heatmap = computed(() => props.variant?.chartType === "heatmap");
    const heatmapCtx = (panel: boolean) => ({
      metricName: props.card.name,
      filters: props.filters,
      rateWindow: panel ? props.panelRateWindow : props.rateWindow,
    });
    /** `null` until the label's counts answer: only they know whether to cap at top 10. */
    const heatmapQueries = computed<TileQuery[] | null>(() => {
      const label = activeLabel.value;
      if (!label || !countsByLabel.value[label].ready) return null;
      const { start_time, end_time } = props.timeRange;
      const cap = topkByLabel.value[label]
        ? { topk: TOPK, windowSeconds: (end_time - start_time) / 1e6 }
        : undefined;
      const expr = buildHeatmapBreakdownQuery(heatmapCtx(false), label, cap);
      return expr ? [{ expr, legendTemplate: "{le}" }] : [];
    });
    // Bounded by value already (top 10, or under 20 values), so the explorer's series cap would only cut buckets.
    const runHeatmapQuery = (expr: string, signal: AbortSignal) =>
      props.runQuery(expr, signal, { maxSeries: Infinity });
    const heatmapStats = computed(() =>
      heatmap.value && activeLabel.value && focused.value.status === "done"
        ? heatmapStatsByValue(focused.value.results[0], activeLabel.value)
        : new Map<string, HeatmapStats>(),
    );
    const heatmapValues = computed(() => topValuesByRate(heatmapStats.value, TOPK));
    const heatmapResponses = computed(() =>
      activeLabel.value
        ? heatmapResponsesByValue(focused.value.results[0], activeLabel.value, heatmapValues.value)
        : new Map<string, any>(),
    );
    const heatmapRange = computed(() => sharedHeatmapRange([...heatmapResponses.value.values()]));
    // From the drawn cells, not cumulative rates; one for all, as it also formats the shared `le` labels.
    const heatmapDecimals = computed(() =>
      decimalsForMax(Math.max(-heatmapRange.value.min, heatmapRange.value.max)),
    );
    const o2HeatmapUnit = computed(() => toO2Unit(props.variant?.unit ?? ""));
    const bucketUnit = computed(() => props.variant?.bucketUnit ?? props.card.unit);
    const o2BucketUnit = computed(() => toO2Unit(bucketUnit.value ?? ""));

    /** The value Add to dashboard adds: a clicked row, else the busiest value. */
    const picked = ref<string | null>(null);
    watch(activeLabel, () => (picked.value = null));
    const selectedValue = computed(() =>
      picked.value !== null && heatmapValues.value.includes(picked.value)
        ? picked.value
        : (heatmapValues.value[0] ?? null),
    );
    const pickRow = (row: BreakdownRow) => {
      if (heatmapValues.value.includes(row.value)) picked.value = row.value;
    };
    const heatmapRowClass = (row: BreakdownRow) =>
      row.value === selectedValue.value ? "bg-table-row-selected-bg" : "";

    const focusedTitle = computed(() => {
      const label = activeLabel.value;
      if (!label) return "";
      return heatmap.value
        ? t("metrics.explorer.detail.breakdown.titleHeatmap", { label })
        : titleOf(label);
    });

    // Top 10 shares always sum to 100%, and a heatmap sums buckets, not one total.
    const showShare = computed(
      () =>
        !heatmap.value &&
        !!activeLabel.value &&
        !topkByLabel.value[activeLabel.value] &&
        isAdditive(queriesByLabel.value[activeLabel.value]?.[0]?.expr),
    );

    const focusedTile = ref<ComponentPublicInstance | null>(null);
    const focusedChart = (): ECharts | undefined => {
      const el = (focusedTile.value?.$el as HTMLElement | undefined)?.querySelector?.(
        '[data-test="chart-renderer"]',
      );
      return el ? getInstanceByDom(el as HTMLElement) : undefined;
    };

    /** Series colours as echarts drew them, so a row's trend matches its line. */
    const seriesColors = ref<Record<string, string>>({});
    let boundChart: ECharts | undefined;
    /** Set once the drawn chart carries this result's series; reset by a new result or theme. */
    let colorsRead = false;
    /** A value's series name as the chart draws it: an empty value keeps its `{label}` placeholder. */
    const chartNameOf = (value: string) => value || `{${activeLabel.value}}`;
    const readColors = () => {
      // "finished" fires on every render, hover highlights included; getOption copies all data.
      if (colorsRead || !boundChart) return;
      const label = activeLabel.value;
      const expected: string[] = focused.value.results.flatMap((r: any) =>
        (r?.result ?? [])
          .map((s: any) => s?.metric?.[label ?? ""])
          .filter((v: unknown) => v !== undefined)
          .map((v: unknown) => chartNameOf(String(v))),
      );
      const series: any[] = (boundChart.getOption() as any)?.series ?? [];
      const names = series.map((s) => String(s.name));
      // Still the previous result's chart: wait for the next render.
      if (!expected.length || expected.some((name) => !names.includes(name))) return;
      // Only this result's series: the chart also holds unnamed helper series echarts cannot find.
      seriesColors.value = Object.fromEntries(
        expected.map((name) => [
          name,
          String(boundChart!.getVisual({ seriesName: name }, "color")),
        ]),
      );
      colorsRead = true;
    };
    let colorFrame = 0;
    /** The chart renders after its results land, and is rebuilt on a theme switch: re-read once it draws. */
    const bindChart = (tries = 30) => {
      cancelAnimationFrame(colorFrame);
      colorFrame = requestAnimationFrame(() => {
        const chart = focusedChart();
        if (!chart) {
          if (tries > 0) bindChart(tries - 1);
          return;
        }
        if (chart !== boundChart) {
          if (boundChart && !boundChart.isDisposed()) boundChart.off("finished", readColors);
          chart.on("finished", readColors);
          boundChart = chart;
        }
        readColors();
      });
    };
    watch([focused, () => store.state.theme], () => {
      // Never show a colour read from the previous result or theme while the new one draws.
      seriesColors.value = {};
      // A heatmap's rows have no series colour, and reading one copies every cell on each render.
      colorsRead = heatmap.value;
      if (!heatmap.value) bindChart();
    });

    const highlight = (row: BreakdownRow, type: "highlight" | "downplay") => {
      if (row.avg !== null)
        focusedChart()?.dispatchAction({ type, seriesName: chartNameOf(row.value) });
    };

    const rows = computed<BreakdownRow[]>(() => {
      const label = activeLabel.value;
      const stats =
        label && focused.value.status === "done" && !heatmap.value
          ? seriesStatsByValue(focused.value.results, label)
          : new Map<string, SeriesStats>();
      const values = [...activeValues.value];
      for (const value of [...stats.keys(), ...heatmapStats.value.keys()])
        if (!values.includes(value)) values.push(value);

      const formatIn = (o2Unit: ReturnType<typeof toO2Unit>, v: number, decimals: number) =>
        formatUnitValue(getUnitValue(v, o2Unit.unit, o2Unit.unitCustom ?? "", decimals));
      const o2Unit = toO2Unit(unit.value ?? "");
      const format = (v: number, decimals: number) => formatIn(o2Unit, v, decimals);
      const total = [...stats.values()].reduce((sum, s) => sum + s.sum, 0);

      const ranked = values.map((value) => {
        const s = stats.get(value);
        const h = heatmapStats.value.get(value);
        const quantile = (p: number | null | undefined) =>
          h && typeof p === "number"
            ? formatIn(o2BucketUnit.value, p, decimalsForMax(Math.abs(p)))
            : null;
        return {
          value,
          rank: h?.rate ?? s?.avg ?? -Infinity,
          avg: s ? format(s.avg, s.decimals) : null,
          latest: s ? format(s.latest, s.decimals) : null,
          share: s && total > 0 ? `${((s.sum / total) * 100).toFixed(1)}%` : null,
          rate: h ? formatIn(o2HeatmapUnit.value, h.rate, h.rateDecimals) : null,
          p50: quantile(h?.p50),
          p90: quantile(h?.p90),
          p99: quantile(h?.p99),
          trend: s ? trendOf(s.points) : null,
          color: seriesColors.value[chartNameOf(value)] ?? null,
        };
      });
      // Stable: values without a series keep their count order, after the rest.
      ranked.sort((a, b) => b.rank - a.rank);
      return ranked.map(({ rank: _rank, ...row }) => row);
    });

    const columns = computed<OTableColumnDef<BreakdownRow>[]>(() => [
      {
        id: "value",
        header: t("metrics.explorer.detail.breakdown.colValue"),
        accessorKey: "value",
        meta: { autoWidth: true, fillRemaining: true },
      },
      ...(heatmap.value
        ? [
            {
              id: "rate",
              header: t("metrics.explorer.detail.breakdown.colRate"),
              size: 112,
              meta: { align: "right" },
            },
            ...(
              [
                ["p50", t("metrics.explorer.detail.breakdown.colP50")],
                ["p90", t("metrics.explorer.detail.breakdown.colP90")],
                ["p99", t("metrics.explorer.detail.breakdown.colP99")],
              ] as const
            ).map(([id, header]) => ({ id, header, size: 96, meta: { align: "right" } })),
          ]
        : [
            { id: "trend", header: t("metrics.explorer.detail.breakdown.colTrend"), size: 128 },
            {
              id: "avg",
              header: t("metrics.explorer.detail.breakdown.colAvg"),
              size: 112,
              meta: { align: "right" },
            },
            {
              id: "latest",
              header: t("metrics.explorer.detail.breakdown.colLatest"),
              size: 112,
              meta: { align: "right" },
            },
          ]),
      ...(showShare.value
        ? [
            {
              id: "share",
              header: t("metrics.explorer.detail.breakdown.colShare"),
              size: 80,
              meta: { align: "right" },
            },
          ]
        : []),
      { id: "actions", header: raw(""), size: 72, isAction: true },
    ]);

    const select = (label: string) => emit("update:selectedLabel", label);

    const dashboardDialogOpen = ref(false);
    const dashboardPanel = ref<{ data: Record<string, any> }>({ data: {} });
    const dashboardPanelTitle = ref("");

    const openHeatmapToDashboard = (label: string) => {
      const value = selectedValue.value;
      const expr = value === null ? null : buildHeatmapValueQuery(heatmapCtx(true), label, value);
      if (value === null || !expr) return;
      const data = buildPanelDataForCard(
        props.card,
        {
          queries: [{ expr, legendTemplate: "{le}" }],
          chartType: "heatmap",
          unit: props.variant!.unit,
        },
        bucketUnit.value,
      );
      data.config.decimals = heatmapDecimals.value;
      dashboardPanel.value = { data };
      dashboardPanelTitle.value = t("metrics.explorer.detail.breakdown.panelTitle", {
        title: t("metrics.explorer.detail.breakdown.titleHeatmapValue", { label, value }),
        metric: props.card.name,
      });
      dashboardDialogOpen.value = true;
    };

    /** The focused chart as a panel: its queries, filters and topk cap included. */
    const openAddToDashboard = () => {
      const label = activeLabel.value;
      if (label && heatmap.value) return openHeatmapToDashboard(label);
      // Not the tile's window, which would freeze the panel at this range.
      const queries = label ? queriesFor(label, true) : null;
      if (!label || !queries?.length) return;
      const data = buildPanelDataForCard(props.card, {
        queries,
        chartType: chartType.value,
        unit: unit.value,
      });
      // The tile sizes its decimals to the values it drew; the panel would otherwise round them to 2.
      data.config.decimals = adaptiveDecimals(focused.value.results);
      dashboardPanel.value = { data };
      dashboardPanelTitle.value = t("metrics.explorer.detail.breakdown.panelTitle", {
        title: titleOf(label),
        metric: props.card.name,
      });
      dashboardDialogOpen.value = true;
    };

    const addFilter = (label: string, value: string, operator: "=" | "!=") =>
      emit("add-filter", { label: raw(label), operator, value });

    onBeforeUnmount(() => {
      headGeneration += 1;
      extraGeneration += 1;
      cancelAnimationFrame(colorFrame);
      if (boundChart && !boundChart.isDisposed()) boundChart.off("finished", readColors);
    });

    return {
      t,
      raw,
      titleOf,
      focusedTitle,
      heatmap,
      heatmapQueries,
      runHeatmapQuery,
      heatmapStats,
      heatmapValues,
      heatmapResponses,
      heatmapRange,
      heatmapDecimals,
      o2HeatmapUnit,
      o2BucketUnit,
      selectedValue,
      pickRow,
      heatmapRowClass,
      chartType,
      unit,
      TOPK,
      labels,
      activeLabel,
      headError,
      retryCounts,
      topkByLabel,
      queriesByLabel,
      distinctText,
      activeCounts,
      ABSENT,
      STAT_COLUMNS,
      focused,
      focusedTile,
      statsLoading,
      rows,
      columns,
      highlight,
      select,
      addFilter,
      dashboardDialogOpen,
      dashboardPanel,
      dashboardPanelTitle,
      openAddToDashboard,
    };
  },
});
</script>
