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
  <div
    ref="chartPanelRef"
    class="relative flex h-full flex-col"
    :class="rangeTarget === undefined && 'border-border-default border'"
  >
    <Teleport v-if="rangeTarget !== null" :to="rangeTarget ?? 'body'" :disabled="!rangeTarget">
      <div :class="rangeTarget ? 'contents' : 'flex shrink-0 justify-end px-2 pt-2'">
        <OToggleGroup
          :model-value="shownRange"
          :aria-label="t('alerts.form.preview.range')"
          data-test="alert-preview-range"
          @update:model-value="onRangePick"
        >
          <OToggleGroupItem
            v-for="option in previewRangeOptions"
            :key="option.value"
            :value="option.value"
            size="xs"
            :tooltip="option.tooltip"
            :aria-label="option.tooltip"
            :data-test="`alert-preview-range-${option.value}`"
          >
            {{ option.label }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>
    </Teleport>
    <OTruncatedText
      v-if="showChartKey && chartCaption && !testOpen"
      :lines="3"
      class="text-text-secondary shrink-0 px-4 pt-1 text-xs wrap-anywhere"
      data-test="alert-preview-caption"
      >{{ chartCaption }}</OTruncatedText
    >
    <!-- Under Test it the chart stays mounted, out of the flow: a PromQL preview runs only from its watchers. -->
    <div
      data-test="alert-preview-chart"
      class="preview-alert-chart isolate min-h-0 flex-1 px-4"
      :class="[
        showChartKey ? 'pb-1' : 'pb-4',
        testOpen ? 'invisible absolute inset-0' : 'relative',
      ]"
      :aria-hidden="testOpen || undefined"
    >
      <!-- Empty query placeholder -->
      <div v-if="awaitsQuery" class="flex h-full flex-col items-center justify-center gap-2">
        <OIcon name="edit" size="xl" class="opacity-20" />
        <span class="text-text-secondary text-sm">{{ awaitsQueryText }}</span>
      </div>
      <PanelSchemaRenderer
        ref="panelRendererRef"
        v-else-if="chartData"
        :height="5"
        :width="5"
        :panelSchema="chartData"
        :selectedTimeObj="selectedTimeObj"
        :variablesData="{}"
        :searchType="searchTypeForPanel"
        :is_ui_histogram="shouldUseHistogram"
        @result-metadata-update="handleChartDataUpdate"
        @series-data-update="onSeriesData"
        @error="onPreviewError"
        @loading-state-change="onPreviewLoading"
      />
      <OEmptyState
        v-if="!awaitsQuery && !shownChartError && emptyChartText"
        class="bg-surface-base absolute! inset-0 h-full min-h-0! w-full"
        size="inline"
        icon="bar-chart"
        :title="t('panel.noData')"
        :description="emptyChartText"
        :backdrop="false"
        data-test="alert-preview-no-series"
      />
      <QueryErrorState
        v-if="!awaitsQuery && shownChartError"
        class="bg-surface-base absolute inset-0 overflow-y-auto"
        size="block"
        :error-msg="shownChartError.message"
        :title="shownChartError.title"
        :query="query"
      >
        <template #actions />
      </QueryErrorState>
    </div>
    <div
      v-if="showChartKey && !testOpen"
      class="text-text-secondary flex min-h-5 shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 px-4 pb-1 text-xs"
      data-test="alert-preview-key"
    >
      <span
        v-for="limit in limitKeys"
        :key="limit.level"
        class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
        :data-test="
          limit.level === 'critical' ? 'alert-preview-limit-key' : 'alert-preview-warning-key'
        "
      >
        <span
          aria-hidden="true"
          class="w-4 border-t-2 border-dashed"
          :class="
            limit.level === 'critical' ? 'border-status-error-text' : 'border-status-warning-text'
          "
        />
        {{ limit.label }}
      </span>
      <span class="ms-auto flex min-w-0 items-center gap-3">
        <OTruncatedText
          v-if="seriesCountText"
          class="min-w-0"
          data-test="alert-preview-series-count"
        >
          {{ seriesCountText }}
        </OTruncatedText>
        <span
          v-if="testable && testGapText"
          :id="testGapId"
          class="shrink-0"
          data-test="alert-preview-test-it-reason"
          >{{ testGapText }}</span
        >
        <OButton
          v-if="testable"
          ref="testItButton"
          variant="link"
          size="xs"
          class="shrink-0"
          :disabled="!!testGap"
          :focusable-unavailable="!!testGap"
          :description-id="testGapId"
          :loading="testRun.state.value === 'running'"
          data-test="alert-preview-test-it"
          @click="testOpen = true"
        >
          {{ t("alerts.testRun.action") }}
        </OButton>
      </span>
    </div>
    <AlertTestRun
      v-if="testOpen && testable"
      :body="testBody"
      :blocked-reason="testGapText"
      :baseline-empty="baselineEmptyText"
      :folder="testFolder"
      :destinations="formData.destinations ?? []"
      :template="formData.template || null"
      @close="closeTest"
    />
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  watch,
  inject,
  onMounted,
  computed,
  nextTick,
  reactive,
  onBeforeMount,
  onBeforeUnmount,
  useId,
  type PropType,
} from "vue";
import { isForecastHorizonValid } from "@/utils/alerts/forecastAlert";
import { buildThresholdMarkLines, thresholdAxisBounds } from "@/utils/alerts/thresholdMarkLines";
import { seriesValueRange, type ValueRange } from "@/utils/alerts/ratioThreshold";
import { keyToMs } from "@/utils/alerts/alertBacktest";
import { previewCaption } from "@/utils/alerts/previewCaption";
import {
  CONDITION_GAP_KEYS,
  conditionGap,
  isCountLimit,
  isSpanDurationMeasure,
  previewCountText,
} from "@/utils/alerts/alertReadBack";
import { durationText, durationWords, formatNumber, thresholdSide } from "@/utils/alerts/alertCopy";
import { filterNotSeenText } from "@/composables/alerts/useStreamDiscovery";
import { FILTER_PROFILES } from "@/components/filterBar/filterProfiles";
import { evaluateAlertBody, testRunKey, testValueText } from "@/utils/alerts/alertTestRun";
import { useAlertTestRun } from "@/composables/alerts/useAlertTestRun";
import AlertTestRun from "./AlertTestRun.vue";
import {
  chartUnit,
  gaugeValueUnit,
  promqlValueUnit,
  type MetricMeta,
} from "@/utils/alerts/alertValueUnit";
import { noSeriesReason, noSeriesSentence, selectorsOf } from "@/utils/alerts/promqlNoSeries";
import { promqlDaySeriesQuery, promqlParseTreeQuery } from "@/services/alert_preview.queries";
import useStreams from "@/composables/useStreams";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import {
  buildCountChartQuery,
  cleanAggregationQuery,
  getDefaultDashboardPanelData,
  groupColumns,
  withHistogramMinutes,
  withoutTimeBucket,
} from "@/utils/alerts/aggregationPreviewQuery";
import { comparisonOffsetText, comparisonWindows } from "@/utils/alerts/previewCompare";
import { compareRule } from "@/utils/alerts/alertIntents";
import { getIntlLocale } from "@/locales";
import PanelSchemaRenderer from "../dashboards/PanelSchemaRenderer.vue";
import { cloneDeep, debounce } from "lodash-es";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import searchService from "@/services/search";
import { promRulePreviewQuery } from "@/services/alerts.queries";
import { queryClient } from "@/composables/query/queryClient";
import { b64EncodeUnicode, generateTraceContext, smartDecodeVrlFunction } from "@/utils/zincutils";
import useHttpStreaming from "@/composables/useStreamingSearch";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import QueryErrorState from "@/components/common/QueryErrorState.vue";
import { routeLocationKey } from "vue-router";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";

let dashboardPanelData: any = null;

const props = defineProps({
  query: {
    type: String,
    default: "",
  },
  formData: {
    type: Object,
    default: () => ({}),
  },
  isAggregationEnabled: {
    type: Boolean,
    default: false,
  },
  selectedTab: {
    type: String,
    default: "",
  },
  isUsingBackendSql: {
    type: Boolean,
    default: false,
  },
  isEditorOpen: {
    type: Boolean,
    default: false,
  },
  // Opt-in: names the limit lines in a key under the chart.
  labelledLimit: {
    type: Boolean,
    default: false,
  },
  // Where the range buttons go: unset keeps them above the chart, null waits for the host's element.
  rangeTarget: {
    type: Object as PropType<HTMLElement | null>,
    default: undefined,
  },
});

// SQL tab's Multi Alert value-column dropdown (sql_simple_multi_alert_fe_prd.md
// §11): reuses this component's own /result_schema call below rather than a
// second, separately-triggered fetch — the dropdown's options refresh in
// lockstep with "the preview query firing", not on a different cadence.
const emit = defineEmits<{
  (e: "schema-updated", payload: { projections: string[]; hasHaving: boolean }): void;
  (e: "value-range", range: ValueRange | null): void;
  (e: "test-open", open: boolean): void;
}>();

// Strip axis labels from field config so ECharts doesn't render axis titles
// and the grid margins shrink accordingly (hasXAxisName/hasYAxisName become false)
const clearFieldLabels = (data: any) => {
  data.queries[0].fields.x.forEach((f: any) => {
    f.label = "";
  });
  data.queries[0].fields.y.forEach((f: any) => {
    f.label = "";
  });
};

const hasLimitValue = (v: unknown): boolean => v !== undefined && v !== null && v !== "";
// 0 stays a gate the backend honours (`<= 0` fires on no series); the form still asks for 1 or more.
const isPreviewCountLimit = (v: unknown): boolean =>
  isCountLimit(v) ||
  ((typeof v === "number" || typeof v === "string") && String(v).trim() !== "" && Number(v) === 0);

// "One per <column>" on SQL: each row is a group, judged on one of its columns, not on the row count.
const sqlPerGroup = (): boolean =>
  props.selectedTab === "sql" &&
  !!props.formData.query_condition?.aggregation?.multi_alert &&
  hasLimitValue(props.formData.query_condition?.aggregation?.having?.column);

/** The limits the current mode draws; a count limit that needs fixing draws none. */
// Warning comes from the critical's family (aggregate value or count), or it lands on the wrong scale.
const currentLimits = (): [unknown, unknown] => {
  // A real-time alert fires per event, so it has no count to draw a limit for.
  if (props.formData.is_real_time === "true") return [undefined, undefined];
  const qc = props.formData.query_condition;
  const tc = props.formData.trigger_condition;
  if (props.selectedTab === "promql") {
    return [qc?.promql_condition?.value, qc?.promql_warning_value];
  }
  const aggregation = qc?.aggregation;
  // A value alert compares the measure, never the count, so a blank value draws no line.
  if (props.selectedTab === "custom" && props.isAggregationEnabled) {
    return hasLimitValue(aggregation?.having?.value)
      ? [aggregation.having.value, aggregation.warning_value]
      : [undefined, undefined];
  }
  if (sqlPerGroup()) return [aggregation.having.value, aggregation.warning_value];
  return [isPreviewCountLimit(tc?.threshold) ? tc.threshold : undefined, tc?.warning_threshold];
};

/**
 * Draw the threshold lines AND make room for them.
 *
 * A chart auto-scales to its DATA, so a threshold outside that range lands
 * outside the plot area and is simply never seen — and the commonest preview of
 * all is an alert that is NOT currently firing, where every value sits below the
 * threshold and the one line the user came to check is the one thing missing.
 * `thresholdAxisBounds` only ever WIDENS the axis (both chart pipelines take
 * max(config, dataMax) / min(config, dataMin)), so data that already crosses the
 * threshold still scales normally.
 *
 * The bounds are ASSIGNED, never merged: a refresh that drops the threshold must
 * drop the headroom it asked for, or the chart keeps scaling to a line it is no
 * longer drawing.
 */
const applyThresholds = (): void => {
  const [critical, warning] = currentLimits();
  drawnLimits.value = [
    ...(hasLimitValue(critical) ? [{ level: "critical" as const, value: critical }] : []),
    ...(hasLimitValue(warning) ? [{ level: "warning" as const, value: warning }] : []),
  ];
  // A label on the line sits over the series it crosses; the key under the chart names it instead.
  const markLines = buildThresholdMarkLines(critical, warning, {
    critical: t("alerts.plain.limitLine"),
    warning: t("alerts.plain.warnLine"),
  }).map((line) => ({ ...line, show_label: false }));
  const bounds = thresholdAxisBounds(markLines);
  const unit = chartUnit(valueUnit.value);
  dashboardPanelData.data.config.unit = unit.unit;
  dashboardPanelData.data.config.unit_custom = unit.unitCustom;
  // Counted events are whole numbers; an axis of "180.00" reads as a measurement.
  const counts =
    !props.isAggregationEnabled ||
    ["count", "total_events"].includes(props.formData.query_condition?.aggregation?.function);
  dashboardPanelData.data.config.decimals =
    props.selectedTab === "custom" && counts ? 0 : undefined;
  dashboardPanelData.data.config.mark_line = markLines;
  dashboardPanelData.data.config.y_axis_min = bounds.y_axis_min;
  dashboardPanelData.data.config.y_axis_max = bounds.y_axis_max;
};

// Helper function to get decoded VRL function
const getDecodedVrlFunction = (): string | null => {
  // A compare alert's function reads the past windows' rows, which the preview's one search lacks.
  if (!props.formData.query_condition?.vrl_function || comparisons.value.length) {
    return null;
  }
  // Use smart decoder to handle both single and double-encoded VRL
  return smartDecodeVrlFunction(props.formData.query_condition.vrl_function);
};

onBeforeMount(() => {
  dashboardPanelData = reactive({ ...getDefaultDashboardPanelData() });
  dashboardPanelData.data.type = "line";
  dashboardPanelData.data.queryType = props.selectedTab === "promql" ? "promql" : "sql";
  dashboardPanelData.data.queries[0].query = props.query;
  // VRL function is only supported in SQL mode
  dashboardPanelData.data.queries[0].vrlFunctionQuery =
    props.selectedTab === "sql" ? getDecodedVrlFunction() : null;
  // Enable dynamic columns when VRL function is present
  dashboardPanelData.data.config.table_dynamic_columns =
    props.selectedTab === "sql" && props.formData.query_condition?.vrl_function ? true : false;
  // Give y-axis labels enough room so they don't collide with the chart
  dashboardPanelData.data.config.unit = "numbers";
  // At the panel's width a legend pages from three series; the key counts them, the tooltip names them.
  dashboardPanelData.data.config.show_legends = false;
  dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
  dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
  dashboardPanelData.data.queries[0].customQuery = true;
  // The preview draws its own error state; the renderer's is the dashboards' neutral one.
  dashboardPanelData.data.error_config = { custom_error_handeling: true };
});

const chartPanelRef = ref(null);
const panelRendererRef = ref(null);
const chartData = ref<Record<string, any> | null>({});
const selectedTimeObj = ref({});
const evaluationStatus = ref<{
  wouldTrigger: boolean;
  reason: string;
  count?: number;
  atLeast?: boolean;
  label?: string;
  grouped?: boolean;
  value?: number;
  windowMinutes?: number;
  /** The preview cannot judge this alert, so the reason is said as it is, in this tone. */
  note?: "note" | "warn";
} | null>(null);
const { t } = useI18nTyped();
// The renderer's last run outcome; an empty message means it answered. Results it emits after
// an error are not this query's, so the handlers skip them.
const previewError = ref<{ message?: string; code?: string | number } | null>(null);
// The wide-range verdict search fails on its own; its error withdraws the verdict the same way.
const verdictSearchError = ref<{ message?: string; code?: string | number } | null>(null);
watch([previewError, verdictSearchError], (errors) => {
  if (errors.some((error) => error?.message)) evaluationStatus.value = null;
});
// A run clears the renderer's error as it starts; the summary keeps it until that run answers.
const settledPreviewError = ref<{ message?: string; code?: string | number } | null>(null);
let previewLoading = false;
const onPreviewError = (error: { message?: string; code?: string | number } | null) => {
  previewError.value = error;
  if (error?.message || !previewLoading) settledPreviewError.value = error;
};
// A streamed result arrives in parts; its counts and verdict are written once, from the settled part.
let unsettledSeries: unknown = null;
const onSeriesData = (seriesData: unknown) => {
  if (previewLoading) {
    unsettledSeries = seriesData;
    return;
  }
  unsettledSeries = null;
  handleSeriesDataUpdate(seriesData);
};
// Set once a builder run settles on the renderer's own "No Data", so the chart can say why.
const filterDrewNothing = ref(false);
const onPreviewLoading = (loading: boolean) => {
  previewLoading = loading;
  if (!loading && unsettledSeries) {
    const settled = unsettledSeries;
    unsettledSeries = null;
    handleSeriesDataUpdate(settled);
  }
  if (!loading) settledPreviewError.value = previewError.value;
  filterDrewNothing.value =
    !loading &&
    props.selectedTab === "custom" &&
    (panelRendererRef.value as { noData?: string } | null)?.noData === "No Data";
};
// Only a 4xx message is about the query; anything else says the data could not be loaded.
const shownChartError = computed(() => {
  const error = settledPreviewError.value;
  if (!error?.message) return null;
  return String(error.code ?? "").startsWith("4")
    ? { message: error.message, title: undefined }
    : { message: "", title: t("common.errorLoadingData") };
});

const store = useStore();

const { getStream } = useStreams(t);
const metricMeta = ref<MetricMeta | null>(null);
watch(
  () => [props.formData.stream_name, props.formData.stream_type] as const,
  async ([name, type]) => {
    metricMeta.value = null;
    if (type !== "metrics" || !name) return;
    try {
      const stream = await getStream(name, "metrics", false);
      if (props.formData.stream_name !== name) return;
      const meta = stream?.metrics_meta ?? {};
      metricMeta.value = { name, type: meta.metric_type, unit: meta.unit };
    } catch {
      // Without the stream's metadata the axis stays unitless.
    }
  },
  { immediate: true },
);
// A forecast or a rule draws other numbers than the metric's values.
const valueUnit = computed((): string | null => {
  const qc = props.formData.query_condition;
  if (
    props.selectedTab === "custom" &&
    props.isAggregationEnabled &&
    isSpanDurationMeasure(
      props.formData.stream_type,
      qc?.aggregation?.function,
      qc?.aggregation?.having?.column,
    )
  )
    return "microseconds";
  const agg = qc?.aggregation;
  if (
    props.selectedTab === "custom" &&
    props.isAggregationEnabled &&
    metricMeta.value &&
    agg?.having?.column === "value" &&
    !["count", "total_events"].includes(agg.function)
  )
    return gaugeValueUnit(metricMeta.value);
  if (props.selectedTab !== "promql" || !metricMeta.value || qc?.promql_rule_mode) return null;
  if (props.formData._ui?.forecast) return null;
  return promqlValueUnit(props.query, metricMeta.value);
});

// Test it: the dry run of the alert as it stands; anomaly, composite and SLO alerts can't be run yet.
const testRun = useAlertTestRun();
const route = inject(routeLocationKey, null);
const testFolder = computed(() => {
  const folder = route?.query?.folder;
  return typeof folder === "string" && folder ? folder : "default";
});
const testable = computed(
  () =>
    !!props.formData.stream_name &&
    props.selectedTab !== "slo" &&
    props.formData.is_real_time !== "composite" &&
    !["anomaly_detection", "composite"].includes(props.formData.alert_type),
);
// Test it judges a rule, so an unfinished condition holds it with the step's own reason.
const testGap = computed(() =>
  props.formData.is_real_time === "true"
    ? null
    : conditionGap(props.formData as any, { aggregationEnabled: props.isAggregationEnabled }),
);
const testGapText = computed(() => (testGap.value ? t(CONDITION_GAP_KEYS[testGap.value]) : null));
const testGapId = `${useId()}-test-reason`;
const testBody = computed(() => {
  if (!testable.value || testGap.value) return null;
  try {
    return evaluateAlertBody(props.formData as any, {
      store,
      isAggregationEnabled: { value: props.isAggregationEnabled },
      getSelectedTab: { value: props.selectedTab },
    });
  } catch {
    // A form still loading has no body to test.
    return null;
  }
});
watch(
  testBody,
  (body) => {
    testRun.currentKey.value = body ? testRunKey(body) : null;
  },
  { immediate: true },
);
// Once the preview is gone (anomaly, composite), no answer stands for the alert any more.
onBeforeUnmount(() => {
  testRun.currentKey.value = null;
});
const testOpen = ref(false);
// Test it's answer takes the chart's place and can be taller, so the host lets the box grow.
watch(testOpen, (open) => emit("test-open", open));
const testItButton = ref<{ $el: HTMLElement } | null>(null);
// The panel covers Test it, so closing it hands focus back to the button that opened it.
const closeTest = async () => {
  testOpen.value = false;
  await nextTick();
  testItButton.value?.$el?.focus();
};

type PreviewRange = "checks" | "12h" | "24h";
const PREVIEW_RANGE_KEY = "o2_alert_preview_range";
const PREVIEW_RANGE_MINUTES: Record<Exclude<PreviewRange, "checks">, number> = {
  "12h": 720,
  "24h": 1440,
};
const readPreviewRange = (): PreviewRange => {
  try {
    const saved = sessionStorage.getItem(PREVIEW_RANGE_KEY);
    return saved === "12h" || saved === "24h" ? saved : "checks";
  } catch {
    return "checks";
  }
};
// The range only changes what the preview shows; it is never part of the alert.
const previewRange = ref<PreviewRange>(readPreviewRange());
watch(previewRange, (range) => {
  try {
    sessionStorage.setItem(PREVIEW_RANGE_KEY, range);
  } catch {
    // Private windows refuse storage; the choice then lasts as long as the page.
  }
});
// An org-wide preview range set by the admin replaces "the last 3 checks".
const orgPreviewMinutes = (): number =>
  Number(store.state.zoConfig?.alert_preview_timerange_minutes) || 0;
const alertWindowMinutes = (): number => Number(props.formData.trigger_condition?.period) || 0;
// Over a whole range a per-group query is one row per group, filtered by its HAVING, so the chart
// draws each group's value per look-back window instead, with nothing filtered out.
const sqlGroupChartQuery = computed((): string | null => {
  if (!sqlPerGroup() || !props.query) return null;
  if (comparisonWindows(props.formData.query_condition?.multi_time_range).length) return null;
  if (props.formData.query_condition?.vrl_function || alertWindowMinutes() <= 0) return null;
  if (/\bhistogram\(/i.test(props.query)) return null;
  return withHistogramMinutes(cleanAggregationQuery(props.query), alertWindowMinutes());
});
// A SQL verdict counts the rows the query returns, which only one window can give; a builder
// chart draws one point per window, so it shows a dozen of them, never more than a day.
const previewChecks = computed(() => {
  if (props.selectedTab === "sql" && !sqlGroupChartQuery.value) return 1;
  if (props.selectedTab !== "custom" || props.formData.is_real_time === "true") return 3;
  return Math.min(12, Math.max(3, Math.floor(1440 / Math.max(alertWindowMinutes(), 1))));
});
const previewMinutesFor = (range: PreviewRange): number => {
  if (range !== "checks") return PREVIEW_RANGE_MINUTES[range];
  if (orgPreviewMinutes() > 0) return orgPreviewMinutes();
  return Math.max(previewChecks.value * alertWindowMinutes(), 5);
};
const previewMinutes = (): number => previewMinutesFor(shownRange.value);
// The chart's buckets never line up with the latest window (SQL counts rows, a builder point is one
// clock-aligned window), so the verdict comes from one extra search over that window alone.
const verdictNeedsOwnSearch = (): boolean => {
  if (props.formData.is_real_time === "true" || props.selectedTab === "promql") return false;
  if (alertWindowMinutes() <= 0) return false;
  if (props.selectedTab === "sql") return previewMinutes() > alertWindowMinutes();
  return props.selectedTab === "custom";
};
// Any other bucket puts the chart on another scale than the threshold: a point is what one check sees.
const chartBucketMinutes = (): number =>
  props.selectedTab === "custom" && verdictNeedsOwnSearch() ? alertWindowMinutes() : 0;
// A count chart the server would bucket itself is rewritten into one that names its bucket.
const windowCountQuery = (): string | null => {
  const minutes = chartBucketMinutes();
  if (!minutes || props.isAggregationEnabled) return null;
  const count = /\bhistogram\(/i.test(props.query)
    ? props.query
    : buildCountChartQuery(props.query);
  return count ? withHistogramMinutes(count, minutes) : null;
};
const selfBucketed = ref(false);
// Hours, never days, so the default reads on the same scale as 12h and 24h.
const compactDuration = (minutes: number): I18nText => {
  if (minutes % 60 === 0) return t("alerts.form.preview.hrCompact", { count: minutes / 60 });
  return t("alerts.form.preview.minCompact", { count: minutes });
};
// "Last 3 checks" is true only when back-to-back checks tile the range: on a schedule, Check every = Look back.
const checksTileRange = (): boolean => {
  const tc = props.formData.trigger_condition ?? {};
  return (
    String(props.formData.is_real_time ?? "false") === "false" &&
    tc.frequency_type !== "cron" &&
    Number(tc.frequency) === alertWindowMinutes()
  );
};
const defaultRangeTooltip = (minutes: number): I18nText => {
  const checks = previewChecks.value;
  if (orgPreviewMinutes() > 0 || !checksTileRange() || checks * alertWindowMinutes() !== minutes)
    return t("alerts.form.preview.lastMinutes", { minutes });
  return t("alerts.form.preview.checksSpan", { count: checks, minutes }, checks);
};
// A fixed range as long as the default would repeat it as a second button, so it is left out.
const previewRangeOptions = computed(() => {
  const defaultMinutes = previewMinutesFor("checks");
  return [
    {
      value: "checks" as PreviewRange,
      label: compactDuration(defaultMinutes),
      tooltip: defaultRangeTooltip(defaultMinutes),
    },
    {
      value: "12h" as PreviewRange,
      label: compactDuration(720),
      tooltip: t("alerts.form.preview.hours12"),
    },
    {
      value: "24h" as PreviewRange,
      label: compactDuration(1440),
      tooltip: t("alerts.form.preview.hours24"),
    },
  ].filter(
    (option) =>
      option.value === "checks" ||
      PREVIEW_RANGE_MINUTES[option.value as "12h" | "24h"] !== defaultMinutes,
  );
});
const shownRange = computed<PreviewRange>(() =>
  previewRangeOptions.value.some((option) => option.value === previewRange.value)
    ? previewRange.value
    : "checks",
);
const onRangePick = (value: unknown) => {
  if (value === "checks" || value === "12h" || value === "24h") previewRange.value = value;
};

const drawnSeries = ref<{ shown: number; total: number } | null>(null);
const seriesCountText = computed((): I18nText | null => {
  const drawn = drawnSeries.value;
  // Lines on the chart with no verdict count say the series are there and none crossed.
  if (
    props.selectedTab === "promql" &&
    drawn &&
    drawn.shown > 0 &&
    evaluationStatus.value?.count === 0
  )
    return t(
      "alerts.form.preview.seriesNoneCross",
      { count: formatNumber(drawn.total) },
      drawn.total,
    );
  if (!drawn || drawn.total <= 1) return null;
  if (drawn.total > drawn.shown)
    return t("alerts.form.preview.seriesShown", {
      shown: drawn.shown.toLocaleString(),
      total: drawn.total.toLocaleString(),
    });
  return t("alerts.sections.condition.series", { count: drawn.shown.toLocaleString() });
});
const showChartKey = computed(
  () => !!chartData.value && !awaitsQuery.value && !shownChartError.value,
);
const drawnLimits = ref<{ level: "critical" | "warning"; value: unknown }[]>([]);
const limitKeys = computed(() =>
  props.labelledLimit
    ? drawnLimits.value.map(({ level, value }) => {
        const shown = !Number.isFinite(Number(value))
          ? String(value)
          : valueUnit.value
            ? testValueText(Number(value), valueUnit.value, t)
            : Number(value).toLocaleString();
        return {
          level,
          label:
            level === "critical"
              ? t("alerts.form.preview.limitKey", { value: shown })
              : t("alerts.form.preview.warningKey", { value: shown }),
        };
      })
    : [],
);

const writesOwnQuery = computed(
  () => props.selectedTab === "sql" || props.selectedTab === "promql",
);
// The renderer remounts after the prompt, so a chart kept from the last query would run that query first.
watch(
  () => writesOwnQuery.value && !props.query,
  (empty) => {
    if (!empty) return;
    chartData.value = null;
    previewError.value = null;
    settledPreviewError.value = null;
  },
);
const awaitsQuery = computed(() => writesOwnQuery.value && (!props.query || !chartData.value));
// A forecast's query stays empty until its threshold is a number, so the prompt asks for that.
const awaitsQueryText = computed((): I18nText => {
  const forecast = props.formData._ui?.forecast;
  const thresholdMissing =
    forecast && String(forecast.U ?? "").trim() && !Number.isFinite(Number(forecast.T ?? NaN));
  return thresholdMissing || (forecast && forecast.T === "")
    ? t("alerts.forecast.previewNeedsThreshold")
    : t("alerts.writeQueryToSeePreview");
});

// Computed property to determine if histogram should be used
// For SQL/custom with aggregations (GROUP BY), we should use histogram
// because histogram is needed for aggregated queries
const shouldUseHistogram = computed(() => {
  // Custom mode with aggregations: never use histogram
  if (props.selectedTab === "custom" && props.isAggregationEnabled) {
    return false;
  }

  // For other modes (PromQL, custom without agg), use the prop value
  return props.isUsingBackendSql && !selfBucketed.value;
});

// When aggregation is enabled use "dashboards" search type so the panel does not
// add histogram-specific query params (zo_sql_min_time / zo_sql_max_time etc.)
const searchTypeForPanel = computed(() => (props.isAggregationEnabled ? "dashboards" : "UI"));

// Clean the aggregation query for preview:
//  • Remove HAVING clause (added by alert engine, irrelevant for chart)
//  • Remove helper time columns (zo_sql_min_time, zo_sql_max_time)
//  • Rename aggregation value column → zo_sql_num (local SQL: zo_sql_val,
//    backend SQL: alert_agg_value)
//  • Ensure histogram(_timestamp) AS zo_sql_key is in SELECT and GROUP BY
//  • Move zo_sql_num immediately after zo_sql_key in the SELECT list so the
//    field order is: zo_sql_key, zo_sql_num, <breakdown fields…>

// Determine chart type based on result schema from API
const determineChartType = (extractedFields: {
  group_by: string[];
  projections: string[];
  timeseries_field: string | null;
}): string => {
  // Check if we have histogram or timestamp in group_by (common patterns)
  const hasTimeSeriesGrouping = extractedFields.group_by.some(
    (field) =>
      field &&
      (field.toLowerCase().includes("histogram") ||
        field.toLowerCase().includes("_timestamp") ||
        field.toLowerCase().includes("timestamp")),
  );

  // For raw log data (no group_by)
  // we will show table by default becuase no group by means no aggregation so for no aggregation queries we dont show any line chart
  if (extractedFields.group_by.length === 0) {
    return "table";
  }

  // If we have a time series field with time-based grouping, use line chart
  if (
    extractedFields.timeseries_field &&
    hasTimeSeriesGrouping &&
    extractedFields.group_by.length <= 2
  ) {
    return "line";
  }

  // If we have group by without time series, use line chart
  if (extractedFields.group_by.length > 0 && extractedFields.group_by.length <= 2) {
    return "line";
  }

  // Otherwise use table for best compatibility
  return "table";
};

// Convert result schema to x, y, breakdown fields
const convertSchemaToFields = (
  extractedFields: {
    group_by: string[];
    projections: string[];
    timeseries_field: string | null;
  },
  chartType: string,
): {
  x: any[];
  y: any[];
  breakdown: any[];
} => {
  // For table charts, add all projections to x-axis since tables display all fields as columns
  if (chartType === "table") {
    return {
      x: extractedFields.projections.map((field) => ({
        alias: field,
        column: field,
        color: null,
        label: field,
      })),
      y: [],
      breakdown: [],
    };
  }

  // For non-table charts (line/bar), use the original logic
  // Remove group by and timeseries field from projections, use them on y axis
  // Also filter out helper timestamp fields that alerts add (zo_sql_min_time, zo_sql_max_time)
  const yAxisFields = extractedFields.projections.filter(
    (field) =>
      !extractedFields.group_by.includes(field) &&
      field !== extractedFields.timeseries_field &&
      field !== "zo_sql_min_time" &&
      field !== "zo_sql_max_time",
  );

  const fields = {
    x: [] as any[],
    y: yAxisFields.map((field) => ({
      alias: field,
      column: field,
      color: "#5960b2",
      label: field,
    })),
    breakdown: [] as any[],
  };

  // Add timestamp as x axis
  if (extractedFields.timeseries_field) {
    fields.x.push({
      alias: extractedFields.timeseries_field,
      column: extractedFields.timeseries_field,
      color: null,
      label: extractedFields.timeseries_field,
    });
  }

  // Process group by fields
  extractedFields.group_by.forEach((field: any) => {
    if (field != extractedFields.timeseries_field) {
      // If x axis is empty then first add group by as x axis
      if (fields.x.length == 0) {
        fields.x.push({
          alias: field,
          column: field,
          color: null,
          label: field,
        });
      } else {
        fields.breakdown.push({
          alias: field,
          column: field,
          color: null,
          label: field,
        });
      }
    }
  });

  return fields;
};

// Generation counter to discard stale async responses when the user switches
// modes (e.g. builder → SQL) before a search query completes.
const schemaRequestId = ref(0);

// Fetch query schema from result_schema API for SQL mode
const fetchQuerySchema = async () => {
  const requestId = ++schemaRequestId.value;

  try {
    // ── Aggregation path ─────────────────────────────────────────────────────
    // Skip result_schema entirely. The backend SQL already follows a known
    // structure:  histogram(_timestamp) AS zo_sql_key, fn(...) AS zo_sql_val,
    //             concat(group[0]) AS x_axis_2, concat(group[1]) AS x_axis_3 …
    // We clean the query, rename zo_sql_val→zo_sql_num, and wire the fields
    // directly so we get a multi-series line chart with a threshold mark-line.
    if (props.selectedTab === "custom" && props.isAggregationEnabled) {
      const cleaned = cleanAggregationQuery(props.query);
      const queryForPreview = chartBucketMinutes()
        ? withHistogramMinutes(cleaned, chartBucketMinutes())
        : cleaned;

      // Build breakdown from aggregation group_by fields.
      // Backend uses the original field names (e.g. status, service) in the SELECT and GROUP BY.
      const groupByFields: string[] = (
        props.formData.query_condition?.aggregation?.group_by || []
      ).filter((f: string) => f && f.trim() !== "");

      const breakdown = groupColumns(queryForPreview, groupByFields).map((field: string) => ({
        alias: field,
        column: field,
        color: null,
        label: field,
      }));

      dashboardPanelData.data.type = "line";
      dashboardPanelData.data.queryType = "sql";
      dashboardPanelData.data.queries[0].customQuery = true;
      dashboardPanelData.data.queries[0].query = queryForPreview;
      dashboardPanelData.data.queries[0].vrlFunctionQuery = null;
      dashboardPanelData.data.config.table_dynamic_columns = false;
      dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
      dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
      dashboardPanelData.data.queries[0].fields.x = [
        {
          alias: "zo_sql_key",
          column: "zo_sql_key",
          color: null,
          label: t("alerts.timeLabel"),
        },
      ];
      const aggFunction = props.formData.query_condition?.aggregation?.function || "";
      const aggColumn = props.formData.query_condition?.aggregation?.having?.column || "";
      const yLabel = aggColumn
        ? aggFunction
          ? `${aggFunction}(${aggColumn})`
          : aggColumn
        : "zo_sql_num";

      dashboardPanelData.data.queries[0].fields.y = [
        {
          alias: "zo_sql_num",
          column: "zo_sql_num",
          color: "#5960b2",
          label: yLabel,
        },
      ];
      dashboardPanelData.data.queries[0].fields.z = [];
      dashboardPanelData.data.queries[0].fields.breakdown = breakdown;
      applyThresholds();

      if (
        !dashboardPanelData.data.queries[0].fields.filter ||
        Array.isArray(dashboardPanelData.data.queries[0].fields.filter)
      ) {
        dashboardPanelData.data.queries[0].fields.filter = {
          filterType: "group",
          logicalOperator: "AND",
          conditions: [],
        };
      }

      chartData.value = cloneDeep(dashboardPanelData.data);
      clearFieldLabels(chartData.value);
      selectedTimeObj.value = { ...dashboardPanelData.meta.dateTime };
      return;
    }
    // ── Non-aggregation SQL path (result_schema) ──────────────────────────────

    const groupChart = sqlGroupChartQuery.value;
    const schemaRes = await searchService.result_schema(
      {
        org_identifier: store.state.selectedOrganization.identifier,
        query: {
          query: {
            sql: store.state.zoConfig.sql_base64_enabled
              ? b64EncodeUnicode(props.query)
              : props.query,
            query_fn: null,
            start_time: (Date.now() - 3600000) * 1000,
            end_time: Date.now() * 1000,
            size: -1,
            histogram_interval: undefined,
            streaming_output: false,
            streaming_id: null,
          },
          ...(store.state.zoConfig.sql_base64_enabled ? { encoding: "base64" } : {}),
        },
        page_type: props.formData.stream_type || "logs",
        is_streaming: false,
      },
      "ui",
    );

    // Discard if a newer request was started (e.g. tab changed before response).
    if (requestId !== schemaRequestId.value) return;

    const extractedFields = schemaRes.data;

    // SQL tab's Multi Alert value-column dropdown — see the emit declaration
    // above. Only meaningful for the raw SQL tab (this branch only runs when
    // selectedTab === "sql"; the aggregation branch above, Custom's
    // BE-generated SQL, returns before reaching here). `having` is the user's
    // own SQL HAVING clause (parsed server-side), not the alert's "Alert if
    // [column]" condition — its presence warns that it filters the result
    // set before that condition ever sees it.
    emit("schema-updated", {
      projections: extractedFields.projections,
      hasHaving: !!extractedFields.having,
    });

    // A per-group chart draws the one column the alert judges per window, on the threshold's scale.
    const judged = String(props.formData.query_condition?.aggregation?.having?.column ?? "");
    const chartType = groupChart ? "line" : determineChartType(extractedFields);
    dashboardPanelData.data.type = chartType;

    // Convert schema to fields
    const fields = groupChart
      ? convertSchemaToFields(
          {
            ...extractedFields,
            projections: ["zo_sql_key", ...extractedFields.group_by, judged],
            timeseries_field: "zo_sql_key",
          },
          chartType,
        )
      : convertSchemaToFields(extractedFields, chartType);

    // Set up the query
    dashboardPanelData.data.queries[0].customQuery = true;
    dashboardPanelData.data.queries[0].query = groupChart ?? props.query;
    dashboardPanelData.data.queries[0].vrlFunctionQuery = getDecodedVrlFunction();
    // Enable dynamic columns when VRL function is present
    dashboardPanelData.data.config.table_dynamic_columns = props.formData.query_condition
      ?.vrl_function
      ? true
      : false;
    dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
    dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
    dashboardPanelData.data.queryType = "sql";
    // Critical + optional Warning marklines (alerts_2.md Feature 1). Both are
    // drawn so the two bands are visible on the preview, matching the mock.
    applyThresholds();

    // Set the fields from schema
    dashboardPanelData.data.queries[0].fields.x = fields.x;
    dashboardPanelData.data.queries[0].fields.y = fields.y;
    dashboardPanelData.data.queries[0].fields.z = [];
    dashboardPanelData.data.queries[0].fields.breakdown = fields.breakdown;

    // Ensure filter is always an object
    if (
      !dashboardPanelData.data.queries[0].fields.filter ||
      Array.isArray(dashboardPanelData.data.queries[0].fields.filter)
    ) {
      dashboardPanelData.data.queries[0].fields.filter = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      };
    }

    chartData.value = cloneDeep(dashboardPanelData.data);
    clearFieldLabels(chartData.value);
    selectedTimeObj.value = { ...dashboardPanelData.meta.dateTime };

    // Alert status evaluation happens via handleChartDataUpdate event from PanelSchemaRenderer
  } catch (error) {
    // Discard stale error fallback if a newer request has started.
    if (requestId !== schemaRequestId.value) return;

    const status = (error as { response?: { status?: number } })?.response?.status ?? 0;
    // A 4xx is the half-typed query the user is still editing, not an app fault.
    if (status >= 400 && status < 500) console.warn("Failed to fetch query schema:", error);
    else console.error("Failed to fetch query schema:", error);
    // Fallback to table view on error
    dashboardPanelData.data.type = "table";
    dashboardPanelData.data.queries[0].customQuery = true;
    dashboardPanelData.data.queries[0].query = props.query;
    dashboardPanelData.data.queries[0].vrlFunctionQuery = getDecodedVrlFunction();
    // Enable dynamic columns when VRL function is present
    dashboardPanelData.data.config.table_dynamic_columns = props.formData.query_condition
      ?.vrl_function
      ? true
      : false;
    dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
    dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
    dashboardPanelData.data.queryType = "sql";
    dashboardPanelData.data.queries[0].fields.x = [];
    dashboardPanelData.data.queries[0].fields.y = [];
    dashboardPanelData.data.queries[0].fields.z = [];
    dashboardPanelData.data.queries[0].fields.breakdown = [];

    if (
      !dashboardPanelData.data.queries[0].fields.filter ||
      Array.isArray(dashboardPanelData.data.queries[0].fields.filter)
    ) {
      dashboardPanelData.data.queries[0].fields.filter = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      };
    }

    chartData.value = cloneDeep(dashboardPanelData.data);
    clearFieldLabels(chartData.value);
    selectedTimeObj.value = { ...dashboardPanelData.meta.dateTime };
  }
};

// Handle chart data updates from PanelSchemaRenderer
// This receives the resultMetaData which contains the streaming response metadata
const handleChartDataUpdate = (resultMetaData: any) => {
  if (previewError.value?.message) return;
  // Safety check: ensure trigger_condition exists
  if (!props.formData.trigger_condition) {
    console.warn("[PreviewAlert] No trigger_condition found, skipping evaluation");
    return;
  }

  // PromQL is evaluated in handleSeriesDataUpdate — the only handler that sees
  // sample VALUES. PromQL `resultMetaData` carries query metadata only
  // ({ step, trace_id } — usePanelPromQLExecutor.ts:222), so evaluating here
  // counted nothing and stamped a bogus "0 >= 1" over the real verdict on every
  // refresh. Keyed on the tab, not on query_condition.type: the form keeps a
  // stale promql_condition around after the user switches modes.
  // (This makes the `selectedTab === "promql"` arm of the chain below dead code.)
  if (props.selectedTab === "promql" || verdictNeedsOwnSearch()) return;
  if (!isRealTimeAlert() && bucketsCoarserThanWindow(resultMetaData)) {
    evaluationStatus.value = null;
    return;
  }
  evaluateResultMetadata(resultMetaData, inVerdictWindow);
};

// The server stops each partition at its default row limit without flagging it, so a full one may hold more.
const stoppedAtRowCap = (rows: number): boolean => {
  const cap = Number(store.state.zoConfig?.query_default_limit) || 0;
  return cap > 0 && rows === cap;
};

/** Counts a run's frames into the verdict; `inWindow` keeps the hits of the latest window. */
const evaluateResultMetadata = (resultMetaData: any, windowFilter: (hit: any) => boolean) => {
  // A real-time alert counts every matching event the chart shows, not one window.
  const realTime = isRealTimeAlert();
  const inWindow = realTime ? () => true : windowFilter;
  // resultMetaData structure from usePanelDataLoader:
  // resultMetaData[queryIndex] is an array of metadata objects from streaming partitions
  // Each metadata object has structure: {...content, ...content.results}
  // Which includes: hits, total, took, etc.

  let resultCount = 0;
  let atLeast = false;
  let measured: number | undefined;

  try {
    if (Array.isArray(resultMetaData) && resultMetaData.length > 0) {
      // Get metadata for first query (queryIndex = 0)
      const firstQueryMetadata = resultMetaData[0];

      if (Array.isArray(firstQueryMetadata) && firstQueryMetadata.length > 0) {
        // Get the latest partition metadata (last element in array)
        const latestPartition = firstQueryMetadata[firstQueryMetadata.length - 1];

        // Determine result count based on query mode
        // Custom builder with aggregation: re-aggregate per group across time buckets
        // before applying the having condition — histogram adds time-bucket rows that
        // would otherwise inflate the count.
        // SQL mode uses simple row count (trigger = "did SQL return >= N rows?")
        if (props.selectedTab === "custom" && props.isAggregationEnabled) {
          const havingValue = props.formData.query_condition?.aggregation?.having?.value;
          const havingOperator =
            props.formData.query_condition?.aggregation?.having?.operator || ">=";
          const aggFunction = props.formData.query_condition?.aggregation?.function || "avg";
          const groupByFields: string[] = (
            props.formData.query_condition?.aggregation?.group_by || []
          ).filter((f: string) => f && f.trim() !== "");
          const numHaving = havingValue != null && havingValue !== "" ? Number(havingValue) : null;
          if (numHaving === null) {
            evaluationStatus.value = null;
            return;
          }

          const passesHaving = (val: number): boolean => {
            switch (havingOperator) {
              case ">=":
                return val >= numHaving;
              case ">":
                return val > numHaving;
              case "<=":
                return val <= numHaving;
              case "<":
                return val < numHaving;
              case "=":
              case "==":
                return val === numHaving;
              case "!=":
                return val !== numHaving;
              default:
                return val >= numHaving;
            }
          };

          // Collect all hits across partitions
          const allHits: any[] = [];
          for (const partition of firstQueryMetadata) {
            if (Array.isArray(partition?.hits)) {
              allHits.push(...partition.hits.filter(inWindow));
            }
          }
          // A partition stopped at the row cap may hold more groups than it returned.
          atLeast =
            groupByFields.length > 0 &&
            firstQueryMetadata.some(
              (p: any) => Array.isArray(p?.hits) && stoppedAtRowCap(p.hits.length),
            );

          if (allHits.length > 0 && groupByFields.length > 0) {
            // Group hits by the user's group_by field combination (strip time bucket dimension)
            const groupMap = new Map<string, number[]>();
            const columns = groupColumns(props.query, groupByFields);
            for (const hit of allHits) {
              const key = columns.map((f: string) => String(hit[f] ?? "")).join("\x00");
              if (!groupMap.has(key)) groupMap.set(key, []);
              groupMap.get(key)!.push(Number(hit.zo_sql_num ?? hit.alert_agg_value ?? 0));
            }

            // Re-apply the aggregation function across time buckets per group, then check having
            for (const values of groupMap.values()) {
              let aggVal: number;
              switch (aggFunction) {
                case "min":
                  aggVal = Math.min(...values);
                  break;
                case "max":
                  aggVal = Math.max(...values);
                  break;
                case "sum":
                case "count":
                  aggVal = values.reduce((a, b) => a + b, 0);
                  break;
                case "avg":
                default:
                  aggVal = values.reduce((a, b) => a + b, 0) / values.length;
                  break;
              }
              if (passesHaving(aggVal)) resultCount++;
            }
          } else if (allHits.length > 0) {
            // No group_by: single group — aggregate all values and check once
            const values = allHits.map((h: any) => Number(h.zo_sql_num ?? h.alert_agg_value ?? 0));
            let aggVal: number;
            switch (aggFunction) {
              case "min":
                aggVal = Math.min(...values);
                break;
              case "max":
                aggVal = Math.max(...values);
                break;
              case "sum":
              case "count":
                aggVal = values.reduce((a, b) => a + b, 0);
                break;
              case "avg":
              default:
                aggVal = values.reduce((a, b) => a + b, 0) / values.length;
                break;
            }
            if (passesHaving(aggVal)) resultCount = 1;
            measured = aggVal;
          }

          // Fallback: if no hits available, use total row count
          if (
            resultCount === 0 &&
            allHits.length === 0 &&
            firstQueryMetadata.some((p: any) => p?.total !== undefined)
          ) {
            resultCount = firstQueryMetadata.reduce(
              (sum: number, p: any) => sum + (p?.total || 0),
              0,
            );
          }
        }
        // SQL mode: trigger = "SQL returned >= N rows", so count total rows returned.
        //
        // Frame arithmetic differs by mode, and getting it wrong silently changes
        // the verdict:
        //   - PLAIN partitions are DISJOINT time slices (the request is narrowed
        //     per partition, search_service/src/streaming/execution.rs:194-197), so
        //     each frame's `total` is its own slice's row count -> SUM them.
        //   - STREAMING-AGGREGATE frames each carry the CUMULATIVE merged result
        //     over everything scanned so far (streaming/collect.rs:152-175 replaces
        //     hits and recomputes `total`; execution.rs:289-292 "Only accumulate the
        //     results of the last partition") -> ONE frame already is the whole
        //     answer, and summing multiplies it by the frame count. Same rule the
        //     hit handler applies at usePanelSearchHandlers.ts:69.
        // The backend meanwhile evaluates the alert with a single non-streaming
        // search (`streaming_output: false`, src/core/src/alerts/mod.rs:584) and
        // counts `records.len()` once (:831).
        else if (sqlPerGroup()) {
          // Each row is a group; the ones past the judged column's threshold would fire.
          const having = props.formData.query_condition.aggregation.having;
          const limit = Number(having.value);
          const rows = firstQueryMetadata.flatMap((p: any) =>
            Array.isArray(p?.hits) ? p.hits.filter(inWindow) : [],
          );
          resultCount = Number.isFinite(limit)
            ? rows.filter((row: any) =>
                promqlSampleMatches(Number(row?.[having.column]), having.operator, limit),
              ).length
            : 0;
          atLeast = firstQueryMetadata.some(
            (p: any) => Array.isArray(p?.hits) && stoppedAtRowCap(p.hits.length),
          );
        } else if (props.selectedTab === "sql") {
          // `total: 0` is a SETTLED ANSWER, not a missing field: a shrinking HAVING
          // (`< N`, `!= N`) legitimately ends at zero rows. Testing truthiness here
          // instead of `!== undefined` silently resurrects the previous frame's count.
          const framesWithTotal = firstQueryMetadata.filter((p: any) => p?.total !== undefined);
          // Neither index 0 nor the last entry alone is a safe place to read the
          // flag (usePanelSQLExecutor.ts:553 and usePanelSearchHandlers.ts:238-241
          // make opposite mistakes); the flag is uniform per run, so `some` cannot
          // false-positive. Derived per call — never latched — so the next preview
          // of an edited query decides afresh.
          const isStreamingAggs = firstQueryMetadata.some((p: any) => p?.streaming_aggs === true);

          if (framesWithTotal.length > 0) {
            if (!isStreamingAggs) {
              resultCount = framesWithTotal.reduce(
                (sum: number, p: any) => sum + (Number(p?.total) || 0),
                0,
              );
              atLeast = framesWithTotal.some((p: any) => stoppedAtRowCap(Number(p?.total)));
            } else {
              // Last-wins, matching the server's own collector (collect.rs:165).
              // Skip range-capped frames: send_partial_search_resp emits a
              // default-constructed Response (total = 0, execution.rs:1053) still
              // tagged streaming_aggs, and taking it literally would report 0 rows.
              // Scanned without mutating: `firstQueryMetadata` is the composable's
              // LIVE reactive array, passed by reference from the deep watcher
              // (usePanelDrilldown.ts:105), and reordering it in place would break
              // handleStreamingHistogramHits' index arithmetic (:238).
              let settled: any = undefined;
              let maxTotal = 0;
              for (const frame of framesWithTotal) {
                const total = Number(frame?.total) || 0;
                if (total > maxTotal) maxTotal = total;
                if (frame?.is_partial !== true) settled = frame;
              }
              resultCount = settled !== undefined ? Number(settled.total) || 0 : maxTotal;
              atLeast = stoppedAtRowCap(resultCount);
            }
          } else if (Array.isArray(latestPartition?.hits)) {
            resultCount = latestPartition.hits.length;
            atLeast = stoppedAtRowCap(resultCount);
          }
        }
        // PromQL mode: count time series or data points
        else if (props.selectedTab === "promql") {
          // PromQL response structure: { data: { result: [{metric: {...}, values: [[timestamp, value], ...]}] } }
          // For PromQL, we want to count:
          // 1. Number of time series (result array length) - for "series count" alerts
          // 2. OR count data points above/below threshold - for "value" alerts

          // Check if we have PromQL result structure
          if (latestPartition?.result && Array.isArray(latestPartition.result)) {
            // Count the number of time series
            resultCount = latestPartition.result.length;
          } else if (Array.isArray(latestPartition?.hits)) {
            resultCount = latestPartition.hits.length;
          } else if (firstQueryMetadata.some((partition: any) => partition?.total !== undefined)) {
            // Sum up total from all partitions for PromQL fallback
            resultCount = firstQueryMetadata.reduce((sum: number, partition: any) => {
              return sum + (partition?.total || 0);
            }, 0);
          }
        }
        // Custom mode without aggregations: sum zo_sql_num from all partitions
        else if (props.selectedTab === "custom" && !props.isAggregationEnabled) {
          // Iterate through ALL partitions to sum zo_sql_num values
          for (const partition of firstQueryMetadata) {
            if (Array.isArray(partition?.hits)) {
              for (const hit of partition.hits) {
                const value = hit.zo_sql_num ?? hit.zo_sql_val;
                if (value !== undefined && inWindow(hit)) resultCount += Number(value) || 0;
              }
            }
          }
        }
        // Fallback for any other modes (traces, logs without aggregation, etc.)
        else {
          // Sum up total from all partitions instead of just taking the last one
          if (firstQueryMetadata.some((partition: any) => partition?.total !== undefined)) {
            resultCount = firstQueryMetadata.reduce((sum: number, partition: any) => {
              return sum + (partition?.total || 0);
            }, 0);
          } else if (Array.isArray(latestPartition?.hits)) {
            resultCount = latestPartition.hits.length;
          } else {
            console.warn(
              "[PreviewAlert] Could not determine result count from metadata:",
              latestPartition,
            );
          }
        }

        // Only write a verdict when a count could actually be DERIVED from this
        // payload. Both producers initialise `state.resultMetaData[qi] = []`
        // immediately before pushing the first frame
        // (usePanelSearchHandlers.ts:131-133, usePanelSQLExecutor.ts:497-499) and
        // the deep watcher emits on that assignment
        // (usePanelDrilldown.ts:104-110), so `[[]]` — and likewise
        // `[null]` and the legacy object writer's `[{ total, hits }]` — arrives at
        // the start of EVERY refresh. Evaluating those falls through every branch
        // with `resultCount` still 0 and flashes "0 rows - WOULD NOT TRIGGER" over
        // a correct verdict.
        //
        // Deliberately NOT the PromQL policy, and the difference is the point: an
        // unusable THRESHOLD means the alert is not configured, so no verdict is
        // meaningful and we withdraw (evaluationStatus = null). An empty PAYLOAD
        // means the data has not arrived yet, so the last known verdict is the
        // best answer available and we leave it standing. Withdrawing here would
        // flash a blank badge instead of a wrong one.
        //
        // A derived count of ZERO is still a verdict and is still written — the
        // guard is on the payload being usable, never on the count being nonzero.
        evaluateAndSetStatus(resultCount, atLeast, measured);
      }
    }
  } catch (error) {
    console.error("[PreviewAlert] Error processing chart data:", error);
  }
};

/** The severity a preview verdict fired at, when the alert has two bands. */
type PreviewLevel = "critical" | "warning";

/**
 * A threshold as a finite number, or null when it is not usable.
 *
 * `0` is a real threshold — `up == 0` and "available replicas <= 0" are the
 * canonical PromQL alerts — so falsiness must not stand in for "unset".
 *
 * Everything else that is not a number must come back null, in every spelling,
 * or the caller silently evaluates against a fabricated threshold: `Number(" ")`
 * is 0, `Number(true)` is 1 and `Number([5])` is 5. Only `number` and `string`
 * can carry one; a trimmed-empty string is a cleared input, not a zero.
 */
const finiteThreshold = (value: unknown): number | null => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const candidate = typeof value === "string" ? value.trim() : value;
  if (candidate === "") return null;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The value the backend would classify this series by, or null if it has none.
 *
 * The backend takes `samples.last()` unconditionally (src/core/src/alerts/mod.rs:265)
 * and then drops the series entirely if that value is not a JSON number
 * (`filter_map(as_f64)`, :274 — `serde_json::Value::from(f64::NAN)` is `Null`).
 * So there are two distinct rules here, and conflating them diverges:
 *
 *  - Walk back over `null` / `undefined` / `""` — those are GAPS, a UI artifact
 *    the backend never sees: the streaming overlay pushes a `[Date, null]`
 *    anchor onto every series (overlayNewDataOnOldOptions.ts:80) and the
 *    aligned-x-axis path fills missing steps with `[time, null]`
 *    (convertPromQLData.ts:714). The check MUST come before `Number()`:
 *    `Number(null)` is `0` and `0` is finite, so without it every series reads
 *    as a hard zero.
 *  - The first genuinely present value IS the sample. If it is not finite the
 *    series does not count — do NOT walk back to an older reading. Values
 *    arrive as STRINGS (`[ts, value.to_string()]`, promql/value.rs:176), so a
 *    tail of "NaN" or "inf" is exactly the case the backend discards.
 */
const classifiableSample = (data: unknown): number | null => {
  if (!Array.isArray(data)) return null;
  for (let i = data.length - 1; i >= 0; i--) {
    const point = data[i];
    const rawValue = Array.isArray(point) ? point[1] : point;
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const value = Number(rawValue);
    return Number.isFinite(value) ? value : null;
  }
  return null;
};

// The converter writes zoned dates or UTC strings; either way the gaps between points are true.
const pointMs = (point: unknown): number | null => {
  const x = Array.isArray(point) ? point[0] : null;
  const ms =
    x instanceof Date ? x.getTime() : typeof x === "string" ? Date.parse(x) : Number(x ?? NaN);
  return Number.isFinite(ms) ? ms : null;
};

/** One alert queries `(expr) op threshold` over the look-back, so a series counts by its last sample past it there. */
const windowedSample = (
  data: unknown,
  fromMs: number,
  passes: (value: number) => boolean,
): number | null => {
  if (!Array.isArray(data)) return null;
  for (let i = data.length - 1; i >= 0; i--) {
    const at = pointMs(data[i]);
    if (at !== null && at < fromMs) return null;
    const rawValue = Array.isArray(data[i]) ? data[i][1] : data[i];
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const value = Number(rawValue);
    if (Number.isFinite(value) && passes(value)) return value;
  }
  return null;
};

/** The backend queries one alert at the less severe band, so the warning series come back too. */
const widenedPromqlThreshold = (
  operator: string | undefined,
  critical: number,
  warning: number | null,
) => {
  if (warning === null) return critical;
  const side = thresholdSide(operator);
  if (side === "above") return Math.min(critical, warning);
  return side === "below" ? Math.max(critical, warning) : critical;
};

/** The end of the newest sample on the chart, which the look-back counts back from. */
const latestSampleMs = (dataSeries: any[]): number => {
  let latest = -Infinity;
  for (const series of dataSeries) {
    for (const point of Array.isArray(series?.data) ? series.data : []) {
      const value = Array.isArray(point) ? point[1] : point;
      if (value === null || value === undefined || value === "") continue;
      latest = Math.max(latest, pointMs(point) ?? -Infinity);
    }
  }
  return latest;
};

/** One sample against one threshold — mirrors `compare` (config/meta/alerts/level.rs:209). */
const promqlSampleMatches = (
  value: number,
  operator: string | undefined,
  threshold: number,
): boolean => {
  switch (operator) {
    case ">":
      return value > threshold;
    case "<=":
      return value <= threshold;
    case "<":
      return value < threshold;
    // The backend maps EqualTo to "==" when it builds the PromQL query.
    case "=":
    case "==":
      return value === threshold;
    case "!=":
      return value !== threshold;
    case ">=":
      return value >= threshold;
    default:
      // Mirrors `compare`'s `_ => false` (level.rs:217): an operator with no
      // numeric meaning classifies NO series. Reachable without an API bug —
      // nothing rejects a non-comparison PromQL operator at save time. The
      // direction check runs only when a warning value is set
      // (alert.rs:720-727) and the rest of PromQL validation is presence-only
      // (alert.rs:770-776), so an alert carrying e.g. `Contains` saves cleanly.
      //
      // What follows is NOT "it never fires" — that reading is wrong twice:
      //  * In single-alert mode the backend bakes the operator into the query,
      //    `format!("({v}) {op} {filter}")` (mod.rs:198-210), producing
      //    `(expr) contains 500` — invalid PromQL. The search returns Err and
      //    mod.rs:242-249 propagates it deliberately, so the alert ERRORS on
      //    every evaluation rather than quietly not firing.
      //  * Zero classified series still reaches the COUNT gate, which reads
      //    `trigger_condition.operator` — a different field from this one. With
      //    no series at all it evaluates `compare(0, tc.operator, tc.threshold)`
      //    (aggregation_level.rs:167), so `<= 0`, `< 1` or `!= N` (N != 0)
      //    returns Some(Critical) on an empty set. The preview reproduces that
      //    faithfully because this function only classifies; the gate is
      //    `evaluateCountGate` and it is not consulted about this operator.
      // Defaulting to `>=` here would invent a classification the backend never
      // makes, and would break the second bullet's zero-series case.
      return false;
  }
};

/**
 * The `trigger_condition` COUNT gate — the coverage gate ("having series >= N"),
 * not the value threshold. Returns the badge text alongside the verdict so a
 * two-band evaluation can report the comparison it actually made last.
 *
 * COUNTER-INTUITIVE, AND DELIBERATE: a count of 0 is a real input, not a
 * short-circuit. The backend runs `compare(0.0, tc.operator, tc.threshold)`
 * unconditionally when nothing classified (aggregation_level.rs:167), so a gate
 * of `<= 0`, `< 1` or `!= N` (N != 0) fires with no matching item at all. Do not
 * "fix" that by returning `{ passes: false }` early on `count === 0`, and do not
 * add such a guard in `evaluatePromqlSeries` either — it would make the preview
 * disagree with the engine. Pinned by the `<= 0` tests in PreviewAlert.spec.ts.
 */
const evaluateCountGate = (count: number): { passes: boolean; comparison: string } => {
  // Coerced, and NOT only for PromQL: `evaluateCountGate` is shared with the
  // SQL, builder and aggregation callers, and the form hands every one of them
  // the raw input value. Uncoerced, `===`/`!==` against a string threshold
  // reports a self-contradicting "1 == 1 -> no match" — a latent bug on all four
  // paths, so the coercion belongs at the gate rather than at the one caller
  // that surfaced it.
  const threshold = Number(props.formData.trigger_condition?.threshold || 0);
  const operator = props.formData.trigger_condition?.operator || ">=";

  switch (operator) {
    case ">=":
      return { passes: count >= threshold, comparison: `${count} >= ${threshold}` };
    case ">":
      return { passes: count > threshold, comparison: `${count} > ${threshold}` };
    case "<=":
      return { passes: count <= threshold, comparison: `${count} <= ${threshold}` };
    case "<":
      return { passes: count < threshold, comparison: `${count} < ${threshold}` };
    case "==":
    case "=":
      return { passes: count === threshold, comparison: `${count} == ${threshold}` };
    case "!=":
      return { passes: count !== threshold, comparison: `${count} != ${threshold}` };
    default:
      return { passes: false, comparison: "" };
  }
};

/** The noun the badge counts in: series for PromQL, groups/rows/points otherwise. */
const resultLabelFor = (resultCount: number): I18nText => {
  const plural = resultCount !== 1;

  // PromQL counts SERIES. It must key off the MODE, not off the chart type (the
  // preview hardcodes "line" for PromQL, which is what made a series count come
  // out labelled "data points") and not off the presence of a promql_condition
  // (the form keeps one around after the user switches tabs).
  if (props.selectedTab === "promql") {
    return plural
      ? t("alerts.previewEvaluation.matchingSeriesPlural")
      : t("alerts.previewEvaluation.matchingSeries");
  }

  // The SQL limit counts the rows the query returns, whatever chart draws them.
  if (props.selectedTab === "sql") {
    return plural ? t("alerts.previewEvaluation.rows") : t("alerts.previewEvaluation.row");
  }

  const chartType = dashboardPanelData.data.type;
  const hasGroupBy =
    dashboardPanelData.data.queries[0]?.fields?.breakdown?.length > 0 ||
    dashboardPanelData.data.queries[0]?.fields?.x?.length > 0;

  if (props.isAggregationEnabled && hasGroupBy) {
    return plural
      ? t("alerts.previewEvaluation.matchingGroups")
      : t("alerts.previewEvaluation.matchingGroup");
  }
  if (chartType === "line") {
    return plural
      ? t("alerts.previewEvaluation.dataPoints")
      : t("alerts.previewEvaluation.dataPoint");
  }
  if (chartType === "table") {
    return plural ? t("alerts.previewEvaluation.rows") : t("alerts.previewEvaluation.row");
  }
  return plural ? t("alerts.previewEvaluation.results") : t("alerts.previewEvaluation.result");
};

/**
 * Real-time alerts get a neutral message: the preview shows historical data, so
 * there is no verdict to compute. Checked by every entry point BEFORE it counts
 * anything, so nothing is evaluated only to be thrown away.
 */
const isRealTimeAlert = (): boolean =>
  props.formData.is_real_time === "true" || props.formData.is_real_time === true;
const writeRealTimeStatus = (count?: number): boolean => {
  if (!isRealTimeAlert()) return false;
  evaluationStatus.value = {
    wouldTrigger: true,
    reason: t("alerts.previewEvaluation.realTimeReason"),
    ...(count === undefined ? {} : { count, windowMinutes: previewMinutes() }),
  };
  return true;
};

/**
 * Write the badge. `level` names the severity that fired, and is set only when
 * the alert has two bands — with a single band there is nothing to disambiguate
 * and the sentence must carry no severity word at all.
 */
const setEvaluationStatus = (verdict: {
  count: number;
  atLeast?: boolean;
  wouldTrigger: boolean;
  comparison: string;
  level?: PreviewLevel | null;
  value?: number;
}) => {
  const args = {
    count: previewCountText(verdict.count, verdict.atLeast, t),
    label: resultLabelFor(verdict.count),
    comparison: verdict.comparison,
  };
  const sentence = verdict.wouldTrigger
    ? t("alerts.previewEvaluation.reasonMatch", args)
    : t("alerts.previewEvaluation.reasonNoMatch", args);

  const groupBy: string[] = props.formData.query_condition?.aggregation?.group_by ?? [];
  evaluationStatus.value = {
    wouldTrigger: verdict.wouldTrigger,
    count: verdict.count,
    atLeast: verdict.atLeast,
    label: args.label,
    ...(verdict.value === undefined ? {} : { value: verdict.value }),
    grouped:
      sqlPerGroup() ||
      (props.selectedTab === "custom" &&
        props.isAggregationEnabled &&
        groupBy.some((f) => !!f && f.trim() !== "")),
    reason: verdict.level
      ? t("alerts.previewEvaluation.reasonLevel", {
          reason: sentence,
          level:
            verdict.level === "critical"
              ? t("alerts.previewEvaluation.levelCritical")
              : t("alerts.previewEvaluation.levelWarning"),
        })
      : sentence,
  };
};

// Evaluate and set status based on a result count already gated on value
// (rows, groups, data points). PromQL goes through evaluatePromqlSeries instead.
const evaluateAndSetStatus = (resultCount: number, atLeast = false, value?: number) => {
  if (writeRealTimeStatus(resultCount)) return;
  // Any one group past its threshold fires; the saved row-count gate is always "at least 1".
  if (sqlPerGroup()) {
    setEvaluationStatus({
      count: resultCount,
      atLeast,
      wouldTrigger: resultCount > 0,
      comparison: "",
    });
    return;
  }

  // A lower bound decides only when every count from it up gets the same answer.
  const threshold = Number(props.formData.trigger_condition?.threshold || 0);
  const operator = props.formData.trigger_condition?.operator || ">=";
  if (
    atLeast &&
    !(resultCount > threshold || (resultCount === threshold && [">=", "<"].includes(operator)))
  ) {
    evaluationStatus.value = null;
    return;
  }
  const gate = evaluateCountGate(resultCount);
  setEvaluationStatus({
    count: resultCount,
    atLeast,
    wouldTrigger: gate.passes,
    comparison: gate.comparison,
    value,
  });
};

/**
 * The PromQL verdict, mirroring `evaluate_level_over_items`
 * (config/meta/alerts/aggregation_level.rs:146):
 *
 *  1. classify each series by its sample — critical first, most severe wins
 *  2. gate `criticalCount`; a pass fires CRITICAL and the warning count is never
 *     consulted
 *  3. otherwise gate `firingCount` (warning-or-worse, so a critical series counts
 *     in both); a pass fires WARNING
 *
 * There is exactly ONE count gate: `trigger_condition.warning_threshold` is
 * rejected at save time for PromQL (src/core/src/alerts/alert.rs:680-696), so the
 * backend's `warning_threshold.unwrap_or(threshold)` collapses to `threshold`.
 * `widened_threshold` only ever widens the backend's QUERY, never the counts.
 *
 * One per series runs the raw query and reads the last sample. One alert filters the query
 * at the threshold over the look-back, so a series that crossed and came back still counts.
 */
const evaluatePromqlSeries = (dataSeries: any[]) => {
  if (writeRealTimeStatus()) return;

  if (props.formData.query_condition?.promql_rule_mode) return;
  const promqlCondition = props.formData.query_condition?.promql_condition;
  const critical = finiteThreshold(promqlCondition?.value);
  const warning = finiteThreshold(props.formData.query_condition?.promql_warning_value);
  // No `?? ">="` fallback: a missing operator is as meaningless as an
  // unrecognised one (Rust's `operator: Operator` has no serde default, so the
  // backend can never receive a condition without one), and both must reach the
  // same answer rather than having the preview invent a comparison.
  const operator: string | undefined = promqlCondition?.operator;

  // No usable threshold — no condition at all, or a value that is not a finite
  // number — means there is nothing to classify against, so there is no verdict
  // to show. Counting every series instead would reinstate the exact tautology
  // this fixes, and dressed as a condition match ("2 series match (2 >= 1)") it
  // reads as MORE authoritative than the old bug. It is an ordinary gesture, not
  // a corner case: a number input emits "" the moment the user clears the field.
  if (critical === null) {
    evaluationStatus.value = null;
    return;
  }

  // The COUNT gate needs a usable number for the same reason. Clearing the
  // "having series" box gives "", and `Number("" || 0)` is 0, so the badge would
  // announce "0 series match (0 >= 0)" — WOULD TRIGGER over an empty result set,
  // the same tautology on the other threshold. An explicit 0 is still a real
  // gate and is evaluated (`compare(0, >=, 0)` is true on the backend too); only
  // an unusable value withdraws.
  //
  // The WITHDRAWAL is scoped to PromQL on purpose: the SQL, builder and
  // aggregation callers still evaluate an unusable count threshold as 0, which
  // predates this fix and is out of its scope. The inconsistency is known, not
  // an oversight — the same treatment for those paths is a follow-up.
  //
  // The `Number()` COERCION inside `evaluateCountGate` is deliberately NOT so
  // scoped, and the two must not be read as one decision: that coercion removes
  // a self-contradicting "1 == 1 -> no match" which the shared callers hit just
  // as PromQL does, so it is applied at the gate and changes their behaviour on
  // purpose. Same reasoning for the `Number(p?.total)` in the plain SQL sum,
  // which stops `+` concatenating string totals into "0102".
  if (finiteThreshold(props.formData.trigger_condition?.threshold) === null) {
    evaluationStatus.value = null;
    return;
  }

  let criticalCount = 0;
  let firingCount = 0; // warning-or-worse

  const single = !props.formData.query_condition?.promql_multi_alert;
  const widened = widenedPromqlThreshold(operator, critical, warning);
  const periodMs = (Number(props.formData.trigger_condition?.period) || 0) * 60_000;
  const fromMs = latestSampleMs(dataSeries) - periodMs;
  for (const series of dataSeries) {
    const value = single
      ? windowedSample(series?.data, fromMs, (v) => promqlSampleMatches(v, operator, widened))
      : classifiableSample(series?.data);
    if (value === null) continue;
    if (promqlSampleMatches(value, operator, critical)) {
      criticalCount++;
      firingCount++;
    } else if (warning !== null && promqlSampleMatches(value, operator, warning)) {
      firingCount++;
    }
  }

  const drawn = drawnSeries.value;
  const sampled = !!drawn && drawn.total > drawn.shown;
  seriesCountGeneration++;
  // The sample's lower bound is written only if the full count fails, so the verdict changes once.
  const fromSample = () => writePromqlVerdict(criticalCount, firingCount, sampled);
  if (sampled && !props.formData._ui?.forecast)
    void countAllSeries(critical, warning, operator, fromSample);
  else fromSample();
};

/** The verdict from the series past each band; `atLeast` when they were counted from a sample. */
const writePromqlVerdict = (criticalCount: number, firingCount: number, atLeast: boolean) => {
  const critical = finiteThreshold(props.formData.query_condition?.promql_condition?.value);
  const hasWarningBand =
    finiteThreshold(props.formData.query_condition?.promql_warning_value) !== null;

  const criticalGate = evaluateCountGate(criticalCount);
  const forecast = props.formData._ui?.forecast;
  if (forecast) {
    // The summary states nothing until the horizon is usable, and the verdict must not contradict it.
    if (critical === null || !isForecastHorizonValid(critical)) {
      evaluationStatus.value = null;
      return;
    }
    evaluationStatus.value = {
      wouldTrigger: criticalGate.passes,
      reason: t("alerts.forecast.previewReason", {
        count: criticalCount,
        threshold: forecast.T,
        horizon: t("alerts.forecast.dayCount", { n: critical }, critical),
      }),
    };
    return;
  }
  if (criticalGate.passes) {
    setEvaluationStatus({
      count: criticalCount,
      atLeast,
      wouldTrigger: true,
      comparison: criticalGate.comparison,
      level: hasWarningBand ? "critical" : null,
    });
    return;
  }

  // The badge reports the widest count actually gated, so a near-miss explains
  // itself. With no warning band firingCount === criticalCount, and the backend
  // never consults the second gate at all — hence `hasWarningBand &&`.
  const firingGate = evaluateCountGate(firingCount);
  const firesWarning = hasWarningBand && firingGate.passes;
  // A quiet count from a sample says nothing about the series not drawn.
  if (atLeast && !firesWarning) {
    evaluationStatus.value = null;
    return;
  }
  setEvaluationStatus({
    count: firingCount,
    atLeast,
    wouldTrigger: firesWarning,
    comparison: firingGate.comparison,
    level: firesWarning ? "warning" : null,
  });
};

const PROMQL_OPERATORS: Record<string, string> = {
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<=",
  "=": "==",
  "==": "==",
  "!=": "!=",
};
let promqlEndSeconds = 0;
let seriesCountGeneration = 0;
// The chart draws only some series, so the server counts all of them past each band at the chart's end.
const countAllSeries = async (
  critical: number,
  warning: number | null,
  operator: string | undefined,
  fromSample: () => void,
) => {
  const generation = ++seriesCountGeneration;
  const op = PROMQL_OPERATORS[operator ?? ""];
  if (!op) return fromSample();
  const query = props.query;
  const org = store.state.selectedOrganization.identifier;
  const period = Number(props.formData.trigger_condition?.period) || 0;
  // One alert counts a series that crossed anywhere in the look-back, as its filtered query does.
  const series =
    props.formData.query_condition?.promql_multi_alert || period <= 0
      ? `(${query})`
      : `last_over_time(((${query}) ${op} ${widenedPromqlThreshold(operator, critical, warning)})[${period}m:])`;
  const past = (limit: number) =>
    queryClient.fetchQuery(promRulePreviewQuery(org, `${series} ${op} ${limit}`, promqlEndSeconds));
  try {
    const [criticalCount, firingCount] = await Promise.all([
      past(critical),
      warning === null ? null : past(warning),
    ]);
    if (generation !== seriesCountGeneration || query !== props.query) return;
    writePromqlVerdict(criticalCount, firingCount ?? criticalCount, false);
  } catch {
    if (generation === seriesCountGeneration && query === props.query) fromSample();
  }
};

const chartDataSeries = (seriesData: any): any[] =>
  (Array.isArray(seriesData?.options?.series) ? seriesData.options.series : []).filter((s: any) => {
    const hasData = Array.isArray(s?.data);
    const hasMultiplePoints = hasData && s.data.length > 1;
    const hasName = s?.name !== undefined && s?.name !== null;
    return (hasName || hasMultiplePoints) && hasData;
  });

// Counts the drawn series in every mode; judges the verdict for PromQL only (every other mode is
// evaluated from partition metadata in handleChartDataUpdate).
const handleSeriesDataUpdate = (seriesData: any) => {
  if (previewError.value?.message) return emit("value-range", null);
  emit("value-range", seriesValueRange(chartDataSeries(seriesData)));
  const named = chartDataSeries(seriesData).length;
  const limit = seriesData?.extras?.seriesLimit;
  drawnSeries.value = { shown: named, total: Math.max(Number(limit?.total) || 0, named) };
  if (props.selectedTab === "promql" && named === 0 && props.query)
    void explainNoSeries(props.query);
  else clearNoSeries();
  if (!props.formData.trigger_condition) return;
  if (props.selectedTab !== "promql") return;

  try {
    // PanelSchemaRenderer only ever emits panelData, i.e. the converted ECharts
    // option (PanelSchemaRenderer.vue:1338). A payload with no series is
    // evaluated as zero rather than skipped, so a refresh that stops matching
    // replaces its own stale verdict. (That is not a guarantee the renderer
    // makes: on a zero-result completion with a chart already on screen it
    // returns without reassigning panelData (:1204), so the deep watch never
    // fires and this handler is not called at all.)

    // Drop entries that carry no data. DEFENCE IN DEPTH, not load-bearing:
    // besides the markLine attached to each data series
    // (convertPromQLData.ts:724), every time-series chart also gets a DEDICATED
    // nameless markLine/markArea series (:1083) whose data is a single
    // `[ts, null]` point. The predicate excludes it (no name, one point) — but
    // `classifiableSample` rejects it independently, reading that lone `null` as
    // a gap and returning null, so dropping this filter would not move a single
    // verdict against either producer today. It is kept as the cheaper barrier,
    // and because it does not depend on that point staying null: a nameless
    // one-point series carrying a real NUMBER would be classified without it.
    evaluatePromqlSeries(chartDataSeries(seriesData));
  } catch (error) {
    console.error("[PreviewAlert] Error processing series data:", error);
  }
};

// "No Data" alone can't tell a filter that matched nothing from a quiet metric, so the chart says which.
const noSeriesText = ref<I18nText | null>(null);
// The builder says it the same way, over the counts of the range the chart shows.
const filterNotSeen = computed((): I18nText | null => {
  if (props.selectedTab !== "custom" || !filterDrewNothing.value) return null;
  const minutes = previewMinutes();
  const tree = FILTER_PROFILES.alert.codec.parse(props.formData.query_condition?.conditions, {
    fields: [],
  });
  const ctx = {
    org: store.state.selectedOrganization.identifier,
    streamType: props.formData.stream_type,
    streamName: props.formData.stream_name,
    windowUs: minutes >= 24 * 60 ? undefined : minutes * 60_000_000,
  };
  return filterNotSeenText(ctx, tree, durationWords(minutes, t), t) ?? null;
});
const emptyChartText = computed(() =>
  props.selectedTab === "promql" ? noSeriesText.value : filterNotSeen.value,
);
let noSeriesGeneration = 0;
const clearNoSeries = () => {
  noSeriesGeneration++;
  noSeriesText.value = null;
};
const explainNoSeries = async (query: string) => {
  const generation = ++noSeriesGeneration;
  const org = store.state.selectedOrganization.identifier;
  try {
    const selectors = selectorsOf(await queryClient.fetchQuery(promqlParseTreeQuery(org, query)));
    const names = [...new Set(selectors.map((selector) => selector.name))];
    const endMicros = Date.now() * 1000;
    const series = await Promise.all(
      names.map((name) => queryClient.fetchQuery(promqlDaySeriesQuery(org, name, endMicros))),
    );
    if (generation !== noSeriesGeneration || query !== props.query) return;
    const reason = noSeriesReason(selectors, (name) => series[names.indexOf(name)] ?? []);
    noSeriesText.value = reason ? noSeriesSentence(reason, t) : null;
  } catch {
    if (generation === noSeriesGeneration) noSeriesText.value = null;
  }
};

let rulePreviewGeneration = 0;
const refreshRulePreview = async (at: number) => {
  const generation = ++rulePreviewGeneration;
  const expression = props.query;
  evaluationStatus.value = null;
  try {
    const count = await queryClient.fetchQuery(
      promRulePreviewQuery(store.state.selectedOrganization.identifier, expression, at),
    );
    if (
      generation !== rulePreviewGeneration ||
      expression !== props.query ||
      !props.formData.query_condition?.promql_rule_mode
    )
      return;
    const holdSec = Number(props.formData.pending_period_sec) || 0;
    evaluationStatus.value = {
      wouldTrigger: count > 0,
      reason:
        holdSec > 0
          ? t(
              "alerts.form.preview.ruleMatch",
              { count: formatNumber(count), duration: durationText(holdSec, t) },
              count,
            )
          : t("alerts.form.preview.ruleMatchNow", { count: formatNumber(count) }, count),
    };
  } catch {
    if (generation === rulePreviewGeneration) evaluationStatus.value = null;
  }
};

// The server's own step gives about 300 points, which on a wide range skips most checks.
const promqlCheckStepSeconds = (rangeMinutes: number): number => {
  const tc = props.formData.trigger_condition ?? {};
  const minutes = Number(tc.frequency) || 0;
  if (tc.frequency_type === "cron" || minutes <= 0) return 0;
  return rangeMinutes / 300 > minutes && rangeMinutes / minutes <= 1440 ? minutes * 60 : 0;
};

let lastRunKey = "";
// The chart may cover several checks, but the verdict judges the latest window only.
let verdictWindowStartMs = 0;
// A wide range draws wide buckets; one wider than the window cannot say what the latest window held.
const bucketsCoarserThanWindow = (resultMetaData: any): boolean => {
  const times = (Array.isArray(resultMetaData?.[0]) ? resultMetaData[0] : [])
    .flatMap((partition: any) => (Array.isArray(partition?.hits) ? partition.hits : []))
    .map((hit: any) => keyToMs(hit?.zo_sql_key))
    .filter((at: number | null): at is number => at !== null)
    .sort((a: number, b: number) => a - b);
  let bucketMs = Infinity;
  for (let i = 1; i < times.length; i++) {
    if (times[i] > times[i - 1]) bucketMs = Math.min(bucketMs, times[i] - times[i - 1]);
  }
  return Number.isFinite(bucketMs) && bucketMs > alertWindowMinutes() * 60_000;
};
const inVerdictWindow = (hit: { zo_sql_key?: unknown }): boolean => {
  const at = keyToMs(hit?.zo_sql_key);
  return at === null || at >= verdictWindowStartMs;
};

const refreshData = () => {
  // Skip if there is no query to run (e.g. user switched to SQL/PromQL
  // without writing a query yet, or closed the editor with an empty query).
  if (!props.query) {
    return;
  }

  // Safety check: ensure trigger_condition exists
  if (!props.formData.trigger_condition) {
    console.warn("[PreviewAlert] No trigger_condition found, skipping refreshData");
    return;
  }

  const new_relative_time = previewMinutes();
  const windowCount = windowCountQuery();
  selfBucketed.value = !!windowCount;
  // Every input the preview request depends on; asking again with the same ones fetches nothing new.
  const runKey = JSON.stringify([
    props.query,
    props.selectedTab,
    props.isAggregationEnabled,
    props.isUsingBackendSql,
    props.formData.stream_name,
    props.formData.stream_type,
    props.formData.query_condition?.vrl_function,
    props.formData.query_condition?.promql_rule_mode,
    props.formData.query_condition?.promql_condition,
    props.formData.query_condition?.aggregation,
    props.formData.trigger_condition?.threshold,
    props.formData.trigger_condition?.operator,
    props.formData._ui?.forecast,
    new_relative_time,
    verdictNeedsOwnSearch() && alertWindowMinutes(),
  ]);
  if (runKey === lastRunKey) return;
  lastRunKey = runKey;

  // A sample per check keeps the peaks a check sees; aligned, the samples fall on the check times.
  const stepSeconds =
    props.selectedTab === "promql" ? promqlCheckStepSeconds(new_relative_time) : 0;
  const stepMicros = stepSeconds * 1_000_000;
  const now = new Date().getTime() * 1000;
  const endTime = stepMicros ? Math.floor(now / stepMicros) * stepMicros : now;
  promqlEndSeconds = endTime / 1_000_000;
  dashboardPanelData.data.config.step_value = stepSeconds ? `${stepSeconds}s` : "0";
  runVerdictSearch(endTime);
  void checkBaselines(endTime);
  if (props.selectedTab === "promql" && props.formData.query_condition?.promql_rule_mode)
    void refreshRulePreview(endTime / 1_000_000);
  else rulePreviewGeneration++;

  const startTime = endTime - new_relative_time * 60 * 1000000;
  verdictWindowStartMs =
    endTime / 1000 - (Number(props.formData.trigger_condition?.period) || 0) * 60_000;

  dashboardPanelData.meta.dateTime = {
    start_time: new Date(startTime),
    end_time: new Date(endTime),
  };

  let xAxis = [
    {
      alias: "zo_sql_key",
      color: null,
      column: store.state.zoConfig.timestamp_column || "_timestamp",
      label: t("alerts.timestamp"),
    },
  ];

  let yAxis: Array<{
    label: I18nText;
    alias: string;
    column: string;
    color: string | null;
  }> = [];

  // Handle SQL mode and custom mode with aggregations - use result_schema API to intelligently determine chart type
  if (
    props.selectedTab === "sql" ||
    (props.selectedTab === "custom" && props.isAggregationEnabled)
  ) {
    // The editor can mount (and this watcher fire) before the user has
    // picked a stream — result_schema 400s on a stream-less/invalid query,
    // so wait until the form actually has one.
    if (!props.formData.stream_name || !props.formData.stream_type) {
      return;
    }
    // Use result_schema API to get query structure
    fetchQuerySchema();
    return;
  }

  // Handle PromQL mode - configure for time-series visualization
  if (props.selectedTab === "promql") {
    // PromQL mode: query should be a string, not an object
    dashboardPanelData.data.queries[0].query = props.query || "";
    dashboardPanelData.data.queries[0].vrlFunctionQuery = null; // VRL not supported in PromQL mode
    dashboardPanelData.data.config.table_dynamic_columns = false; // VRL not supported in PromQL mode
    dashboardPanelData.data.queries[0].customQuery = false;
    dashboardPanelData.data.queries[0].fields.x = [];
    dashboardPanelData.data.queries[0].fields.y = [];
    dashboardPanelData.data.queries[0].fields.z = [];
    dashboardPanelData.data.queries[0].fields.breakdown = [];
    dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
    dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
    dashboardPanelData.data.queries[0].config.promql_mode = true;
    // A binary operator or an aggregation strips every label, leaving a series
    // the legend renders as "{}". Name it after what the alert measures — the
    // same fallback AlertGroupChart uses. Consulted only when a series has no
    // name of its own to give: labels that identify it always win.
    const forecast = props.formData._ui?.forecast;
    dashboardPanelData.data.queries[0].config.promql_legend_fallback = forecast
      ? t("alerts.forecast.previewSeries", { threshold: forecast.T })
      : props.formData.stream_name || t("alerts.preview");
    dashboardPanelData.data.queryType = "promql";
    dashboardPanelData.data.type = "line"; // Default chart type for PromQL time-series

    // Add threshold mark line from promql_condition
    applyThresholds();

    // Update both refs together to prevent double watcher triggers
    const newChartData = cloneDeep(dashboardPanelData.data);
    clearFieldLabels(newChartData);
    const newTimeObj = { ...dashboardPanelData.meta.dateTime };

    chartData.value = newChartData;
    selectedTimeObj.value = newTimeObj;

    return;
  }

  // Handle custom mode without aggregations - configure for histogram visualization
  // The backend automatically converts the query to histogram (zo_sql_key, zo_sql_num)
  if (props.selectedTab === "custom" && !props.isAggregationEnabled) {
    // Configure x-axis for zo_sql_key (timestamp buckets)
    xAxis = [
      {
        label: t("alerts.timeLabel"),
        alias: "zo_sql_key",
        column: "zo_sql_key",
        color: null,
      },
    ];

    // Configure y-axis for zo_sql_num (counts)
    yAxis = [
      {
        label: raw("count"),
        alias: "zo_sql_num",
        column: "zo_sql_num",
        color: "#5960b2",
      },
    ];

    dashboardPanelData.data.queries[0].fields.x = xAxis;
    dashboardPanelData.data.queries[0].fields.y = yAxis;
    dashboardPanelData.data.queries[0].fields.z = [];
    dashboardPanelData.data.queries[0].fields.breakdown = [];
    dashboardPanelData.data.queries[0].customQuery = true;
    dashboardPanelData.data.queries[0].query = windowCount ?? props.query;
    dashboardPanelData.data.queries[0].vrlFunctionQuery = null; // VRL not supported in custom mode
    dashboardPanelData.data.config.table_dynamic_columns = false; // VRL not supported in custom mode
    dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
    dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
    dashboardPanelData.data.queryType = "sql";
    dashboardPanelData.data.type = "line"; // Line chart for histogram
    applyThresholds();

    // Update both refs together to prevent double watcher triggers
    const newChartData = cloneDeep(dashboardPanelData.data);
    clearFieldLabels(newChartData);
    const newTimeObj = { ...dashboardPanelData.meta.dateTime };

    chartData.value = newChartData;
    selectedTimeObj.value = newTimeObj;

    return;
  }

  // Fallback for any other modes (shouldn't reach here in normal flow)
  dashboardPanelData.data.queries[0].fields.x = xAxis;
  dashboardPanelData.data.queries[0].fields.y = yAxis;
  dashboardPanelData.data.queries[0].fields.breakdown = [];

  dashboardPanelData.data.queries[0].customQuery = props.selectedTab === "custom";
  dashboardPanelData.data.queries[0].query = props.query;
  // VRL function is only supported in SQL mode
  dashboardPanelData.data.queries[0].vrlFunctionQuery =
    props.selectedTab === "sql" ? getDecodedVrlFunction() : null;
  // Enable dynamic columns when VRL function is present
  dashboardPanelData.data.config.table_dynamic_columns =
    props.selectedTab === "sql" && props.formData.query_condition?.vrl_function ? true : false;
  dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
  dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
  dashboardPanelData.data.queryType = props.selectedTab === "promql" ? "promql" : "sql";

  // Update both refs together
  // Note: Updating both chartData and selectedTimeObj may trigger two separate watchers
  // in usePanelDataLoader, resulting in duplicate query_range API calls for PromQL queries
  const newChartData = cloneDeep(dashboardPanelData.data);
  clearFieldLabels(newChartData);
  const newTimeObj = { ...dashboardPanelData.meta.dateTime };

  chartData.value = newChartData;
  selectedTimeObj.value = newTimeObj;

  // Note: Alert status evaluation now happens via handleChartDataUpdate event from PanelSchemaRenderer
};

const streaming = useHttpStreaming();
let verdictTraceId = "";
const cancelVerdictSearch = () => {
  if (!verdictTraceId) return;
  streaming.cancelStreamQueryBasedOnRequestId({
    trace_id: verdictTraceId,
    org_id: store.state.selectedOrganization?.identifier,
  });
  verdictTraceId = "";
};

// A builder verdict is one row per group over the whole window, as the check computes it;
// re-adding bucket values would average a percentile or drop a bucket that straddles the window.
const verdictQuery = (): string | null => {
  if (props.selectedTab !== "custom") return props.query;
  const bucketed = props.isAggregationEnabled
    ? cleanAggregationQuery(props.query)
    : /\bhistogram\(/i.test(props.query)
      ? props.query
      : buildCountChartQuery(props.query);
  return bucketed ? (withoutTimeBucket(bucketed) ?? bucketed) : null;
};
// The latest window's answer, kept so a new threshold is judged at once against the same rows.
let verdictFrames: any[] | null = null;
const judgeVerdictFrames = () => {
  if (verdictFrames && !previewError.value?.message)
    evaluateResultMetadata([verdictFrames], () => true);
};

/** The alert's own query over its latest window alone, for a range the chart cannot judge. */
const runVerdictSearch = (endMicros: number) => {
  cancelVerdictSearch();
  verdictFrames = null;
  const { stream_name, stream_type } = props.formData;
  const sql = verdictNeedsOwnSearch() ? verdictQuery() : null;
  if (!sql || !stream_name || !stream_type) {
    verdictSearchError.value = null;
    return;
  }
  const vrl = props.selectedTab === "sql" ? getDecodedVrlFunction() : null;
  const traceId = generateTraceContext().traceId;
  verdictTraceId = traceId;
  const frames: any[] = [];
  streaming.fetchQueryDataWithHttpStream(
    {
      queryReq: {
        query: {
          sql: b64EncodeUnicode(sql),
          ...(vrl ? { query_fn: b64EncodeUnicode(vrl) } : {}),
          start_time: endMicros - alertWindowMinutes() * 60_000_000,
          end_time: endMicros,
          size: -1,
        },
        encoding: "base64",
      },
      type: "search",
      traceId,
      org_id: store.state.selectedOrganization?.identifier,
      pageType: stream_type,
      searchType: searchTypeForPanel.value,
      meta:
        props.selectedTab === "custom"
          ? {}
          : shouldUseHistogram.value
            ? { is_ui_histogram: true, fallback_order_by_col: "zo_sql_key" }
            : {},
    },
    {
      data: (_request: unknown, response: any) => {
        if (traceId !== verdictTraceId) return;
        const content = response?.content ?? {};
        if (response?.type === "search_response_metadata") {
          frames.push({ ...content, ...content.results });
        } else if (response?.type === "search_response_hits") {
          if (!frames.length) frames.push({});
          frames[frames.length - 1].hits = content.results?.hits ?? [];
        }
      },
      error: (_request: unknown, response: any) => {
        if (traceId !== verdictTraceId) return;
        verdictTraceId = "";
        const content = response?.content ?? {};
        verdictSearchError.value = {
          message: content.message || content.error_detail || t("search.unknownError"),
          code: content.code ?? content.status ?? "",
        };
      },
      complete: () => {
        if (traceId !== verdictTraceId) return;
        verdictTraceId = "";
        verdictSearchError.value = null;
        // A streaming aggregate's every frame is the whole answer so far, so only the last one counts.
        const cumulative = frames.some((frame) => frame?.streaming_aggs === true);
        verdictFrames =
          cumulative && props.selectedTab === "custom"
            ? frames.filter((frame) => Array.isArray(frame?.hits)).slice(-1)
            : frames;
        judgeVerdictFrames();
      },
    },
  );
};

// A compare alert's rows depend on its past windows, which the preview's one search never reads.
const comparisons = computed(() =>
  props.selectedTab === "sql"
    ? comparisonWindows(props.formData.query_condition?.multi_time_range)
    : [],
);
// What the past windows held: null until searched; `empty` names those with no rows.
const baselines = ref<{ all: string; empty: string | null } | null>(null);
// Waiting for the past is a choice in the function, so ticking it changes the words, not the search.
const compareWaits = computed(
  () =>
    compareRule(smartDecodeVrlFunction(props.formData.query_condition?.vrl_function ?? ""))
      ?.needsBaseline === true,
);
const compareStatus = computed((): NonNullable<typeof evaluationStatus.value> | null => {
  const b = baselines.value;
  if (!b) return null;
  if (!b.empty)
    return {
      wouldTrigger: false,
      reason: t("alerts.form.preview.compareNote", { offset: b.all }),
      note: "note",
    };
  return compareWaits.value
    ? {
        wouldTrigger: false,
        reason: t("alerts.form.preview.compareWaitsForBaseline", { offset: b.empty }),
        note: "note",
      }
    : {
        wouldTrigger: false,
        reason: t("alerts.form.preview.compareNoBaseline", { offset: b.empty }),
        note: "warn",
      };
});
const chartCaption = computed(() =>
  previewCaption(
    {
      tab: props.selectedTab,
      streamType: props.formData.stream_type,
      query: props.query,
      measured: !!props.isAggregationEnabled,
      aggregation: props.formData.query_condition?.aggregation,
      sqlColumn: sqlPerGroup() ? props.formData.query_condition.aggregation.having.column : null,
    },
    t,
  ),
);
const baselineEmptyText = computed(() =>
  baselines.value?.empty ? raw(baselines.value.empty) : null,
);
let compareGeneration = 0;
let compareTraceIds: string[] = [];
const cancelBaselineSearches = () => {
  compareGeneration++;
  for (const trace_id of compareTraceIds)
    streaming.cancelStreamQueryBasedOnRequestId({
      trace_id,
      org_id: store.state.selectedOrganization?.identifier,
    });
  compareTraceIds = [];
};
/** Rows the query matches between the two times, or null when the search fails. */
const countRows = (sql: string, startMicros: number, endMicros: number) =>
  new Promise<number | null>((resolve) => {
    const traceId = generateTraceContext().traceId;
    compareTraceIds.push(traceId);
    let total = 0;
    streaming.fetchQueryDataWithHttpStream(
      {
        queryReq: {
          query: {
            sql: b64EncodeUnicode(sql),
            start_time: startMicros,
            end_time: endMicros,
            size: -1,
          },
          encoding: "base64",
        },
        type: "search",
        traceId,
        org_id: store.state.selectedOrganization?.identifier,
        pageType: props.formData.stream_type,
        searchType: "UI",
        meta: {},
      },
      {
        data: (_request: unknown, response: any) => {
          if (response?.type !== "search_response_hits") return;
          for (const hit of response?.content?.results?.hits ?? [])
            total += Number(hit?.zo_sql_num) || 0;
        },
        error: () => resolve(null),
        complete: () => resolve(total),
      },
    );
  });
const checkBaselines = async (endMicros: number) => {
  cancelBaselineSearches();
  const mine = compareGeneration;
  baselines.value = null;
  const windows = comparisons.value;
  if (!windows.length || !props.query) return;
  const period = alertWindowMinutes();
  const offset = (shown: typeof windows) => comparisonOffsetText(shown, getIntlLocale());
  const count = buildCountChartQuery(props.query);
  if (!count || period <= 0) {
    baselines.value = { all: offset(windows), empty: null };
    return;
  }
  const sql = withHistogramMinutes(count, period);
  const totals = await Promise.all(
    windows.map((window) =>
      countRows(
        sql,
        endMicros - (window.minutes + period) * 60_000_000,
        endMicros - window.minutes * 60_000_000,
      ),
    ),
  );
  if (mine !== compareGeneration) return;
  compareTraceIds = [];
  const empty = windows.filter((_, i) => totals[i] === 0);
  baselines.value = { all: offset(windows), empty: empty.length ? offset(empty) : null };
};
watch(
  () => JSON.stringify(comparisons.value),
  () => {
    lastRunKey = "";
    refreshFromProps();
  },
);

let lastRefreshTime = 0;

const refreshDataOnce = () => {
  const now = Date.now();
  const timeSinceLastCall = now - lastRefreshTime;

  // Prevent multiple calls within 200ms (skip check on first call)
  // 200ms window catches both usePanelDataLoader watchers firing from dateTime + panelSchema updates
  if (lastRefreshTime > 0 && timeSinceLastCall < 200) {
    return;
  }

  lastRefreshTime = now;
  refreshData();
};

// Checks run when the debounce fires, so they see the props as they are after the pause.
const refreshFromProps = () => {
  // Skip if editor is open - we'll refresh when it closes
  if (props.isEditorOpen) {
    return;
  }

  // A builder value alert waits for its value; the SQL and PromQL tabs keep the builder's flag but not its query.
  if (
    props.selectedTab === "custom" &&
    props.isAggregationEnabled &&
    props.formData.query_condition?.aggregation
  ) {
    const hasColumn =
      props.formData.query_condition.aggregation.having?.column &&
      props.formData.query_condition.aggregation.having.column.trim() !== "";
    const hasValue =
      props.formData.query_condition.aggregation.having?.value !== undefined &&
      props.formData.query_condition.aggregation.having.value !== null &&
      props.formData.query_condition.aggregation.having.value !== "";

    if (!hasColumn || !hasValue) {
      evaluationStatus.value = null;
      return;
    }
  }

  // Refresh if we have a valid query
  if (props.query) {
    refreshDataOnce();
  }
};

// Typing a query fires this on every keystroke; each refresh is a result_schema call.
const debouncedRefreshFromProps = debounce(refreshFromProps, 800);

// Query, look-back and limits are typed: one edit is one run after the pause, not one per keystroke.
const TYPED_INPUTS = new Set([0, 3, 4, 6]);
// One getter per input: formData is a new object on every edit, so a deep watch fired on each name keystroke.
watch(
  [
    () => props.query,
    () => props.formData.stream_name,
    () => props.formData.stream_type,
    () => props.formData.trigger_condition?.period,
    () => props.formData.trigger_condition?.threshold,
    () => props.formData.trigger_condition?.operator,
    () => props.formData.query_condition?.promql_condition?.value,
    () => props.formData.query_condition?.promql_rule_mode,
    () => props.selectedTab,
    () => props.isUsingBackendSql,
  ],
  (next, prev) => {
    // A query that fails to run emits no new result, so the old verdict would linger.
    if (next[0] !== prev?.[0]) {
      evaluationStatus.value = null;
      clearNoSeries();
      filterDrewNothing.value = false;
      cancelVerdictSearch();
      // The verdict is gone, so even a query typed back to the last run's must run again.
      lastRunKey = "";
    }
    if (next.some((value, index) => TYPED_INPUTS.has(index) && value !== prev?.[index])) {
      debouncedRefreshFromProps();
      return;
    }
    // A stream, tab or operator pick must not show stale results.
    debouncedRefreshFromProps.cancel();
    refreshFromProps();
  },
);

onBeforeUnmount(() => {
  debouncedRefreshFromProps.cancel();
  cancelVerdictSearch();
  cancelBaselineSearches();
});

// A range pick is the user's own request, so the 200 ms echo guard must not swallow it.
watch(previewRange, () => {
  lastRefreshTime = 0;
  refreshFromProps();
});

// The lines follow the limit at once; the re-query a limit change starts may be throttled or slow.
watch(
  () => JSON.stringify([currentLimits(), valueUnit.value]),
  () => {
    const config = (chartData.value as any)?.config;
    if (!dashboardPanelData || !config) return;
    applyThresholds();
    const { mark_line, y_axis_min, y_axis_max, unit, unit_custom, decimals } =
      dashboardPanelData.data.config;
    chartData.value = {
      ...chartData.value,
      config: { ...config, mark_line, y_axis_min, y_axis_max, unit, unit_custom, decimals },
    };
  },
);

// The query never carries the limit, so a new limit is judged against the window already fetched.
watch(
  () =>
    JSON.stringify([
      props.formData.query_condition?.aggregation?.having,
      props.formData.trigger_condition?.threshold,
      props.formData.trigger_condition?.operator,
    ]),
  judgeVerdictFrames,
);

// Refresh data on mount if we already have a query
onMounted(() => {
  // Skip for PromQL to avoid duplicate API calls (watchers handle it)
  if (props.selectedTab === "promql") {
    if (props.formData.query_condition?.promql_rule_mode) refreshDataOnce();
    return;
  }
  if (props.query) {
    refreshDataOnce();
  }
});

// Resize chart without refetching data - relies on ResizeObserver to detect changes
const resizeChart = async () => {
  // Simply wait for the DOM to update
  // The ResizeObserver in PanelSchemaRenderer will automatically detect the size change
  // and call convertPanelDataCommon() which re-renders with existing data (no API call)
  await nextTick();
  await nextTick();

  // No need to do anything else - ResizeObserver handles it automatically
};

// The parent sets props and then refreshes; the props change already queued a refresh this call replaces.
const refreshDataFromParent = () => {
  debouncedRefreshFromProps.cancel();
  lastRefreshTime = Date.now();
  refreshData();
};

// Every verdict is counted against the limit, so a limit that needs fixing has none to give.
const shownEvaluationStatus = computed(() => {
  const threshold = props.formData.trigger_condition?.threshold;
  if (comparisons.value.length) return compareStatus.value;
  return threshold !== undefined && !isPreviewCountLimit(threshold) ? null : evaluationStatus.value;
});

// Only a 4xx is the query's fault; a server or network failure says nothing about it.
const queryFailed = computed(
  () =>
    !!props.query &&
    [settledPreviewError.value, verdictSearchError.value].some(
      (error) => !!error?.message && String(error.code ?? "").startsWith("4"),
    ),
);

defineExpose({
  refreshData: refreshDataFromParent,
  resizeChart,
  evaluationStatus: shownEvaluationStatus,
  queryFailed,
});
</script>
