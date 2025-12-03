// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { StreamInfo } from "@/services/service_streams";

export interface MetricsCorrelationConfig {
  serviceName: string;
  matchedDimensions: Record<string, string>;
  metricStreams: StreamInfo[];
  orgIdentifier: string;
  timeRange: {
    startTime: number; // Timestamp in microseconds (16 digits)
    endTime: number;   // Timestamp in microseconds (16 digits)
  };
}

/**
 * Composable for generating dashboard JSON for metrics correlation
 *
 * Creates a time-series dashboard showing correlated metrics
 */
export function useMetricsCorrelationDashboard() {
  /**
   * Generate dashboard JSON for metrics correlation
   */
  const generateDashboard = (
    streams: StreamInfo[],
    config: MetricsCorrelationConfig
  ) => {
    console.log("[useMetricsCorrelationDashboard] generateDashboard called with:", {
      streamsCount: streams.length,
      config,
    });

    const panels = streams.map((stream, index) => {
      const panel = createMetricPanel(stream, index, config);
      console.log(`[useMetricsCorrelationDashboard] Created panel ${index}:`, {
        id: panel.id,
        title: panel.title,
        query: panel.queries[0]?.query,
        fields: panel.queries[0]?.fields,
      });
      return panel;
    });

    // Create dashboard variables from matched dimensions (using correct structure)
    const variablesList = Object.entries(config.matchedDimensions).map(([key, value]) => ({
      type: "textbox" as const,
      name: key,
      label: key,
      value: value,
      multiSelect: false,
      isLoading: false,
      isVariableLoading: false,
      description: `Filter by ${key}`,
    }));

    const dashboard = {
      version: 5,
      dashboardId: ``,
      title: `Correlated Metrics - ${config.serviceName}`,
      description: `Metrics correlated with service ${config.serviceName}`,
      role: "",
      owner: "",
      created: new Date().toISOString(),
      variables: {
        list: variablesList,
        showDynamicFilters: false,
      },
      tabs: [
        {
          tabId: "metrics",
          name: "Metrics",
          panels,
        },
      ],
      defaultDatetimeDuration: {
        type: "relative",
        relativeTimePeriod: "15m",
        // config.timeRange already contains microseconds (16 digits), pass directly
        startTime: config.timeRange.startTime,
        endTime: config.timeRange.endTime,
      },
    };

    console.log("[useMetricsCorrelationDashboard] Generated dashboard:", {
      title: dashboard.title,
      version: dashboard.version,
      panelsCount: panels.length,
      variablesCount: dashboard.variables.list.length,
      dashboardId: dashboard.dashboardId,
      tabId: dashboard.tabs[0].tabId,
      defaultDatetimeDuration: dashboard.defaultDatetimeDuration,
      "CRITICAL CHECK - defaultDatetimeDuration.startTime": dashboard.defaultDatetimeDuration.startTime,
      "CRITICAL CHECK - defaultDatetimeDuration.endTime": dashboard.defaultDatetimeDuration.endTime,
      "CRITICAL CHECK - startTime digits": dashboard.defaultDatetimeDuration.startTime.toString().length,
      "CRITICAL CHECK - endTime digits": dashboard.defaultDatetimeDuration.endTime.toString().length,
      firstPanelFull: JSON.stringify(panels[0], null, 2),
    });

    return dashboard;
  };

  /**
   * Create a single metric panel
   */
  const createMetricPanel = (
    stream: StreamInfo,
    index: number,
    config: MetricsCorrelationConfig
  ) => {
    console.log(`[useMetricsCorrelationDashboard] createMetricPanel for stream: ${stream.stream_name}`, {
      filters: stream.filters,
      index,
      timeRange: config.timeRange,
    });

    // Build WHERE clause from stream filters
    // Quote field names that contain special characters (hyphens, dots, etc.)
    const whereConditions = Object.entries(stream.filters)
      .map(([field, value]) => {
        // Quote field name if it contains special characters
        const quotedField = /[^a-zA-Z0-9_]/.test(field) ? `"${field}"` : field;
        const escapedValue = value.replace(/'/g, "''");
        return `${quotedField} = '${escapedValue}'`;
      })
      .join(" AND ");

    const whereClause = whereConditions ? `WHERE ${whereConditions}` : "";

    // Time-series SQL query for metrics
    // Note: Time range comes from dashboard defaultDatetimeDuration, not embedded in SQL
    const query = `SELECT histogram(_timestamp) as x_axis_1, avg(value) as y_axis_1
FROM "${stream.stream_name}"
${whereClause}
GROUP BY x_axis_1
ORDER BY x_axis_1`;

    console.log(`[useMetricsCorrelationDashboard] Generated SQL for ${stream.stream_name}:`, query);
    console.log(`[useMetricsCorrelationDashboard] Stream info:`, JSON.stringify(stream, null, 2));
    console.log(`[useMetricsCorrelationDashboard] WHERE conditions:`, whereConditions);

    // Calculate panel position (3 columns)
    const col = index % 3;
    const row = Math.floor(index / 3);

    return {
      id: `panel_${stream.stream_name}_${index}`,
      type: "area-stacked",
      title: stream.stream_name,
      description: `Time series for ${stream.stream_name}`,
      config: {
        show_legends: true,
        legends_position: "bottom",
        unit: "short",
        unit_custom: "",
        axis_width: 80,
        promql_legend: "",
        axis_border_show: true,
        color: {
          mode: "palette-classic-by-series",
          fixedColor: ["#5960b2"],
          seriesBy: "last",
          colorBySeries: [],
        },
        top_results_others: false,
        line_thickness: 1.5,
        step_value: "0",
        show_symbol: false,
        line_interpolation: "smooth",
        legend_width: {
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
        connect_nulls: true,
        no_value_replacement: "",
        wrap_table_cells: false,
        table_transpose: false,
        table_dynamic_columns: false,
        trellis: {
          layout: null,
          num_of_columns: 1,
          group_by_y_axis: false,
        },
        dataZoom: { yAxisIndex: "none" },
      },
      queryType: "sql",
      queries: [
        {
          query: query,
          vrlFunctionQuery: "",
          customQuery: true,
          fields: {
            stream: stream.stream_name,
            stream_type: "metrics",
            x: [
              {
                label: "",
                alias: "x_axis_1",
                column: "_timestamp",
                color: null,
                isDerived: false,
                havingConditions: [],
                aggregationFunction: "histogram",
              },
            ],
            y: [
              {
                label: stream.stream_name,
                alias: "y_axis_1",
                column: "value",
                color: "#5960b2",
                isDerived: false,
                havingConditions: [],
                aggregationFunction: "avg",
              },
            ],
            z: [],
            breakdown: [],
            filter: {
              filterType: "group",
              logicalOperator: "AND",
              conditions: [],
            },
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
      layout: {
        x: col * 64,
        y: row * 16,
        w: 64,
        h: 16,
        i: `${stream.stream_name}_${index}`,
      },
      htmlContent: "",
      markdownContent: "",
      customChartContent: "",
    };
  };

  return {
    generateDashboard,
  };
}
