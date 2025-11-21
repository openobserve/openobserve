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
   */
  const buildComparisonQuery = (
    dimensionName: string,
    config: LatencyInsightsConfig
  ) => {
    const baseFilters = config.baseFilter?.trim().length
      ? config.baseFilter.trim()
      : "";

    // Build baseline WHERE clause (WITHOUT duration filter)
    const baselineWhere = baseFilters ? `WHERE ${baseFilters}` : "";

    // Build selected WHERE clause (WITH duration filter)
    const durationFilter = `duration >= ${config.durationFilter.start} AND duration <= ${config.durationFilter.end}`;
    const selectedFilters = baseFilters
      ? `${durationFilter} AND ${baseFilters}`
      : durationFilter;
    const selectedWhere = `WHERE ${selectedFilters}`;

    // Baseline query (without ORDER BY/LIMIT)
    // Uses dashboard variable ${percentile} for percentile calculation
    const baselineQuery = `
      SELECT
        COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
        'Baseline' AS series,
        approx_percentile_cont(duration, \${percentile}) AS percentile_latency
      FROM "${config.streamName}"
      ${baselineWhere}
      GROUP BY ${dimensionName}
    `.trim();

    // Selected query (without ORDER BY/LIMIT)
    // Uses dashboard variable ${percentile} for percentile calculation
    const selectedQuery = `
      SELECT
        COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)') AS value,
        'Selected' AS series,
        approx_percentile_cont(duration, \${percentile}) AS percentile_latency
      FROM "${config.streamName}"
      ${selectedWhere}
      GROUP BY ${dimensionName}
    `.trim();

    // Combine with UNION and apply ORDER BY/LIMIT at the end
    return `${baselineQuery} UNION ${selectedQuery} ORDER BY percentile_latency DESC LIMIT 40`;
  };

  /**
   * Generate dashboard JSON from Latency Insights analysis results
   */
  const generateDashboard = (
    analyses: DimensionAnalysis[],
    config: LatencyInsightsConfig
  ) => {
    const panels = analyses.map((analysis, index) => {
      // Build panel description with metadata (simplified to avoid pre-computation)
      const description = `Percentile latency comparison for dimension: ${analysis.dimensionName}`;

      // Generate SQL query for this dimension
      const sqlQuery = buildComparisonQuery(analysis.dimensionName, config);

      return {
        id: `Panel_LatencyInsights_${index}`,
        type: "bar",
        title: analysis.dimensionName,
        description,
        config: {
          show_legends: true,
          legends_position: "bottom",
          unit: "microseconds",
          decimals: 2,
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
                  alias: "percentile_latency",
                  column: "percentile_latency",
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

    return {
      version: 5,
      dashboardId: ``,
      title: "Latency Insights",
      description: `Comparing percentile latency of selected traces (duration ${config.durationFilter.start}-${config.durationFilter.end}µs) vs baseline across dimensions`,
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
      variables: {
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
      },
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
