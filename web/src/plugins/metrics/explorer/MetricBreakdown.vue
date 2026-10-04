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
    <section
      v-if="activeLabel"
      class="border-border-default rounded-surface flex flex-col border"
      data-test="metrics-breakdown-chart"
    >
      <div class="flex items-center gap-2 px-3 pt-2">
        <span class="text-text-heading truncate text-sm font-medium">
          {{ t(breakdownTitleKey(card.cardKind), { label: activeLabel }) }}
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
          :time-range="timeRange"
          legend
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
        :error="tableError || extraCounts.error || null"
        :row-class="rowClass"
        @pagination-change="retryCounts"
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
          <span v-if="!row.counted" class="text-text-secondary text-xs">{{
            t("metrics.explorer.detail.breakdown.notCounted")
          }}</span>
          <div v-else class="flex flex-wrap items-center gap-x-3 gap-y-1">
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
  BREAKDOWN_LABEL_LIMIT,
  breakdownTitleKey,
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
const TOP_VALUES = 5;
/** Series kept for a label with "20+" values — beyond it the chart is a smear. */
const TOPK = 10;

interface BreakdownRow {
  label: string;
  top: Array<{ value: string; count: number }>;
  distinct: number;
  /** The endpoint hit its cap: there are more than `VALUES_SIZE - 1` values. */
  more: boolean;
  /** Its values were requested; past `BREAKDOWN_LABEL_LIMIT` only the selected label's are. */
  counted: boolean;
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

    /** The selected label, if the table offers it: a deep link can name any label. */
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

    const tableLoading = ref(false);
    const tableLoaded = ref(false);
    const tableError = ref("");
    const headCounts = ref<{ fields: string[]; hits: any[] } | null>(null);
    let tableGeneration = 0;

    const headLabels = computed(() => labels.value.slice(0, BREAKDOWN_LABEL_LIMIT));

    // Counted on a request of its own, so selecting it never re-scans the labels under the cap.
    const pastCapLabel = computed(() =>
      activeLabel.value && !headLabels.value.includes(activeLabel.value) ? activeLabel.value : null,
    );
    const extraCounts = ref<{
      label: string;
      status: "loading" | "done" | "error";
      values: any[];
      error?: string;
    }>({ label: "", status: "done", values: [] });
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

    const loadTable = async () => {
      const generation = ++tableGeneration;
      const fields = headLabels.value;
      tableError.value = "";
      tableLoaded.value = false;
      if (!fields.length) {
        headCounts.value = { fields, hits: [] };
        tableLoaded.value = true;
        return;
      }
      tableLoading.value = true;
      try {
        const response = await fetchValues(fields);
        if (generation !== tableGeneration) return;
        headCounts.value = { fields, hits: response?.data?.hits ?? [] };
      } catch (error: any) {
        if (generation !== tableGeneration) return;
        headCounts.value = null;
        tableError.value = parseSearchError(error).message;
      } finally {
        if (generation === tableGeneration) {
          tableLoading.value = false;
          tableLoaded.value = true;
        }
      }
    };

    const loadExtra = async () => {
      const generation = ++extraGeneration;
      const label = pastCapLabel.value;
      if (!label) {
        extraCounts.value = { label: "", status: "done", values: [] };
        return;
      }
      extraCounts.value = { label, status: "loading", values: [] };
      try {
        const response = await fetchValues([label]);
        if (generation !== extraGeneration) return;
        const hits: any[] = response?.data?.hits ?? [];
        const values = hits.find((hit) => hit?.field === label)?.values ?? [];
        extraCounts.value = { label, status: "done", values };
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

    // OTable's error banner retries through `pagination-change`; only the failed request is repeated.
    const retryCounts = () => {
      if (tableError.value) loadTable();
      if (extraCounts.value.status === "error") loadExtra();
    };

    // Sources compared one by one: a getter returning a fresh array re-fires on every card rebuild.
    const countSources = [
      valuesStream,
      () => JSON.stringify(applicableFilters.value),
      () => props.timeRange,
    ];
    watch([() => headLabels.value.join(","), ...countSources], loadTable, { immediate: true });
    watch([pastCapLabel, ...countSources], loadExtra, { immediate: true });

    const toRow = (label: string, values: any[], counted: boolean): BreakdownRow => ({
      label,
      top: values.slice(0, TOP_VALUES).map((v) => ({
        value: String(v?.zo_sql_key ?? ""),
        count: Number(v?.zo_sql_num ?? 0),
      })),
      distinct: values.length,
      more: values.length >= VALUES_SIZE,
      counted,
    });

    // Built from the full label list, so a label past the cap appears without a re-scan.
    const rows = computed<BreakdownRow[]>(() => {
      const head = headCounts.value;
      if (!head) return [];
      const extra = extraCounts.value;
      return labels.value.map((label) => {
        if (extra.label === label && extra.status === "done")
          return toRow(label, extra.values, true);
        const values = head.hits.find((hit) => hit?.field === label)?.values ?? [];
        return toRow(label, values, head.fields.includes(label));
      });
    });

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
      !row.counted
        ? raw("–")
        : row.more
          ? t("metrics.explorer.detail.breakdown.distinctMany", { count: VALUES_SIZE - 1 })
          : raw(String(row.distinct));

    const rowClass = (row: BreakdownRow) =>
      row.label === activeLabel.value ? "bg-accent/10 cursor-pointer" : "cursor-pointer";

    const addFilter = (label: string, value: string, operator: "=" | "!=") =>
      emit("add-filter", { label: raw(label), operator, value });

    const selectedRow = computed(
      () => rows.value.find((row) => row.label === activeLabel.value) ?? null,
    );
    /** The selected label's counts, from whichever request carries them, so the chart waits on that one only. */
    const selectedCounts = computed(() => {
      const extra = extraCounts.value;
      if (!pastCapLabel.value) {
        return {
          ready: tableLoaded.value,
          failed: !!tableError.value,
          more: !!selectedRow.value?.more,
        };
      }
      return {
        ready: extra.label === pastCapLabel.value && extra.status !== "loading",
        failed: extra.status === "error",
        more: extra.values.length >= VALUES_SIZE,
      };
    });
    // Without counts a label's cardinality is unknown, so it gets the conservative cap.
    const topkApplied = computed(() => selectedCounts.value.more || selectedCounts.value.failed);

    /** Built once the selected label's counts have answered: only they know whether to cap at top 10. */
    const chartExpr = computed(() => {
      if (!activeLabel.value || !selectedCounts.value.ready) return null;
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

    watch([chartExpr, () => props.timeRange], loadChart, { immediate: true });

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
      extraGeneration += 1;
      chartGeneration += 1;
      cancelActive();
    });

    return {
      t,
      breakdownTitleKey,
      TOPK,
      labels,
      activeLabel,
      rows,
      columns,
      tableLoading,
      tableError,
      extraCounts,
      retryCounts,
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
