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
  <div ref="chartPanelRef" class="border-border-default relative flex h-full flex-col border">
    <!-- Chart -->
    <div data-test="alert-preview-chart" class="preview-alert-chart min-h-0 flex-1 p-4">
      <!-- Empty query placeholder -->
      <div
        v-if="!query && (selectedTab === 'sql' || selectedTab === 'promql')"
        class="flex h-full flex-col items-center justify-center gap-2"
      >
        <OIcon name="edit" size="xl" class="opacity-20" />
        <span class="text-sm opacity-40">{{ t("alerts.writeQueryToSeePreview") }}</span>
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
        @series-data-update="handleSeriesDataUpdate"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed, nextTick } from "vue";
import { buildThresholdMarkLines, thresholdAxisBounds } from "@/utils/alerts/thresholdMarkLines";
import {
  cleanAggregationQuery,
  getDefaultDashboardPanelData,
} from "@/utils/alerts/aggregationPreviewQuery";
import PanelSchemaRenderer from "../dashboards/PanelSchemaRenderer.vue";
import { reactive } from "vue";
import { onBeforeMount } from "vue";
import { cloneDeep } from "lodash-es";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import searchService from "@/services/search";
import { b64EncodeUnicode, smartDecodeVrlFunction } from "@/utils/zincutils";
import OIcon from "@/lib/core/Icon/OIcon.vue";

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
});

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
const applyThresholds = (critical: unknown, warning: unknown): void => {
  const markLines = buildThresholdMarkLines(critical, warning);
  const bounds = thresholdAxisBounds(markLines);
  dashboardPanelData.data.config.mark_line = markLines;
  dashboardPanelData.data.config.y_axis_min = bounds.y_axis_min;
  dashboardPanelData.data.config.y_axis_max = bounds.y_axis_max;
};

// Helper function to get decoded VRL function
const getDecodedVrlFunction = (): string | null => {
  if (!props.formData.query_condition?.vrl_function) {
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
  dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
  dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
  dashboardPanelData.data.queries[0].customQuery = true;
});

const chartPanelRef = ref(null);
const panelRendererRef = ref(null);
const chartData = ref({});
const selectedTimeObj = ref({});
const evaluationStatus = ref<{
  wouldTrigger: boolean;
  reason: string;
} | null>(null);
const { t } = useI18nTyped();

const store = useStore();

// Computed property to determine if histogram should be used
// For SQL/custom with aggregations (GROUP BY), we should use histogram
// because histogram is needed for aggregated queries
const shouldUseHistogram = computed(() => {
  // Custom mode with aggregations: never use histogram
  if (props.selectedTab === "custom" && props.isAggregationEnabled) {
    return false;
  }

  // For other modes (PromQL, custom without agg), use the prop value
  return props.isUsingBackendSql;
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
    if (props.isAggregationEnabled) {
      const queryForPreview = cleanAggregationQuery(props.query);

      // Build breakdown from aggregation group_by fields.
      // Backend uses the original field names (e.g. status, service) in the SELECT and GROUP BY.
      const groupByFields: string[] = (
        props.formData.query_condition?.aggregation?.group_by || []
      ).filter((f: string) => f && f.trim() !== "");

      const breakdown = groupByFields.map((field: string) => ({
        alias: field,
        column: field,
        color: null,
        label: field,
      }));

      const aggregationCfg = props.formData.query_condition?.aggregation;
      const hasHavingValue =
        aggregationCfg?.having?.value !== undefined &&
        aggregationCfg?.having?.value !== null &&
        aggregationCfg?.having?.value !== "";
      const thresholdValue = hasHavingValue
        ? aggregationCfg.having.value
        : props.formData.trigger_condition?.threshold;
      // Warning must come from the same threshold family as the critical value
      // (aggregate value vs row count) — mixing the two would draw a line on
      // the wrong scale.
      const warningValue = hasHavingValue
        ? aggregationCfg?.warning_value
        : props.formData.trigger_condition?.warning_threshold;

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
      applyThresholds(thresholdValue, warningValue);

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
    const chartType = determineChartType(extractedFields);
    dashboardPanelData.data.type = chartType;

    // Convert schema to fields
    const fields = convertSchemaToFields(extractedFields, chartType);

    // Set up the query
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
    // Critical + optional Warning marklines (alerts_2.md Feature 1). Both are
    // drawn so the two bands are visible on the preview, matching the mock.
    applyThresholds(
      props.formData.trigger_condition?.threshold,
      props.formData.trigger_condition?.warning_threshold,
    );

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

    console.error("Failed to fetch query schema:", error);
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
  if (props.selectedTab === "promql") return;

  // resultMetaData structure from usePanelDataLoader:
  // resultMetaData[queryIndex] is an array of metadata objects from streaming partitions
  // Each metadata object has structure: {...content, ...content.results}
  // Which includes: hits, total, took, etc.

  let resultCount = 0;

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

          const passesHaving = (val: number): boolean => {
            if (numHaving === null) return true;
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
              allHits.push(...partition.hits);
            }
          }

          if (allHits.length > 0 && groupByFields.length > 0) {
            // Group hits by the user's group_by field combination (strip time bucket dimension)
            const groupMap = new Map<string, number[]>();
            for (const hit of allHits) {
              const key = groupByFields.map((f: string) => String(hit[f] ?? "")).join("\x00");
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
        else if (props.selectedTab === "sql") {
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
            }
          } else if (Array.isArray(latestPartition?.hits)) {
            resultCount = latestPartition.hits.length;
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
                if (hit.zo_sql_num !== undefined) {
                  resultCount += hit.zo_sql_num;
                }
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
        evaluateAndSetStatus(resultCount);
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
const writeRealTimeStatus = (): boolean => {
  const isRealTime = props.formData.is_real_time === "true" || props.formData.is_real_time === true;
  if (!isRealTime) return false;
  evaluationStatus.value = {
    wouldTrigger: true,
    reason: t("alerts.previewEvaluation.realTimeReason"),
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
  wouldTrigger: boolean;
  comparison: string;
  level?: PreviewLevel | null;
}) => {
  const args = {
    count: verdict.count,
    label: resultLabelFor(verdict.count),
    comparison: verdict.comparison,
  };
  const sentence = verdict.wouldTrigger
    ? t("alerts.previewEvaluation.reasonMatch", args)
    : t("alerts.previewEvaluation.reasonNoMatch", args);

  evaluationStatus.value = {
    wouldTrigger: verdict.wouldTrigger,
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
const evaluateAndSetStatus = (resultCount: number) => {
  if (writeRealTimeStatus()) return;

  const gate = evaluateCountGate(resultCount);
  setEvaluationStatus({
    count: resultCount,
    wouldTrigger: gate.passes,
    comparison: gate.comparison,
  });
};

/**
 * The PromQL verdict, mirroring `evaluate_level_over_items`
 * (config/meta/alerts/aggregation_level.rs:146):
 *
 *  1. classify each series by its last sample — critical first, most severe wins
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
 * Last sample, not "ever crossed": that matches multi-alert mode exactly. In
 * single-alert mode the backend pre-filters the query, so a series that crossed
 * and came back down still counts there while the preview says it does not —
 * the safe direction for a preview, which never claims an alert would fire on a
 * series that is currently healthy.
 */
const evaluatePromqlSeries = (dataSeries: any[]) => {
  if (writeRealTimeStatus()) return;

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

  for (const series of dataSeries) {
    const value = classifiableSample(series?.data);
    if (value === null) continue;
    if (promqlSampleMatches(value, operator, critical)) {
      criticalCount++;
      firingCount++;
    } else if (warning !== null && promqlSampleMatches(value, operator, warning)) {
      firingCount++;
    }
  }

  const hasWarningBand = warning !== null;

  const criticalGate = evaluateCountGate(criticalCount);
  if (criticalGate.passes) {
    setEvaluationStatus({
      count: criticalCount,
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
  setEvaluationStatus({
    count: firingCount,
    wouldTrigger: firesWarning,
    comparison: firingGate.comparison,
    level: firesWarning ? "warning" : null,
  });
};

// Handle series data update event (PromQL only — every other mode is evaluated
// from partition metadata in handleChartDataUpdate)
const handleSeriesDataUpdate = (seriesData: any) => {
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
    const emittedSeries: any[] = Array.isArray(seriesData?.options?.series)
      ? seriesData.options.series
      : [];

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
    const dataSeries = emittedSeries.filter((s: any) => {
      const hasData = Array.isArray(s?.data);
      const hasMultiplePoints = hasData && s.data.length > 1;
      const hasName = s?.name !== undefined && s?.name !== null;
      return (hasName || hasMultiplePoints) && hasData;
    });

    evaluatePromqlSeries(dataSeries);
  } catch (error) {
    console.error("[PreviewAlert] Error processing series data:", error);
  }
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

  const relativeTime = props.formData.trigger_condition.period;

  const endTime = new Date().getTime() * 1000;

  // Priority order for time range:
  // 1. Use env variable ZO_ALERT_PREVIEW_TIMERANGE_MINUTES if set and > 0
  // 2. Fall back to alert period
  const previewTimerangeMinutes = store.state.zoConfig.alert_preview_timerange_minutes || 0;
  let new_relative_time;

  if (previewTimerangeMinutes > 0) {
    // Use the configured preview timerange from env variable
    new_relative_time = previewTimerangeMinutes;
  } else {
    // Fall back to using the alert period
    new_relative_time = relativeTime;
  }

  const startTime = endTime - new_relative_time * 60 * 1000000;

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
    dashboardPanelData.data.queries[0].config.promql_legend_fallback =
      props.formData.stream_name || t("alerts.preview");
    dashboardPanelData.data.queryType = "promql";
    dashboardPanelData.data.type = "line"; // Default chart type for PromQL time-series

    // Add threshold mark line from promql_condition
    applyThresholds(
      props.formData.query_condition?.promql_condition?.value,
      props.formData.query_condition?.promql_warning_value,
    );

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
    dashboardPanelData.data.queries[0].query = props.query;
    dashboardPanelData.data.queries[0].vrlFunctionQuery = null; // VRL not supported in custom mode
    dashboardPanelData.data.config.table_dynamic_columns = false; // VRL not supported in custom mode
    dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
    dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
    dashboardPanelData.data.queryType = "sql";
    dashboardPanelData.data.type = "line"; // Line chart for histogram
    applyThresholds(
      props.formData.trigger_condition?.threshold,
      props.formData.trigger_condition?.warning_threshold,
    );

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

// Track if this is the initial load to prevent duplicate API calls
let isInitialLoad = true;
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

// Watch for changes to props and refresh chart data automatically
watch(
  () => [
    props.query,
    props.formData.stream_name,
    props.formData.stream_type,
    props.formData.trigger_condition?.period,
    props.formData.trigger_condition?.threshold,
    props.formData.trigger_condition?.operator,
    props.formData.query_condition?.promql_condition?.value,
    props.selectedTab,
    props.isUsingBackendSql,
  ],
  () => {
    // Skip if editor is open - we'll refresh when it closes
    if (props.isEditorOpen) {
      return;
    }

    // Skip the first watch trigger on mount since onMounted will handle it
    if (isInitialLoad) {
      isInitialLoad = false;
      lastRefreshTime = Date.now(); // stamp so 200ms debounce blocks rapid follow-up
      return;
    }

    // Check if aggregation is enabled but required fields are missing
    if (props.isAggregationEnabled && props.formData.query_condition?.aggregation) {
      const hasColumn =
        props.formData.query_condition.aggregation.having?.column &&
        props.formData.query_condition.aggregation.having.column.trim() !== "";
      const hasValue =
        props.formData.query_condition.aggregation.having?.value !== undefined &&
        props.formData.query_condition.aggregation.having.value !== null &&
        props.formData.query_condition.aggregation.having.value !== "";

      if (!hasColumn || !hasValue) {
        return;
      }
    }

    // Refresh if we have a valid query
    if (props.query) {
      refreshDataOnce();
    }
  },
  { deep: true },
);

// Refresh data on mount if we already have a query
onMounted(() => {
  // Skip for PromQL to avoid duplicate API calls (watchers handle it)
  if (props.selectedTab === "promql") {
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

// Expose the real refreshData for explicit parent calls (bypasses the 200ms debounce).
// The watcher internally still uses refreshDataOnce to prevent duplicate calls on rapid prop changes.
defineExpose({ refreshData, resizeChart, evaluationStatus });
</script>
