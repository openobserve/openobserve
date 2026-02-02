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

import { PromQLResponse, ConversionContext } from "./shared/types";
import { processPromQLData } from "./shared/dataProcessor";
import { TimeSeriesConverter } from "./convertPromQLTimeSeriesChart";
import { PieConverter } from "./convertPromQLPieChart";
import { TableConverter } from "./convertPromQLTableChart";
import { GaugeConverter } from "./convertPromQLGaugeChart";
import { MetricConverter } from "./convertPromQLMetricChart";
import { HeatmapConverter } from "./convertPromQLHeatmapChart";
import { BarConverter } from "./convertPromQLBarChart";
import { GeoConverter } from "./convertPromQLGeoChart";
import { MapsConverter } from "./convertPromQLMapsChart";
import { applyLegendConfiguration } from "../legendConfiguration";

/**
 * Registry of all chart type converters
 * Each converter handles specific chart types and implements the PromQLChartConverter interface
 */
const CONVERTER_REGISTRY = [
  new TimeSeriesConverter(),
  new PieConverter(),
  new TableConverter(),
  new GaugeConverter(),
  new MetricConverter(),
  new HeatmapConverter(),
  new BarConverter(),
  new GeoConverter(),
  new MapsConverter(),
];

/**
 * Main entry point for PromQL chart conversion
 *
 * This function routes PromQL data to the appropriate chart-specific converter
 * based on the panel's chart type configuration.
 *
 * @param searchQueryData - Array of PromQL API responses (one per query)
 * @param context - Conversion context with panel config and state
 * @returns ECharts options object and extras (legends, hover state, etc.)
 *
 * @example
 * ```typescript
 * const result = await convertPromQLChartData(
 *   [promqlResponse1, promqlResponse2],
 *   {
 *     panelSchema: { type: 'line', config: {...}, queries: [...] },
 *     store: vueStore,
 *     chartPanelRef: ref,
 *     hoveredSeriesState: null,
 *     annotations: [],
 *     metadata: null,
 *   }
 * );
 * ```
 */
export async function convertPromQLChartData(
  searchQueryData: PromQLResponse[],
  context: ConversionContext,
): Promise<{ options: any; extras: any }> {
  const {
    panelSchema,
    store,
    chartPanelRef,
    hoveredSeriesState,
    annotations,
    metadata,
  } = context;
  const chartType = panelSchema.type;
  // Step 1: Find appropriate converter for this chart type
  const converter = CONVERTER_REGISTRY.find((c) =>
    c.supportedTypes.includes(chartType),
  );

  if (!converter) {
    console.error(`No converter found for chart type: ${chartType}`);
    throw new Error(
      `Unsupported chart type for PromQL: ${chartType}. ` +
        `Supported types: ${CONVERTER_REGISTRY.flatMap((c) => c.supportedTypes).join(", ")}`,
    );
  }

  // Step 2: Preprocess data (common for all chart types)
  // This handles timestamp alignment, legend generation, and series limiting
  const processedData = await processPromQLData(
    searchQueryData,
    panelSchema,
    store,
  );

  // Step 3: Initialize extras object
  // This will be populated by converters with legends, hover state, etc.
  const extras: any = {
    legends: [],
    hoveredSeriesState: hoveredSeriesState || null,
  };

  // Step 4: Delegate to chart-specific converter
  // Each converter knows how to transform data for its chart type(s)
  const chartConfig = converter.convert(
    processedData,
    panelSchema,
    store,
    extras,
    chartPanelRef,
  );

  // Step 5: Apply common chart configurations
  const options = {
    backgroundColor: "transparent",
    ...chartConfig,

    // Apply panel-level overrides
    ...(panelSchema.config?.axis_width && {
      grid: {
        ...chartConfig.grid,
        left: panelSchema.config.axis_width,
      },
    }),
  };

  // Step 6: Apply comprehensive legend configuration (same as SQL charts)
  // This handles plain vs scroll types, grid adjustments, and proper positioning
  // Skip for table charts as they don't use ECharts legends
  if (chartType !== "table") {
    applyLegendConfiguration(
      panelSchema,
      chartPanelRef,
      hoveredSeriesState,
      options,
    );
  }

  // Step 7: Apply annotations (if applicable)
  // Annotations are mark lines/areas that overlay on the chart
  if (annotations?.length && chartConfig.series) {
    applyAnnotations(options, annotations, processedData);
  }

  // Step 8: Handle empty data case
  // For ECharts: check series length
  // For tables: check columns length
  const hasEChartsData = options?.series?.length > 0;
  const hasTableData = options?.columns?.length > 0;

  if (!hasEChartsData && !hasTableData) {
    console.warn("No series or columns found - returning empty chart");
    return {
      options: {
        series: [],
        xAxis: [],
      },
      extras,
    };
  }

  return { options, extras };
}

/**
 * Apply mark lines/areas for annotations
 *
 * Annotations allow users to highlight specific values or time ranges on charts.
 * This function converts annotation data into ECharts mark line/area configurations.
 *
 * @param options - Chart options to modify
 * @param annotations - Array of annotation configurations
 * @param processedData - Processed PromQL data
 */
function applyAnnotations(
  options: any,
  annotations: any[],
  processedData: any,
): void {
  if (!Array.isArray(options.series)) return;

  // Apply annotations to the first series
  // (annotations typically apply to the entire chart, not individual series)
  if (options.series[0]) {
    const markLines: any[] = [];
    const markAreas: any[] = [];

    annotations.forEach((annotation) => {
      if (!annotation.show) return;

      if (annotation.type === "line") {
        markLines.push({
          name: annotation.name,
          xAxis: annotation.axis === "x" ? annotation.value : null,
          yAxis: annotation.axis === "y" ? annotation.value : null,
          label: {
            show: annotation.show_label !== false,
            formatter: annotation.name ? "{b}: {c}" : "{c}",
            position: annotation.label_position || "insideEndTop",
          },
          lineStyle: {
            color: annotation.color || "#FF0000",
            type: annotation.line_style || "solid",
            width: annotation.width || 2,
          },
        });
      } else if (annotation.type === "area") {
        markAreas.push([
          {
            name: annotation.name,
            xAxis: annotation.axis === "x" ? annotation.start : null,
            yAxis: annotation.axis === "y" ? annotation.start : null,
          },
          {
            xAxis: annotation.axis === "x" ? annotation.end : null,
            yAxis: annotation.axis === "y" ? annotation.end : null,
            itemStyle: {
              color: annotation.color || "rgba(255, 0, 0, 0.1)",
            },
          },
        ]);
      }
    });

    if (markLines.length > 0) {
      options.series[0].markLine = {
        ...options.series[0].markLine,
        data: [...(options.series[0].markLine?.data || []), ...markLines],
      };
    }

    if (markAreas.length > 0) {
      options.series[0].markArea = {
        ...options.series[0].markArea,
        data: markAreas,
      };
    }
  }
}
