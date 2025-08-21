import { useStore } from "vuex";

export const DEFAULT_COLORS = [
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

export const getDefaultCustomChartText = () => {
  return `\ // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// 'data' variable is available for use and contains the response data from the search result and it is an array.\noption = {  \n \n};
  `;
};

export const getDefaultDashboardPanelData: any = (store: any) => ({
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
      show_legends: true,
      legends_position: null,
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
      show_symbol: store?.state?.zoConfig?.dashboard_show_symbol_enabled ?? false,
      line_interpolation: "smooth",
      legend_width: {
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
      color: {
        mode: "palette-classic-by-series",
        fixedColor: ["#53ca53"],
        seriesBy: "last",
      },
      background: null,
    },
    htmlContent: "",
    markdownContent: "",
    customChartContent: getDefaultCustomChartText(),
    customChartResult: {},
    queryType: "sql",
    queries: [
      {
        query: "",
        vrlFunctionQuery: "",
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
  },
});

// Factory wrapper to match existing usage pattern
export const getDefaultsFactory = () => {
  const store = useStore();
  return getDefaultDashboardPanelData(store);
};
