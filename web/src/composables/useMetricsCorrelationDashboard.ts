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
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";

export interface MetricsCorrelationConfig {
  serviceName: string;
  matchedDimensions: Record<string, string>;
  metricStreams: StreamInfo[];
  logStreams?: StreamInfo[];
  traceStreams?: StreamInfo[];
  orgIdentifier: string;
  timeRange: {
    startTime: number; // Timestamp in microseconds (16 digits)
    endTime: number;   // Timestamp in microseconds (16 digits)
  };
  sourceStream?: string; // Original stream being viewed
  sourceType?: string; // Type of source stream
  availableDimensions?: Record<string, string>; // Actual field names (for source stream queries)
  metricSchemas?: Record<string, any>; // Cached metric schemas with metrics_meta
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
    const panels = streams.map((stream, index) => {
      return createMetricPanel(stream, index, config);
    });

    // No variables in the metrics dashboard - dimensions are managed at the top level
    const dashboard = {
      version: 5,
      dashboardId: ``,
      title: `Correlated Streams - ${config.serviceName}`,
      description: `Streams correlated with service ${config.serviceName}`,
      role: "",
      owner: "",
      created: new Date().toISOString(),
      variables: {
        list: [],
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
    // Get schema information for this metric stream
    const schema = config.metricSchemas?.[stream.stream_name];
    const metricsMeta = schema?.metrics_meta;
    const rawUnit = metricsMeta?.unit || "";
    const metricType = (metricsMeta?.metric_type || "").toLowerCase();

    // Map OpenTelemetry/Prometheus units to dashboard units
    const unitMapping: Record<string, string> = {
      "By": "bytes",
      "s": "seconds",
      "ms": "milliseconds",
      "us": "microseconds",
      "ns": "nanoseconds",
      "{cpu}": "percentunit", // CPU as percentage
      "1": "percentunit", // Dimensionless ratio (0-1)
      "%": "percent",
    };
    const unit = unitMapping[rawUnit] || rawUnit || "short";

    // Determine aggregation function based on metric type
    // Counter: sum to see total increase over time buckets
    // Gauge: avg or latest value
    // Histogram/Summary: need special handling
    const isCounter = metricType === "counter";
    const aggregationFunc = isCounter ? "sum" : "avg";

    // Build WHERE clause from stream filters
    // Quote field names that contain special characters (hyphens, dots, etc.)
    // Skip filters with SELECT_ALL_VALUE (wildcard - means match all values)
    
    const whereConditions = Object.entries(stream.filters)
      .filter(([field, value]) => {
        const skip = value === SELECT_ALL_VALUE;
        // if (skip) {
        //   console.log(`[useMetricsCorrelationDashboard] Skipping filter ${field}=${value} (SELECT_ALL_VALUE)`);
        // }
        return !skip;
      })
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
    // For counters, we sum the values to see total increase over time buckets
    const query = `SELECT histogram(_timestamp) as x_axis_1, ${aggregationFunc}(value) as y_axis_1
FROM "${stream.stream_name}"
${whereClause}
GROUP BY x_axis_1
ORDER BY x_axis_1`;

    // Calculate panel position (3 columns)
    const col = index % 3;
    const row = Math.floor(index / 3);

    return {
      id: `panel_${stream.stream_name}_${index}`,
      type: "line",
      title: stream.stream_name,
      description: `Time series for ${stream.stream_name}${metricType ? ` (${metricType})` : ""}`,
      config: {
        show_legends: false,
        legends_position: "bottom",
        unit: unit,
        unit_custom: "",
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
                column: "x_axis_1",
                color: null,
                isDerived: false,
                havingConditions: [],
              },
            ],
            y: [
              {
                label: "",
                alias: "y_axis_1",
                column: "y_axis_1",
                color: "#5960b2",
                isDerived: false,
                havingConditions: [],
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

  /**
   * Generate dashboard for logs (table panel)
   */
  const generateLogsDashboard = (
    streams: StreamInfo[],
    config: MetricsCorrelationConfig
  ) => {
    // Determine stream and filters based on available data
    let streamName: string;
    let filters: Record<string, string>;

    if (config.sourceType === "logs" && config.sourceStream) {
      // When viewing from logs page, prefer source stream
      streamName = config.sourceStream;

      // Try to find matching stream in API response
      const matchingStream = streams?.find(s => s.stream_name === config.sourceStream);
      if (matchingStream) {
        // Use filters from API response (best case - backend computed correct field names)
        filters = matchingStream.filters;
      } else if (streams && streams.length > 0) {
        // Source stream not in response, use first available stream's filters
        filters = streams[0].filters;
      } else {
        // No streams from API, fallback to matched dimensions
        filters = config.matchedDimensions || {};
      }
    } else if (streams && streams.length > 0) {
      // Use first correlated log stream from API response
      const primaryStream = streams[0];
      streamName = primaryStream.stream_name;
      filters = primaryStream.filters;
    } else {
      // No logs available
      return null;
    }

    // Build WHERE clause from filters
    // Filter out non-string values, internal fields, and SELECT_ALL_VALUE wildcards
    const whereConditions = Object.entries(filters)
      .filter(([field, value]) => {
        // Only include string values, skip internal fields, and skip SELECT_ALL_VALUE wildcards
        return typeof value === 'string' &&
               !field.startsWith('_') &&
               value !== SELECT_ALL_VALUE;
      })
      .map(([field, value]) => {
        const quotedField = /[^a-zA-Z0-9_]/.test(field) ? `"${field}"` : field;
        const escapedValue = value.replace(/'/g, "''");
        return `${quotedField} = '${escapedValue}'`;
      })
      .join(" AND ");

    const whereClause = whereConditions ? `WHERE ${whereConditions}` : "";

    const query = `SELECT * FROM "${streamName}" ${whereClause} ORDER BY _timestamp DESC LIMIT 100`;

    const panel = {
      id: "logs_table_panel",
      type: "table",
      title: `Logs - ${streamName}`,
      description: `Correlated logs for service ${config.serviceName}`,
      config: {
        wrap_table_cells: false,
        table_dynamic_columns: true,
        show_legends: false,
        legends_position: "bottom",
        unit: "short",
        unit_custom: "",
        axis_border_show: true,
        connect_nulls: true,
        no_value_replacement: "",
        table_transpose: false,
      },
      queryType: "sql",
      queries: [
        {
          query: query,
          vrlFunctionQuery: "",
          customQuery: true,
          fields: {
            stream: streamName,
            stream_type: "logs",
            x: [
              {
                label: "",
                alias: "x_axis_1",
                column: "x_axis_1",
                color: null,
                isDerived: false,
                havingConditions: [],
              },
            ],
            y: [],
            z: [],
            breakdown: [],
            filter: {
              filterType: "group",
              logicalOperator: "AND",
              conditions: [],
            },
          },
          config: {
            limit: 150,
            promql_legend: "",
            layer_type: "",
            weight_fixed: 1,
            min: 0,
            max: 100,
            time_shift: [],
          },
        },
      ],
      layout: {
        x: 0,
        y: 0,
        w: 192,
        h: 44,
        i: 1,
      },
      htmlContent: "",
      markdownContent: "",
      customChartContent: "",
    };

    const dashboard = {
      version: 5,
      dashboardId: ``,
      title: `Correlated Streams - ${config.serviceName}`,
      description: `Logs correlated with service ${config.serviceName}`,
      role: "",
      owner: "",
      created: new Date().toISOString(),
      variables: {
        list: [],
        showDynamicFilters: false,
      },
      tabs: [
        {
          tabId: "logs",
          name: "Logs",
          panels: [panel],
        },
      ],
      defaultDatetimeDuration: {
        type: "relative",
        relativeTimePeriod: "15m",
        startTime: config.timeRange.startTime,
        endTime: config.timeRange.endTime,
      },
    };

    return dashboard;
  };

  return {
    generateDashboard,
    generateLogsDashboard,
  };
}
