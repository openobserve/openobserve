<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="preview-alert-container" :class="{'preview-alert-container-light': store.state.theme !== 'dark'}" ref="chartPanelRef" style="height: 100%; position: relative; display: flex; flex-direction: column;">
    <!-- Chart -->
    <div data-test="alert-preview-chart" class="preview-alert-chart" style="flex: 1; min-height: 0; padding: 1rem;">
      <PanelSchemaRenderer
        ref="panelRendererRef"
        v-if="chartData"
        :height="5"
        :width="5"
        :panelSchema="chartData"
        :selectedTimeObj="selectedTimeObj"
        :variablesData="{}"
        searchType="UI"
        :is_ui_histogram="shouldUseHistogram"
        style="height: 180px; width: 100%;"
        @result-metadata-update="handleChartDataUpdate"
        @series-data-update="handleSeriesDataUpdate"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed, nextTick } from "vue";
import PanelSchemaRenderer from "../dashboards/PanelSchemaRenderer.vue";
import { reactive } from "vue";
import { onBeforeMount } from "vue";
import { cloneDeep } from "lodash-es";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import searchService from "@/services/search";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { logsUtils } from "@/composables/useLogs/logsUtils";

const getDefaultDashboardPanelData: any = () => ({
  data: {
    version: 2,
    id: "",
    type: "bar",
    title: "",
    description: "",
    config: {
      show_legends: true,
      legends_position: "bottom",
      unit: "short",
      unit_custom: "",
      promql_legend: "",
      axis_border_show: true,
      connect_nulls: true,
      no_value_replacement: "",
      wrap_table_cells: false,
      table_transpose: false,
      table_dynamic_columns: false,
      base_map: {
        type: "osm",
      },
      map_view: {
        zoom: 1,
        lat: 0,
        lng: 0,
      },
    },
    queryType: "sql",
    queries: [
      {
        query: "",
        customQuery: false,
        fields: {
          stream: "",
          stream_type: "logs",
          x: [],
          y: [],
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
          // gauge min and max values
          min: 0,
          max: 100,
          time_shift: [],
        },
      },
    ],
  },
  layout: {
    splitter: 20,
    querySplitter: 20,
    showQueryBar: false,
    isConfigPanelOpen: false,
    currentQueryIndex: 0,
  },
  meta: {
    parsedQuery: "",
    dragAndDrop: {
      dragging: false,
      dragElement: null,
      dragSource: null,
      dragSourceIndex: null,
      currentDragArea: null,
      targetDragIndex: null,
    },
    errors: {
      queryErrors: [],
    },
    editorValue: "",
    dateTime: { start_time: "", end_time: "" },
    filterValue: <any>[],
    stream: {
      selectedStreamFields: [],
      customQueryFields: [],
      functions: [],
      streamResults: <any>[],
      filterField: "",
    },
  },
});

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

  const { hasAggregation, fnParsedSQL } = logsUtils();

onBeforeMount(() => {
  dashboardPanelData = reactive({ ...getDefaultDashboardPanelData() });
  dashboardPanelData.data.type = "line";
  dashboardPanelData.data.queryType =
    props.selectedTab === "promql" ? "promql" : "sql";
  dashboardPanelData.data.queries[0].query = props.query;
  dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
  dashboardPanelData.data.queries[0].fields.stream_type =
    props.formData.stream_type;
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
const { t } = useI18n();

const store = useStore();

// Computed property to determine if histogram should be used
// For SQL/custom with aggregations (GROUP BY), we should use histogram
// because histogram is needed for aggregated queries
const shouldUseHistogram = computed(() => {
  // SQL mode with aggregations: dont use histogram
  if (props.selectedTab === "sql") {
    const parsedSQL = fnParsedSQL(props.query);
    if (parsedSQL && (hasAggregation(parsedSQL?.columns) || parsedSQL.groupby != null)) {
      return false;
    }
    return true;
  }

  // Custom mode with aggregations: never use histogram
  if (props.selectedTab === "custom" && props.isAggregationEnabled) {
    return false;
  }

  // For other modes (PromQL, custom without agg), use the prop value
  return props.isUsingBackendSql;
});

// Determine chart type based on result schema from API
const determineChartType = (extractedFields: {
  group_by: string[];
  projections: string[];
  timeseries_field: string | null;
}): string => {
  // Check if we have histogram or timestamp in group_by (common patterns)
  const hasTimeSeriesGrouping = extractedFields.group_by.some(field =>
    field && (
      field.toLowerCase().includes('histogram') ||
      field.toLowerCase().includes('_timestamp') ||
      field.toLowerCase().includes('timestamp')
    )
  );

  // If we have a time series field OR time-based grouping, use line chart
  if (
    extractedFields.timeseries_field ||
    (hasTimeSeriesGrouping && extractedFields.group_by.length <= 2)
  ) {
    return "line";
  }

  // If we have group by without time series, could be bar chart
  if (extractedFields.group_by.length > 0 && extractedFields.group_by.length <= 2) {
    return "bar";
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
      x: extractedFields.projections.map(field => ({
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
    y: yAxisFields.map(field => ({
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

// Fetch query schema from result_schema API for SQL mode
const fetchQuerySchema = async () => {
  try {
    const startTime = dashboardPanelData.meta.dateTime.start_time;
    const endTime = dashboardPanelData.meta.dateTime.end_time;

    const schemaRes = await searchService.result_schema(
      {
        org_identifier: store.state.selectedOrganization.identifier,
        query: {
          query: {
            sql: store.state.zoConfig.sql_base64_enabled
              ? b64EncodeUnicode(props.query)
              : props.query,
            query_fn: null,
            start_time: new Date(startTime).getTime() * 1000, // Convert to microseconds
            end_time: new Date(endTime).getTime() * 1000,
            size: -1,
            histogram_interval: undefined,
            streaming_output: false,
            streaming_id: null,
          },
          ...(store.state.zoConfig.sql_base64_enabled
            ? { encoding: "base64" }
            : {}),
        },
        page_type: props.formData.stream_type || "logs",
        is_streaming: false,
      },
      "ui",
    );

    const extractedFields = schemaRes.data;

    // Determine chart type based on schema
    const chartType = determineChartType(extractedFields);
    dashboardPanelData.data.type = chartType;


    // Convert schema to fields
    const fields = convertSchemaToFields(extractedFields, chartType);

    // Set up the query
    dashboardPanelData.data.queries[0].customQuery = true;
    dashboardPanelData.data.queries[0].query = props.query;
    dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
    dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
    dashboardPanelData.data.queryType = "sql";

    // Set the fields from schema
    dashboardPanelData.data.queries[0].fields.x = fields.x;
    dashboardPanelData.data.queries[0].fields.y = fields.y;
    dashboardPanelData.data.queries[0].fields.z = [];
    dashboardPanelData.data.queries[0].fields.breakdown = fields.breakdown;

    // For SQL queries without aggregation, use zo_sql_key for x and zo_sql_num for y
    const parsedSQL = fnParsedSQL(props.query);
    const hasAgg = parsedSQL && (hasAggregation(parsedSQL?.columns) || parsedSQL.groupby != null);
    if (props.selectedTab === "sql" && !hasAgg) {
      dashboardPanelData.data.queries[0].fields.x = [{ label: 'zo_sql_key', alias: 'zo_sql_key', column: 'zo_sql_key' }];
      dashboardPanelData.data.queries[0].fields.y = [{ label: 'zo_sql_num', alias: 'zo_sql_num', column: 'zo_sql_num', aggregationFunction: 'count' }];
      dashboardPanelData.data.queries[0].fields.breakdown = [];
    }

    // Ensure filter is always an object
    if (!dashboardPanelData.data.queries[0].fields.filter || Array.isArray(dashboardPanelData.data.queries[0].fields.filter)) {
      dashboardPanelData.data.queries[0].fields.filter = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      };
    }

    chartData.value = cloneDeep(dashboardPanelData.data);
    selectedTimeObj.value = { ...dashboardPanelData.meta.dateTime };

    // Note: Alert status evaluation now happens via handleChartDataUpdate event from PanelSchemaRenderer
  } catch (error) {
    console.error("Failed to fetch query schema:", error);
    // Fallback to table view on error
    dashboardPanelData.data.type = "table";
    dashboardPanelData.data.queries[0].customQuery = true;
    dashboardPanelData.data.queries[0].query = props.query;
    dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
    dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
    dashboardPanelData.data.queryType = "sql";
    dashboardPanelData.data.queries[0].fields.x = [];
    dashboardPanelData.data.queries[0].fields.y = [];
    dashboardPanelData.data.queries[0].fields.z = [];
    dashboardPanelData.data.queries[0].fields.breakdown = [];

    if (!dashboardPanelData.data.queries[0].fields.filter || Array.isArray(dashboardPanelData.data.queries[0].fields.filter)) {
      dashboardPanelData.data.queries[0].fields.filter = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      };
    }

    chartData.value = cloneDeep(dashboardPanelData.data);
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
        // SQL mode and custom with aggregations: use 'total' field (count of aggregated groups)
        if (props.selectedTab === "sql" || (props.selectedTab === "custom" && props.isAggregationEnabled)) {
          // Sum up total from all partitions instead of just taking the last one
          // This handles streaming responses where data comes in multiple partitions
          if (firstQueryMetadata.some((partition: any) => partition?.total !== undefined)) {
            resultCount = firstQueryMetadata.reduce((sum: number, partition: any) => {
              return sum + (partition?.total || 0);
            }, 0);
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
            console.warn("[PreviewAlert] Could not determine result count from metadata:", latestPartition);
          }
        }
      }

      evaluateAndSetStatus(resultCount);
    }
  } catch (error) {
    console.error("[PreviewAlert] Error processing chart data:", error);
  }
};

// Handle series data update event (for PromQL and other series-based data)
const handleSeriesDataUpdate = (seriesData: any) => {
  // Only process for PromQL mode
  if (props.selectedTab !== "promql") {
    return;
  }

  // Safety check: ensure trigger_condition exists
  if (!props.formData.trigger_condition) {
    console.warn("[PreviewAlert] No trigger_condition found in series update");
    return;
  }

  try {
    // seriesData should contain the chart series information
    // For PromQL, count the number of series (time series count)
    let resultCount = 0;

    if (Array.isArray(seriesData)) {
      resultCount = seriesData.length;
    } else if (seriesData && typeof seriesData === 'object') {
      // Check if there's a nested array
      if (Array.isArray(seriesData.series)) {
        resultCount = seriesData.series.length;
      } else if (Array.isArray(seriesData.data)) {
        resultCount = seriesData.data.length;
      } else if (seriesData.options && Array.isArray(seriesData.options.series)) {
        // ECharts series are in options.series
        // Filter to only count actual data series with meaningful data
        // Exclude helper/placeholder series (unnamed series with only 1 data point)
        const dataSeries = seriesData.options.series.filter((s: any) => {
          const hasData = s.data && Array.isArray(s.data);
          const hasMultiplePoints = hasData && s.data.length > 1;
          const hasName = s.name !== undefined && s.name !== null;

          // Count series that either have a name OR have multiple data points
          // This filters out placeholder series (no name, 1 point)
          return (hasName || hasMultiplePoints) && hasData;
        });
        resultCount = dataSeries.length;
      } else if (seriesData.options?.dataset?.source) {
        // Dataset-based series
        const source = seriesData.options.dataset.source;
        if (Array.isArray(source) && source.length > 1) {
          resultCount = source.length - 1; // Subtract header row
        }
      }
    }

    if (resultCount > 0) {
      evaluateAndSetStatus(resultCount);
    }
  } catch (error) {
    console.error("[PreviewAlert] Error processing series data:", error);
  }
};

// Separate function to evaluate and set status based on result count
const evaluateAndSetStatus = (resultCount: number) => {
  const isRealTime = props.formData.is_real_time === "true" || props.formData.is_real_time === true;

  // For aggregation, always use > 0 (backend checks if any aggregated results exist)
  let threshold: number;
  let operator: string;

  if (props.isAggregationEnabled) {
    // When aggregation is enabled, backend always checks for > 0 results
    threshold = 0;
    operator = ">";
  } else {
    // Use regular trigger condition threshold values
    threshold = props.formData.trigger_condition?.threshold || 0;
    operator = props.formData.trigger_condition?.operator || ">=";
  }

  let wouldTrigger = false;
  let comparisonText = "";

  // For real-time alerts, show neutral message (preview shows historical data, not real-time)
  if (isRealTime) {
    // Always show as "would trigger" with informational message for real-time alerts
    evaluationStatus.value = {
      wouldTrigger: true,
      reason: 'When conditions match',
    };
    return;
  }

  // For scheduled alerts, evaluate based on operator and threshold
  switch (operator) {
    case ">=":
      wouldTrigger = resultCount >= threshold;
      comparisonText = `${resultCount} >= ${threshold}`;
      break;
    case ">":
      wouldTrigger = resultCount > threshold;
      comparisonText = `${resultCount} > ${threshold}`;
      break;
    case "<=":
      wouldTrigger = resultCount <= threshold;
      comparisonText = `${resultCount} <= ${threshold}`;
      break;
    case "<":
      wouldTrigger = resultCount < threshold;
      comparisonText = `${resultCount} < ${threshold}`;
      break;
    case "==":
    case "=":
      wouldTrigger = resultCount === threshold;
      comparisonText = `${resultCount} == ${threshold}`;
      break;
    case "!=":
      wouldTrigger = resultCount !== threshold;
      comparisonText = `${resultCount} != ${threshold}`;
      break;
  }

  // Determine appropriate label based on chart data
  const chartType = dashboardPanelData.data.type;
  const hasGroupBy = dashboardPanelData.data.queries[0]?.fields?.breakdown?.length > 0 ||
                     dashboardPanelData.data.queries[0]?.fields?.x?.length > 0;

  let resultLabel = "result";
  if (chartType === "bar" && hasGroupBy) {
    resultLabel = resultCount !== 1 ? "groups" : "group";
  } else if (chartType === "line") {
    resultLabel = resultCount !== 1 ? "data points" : "data point";
  } else if (chartType === "table") {
    resultLabel = resultCount !== 1 ? "rows" : "row";
  } else {
    resultLabel = resultCount !== 1 ? "results" : "result";
  }

  evaluationStatus.value = {
    wouldTrigger,
    reason: wouldTrigger
      ? `${resultCount} ${resultLabel} match (${comparisonText})`
      : `${resultCount} ${resultLabel} found - does not meet ${comparisonText}`,
  };
};

const refreshData = () => {
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
      label: "Timestamp",
    },
  ];

  let yAxis = [];

  // Handle SQL mode and custom mode with aggregations - use result_schema API to intelligently determine chart type
  if (props.selectedTab === "sql" || (props.selectedTab === "custom" && props.isAggregationEnabled)) {
    // Use result_schema API to get query structure
    fetchQuerySchema();
    return;
  }

  // Handle PromQL mode - configure for time-series visualization
  if (props.selectedTab === "promql") {
    // PromQL mode: query should be a string, not an object
    dashboardPanelData.data.queries[0].query = props.query || "";
    dashboardPanelData.data.queries[0].customQuery = false;
    dashboardPanelData.data.queries[0].fields.x = [];
    dashboardPanelData.data.queries[0].fields.y = [];
    dashboardPanelData.data.queries[0].fields.z = [];
    dashboardPanelData.data.queries[0].fields.breakdown = [];
    dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
    dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
    dashboardPanelData.data.queries[0].config.promql_mode = true;
    dashboardPanelData.data.queryType = "promql";
    dashboardPanelData.data.type = "line"; // Default chart type for PromQL time-series

    // Update both refs together to prevent double watcher triggers
    const newChartData = cloneDeep(dashboardPanelData.data);
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
        label: "Time",
        alias: "zo_sql_key",
        column: "zo_sql_key",
        color: null,
      }
    ];

    // Configure y-axis for zo_sql_num (counts)
    yAxis = [
      {
        label: "count",
        alias: "zo_sql_num",
        column: "zo_sql_num",
        color: "#5960b2",
      }
    ];

    dashboardPanelData.data.queries[0].fields.x = xAxis;
    dashboardPanelData.data.queries[0].fields.y = yAxis;
    dashboardPanelData.data.queries[0].fields.z = [];
    dashboardPanelData.data.queries[0].fields.breakdown = [];
    dashboardPanelData.data.queries[0].customQuery = true;
    dashboardPanelData.data.queries[0].query = props.query;
    dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
    dashboardPanelData.data.queries[0].fields.stream_type = props.formData.stream_type;
    dashboardPanelData.data.queryType = "sql";
    dashboardPanelData.data.type = "bar"; // Bar chart for histogram

    // Update both refs together to prevent double watcher triggers
    const newChartData = cloneDeep(dashboardPanelData.data);
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
  dashboardPanelData.data.queries[0].fields.stream = props.formData.stream_name;
  dashboardPanelData.data.queries[0].fields.stream_type =
    props.formData.stream_type;
  dashboardPanelData.data.queryType =
    props.selectedTab === "promql" ? "promql" : "sql";

  // Update both refs together
  // Note: Updating both chartData and selectedTimeObj may trigger two separate watchers
  // in usePanelDataLoader, resulting in duplicate query_range API calls for PromQL queries
  const newChartData = cloneDeep(dashboardPanelData.data);
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
      return;
    }

    // Check if aggregation is enabled but required fields are missing
    if (props.isAggregationEnabled && props.formData.query_condition?.aggregation) {
      const hasColumn = props.formData.query_condition.aggregation.having?.column &&
                        props.formData.query_condition.aggregation.having.column.trim() !== '';
      const hasValue = props.formData.query_condition.aggregation.having?.value !== undefined &&
                       props.formData.query_condition.aggregation.having.value !== null &&
                       props.formData.query_condition.aggregation.having.value !== '';

      if (!hasColumn || !hasValue) {
        return;
      }
    }

    // Refresh if we have a valid query
    if (props.query) {
      refreshDataOnce();
    }
  },
  { deep: true }
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

// Expose refreshDataOnce instead of refreshData to prevent duplicate calls from parent
defineExpose({ refreshData: refreshDataOnce, evaluationStatus });
</script>

<style scoped>
.sql-preview {
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 5vh;
}
.preview-alert-container{
  border: 1px solid rgb(39, 39, 39) !important;
}
.preview-alert-container-light{
  border: 1px solid #e6e6e6 !important;
}

/* Status Bar Styles */
</style>
