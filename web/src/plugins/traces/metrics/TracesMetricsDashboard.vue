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
  <div data-test="traces-metrics-dashboard" class="traces-metrics-dashboard w-full overflow-hidden">
    <!-- Charts Section -->
    <div v-if="show" class="flex flex-col will-change-[transform,opacity]">
      <div
        v-if="sqlSpanSet"
        class="flex min-w-0 items-center px-1 pt-1"
        data-test="traces-red-caption-row"
      >
        <OTag
          v-if="captionText"
          :variant="
            sqlSpanSet.kind === 'set' && sqlSpanSet.subject === 'stream'
              ? 'warning-soft'
              : 'default-soft'
          "
          class="max-w-full min-w-0"
          data-test="traces-red-caption"
        >
          <OTruncatedText>{{ captionText }}</OTruncatedText>
        </OTag>
      </div>
      <div
        v-if="sqlSpanSet?.kind === 'none'"
        class="border-border-default bg-surface-base rounded-default m-1 flex min-h-[8.5rem] items-center justify-center border md:h-[9.5625rem]"
        data-test="traces-red-frame"
      >
        <OEmptyState
          size="inline"
          icon="bar-chart"
          :backdrop="false"
          :title="frameReason"
          :action-label="t('traces.redCharts.showAllSpans', { stream: chartsStreamName })"
          @action="onShowAllSpans"
        />
      </div>
      <div
        v-else
        class="charts-wrapper dashboard-strip relative flex h-auto min-h-[8.5rem] flex-col overflow-hidden py-0! md:h-40 md:flex-row"
      >
        <div class="h-40 min-w-0 md:h-auto md:flex-2 dark:hover:shadow-sm">
          <div
            v-if="sqlSpanSet"
            class="flex h-full min-w-0 flex-col gap-1 px-1 py-0.5 md:flex-row md:py-1"
            data-test="traces-red-sql-panels"
          >
            <TracesRedSqlPanel
              v-for="panel in sqlPanels"
              :key="panel.name"
              class="min-h-0 flex-1"
              :name="panel.name"
              :panel-schema="panel.schema"
              :status="redStatus"
              :error="redError"
              :hits="panel.hits"
              :selected-time-obj="currentTimeObj.__global"
              :run-key="redRunKey"
              @retry="runCombinedRed"
              @data-zoom="onDataZoom"
            />
          </div>
          <RenderDashboardCharts
            v-else
            ref="dashboardChartsRef"
            :viewOnly="true"
            :frame="false"
            :dashboardData="dashboardData || {}"
            :currentTimeObj="currentTimeObj"
            :allowAlertCreation="false"
            :exploreActions="!searchObj.meta.sqlMode"
            searchType="dashboards"
            @updated:dataZoom="onDataZoom"
            @exploreCreateAlert="onExploreCreateAlert"
            @exploreAddToDashboard="onExploreAddToDashboard"
          >
            <!-- Until a panel mounts it keeps the page placeholder's cell, so one placeholder lasts to first draw. -->
            <template #panel-placeholder="{ panel, title }">
              <TracesRedPanelPlaceholder :title="title" :meta="panel.config?.title_meta" />
            </template>
          </RenderDashboardCharts>
        </div>
        <!-- Tied to the Rate/Errors panels: metrics.json h (9 rows after migration) × 17px cellHeight, 4px GridStack margin -->
        <div class="h-40 min-w-0 px-1 py-0.5 md:h-[9.5625rem] md:flex-1 md:py-1">
          <TracesLatencyHeatmap
            :request="heatmapRequest"
            :stream="streamName"
            :source="heatmapSource"
            :selection="heatmapSelection"
            :ai-enabled="aiEnabled"
            :sql-mode="!!searchObj.meta.sqlMode"
            @select="onHeatmapSelect"
            @filter="heatmapSelection && onHeatmapFilter(heatmapSelection)"
            @drill-down="onHeatmapDrillDown"
            @clear="onHeatmapClear"
            @ask-ai="onHeatmapAskAi"
            @create-alert="createAlert('duration')"
            @add-to-dashboard="openAddToDashboard('duration')"
            @refresh-failed="reportTracesChartRefreshFailed(searchObj)"
          />
        </div>
      </div>
    </div>

    <AddToDashboard
      v-if="addToDashboardPanel"
      v-model:open="addToDashboardOpen"
      :dashboard-panel-data="{ data: addToDashboardPanel }"
      :default-panel-title="addToDashboardPanel.title"
      :notice="addToDashboardNotice"
    />

    <Teleport v-if="showComparison" defer to="#traces-drill-down-page">
      <TracesComparison
        :selection="comparisonSelection"
        :streamName="streamName"
        :preset-context="presetContext"
        @close="showComparison = false"
        @apply-filter="onComparisonApply"
      />
    </Teleport>
  </div>
</template>

<script lang="ts" setup>
import {
  ref,
  shallowRef,
  onMounted,
  computed,
  defineAsyncComponent,
  nextTick,
  provide,
  watch,
} from "vue";
import { useStore } from "vuex";
import { useI18nTyped, raw } from "@/types/i18n";
import useNotifications from "@/composables/useNotifications";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import { SERIES_OVERRIDE_MATCH_BY } from "@/utils/dashboard/seriesOverrides";
import metrics from "./metrics.json";
import { deepCopy } from "@/utils/zincutils";
import type { MetricsRangeFilter } from "@/ts/interfaces/traces/trace.types";
import TracesLatencyHeatmap, {
  type LatencyHeatmapAskAi,
  type LatencyHeatmapRequest,
} from "./TracesLatencyHeatmap.vue";
import TracesRedPlaceholder from "./TracesRedPlaceholder.vue";
import TracesRedPanelPlaceholder from "./TracesRedPanelPlaceholder.vue";
import type { ComparisonSelection, PresetContext } from "./traceComparison";
import {
  buildLatencyHeatmapSql,
  chartInterval,
  composeFilter,
  instantToPickerMs,
  isRangeSelectionCurrent,
  selectionTerm,
  type LatencyHeatmapSelection,
} from "./latencyHeatmap";
import useTraces from "@/composables/useTraces";
import { resolveTracesFilter } from "@/utils/traces/resolveTracesFilter";
import {
  deriveSpanSet,
  type RedDroppedClause,
  type SpanSet,
  type SpanSetResult,
} from "@/utils/traces/tracesSql";
import {
  buildRedSql,
  buildSpanSetHeatmapSql,
  fillRedBuckets,
  streamSpanSet,
  type RedInterval,
  type RedPoint,
} from "./tracesRedSql";
import { useTracesRedStream } from "./useTracesRedStream";
import { tracesEditorIsStaged } from "@/plugins/traces/tracesSearchBar.utils";
import TracesRedSqlPanel from "./TracesRedSqlPanel.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { activeScopePredicate, withScope } from "@/utils/traces/tracesScope";
import { useTracesAlertAction } from "@/plugins/traces/composables/useTracesAlertAction";
import { buildTracesRedPanel, tracesBucketNotice, type TracesRedChart } from "./tracesRedPanels";
import type { I18nKey, I18nText } from "@/types/i18n";
import { PANEL_FAILED_REFRESH_HOLD } from "@/composables/dashboard/panelFailedRefreshHold";
import {
  createTracesFailedRefreshHold,
  reportTracesChartRefreshFailed,
  startTracesChartLoad,
  tracesChartSource,
} from "./tracesFailedRefreshHold";

// Even with its chunk loaded it resolves a tick late; delay 0 keeps the RED placeholder up for that frame.
const RenderDashboardCharts = defineAsyncComponent({
  loader: () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
  loadingComponent: TracesRedPlaceholder,
  delay: 0,
});

const TracesComparison = defineAsyncComponent(() => import("./TracesComparison.vue"));

const AddToDashboard = defineAsyncComponent(() => import("@/plugins/metrics/AddToDashboard.vue"));

export interface AiChatHandoff {
  query: string;
  chipName: string;
  newChat: boolean;
  autoSend: boolean;
  context: Record<string, unknown>;
}

export interface TimeRange {
  startTime: number;
  endTime: number;
}

defineProps<{
  streamName: string;
  show?: boolean;
  aiEnabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "time-range-selected", range: { start: number; end: number }): void;
  (e: "editor-filter-set", text: string): void;
  (e: "editor-filter-run", text: string): void;
  (e: "send-to-ai-chat", payload: AiChatHandoff): void;
}>();

const LATENCY_HEATMAP_PANEL_ID = "traces_latency_heatmap";

const { showErrorNotification } = useNotifications();
const store = useStore();
const { searchObj, tracesParser } = useTraces();
const { t } = useI18nTyped();

const failedRefreshHold = createTracesFailedRefreshHold(searchObj);
provide(PANEL_FAILED_REFRESH_HOLD, failedRefreshHold);

// Read filter and timeRange directly from the shared composable rather than via props.
// The props go stale during synchronous call chains (e.g., auto_query_enabled
// triggers searchData → getQueryData → getDashboardData → loadDashboard before
// Vue has re-rendered SearchResult and propagated the new prop). Reading from the
// composable — the same object buildSearch() reads — guarantees the latest value.
const effectiveFilter = computed(() => searchObj.data.editorValue);

const decodeFilter = (text: string | undefined): string =>
  resolveTracesFilter(text, tracesParser.value, searchObj.data.stream.selectedStream.value);
const parseEffectiveFilter = (): string => decodeFilter(effectiveFilter.value);

const effectiveTimeRange = computed<TimeRange>(() => ({
  startTime: searchObj.data.datetime.startTime,
  endTime: searchObj.data.datetime.endTime,
}));

const error = ref<string | null>(null);
const dashboardChartsRef = ref<any>(null);
const currentTimeObj = ref({
  __global: {
    start_time: new Date(effectiveTimeRange.value.startTime),
    end_time: new Date(effectiveTimeRange.value.endTime),
  },
});

const dashboardData = ref(null);
// The span set the last Spans SQL run draws, or why there is none; null in filter mode, which keeps its panels.
const sqlSpanSet = shallowRef<SpanSetResult | null>(null);
const redStatus = ref<"loading" | "ready" | "error">("loading");
const redError = ref("");
const redPoints = shallowRef<RedPoint[]>([]);
const redSpans = ref<number | null>(null);
const redRunKey = ref(0);
let redRun: { set: SpanSet; interval: RedInterval; startTime: number; endTime: number } | null =
  null;
const redStream = useTracesRedStream();
const heatmapRequest = ref<LatencyHeatmapRequest | null>(null);
// The box drawn on the heatmap; it is applied only from its popover.
const heatmapSelection = shallowRef<LatencyHeatmapSelection | null>(null);
const heatmapSource = ref<string | undefined>();

const showComparison = ref(false);
// The comparison is a snapshot of the search that opened it, so a new search closes it.
watch(
  () => searchObj.loading,
  (loading, wasLoading) => {
    if (loading && !wasLoading) showComparison.value = false;
  },
);
const comparisonSelection = shallowRef<ComparisonSelection | null>(null);
const presetContext = shallowRef<PresetContext | null>(null);
let comparisonEntry: MetricsRangeFilter | null = null;
// The range the charts were last loaded for, which a selection's baseline describes.
let chartsRange: TimeRange | null = null;
// The editor text the charts ran with; with auto-run off the editor may hold an unrun edit.
let chartsFilter = "";
// The scope condition the charts ran with, which a comparison of their spans keeps.
let chartsScope = "";
// The stream and mode the charts ran with, for the same reason.
let chartsStream = "";
let chartsMode: "spans" | "traces" = "traces";
// The bucket the charts were drawn with, which an exported panel keeps.
let chartsInterval: { sql: string; seconds: number } | null = null;
// The range the open comparison measured, which its Filter/Exclude restores.
let comparisonRange: TimeRange | null = null;
// Store the original time range before selection for baseline comparison
const originalTimeRangeBeforeSelection = ref<TimeRange | null>(null);

// Reactivity trigger for Map changes (Vue 3 doesn't track Map.set() automatically)
const rangeFiltersVersion = ref(0);

const rangeFilters = computed<Map<string, MetricsRangeFilter>>(
  () => searchObj.meta.metricsRangeFilters,
);

const getBaseFilters = () => {
  let baseFilters = [];
  rangeFilters.value.forEach((rangeFilter) => {
    if (rangeFilter.panelTitle === "Duration") {
      const bounds: string[] = [];
      if (rangeFilter.start !== null) bounds.push(`duration >= ${rangeFilter.start}`);
      if (rangeFilter.end !== null) bounds.push(`duration < ${rangeFilter.end}`);
      if (bounds.length) baseFilters.push(bounds.join(" and "));
    }
  });

  const parsedFilter = withScope(parseEffectiveFilter(), activeScopePredicate(searchObj));
  if (parsedFilter) baseFilters.push(parsedFilter);

  return baseFilters;
};

const loadDashboard = async () => {
  try {
    error.value = null;
    startTracesChartLoad(searchObj);

    currentTimeObj.value = {
      __global: {
        start_time: new Date(effectiveTimeRange.value.startTime),
        end_time: new Date(effectiveTimeRange.value.endTime),
      },
    };

    // Convert the dashboard schema and update stream names
    const convertedDashboard = convertDashboardSchemaVersion(deepCopy(metrics));

    const isSpansMode = searchObj.meta.searchMode === "spans";
    const streamName = searchObj.data.stream.selectedStream.value;
    const interval = chartInterval(
      effectiveTimeRange.value.startTime,
      effectiveTimeRange.value.endTime,
    );

    const source = tracesChartSource(searchObj);
    heatmapSource.value = source;
    chartsRange = { ...effectiveTimeRange.value };
    chartsFilter = searchObj.data.editorValue ?? "";
    chartsScope = activeScopePredicate(searchObj);
    chartsStream = streamName;
    chartsStreamName.value = streamName;
    chartsMode = isSpansMode ? "spans" : "traces";
    chartsInterval = interval;
    heatmapSelection.value = null;

    if (searchObj.meta.sqlMode && isSpansMode) {
      showSpanSet(deriveSpanSet(chartsFilter, tracesParser.value, { isTracesStream }), interval);
      return;
    }
    sqlSpanSet.value = null;
    redRun = null;
    redStream.cancel();

    const baseFilters: string[] = getBaseFilters();
    const fromClause = `"${streamName}"`;
    heatmapRequest.value = {
      sql: buildLatencyHeatmapSql(streamName, baseFilters, interval.sql, fromClause),
      startTime: effectiveTimeRange.value.startTime,
      endTime: effectiveTimeRange.value.endTime,
      intervalSec: interval.seconds,
      size: -1,
    };
    convertedDashboard.tabs[0].panels.forEach(
      (
        panel: { title?: string; config: Record<string, unknown>; queries: { query: string }[] },
        index: number,
      ) => {
        // Build WHERE clause based on filters
        let whereClause = "";

        // Special handling for "Errors" panel - always filter by error status
        if (panel.title === "Errors") {
          const errorFilters = ["span_status = 'ERROR'"];
          const parsedFilter = parseEffectiveFilter();
          if (parsedFilter) errorFilters.push(parsedFilter);

          if (baseFilters.length) {
            errorFilters.push(...baseFilters);
          }

          whereClause = errorFilters.length ? "WHERE " + errorFilters.join(" AND ") : "";
        } else {
          whereClause = baseFilters.length ? "WHERE " + baseFilters.join(" AND ") : "";
        }

        // Build the final query: substitute placeholders then apply mode transforms
        let query = panel["queries"][0].query
          .replace("[STREAM_NAME]", () => fromClause)
          .replace("[WHERE_CLAUSE]", () => whereClause)
          .replace("[INTERVAL]", interval.sql)
          // The range clips the first and last buckets, so their per-second value dips, as their heatmap columns thin.
          .replace("[INTERVAL_SECONDS]", String(interval.seconds));

        if (panel.title === "Rate") {
          const rateUnit = isSpansMode
            ? t("traces.metrics.perSecond.spans")
            : t("traces.metrics.perSecond.traces");
          panel.config.title_meta = rateUnit;
          // Ticks read the panel unit and the tooltip reads series overrides, so the unit lives only in the override.
          panel.config.override_config = [
            {
              field: { matchBy: SERIES_OVERRIDE_MATCH_BY.REGEX, value: ".*" },
              config: [{ type: "unit", value: { unit: "custom", customUnit: rateUnit } }],
            },
          ];
        }

        // Spans mode: replace trace-level distinct counts with span-level counts
        // in the Rate and Errors panels.
        if (isSpansMode && (panel.title === "Rate" || panel.title === "Errors")) {
          query = query
            .replace(
              /approx_distinct\(trace_id\)\s+filter\s*\(where\s+span_status\s*=\s*'ERROR'\)/gi,
              "count(*) FILTER (WHERE span_status = 'ERROR')",
            )
            .replace(/approx_distinct\(trace_id\)/gi, "count(*)");
        }

        convertedDashboard.tabs[0].panels[index]["queries"][0].query = query;
      },
    );

    failedRefreshHold.generated(convertedDashboard.tabs[0].panels, source);
    dashboardData.value = convertedDashboard;

    updateLayout();
  } catch (err: any) {
    console.error("Error loading dashboard:", err);
    const message: string = err.message || t("traces.failedToLoadMetricsDashboard");
    error.value = message;
    showErrorNotification(raw(message));
  }
};

// The selected stream the strip last ran on, which the frame's button names.
const chartsStreamName = ref("");

const isTracesStream = (name: string): boolean => {
  const streams: { value: string }[] = searchObj.data.stream.streamLists ?? [];
  return !streams.length || streams.some((s) => s.value === name);
};

const showSpanSet = (result: SpanSetResult, interval: RedInterval) => {
  sqlSpanSet.value = result;
  redStream.cancel();
  if (result.kind === "none") {
    redRun = null;
    heatmapRequest.value = null;
    return;
  }
  const { startTime, endTime } = chartsRange ?? effectiveTimeRange.value;
  redRun = { set: result, interval, startTime, endTime };
  heatmapRequest.value = {
    ...buildSpanSetHeatmapSql(result, interval),
    startTime,
    endTime,
    intervalSec: interval.seconds,
  };
  runCombinedRed();
};

const runCombinedRed = () => {
  const run = redRun;
  if (!run) return;
  redStatus.value = "loading";
  redError.value = "";
  redSpans.value = null;
  redStream.run(
    { ...buildRedSql(run.set, run.interval), startTime: run.startTime, endTime: run.endTime },
    (hits) => {
      redPoints.value = fillRedBuckets(hits, run.interval.seconds, run.startTime, run.endTime);
      redSpans.value = redPoints.value.reduce((sum, point) => sum + point.spans, 0);
      redRunKey.value++;
      redStatus.value = "ready";
    },
    (message) => {
      redError.value = message;
      redStatus.value = "error";
    },
  );
};

// The whole stream is scanned only on this click, never on its own.
const onShowAllSpans = () => {
  const interval =
    chartsInterval ??
    chartInterval(effectiveTimeRange.value.startTime, effectiveTimeRange.value.endTime);
  showSpanSet(streamSpanSet(chartsStreamName.value), interval);
};

const sqlPanelSchemas: any[] = convertDashboardSchemaVersion(deepCopy(metrics)).tabs[0].panels;
const sqlPanelFor = (title: string) => sqlPanelSchemas.find((panel) => panel.title === title);

const sqlRateSchema = computed(() => {
  const rate = sqlPanelFor("Rate");
  const rateUnit = t("traces.metrics.perSecond.spans");
  return {
    ...rate,
    config: {
      ...rate.config,
      title_meta: rateUnit,
      override_config: [
        {
          field: { matchBy: SERIES_OVERRIDE_MATCH_BY.REGEX, value: ".*" },
          config: [{ type: "unit", value: { unit: "custom", customUnit: rateUnit } }],
        },
      ],
    },
  };
});

// The metrics.json panels read their own column names, so the combined rows are renamed per panel.
const sqlPanels = computed(() => {
  const seconds = redRun?.interval.seconds ?? 1;
  return [
    {
      name: "rate" as const,
      schema: sqlRateSchema.value,
      hits: redPoints.value.map((p) => ({
        time_bucket: p.time_bucket,
        max_rate: p.spans / seconds,
      })),
    },
    {
      name: "errors" as const,
      schema: sqlPanelFor("Errors"),
      hits: redPoints.value.map((p) => ({ time_bucket: p.time_bucket, error_rate: p.errors })),
    },
  ];
});

const DROPPED_LABELS: Record<RedDroppedClause, I18nKey> = {
  groupBy: "traces.redCaption.clause.groupBy",
  having: "traces.redCaption.clause.having",
  distinct: "traces.redCaption.clause.distinct",
  orderBy: "traces.redCaption.clause.orderBy",
  limit: "traces.redCaption.clause.limit",
  offset: "traces.redCaption.clause.offset",
  window: "traces.redCaption.clause.window",
  qualify: "traces.redCaption.clause.qualify",
  outerWhere: "traces.redCaption.clause.outerWhere",
  bothSidesWhere: "traces.redCaption.clause.bothSidesWhere",
  join: "traces.redCaption.clause.join",
};

const subjectCaption = (set: SpanSet, count: number | null): string => {
  const shown = count?.toLocaleString() ?? "";
  switch (set.subject) {
    case "matched":
      if (count === null) return t("traces.redCaption.matched");
      return count === 0
        ? t("traces.redCaption.noneMatched")
        : t("traces.redCaption.matchedCount", { count: shown }, count);
    case "cte":
      return t("traces.redCaption.cte", { name: set.cte ?? "" });
    case "branches":
      return t("traces.redCaption.branches", { count: set.branches ?? 0 }, set.branches ?? 0);
    case "joinMatched":
      return t("traces.redCaption.joinMatched");
    case "joinLeft":
      return t("traces.redCaption.joinLeft");
    case "inner":
      return t("traces.redCaption.inner");
    default:
      return t("traces.redCaption.stream", { stream: chartsStreamName.value });
  }
};

// Which spans, how many, each clause not applied and the scope, in that order.
const captionText = computed(() => {
  const set = sqlSpanSet.value;
  if (set?.kind !== "set") return "";
  const count = redStatus.value === "ready" ? redSpans.value : null;
  if (set.subject === "stream") return subjectCaption(set, count);
  const parts = [subjectCaption(set, count)];
  if (set.subject !== "matched" && count !== null) {
    parts.push(t("traces.redCaption.count", { count: count.toLocaleString() }, count));
  }
  if (set.dropped.length) {
    const clauses = set.dropped.map((clause) => t(DROPPED_LABELS[clause])).join(", ");
    parts.push(t("traces.redCaption.notApplied", { clauses }));
  }
  parts.push(t("traces.redCaption.scope"));
  return parts.join(" · ");
});

const frameReason = computed(() => {
  const set = sqlSpanSet.value;
  if (set?.kind !== "none") return raw("");
  if (set.reason === "notTraces")
    return t("traces.redCharts.notTraces", { stream: set.stream ?? "" });
  return set.reason === "unreadable"
    ? t("traces.redCharts.unreadable")
    : t("traces.redCharts.shape");
});

const updateLayout = async () => {
  window.dispatchEvent(new Event("resize"));
};

const refreshDashboard = () => {
  if (dashboardChartsRef.value) {
    dashboardChartsRef?.value?.forceRefreshPanel();
  }
};

const onDataZoom = async ({
  start,
  end,
  data,
}: {
  start: number;
  end: number;
  data: any; // contains panel schema with data.id as panel id
}) => {
  if (!start || !end) return;
  const panelTitle = data?.title;
  if (panelTitle !== "Rate" && panelTitle !== "Errors") return;
  // Line charts plot zoned wall-clock times, so a brush value is already what the picker expects.
  await applySelection(panelTitle, data?.id ?? panelTitle, { start, end }, null, null, null, null);
};

const { createAlert } = useTracesAlertAction();

const CHART_BY_PANEL_TITLE: Record<string, TracesRedChart> = { Rate: "rate", Errors: "errors" };

const onExploreCreateAlert = (panel: { title?: string }) => {
  const chart = CHART_BY_PANEL_TITLE[panel?.title ?? ""];
  if (chart === "rate" || chart === "errors") createAlert(chart);
};

const addToDashboardOpen = ref(false);
const addToDashboardPanel = shallowRef<any>(null);
const addToDashboardNotice = ref<I18nText | undefined>(undefined);

const openAddToDashboard = (chart: TracesRedChart) => {
  const interval =
    chartsInterval ??
    chartInterval(effectiveTimeRange.value.startTime, effectiveTimeRange.value.endTime);
  addToDashboardPanel.value = buildTracesRedPanel(chart, {
    streamName: chartsStream || searchObj.data.stream.selectedStream.value,
    filter: withScope(decodeFilter(chartsFilter), chartsScope),
    filterText: chartsFilter,
    view: chartsMode,
    interval,
    rateUnit:
      chartsMode === "spans"
        ? t("traces.metrics.perSecond.spans")
        : t("traces.metrics.perSecond.traces"),
  });
  const { unit, count } = tracesBucketNotice(interval.seconds);
  addToDashboardNotice.value = t(`traces.redActions.bucketNoticeSingle.${unit}`, { count });
  addToDashboardOpen.value = true;
};

const onExploreAddToDashboard = (panel: { title?: string }) => {
  const chart = CHART_BY_PANEL_TITLE[panel?.title ?? ""];
  if (chart) openAddToDashboard(chart);
};

const onHeatmapSelect = (selection: LatencyHeatmapSelection) => {
  heatmapSelection.value = selection;
};

const currentEntry = (panelTitle: MetricsRangeFilter["panelTitle"]) => {
  const entry = [...rangeFilters.value.values()].find((f) => f.panelTitle === panelTitle);
  return entry &&
    isRangeSelectionCurrent(entry, {
      startTime: searchObj.data.datetime.startTime,
      endTime: searchObj.data.datetime.endTime,
      stream: searchObj.data.stream.selectedStream.value,
      searchMode: searchObj.meta.searchMode,
      editorText: searchObj.data.editorValue ?? "",
    })
    ? entry
    : undefined;
};

const isAppliedBox = (entry: MetricsRangeFilter | undefined, box: LatencyHeatmapSelection) =>
  !!entry &&
  entry.timeStart === box.timeStartUs &&
  entry.timeEnd === box.timeEndUs &&
  entry.start === (box.durationLoUs || null) &&
  entry.end === box.durationHiUs;

const onHeatmapDrillDown = () => {
  const box = heatmapSelection.value;
  if (!box) return;
  // A box applied before the charts reload is still drawn on them, so it is checked against the editor.
  if (isAppliedBox(currentEntry("Duration"), box)) {
    openComparison();
    return;
  }
  const range = chartsRange ?? effectiveTimeRange.value;
  comparisonEntry = null;
  comparisonRange = { ...range };
  comparisonSelection.value = {
    kind: "duration",
    windowStartUs: box.timeStartUs,
    windowEndUs: box.timeEndUs,
    rangeStartUs: range.startTime,
    rangeEndUs: range.endTime,
    durationLoUs: box.durationLoUs || null,
    durationHiUs: box.durationHiUs,
    filter: withScope(decodeFilter(chartsFilter), chartsScope),
  };
  showComparison.value = true;
};

const onHeatmapClear = () => {
  const box = heatmapSelection.value;
  heatmapSelection.value = null;
  const entry = currentEntry("Duration");
  const range = originalTimeRangeBeforeSelection.value;
  if (!box || !isAppliedBox(entry, box) || !entry || !range) return;
  emit("time-range-selected", {
    start: instantToPickerMs(Math.floor(range.startTime / 1_000_000) * 1000, store.state.timezone),
    end: instantToPickerMs(Math.ceil(range.endTime / 1_000_000) * 1000, store.state.timezone),
  });
  searchObj.meta.metricsRangeFilters.clear();
  clearOriginalTimeRange();
  rangeFiltersVersion.value++;
  emit("editor-filter-set", entry.baselineFilter);
};

// The chip carries the box, the stream and the filter the charts ran; the user writes the question.
const onHeatmapAskAi = ({ selection, count, band, window }: LatencyHeatmapAskAi) => {
  const { timeStartUs, timeEndUs, durationLoUs, durationHiUs } = selection;
  const stream = chartsStream;
  const mode = chartsMode;
  const from = new Date(timeStartUs / 1000).toISOString();
  const to = new Date(timeEndUs / 1000).toISOString();
  // Model input, not screen copy: kept English, like the traces page's other Ask AI prompts.
  const queryText = searchObj.meta.sqlMode
    ? `The SQL query is: ${chartsFilter.trim()}.`
    : `The filter expression is: ${chartsFilter.trim() || "(none)"}. This is a WHERE-clause filter — not a full SQL query.`;
  const query = `I selected a box on the traces latency heatmap. Spans in the box: ${count}. Duration: ${band}. Time: ${from} to ${to} (shown as ${window}). I am searching ${mode}. Stream: ${stream}. ${queryText} What do these spans have in common, and what explains their duration?`;
  emit("send-to-ai-chat", {
    query,
    chipName: t(
      "traces.latencyHeatmap.selection.askAiChip",
      { count: count.toLocaleString() },
      count,
    ),
    newChat: true,
    autoSend: false,
    context: {
      currentPage: "traces",
      selectedStreams: stream ? [stream] : [],
      streamType: "traces",
      currentQuery: chartsFilter,
      searchMode: mode,
      timeRange: { type: "absolute", startTime: timeStartUs, endTime: timeEndUs },
      durationRange: { startUs: durationLoUs || null, endUs: durationHiUs },
      organization_identifier: store.state.selectedOrganization?.identifier ?? "",
    },
  });
};

const onHeatmapFilter = async (selection: LatencyHeatmapSelection) => {
  const { timeStartUs, timeEndUs, durationLoUs: lo, durationHiUs: hi } = selection;
  // The picker keeps whole seconds; rounding outwards keeps a mid-second clamped edge from emptying the range.
  const pickerRange = {
    start: instantToPickerMs(Math.floor(timeStartUs / 1_000_000) * 1000, store.state.timezone),
    end: instantToPickerMs(Math.ceil(timeEndUs / 1_000_000) * 1000, store.state.timezone),
  };
  await applySelection(
    "Duration",
    LATENCY_HEATMAP_PANEL_ID,
    pickerRange,
    timeStartUs,
    timeEndUs,
    lo || null,
    hi,
  );
};

// One path for a heatmap box and a Rate or Errors brush; brushes pass null times and take what the picker applied.
const applySelection = async (
  panelTitle: "Duration" | "Errors" | "Rate",
  key: string,
  pickerRange: { start: number; end: number },
  timeStartUs: number | null,
  timeEndUs: number | null,
  lo: number | null,
  hi: number | null,
) => {
  // A same-kind selection refines the current one and keeps its baseline; any other starts from the editor as shown.
  const existing = [...rangeFilters.value.values()].find((f) => f.panelTitle === panelTitle);
  const current =
    existing &&
    isRangeSelectionCurrent(existing, {
      startTime: searchObj.data.datetime.startTime,
      endTime: searchObj.data.datetime.endTime,
      stream: searchObj.data.stream.selectedStream.value,
      searchMode: searchObj.meta.searchMode,
      editorText: searchObj.data.editorValue ?? "",
    })
      ? existing
      : undefined;
  const baselineFilter = current?.baselineFilter ?? searchObj.data.editorValue ?? "";

  // Typed SQL takes no inserted conditions, so a brush only moves the time picker.
  if (searchObj.meta.sqlMode) {
    emit("time-range-selected", pickerRange);
    return;
  }

  if (!current || !originalTimeRangeBeforeSelection.value) {
    // The charts show the last search's range; in manual mode the picker may already hold an unsearched box.
    originalTimeRangeBeforeSelection.value = { ...(chartsRange ?? effectiveTimeRange.value) };
  }
  searchObj.meta.metricsRangeFilters.clear();

  emit("time-range-selected", pickerRange);

  await nextTick();

  const entry: MetricsRangeFilter = {
    panelTitle,
    start: lo,
    end: hi,
    timeStart: timeStartUs ?? searchObj.data.datetime.startTime,
    timeEnd: timeEndUs ?? searchObj.data.datetime.endTime,
    appliedStart: searchObj.data.datetime.startTime,
    appliedEnd: searchObj.data.datetime.endTime,
    baselineFilter,
    stream: searchObj.data.stream.selectedStream.value,
    searchMode: searchObj.meta.searchMode,
  };
  searchObj.meta.metricsRangeFilters.set(key, entry);
  rangeFiltersVersion.value++;
  emit("editor-filter-set", composeFilter(baselineFilter, selectionTerm(entry)));
};

const COMPARISON_KINDS: Record<string, ComparisonSelection["kind"]> = {
  Duration: "duration",
  Errors: "errors",
  Rate: "rate",
};

// An applied box still waiting for Run counts as current, and so does one the charts ran before a staged edit.
const openComparison = () => {
  const entry = [...rangeFilters.value.values()][0];
  const shown = chartsRange ?? effectiveTimeRange.value;
  presetContext.value = {
    rangeStartUs: shown.startTime,
    rangeEndUs: shown.endTime,
    filter: withScope(decodeFilter(chartsFilter), chartsScope),
  };
  const range = originalTimeRangeBeforeSelection.value ?? effectiveTimeRange.value;
  const current =
    entry &&
    [searchObj.data.editorValue ?? "", chartsFilter].some((editorText) =>
      isRangeSelectionCurrent(entry, {
        startTime: searchObj.data.datetime.startTime,
        endTime: searchObj.data.datetime.endTime,
        stream: searchObj.data.stream.selectedStream.value,
        searchMode: searchObj.meta.searchMode,
        editorText,
      }),
    );
  comparisonEntry = current ? entry : null;
  comparisonRange = { ...(current ? range : shown) };
  comparisonSelection.value =
    current && COMPARISON_KINDS[entry.panelTitle]
      ? {
          kind: COMPARISON_KINDS[entry.panelTitle],
          windowStartUs: entry.appliedStart,
          windowEndUs: entry.appliedEnd,
          rangeStartUs: range.startTime,
          rangeEndUs: range.endTime,
          durationLoUs: entry.start,
          durationHiUs: entry.end,
          filter: withScope(decodeFilter(entry.baselineFilter), chartsScope),
        }
      : null;
  showComparison.value = true;
};

const onComparisonApply = async (term: string) => {
  const entry = comparisonEntry;
  // Without a stored selection Drill down compared the editor's own filter, so the term joins it.
  const base = entry?.baselineFilter ?? searchObj.data.editorValue ?? "";
  const range =
    comparisonRange ?? originalTimeRangeBeforeSelection.value ?? effectiveTimeRange.value;
  // R holds instants, not chart wall-clock values, so it converts like a heatmap box.
  emit("time-range-selected", {
    start: instantToPickerMs(Math.floor(range.startTime / 1_000_000) * 1000, store.state.timezone),
    end: instantToPickerMs(Math.ceil(range.endTime / 1_000_000) * 1000, store.state.timezone),
  });
  searchObj.meta.metricsRangeFilters.clear();
  clearOriginalTimeRange();
  rangeFiltersVersion.value++;
  heatmapSelection.value = null;
  // The picker updates the search range in a watcher; searching before the tick would use the selection's window.
  await nextTick();
  emit("editor-filter-run", composeFilter(base, term));
};

const clearOriginalTimeRange = () => {
  originalTimeRangeBeforeSelection.value = null;
};

onMounted(() => {
  // Typed SQL waits for Run, so a remount over an unrun edit draws no panels yet.
  if (searchObj.meta.sqlMode && tracesEditorIsStaged(searchObj)) return;
  loadDashboard();
});

defineExpose({
  refresh: refreshDashboard,
  resetZoom: () => {
    // Dashboard handles zoom reset through toolbar
  },
  loadDashboard,
  getBaseFilters,
  rangeFiltersVersion,
  openComparison,
  clearOriginalTimeRange,
});
</script>

<style scoped>
/* keep(lib-override:render-dashboard-charts): RenderDashboardCharts renders its
   own DOM (reached via :deep). Tighten the side padding AND collapse the top
   padding/margin it adds for full dashboards (container pt-2 + inner .displayDiv
   mt-2 = 1rem). In this compact traces view the charts live in a fixed h-40
   (10rem) overflow-hidden wrapper, so that extra 1rem pushes the plot past the
   clip line and cuts off the x-axis. Zeroing it restores the main-branch fit. */
.charts-wrapper :deep(.render-dashboard-charts-container) {
  padding-left: 0.2rem;
  padding-right: 0.2rem;
  padding-top: 0;
}

.charts-wrapper :deep(.displayDiv) {
  margin-top: 0;
}
</style>
