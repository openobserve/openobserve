<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  The detection charts on an anomaly alert's status page.

  An anomaly config has no `query_condition`, so the generic evaluation chart
  (`AlertGroupChart`) has no SQL to build and is excluded for this family. Its
  answer comes from the other direction instead: every detection run writes one
  row per scored bucket to the `_anomalies` stream, and these three charts are
  three readings of that one record.

  THREE charts, not three series on one, because they are on three unrelated
  scales — a metric in its own units, a unitless model score, and a percentage.
  Stacked on a shared axis the tallest would flatten the other two into the
  baseline.

  All three share ONE range picker: they are three readings of the same window,
  and separate pickers would let them silently disagree about which window.
-->
<template>
  <div class="flex flex-col gap-3" data-test="alerts-anomalydetectionchart">
    <AnomalySummaryStrip
      :response="summary"
      :loading="summaryLoading"
      :failed="summaryFailed"
      :config="alert"
      :now-us="nowUs"
      :ask-ai="askAiAvailable"
      @retry="refreshSummary"
      @open="openUrl"
      @ask-ai="askAi"
    />

    <div class="flex items-center justify-between gap-2">
      <span class="text-compact text-text-heading font-bold">
        {{ t("alerts.anomaly.detectionCharts") }}
      </span>
      <OToggleGroup
        :model-value="range"
        data-test="alerts-anomalydetectionchart-range"
        @update:model-value="onRangeChange"
      >
        <OToggleGroupItem
          v-for="option in rangeOptions"
          :key="option.value"
          :value="option.value"
          size="sm"
          :data-test="`alerts-anomalydetectionchart-range-${option.value}`"
        >
          {{ option.label }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <div
      class="rounded-default border-border-default flex flex-col overflow-hidden border"
      data-test="alerts-anomalydetectionchart-metric"
    >
      <PanelBar class="w-full flex-wrap justify-between gap-x-2 gap-y-0.5">
        {{ t("alerts.anomaly.metricChart") }}
        <span class="flex flex-wrap items-center gap-x-2">
          <span
            v-if="bandCaption"
            class="text-text-secondary text-2xs font-normal"
            data-test="alerts-anomalydetectionchart-band-caption"
          >
            {{ bandCaption }}
          </span>
          <span class="text-text-secondary text-2xs font-normal">
            {{ t("alerts.anomaly.metricChartHint") }}
          </span>
        </span>
      </PanelBar>
      <div class="relative h-100 w-full">
        <div
          v-if="!kindColumnsReady || metricLoading"
          class="flex h-full items-center justify-center"
          data-test="alerts-anomalydetectionchart-metric-loading"
        >
          <OSpinner size="md" />
        </div>
        <div
          v-else-if="!metricQuery || metricError"
          class="flex h-full items-center justify-center px-4 text-center"
          data-test="alerts-anomalydetectionchart-metric-empty"
        >
          <span class="text-text-secondary text-sm">
            {{ metricError || t("alerts.groups.chartUnavailable") }}
          </span>
        </div>
        <div
          v-else-if="!metricRows.length"
          class="flex h-full items-center justify-center px-4 text-center"
          data-test="alerts-anomalydetectionchart-metric-nodata"
        >
          <span class="text-text-secondary text-sm">
            {{ t("alerts.anomaly.noDetectionResults") }}
          </span>
        </div>
        <!-- ChartRenderer, not PanelSchemaRenderer: the point popover needs the chart click,
             which the schema renderer does not forward. -->
        <ChartRenderer
          v-else
          :data="{ options: metricOptions }"
          data-test="alerts-anomalydetectionchart-metric-chart"
          @click="onChartClick"
        />
        <span
          ref="pointAnchor"
          class="pointer-events-none absolute size-0"
          :style="pointAnchorStyle"
          aria-hidden="true"
        />
        <AnomalyPointPopover
          v-model:open="pointOpen"
          :anchor="pointAnchor"
          :row="pointRow"
          :bucket-ms="anomalyIntervalMs(interval)"
          :current="pointIsCurrent"
          :loading="pointLoading"
          :stream-type="alert?.stream_type"
          @open-bucket="openPointBucket"
        />
      </div>
    </div>

    <OCollapsible
      :label="t('alerts.anomaly.detectorInternals')"
      data-test="alerts-anomalydetectionchart-internals"
    >
      <div class="flex flex-col gap-3 pt-2">
        <div
          v-for="panel in panels"
          :key="panel.key"
          class="rounded-default border-border-default flex flex-col overflow-hidden border"
          :data-test="`alerts-anomalydetectionchart-${panel.key}`"
        >
          <PanelBar class="w-full justify-between gap-2">
            {{ panel.label }}
            <span class="text-text-secondary text-2xs font-normal">{{ panel.hint }}</span>
          </PanelBar>
          <div class="h-62.5 w-full">
            <div
              v-if="!kindColumnsReady"
              class="flex h-full items-center justify-center"
              :data-test="`alerts-anomalydetectionchart-${panel.key}-loading`"
            >
              <OSpinner size="md" />
            </div>
            <PanelSchemaRenderer
              v-else-if="panel.schema"
              :height="5"
              :width="5"
              :panelSchema="panel.schema"
              :selectedTimeObj="selectedTimeObj"
              :variablesData="{}"
              :shouldRefreshWithoutCache="!ANOMALIES_USE_CACHE"
              searchType="ui"
              :data-test="`alerts-anomalydetectionchart-${panel.key}-panel`"
            />
            <div
              v-else
              class="flex h-full items-center justify-center px-4 text-center"
              :data-test="`alerts-anomalydetectionchart-${panel.key}-empty`"
            >
              <span class="text-text-secondary text-sm">
                {{ t("alerts.groups.chartUnavailable") }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </OCollapsible>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";

import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import PanelBar from "@/components/common/PanelBar.vue";
import AnomalyPointPopover from "@/components/alerts/AnomalyPointPopover.vue";
import AnomalySummaryStrip from "@/components/alerts/AnomalySummaryStrip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { queryClient } from "@/composables/query/queryClient";
import { anomalyExploreQuery } from "@/services/anomaly_detection.queries";
import type { AnomalyExploreResponse } from "@/types/anomalyExplore";
import { formatUtcHm, openAppUrl, pageModelVersion } from "@/utils/alerts/anomalyExploreView";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import { chartColor } from "@/utils/chartTheme";
import { getDefaultDashboardPanelData } from "@/utils/alerts/aggregationPreviewQuery";
import searchService from "@/services/search";
import streamService from "@/services/stream";
import {
  anomalyIntervalMs,
  buildAnomalyBandOptions,
  latestBandK,
  toAnomalyBandRows,
  type AnomalyBandRow,
} from "@/utils/alerts/anomalyBandChart";
import {
  ANOMALY_DEVIATION_ALIAS,
  ANOMALY_DROP_ALIAS,
  ANOMALY_SCORE_ALIAS,
  ANOMALY_STREAM,
  ANOMALY_THRESHOLD_ALIAS,
  ANOMALY_X_ALIAS,
  buildAnomalyDeviationQuery,
  buildAnomalyMetricQuery,
  buildAnomalyScoreQuery,
  NO_KIND_COLUMNS,
  type AnomalyKindColumns,
} from "@/utils/alerts/anomalyChartQuery";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = defineProps<{ alert: any; anomalyId: string }>();

const emit = defineEmits<{
  /** The page shows another model than the server: reload the config, and this chart follows. */
  reload: [];
  "ask-ai": [payload: Record<string, unknown>];
}>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

// Semantic, not palette indices: the flagged series IS the error state and the
// threshold IS the warning line, so a retheme of those carries to these.
const METRIC_TOKEN = "--color-chart-series-1";
const ANOMALY_TOKEN = "--color-status-error-text";
const THRESHOLD_TOKEN = "--color-status-warning-text";
const DROP_TOKEN = "--color-status-warning-text";
const BAND_TOKEN = "--color-chart-band";
const AXIS_TOKEN = "--color-text-secondary";
const GRID_TOKEN = "--color-border-default";

// A detector writes a bucket's row a run after it closes, so a result-cached range keeps that tail empty for good.
const ANOMALIES_USE_CACHE = false;

const RANGE_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

/** A panel is `null` until there is a config id to query for. */
interface DetectionPanel {
  key: string;
  label: I18nText;
  hint: I18nText;
  schema: unknown;
}

const selectedTimeObj = ref<any>(null);
const windowUs = ref({ startUs: 0, endUs: 0 });
const range = ref<string>("1h");

const rangeOptions = computed(() => [
  { value: "1h", label: t("alerts.groups.range1h") },
  { value: "6h", label: t("alerts.groups.range6h") },
  { value: "24h", label: t("alerts.groups.range24h") },
]);

const interval = computed(() => props.alert?.histogram_interval);

// In custom SQL the function's field names a query alias, not a stream column.
const metricUnit = computed(() => {
  const a = props.alert;
  if (a?.stream_type !== "traces" || a?.query_mode === "custom_sql") return "numbers";
  const match = /^(\w+)\((.+)\)$/.exec(String(a?.detection_function ?? ""));
  return match?.[2] === "duration" && match[1].toLowerCase() !== "count"
    ? "microseconds"
    : "numbers";
});

// Kind flags serialize only when true, so the stream schema is what says which per-kind split a query may reference.
const kindColumns = ref<AnomalyKindColumns>({ ...NO_KIND_COLUMNS });
// Charts wait for the schema probe, or the first render burns a query round-trip on the legacy shape.
const kindColumnsReady = ref(false);

async function loadKindColumns() {
  kindColumnsReady.value = false;
  try {
    const res = await streamService.schema(
      store.state.selectedOrganization.identifier,
      ANOMALY_STREAM,
      "logs",
    );
    const fields: Array<{ name?: string }> = res.data?.schema || res.data?.fields || [];
    const names = new Set(fields.map((f) => f?.name));
    kindColumns.value = {
      isAbsence: names.has("is_absence"),
      isPartialDrop: names.has("is_partial_drop"),
      expectedValue: names.has("expected_value"),
      expectedBounds: names.has("expected_lower") && names.has("expected_upper"),
      judgedEnd: names.has("judged_end_us"),
    };
  } catch {
    kindColumns.value = { ...NO_KIND_COLUMNS };
  } finally {
    kindColumnsReady.value = true;
  }
}

/** Colouring is `colorBySeries`, not the default: these series carry MEANING,
 *  and hashing the series name into the palette would assign it by accident. */
const buildPanel = (
  type: string,
  query: string | null,
  yFields: Array<{ alias: string; label: I18nText; color: `--${string}` }>,
  unit: string,
  config: Record<string, unknown> = {},
) => {
  if (!query) return null;
  void store.state.theme; // The resolved token values are cached — re-read on a flip.
  const panel: any = cloneDeep(getDefaultDashboardPanelData());
  panel.data.type = type;
  panel.data.queryType = "sql";
  panel.data.config.unit = unit;
  panel.data.config.table_dynamic_columns = false;
  // The alert panel factory connects nulls; here that bridges red straight
  // through a healthy stretch, and papers over a gap in the runs themselves.
  panel.data.config.connect_nulls = false;
  panel.data.config.color = {
    mode: "palette-classic-by-series",
    fixedColor: [],
    seriesBy: "last",
    colorBySeries: yFields.map((field) => ({ value: field.label, color: chartColor(field.color) })),
  };
  Object.assign(panel.data.config, config);
  panel.data.queries[0].customQuery = true;
  panel.data.queries[0].query = query;
  panel.data.queries[0].vrlFunctionQuery = null;
  panel.data.queries[0].fields.stream = ANOMALY_STREAM;
  panel.data.queries[0].fields.stream_type = "logs";
  panel.data.queries[0].fields.x = [
    { alias: ANOMALY_X_ALIAS, column: ANOMALY_X_ALIAS, color: null, label: t("alerts.timeLabel") },
  ];
  panel.data.queries[0].fields.y = yFields.map((field) => ({
    alias: field.alias,
    column: field.alias,
    color: null,
    label: field.label,
  }));
  panel.data.queries[0].fields.z = [];
  // No breakdown: one series per projected column, which is what names them.
  panel.data.queries[0].fields.breakdown = [];
  panel.data.queries[0].fields.filter = {
    filterType: "group",
    logicalOperator: "AND",
    conditions: [],
  };
  return panel.data;
};

const scorePanel = computed(() =>
  buildPanel(
    "line",
    buildAnomalyScoreQuery(props.anomalyId, interval.value, kindColumns.value),
    [
      { alias: ANOMALY_SCORE_ALIAS, label: t("alerts.anomaly.seriesScore"), color: METRIC_TOKEN },
      {
        alias: ANOMALY_THRESHOLD_ALIAS,
        label: t("alerts.anomaly.seriesThreshold"),
        color: THRESHOLD_TOKEN,
      },
    ],
    "numbers",
    { line_interpolation: "linear" },
  ),
);

const deviationPanel = computed(() =>
  buildPanel(
    "bar",
    buildAnomalyDeviationQuery(props.anomalyId, interval.value, kindColumns.value),
    [
      {
        alias: ANOMALY_DEVIATION_ALIAS,
        label: t("alerts.anomaly.seriesScoreDeviation"),
        color: ANOMALY_TOKEN,
      },
      // Value-space %, not score-space % — its own labelled series, never
      // folded into the scored one.
      ...(kindColumns.value.isPartialDrop
        ? [
            {
              alias: ANOMALY_DROP_ALIAS,
              label: t("alerts.anomaly.seriesDropDeviation"),
              color: DROP_TOKEN as `--${string}`,
            },
          ]
        : []),
    ],
    "percent",
  ),
);

const panels = computed<DetectionPanel[]>(() => [
  {
    key: "score",
    label: t("alerts.anomaly.scoreChart"),
    hint: t("alerts.anomaly.scoreChartHint"),
    schema: scorePanel.value,
  },
  {
    key: "deviation",
    label: t("alerts.anomaly.deviationChart"),
    hint: t("alerts.anomaly.deviationChartHint"),
    schema: deviationPanel.value,
  },
]);

const metricQuery = computed(() =>
  buildAnomalyMetricQuery(props.anomalyId, interval.value, kindColumns.value),
);
const metricRows = ref<AnomalyBandRow[]>([]);
const metricLoading = ref(false);
const metricError = ref("");

const bandCaption = computed(() => {
  const k = latestBandK(metricRows.value);
  return k === null ? "" : t("alerts.anomaly.bandCaption", { k: Math.round(k * 100) / 100 });
});

const metricOptions = computed(() => {
  void store.state.theme; // The resolved token values are cached — re-read on a flip.
  return buildAnomalyBandOptions(
    metricRows.value,
    {
      value: t("alerts.anomaly.seriesValue"),
      range: t("alerts.anomaly.seriesExpectedRange"),
      expected: t("alerts.anomaly.seriesExpected"),
      anomaly: t("alerts.anomaly.seriesAnomaly"),
      anomalyAbove: t("alerts.anomaly.tooltipAnomalyAbove"),
      anomalyBelow: t("alerts.anomaly.tooltipAnomalyBelow"),
      event: t("alerts.anomaly.seriesDropAbsence"),
    },
    {
      value: chartColor(METRIC_TOKEN),
      band: chartColor(BAND_TOKEN),
      anomaly: chartColor(ANOMALY_TOKEN),
      event: chartColor(DROP_TOKEN),
      axis: chartColor(AXIS_TOKEN),
      grid: chartColor(GRID_TOKEN),
    },
    { startMs: windowUs.value.startUs / 1000, endMs: windowUs.value.endUs / 1000 },
    anomalyIntervalMs(interval.value),
    metricUnit.value,
  );
});

// An abandoned search holds a work-group slot until it completes, so a superseded load aborts.
let controller: AbortController | null = null;

async function loadMetric() {
  controller?.abort();
  controller = null;
  metricLoading.value = false;
  const org = store.state.selectedOrganization?.identifier;
  const sql = metricQuery.value;
  metricRows.value = [];
  metricError.value = "";
  if (!org || !sql || !kindColumnsReady.value) return;

  const mine = new AbortController();
  controller = mine;
  metricLoading.value = true;
  try {
    const res = await searchService.search(
      {
        org_identifier: org,
        query: {
          query: {
            sql,
            start_time: windowUs.value.startUs,
            end_time: windowUs.value.endUs,
            from: 0,
            size: -1,
          },
        },
        page_type: "logs",
        signal: mine.signal,
      },
      "ui",
      false,
      ANOMALIES_USE_CACHE,
    );
    if (controller !== mine) return;
    metricRows.value = toAnomalyBandRows(res?.data?.hits ?? []);
  } catch (e: any) {
    if (e?.name === "CanceledError" || e?.code === "ERR_CANCELED") return;
    if (controller !== mine) return;
    metricError.value = e?.response?.data?.message || t("alerts.groups.chartUnavailable");
  } finally {
    // A superseded request's finally must not drop the spinner of the one in flight.
    if (controller === mine) metricLoading.value = false;
  }
}

const loadedModel = computed(() => pageModelVersion(props.alert));
const pointOpen = ref(false);
const pointRow = ref<AnomalyBandRow | null>(null);
const pointLoading = ref(false);
const pointAnchor = ref<HTMLElement | null>(null);
const pointAt = ref({ x: 0, y: 0 });
// rem from the pixel offset ECharts reports, so the anchor follows the clicked point.
const pointAnchorStyle = computed(() => ({
  left: `${pointAt.value.x / 16}rem`,
  top: `${pointAt.value.y / 16}rem`,
}));
const pointIsCurrent = computed(
  () =>
    loadedModel.value !== 0 &&
    pointRow.value?.modelVersion !== null &&
    pointRow.value?.modelVersion === loadedModel.value,
);

const summary = ref<AnomalyExploreResponse | null>(null);
const summaryLoading = ref(true);
const summaryFailed = ref(false);
const nowUs = ref(Date.now() * 1000);
let summarySeq = 0;

// One reload per server model or stale page, so an edited detector still training cannot loop.
const reloadedFor = new Set<string>();

const statusOf = (e: unknown) => (e as { response?: { status?: number } })?.response?.status;

function requestReload(reason: string) {
  pointOpen.value = false;
  if (reloadedFor.has(reason)) return;
  reloadedFor.add(reason);
  emit("reload");
}

async function loadSummary(force = false) {
  const org = store.state.selectedOrganization?.identifier;
  if (!org || !props.anomalyId) return;
  const seq = ++summarySeq;
  const options = anomalyExploreQuery(org, props.anomalyId);
  summaryLoading.value = !summary.value && !summaryFailed.value;
  try {
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: options.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    const res = await queryClient.fetchQuery(options);
    if (seq !== summarySeq) return;
    summary.value = res;
    summaryFailed.value = false;
    nowUs.value = Date.now() * 1000;
    // Keyed by both models, so a second retrain to 0 is not taken for the first.
    if (res.model_version !== loadedModel.value) {
      requestReload(`model:${loadedModel.value}:${res.model_version}`);
    }
  } catch (e) {
    if (seq !== summarySeq) return;
    if (statusOf(e) === 409) requestReload(`stale:${loadedModel.value}`);
    summaryFailed.value = true;
  } finally {
    if (seq === summarySeq) summaryLoading.value = false;
  }
}

// Named handler: Retry must force the read, and `@retry="loadSummary"` would not.
const refreshSummary = () => {
  summaryLoading.value = true;
  summaryFailed.value = false;
  void loadSummary(true);
};

const openUrl = (url: string) => openAppUrl(router, url);

let summaryTimer: ReturnType<typeof setInterval> | null = null;
function armSummaryTimer() {
  if (summaryTimer) clearInterval(summaryTimer);
  summaryTimer = null;
  const ms = anomalyIntervalMs(props.alert?.schedule_interval);
  if (ms) summaryTimer = setInterval(() => void loadSummary(true), ms);
}

const askAiAvailable = computed(
  () => config.isEnterprise === "true" && !!store.state.zoConfig?.ai_enabled && !!summary.value,
);

/** Questions are model input, not screen copy, so the prompt stays English. */
const askAi = () => {
  const res = summary.value;
  if (!res) return;
  const span = res.window
    ? `${formatUtcHm(res.window.start_us)}-${formatUtcHm(res.window.end_us)} UTC`
    : "the last hour";
  emit("ask-ai", {
    query:
      `Anomaly detector "${res.name}" on stream "${res.stream}" measures ${res.measure}. ` +
      `State: ${res.state}. Anomaly window: ${span}.`,
    chipName: t("alerts.anomaly.stripAskAiChip", { name: res.name }),
    newChat: true,
    autoSend: false,
    prompt: "What caused this anomaly, and what should I check first?",
    context: {
      currentPage: "alerts",
      anomalyId: props.anomalyId,
      selectedStreams: res.stream ? [res.stream] : [],
      streamType: props.alert?.stream_type,
      windowStartUs: res.window?.start_us ?? null,
      windowEndUs: res.window?.end_us ?? null,
    },
  });
};

/** By timestamp, not dataIndex: gap rows shift the series indices. */
function onChartClick(params: any) {
  if (params?.seriesName !== t("alerts.anomaly.seriesAnomaly")) return;
  const datum = Array.isArray(params.value) ? params.value : params.data;
  const ts = Number(Array.isArray(datum) ? datum[0] : NaN);
  const row = metricRows.value.find((r) => r.tsMs === ts);
  if (!row || row.flagged === null) return;
  pointRow.value = row;
  pointAt.value = {
    x: Number(params.event?.offsetX) || 0,
    y: Number(params.event?.offsetY) || 0,
  };
  pointOpen.value = true;
}

async function openPointBucket() {
  const row = pointRow.value;
  const org = store.state.selectedOrganization?.identifier;
  const bucketMs = anomalyIntervalMs(interval.value);
  if (!row || !org || !bucketMs || row.modelVersion === null) return;
  pointLoading.value = true;
  try {
    // Never from cache: the request must reach the server to get its stale-model 409.
    const res = await queryClient.fetchQuery({
      ...anomalyExploreQuery(org, props.anomalyId, {
        start: row.tsMs * 1000,
        end: (row.tsMs + bucketMs) * 1000,
        pad: 0,
        model_version: row.modelVersion,
      }),
      staleTime: 0,
    });
    pointOpen.value = false;
    if (res.url) openUrl(res.url);
  } catch (e) {
    if (statusOf(e) === 409) {
      requestReload(`stale:${loadedModel.value}`);
      return;
    }
    toast({ variant: "error", message: t("alerts.anomaly.pointOpenFailed") });
  } finally {
    pointLoading.value = false;
  }
}

// MICROSECONDS into `new Date(...)`, the convention every other alert chart
// feeds the renderer — honest milliseconds draw an empty chart.
function setTimeRange() {
  const endUs = Date.now() * 1000;
  const startUs = endUs - (RANGE_MS[range.value] ?? RANGE_MS["1h"]) * 1000;
  selectedTimeObj.value = {
    start_time: new Date(startUs),
    end_time: new Date(endUs),
  };
  windowUs.value = { startUs, endUs };
}

const onRangeChange = (value: unknown) => {
  if (!value) return;
  range.value = String(value);
  // The renderer watches `selectedTimeObj` and refetches itself.
  setTimeRange();
  void loadSummary(true);
};

watch(
  () => props.anomalyId,
  () => {
    summary.value = null;
    summaryFailed.value = false;
    setTimeRange();
    loadKindColumns();
    void loadSummary();
  },
);
// A reloaded config is a new object: redraw every chart and re-read the strip for it.
watch(
  () => props.alert,
  (next, prev) => {
    if (!next || next === prev) return;
    pointOpen.value = false;
    setTimeRange();
    loadKindColumns();
    void loadSummary(true);
    armSummaryTimer();
  },
);
watch([metricQuery, windowUs, kindColumnsReady], loadMetric);
onMounted(() => {
  setTimeRange();
  loadKindColumns();
  void loadSummary();
  armSummaryTimer();
});
onBeforeUnmount(() => {
  controller?.abort();
  if (summaryTimer) clearInterval(summaryTimer);
});
</script>
