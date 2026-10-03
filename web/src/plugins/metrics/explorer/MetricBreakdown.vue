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
  The detail view's Breakdown tab: "which pod / instance / route is it?"

  Step 1 is a table of the metric's labels, each with its top values and how
  many distinct values it has — one field-values request, scoped to the active
  filters. Step 2: selecting a row charts the card's measure grouped by that
  label. One chart at a time; the table already ranks the labels.
-->
<template>
  <div class="flex min-h-0 flex-col gap-3" data-test="metrics-breakdown">
    <section
      v-if="activeLabel"
      class="border-border-default rounded-surface flex flex-col border"
      data-test="metrics-breakdown-chart"
    >
      <div class="flex items-center gap-2 px-3 pt-2">
        <span class="text-text-heading truncate text-sm font-medium">
          {{ t("metrics.explorer.detail.breakdown.chartTitle", { label: activeLabel }) }}
        </span>
        <OTag
          v-if="topkApplied"
          variant="default-outline"
          size="sm"
          class="shrink-0"
          data-test="metrics-breakdown-topk"
          >{{ t("metrics.explorer.detail.breakdown.topk", { count: TOPK }) }}</OTag
        >
      </div>

      <div class="relative h-60">
        <div
          v-if="chart.status === 'error'"
          class="text-text-secondary flex h-full flex-col items-center justify-center gap-1 text-xs"
          :title="chart.error"
          data-test="metrics-breakdown-chart-error"
        >
          <OIcon name="error" size="sm" class="text-error-600" />
          <span>{{ t("metrics.explorer.queryFailed") }}</span>
          <OButton variant="ghost-primary" size="xs" @click="loadChart">
            {{ t("metrics.explorer.retry") }}
          </OButton>
        </div>

        <div
          v-else-if="chart.status === 'done' && !chartHasSamples"
          class="text-text-secondary flex h-full items-center justify-center text-xs"
          data-test="metrics-breakdown-chart-nodata"
        >
          {{ t("metrics.explorer.noData") }}
        </div>

        <MetricCardChart
          v-else-if="chart.status === 'done'"
          :results="chart.results"
          :queries="chartQueries"
          chart-type="line"
          :unit="o2Unit.unit"
          :unit-custom="o2Unit.unitCustom ?? undefined"
          :color="color"
          @error="onRenderError"
        />

        <OSkeleton v-else class="h-full" animation="wave" />
      </div>
    </section>

    <p v-else-if="labels.length" class="text-text-secondary text-xs">
      {{ t("metrics.explorer.detail.breakdown.selectHint") }}
    </p>

    <OEmptyState
      v-if="!labels.length"
      size="inline"
      icon="label"
      :title="t('metrics.explorer.detail.breakdown.noLabels')"
      data-test="metrics-breakdown-no-labels"
    />

    <!-- Scrolls sideways inside its own box on a phone, never the page. -->
    <div v-else class="min-w-0 overflow-x-auto" data-test="metrics-breakdown-table">
      <OTable
        :data="rows"
        :columns="columns"
        row-key="label"
        pagination="none"
        sorting="none"
        :show-global-filter="false"
        :fill-height="false"
        horizontal-scroll
        :loading="tableLoading"
        :error="tableError || null"
        :row-class="rowClass"
        @row-click="(row: BreakdownRow) => $emit('update:selectedLabel', row.label)"
      >
        <template #cell-label="{ row }">
          <span
            class="font-mono text-xs"
            :class="row.label === selectedLabel ? 'text-text-heading font-semibold' : ''"
            >{{ row.label }}</span
          >
        </template>

        <template #cell-values="{ row }">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              v-for="entry in row.top"
              :key="entry.value"
              class="inline-flex items-center gap-1"
              :data-test="`metrics-breakdown-value-${row.label}-${entry.value}`"
            >
              <span class="text-text-body font-mono text-xs">{{ entry.value }}</span>
              <span class="text-text-secondary text-2xs tabular-nums">{{
                t(
                  "metrics.explorer.detail.breakdown.samples",
                  { count: entry.count.toLocaleString() },
                  entry.count,
                )
              }}</span>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="add-circle-outline"
                :aria-label="
                  t('metrics.explorer.detail.breakdown.addToFilterAria', {
                    label: row.label,
                    value: entry.value,
                  })
                "
                :data-test="`metrics-breakdown-add-${row.label}-${entry.value}`"
                @click.stop="addFilter(row.label, entry.value, '=')"
              >
                <OTooltip :content="t('metrics.explorer.detail.breakdown.addToFilter')" />
              </OButton>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="block"
                :aria-label="
                  t('metrics.explorer.detail.breakdown.excludeAria', {
                    label: row.label,
                    value: entry.value,
                  })
                "
                :data-test="`metrics-breakdown-exclude-${row.label}-${entry.value}`"
                @click.stop="addFilter(row.label, entry.value, '!=')"
              >
                <OTooltip :content="t('metrics.explorer.detail.breakdown.exclude')" />
              </OButton>
            </span>
          </div>
        </template>

        <template #cell-distinct="{ row }">
          <span
            class="text-xs tabular-nums"
            :data-test="`metrics-breakdown-distinct-${row.label}`"
            >{{ distinctLabel(row) }}</span
          >
        </template>
      </OTable>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, ref, watch, type PropType } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import MetricCardChart from "./MetricCardChart.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import streamService from "@/services/stream";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { parseSearchError } from "@/utils/query/searchError";
import {
  baseNameOf,
  breakdownLabelsOf,
  buildBreakdownQuery,
  CARD_KIND,
  toO2Unit,
} from "@/utils/metrics/metricDefaults";
import { operandStreamsOf, type MetricCard as MetricCardModel } from "@/utils/metrics/metricFamily";
import { labelFiltersToSql } from "@/utils/metrics/labelFilterSql";
import { isCancelled } from "@/composables/metrics/useMetricsPreviewQueue";
import { hasSamples, type LabelFilter } from "@/composables/metrics/useMetricsExplorerGrid";

/** 21, not 20: a 21st value is how "more than 20" is known. */
const VALUES_SIZE = 21;
/** Values shown per label. */
const TOP_VALUES = 5;
/** Series kept for a label with "20+" values — beyond it the chart is a smear. */
const TOPK = 10;

interface BreakdownRow {
  label: string;
  top: Array<{ value: string; count: number }>;
  distinct: number;
  /** The endpoint hit its cap: there are more than `VALUES_SIZE - 1` values. */
  more: boolean;
}

interface ChartState {
  status: "idle" | "loading" | "done" | "error";
  results: any[];
  error: string;
  expr: string;
}

const IDLE: ChartState = { status: "idle", results: [], error: "", expr: "" };

export default defineComponent({
  name: "MetricBreakdown",
  components: { MetricCardChart, OButton, OIcon, OTag, OTable, OEmptyState, OSkeleton, OTooltip },
  props: {
    card: { type: Object as PropType<MetricCardModel>, required: true },
    labelsByStream: { type: Object as PropType<Record<string, string[]>>, required: true },
    /** The page's label filters — global, as on the grid. */
    filters: { type: Array as PropType<LabelFilter[]>, required: true },
    /** The Explorer's window, µs. */
    timeRange: {
      type: Object as PropType<{ start_time: number; end_time: number }>,
      required: true,
    },
    selectedLabel: { type: String as PropType<string | null>, default: null },
    /** The card's concrete rate window, so the breakdown measures like the card. */
    rateWindow: { type: String, required: true },
    /** The card's own query needed the NaN guard. */
    nanGuard: { type: Boolean, default: false },
    color: { type: String, required: true },
    /** Runs one PromQL query on the detail view's scheduler slot. */
    runQuery: { type: Function as PropType<(expr: string) => Promise<any>>, required: true },
    cancelQueries: { type: Function as PropType<(exprs: string[]) => void>, required: true },
  },
  emits: ["update:selectedLabel", "add-filter"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();

    /** The stream the card's default query reads — `_count` for the exp fallback. */
    const valuesStream = computed(() => operandStreamsOf(props.card)[0]);

    const labels = computed(() => {
      const own = props.card.labels ?? props.labelsByStream[props.card.name];
      // A mean pair divides `_sum` by `_count`: a label only one side carries
      // would split one side of the ratio.
      const alsoOn =
        props.card.cardKind === CARD_KIND.MEAN_PAIR
          ? (props.labelsByStream[`${baseNameOf(props.card.name)}_count`] ?? [])
          : undefined;
      return breakdownLabelsOf(own, alsoOn);
    });

    /** The selected label, if the table offers it: a deep link can name any label. */
    const activeLabel = computed(() =>
      props.selectedLabel && labels.value.includes(props.selectedLabel)
        ? props.selectedLabel
        : null,
    );

    /**
     * Filters the values stream can answer. PromQL ignores a matcher on a label
     * the stream lacks; SQL would reject the column, so it is left out here too.
     */
    const applicableFilters = computed(() => {
      const known =
        props.labelsByStream[valuesStream.value] ??
        (valuesStream.value === props.card.name ? props.card.labels : undefined);
      return known ? props.filters.filter((f) => known.includes(String(f.label))) : props.filters;
    });

    /* ----------------------------------------------------------- table */

    const rows = ref<BreakdownRow[]>([]);
    const tableLoading = ref(false);
    const tableLoaded = ref(false);
    const tableError = ref("");
    let tableGeneration = 0;

    const loadTable = async () => {
      const generation = ++tableGeneration;
      const fields = labels.value;
      tableError.value = "";
      tableLoaded.value = false;
      if (!fields.length) {
        rows.value = [];
        tableLoaded.value = true;
        return;
      }
      tableLoading.value = true;
      try {
        const response = await streamService.fieldValues({
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
        if (generation !== tableGeneration) return;
        const hits: any[] = response?.data?.hits ?? [];
        rows.value = fields.map((label) => {
          const values: any[] = hits.find((hit) => hit?.field === label)?.values ?? [];
          return {
            label,
            top: values.slice(0, TOP_VALUES).map((v) => ({
              value: String(v?.zo_sql_key ?? ""),
              count: Number(v?.zo_sql_num ?? 0),
            })),
            distinct: values.length,
            more: values.length >= VALUES_SIZE,
          };
        });
      } catch (error: any) {
        if (generation !== tableGeneration) return;
        rows.value = [];
        tableError.value = parseSearchError(error).message;
      } finally {
        if (generation === tableGeneration) {
          tableLoading.value = false;
          tableLoaded.value = true;
        }
      }
    };

    watch(
      () => [
        valuesStream.value,
        labels.value.join(","),
        JSON.stringify(applicableFilters.value),
        props.timeRange.start_time,
        props.timeRange.end_time,
      ],
      loadTable,
      { immediate: true },
    );

    const columns = computed<OTableColumnDef<BreakdownRow>[]>(() => [
      { id: "label", header: t("metrics.explorer.detail.breakdown.label"), size: 180 },
      { id: "values", header: t("metrics.explorer.detail.breakdown.topValues"), size: 560 },
      {
        id: "distinct",
        header: t("metrics.explorer.detail.breakdown.distinct"),
        size: 120,
        meta: { align: "right" },
      },
    ]);

    const distinctLabel = (row: BreakdownRow) =>
      row.more
        ? t("metrics.explorer.detail.breakdown.distinctMany", { count: VALUES_SIZE - 1 })
        : raw(String(row.distinct));

    const rowClass = (row: BreakdownRow) =>
      row.label === activeLabel.value ? "bg-accent/10 cursor-pointer" : "cursor-pointer";

    const addFilter = (label: string, value: string, operator: "=" | "!=") =>
      emit("add-filter", { label: raw(label), operator, value });

    /* ----------------------------------------------------------- chart */

    const selectedRow = computed(
      () => rows.value.find((row) => row.label === activeLabel.value) ?? null,
    );
    const topkApplied = computed(() => !!selectedRow.value?.more);

    /** Built once the table has answered: only it knows whether to cap at top 10. */
    const chartExpr = computed(() => {
      if (!activeLabel.value || !tableLoaded.value) return null;
      return buildBreakdownQuery(
        props.card.cardKind,
        {
          metricName: props.card.name,
          filters: props.filters,
          rateWindow: props.rateWindow,
          applyNanGuard: props.nanGuard,
        },
        activeLabel.value,
        topkApplied.value ? { topk: TOPK } : undefined,
      );
    });

    const chartQueries = computed(() => [
      { expr: chart.value.expr, legendTemplate: `{${activeLabel.value ?? ""}}` },
    ]);
    const o2Unit = computed(() => toO2Unit(props.card.unit));

    const chart = ref<ChartState>(IDLE);
    const chartHasSamples = computed(() => chart.value.results.some(hasSamples));

    /** Bumped per load, so a superseded label's late result never lands. */
    let chartGeneration = 0;
    let activeExpr: string | null = null;

    const cancelActive = () => {
      if (activeExpr) props.cancelQueries([activeExpr]);
      activeExpr = null;
    };

    const loadChart = async () => {
      const generation = ++chartGeneration;
      cancelActive();
      const expr = chartExpr.value;
      if (!expr) {
        chart.value = IDLE;
        return;
      }
      activeExpr = expr;
      chart.value = { status: "loading", results: [], error: "", expr };
      try {
        const result = await props.runQuery(expr);
        if (generation !== chartGeneration) return;
        chart.value = { status: "done", results: [result], error: "", expr };
      } catch (error: any) {
        if (generation !== chartGeneration || isCancelled(error)) return;
        chart.value = {
          status: "error",
          results: [],
          error: parseSearchError(error).message,
          expr,
        };
      }
    };

    watch(
      () => [chartExpr.value, props.timeRange.start_time, props.timeRange.end_time],
      loadChart,
      { immediate: true },
    );

    const onRenderError = (error: any) => {
      chart.value = {
        ...chart.value,
        status: "error",
        results: [],
        error: String(error || t("metrics.functionConfigDialog.failedToRenderChart")),
      };
    };

    onBeforeUnmount(() => {
      tableGeneration += 1;
      chartGeneration += 1;
      cancelActive();
    });

    return {
      t,
      TOPK,
      labels,
      activeLabel,
      rows,
      columns,
      tableLoading,
      tableError,
      distinctLabel,
      rowClass,
      addFilter,
      topkApplied,
      chart,
      chartQueries,
      chartHasSamples,
      o2Unit,
      loadChart,
      onRenderError,
    };
  },
});
</script>
