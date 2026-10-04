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
        class="h-60"
        :queries="queriesByLabel[activeLabel]"
        :unit="card.unit"
        :color="color"
        :time-range="timeRange"
        :run-query="runQuery"
        legend
        data-test="metrics-breakdown-chart"
        @results="focused = $event"
      >
        <template #header>
          <span class="truncate">{{
            t(breakdownTitleKey(card.cardKind), { label: activeLabel })
          }}</span>
          <OTag
            v-if="topkByLabel[activeLabel]"
            variant="default-outline"
            size="sm"
            class="shrink-0"
            data-test="metrics-breakdown-topk"
            >{{ t("metrics.explorer.detail.breakdown.topk", { count: TOPK }) }}</OTag
          >
          <div class="flex-1" />
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="dashboard-customize"
            class="shrink-0"
            :disabled="!queriesByLabel[activeLabel]?.length"
            :aria-label="t('metrics.explorer.detail.breakdown.addToDashboard')"
            data-test="metrics-breakdown-add-to-dashboard"
            @click.stop="openAddToDashboard"
          >
            <OTooltip :content="t('metrics.explorer.detail.breakdown.addToDashboard')" />
          </OButton>
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
            data-test="metrics-breakdown-table"
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
          :unit="card.unit"
          :color="color"
          :time-range="timeRange"
          :run-query="runQuery"
          :data-test="`metrics-breakdown-card-${label}`"
          @select="select(label)"
        >
          <template #header>
            <span class="min-w-0 truncate font-mono" :title="label">{{ label }}</span>
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
              class="shrink-0"
              :aria-label="t('metrics.explorer.detail.breakdown.selectAria', { label })"
              :data-test="`metrics-breakdown-select-${label}`"
              @click.stop="select(label)"
            >
              {{ t("metrics.explorer.detail.breakdown.select") }}
            </OButton>
          </template>
        </MetricChartTile>
      </div>
    </template>

    <AddToDashboard
      v-model:open="dashboardDialogOpen"
      :dashboard-panel-data="dashboardPanel"
      :default-panel-title="dashboardPanelTitle"
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
import MetricChartTile, { type TileQuery } from "./MetricChartTile.vue";
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
  CARD_KIND,
  PANEL_RATE_WINDOW,
  toO2Unit,
} from "@/utils/metrics/metricDefaults";
import { adaptiveDecimals, seriesStatsByValue } from "@/utils/metrics/breakdownStats";
import { operandStreamsOf, type MetricCard as MetricCardModel } from "@/utils/metrics/metricFamily";
import { labelFiltersToSql } from "@/utils/metrics/labelFilterSql";
import { buildPanelDataForCard } from "@/utils/metrics/metricsHandoff";
import type { LabelFilter } from "@/composables/metrics/useMetricsExplorerGrid";

/** 21, not 20: a 21st value is how "more than 20" is known. */
const VALUES_SIZE = 21;
/** Series kept for a label with "20+" values — beyond it the chart is a smear. */
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

/** Measures whose values add up, so one value's share of their sum means something. */
const ADDITIVE_KINDS = [CARD_KIND.COUNTER_RATE, CARD_KIND.EXP_HISTOGRAM_FALLBACK, CARD_KIND.INFO];

const STAT_COLUMNS = ["avg", "latest", "share"] as const;

const ABSENT = raw("—");

interface BreakdownRow {
  value: string;
  /** Formatted like the chart's y-axis; `null` when the value has no series. */
  avg: string | null;
  latest: string | null;
  share: string | null;
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
    panelRateWindow: { type: String, default: PANEL_RATE_WINDOW },
    /** The card's own query needed the NaN guard. */
    nanGuard: { type: Boolean, default: false },
    color: { type: String, required: true },
    /** Runs one PromQL query on the detail view's scheduler slot. */
    runQuery: {
      type: Function as PropType<(expr: string, signal: AbortSignal) => Promise<any>>,
      required: true,
    },
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

    const queriesFor = (label: string, rateWindow = props.rateWindow): TileQuery[] | null => {
      if (!countsByLabel.value[label].ready) return null;
      const expr = buildBreakdownQuery(
        props.card.cardKind,
        {
          metricName: props.card.name,
          filters: props.filters,
          rateWindow,
          applyNanGuard: props.nanGuard,
        },
        label,
        topkByLabel.value[label] ? { topk: TOPK } : undefined,
      );
      return expr ? [{ expr, legendTemplate: `{${label}}` }] : [];
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
    // A topk-capped chart holds only the top 10, whose shares would always sum to 100%.
    const showShare = computed(
      () =>
        ADDITIVE_KINDS.includes(props.card.cardKind) &&
        !(activeLabel.value && topkByLabel.value[activeLabel.value]),
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
      colorsRead = false;
      bindChart();
    });

    const highlight = (row: BreakdownRow, type: "highlight" | "downplay") => {
      if (row.avg !== null)
        focusedChart()?.dispatchAction({ type, seriesName: chartNameOf(row.value) });
    };

    const rows = computed<BreakdownRow[]>(() => {
      const label = activeLabel.value;
      const stats =
        label && focused.value.status === "done"
          ? seriesStatsByValue(focused.value.results, label)
          : new Map();
      const values = [...activeValues.value];
      for (const value of stats.keys()) if (!values.includes(value)) values.push(value);

      const unit = toO2Unit(props.card.unit ?? "");
      const format = (v: number, decimals: number) =>
        formatUnitValue(getUnitValue(v, unit.unit, unit.unitCustom ?? "", decimals));
      const total = [...stats.values()].reduce((sum, s) => sum + s.sum, 0);

      const ranked = values.map((value) => {
        const s = stats.get(value);
        return {
          value,
          rank: s?.avg ?? -Infinity,
          avg: s ? format(s.avg, s.decimals) : null,
          latest: s ? format(s.latest, s.decimals) : null,
          share: s && total > 0 ? `${((s.sum / total) * 100).toFixed(1)}%` : null,
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

    /** The focused chart as a panel: its queries, filters and topk cap included. */
    const openAddToDashboard = () => {
      const label = activeLabel.value;
      // Not the tile's window, which would freeze the panel at this range.
      const queries = label ? queriesFor(label, props.panelRateWindow) : null;
      if (!label || !queries?.length) return;
      const data = buildPanelDataForCard(props.card, { queries, chartType: "line" });
      // The tile sizes its decimals to the values it drew; the panel would otherwise round them to 2.
      data.config.decimals = adaptiveDecimals(focused.value.results);
      dashboardPanel.value = { data };
      dashboardPanelTitle.value = t("metrics.explorer.detail.breakdown.panelTitle", {
        title: t(breakdownTitleKey(props.card.cardKind), { label }),
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
      breakdownTitleKey,
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
