// Copyright 2025 OpenObserve Inc.
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

    // Check if baseFilter is a custom SQL query (starts with SELECT)
    const isCustomSQL = baseFilters.trim().toUpperCase().startsWith('SELECT');
    const isVolumeAnalysis = config.analysisType === "volume";

    // For custom SQL queries, wrap them in a subquery and GROUP BY the dimension
    if (isCustomSQL && isVolumeAnalysis) {
      // Check if we need comparison mode (different time ranges = brush selection)
      const isSameTimeRange =
        config.baselineTimeRange.startTime === config.selectedTimeRange.startTime &&
        config.baselineTimeRange.endTime === config.selectedTimeRange.endTime;

      // If same time range, show single query (no comparison)
      if (isSameTimeRange) {
        return `
          SELECT
            COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
            COUNT(*) AS trace_count
          FROM (
            ${baseFilters}
          ) AS user_query
          GROUP BY ${dimensionName}
          ORDER BY trace_count DESC
          LIMIT 5
        `.trim();
      }

      // Different time ranges: Baseline vs Selected comparison
      // We need to replace or inject the time range in the user's SQL query for baseline and selected

      // Function to add or replace timestamp filters in SQL query
      const addOrReplaceTimestampFilter = (sql: string, startTime: number, endTime: number) => {
        // Pattern to match _timestamp conditions in WHERE clause
        const timestampPattern = /_timestamp\s*>=\s*\d+\s*AND\s*_timestamp\s*<=\s*\d+/gi;

        // Check if SQL already has timestamp filter
        if (timestampPattern.test(sql)) {
          // Replace existing timestamp filter
          return sql.replace(timestampPattern, `_timestamp >= ${startTime} AND _timestamp <= ${endTime}`);
        }

        // No timestamp filter found, need to inject it
        // Check if SQL has a WHERE clause
        const wherePattern = /\bWHERE\b/i;
        if (wherePattern.test(sql)) {
          // Has WHERE clause, add timestamp filter with AND
          return sql.replace(wherePattern, `WHERE _timestamp >= ${startTime} AND _timestamp <= ${endTime} AND`);
        } else {
          // No WHERE clause, need to add one before GROUP BY, ORDER BY, or LIMIT
          // Find the position to insert WHERE clause
          const insertBeforePattern = /\b(GROUP\s+BY|ORDER\s+BY|LIMIT)\b/i;
          const match = sql.match(insertBeforePattern);

          if (match) {
            // Insert WHERE before GROUP BY/ORDER BY/LIMIT
            const insertPos = match.index!;
            return sql.slice(0, insertPos) + `WHERE _timestamp >= ${startTime} AND _timestamp <= ${endTime} ` + sql.slice(insertPos);
          } else {
            // No GROUP BY/ORDER BY/LIMIT, add WHERE at the end
            return sql.trim() + ` WHERE _timestamp >= ${startTime} AND _timestamp <= ${endTime}`;
          }
        }
      };

      // Calculate durations for normalization
      const baselineDurationSeconds = (config.baselineTimeRange.endTime - config.baselineTimeRange.startTime) / 1000000;
      const selectedDurationSeconds = (config.selectedTimeRange.endTime - config.selectedTimeRange.startTime) / 1000000;

      // Create baseline query with baseline time range
      const baselineSQL = addOrReplaceTimestampFilter(
        baseFilters,
        config.baselineTimeRange.startTime,
        config.baselineTimeRange.endTime
      );

      // For custom SQL, the user's query might already have aggregations
      // We need to sum those up when grouping by the dimension
      // Try to detect if there's a count column (common patterns: count, cnt, a, total, etc.)
      // For simplicity, we'll just count rows which works for most cases
      const baselineQuery = `
        SELECT
          COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
          'Baseline' AS series,
          (SUM(CASE WHEN a IS NOT NULL THEN a ELSE 1 END) * ${selectedDurationSeconds}) / ${baselineDurationSeconds} AS trace_count
        FROM (
          ${baselineSQL}
        ) AS baseline_query
        GROUP BY ${dimensionName}
      `.trim();

      // Create selected query with selected time range
      const selectedSQL = addOrReplaceTimestampFilter(
        baseFilters,
        config.selectedTimeRange.startTime,
        config.selectedTimeRange.endTime
      );

      const selectedQuery = `
        SELECT
          COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
          'Selected' AS series,
          SUM(CASE WHEN a IS NOT NULL THEN a ELSE 1 END) AS trace_count
        FROM (
          ${selectedSQL}
        ) AS selected_query
        GROUP BY ${dimensionName}
      `.trim();

      // Combine with UNION
      return `${baselineQuery} UNION ${selectedQuery} ORDER BY trace_count DESC LIMIT 5`;
    }

    // Normal mode: Build queries with WHERE clauses
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

      // For logs only: check if we should use single query or comparison query
      // Traces ALWAYS use comparison (UNION) query regardless of time range
      const isSameTimeRange =
        config.streamType === "logs" &&
        config.baselineTimeRange.startTime === config.selectedTimeRange.startTime &&
        config.baselineTimeRange.endTime === config.selectedTimeRange.endTime;


      // If time ranges are the same AND it's logs (no brush selection), show single query instead of comparison
      if (isSameTimeRange) {
        const singleQuery = `
          SELECT
            COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
            ${countExpression} AS trace_count
          FROM "${config.streamName}"
          ${selectedWhere}
          GROUP BY ${dimensionName}
          ORDER BY trace_count DESC
          LIMIT 5
        `.trim();

  

        return singleQuery;
      }

      // Different time ranges: use comparison query with baseline vs selected
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

    // Check if we're using comparison mode (baseline vs selected) or single query mode
    // Traces ALWAYS use comparison mode
    // Logs use comparison mode only when time ranges differ (brush selection made)
    const isSameTimeRange =
      config.streamType === "logs" &&
      config.baselineTimeRange.startTime === config.selectedTimeRange.startTime &&
      config.baselineTimeRange.endTime === config.selectedTimeRange.endTime;
    const isComparisonMode = !isSameTimeRange;

 
    const panels = analyses.map((analysis, index) => {
      // Build panel description based on analysis type
      let description = "";
      if (isVolumeAnalysis) {
        if (isComparisonMode) {
          description = `Trace count comparison for dimension: ${analysis.dimensionName}. Higher Selected bars indicate this dimension value appears more frequently in high-volume periods.`;
        } else {
          description = `Top values by count for dimension: ${analysis.dimensionName}.`;
        }
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

      if (config.streamType === "logs") {
        unit = "numbers";
      } else if (isVolumeAnalysis) {
        unit = "traces";
      } else if (isErrorAnalysis) {
        unit = "percent";
      }

      if (isVolumeAnalysis) {
        decimals = 0;
      } else if (isErrorAnalysis) {
        decimals = 2;
      }

      // Generate unique panel ID using dimension name to ensure stability
      const dimensionHash = analysis.dimensionName.replace(/[^a-zA-Z0-9]/g, '_');

      return {
        id: `Panel_${panelPrefix}_${dimensionHash}_${index}`,
        type: "bar",
        title: analysis.dimensionName,
        description,
        config: {
          show_legends: isComparisonMode,
          legends_position: isComparisonMode ? "bottom" : null,
          unit,
          decimals,
          axis_border_show: true,
          label_option: {
            rotate: 45,
          },
          axis_label_rotate: 30,
          axis_label_truncate_width: 80,
          color: isComparisonMode ? {
            mode: "palette-classic-by-series",
            fixedColor: ["#ffc107", "#1976d2"],
            seriesBy: "last",
            colorBySeries: [
              { name: "Selected", color: "#ffc107" },
              { name: "Baseline", color: "#1976d2" },
            ],
          } : {
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
              breakdown: isComparisonMode ? [
                {
                  label: "",
                  alias: "series",
                  column: "series",
                  color: null,
                  isDerived: false,
                  havingConditions: [],
                  treatAsNonTimestamp: true,
                },
              ] : [],
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
          i: `${panelPrefix}_${dimensionHash}_${index}`,
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
    const percentileValue = config.percentile || "0.95";
    const variables = (isVolumeAnalysis || isErrorAnalysis)
      ? { list: [], showDynamicFilters: false }
      : {
          list: [
            {
              type: "custom",
              name: "percentile",
              label: "Latency Percentile",
              value: percentileValue,
              multiSelect: false,
              isLoading: false,
              isVariableLoading: false,
              options: [
                { label: "P50 (Median)", value: "0.50", selected: percentileValue === "0.50" },
                { label: "P75", value: "0.75", selected: percentileValue === "0.75" },
                { label: "P95", value: "0.95", selected: percentileValue === "0.95" },
                { label: "P99", value: "0.99", selected: percentileValue === "0.99" },
              ],
            },
          ],
          showDynamicFilters: false,
        };

    const dashboard = {
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

    return dashboard;
  };

  return {
    generateDashboard,
  };
}
