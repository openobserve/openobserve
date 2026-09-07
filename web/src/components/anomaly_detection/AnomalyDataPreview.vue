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
  <div class="h-full px-3 py-2">
    <!-- The echarts canvas collapses to a sliver unless it resolves to an explicit box -->
    <div class="relative h-full w-full">
      <div
        v-if="!previewActive"
        class="absolute inset-0 flex flex-col items-center justify-center gap-2"
        data-test="anomaly-data-preview-empty"
      >
        <OIcon name="bar-chart" size="lg" class="opacity-20" />
        <span class="text-text-secondary text-sm font-medium">{{ emptyHint }}</span>
      </div>
      <PanelSchemaRenderer
        v-else
        :key="previewKey"
        :panelSchema="previewPanelSchema"
        :selectedTimeObj="previewTimeObj"
        :variablesData="{}"
        :forceLoad="true"
        searchType="ui"
        class="absolute inset-0"
        data-test="anomaly-data-preview-chart"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import {
  buildAnomalyFilterExpression,
  operatorNeedsValue,
} from "@/utils/alerts/anomalyFilterOperators";
import { toDetectionFunctionSql } from "@/utils/alerts/anomalySqlBuilder";

const props = defineProps<{ config: Record<string, any> }>();

const { t } = useI18nTyped();

const previewActive = ref(false);
const previewKey = ref(0);
const previewPanelSchema = ref<any>(null);
const previewTimeObj = ref<any>(null);
const lastRequestKey = ref("");

// The form emits "" for a cleared number input, which ?? does not catch
const toPositive = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const positiveOr = (value: unknown, fallback: number) => toPositive(value) ?? fallback;

// Whether there is anything to preview at all — false is what the empty state means
const hasQueryTarget = computed(() =>
  props.config.query_mode === "custom_sql"
    ? Boolean(props.config.stream_name && props.config.custom_sql?.trim())
    : Boolean(props.config.stream_name),
);

// Nothing clicks "load" any more, so a half-typed config must not reach the search API
const canPreview = computed(() => {
  if (!hasQueryTarget.value) return false;
  if (props.config.query_mode === "custom_sql") return true;
  if (props.config.detection_function !== "count" && !props.config.detection_function_field) {
    return false;
  }
  return (
    toPositive(props.config.histogram_interval_value) !== null &&
    toPositive(props.config.detection_window_value) !== null
  );
});

const emptyHint = computed(() =>
  props.config.stream_name ? t("alerts.writeQueryToSeePreview") : t("alerts.previewEmptyState"),
);

// Reads props.config, which AnomalyDetectionConfig's write-back watch keeps in sync with its form
const buildPreviewSql = () => {
  let sql: string;
  if (props.config.query_mode === "custom_sql") {
    sql = props.config.custom_sql || "";
  } else {
    const streamName = props.config.stream_name;
    if (!streamName) {
      sql = "";
    } else {
      const intervalValue = positiveOr(props.config.histogram_interval_value, 5);
      const intervalUnit = props.config.histogram_interval_unit ?? "m";
      const interval = `${intervalValue}${intervalUnit}`;
      const fn = toDetectionFunctionSql(
        props.config.detection_function || "count",
        props.config.detection_function_field || "*",
      );
      const filterLines = (props.config.filters || [])
        .filter((f: any) => f.field && (operatorNeedsValue(f.operator) ? f.value : true))
        .map((f: any) => `  AND ${buildAnomalyFilterExpression(f.field, f.operator, f.value)}`);
      const where = filterLines.length
        ? [
            "WHERE",
            ...filterLines.map((l: string, i: number) =>
              i === 0 ? l.replace(/^\s+AND /, "  ") : l,
            ),
          ].join("\n")
        : "";
      sql = [
        `SELECT histogram(_timestamp, '${interval}') AS time_bucket,`,
        `       ${fn} AS value`,
        `FROM "${streamName}"`,
        where,
        `GROUP BY time_bucket`,
        `ORDER BY time_bucket`,
      ]
        .filter(Boolean)
        .join("\n");
    }
  }
  // The dashboard panel query executor can truncate at newlines in some code paths
  return sql.replace(/\s+/g, " ").trim();
};

const loadPreview = () => {
  const sql = buildPreviewSql();
  if (!sql || !props.config.stream_name) {
    previewActive.value = false;
    return;
  }

  const windowValue = positiveOr(props.config.detection_window_value, 30);
  const windowUnit = props.config.detection_window_unit ?? "m";
  const windowMs = windowValue * (windowUnit === "h" ? 3600000 : 60000);

  // Edits that leave the query identical (an empty filter row, a retyped value)
  // must not cost a search — previewKey would force a refetching remount
  const requestKey = `${sql}|${windowValue}${windowUnit}|${props.config.stream_type}`;
  if (previewActive.value && requestKey === lastRequestKey.value) return;
  lastRequestKey.value = requestKey;
  // usePanelDataLoader reads .getTime() off these, so the Date must carry MICROseconds, not ms
  const endMicros = new Date().getTime() * 1000;
  const startMicros = endMicros - windowMs * 1000;

  previewTimeObj.value = {
    start_time: new Date(startMicros),
    end_time: new Date(endMicros),
  };
  // PanelSchemaRenderer expects the inner data object directly (not wrapped)
  previewPanelSchema.value = {
    version: 2,
    id: "anomaly-preview",
    type: "line",
    title: "",
    description: "",
    config: {
      show_legends: false,
      legends_position: "bottom",
      unit: "short",
      unit_custom: "",
      promql_legend: "",
      axis_border_show: false,
      connect_nulls: true,
      no_value_replacement: "",
      wrap_table_cells: false,
      table_transpose: false,
      table_dynamic_columns: false,
      base_map: { type: "osm" },
      map_view: { zoom: 1, lat: 0, lng: 0 },
      custom_chart_options: {
        tooltip: { appendToBody: true, confine: false },
      },
      mark_line: [],
    },
    queryType: "sql",
    queries: [
      {
        query: sql,
        customQuery: true,
        vrlFunctionQuery: null,
        query_fn: null,
        fields: {
          stream: props.config.stream_name,
          stream_type: props.config.stream_type || "logs",
          x: [
            {
              alias: "time_bucket",
              column: "time_bucket",
              label: "",
              color: null,
            },
          ],
          y: [
            {
              alias: "value",
              column: "value",
              label: "",
              // eslint-disable-next-line local/no-hardcoded-color -- ECharts series colour in a dashboard panel schema; no CSS cascade resolves there
              color: "#5960b2",
            },
          ],
          z: [],
          breakdown: [],
          filter: {
            filterType: "group",
            logicalOperator: "AND",
            conditions: [],
          },
          latitude: null,
          longitude: null,
          weight: null,
        },
        config: {
          promql_legend: "",
          layer_type: "scatter",
          weight_fixed: 1,
          limit: 0,
          min: 0,
          max: 100,
          time_shift: [],
        },
      },
    ],
  };
  previewKey.value++;
  previewActive.value = true;
};

// Debounced so a burst of field edits costs one query, matching PreviewAlert
let previewRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const clearRefreshTimer = () => {
  if (previewRefreshTimer) clearTimeout(previewRefreshTimer);
  previewRefreshTimer = null;
};

watch(
  () => [
    props.config.stream_name,
    props.config.stream_type,
    props.config.detection_window_value,
    props.config.detection_window_unit,
    props.config.histogram_interval_value,
    props.config.histogram_interval_unit,
    props.config.query_mode,
    props.config.custom_sql,
    props.config.detection_function,
    props.config.detection_function_field,
    props.config.filters,
  ],
  () => {
    clearRefreshTimer();
    if (!hasQueryTarget.value) {
      previewActive.value = false;
      lastRequestKey.value = "";
      return;
    }
    // A momentarily invalid number (a cleared interval mid-edit) blocks the query
    // but keeps the last chart, rather than blanking the card on every keystroke
    if (!canPreview.value) return;
    previewRefreshTimer = setTimeout(loadPreview, 600);
  },
  { deep: true },
);

// Immediate on mount — edit mode arrives with a complete config and should not wait out the debounce
onMounted(() => {
  if (canPreview.value) loadPreview();
});

onBeforeUnmount(clearRefreshTimer);

defineExpose({ loadPreview, previewActive, previewPanelSchema, previewTimeObj });
</script>
