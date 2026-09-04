// Copyright 2026 OpenObserve Inc.
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

import type { StreamInfo, FieldAlias } from "@/services/service_streams";
import type { TranslateFn } from "@/types/i18n";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import {
  buildFieldToGroupIdMap,
  buildSqlCondition,
  mergeSubjectOverrides,
} from "@/utils/telemetryCorrelation";

export interface MetricsCorrelationConfig {
  serviceName: string;
  matchedDimensions: Record<string, string>;
  metricStreams: StreamInfo[];
  logStreams?: StreamInfo[];
  traceStreams?: StreamInfo[];
  orgIdentifier: string;
  timeRange: {
    startTime: number; // Timestamp in microseconds (16 digits)
    endTime: number; // Timestamp in microseconds (16 digits)
  };
  sourceStream?: string; // Original stream being viewed
  sourceType?: string; // Type of source stream
  availableDimensions?: Record<string, string>; // Actual field names (for source stream queries)
  metricSchemas?: Record<string, any>; // Cached metric schemas with metrics_meta
  semanticGroups?: FieldAlias[]; // For resolving semantic IDs to raw field names in subject filters
}

/**
 * Composable for generating dashboard JSON for metrics correlation
 *
 * Creates a time-series dashboard showing correlated metrics
 */
export function useMetricsCorrelationDashboard(t: TranslateFn) {
  /**
   * Generate dashboard JSON for metrics correlation
   */
  const generateDashboard = (
    streams: StreamInfo[],
    config: MetricsCorrelationConfig,
    _theme: "dark" | "light" = "dark",
    panelWidth = 64,
    panelHeight = 14,
  ) => {
    const panels = streams.map((stream, index) => {
      return createMetricPanel(stream, index, config, panelWidth, panelHeight);
    });

    // No variables in the metrics dashboard - dimensions are managed at the top level
    const dashboard = {
      version: 5,
      dashboardId: ``,
      title: t("correlation.correlatedStreamsFor", { service: config.serviceName }),
      description: t("correlation.metricsDashboardDescription", {
        service: config.serviceName,
      }),
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
    config: MetricsCorrelationConfig,
    panelWidth = 64,
    panelHeight = 16,
  ) => {
    // Get schema information for this metric stream
    const schema = config.metricSchemas?.[stream.stream_name];
    const metricsMeta = schema?.metrics_meta;
    const rawUnit = metricsMeta?.unit || "";
    const metricType = (metricsMeta?.metric_type || "").toLowerCase();

    // Map OpenTelemetry/Prometheus units to dashboard units
    const unitMapping: Record<string, string> = {
      By: "bytes",
      s: "seconds",
      ms: "milliseconds",
      us: "microseconds",
      ns: "nanoseconds",
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

    // Resolve active subject dimensions (semantic IDs like "k8s-pod-name") to raw
    // field names that exist on this specific metric stream. Walk each semantic
    // group's field aliases and pick the first one present in the stream schema.
    const subjectOverrides: Record<string, string> = {};
    const semanticGroups = config.semanticGroups ?? [];
    const streamSchema: Set<string> = new Set(
      (
        config.metricSchemas?.[stream.stream_name]?.schema as Array<{ name: string }> | undefined
      )?.map((c) => c.name) ?? [],
    );
    for (const [semanticId, value] of Object.entries(config.matchedDimensions)) {
      if (!value || value === SELECT_ALL_VALUE) continue;
      const group = semanticGroups.find((g) => g.id === semanticId);
      if (!group) continue; // not a semantic ID key — raw field names handled below
      // F31: only override when the stream schema is loaded AND contains the field.
      // Guessing a field name here produced `WHERE guessed = 'x' AND real = 'x'`
      // (nonexistent guess → "No field named …" kills the panel).
      if (streamSchema.size === 0) continue;
      const hit = group.fields.find((f) => streamSchema.has(f));
      if (hit) subjectOverrides[hit] = value;
    }

    // Build WHERE clause from stream filters merged with active subject overrides.
    // Overrides REPLACE the stream's own alias of the same semantic group (F31) —
    // a plain spread would AND two aliases of one concept together and match nothing.
    // Quote field names that contain special characters (hyphens, dots, etc.)
    // Skip filters with SELECT_ALL_VALUE (wildcard - means match all values)
    const fieldToGroupId = buildFieldToGroupIdMap(semanticGroups);
    const effectiveFilters = mergeSubjectOverrides(
      stream.filters ?? {},
      subjectOverrides,
      fieldToGroupId,
    );

    const whereConditions = Object.entries(effectiveFilters)
      .filter(([, value]) => {
        const skip = value === SELECT_ALL_VALUE;
        // if (skip) {
        //   console.log(`[useMetricsCorrelationDashboard] Skipping filter ${field}=${value} (SELECT_ALL_VALUE)`);
        // }
        return !skip;
      })
      .map(([field, value]) => {
        return buildSqlCondition(field, value);
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

    // Calculate panel position based on panel width
    const cols = Math.floor(192 / panelWidth);
    const col = index % cols;
    const row = Math.floor(index / cols);

    return {
      id: `panel_${stream.stream_name}_${index}`,
      type: "line",
      title: stream.stream_name,
      // Two complete messages rather than splicing an optional "(type)" fragment
      // into one — the clause position differs across languages.
      description: metricType
        ? t("correlation.panelTimeSeriesForWithType", {
            stream: stream.stream_name,
            type: metricType,
          })
        : t("correlation.panelTimeSeriesFor", { stream: stream.stream_name }),
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
        x: col * panelWidth,
        y: row * panelHeight,
        w: panelWidth,
        h: panelHeight,
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
    config: MetricsCorrelationConfig,
    panelWidth = 192,
    panelHeight = 44,
  ) => {
    // Determine stream and filters based on available data
    let streamName: string;
    let filters: Record<string, string>;

    if (config.sourceType === "logs" && config.sourceStream) {
      // When viewing from logs page, prefer source stream
      streamName = config.sourceStream;

      // F27: only use filters the backend resolved for THIS stream. Another
      // stream's filters use that stream's own field aliases, and
      // matchedDimensions are semantic-ID keyed — either guess yields
      // "No field named X" or a silently-wrong predicate.
      const matchingStream = streams?.find((s) => s.stream_name === config.sourceStream);
      filters = matchingStream?.filters ?? {};
    } else if (streams && streams.length > 0) {
      // Use first correlated log stream from API response
      const primaryStream = streams[0];
      streamName = primaryStream.stream_name;
      filters = primaryStream.filters ?? {};
    } else {
      // No logs available
      return null;
    }

    // Build WHERE clause from filters
    // Filter out non-string values, internal fields, and SELECT_ALL_VALUE wildcards
    const whereConditions = Object.entries(filters)
      .filter(([field, value]) => {
        // Only include string values, skip internal fields, and skip SELECT_ALL_VALUE wildcards
        return typeof value === "string" && !field.startsWith("_") && value !== SELECT_ALL_VALUE;
      })
      .map(([field, value]) => {
        return buildSqlCondition(field, value);
      })
      .join(" AND ");

    const whereClause = whereConditions ? `WHERE ${whereConditions}` : "";

    const query = `SELECT * FROM "${streamName}" ${whereClause} ORDER BY _timestamp DESC LIMIT 100`;

    const panel = {
      id: "logs_table_panel",
      type: "table",
      title: t("correlation.logsPanelTitle", { stream: streamName }),
      description: t("correlation.logsPanelDescription", { service: config.serviceName }),
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
        w: panelWidth,
        h: panelHeight,
        i: 1,
      },
      htmlContent: "",
      markdownContent: "",
      customChartContent: "",
    };

    const dashboard = {
      version: 5,
      dashboardId: ``,
      title: t("correlation.correlatedStreamsFor", { service: config.serviceName }),
      description: t("correlation.logsDashboardDescription", { service: config.serviceName }),
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
