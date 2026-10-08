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

import type { TranslateFn } from "@/types/i18n";
import type { DimensionAnalysis, LatencyInsightsConfig } from "./useLatencyInsightsAnalysis";

/** Colors shared between the dashboard chart series and the UI chips */
export const COMPARISON_COLORS = {
  light: { baseline: "#2775ea", selected: "#12adc2" },
  dark: { baseline: "#2c7de0", selected: "#1cb8d0" },
} as const;

/**
 * Composable for generating dashboard JSON for Latency Insights
 * Transforms DimensionAnalysis results into OpenObserve dashboard schema
 */
export function useLatencyInsightsDashboard(t: TranslateFn) {
  /**
   * Build comparison query using UNION to combine baseline and selected results
   * Supports both latency analysis (duration-based) and volume analysis (rate-based)
   */
  const buildComparisonQuery = (dimensionName: string, config: LatencyInsightsConfig) => {
    const baseFilters = config.baseFilter?.trim().length ? config.baseFilter.trim() : "";

    // Check if baseFilter is a custom SQL query (starts with SELECT)
    const isCustomSQL = baseFilters.trim().toUpperCase().startsWith("SELECT");
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
          return sql.replace(
            timestampPattern,
            `_timestamp >= ${startTime} AND _timestamp <= ${endTime}`,
          );
        }

        // No timestamp filter found, need to inject it
        // Check if SQL has a WHERE clause
        const wherePattern = /\bWHERE\b/i;
        if (wherePattern.test(sql)) {
          // Has WHERE clause, add timestamp filter with AND
          return sql.replace(
            wherePattern,
            `WHERE _timestamp >= ${startTime} AND _timestamp <= ${endTime} AND`,
          );
        } else {
          // No WHERE clause, need to add one before GROUP BY, ORDER BY, or LIMIT
          // Find the position to insert WHERE clause
          const insertBeforePattern = /\b(GROUP\s+BY|ORDER\s+BY|LIMIT)\b/i;
          const match = sql.match(insertBeforePattern);

          if (match) {
            // Insert WHERE before GROUP BY/ORDER BY/LIMIT
            const insertPos = match.index!;
            return (
              sql.slice(0, insertPos) +
              `WHERE _timestamp >= ${startTime} AND _timestamp <= ${endTime} ` +
              sql.slice(insertPos)
            );
          } else {
            // No GROUP BY/ORDER BY/LIMIT, add WHERE at the end
            return sql.trim() + ` WHERE _timestamp >= ${startTime} AND _timestamp <= ${endTime}`;
          }
        }
      };

      // Calculate durations for normalization
      const baselineDurationSeconds =
        (config.baselineTimeRange.endTime - config.baselineTimeRange.startTime) / 1000000;
      const selectedDurationSeconds =
        (config.selectedTimeRange.endTime - config.selectedTimeRange.startTime) / 1000000;

      // Create baseline query with baseline time range
      const baselineSQL = addOrReplaceTimestampFilter(
        baseFilters,
        config.baselineTimeRange.startTime,
        config.baselineTimeRange.endTime,
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
        config.selectedTimeRange.endTime,
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
    const baselineFiltersArray = [baselineTimeFilter, baseFilters].filter((f) => f);
    const baselineWhere = baselineFiltersArray.length
      ? `WHERE ${baselineFiltersArray.join(" AND ")}`
      : "";

    // Build selected WHERE clause with appropriate filter
    let filterClause = "";
    if (isVolumeAnalysis && config.rateFilter) {
      // For volume analysis: rate filter defines time period selection, not individual trace filtering
      // No additional WHERE clause needed - we compare ALL traces in selected vs baseline periods
      filterClause = "";
    }

    const selectedFiltersArray = [selectedTimeFilter, filterClause, baseFilters].filter((f) => f);
    const selectedWhere = selectedFiltersArray.length
      ? `WHERE ${selectedFiltersArray.join(" AND ")}`
      : "";

    // Volume Analysis: Normalize both baseline and selected to the selected time window
    // This shows: "If baseline was compressed to spike duration, how many records would it have?"
    // Makes comparison intuitive: spike shows MORE records in same time window

    // Calculate durations in seconds
    const baselineDurationSeconds =
      (config.baselineTimeRange.endTime - config.baselineTimeRange.startTime) / 1000000;
    const selectedDurationSeconds =
      (config.selectedTimeRange.endTime - config.selectedTimeRange.startTime) / 1000000;

    const countExpression = "count(_timestamp)";

    // A brush narrows the selected range; the same range means no comparison.
    const useBaselineOnly =
      config.baselineTimeRange.startTime === config.selectedTimeRange.startTime &&
      config.baselineTimeRange.endTime === config.selectedTimeRange.endTime;

    if (useBaselineOnly) {
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
  };

  /**
   * Generate dashboard JSON from Latency Insights analysis results
   */
  const generateDashboard = (
    analyses: DimensionAnalysis[],
    config: LatencyInsightsConfig,
    theme: "dark" | "light" = "dark",
  ) => {
    // Comparison mode (baseline vs selected) needs a brush that narrows the range.
    const hasTimeBasedFilter =
      config.rateFilter?.timeStart !== undefined && config.rateFilter?.timeEnd !== undefined;
    const isSameTimeRange =
      config.streamType &&
      config.baselineTimeRange.startTime === config.selectedTimeRange.startTime &&
      config.baselineTimeRange.endTime === config.selectedTimeRange.endTime;
    const isComparisonMode = hasTimeBasedFilter && !isSameTimeRange;

    const panels = analyses.map((analysis, index) => {
      // Build panel description based on analysis type
      // Panel descriptions surface in the panel info tooltip (PanelContainer
      // renders them because this dashboard is mounted with viewOnly=false).
      const description = isComparisonMode
        ? t("latencyInsights.panelDescVolumeComparison", { dimension: analysis.dimensionName })
        : t("latencyInsights.panelDescVolumeTopValues", { dimension: analysis.dimensionName });

      // Generate SQL query for this dimension
      const sqlQuery = buildComparisonQuery(analysis.dimensionName, config);

      const panelPrefix = "VolumeInsights";
      const unit = config.streamType === "logs" ? "numbers" : "traces";
      const decimals = 0;

      // Generate unique panel ID using dimension name to ensure stability
      const dimensionHash = analysis.dimensionName.replace(/[^a-zA-Z0-9]/g, "_");

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
          color: isComparisonMode
            ? {
                mode: "palette-classic-by-series",
                seriesBy: "last",
                colorBySeries: [
                  {
                    value: "Baseline",
                    color: COMPARISON_COLORS[theme].baseline,
                  },
                  {
                    value: "Selected",
                    color: COMPARISON_COLORS[theme].selected,
                  },
                ],
              }
            : {
                mode: "shades",
                fixedColor: [COMPARISON_COLORS[theme].baseline],
                seriesBy: "last",
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
                  alias: "trace_count",
                  column: "trace_count",
                  color: null,
                  isDerived: false,
                  havingConditions: [],
                  treatAsNonTimestamp: true,
                },
              ],
              z: [],
              breakdown: isComparisonMode
                ? [
                    {
                      label: "",
                      alias: "series",
                      column: "series",
                      color: null,
                      isDerived: false,
                      havingConditions: [],
                      treatAsNonTimestamp: true,
                    },
                  ]
                : [],
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

    const title = t("latencyInsights.dashboardTitleVolume");
    // Two whole sentences rather than one with an optional clause spliced in.
    const description = config.rateFilter
      ? t("latencyInsights.dashboardDescVolumeRate", {
          start: config.rateFilter.start,
          end: config.rateFilter.end,
        })
      : t("latencyInsights.dashboardDescVolume");

    const variables = { list: [], showDynamicFilters: false };

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
