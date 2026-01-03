// Copyright 2023 OpenObserve Inc.
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
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { reactive, computed, watch, onBeforeMount, onUnmounted } from "vue";
import { useStore } from "vuex";
import useNotifications from "./useNotifications";
import { b64EncodeUnicode, isStreamingEnabled } from "@/utils/zincutils";
import { extractFields, getStreamNameFromQuery } from "@/utils/query/sqlUtils";
import { validatePanel } from "@/utils/dashboard/convertDataIntoUnitValue";
import useStreams from "./useStreams";
import useValuesWebSocket from "./dashboard/useValuesWebSocket";
import queryService from "@/services/search";
import metricsService from "@/services/metrics";
import logsUtils from "./useLogs/logsUtils";
import {
  buildSQLChartQuery,
  geoMapChart,
  mapChart,
  sankeyChartQuery,
} from "@/utils/dashboard/dashboardAutoQueryBuilder";

const colors = [
  "#5960b2",
  "#c23531",
  "#2f4554",
  "#61a0a8",
  "#d48265",
  "#91c7ae",
  "#749f83",
  "#ca8622",
  "#bda29a",
  "#6e7074",
  "#546570",
  "#c4ccd3",
];
let parser: any;

const getDefaultDashboardPanelData: any = (store: any) => ({
  data: {
    version: 5,
    id: "",
    type: "bar",
    title: "",
    description: "",
    config: {
      trellis: {
        layout: null,
        num_of_columns: 1,
        group_by_y_axis: false,
      },
      show_gridlines: true,
      show_legends: true,
      legends_position: null,
      legends_type: null,
      chart_align: null,
      unit: null,
      unit_custom: null,
      decimals: 2,
      line_thickness: 1.5,
      step_value: "0",
      y_axis_min: null,
      y_axis_max: null,
      top_results: null,
      top_results_others: false,
      axis_width: null,
      axis_border_show: false,
      label_option: {
        position: null,
        rotate: 0,
      },
      axis_label_rotate: 0,
      axis_label_truncate_width: null,
      show_symbol:
        store?.state?.zoConfig?.dashboard_show_symbol_enabled ?? false,
      line_interpolation: "smooth",
      legend_width: {
        value: null,
        unit: "px",
      },
      legend_height: {
        value: null,
        unit: "px",
      },
      base_map: {
        type: "osm",
      },
      map_type: {
        type: "world",
      },
      map_view: {
        zoom: 1,
        lat: 0,
        lng: 0,
      },
      map_symbol_style: {
        size: "by Value",
        size_by_value: {
          min: 1,
          max: 100,
        },
        size_fixed: 2,
      },
      drilldown: [],
      mark_line: [],
      override_config: [],
      connect_nulls: false,
      no_value_replacement: "",
      wrap_table_cells: false,
      table_transpose: false,
      table_dynamic_columns: false,
      mappings: [],
      color: {
        mode: "palette-classic-by-series",
        fixedColor: ["#53ca53"],
        seriesBy: "last",
        colorBySeries: [],
      },
      background: null,
      // PromQL aggregation config
      aggregation: "last",
      // GeoMap config
      lat_label: "latitude",
      lon_label: "longitude",
      weight_label: "weight",
      name_label: "name",
      // PromQL Table config
      table_aggregations: ["last"],
      promql_table_mode: "single",
      visible_columns: [],
      hidden_columns: [],
      sticky_columns: [],
    },
    htmlContent: "",
    markdownContent: "",
    customChartContent: `\ // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// 'data' variable is available for use and contains the response data from the search result and it is an array.\noption = {  \n \n};
  `,
    customChartResult: {},
    queryType: "sql",
    queries: [
      {
        query: "",
        vrlFunctionQuery: "",
        customQuery: false,
        joins: [],
        fields: {
          stream: "",
          stream_type: "logs",
          x: [],
          y: [],
          z: [],
          breakdown: [],
          promql_labels: [],
          promql_operations: [],
          filter: {
            filterType: "group",
            logicalOperator: "AND",
            conditions: [],
          },
          latitude: null,
          longitude: null,
          weight: null,
          name: null,
          value_for_maps: null,
          source: null,
          target: null,
          value: null,
        },
        config: {
          promql_legend: "",
          step_value: null,
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
    querySplitter: 41,
    showQueryBar: true,
    isConfigPanelOpen: false,
    currentQueryIndex: 0,
    vrlFunctionToggle: false,
    showFieldList: true,
    hiddenQueries: [],
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
      hasUserDefinedSchemas: false,
      interestingFieldList: [],
      userDefinedSchema: [],
      vrlFunctionFieldList: [],
      selectedStreamFields: [],
      useUserDefinedSchemas: "user_defined_schema",
      customQueryFields: [],
      functions: [],
      streamResults: <any>[],
      streamResultsType: "",
      filterField: "",
    },
    streamFields: {
      groupedFields: [],
    },
    promql: {
      availableLabels: <string[]>[],
      labelValuesMap: new Map<string, string[]>(),
      loadingLabels: false,
    },
  },
});

const dashboardPanelDataObj: any = {};

const getDefaultCustomChartText = () => {
  return `\ // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// 'data' variable is available for use and contains the response data from the search result and it is an array.\noption = {  \n \n};
  `;
};

const useDashboardPanelData = (pageKey: string = "dashboard") => {
  const store = useStore();
  const { showErrorNotification } = useNotifications();
  const { getStreams, getStream } = useStreams();
  const valuesWebSocket = useValuesWebSocket();

  // Initialize the state for this page key if it doesn't already exist
  if (!dashboardPanelDataObj[pageKey]) {
    dashboardPanelDataObj[pageKey] = reactive({
      ...getDefaultDashboardPanelData(store),
    });
  }

  const dashboardPanelData = reactive(dashboardPanelDataObj[pageKey]);
  const cleanupDraggingFields = () => {
    dashboardPanelData.meta.dragAndDrop.currentDragArea = null;
    dashboardPanelData.meta.dragAndDrop.targetDragIndex = -1;
    dashboardPanelData.meta.dragAndDrop.dragging = false;
    dashboardPanelData.meta.dragAndDrop.dragElement = null;
    dashboardPanelData.meta.dragAndDrop.dragSource = null;
    dashboardPanelData.meta.dragAndDrop.dragSourceIndex = null;
  };

  // get default queries
  const getDefaultQueries = () => {
    return getDefaultDashboardPanelData(store).data.queries;
  };

  const addQuery = () => {
    const newQuery: any = {
      query: "",
      vrlFunctionQuery: "",
      customQuery:
        dashboardPanelData?.data?.queries?.[
          dashboardPanelData?.layout?.currentQueryIndex
        ]?.customQuery ?? false,
      fields: {
        stream:
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream,
        stream_type:
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type,
        x: [],
        y: [],
        z: [],
        breakdown: [],
        promql_labels: [],
        promql_operations: [],
        filter: {
          filterType: "group",
          logicalOperator: "AND",
          conditions: [],
        },
        latitude: null,
        longitude: null,
        weight: null,
        name: null,
        value_for_maps: null,
        source: null,
        target: null,
        value: null,
      },
      config: {
        promql_legend: "",
        layer_type: "scatter",
        weight_fixed: 1,
      },
    };
    dashboardPanelData.data.queries.push(newQuery);
  };

  const removeQuery = (index: number) => {
    dashboardPanelData.data.queries.splice(index, 1);
  };

  const resetDashboardPanelData = () => {
    Object.assign(dashboardPanelData, getDefaultDashboardPanelData(store));
  };

  const resetDashboardPanelDataAndAddTimeField = () => {
    resetDashboardPanelData();

    // add _timestamp field in x axis as default
    addXAxisItem({
      name: store.state.zoConfig.timestamp_column ?? "_timestamp",
    });
  };

  const generateLabelFromName = (name: string) => {
    return name
      .replace(/[\_\-\s\.]/g, " ")
      .split(" ")
      .map((string) => string.charAt(0).toUpperCase() + string.slice(1))
      .filter((it) => it)
      .join(" ");
  };

  const promqlMode = computed(
    () => dashboardPanelData.data.queryType == "promql",
  );

  // Watch queryType and toggle off VRL functions when switching to PromQL
  watch(
    () => dashboardPanelData.data.queryType,
    (newQueryType) => {
      if (newQueryType === "promql") {
        dashboardPanelData.layout.vrlFunctionToggle = false;
      }
    },
  );

  const selectedStreamFieldsBasedOnUserDefinedSchema = computed(() => {
    if (
      store.state.zoConfig.user_defined_schemas_enabled &&
      dashboardPanelData.meta.stream.userDefinedSchema.length > 0 &&
      dashboardPanelData.meta.stream.useUserDefinedSchemas ==
        "user_defined_schema"
    ) {
      return dashboardPanelData.meta.stream.userDefinedSchema ?? [];
    }

    return dashboardPanelData.meta.stream.selectedStreamFields ?? [];
  });

  async function loadStreamFields(streamName: string) {
    try {
      if (!streamName) return { name: streamName, schema: [], settings: {} };

      // Create a new request and store it in the cache
      return await getStream(
        streamName,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type ?? "logs",
        true,
      );
    } catch (e: any) {
      return { name: streamName, schema: [], settings: {} };
    }
  }

  // Track if updateGroupedFields is currently running to prevent race conditions
  let isUpdatingGroupedFields = false;
  let pendingUpdateGroupedFields = false;

  // Helper function to update grouped fields
  const updateGroupedFields = async () => {
    // If already updating, mark that we need to run again after completion
    if (isUpdatingGroupedFields) {
      pendingUpdateGroupedFields = true;
      return;
    }

    isUpdatingGroupedFields = true;
    pendingUpdateGroupedFields = false;

    try {
      // For PromQL queries, collect streams from ALL queries
      if (dashboardPanelData.data.queryType === "promql") {
        const allStreams = new Set<string>();

        // Iterate through all queries to collect unique streams
        dashboardPanelData.data.queries?.forEach((query: any) => {
          if (query?.fields?.stream) {
            allStreams.add(query.fields.stream);
          }
        });

        if (allStreams.size === 0) return;

        // Fetch stream fields for all unique streams
        const groupedFields = await Promise.all(
          Array.from(allStreams).map(async (streamName) => {
            const streamData = await loadStreamFields(streamName);
            return streamData;
          }),
        );

        // Filter out any invalid entries (streams with no name)
        dashboardPanelData.meta.streamFields.groupedFields =
          groupedFields.filter((field: any) => field?.name);
      } else {
        const currentStream =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream;
        if (!currentStream) return;

        // Collect streams (main + joins)
        const joinsStreams = [
          { stream: currentStream, streamAlias: undefined },
          ...(dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].joins?.filter((stream: any) => stream?.stream) ?? []),
        ];

        // Fetch stream fields
        const groupedFields = await Promise.all(
          joinsStreams.map(async (stream: any) => {
            const streamData = await loadStreamFields(stream?.stream);
            return {
              ...streamData,
              stream_alias: stream?.streamAlias,
            };
          }),
        );

        // Filter out any invalid entries (streams with no name)
        dashboardPanelData.meta.streamFields.groupedFields =
          groupedFields.filter((field: any) => field?.name);
      }
    } finally {
      isUpdatingGroupedFields = false;
      // If there was a pending update request, run it now
      if (pendingUpdateGroupedFields) {
        updateGroupedFields();
      }
    }
  };

  const getAllSelectedStreams = () => {
    // get all streams
    // mainStream + all join streams

    return [
      {
        stream:
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream,
      },
      ...((
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.joins ?? []
      )?.map((join: any) => ({
        stream: join.stream,
        streamAlias: join.streamAlias,
      })) ?? []),
    ];
  };

  const getStreamNameFromStreamAlias = (streamAlias: string) => {
    if (!streamAlias)
      return dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.stream;
    const allStreams = getAllSelectedStreams();
    return allStreams.find((field: any) => field.streamAlias == streamAlias)
      ?.stream;
  };

  const isAddXAxisNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case "pie":
      case "donut":
      case "heatmap":
      case "gauge":
      case "area":
      case "bar":
      case "h-bar":
      case "line":
      case "scatter":
      case "area-stacked":
      case "stacked":
      case "h-stacked":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.x.length >= 1
        );
      case "metric":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.x.length >= 0
        );
      case "table":
        return false;
      default:
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.x.length >= 2
        );
    }
  });

  const isAddBreakdownNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case "area":
      case "bar":
      case "h-bar":
      case "line":
      case "scatter":
      case "area-stacked":
      case "stacked":
      case "h-stacked":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.breakdown?.length >= 1
        );
    }
  });

  const isAddYAxisNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case "pie":
      case "donut":
      case "gauge":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.y.length >= 1
        );
      case "metric":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.y.length >= 1
        );
      case "area-stacked":
      case "heatmap":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.y.length >= 1
        );
      default:
        return false;
    }
  });

  const isAddZAxisNotAllowed = computed((e: any) => {
    switch (dashboardPanelData.data.type) {
      case "heatmap":
        return (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.z.length >= 1
        );
      default:
        return false;
    }
  });

  const checkIsDerivedField = (fieldName: string) => {
    // if given fieldName is from vrlFunctionFields, then it is a derived field
    return !!dashboardPanelData.meta.stream.vrlFunctionFieldList.find(
      (vrlField: any) => vrlField.name == fieldName,
    );
  };

  const addXAxisItem = (row: { name: string; streamAlias?: string }) => {
    if (
      !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.x
    ) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.x = [];
    }

    if (isAddXAxisNotAllowed.value) {
      return;
    }

    const isDerived = checkIsDerivedField(row.name) ?? false;

    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.x.push({
      label: !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery
        ? generateLabelFromName(row.name)
        : row.name,
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "x_axis_" +
            (dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.x.length +
              1)
          : row.name,
      color: null,
      type: "build",
      functionName:
        row.name == store.state.zoConfig.timestamp_column && !isDerived
          ? "histogram"
          : null,
      args:
        row.name == store.state.zoConfig.timestamp_column && !isDerived
          ? [
              {
                type: "field",
                value: {
                  field: row.name,
                  streamAlias: row.streamAlias,
                },
              },
              {
                type: "histogramInterval",
                value: null,
              },
            ]
          : [
              {
                type: "field",
                value: {
                  field: row.name,
                  streamAlias: row.streamAlias,
                },
              },
            ],
      sortBy:
        row.name == store.state.zoConfig.timestamp_column
          ? dashboardPanelData.data.type == "table"
            ? "DESC"
            : "ASC"
          : null,
      isDerived,
      havingConditions: [],
      treatAsNonTimestamp:
        row.name === store.state.zoConfig.timestamp_column ? false : true,
      showFieldAsJson: false,
    });

    updateArrayAlias();
  };

  const addBreakDownAxisItem = (row: {
    name: string;
    streamAlias?: string;
  }) => {
    if (
      !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.breakdown
    ) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.breakdown = [];
    }

    if (isAddBreakdownNotAllowed.value) {
      return;
    }

    const isDerived = checkIsDerivedField(row.name) ?? false;

    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.breakdown.push({
      label: !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery
        ? generateLabelFromName(row.name)
        : row.name,
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "breakdown_" +
            (dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.breakdown.length +
              1)
          : row.name,
      color: null,
      type: "build",
      functionName:
        row.name == store.state.zoConfig.timestamp_column && !isDerived
          ? "histogram"
          : null,
      args:
        row.name == store.state.zoConfig.timestamp_column && !isDerived
          ? [
              {
                type: "field",
                value: {
                  field: row.name,
                  streamAlias: row.streamAlias,
                },
              },
              {
                type: "histogramInterval",
                value: null,
              },
            ]
          : [
              {
                type: "field",
                value: {
                  field: row.name,
                  streamAlias: row.streamAlias,
                },
              },
            ],
      sortBy:
        row.name == store.state.zoConfig.timestamp_column
          ? dashboardPanelData.data.type == "table"
            ? "DESC"
            : "ASC"
          : null,
      isDerived,
      havingConditions: [],
    });

    updateArrayAlias();
  };

  const addYAxisItem = (row: { name: string; streamAlias?: string }) => {
    if (
      !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.y
    ) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.y = [];
    }

    if (isAddYAxisNotAllowed.value) {
      return;
    }

    const isDerived = checkIsDerivedField(row.name) ?? false;

    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.y.push({
      label: !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery
        ? generateLabelFromName(row.name)
        : row.name,
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "y_axis_" +
            (dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.y.length +
              1)
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName:
        dashboardPanelData.data.type == "heatmap" || isDerived ? null : "count",
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
      treatAsNonTimestamp:
        row.name === store.state.zoConfig.timestamp_column ? false : true,
      showFieldAsJson: false,
    });
    updateArrayAlias();
  };

  const addZAxisItem = (row: { name: string; streamAlias?: string }) => {
    if (
      !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z
    ) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z = [];
    }

    if (isAddZAxisNotAllowed.value) {
      return;
    }

    const isDerived = checkIsDerivedField(row.name) ?? false;

    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.z.push({
      label: !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery
        ? generateLabelFromName(row.name)
        : row.name,
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "z_axis_" +
            ((dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields?.z?.length ?? 0) +
              1)
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: isDerived ? null : "count",
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    });
    updateArrayAlias();
  };

  const addLatitude = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.latitude = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "latitude"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: null, // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    };
  };

  const addLongitude = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.longitude = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "longitude"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: null, // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    };
  };

  const addWeight = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.weight = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "weight"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: isDerived ? null : "count", // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    };
  };

  const addMapName = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.name = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "name"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: null, // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      havingConditions: [],
    };
  };

  const addMapValue = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.value_for_maps = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "value_for_maps"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: "count", // You can set the appropriate aggregation function here
      havingConditions: [],
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
    };
  };

  const addSource = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.source = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "source"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: null, // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    };
  };

  const addTarget = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.target = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "target"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: null, // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    };
  };

  const addValue = (row: any) => {
    const isDerived = checkIsDerivedField(row.name) ?? false;
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.value = {
      label: generateLabelFromName(row.name),
      alias:
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery && !isDerived
          ? "value"
          : row.name,
      // column: row.name,
      color: getNewColorValue(),
      type: "build",
      functionName: isDerived ? null : "sum", // You can set the appropriate aggregation function here
      args: [
        {
          type: "field",
          value: {
            field: row.name,
            streamAlias: row.streamAlias,
          },
        },
      ],
      isDerived,
      havingConditions: [],
    };
  };

  // get new color value based on existing color from the chart
  const getNewColorValue = () => {
    const YAxisColor = dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.y.map((it: any) => it?.color);
    let newColor = colors.filter((el: any) => !YAxisColor.includes(el));
    if (!newColor.length) {
      newColor = colors;
    }
    return newColor[0];
  };

  const resetAggregationFunction = () => {
    // Skip resetting fields for PromQL mode to preserve the query
    if (dashboardPanelData.data.queryType === "promql") {
      return;
    }

    switch (dashboardPanelData.data.type) {
      case "heatmap":
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y.forEach((itemY: any) => {
          itemY.functionName = null;
          // take first arg
          itemY.args = itemY?.args?.length ? [itemY?.args?.[0]] : [];
        });
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;

          // make sure that x axis should not have more than one field
          if (query.fields.x.length > 1) {
            query.fields.x = [query.fields.x[0]];
          }

          // make sure that y axis should not have more than one field
          if (query.fields.y.length > 1) {
            query.fields.y = [query.fields.y[0]];
          }
        });
        if (dashboardPanelData.data.queryType === "sql") {
          dashboardPanelData.layout.currentQueryIndex = 0;
          dashboardPanelData.data.queries =
            dashboardPanelData.data.queries.slice(0, 1);
        }
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;

      case "area":
      case "area-stacked":
      case "bar":
      case "line":
      case "scatter":
      case "h-bar":
      case "stacked":
      case "h-stacked":
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y.forEach((itemY: any) => {
          if (itemY.functionName === null && !itemY.isDerived) {
            itemY.functionName = "count";
            // take first arg
            itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
          }
        });
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z = [];
        // we have multiple queries for geomap, so if we are moving away, we need to reset
        // the values of lat, lng and weight in all the queries
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;

          // make sure that x axis should not have more than one field
          if (query.fields.x.length > 1) {
            // if breakdown is empty, then take 2nd x axis field on breakdown and remove all other x axis
            if (query.fields.breakdown.length === 0) {
              query.fields.breakdown = [query.fields.x[1]];
              query.fields.x = [query.fields.x[0]];
            } else {
              query.fields.x = [query.fields.x[0]];
            }
          }
        });
        if (dashboardPanelData.data.queryType === "sql") {
          dashboardPanelData.layout.currentQueryIndex = 0;
          dashboardPanelData.data.queries =
            dashboardPanelData.data.queries.slice(0, 1);
        }
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();
        break;
      case "table":
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y.forEach((itemY: any) => {
          if (itemY.functionName === null && !itemY.isDerived) {
            itemY.functionName = "count";
            // take first arg
            itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
          }
        });
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        // we have multiple queries for geomap, so if we are moving away, we need to reset
        // the values of lat, lng and weight in all the queries
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
        });
        if (dashboardPanelData.data.queryType === "sql") {
          dashboardPanelData.layout.currentQueryIndex = 0;
          dashboardPanelData.data.queries =
            dashboardPanelData.data.queries.slice(0, 1);
        }
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();

        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "pie":
      case "donut":
      case "gauge":
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y.forEach((itemY: any) => {
          if (itemY.functionName === null && !itemY.isDerived) {
            itemY.functionName = "count";
            // take first arg
            itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
          }
        });
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        // we have multiple queries for geomap, so if we are moving away, we need to reset
        // the values of lat, lng and weight in all the queries
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;

          // make sure that x axis should not have more than one field
          if (query.fields.x.length > 1) {
            query.fields.x = [query.fields.x[0]];
          }

          // make sure that y axis should not have more than one field
          if (query.fields.y.length > 1) {
            query.fields.y = [query.fields.y[0]];
          }
        });
        if (dashboardPanelData.data.queryType === "sql") {
          dashboardPanelData.layout.currentQueryIndex = 0;
          dashboardPanelData.data.queries =
            dashboardPanelData.data.queries.slice(0, 1);
        }
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();

        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "metric":
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y.forEach((itemY: any) => {
          if (itemY.functionName === null && !itemY.isDerived) {
            itemY.functionName = "count";
            // take first arg
            itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
          }
        });
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        // we have multiple queries for geomap, so if we are moving away, we need to reset
        // the values of lat, lng and weight in all the queries
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;

          // remove all x axis fields
          query.fields.x = [];
          // make sure that y axis should not have more than one field
          if (query.fields.y.length > 1) {
            query.fields.y = [query.fields.y[0]];
          }
        });
        if (dashboardPanelData.data.queryType === "sql") {
          dashboardPanelData.layout.currentQueryIndex = 0;
          dashboardPanelData.data.queries =
            dashboardPanelData.data.queries.slice(0, 1);
        }
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();

        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "geomap":
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.x = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z = [];
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.name = null;
          query.fields.value_for_maps = null;
        });
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();

        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
        });
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.limit = 0;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "html":
        // Preserve current stream and stream_type before resetting
        const htmlCurrentStream =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream;
        const htmlCurrentStreamType =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type;

        dashboardPanelData.data.queries = getDefaultQueries();

        // Restore the preserved stream and stream_type
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream = htmlCurrentStream;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type = htmlCurrentStreamType;

        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();
        dashboardPanelData.data.queryType = "";
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "markdown":
        // Preserve current stream and stream_type before resetting
        const markdownCurrentStream =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream;
        const markdownCurrentStreamType =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type;

        dashboardPanelData.data.queries = getDefaultQueries();

        // Restore the preserved stream and stream_type
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream = markdownCurrentStream;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type = markdownCurrentStreamType;

        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();

        dashboardPanelData.data.queryType = "";
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "custom_chart":
        // Preserve current stream and stream_type before resetting
        const customChartCurrentStream =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream;
        const customChartCurrentStreamType =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type;

        dashboardPanelData.data.queries = getDefaultQueries();

        // Restore the preserved stream and stream_type
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream = customChartCurrentStream;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type = customChartCurrentStreamType;

        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.queryType = "";
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "maps":
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.x = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
        });
        break;
      case "sankey":
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.x = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.filter = {
          filterType: "group",
          logicalOperator: "AND",
          conditions: [],
        };
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
        });
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.limit = 0;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
      default:
        break;
    }

    // aggregation null then count
  };

  // update X or Y axis aliases when new value pushes into the X and Y axes arrays
  const updateArrayAlias = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields?.x?.forEach(
      (it: any, index: any) =>
        (it.alias =
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery && !it.isDerived
            ? "x_axis_" + (index + 1)
            : it?.alias),
    );
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields?.y?.forEach(
      (it: any, index: any) =>
        (it.alias =
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery && !it.isDerived
            ? "y_axis_" + (index + 1)
            : it?.alias),
    );
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields?.z?.forEach(
      (it: any, index: any) =>
        (it.alias =
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery && !it.isDerived
            ? "z_axis_" + (index + 1)
            : it?.alias),
    );
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields?.breakdown?.forEach(
      (it: any, index: any) =>
        (it.alias =
          !dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery && !it.isDerived
            ? "breakdown_" + (index + 1)
            : it?.alias),
    );
  };

  const removeXAxisItemByIndex = (index: number) => {
    if (index >= 0) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.x.splice(index, 1);
    }
  };

  const removeBreakdownItemByIndex = (index: number) => {
    if (index >= 0) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.breakdown.splice(index, 1);
    }
  };

  const removeYAxisItemByIndex = (index: number) => {
    if (index >= 0) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.y.splice(index, 1);
    }
  };

  const removeZAxisItemByIndex = (index: number) => {
    if (index >= 0) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z.splice(index, 1);
    }
  };

  const removeFilterItem = (name: string) => {
    const index = dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.filter.conditions.findIndex((it: any) => it.column == name);
    if (index >= 0) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.filter.conditions.splice(index, 1);
    }
  };

  const removeLatitude = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.latitude = null;
  };

  const removeLongitude = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.longitude = null;
  };

  const removeWeight = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.weight = null;
  };

  const removeMapName = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.name = null;
  };

  const removeMapValue = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.value_for_maps = null;
  };

  const removeSource = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.source = null;
  };

  const removeTarget = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.target = null;
  };

  const removeValue = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields.value = null;
  };

  const addFilteredItem = async (row: {
    name: string;
    streamAlias?: string;
    stream: string;
  }) => {
    const currentQuery =
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ];

    // Ensure the filter array is initialized
    if (!currentQuery.fields.filter) {
      currentQuery.fields.filter = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      };
    }

    // Add the new filter item
    currentQuery.fields.filter.conditions.push({
      type: "list",
      values: [],
      column: { field: row.name, streamAlias: row.streamAlias },
      operator: null,
      value: null,
      logicalOperator: "AND",
      filterType: "condition",
    });

    // Ensure the filterValue array is initialized
    if (!dashboardPanelData.meta.filterValue) {
      dashboardPanelData.meta.filterValue = [];
    }

    try {
      const queryReq = {
        org_identifier: store.state.selectedOrganization.identifier,
        stream_name: row.stream,
        start_time: new Date(
          dashboardPanelData.meta.dateTime["start_time"].toISOString(),
        ).getTime(),
        end_time: new Date(
          dashboardPanelData.meta.dateTime["end_time"].toISOString(),
        ).getTime(),
        fields: [row.name],
        size: 100,
        type: currentQuery.fields.stream_type,
        no_count: true,
      };

      const res = await valuesWebSocket.fetchFieldValues(
        queryReq,
        dashboardPanelData,
        row,
      );
    } catch (error: any) {
      const errorDetailValue =
        error.response?.data.error_detail ||
        error.response?.data.message ||
        "Something went wrong!";
      const trimmedErrorMessage =
        errorDetailValue.length > 300
          ? errorDetailValue.slice(0, 300) + " ..."
          : errorDetailValue;

      showErrorNotification(trimmedErrorMessage);
    }
  };

  const loadFilterItem = async (row: {
    field: string;
    streamAlias?: string;
  }) => {
    try {
      const queryReq = {
        org_identifier: store.state.selectedOrganization.identifier,
        stream_name: row.streamAlias
          ? getStreamNameFromStreamAlias(row.streamAlias)
          : dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream,
        start_time: new Date(
          dashboardPanelData?.meta?.dateTime?.["start_time"]?.toISOString(),
        ).getTime(),
        end_time: new Date(
          dashboardPanelData?.meta?.dateTime?.["end_time"]?.toISOString(),
        ).getTime(),
        fields: [row.field],
        size: 100,
        type: dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type,
        no_count: true,
      };

      const response = await valuesWebSocket.fetchFieldValues(
        queryReq,
        dashboardPanelData,
        row,
      );
    } catch (error: any) {
      const errorDetailValue =
        error.response?.data.error_detail ||
        error.response?.data.message ||
        "Something went wrong!";
      const trimmedErrorMessage =
        errorDetailValue.length > 300
          ? errorDetailValue.slice(0, 300) + " ..."
          : errorDetailValue;
      showErrorNotification(trimmedErrorMessage);
    }
  };

  const removeXYFilters = () => {
    if (
      promqlMode.value ||
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery == false
    ) {
      dashboardPanelData.meta.stream.customQueryFields = [];
      dashboardPanelData.meta.stream.vrlFunctionFieldList = [];
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.x.splice(
        0,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.x.length,
      );
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.y.splice(
        0,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y.length,
      );
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z.splice(
        0,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z.length,
      );
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields?.breakdown?.splice(
        0,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields?.breakdown?.length,
      );
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.filter.conditions.splice(
        0,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.filter.conditions.length,
      );
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.latitude = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.longitude = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.weight = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.name = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.value_for_maps = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.source = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.target = null;
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.value = null;
    }
  };

  // This function updates the x and y fields of a custom query in the dashboard panel data
  const updateXYFieldsForCustomQueryMode = () => {
    // Check if the custom query is enabled and PromQL mode is disabled
    if (
      !promqlMode.value &&
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery == true
    ) {
      // clear joins when switching to custom query mode
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].joins = [];

      // first, remove all derived fields from x,y,z,latitude,longitude,weight,source,target,value
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.x = dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields?.x?.filter((it: any) => !it.isDerived);

      // remove from y axis
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.y = dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields?.y?.filter((it: any) => !it.isDerived);

      // remove from z axis
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.z = dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields?.z?.filter((it: any) => !it.isDerived);

      // remove from breakdown
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields.breakdown = dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].fields?.breakdown?.filter((it: any) => !it.isDerived);

      // remove from latitude
      if (
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.latitude?.alias &&
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.latitude?.isDerived
      ) {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.latitude = null;
      }

      // remove from longitude
      if (
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.longitude?.alias &&
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.longitude?.isDerived
      ) {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.longitude = null;
      }

      // remove from weight
      if (
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.weight?.alias &&
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.weight?.isDerived
      ) {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.weight = null;
      }

      // remove from source
      if (
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.source?.alias &&
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.source?.isDerived
      ) {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.source = null;
      }

      // remove from target
      if (
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.target?.alias &&
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.target?.isDerived
      ) {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.target = null;
      }

      // remove from value
      if (
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.value?.alias &&
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.value?.isDerived
      ) {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.value = null;
      }

      // remove from name
      if (
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.name?.alias &&
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.name?.isDerived
      ) {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.name = null;
      }

      // remove from value_for_maps
      if (
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.value_for_maps?.alias &&
        dashboardPanelData?.data?.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.value_for_maps?.isDerived
      ) {
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.value_for_maps = null;
      }

      // Loop through each custom query field in the dashboard panel data's stream meta
      dashboardPanelData.meta.stream.customQueryFields.forEach(
        (it: any, index: number) => {
          // Get the name of the current custom query field
          const { name } = it;

          // Determine the current field type based on the name
          let field;
          if (name === "latitude") {
            field =
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.latitude;
          } else if (name === "longitude") {
            field =
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.longitude;
          } else if (name === "weight") {
            field =
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.weight;
          } else if (name === "name") {
            field =
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.name;
          } else if (name === "value_for_maps") {
            field =
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.value_for_maps;
          } else if (name === "source") {
            field =
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.source;
          } else if (name === "target") {
            field =
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.target;
          } else if (name === "value") {
            field =
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.value;
          } else {
            // For other field types (x, y, z), determine the type and index as before
            let currentFieldType;

            if (
              index <
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.x.length
            ) {
              currentFieldType = "x";
            } else if (
              index <
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.x.length +
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields.y.length
            ) {
              currentFieldType = "y";
            } else if (
              index <
              dashboardPanelData.data.queries[
                dashboardPanelData.layout.currentQueryIndex
              ].fields.x.length +
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields.y.length +
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields.breakdown.length
            ) {
              currentFieldType = "breakdown";
            } else {
              currentFieldType = "z";
            }

            if (currentFieldType === "x") {
              field =
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields.x[index];
            } else if (currentFieldType === "y") {
              field =
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields.y[
                  index -
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.x.length
                ];
            } else if (currentFieldType === "breakdown") {
              field =
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields.breakdown[
                  index -
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.x.length -
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.y.length
                ];
            } else {
              field =
                dashboardPanelData.data.queries[
                  dashboardPanelData.layout.currentQueryIndex
                ].fields.z[
                  index -
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.x.length -
                    dashboardPanelData.data.queries[
                      dashboardPanelData.layout.currentQueryIndex
                    ].fields.y.length
                ];
            }
            // If the current field is a y or z field, set the aggregation function to "count"
            if (
              (currentFieldType === "y" || currentFieldType === "z") &&
              !field.isDerived
            ) {
              field.functionName = "count";
              // take first arg
              field.args = field.args.length ? [field?.args?.[0]] : [];
            }
          }

          // Update the properties of the current field
          field.alias = name; // Set the alias to the name of the custom query field
          field.column = name; // Set the column to the name of the custom query field
          field.color = null; // Reset the color to null
        },
      );
    }
  };

  // this updates the fields when you switch from the auto to custom
  const updateXYFieldsOnCustomQueryChange = (oldCustomQueryFields: any) => {
    // Create a copy of the old custom query fields array
    const oldArray = oldCustomQueryFields;
    // Create a deep copy of the new custom query fields array
    const newArray = JSON.parse(
      JSON.stringify(dashboardPanelData.meta.stream.customQueryFields),
    );

    // Check if the length of the old and new arrays are the same
    if (oldArray.length == newArray.length) {
      // Create an array to store the indexes of changed fields
      const changedIndex: any = [];
      // Iterate through the new array
      newArray.forEach((obj: any, index: any) => {
        const { name } = obj;
        // Check if the name of the field at the same index in the old array is different
        if (oldArray[index].name != name) {
          changedIndex.push(index);
        }
      });
      // Check if there is only one changed field
      if (changedIndex.length == 1) {
        const oldName = oldArray[changedIndex[0]]?.name;

        let fieldIndex = dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.x?.findIndex((it: any) => it?.alias == oldName);
        // Check if the field is in the x fields array
        if (fieldIndex >= 0) {
          const newName = newArray[changedIndex[0]]?.name;
          const field =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.x[fieldIndex];

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        }
        // Check if the field is in the breakdown fields array
        fieldIndex = dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown?.findIndex((it: any) => it?.alias == oldName);
        if (fieldIndex >= 0) {
          const newName = newArray[changedIndex[0]]?.name;
          const field =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.breakdown[fieldIndex];

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        }
        // Check if the field is in the y fields array
        fieldIndex = dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y?.findIndex((it: any) => it?.alias == oldName);
        if (fieldIndex >= 0) {
          const newName = newArray[changedIndex[0]]?.name;
          const field =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.y[fieldIndex];

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        }
        // Check if the field is in the z fields array
        fieldIndex = dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z?.findIndex((it: any) => it?.alias == oldName);
        if (fieldIndex >= 0) {
          const newName = newArray[changedIndex[0]]?.name;
          const field =
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.z[fieldIndex];

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        }

        //Check if the field is in the latitude fields
        let field =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.latitude;

        if (field && field.alias == oldName) {
          const newName = newArray[changedIndex[0]]?.name;

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        }

        //Check if the field is in the longitude fields array
        field =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.longitude;

        if (field && field.alias == oldName) {
          const newName = newArray[changedIndex[0]]?.name;

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        }

        //Check if the field is in the weight fields array
        field =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.weight;

        if (field && field.alias == oldName) {
          const newName = newArray[changedIndex[0]]?.name;

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        }

        //Check if the field is in the name fields
        field =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.name;

        if (field && field.alias == oldName) {
          const newName = newArray[changedIndex[0]]?.name;

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        }

        //Check if the field is in the value fields
        field =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.value_for_maps;

        if (field && field.alias == oldName) {
          const newName = newArray[changedIndex[0]]?.name;

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        }

        //Check if the field is in the source fields array
        field =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.source;

        if (field && field.alias == oldName) {
          const newName = newArray[changedIndex[0]]?.name;

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        }

        //Check if the field is in the target fields array
        field =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.target;

        if (field && field.alias == oldName) {
          const newName = newArray[changedIndex[0]]?.name;

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        }

        //Check if the field is in the value fields array
        field =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.value;

        if (field && field.alias == oldName) {
          const newName = newArray[changedIndex[0]]?.name;

          // Update the field alias and column to the new name
          field.alias = newName;
          field.column = newName;
        }
      }
    }
  };

  onBeforeMount(async () => {
    await importSqlParser();
  });

  onUnmounted(async () => {
    parser = null;
  });

  const importSqlParser = async () => {
    const useSqlParser: any = await import("@/composables/useParser");
    const { sqlParser }: any = useSqlParser.default();
    parser = await sqlParser();

    // do not allow to modify custom query fields for logs page
    updateQueryValue(pageKey == "logs" ? true : false);
  };

  // based on chart type it will create auto sql query
  const makeAutoSQLQuery = async () => {
    // only continue if current mode is auto query generation
    if (
      !dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery
    ) {
      if (!dashboardPanelData?.meta?.streamFields?.groupedFields?.length) {
        return;
      }

      // Don't generate auto query for promql query type
      if (dashboardPanelData?.data?.queryType === "promql") {
        return;
      }

      let query = "";
      if (dashboardPanelData.data.type == "geomap") {
        query = geoMapChart(dashboardPanelData);
      } else if (dashboardPanelData.data.type == "sankey") {
        query = sankeyChartQuery(dashboardPanelData);
      } else if (dashboardPanelData.data.type == "maps") {
        query = mapChart(dashboardPanelData);
      } else {
        query = buildSQLChartQuery({
          queryData:
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ],
          chartType: dashboardPanelData.data.type,
          dashboardPanelData,
        });
      }
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].query = query;
      return query;
    }
  };
  const { checkTimestampAlias } = logsUtils();
  // Replace the existing validatePanel function with a wrapper that calls the generic function
  const validatePanelWrapper = (
    errors: string[],
    isFieldsValidationRequired: boolean = true,
  ) => {
    validatePanel(
      dashboardPanelData,
      errors,
      isFieldsValidationRequired,
      [
        ...selectedStreamFieldsBasedOnUserDefinedSchema.value,
        ...dashboardPanelData.meta.stream.vrlFunctionFieldList,
        ...dashboardPanelData.meta.stream.customQueryFields,
      ],
      pageKey,
      store,
      checkTimestampAlias,
    );
  };

  const VARIABLE_PLACEHOLDER = "substituteValue";

  const validateQuery = (query: any, variables: any) => {
    // Helper to test one replacement (string or number)
    const testReplacement = (q: any, varName: any, replacement: any) => {
      const regex = new RegExp(`\\$(?:{${varName}}|${varName})(?!\\w)`, "g");
      return q.replace(regex, replacement);
    };

    // Recursive validation function
    const validateRecursive: any = (currentQuery: any, remainingVars: any) => {
      if (!remainingVars.length) {
        try {
          // Try parsing the current query
          parser.astify(currentQuery);
          return currentQuery; // Return valid query
        } catch (error) {
          return null; // Invalid query
        }
      }

      // Process next variable
      const [varName, ...restVars] = remainingVars;

      // Try as string
      const stringQuery = testReplacement(
        currentQuery,
        varName,
        "VARIABLE_PLACEHOLDER",
      );
      const resultAsString: any = validateRecursive(stringQuery, restVars);
      if (resultAsString) return resultAsString; // Found valid query

      // Try as number
      const numericQuery = testReplacement(currentQuery, varName, "10");
      const resultAsNumber = validateRecursive(numericQuery, restVars);
      if (resultAsNumber) return resultAsNumber; // Found valid query

      // If neither works, return null
      throw new Error("Invalid query");
    };

    return validateRecursive(query, variables);
  };

  // Extract variables from the query
  const extractVariables = (query: any) => {
    const matches = query.match(/\$(\w+|\{\w+\})/g);
    return matches
      ? [...new Set(matches.map((v: any) => v.replace(/^\$|\{|\}/g, "")))]
      : [];
  };

  // now check if the correct stream is selected
  function isDummyStreamName(tableName: any) {
    return tableName?.includes("VARIABLE_PLACEHOLDER");
  }

  // This function parses the custom query and generates the errors and custom fields
  const updateQueryValue = async (
    shouldSkipCustomQueryFields: boolean = false,
  ) => {
    // store the query in the dashboard panel data
    // dashboardPanelData.meta.editorValue = value;
    // dashboardPanelData.data.query = value;

    if (
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery &&
      dashboardPanelData.data.queryType != "promql" &&
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].query
    ) {
      // empty the errors
      dashboardPanelData.meta.errors.queryErrors = [];

      // Get the parsed query
      try {
        let currentQuery =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].query;

        // replace variables with dummy values to verify query is correct or not
        if (/\${[a-zA-Z0-9_-]+:csv}/.test(currentQuery)) {
          currentQuery = currentQuery.replaceAll(
            /\${[a-zA-Z0-9_-]+:csv}/g,
            "1,2",
          );
        }
        if (/\${[a-zA-Z0-9_-]+:singlequote}/.test(currentQuery)) {
          currentQuery = currentQuery.replaceAll(
            /\${[a-zA-Z0-9_-]+:singlequote}/g,
            "'1','2'",
          );
        }
        if (/\${[a-zA-Z0-9_-]+:doublequote}/.test(currentQuery)) {
          currentQuery = currentQuery.replaceAll(
            /\${[a-zA-Z0-9_-]+:doublequote}/g,
            '"1","2"',
          );
        }
        if (/\${[a-zA-Z0-9_-]+:pipe}/.test(currentQuery)) {
          currentQuery = currentQuery.replaceAll(
            /\${[a-zA-Z0-9_-]+:pipe}/g,
            "1|2",
          );
        }

        const variables = extractVariables(currentQuery); // Extract all unique variables
        const validatedQuery = validateQuery(currentQuery, variables);

        if (validatedQuery) {
          dashboardPanelData.meta.parsedQuery = parser.astify(validatedQuery);
        } else {
          dashboardPanelData.meta.parsedQuery = null;
        }
      } catch (e) {
        // exit if not able to parse query
        return null;
      }
      if (!dashboardPanelData.meta.parsedQuery) {
        return;
      }

      // We have the parsed query, now get the columns and tables
      // get the columns first
      if (
        Array.isArray(dashboardPanelData.meta.parsedQuery?.columns) &&
        dashboardPanelData.meta.parsedQuery?.columns?.length > 0 &&
        !shouldSkipCustomQueryFields
      ) {
        const oldCustomQueryFields = JSON.parse(
          JSON.stringify(dashboardPanelData.meta.stream.customQueryFields),
        );
        dashboardPanelData.meta.stream.customQueryFields = [];

        const fields = extractFields(
          dashboardPanelData.meta.parsedQuery,
          store.state.zoConfig.timestamp_column ?? "_timestamp",
        );

        if (Array.isArray(fields)) {
          fields.forEach((field: any) => {
            const fieldAlias = field.alias ?? field.column;
            if (
              !dashboardPanelData.meta.stream.customQueryFields.find(
                (it: any) => it.name == fieldAlias,
              )
            ) {
              dashboardPanelData.meta.stream.customQueryFields.push({
                name: fieldAlias,
                type: "",
              });
            }
          });
        }

        // update the existing x and y axis fields
        updateXYFieldsOnCustomQueryChange(oldCustomQueryFields);
      } else if (!shouldSkipCustomQueryFields) {
        dashboardPanelData.meta.errors.queryErrors.push("Invalid Columns");
      }

      const currentQuery =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ];

      const tableName = await getStreamNameFromQuery(currentQuery?.query ?? "");

      if (tableName) {
        const streamFound = dashboardPanelData.meta.stream.streamResults.find(
          (it: any) => it.name == tableName,
        );

        if (streamFound) {
          if (currentQuery.fields.stream != streamFound.name) {
            currentQuery.fields.stream = streamFound.name;
          }
        } else if (isDummyStreamName(tableName)) {
          // nothing to do as the stream is dummy
        }
      }
    }
  };

  watch(
    () => [
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].query,
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery, // Only watch for custom query mode changes
      selectedStreamFieldsBasedOnUserDefinedSchema.value,
    ],
    async (newVal, oldVal) => {
      // if pageKey is logs, then return
      // because custom query fields will be extracted from the query using the result schema api
      // NOW: we need to only skip custom query fields for logs page
      // not stream selection, so commented below code and in updateQueryValue function will skip custom query fields extraction
      // if (pageKey == "logs") {
      //   return;
      // }

      // Check if customQuery mode has changed
      const customQueryChanged = newVal[1] !== oldVal[1];

      // Only continue if the current mode is "show custom query"
      if (
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery &&
        dashboardPanelData.data.queryType == "sql"
      ) {
        // Call the updateQueryValue function
        // will skip custom query fields extraction for logs page
        if (parser) await updateQueryValue(pageKey == "logs" ? true : false);
      } else if (customQueryChanged) {
        // Only clear lists when switching modes
        // auto query mode selected
        // remove the custom fields from the list
        dashboardPanelData.meta.stream.customQueryFields = [];
        dashboardPanelData.meta.stream.vrlFunctionFieldList = []; // Clear VRL function field list
      }
      // if (dashboardPanelData.data.queryType == "promql") {
      //     updatePromQLQuery()
      // }
    },
    { deep: true },
  );

  const currentXLabel = computed(() => {
    return dashboardPanelData.data.type == "table"
      ? "First Column"
      : dashboardPanelData.data.type == "h-bar"
        ? "Y-Axis"
        : "X-Axis";
  });

  const currentYLabel = computed(() => {
    return dashboardPanelData.data.type == "table"
      ? "Other Columns"
      : dashboardPanelData.data.type == "h-bar"
        ? "X-Axis"
        : "Y-Axis";
  });

  const resetFields = () => {
    dashboardPanelData.data.queries[
      dashboardPanelData.layout.currentQueryIndex
    ].fields = {
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
      name: null,
      value_for_maps: null,
      source: null,
      target: null,
      value: null,
    };
  };

  const setFieldsBasedOnChartTypeValidation = (
    fields: any,
    chartType: string,
  ) => {
    // First reset all existing fields in dashboardPanelData
    resetFields();

    // For table chart type, merge breakdown fields into x fields
    const fieldsToProcess = { ...fields };
    if (chartType === "table") {
      fieldsToProcess.x = [...(fields.x || []), ...(fields.breakdown || [])];
      fieldsToProcess.breakdown = [];
    }

    // The add functions will automatically apply validation based on current chart type
    // Add X-axis fields
    fieldsToProcess.x?.forEach((field: any) => {
      const fieldName =
        typeof field === "string" ? field : field.name || field.column;
      if (fieldName) {
        addXAxisItem({ name: fieldName });
      }
    });

    // Add Y-axis fields
    fieldsToProcess.y?.forEach((field: any) => {
      const fieldName =
        typeof field === "string" ? field : field.name || field.column;
      if (fieldName) {
        addYAxisItem({ name: fieldName });
      }
    });

    // Add Z-axis fields
    fieldsToProcess.z?.forEach((field: any) => {
      const fieldName =
        typeof field === "string" ? field : field.name || field.column;
      if (fieldName) {
        addZAxisItem({ name: fieldName });
      }
    });

    // Add breakdown fields
    fieldsToProcess.breakdown?.forEach((field: any) => {
      const fieldName =
        typeof field === "string" ? field : field.name || field.column;
      if (fieldName) {
        addBreakDownAxisItem({ name: fieldName });
      }
    });
  };

  // Function to get result schema
  const getResultSchema = async (
    query: string,
    abortSignal?: AbortSignal,
    startISOTimestamp?: number,
    endISOTimestamp?: number,
  ): Promise<{
    group_by: string[];
    projections: string[];
    timeseries_field: string | null;
  }> => {
    // get extracted fields from the query
    const schemaRes = await queryService.result_schema(
      {
        org_identifier: store.state.selectedOrganization.identifier,
        query: {
          query: {
            sql: store.state.zoConfig.sql_base64_enabled
              ? b64EncodeUnicode(query)
              : query,
            query_fn: null,
            start_time: startISOTimestamp,
            end_time: endISOTimestamp,
            size: -1,
            histogram_interval: undefined,
            streaming_output: false,
            streaming_id: null,
          },
          ...(store.state.zoConfig.sql_base64_enabled
            ? { encoding: "base64" }
            : {}),
        },
        page_type: "dashboards",
        is_streaming: isStreamingEnabled(store.state),
      },
      "dashboards",
    );

    // if abort signal is received, throw an error
    if (abortSignal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    return schemaRes.data;
  };

  // Function to determine chart type based on extracted fields
  const determineChartType = (extractedFields: {
    group_by: string[];
    projections: string[];
    timeseries_field: string | null;
  }): string => {
    if (
      extractedFields.timeseries_field &&
      extractedFields.group_by.length <= 2
    ) {
      return "line";
    } else {
      return "table";
    }
  };

  // Function to convert result schema to x, y, breakdown fields
  const convertSchemaToFields = (
    extractedFields: {
      group_by: string[];
      projections: string[];
      timeseries_field: string | null;
    },
    chartType: string,
  ): {
    x: string[];
    y: string[];
    breakdown: string[];
  } => {
    // For table charts, add all projections to x-axis since tables display all fields as columns
    if (chartType === "table") {
      return {
        x: [...extractedFields.projections],
        y: [],
        breakdown: [],
      };
    }

    // For non-table charts, use the original logic
    // remove group by and timeseries field from projections, while using it on y axis
    const yAxisFields = extractedFields.projections.filter(
      (field) =>
        !extractedFields.group_by.includes(field) &&
        field !== extractedFields.timeseries_field,
    );

    const fields = {
      x: [] as string[],
      y: yAxisFields,
      breakdown: [] as string[],
    };

    // add timestamp as x axis
    if (extractedFields.timeseries_field) {
      fields.x.push(extractedFields.timeseries_field);
    }

    extractedFields.group_by.forEach((field: any) => {
      if (field != extractedFields.timeseries_field) {
        // if x axis is empty then first add group by as x axis
        if (fields.x.length == 0) {
          fields.x.push(field);
        } else {
          fields.breakdown.push(field);
        }
      }
    });

    return fields;
  };

  // For visualization, we need to set the custom query fields
  const setCustomQueryFields = async (
    extractedFieldsParam?: {
      group_by: string[];
      projections: string[];
      timeseries_field: string | null;
    },
    autoSelectChartType: boolean = true,
    abortSignal?: AbortSignal,
  ) => {
    resetFields();

    // Helper function to process extracted fields and populate axes
    const processExtractedFields = (
      extractedFields: {
        group_by: string[];
        projections: string[];
        timeseries_field: string | null;
      },
      autoSelectChartType: boolean = true,
    ) => {
      // remove all fields from custom query fields
      dashboardPanelData.meta.stream.customQueryFields = [];

      // add all fields to custom query fields
      extractedFields.projections.forEach((field: any) => {
        dashboardPanelData.meta.stream.customQueryFields.push({
          name: field,
          type: "",
        });
      });

      // Determine chart type
      const chartType = autoSelectChartType
        ? determineChartType(extractedFields)
        : dashboardPanelData.data.type;
      dashboardPanelData.data.type = chartType;

      // Convert schema to fields
      const fields = convertSchemaToFields(extractedFields, chartType);

      // Set fields using existing validation function
      setFieldsBasedOnChartTypeValidation(fields, chartType);
    };

    // If extractedFieldsParam is provided, use it directly to avoid duplicate API call
    if (extractedFieldsParam) {
      processExtractedFields(extractedFieldsParam, autoSelectChartType);
      return;
    }

    const timestamps = dashboardPanelData.meta.dateTime;
    let startISOTimestamp: any;
    let endISOTimestamp: any;
    if (
      timestamps?.start_time &&
      timestamps?.end_time &&
      timestamps.start_time != "Invalid Date" &&
      timestamps.end_time != "Invalid Date"
    ) {
      startISOTimestamp = new Date(
        timestamps.start_time.toISOString(),
      ).getTime();
      endISOTimestamp = new Date(timestamps.end_time.toISOString()).getTime();
    } else {
      return;
    }

    const currentQuery =
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].query;

    const extractedFields = await getResultSchema(
      currentQuery,
      abortSignal,
      startISOTimestamp,
      endISOTimestamp,
    );
    processExtractedFields(extractedFields, autoSelectChartType);
  };

  // Fetch available labels and their values for PromQL builder
  const fetchPromQLLabels = async (metric: string) => {
    if (!metric || !dashboardPanelData.meta.promql) return;

    // Update shared meta
    dashboardPanelData.meta.promql.loadingLabels = true;

    try {
      const endTime = Math.floor(Date.now() * 1000); // microseconds
      const startTime = endTime - 24 * 60 * 60 * 1000000; // 24 hours ago in microseconds

      const response = await metricsService.get_promql_series({
        org_identifier: store.state.selectedOrganization.identifier,
        labels: `{__name__="${metric}"}`,
        start_time: startTime,
        end_time: endTime,
      });

      if (
        response.data &&
        response.data.data &&
        response.data.data.length > 0
      ) {
        // Extract all unique label keys and their values from the series
        const labelSet = new Set<string>();
        const valuesMap = new Map<string, Set<string>>();

        response.data.data.forEach((series: any) => {
          Object.keys(series).forEach((key) => {
            if (key !== "__name__") {
              labelSet.add(key);

              // Collect all values for this label key
              if (!valuesMap.has(key)) {
                valuesMap.set(key, new Set<string>());
              }
              valuesMap.get(key)!.add(series[key]);
            }
          });
        });

        // Save to shared meta
        dashboardPanelData.meta.promql.availableLabels =
          Array.from(labelSet).sort();

        // Convert Sets to sorted arrays and store in the map
        const newLabelValuesMap = new Map<string, string[]>();
        valuesMap.forEach((valueSet, labelKey) => {
          newLabelValuesMap.set(labelKey, Array.from(valueSet).sort());
        });
        dashboardPanelData.meta.promql.labelValuesMap = newLabelValuesMap;
      } else {
        dashboardPanelData.meta.promql.availableLabels = [];
        dashboardPanelData.meta.promql.labelValuesMap = new Map();
      }
    } catch (error) {
      dashboardPanelData.meta.promql.availableLabels = [];
      dashboardPanelData.meta.promql.labelValuesMap = new Map();
    } finally {
      dashboardPanelData.meta.promql.loadingLabels = false;
    }
  };

  return {
    dashboardPanelData,
    resetDashboardPanelData,
    resetDashboardPanelDataAndAddTimeField,
    updateArrayAlias,
    addXAxisItem,
    addYAxisItem,
    addZAxisItem,
    addBreakDownAxisItem,
    addLatitude,
    addLongitude,
    addWeight,
    addMapName,
    addMapValue,
    addSource,
    addTarget,
    addValue,
    removeXAxisItemByIndex,
    removeYAxisItemByIndex,
    removeZAxisItemByIndex,
    removeBreakdownItemByIndex,
    removeFilterItem,
    removeLatitude,
    removeLongitude,
    removeWeight,
    removeMapName,
    removeMapValue,
    removeSource,
    removeTarget,
    removeValue,
    addFilteredItem,
    loadFilterItem,
    removeXYFilters,
    updateXYFieldsForCustomQueryMode,
    updateXYFieldsOnCustomQueryChange,
    isAddXAxisNotAllowed,
    isAddBreakdownNotAllowed,
    isAddYAxisNotAllowed,
    isAddZAxisNotAllowed,
    promqlMode,
    addQuery,
    removeQuery,
    resetAggregationFunction,
    cleanupDraggingFields,
    getDefaultQueries,
    validatePanel: validatePanelWrapper,
    makeAutoSQLQuery,
    currentXLabel,
    currentYLabel,
    generateLabelFromName,
    selectedStreamFieldsBasedOnUserDefinedSchema,
    updateGroupedFields,
    getAllSelectedStreams,
    setCustomQueryFields,
    getResultSchema,
    determineChartType,
    convertSchemaToFields,
    setFieldsBasedOnChartTypeValidation,
    getDefaultDashboardPanelData,
    getStreamNameFromStreamAlias,
    fetchPromQLLabels,
  };
};
export default useDashboardPanelData;
