// Copyright 2026 OpenObserve Inc.
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
      sticky_first_column: false,
      column_order: [],
      table_pagination: false,
      table_pagination_rows_per_page: null,
      // Pivot table config
      table_pivot_show_row_totals: false,
      table_pivot_show_col_totals: false,
      table_pivot_sticky_row_totals: false,
      table_pivot_sticky_col_totals: false,
      panel_time_enabled: false,
      panel_time_range: null,
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
        vrlFunctionFieldList: [],
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
          query_label: "",
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
    queryFields: {} as Record<
      number,
      { customQueryFields: any[]; vrlFunctionFieldList: any[] }
    >,
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

export const getDefaultCustomChartText = () => {
  return `\ // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// 'data' variable is available for use and contains the response data from the search result and it is an array.\noption = {  \n \n};
  `;
};
