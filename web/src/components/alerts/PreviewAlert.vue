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
        v-if="chartData"
        :height="5"
        :width="5"
        :panelSchema="chartData"
        :selectedTimeObj="dashboardPanelData.meta.dateTime"
        :variablesData="{}"
        searchType="UI"
        :is_ui_histogram="isUsingBackendSql"
        style="height: 180px; width: 100%; overflow-x: hidden;"
        @result-metadata-update="handleChartDataUpdate"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
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
const chartData = ref({});
const evaluationStatus = ref<{
  wouldTrigger: boolean;
  reason: string;
} | null>(null);
const { t } = useI18n();

const store = useStore();

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
  }
};

// Handle chart data updates from PanelSchemaRenderer
// This receives the resultMetaData which contains the hits array from the chart's query
const handleChartDataUpdate = (resultMetaData: any) => {
  console.log("[PreviewAlert] Chart data updated, resultMetaData:", resultMetaData);

  // Safety check: ensure trigger_condition exists
  if (!props.formData.trigger_condition) {
    console.warn("[PreviewAlert] No trigger_condition found, skipping evaluation");
    return;
  }

  // resultMetaData is an array where each element corresponds to a query
  // For alerts, we typically have one query, so we look at index 0
  // The structure is: resultMetaData[queryIndex][0].hits or resultMetaData[queryIndex].hits
  let resultCount = 0;

  try {
    if (Array.isArray(resultMetaData) && resultMetaData.length > 0) {
      const firstQueryMeta = resultMetaData[0];

      console.log("[PreviewAlert] First query metadata:", firstQueryMeta);

      // Check different possible structures for the hits data
      if (Array.isArray(firstQueryMeta)) {
        // Structure: resultMetaData[0] is an array where each element is a hit/group
        // For GROUP BY queries, the array length IS the count of groups
        resultCount = firstQueryMeta.length;
        console.log("[PreviewAlert] Got count from resultMetaData array length:", resultCount);
      } else if (firstQueryMeta?.hits) {
        // Structure: resultMetaData[0].hits (direct object with hits array)
        resultCount = Array.isArray(firstQueryMeta.hits)
          ? firstQueryMeta.hits.length
          : 0;
        console.log("[PreviewAlert] Got count from direct hits array:", resultCount);
      } else if (firstQueryMeta?.total !== undefined) {
        // Fallback to total field if available
        resultCount = firstQueryMeta.total;
        console.log("[PreviewAlert] Got count from total field:", resultCount);
      }

      console.log("[PreviewAlert] Final result count:", resultCount);
      evaluateAndSetStatus(resultCount);
    } else {
      console.log("[PreviewAlert] No result metadata available yet");
    }
  } catch (error) {
    console.error("[PreviewAlert] Error processing chart data:", error);
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

const refreshData = () => {
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

  // Handle promql mode
  if (props.selectedTab === "promql") {
    xAxis = [];
    yAxis = [];
  }

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

  chartData.value = cloneDeep(dashboardPanelData.data);

  // DEBUG: Print complete panel object for custom alerts
  console.log("[PreviewAlert] ========== COMPLETE PANEL OBJECT ==========");
  console.log(JSON.stringify(dashboardPanelData.data, null, 2));
  console.log("[PreviewAlert] ========== END PANEL OBJECT ==========");

  // Note: Alert status evaluation now happens via handleChartDataUpdate event from PanelSchemaRenderer
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
    // Refresh if we have a valid query
    if (props.query) {
      refreshData();
    }
  },
  { deep: true }
);

// Refresh data on mount if we already have a query
onMounted(() => {
  if (props.query) {
    refreshData();
  }
});

defineExpose({ refreshData, evaluationStatus });
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
