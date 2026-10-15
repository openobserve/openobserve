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

import { vi } from "vitest";

export function initializeLogsIndexDom(): void {
  Object.defineProperty(global, "CSS", {
    value: {
      supports: () => false,
      escape: () => "",
    },
  });

  const node = document.createElement("div");
  node.setAttribute("id", "app");
  document.body.appendChild(node);
}

vi.mock("@/utils/query/sqlUtils", () => ({
  buildSqlQuery: vi.fn(),
  getFieldsFromQuery: vi.fn(),
  isSimpleSelectAllQuery: vi.fn((query) => {
    if (!query || typeof query !== "string") return false;
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    const selectAllPattern = /^select\s+\*\s+from\s+/i;
    return selectAllPattern.test(normalizedQuery);
  }),
}));
vi.mock("@/composables/useDashboardPanelData", () => ({
  default: () => ({
    dashboardPanelData: {
      data: {
        version: 5,
        queries: [
          {
            fields: {
              stream_type: "",
              stream: "",
              x: [],
              y: [],
              z: [],
              breakdown: [],
              filter: [],
              latitude: null,
              longitude: null,
              weight: null,
              name: null,
              value_for_maps: null,
            },
          },
        ],
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
          show_symbol: true,
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
            fixedColor: [],
            seriesBy: "last",
          },
          background: null,
        },
        htmlContent: "",
        markdownContent: "",
        customChartContent: ` // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// 'data' variable is available for use and contains the response data from the search result and it is an array.\noption = {  \n \n};
      `,
        customChartResult: {},
        queryType: "sql",
      },
      layout: {
        splitter: 20,
        querySplitter: 41,
        showQueryBar: false,
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
    },
    validatePanel: vi.fn(),
    generateLabelFromName: (name: string) => name,
    resetDashboardPanelData: vi.fn(),
  }),
}));
