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
        style="height: 180px; width: 100%; overflow-x: hidden;"
        @result-metadata-update="handleChartDataUpdate"
        @series-data-update="handleSeriesDataUpdate"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from "vue";
import PanelSchemaRenderer from "../dashboards/PanelSchemaRenderer.vue";
import { reactive } from "vue";
import { onBeforeMount } from "vue";
import { cloneDeep } from "lodash-es";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import searchService from "@/services/search";
import { b64EncodeUnicode } from "@/utils/zincutils";

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
});

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
// For SQL/custom with aggregations (GROUP BY), we should NOT use histogram
// because the query already has its own aggregation logic
const shouldUseHistogram = computed(() => {
  // SQL mode with aggregations: never use histogram
  if (props.selectedTab === "sql") {
    return false;
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
        page_type: "logs",
        is_streaming: false,
      },
      "ui",
    );

    const extractedFields = schemaRes.data;

    // Debug: Log the schema response
    console.log("[PreviewAlert] Schema response:", extractedFields);
    console.log("[PreviewAlert] group_by:", extractedFields.group_by);
    console.log("[PreviewAlert] projections:", extractedFields.projections);
    console.log("[PreviewAlert] timeseries_field:", extractedFields.timeseries_field);

    // Determine chart type based on schema
    const chartType = determineChartType(extractedFields);
    console.log("[PreviewAlert] Determined chart type:", chartType);
    dashboardPanelData.data.type = chartType;

    // Convert schema to fields
    const fields = convertSchemaToFields(extractedFields, chartType);
    console.log("[PreviewAlert] Converted fields:", fields);

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

    // DEBUG: Print complete panel object after result_schema
    console.log("[PreviewAlert] ========== COMPLETE PANEL OBJECT (from result_schema) ==========");
    console.log(JSON.stringify(dashboardPanelData.data, null, 2));
    console.log("[PreviewAlert] ========== END PANEL OBJECT ==========");
    console.log("[PreviewAlert] chartData.value has been set, PanelSchemaRenderer should now render");
    console.log("[PreviewAlert] chartData.value keys:", Object.keys(chartData.value));
    console.log("[PreviewAlert] Chart type:", dashboardPanelData.data.type);
    console.log("[PreviewAlert] customQuery:", dashboardPanelData.data.queries[0].customQuery);
    console.log("[PreviewAlert] x-axis fields:", JSON.stringify(dashboardPanelData.data.queries[0].fields.x));
    console.log("[PreviewAlert] y-axis fields:", JSON.stringify(dashboardPanelData.data.queries[0].fields.y));
    console.log("[PreviewAlert] breakdown fields:", JSON.stringify(dashboardPanelData.data.queries[0].fields.breakdown));

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
  console.log("[PreviewAlert] Chart data updated, resultMetaData:", resultMetaData);
  console.log("[PreviewAlert] Current selectedTab:", props.selectedTab);

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
    console.log("[PreviewAlert] resultMetaData type:", typeof resultMetaData);
    console.log("[PreviewAlert] resultMetaData is array?", Array.isArray(resultMetaData));
    console.log("[PreviewAlert] resultMetaData length:", resultMetaData?.length);

    // For PromQL, also log the raw metadata to see its structure
    if (props.selectedTab === "promql" && resultMetaData) {
      console.log("[PreviewAlert] PromQL raw resultMetaData:", JSON.stringify(resultMetaData, null, 2));
    }

    if (Array.isArray(resultMetaData) && resultMetaData.length > 0) {
      // Get metadata for first query (queryIndex = 0)
      const firstQueryMetadata = resultMetaData[0];

      console.log("[PreviewAlert] First query metadata array:", firstQueryMetadata);

      if (Array.isArray(firstQueryMetadata) && firstQueryMetadata.length > 0) {
        // Get the latest partition metadata (last element in array)
        const latestPartition = firstQueryMetadata[firstQueryMetadata.length - 1];

        console.log("[PreviewAlert] Latest partition metadata:", latestPartition);
        console.log("[PreviewAlert] Latest partition keys:", Object.keys(latestPartition || {}));
        console.log("[PreviewAlert] Has 'result' field?", 'result' in (latestPartition || {}));
        console.log("[PreviewAlert] Has 'hits' field?", 'hits' in (latestPartition || {}));
        console.log("[PreviewAlert] Has 'total' field?", 'total' in (latestPartition || {}));

        // Determine result count based on query mode
        // SQL mode and custom with aggregations: use 'total' field (count of aggregated groups)
        if (props.selectedTab === "sql" || (props.selectedTab === "custom" && props.isAggregationEnabled)) {
          if (latestPartition?.total !== undefined) {
            resultCount = latestPartition.total;
            console.log("[PreviewAlert] Got count from total field (SQL/Custom with agg):", resultCount);
          } else if (Array.isArray(latestPartition?.hits)) {
            resultCount = latestPartition.hits.length;
            console.log("[PreviewAlert] Got count from hits array (fallback):", resultCount);
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
            console.log("[PreviewAlert] Got count from PromQL result array (time series count):", resultCount);

            // Alternative: Could also count total data points across all series
            // const totalPoints = latestPartition.result.reduce((sum, series) =>
            //   sum + (series.values?.length || 0), 0);
          } else if (Array.isArray(latestPartition?.hits)) {
            resultCount = latestPartition.hits.length;
            console.log("[PreviewAlert] Got count from hits array (PromQL):", resultCount);
          } else if (latestPartition?.total !== undefined) {
            resultCount = latestPartition.total;
            console.log("[PreviewAlert] Got count from total field (PromQL fallback):", resultCount);
          }
        }
        // Custom mode without aggregations: use 'total' field (log count)
        else if (props.selectedTab === "custom" && !props.isAggregationEnabled) {
          if (latestPartition?.total !== undefined) {
            resultCount = latestPartition.total;
            console.log("[PreviewAlert] Got count from total field (Custom no agg):", resultCount);
          } else if (Array.isArray(latestPartition?.hits)) {
            resultCount = latestPartition.hits.length;
            console.log("[PreviewAlert] Got count from hits array (fallback):", resultCount);
          }
        }
        // Fallback for any other modes
        else {
          if (latestPartition?.total !== undefined) {
            resultCount = latestPartition.total;
            console.log("[PreviewAlert] Got count from total field (fallback):", resultCount);
          } else if (Array.isArray(latestPartition?.hits)) {
            resultCount = latestPartition.hits.length;
            console.log("[PreviewAlert] Got count from hits array (fallback):", resultCount);
          } else {
            console.warn("[PreviewAlert] Could not determine result count from metadata:", latestPartition);
          }
        }
      }

      console.log("[PreviewAlert] Final result count:", resultCount);
      evaluateAndSetStatus(resultCount);
    } else {
      console.log("[PreviewAlert] No result metadata available yet");

      // For PromQL, the data might come through the chart data directly
      // Let's check if we have chart data with results
      if (props.selectedTab === "promql" && chartData.value) {
        console.log("[PreviewAlert] Checking chartData for PromQL results...");
        console.log("[PreviewAlert] chartData.value:", chartData.value);

        // Try to get data from chart queries
        if (chartData.value.queries && chartData.value.queries[0]) {
          const queryData = chartData.value.queries[0];
          console.log("[PreviewAlert] Query data:", queryData);
          console.log("[PreviewAlert] Query data keys:", Object.keys(queryData));

          // Check if there's cached or loaded data
          if (queryData.data || queryData.result) {
            console.log("[PreviewAlert] Found data in query:", queryData.data || queryData.result);
          } else {
            console.log("[PreviewAlert] No data/result in query yet");
          }
        }
      }
    }
  } catch (error) {
    console.error("[PreviewAlert] Error processing chart data:", error);
  }
};

// Handle series data update event (for PromQL and other series-based data)
const handleSeriesDataUpdate = (seriesData: any) => {
  console.log("[PreviewAlert] Series data updated:", seriesData);

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

    console.log("[PreviewAlert] seriesData type:", typeof seriesData);
    console.log("[PreviewAlert] seriesData keys:", Object.keys(seriesData || {}));

    // Log options if it exists
    if (seriesData?.options) {
      console.log("[PreviewAlert] seriesData.options keys:", Object.keys(seriesData.options));

      // Log series if it exists
      if (seriesData.options.series) {
        console.log("[PreviewAlert] seriesData.options.series:", seriesData.options.series);
        console.log("[PreviewAlert] seriesData.options.series.length:", seriesData.options.series.length);

        // Log details of each series to understand what they are
        seriesData.options.series.forEach((series: any, index: number) => {
          console.log(`[PreviewAlert] Series ${index}:`, {
            name: series.name,
            type: series.type,
            hasData: !!series.data,
            dataLength: series.data?.length || 0,
            encode: series.encode,
            datasetIndex: series.datasetIndex
          });
        });
      }
    }

    // Log extras to see if it has raw PromQL data
    if (seriesData?.extras) {
      console.log("[PreviewAlert] seriesData.extras keys:", Object.keys(seriesData.extras));
      if (seriesData.extras.rawData || seriesData.extras.result) {
        console.log("[PreviewAlert] Found raw data in extras:", seriesData.extras.rawData || seriesData.extras.result);
      }
    }

    if (Array.isArray(seriesData)) {
      resultCount = seriesData.length;
      console.log("[PreviewAlert] PromQL series count from array:", resultCount);
    } else if (seriesData && typeof seriesData === 'object') {
      // Check if there's a nested array
      if (Array.isArray(seriesData.series)) {
        resultCount = seriesData.series.length;
        console.log("[PreviewAlert] Found series in seriesData.series:", resultCount);
      } else if (Array.isArray(seriesData.data)) {
        resultCount = seriesData.data.length;
        console.log("[PreviewAlert] Found series in seriesData.data:", resultCount);
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
        console.log("[PreviewAlert] Total series in options:", seriesData.options.series.length);
        console.log("[PreviewAlert] Filtered data series count:", resultCount);
        console.log("[PreviewAlert] Series types:", seriesData.options.series.map((s: any) => s.type || 'unknown'));
        console.log("[PreviewAlert] Filtered series names:", dataSeries.map((s: any) => s.name || 'unnamed'));
      } else if (seriesData.options?.dataset?.source) {
        // Dataset-based series
        const source = seriesData.options.dataset.source;
        if (Array.isArray(source) && source.length > 1) {
          resultCount = source.length - 1; // Subtract header row
          console.log("[PreviewAlert] Found series in dataset.source:", resultCount);
        }
      }

      if (resultCount === 0) {
        console.log("[PreviewAlert] No series found in any expected location");
      }
    }

    if (resultCount > 0) {
      console.log("[PreviewAlert] Evaluating PromQL alert with series count:", resultCount);
      evaluateAndSetStatus(resultCount);
    }
  } catch (error) {
    console.error("[PreviewAlert] Error processing series data:", error);
  }
};

// Separate function to evaluate and set status based on result count
const evaluateAndSetStatus = (resultCount: number) => {
  console.log("[PreviewAlert] Evaluating status with count:", resultCount);

  const threshold = props.formData.trigger_condition?.threshold || 0;
  const operator = props.formData.trigger_condition?.operator || ">=";

  console.log("[PreviewAlert] Result count:", resultCount);
  console.log("[PreviewAlert] Threshold:", threshold);
  console.log("[PreviewAlert] Operator:", operator);

  let wouldTrigger = false;
  let comparisonText = "";

  // Evaluate based on operator
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

  console.log("[PreviewAlert] Evaluation complete:", evaluationStatus.value);
  console.log("[PreviewAlert] evaluationStatus.value is now:", evaluationStatus.value);
  console.log("[PreviewAlert] Status bar should now be visible");
};

let refreshCallCounter = 0;
const refreshData = () => {
  const callId = ++refreshCallCounter;
  console.log(`[PreviewAlert] refreshData #${callId} START`);

  // Safety check: ensure trigger_condition exists
  if (!props.formData.trigger_condition) {
    console.warn("[PreviewAlert] No trigger_condition found, skipping refreshData");
    return;
  }

  const relativeTime = props.formData.trigger_condition.period;

  const endTime = new Date().getTime() * 1000;
  let new_relative_time = 2;
  if (relativeTime < 2) {
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
    console.log("[PreviewAlert] Configuring panel for PromQL mode");

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

    console.log("[PreviewAlert] PromQL panel configured:", {
      queryType: dashboardPanelData.data.queryType,
      chartType: dashboardPanelData.data.type,
      query: props.query
    });

    return;
  }

  // Handle custom mode without aggregations - show histogram of log counts over time
  if (props.selectedTab === "custom" && !props.isAggregationEnabled) {
    console.log("[PreviewAlert] Configuring panel for custom mode without aggregations (log count histogram)");

    // For custom without aggregations, create a histogram visualization
    xAxis = [
      {
        label: store.state.zoConfig.timestamp_column || "_timestamp",
        alias: "x_axis_1",
        column: store.state.zoConfig.timestamp_column || "_timestamp",
        color: null,
        aggregationFunction: "histogram"
      }
    ];

    yAxis = [
      {
        label: "count",
        alias: "y_axis_1",
        column: "*",
        color: null,
        aggregationFunction: "count"
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
    dashboardPanelData.data.queries[0].config.show_histogram = true;
    dashboardPanelData.data.queryType = "sql";
    dashboardPanelData.data.type = "bar"; // Histogram visualization

    // Update both refs together to prevent double watcher triggers
    const newChartData = cloneDeep(dashboardPanelData.data);
    const newTimeObj = { ...dashboardPanelData.meta.dateTime };

    chartData.value = newChartData;
    selectedTimeObj.value = newTimeObj;

    console.log("[PreviewAlert] Custom (no agg) panel configured:", {
      chartType: dashboardPanelData.data.type,
      xAxis: JSON.stringify(xAxis),
      yAxis: JSON.stringify(yAxis)
    });

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

  // Update both refs together to prevent double watcher triggers
  const newChartData = cloneDeep(dashboardPanelData.data);
  const newTimeObj = { ...dashboardPanelData.meta.dateTime };

  chartData.value = newChartData;
  selectedTimeObj.value = newTimeObj;

  console.log(`[PreviewAlert] refreshData #${callId} END - chartData updated`);

  // Note: Alert status evaluation now happens via handleChartDataUpdate event from PanelSchemaRenderer
};

// Track if this is the initial load to prevent duplicate API calls
let isInitialLoad = true;
let lastRefreshTime = 0;

const refreshDataOnce = () => {
  const now = Date.now();
  const timeSinceLastCall = now - lastRefreshTime;

  console.log(`[PreviewAlert] refreshDataOnce called, time since last: ${timeSinceLastCall}ms`);

  // Prevent multiple calls within 200ms (skip check on first call)
  // 200ms window catches both usePanelDataLoader watchers firing from dateTime + panelSchema updates
  if (lastRefreshTime > 0 && timeSinceLastCall < 200) {
    console.log(`[PreviewAlert] ⚠️ Skipping duplicate call (${timeSinceLastCall}ms < 200ms)`);
    return;
  }

  lastRefreshTime = now;
  console.log("[PreviewAlert] ✓ Calling refreshData");
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
    props.isAggregationEnabled,
    props.selectedTab,
    props.formData.query_condition?.aggregation,
    props.isUsingBackendSql,
  ],
  () => {
    console.log("[PreviewAlert] Watch triggered, isInitialLoad:", isInitialLoad);

    // Skip the first watch trigger on mount since onMounted will handle it
    if (isInitialLoad) {
      isInitialLoad = false;
      console.log("[PreviewAlert] Skipping first watch trigger");
      return;
    }

    // Refresh if we have a valid query
    if (props.query) {
      console.log("[PreviewAlert] Watch calling refreshDataOnce");
      refreshDataOnce();
    }
  },
  { deep: true }
);

// Refresh data on mount if we already have a query
onMounted(() => {
  console.log("[PreviewAlert] onMounted called, query:", props.query);
  if (props.query) {
    console.log("[PreviewAlert] onMounted calling refreshDataOnce");
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
