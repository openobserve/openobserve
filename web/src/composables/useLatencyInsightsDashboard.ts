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

    // Build baseline WHERE clause
    const baselineWhere = baseFilters ? `WHERE ${baseFilters}` : "";

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

    const selectedFilters = baseFilters && filterClause
      ? `${filterClause} AND ${baseFilters}`
      : (filterClause || baseFilters);
    const selectedWhere = selectedFilters ? `WHERE ${selectedFilters}` : "";

    if (isVolumeAnalysis) {
      // Volume Analysis: Compare trace counts by dimension
      const baselineQuery = `
        SELECT
          COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
          'Baseline' AS series,
          COUNT(*) AS trace_count
        FROM "${config.streamName}"
        ${baselineWhere}
        GROUP BY ${dimensionName}
      `.trim();

      const selectedQuery = `
        SELECT
          COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
          'Selected' AS series,
          COUNT(*) AS trace_count
        FROM "${config.streamName}"
        ${selectedWhere}
        GROUP BY ${dimensionName}
      `.trim();

      return `${baselineQuery} UNION ${selectedQuery} ORDER BY trace_count DESC LIMIT 40`;
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

      return `${baselineQuery} UNION ${selectedQuery} ORDER BY percentile_latency DESC LIMIT 40`;
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
    const panels = analyses.map((analysis, index) => {
      // Build panel description based on analysis type
      const description = isVolumeAnalysis
        ? `Trace count comparison for dimension: ${analysis.dimensionName}. Higher Selected bars indicate this dimension value appears more frequently in high-volume periods.`
        : `Percentile latency comparison for dimension: ${analysis.dimensionName}. Higher Selected bars indicate this dimension value correlates with slower traces.`;

      // Generate SQL query for this dimension
      const sqlQuery = buildComparisonQuery(analysis.dimensionName, config);

      return {
        id: `Panel_${isVolumeAnalysis ? 'VolumeInsights' : 'LatencyInsights'}_${index}`,
        type: "bar",
        title: analysis.dimensionName,
        description,
        config: {
          show_legends: true,
          legends_position: "bottom",
          unit: isVolumeAnalysis ? "traces" : "microseconds",
          decimals: isVolumeAnalysis ? 0 : 2,
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
                  alias: isVolumeAnalysis ? "trace_count" : "percentile_latency",
                  column: isVolumeAnalysis ? "trace_count" : "percentile_latency",
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

    const title = isVolumeAnalysis ? "Volume Insights" : "Latency Insights";
    const description = isVolumeAnalysis
      ? `Comparing trace count distribution ${config.rateFilter ? `of selected periods (rate ${config.rateFilter.start}-${config.rateFilter.end} traces)` : ''} vs baseline across dimensions`
      : `Comparing percentile latency of selected traces (duration ${config.durationFilter?.start}-${config.durationFilter?.end}µs) vs baseline across dimensions`;

    // Only include percentile variable for latency analysis
    const variables = isVolumeAnalysis
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
