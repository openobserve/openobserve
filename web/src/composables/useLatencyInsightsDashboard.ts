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

import type { DimensionAnalysis, LatencyInsightsConfig } from "./useLatencyInsightsAnalysis";

/**
 * Composable for generating dashboard JSON for Latency Insights
 * Transforms DimensionAnalysis results into OpenObserve dashboard schema
 */
export function useLatencyInsightsDashboard() {
  /**
   * Build comparison query using UNION to combine baseline and selected results
   * Supports both latency analysis (duration-based) and volume analysis (rate-based)
   */
  const buildComparisonQuery = (
    dimensionName: string,
    config: LatencyInsightsConfig
  ) => {
    const baseFilters = config.baseFilter?.trim().length
      ? config.baseFilter.trim()
      : "";
    const isVolumeAnalysis = config.analysisType === "volume";

    // Build time filters for baseline and selected periods
    const baselineTimeFilter = `_timestamp >= ${config.baselineTimeRange.startTime} AND _timestamp <= ${config.baselineTimeRange.endTime}`;
    const selectedTimeFilter = `_timestamp >= ${config.selectedTimeRange.startTime} AND _timestamp <= ${config.selectedTimeRange.endTime}`;

    // Build baseline WHERE clause with time filtering
    const baselineFiltersArray = [baselineTimeFilter, baseFilters].filter(f => f);
    const baselineWhere = baselineFiltersArray.length ? `WHERE ${baselineFiltersArray.join(' AND ')}` : "";

    // Build selected WHERE clause with appropriate filter
    let filterClause = "";
    if (isVolumeAnalysis && config.rateFilter) {
      // For volume analysis: rate filter defines time period selection, not individual trace filtering
      // No additional WHERE clause needed - we compare ALL traces in selected vs baseline periods
      filterClause = "";
    } else if (config.durationFilter) {
      // For latency analysis: filter by duration
      filterClause = `duration >= ${config.durationFilter.start} AND duration <= ${config.durationFilter.end}`;
    }

    const selectedFiltersArray = [selectedTimeFilter, filterClause, baseFilters].filter(f => f);
    const selectedWhere = selectedFiltersArray.length ? `WHERE ${selectedFiltersArray.join(' AND ')}` : "";

    if (isVolumeAnalysis) {
      // Volume Analysis: Normalize both baseline and selected to the selected time window
      // This shows: "If baseline was compressed to spike duration, how many records would it have?"
      // Makes comparison intuitive: spike shows MORE records in same time window

      // Calculate durations in seconds
      const baselineDurationSeconds = (config.baselineTimeRange.endTime - config.baselineTimeRange.startTime) / 1000000;
      const selectedDurationSeconds = (config.selectedTimeRange.endTime - config.selectedTimeRange.startTime) / 1000000;

      // Use count(_timestamp) for logs, approx_distinct(trace_id) for traces
      const countExpression = config.streamType === "traces"
        ? "approx_distinct(trace_id)"
        : "count(_timestamp)";

      // Normalize baseline to selected time window: (records/baseline_duration) * selected_duration
      const baselineQuery = `
        SELECT
          COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
          'Baseline' AS series,
          (${countExpression} * ${selectedDurationSeconds}) / ${baselineDurationSeconds} AS trace_count
        FROM "${config.streamName}"
        ${baselineWhere}
        GROUP BY ${dimensionName}
      `.trim();

      // Selected uses actual count (already in the selected time window)
      const selectedQuery = `
        SELECT
          COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
          'Selected' AS series,
          ${countExpression} AS trace_count
        FROM "${config.streamName}"
        ${selectedWhere}
        GROUP BY ${dimensionName}
      `.trim();

      const unionQuery = `${baselineQuery} UNION ${selectedQuery} ORDER BY trace_count DESC LIMIT 5`;

      console.log(`[Query Generation] Volume analysis query for dimension "${dimensionName}":`, {
        baselineTimeRange: {
          start: new Date(config.baselineTimeRange.startTime / 1000).toISOString(),
          end: new Date(config.baselineTimeRange.endTime / 1000).toISOString(),
          startMicros: config.baselineTimeRange.startTime,
          endMicros: config.baselineTimeRange.endTime,
          durationSeconds: baselineDurationSeconds,
        },
        selectedTimeRange: {
          start: new Date(config.selectedTimeRange.startTime / 1000).toISOString(),
          end: new Date(config.selectedTimeRange.endTime / 1000).toISOString(),
          startMicros: config.selectedTimeRange.startTime,
          endMicros: config.selectedTimeRange.endTime,
          durationSeconds: selectedDurationSeconds,
        },
        normalization: `Baseline normalized: count * ${selectedDurationSeconds} / ${baselineDurationSeconds}`,
        rateFilter: config.rateFilter,
        baselineWhere,
        selectedWhere,
        baselineQuery,
        selectedQuery,
        unionQuery
      });

      return unionQuery;
    } else if (config.analysisType === "error") {
      // Error Analysis: Compare error percentages by dimension
      // Error % = (error_traces / total_traces) * 100
      const baselineQuery = `
        SELECT
          COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
          'Baseline' AS series,
          (approx_distinct(trace_id) FILTER (WHERE span_status = 'ERROR') * 100.0) /
          NULLIF(approx_distinct(trace_id), 0) AS error_percentage
        FROM "${config.streamName}"
        ${baselineWhere}
        GROUP BY ${dimensionName}
      `.trim();

      const selectedQuery = `
        SELECT
          COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
          'Selected' AS series,
          (approx_distinct(trace_id) FILTER (WHERE span_status = 'ERROR') * 100.0) /
          NULLIF(approx_distinct(trace_id), 0) AS error_percentage
        FROM "${config.streamName}"
        ${selectedWhere}
        GROUP BY ${dimensionName}
      `.trim();

      const unionQuery = `${baselineQuery} UNION ${selectedQuery} ORDER BY error_percentage DESC LIMIT 5`;

      console.log(`[Query Generation] Error analysis query for dimension "${dimensionName}":`, {
        baselineTimeRange: {
          start: new Date(config.baselineTimeRange.startTime / 1000).toISOString(),
          end: new Date(config.baselineTimeRange.endTime / 1000).toISOString(),
        },
        selectedTimeRange: {
          start: new Date(config.selectedTimeRange.startTime / 1000).toISOString(),
          end: new Date(config.selectedTimeRange.endTime / 1000).toISOString(),
        },
        baselineWhere,
        selectedWhere,
        baselineQuery,
        selectedQuery,
        unionQuery
      });

      return unionQuery;
    } else {
      // Latency Analysis: Compare percentile latencies by dimension
      const baselineQuery = `
        SELECT
          COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
          'Baseline' AS series,
          approx_percentile_cont(duration, \${percentile}) AS percentile_latency
        FROM "${config.streamName}"
        ${baselineWhere}
        GROUP BY ${dimensionName}
      `.trim();

      const selectedQuery = `
        SELECT
          COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
          'Selected' AS series,
          approx_percentile_cont(duration, \${percentile}) AS percentile_latency
        FROM "${config.streamName}"
        ${selectedWhere}
        GROUP BY ${dimensionName}
      `.trim();

      return `${baselineQuery} UNION ${selectedQuery} ORDER BY percentile_latency DESC LIMIT 5`;
    }
  };

  /**
   * Generate dashboard JSON from Latency Insights analysis results
   */
  const generateDashboard = (
    analyses: DimensionAnalysis[],
    config: LatencyInsightsConfig
  ) => {
    const isVolumeAnalysis = config.analysisType === "volume";
    const isErrorAnalysis = config.analysisType === "error";
    const panels = analyses.map((analysis, index) => {
      // Build panel description based on analysis type
      let description = "";
      if (isVolumeAnalysis) {
        description = `Trace count comparison for dimension: ${analysis.dimensionName}. Higher Selected bars indicate this dimension value appears more frequently in high-volume periods.`;
      } else if (isErrorAnalysis) {
        description = `Error percentage comparison for dimension: ${analysis.dimensionName}. Higher Selected bars indicate this dimension value has more errors in the error spike period.`;
      } else {
        description = `Percentile latency comparison for dimension: ${analysis.dimensionName}. Higher Selected bars indicate this dimension value correlates with slower traces.`;
      }

      // Generate SQL query for this dimension
      const sqlQuery = buildComparisonQuery(analysis.dimensionName, config);

      // Determine panel ID prefix
      let panelPrefix = "LatencyInsights";
      if (isVolumeAnalysis) panelPrefix = "VolumeInsights";
      if (isErrorAnalysis) panelPrefix = "ErrorInsights";

      // Determine unit and decimals
      let unit = "microseconds";
      let decimals = 2;
      if (isVolumeAnalysis) {
        unit = "traces";
        decimals = 0;
      } else if (isErrorAnalysis) {
        unit = "percent";
        decimals = 2;
      }

      return {
        id: `Panel_${panelPrefix}_${index}`,
        type: "bar",
        title: analysis.dimensionName,
        description,
        config: {
          show_legends: true,
          legends_position: "bottom",
          unit,
          decimals,
          axis_border_show: true,
          label_option: {
            rotate: 45,
          },
          color: {
            mode: "custom",
            fixedColor: ["#1976d2", "#ffc107"],
            seriesBy: "last",
            colorBySeries: [
              { name: "Baseline", color: "#1976d2" },
              { name: "Selected", color: "#ffc107" },
            ],
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
            query: sqlQuery,
            vrlFunctionQuery: "",
            customQuery: true,
            fields: {
              stream: config.streamName,
              stream_type: config.streamType,
              x: [
                {
                  label: "",
                  alias: "value",
                  column: "value",
                  color: null,
                  isDerived: false,
                  havingConditions: [],
                  treatAsNonTimestamp: true,
                },
              ],
              y: [
                {
                  label: "",
                  alias: isVolumeAnalysis ? "trace_count" : (isErrorAnalysis ? "error_percentage" : "percentile_latency"),
                  column: isVolumeAnalysis ? "trace_count" : (isErrorAnalysis ? "error_percentage" : "percentile_latency"),
                  color: null,
                  isDerived: false,
                  havingConditions: [],
                  treatAsNonTimestamp: true,
                },
              ],
              z: [],
              breakdown: [
                {
                  label: "",
                  alias: "series",
                  column: "series",
                  color: null,
                  isDerived: false,
                  havingConditions: [],
                  treatAsNonTimestamp: true,
                },
              ],
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
          x: (index % 3) * 64, // 3 columns: 0, 64, 128
          y: Math.floor(index / 3) * 16, // Row position
          w: 64, // Width (192/3 = 64 columns per panel)
          h: 16, // Height in rows
          i: index,
        },
        htmlContent: "",
        markdownContent: "",
        customChartContent: "",
      };
    });

    let title = "Latency Insights";
    if (isVolumeAnalysis) title = "Volume Insights";
    if (isErrorAnalysis) title = "Error Insights";

    let description = "";
    if (isVolumeAnalysis) {
      description = `Comparing trace count distribution ${config.rateFilter ? `of selected periods (rate ${config.rateFilter.start}-${config.rateFilter.end} traces)` : ''} vs baseline across dimensions`;
    } else if (isErrorAnalysis) {
      description = `Comparing error percentage of traces during error spike period vs baseline across dimensions`;
    } else {
      description = `Comparing percentile latency of selected traces (duration ${config.durationFilter?.start}-${config.durationFilter?.end}µs) vs baseline across dimensions`;
    }

    // Only include percentile variable for latency analysis
    const variables = (isVolumeAnalysis || isErrorAnalysis)
      ? { list: [], showDynamicFilters: false }
      : {
          list: [
            {
              type: "custom",
              name: "percentile",
              label: "Latency Percentile",
              value: "0.95",
              multiSelect: false,
              options: [
                { label: "P50 (Median)", value: "0.50", selected: false },
                { label: "P75", value: "0.75", selected: false },
                { label: "P95", value: "0.95", selected: true },
                { label: "P99", value: "0.99", selected: false },
              ],
            },
          ],
          showDynamicFilters: false,
        };

    return {
      version: 5,
      dashboardId: ``,
      title,
      description,
      role: "",
      owner: "",
      created: new Date().toISOString(),
      tabs: [
        {
          tabId: "default",
          name: "Analysis",
          panels,
        },
      ],
      variables,
      defaultDatetimeDuration: {
        type: "relative",
        relativeTimePeriod: "15m",
        startTime: config.selectedTimeRange.startTime,
        endTime: config.selectedTimeRange.endTime,
      },
    };
  };

  return {
    generateDashboard,
  };
}
