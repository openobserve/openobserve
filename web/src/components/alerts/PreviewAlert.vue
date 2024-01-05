<template>
  <div ref="chartPanelRef" style="height: 100%; position: relative">
    <div style="height: 200px">
      <PanelSchemaRenderer
        v-if="chartData"
        :height="6"
        :width="6"
        :panelSchema="chartData"
        :selectedTimeObj="dashboardPanelData.meta.dateTime"
        :variablesData="{}"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import PanelSchemaRenderer from "../dashboards/PanelSchemaRenderer.vue";
import { reactive } from "vue";
import { onBeforeMount } from "vue";
import { cloneDeep } from "lodash-es";

const getDefaultDashboardPanelData: any = () => ({
  data: {
    version: 2,
    id: "",
    type: "bar",
    title: "",
    description: "",
    config: {
      show_legends: true,
      legends_position: null,
      unit: null,
      unit_custom: null,
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
          filter: [],
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
});

onBeforeMount(() => {
  dashboardPanelData = reactive({ ...getDefaultDashboardPanelData() });
  dashboardPanelData.data.type = "line";
  dashboardPanelData.data.queryType = "sql";
  dashboardPanelData.data.queries[0].query = props.query;
  dashboardPanelData.data.queries[0].fields.stream = "segment";
  dashboardPanelData.data.queries[0].fields.stream_type = "logs";
  dashboardPanelData.data.queries[0].customQuery = true;
});

const chartPanelRef = ref(null);
const chartData = ref({});

const refreshData = () => {
  const relativeTime = props.formData.trigger_condition.period;

  const endTime = new Date().getTime() * 1000;
  const startTime = endTime - relativeTime * 60 * 1000000;

  dashboardPanelData.meta.dateTime = {
    start_time: new Date(startTime),
    end_time: new Date(endTime),
  };

  const axis = {
    aggregationFunction: "histogram",
    alias: "zo_sql_key",
    color: null,
    column: "_timestamp",
    label: " ",
  };

  const xAxis = [
    {
      aggregationFunction: "histogram",
      alias: "zo_sql_key",
      color: null,
      column: "_timestamp",
      label: " ",
    },
  ];

  const yAxis = [];

  if (props.isAggregationEnabled) {
    yAxis.push({
      aggregationFunction:
        props.formData.value.query_condition.aggregation.function,
      alias: "zo_sql_val",
      color: null,
      column: "_timestamp",
      label: " ",
    });
  } else {
    yAxis.push({
      aggregationFunction: "count",
      alias: "zo_sql_val",
      color: null,
      column: "_timestamp",
      label: " ",
    });
  }

  dashboardPanelData.data.queries[0].fields.x = xAxis;
  dashboardPanelData.data.queries[0].fields.y = yAxis;

  dashboardPanelData.data.queries[0].query = props.query;

  chartData.value = cloneDeep(dashboardPanelData.data);
};

defineExpose({ refreshData });
</script>

<style scoped></style>
