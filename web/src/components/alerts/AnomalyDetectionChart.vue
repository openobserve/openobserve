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
        >
          {{ option.label }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

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
        <PanelSchemaRenderer
          v-if="panel.schema"
          :height="5"
          :width="5"
          :panelSchema="panel.schema"
          :selectedTimeObj="selectedTimeObj"
          :variablesData="{}"
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
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { computed, onMounted, ref, watch } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useStore } from "vuex";

import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import PanelBar from "@/components/common/PanelBar.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import { chartColor } from "@/utils/chartTheme";
import { getDefaultDashboardPanelData } from "@/utils/alerts/aggregationPreviewQuery";
import {
  ANOMALY_DEVIATION_ALIAS,
  ANOMALY_FLAGGED_ALIAS,
  ANOMALY_SCORE_ALIAS,
  ANOMALY_STREAM,
  ANOMALY_THRESHOLD_ALIAS,
  ANOMALY_VALUE_ALIAS,
  ANOMALY_X_ALIAS,
  buildAnomalyDeviationQuery,
  buildAnomalyMetricQuery,
  buildAnomalyScoreQuery,
} from "@/utils/alerts/anomalyChartQuery";

const props = defineProps<{ alert: any; anomalyId: string }>();

const { t } = useI18nTyped();
const store = useStore();

// Semantic, not palette indices: the flagged series IS the error state and the
// threshold IS the warning line, so a retheme of those carries to these.
const METRIC_TOKEN = "--color-chart-series-1";
const ANOMALY_TOKEN = "--color-status-error-text";
const THRESHOLD_TOKEN = "--color-status-warning-text";

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
const range = ref<string>("1h");

const rangeOptions = computed(() => [
  { value: "1h", label: t("alerts.groups.range1h") },
  { value: "6h", label: t("alerts.groups.range6h") },
  { value: "24h", label: t("alerts.groups.range24h") },
]);

const interval = computed(() => props.alert?.histogram_interval);

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

const metricPanel = computed(() =>
  buildPanel(
    "line",
    buildAnomalyMetricQuery(props.anomalyId, interval.value),
    [
      { alias: ANOMALY_VALUE_ALIAS, label: t("alerts.anomaly.seriesValue"), color: METRIC_TOKEN },
      {
        alias: ANOMALY_FLAGGED_ALIAS,
        label: t("alerts.anomaly.seriesAnomaly"),
        color: ANOMALY_TOKEN,
      },
    ],
    "numbers",
    {
      // A single flagged bucket is a one-point series, and a line through one
      // point draws nothing — the isolated anomaly would be invisible.
      show_symbol: true,
      // Linear, not the default smooth: a spline invents curvature between
      // buckets, and the shape of the excursion is the thing being read.
      line_interpolation: "linear",
    },
  ),
);

const scorePanel = computed(() =>
  buildPanel(
    "line",
    buildAnomalyScoreQuery(props.anomalyId, interval.value),
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
    buildAnomalyDeviationQuery(props.anomalyId, interval.value),
    [
      {
        alias: ANOMALY_DEVIATION_ALIAS,
        label: t("alerts.anomaly.seriesDeviation"),
        color: ANOMALY_TOKEN,
      },
    ],
    "percent",
  ),
);

const panels = computed<DetectionPanel[]>(() => [
  {
    key: "metric",
    label: t("alerts.anomaly.metricChart"),
    hint: t("alerts.anomaly.metricChartHint"),
    schema: metricPanel.value,
  },
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

// MICROSECONDS into `new Date(...)`, the convention every other alert chart
// feeds the renderer — honest milliseconds draw an empty chart.
function setTimeRange() {
  const endUs = Date.now() * 1000;
  const startUs = endUs - (RANGE_MS[range.value] ?? RANGE_MS["1h"]) * 1000;
  selectedTimeObj.value = {
    start_time: new Date(startUs),
    end_time: new Date(endUs),
  };
}

const onRangeChange = (value: unknown) => {
  if (!value) return;
  range.value = String(value);
  // The renderer watches `selectedTimeObj` and refetches itself.
  setTimeRange();
};

watch(() => props.anomalyId, setTimeRange);
onMounted(setTimeRange);
</script>
