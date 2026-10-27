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

import { unref, type MaybeRef } from "vue";
import { gt } from "@/types/i18n";
import { getAnnotationsData } from "@/utils/dashboard/getAnnotationsData";
import { CHART_SELECTION_FILL } from "@/utils/chartTheme";

import {
  PromQLResponse,
  ConversionContext,
  PromQLChartConverter,
  ProcessedPromQLData,
} from "./shared/types";
import type { SeriesLimitInfo } from "@/utils/dashboard/panelDiagnostics";
import { addCommasToNumber } from "@/utils/formatters";
import { getPromqlSeriesLimit, processPromQLData } from "./shared/dataProcessor";
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

type AnnotationList = NonNullable<Parameters<typeof getAnnotationsData>[0]>["value"];

/**
 * Registry of all chart type converters
 * Each converter handles specific chart types and implements the PromQLChartConverter interface
 */
const CONVERTER_REGISTRY: PromQLChartConverter[] = [
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
  const { panelSchema, store, chartPanelRef, hoveredSeriesState, annotations } = context;
  const chartType = panelSchema.type;
  // Step 1: Find appropriate converter for this chart type
  const converter = CONVERTER_REGISTRY.find((c) => c.supportedTypes.includes(chartType));

  if (!converter) {
    console.error(`No converter found for chart type: ${chartType}`);
    throw new Error(
      gt("dashboard.utils.promqlUnsupportedChartType", {
        chartType,
        supportedTypes: CONVERTER_REGISTRY.flatMap((c) => c.supportedTypes).join(", "),
      }),
    );
  }

  // Step 2: Preprocess data (common for all chart types)
  // This handles timestamp alignment, legend generation, and series limiting
  const processedData = await processPromQLData(searchQueryData, panelSchema, store, {
    parentQueryIndex: context.parentQueryIndex,
    nameSuffixes: context.nameSuffixes,
  });

  // Step 3: Initialize extras object
  // This will be populated by converters with legends, hover state, etc.
  const extras: any = {
    legends: [],
    hoveredSeriesState: hoveredSeriesState || null,
  };
  const seriesLimit = getSeriesLimit(searchQueryData, processedData, context);
  if (seriesLimit) {
    extras.seriesLimit = seriesLimit;
    extras.limitNumberOfSeriesWarningMessage = gt("dashboard.utils.seriesLimitWarningCounts", {
      shown: addCommasToNumber(seriesLimit.shown),
      total: addCommasToNumber(seriesLimit.total),
    });
  }

  // Step 4: Delegate to chart-specific converter
  // Each converter knows how to transform data for its chart type(s)
  const chartConfig = converter.convert(
    processedData,
    panelSchema,
    store,
    extras,
    chartPanelRef,
    context,
  );

  // Step 5: Apply common chart configurations
  const options: { series?: any[]; columns?: unknown[]; [key: string]: any } = {
    backgroundColor: "transparent",
    ...chartConfig,

    // Apply panel-level overrides
    ...(panelSchema.config?.axis_width && {
      grid: Array.isArray(chartConfig.grid)
        ? chartConfig.grid.map((grid: any) => ({ ...grid, left: panelSchema.config.axis_width }))
        : { ...chartConfig.grid, left: panelSchema.config.axis_width },
    }),
  };

  // Step 6: Apply comprehensive legend configuration (same as SQL charts)
  // This handles plain vs scroll types, grid adjustments, and proper positioning
  // Skip for table charts as they don't use ECharts legends
  if (chartType !== "table") {
    applyLegendConfiguration(panelSchema, chartPanelRef, hoveredSeriesState, options);
  }

  // Step 7: Apply annotations (if applicable)
  // Stacked is the only modular chart whose x categories are the step timestamps.
  if (chartType === "stacked" && options.series?.length) {
    applyAnnotations(options, annotations, processedData[0]?.timestamps ?? [], store);
  }

  // Step 8: Handle empty data case
  // For ECharts: check series length
  // For tables: check columns length
  const hasEChartsData = (options?.series?.length ?? 0) > 0;
  const hasTableData = (options?.columns?.length ?? 0) > 0;

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

/** Count the current-period series dropped by the panel cap or by the streaming loader. */
function getSeriesLimit(
  searchQueryData: PromQLResponse[],
  processedData: ProcessedPromQLData[],
  context: ConversionContext,
): SeriesLimitInfo | null {
  // A histogram heatmap reports its cut in whole histograms, not bucket series.
  if (processedData.some((queryData) => queryData.histogramsLimited)) return null;
  const isPrimary = (index: number) => !context.nameSuffixes?.[index];
  const resultOf = (queryData: PromQLResponse) => queryData?.data?.result || queryData?.result;
  const primaryResults = searchQueryData.filter(
    (queryData, index) => isPrimary(index) && resultOf(queryData)?.length,
  );
  const received = primaryResults.reduce(
    (count, queryData) => count + (resultOf(queryData)?.length ?? 0),
    0,
  );
  const shown = processedData.reduce(
    (count, queryData) =>
      queryData.seriesRole === "shifted" ? count : count + queryData.series.length,
    0,
  );
  const streamed = context.metadata?.seriesLimiting;
  // Streaming stats are summed over every stream, so with a shifted period they no longer describe the current one.
  const streamedDrop =
    !!streamed &&
    searchQueryData.every((_, index) => isPrimary(index)) &&
    (streamed.uniqueSeriesSeen ?? streamed.metricsStored) > streamed.metricsStored;
  const total = streamedDrop ? Math.max(received, streamed.uniqueSeriesSeen) : received;
  if (total <= shown) return null;
  const perQuery = Math.min(
    getPromqlSeriesLimit(context.panelSchema.config, context.store),
    streamed?.maxSeries ?? Infinity,
  );
  return { shown, total, cap: perQuery * Math.max(primaryResults.length, 1) };
}

/** Draw dashboard annotations on a category time axis, snapping each time to its nearest step. */
function applyAnnotations(
  options: { series?: unknown[] },
  annotations: MaybeRef<AnnotationList | null>,
  timestamps: Array<[number, Date | string]>,
  store: { state: { timezone: string } },
): void {
  // The panel loader hands over a Ref; specs and other callers pass a plain array.
  const list = unref(annotations);
  if (!Array.isArray(list) || list.length === 0 || timestamps.length === 0) return;

  const first = timestamps[0][0];
  const last = timestamps[timestamps.length - 1][0];
  // Annotation times are microseconds; PromQL steps are seconds.
  const nearestIndex = (seconds: number): number => {
    let nearest = 0;
    timestamps.forEach(([ts], index) => {
      if (Math.abs(ts - seconds) < Math.abs(timestamps[nearest][0] - seconds)) nearest = index;
    });
    return nearest;
  };
  const inRange = (seconds: number) =>
    Number.isFinite(seconds) && seconds >= first && seconds <= last;

  const { markLines, markAreas } = getAnnotationsData({ value: list }, store.state.timezone);
  const lines = markLines
    .filter((line: any) => inRange(line.annotationDetails?.start_time / 1_000_000))
    .map((line: any) => ({
      ...line,
      xAxis: nearestIndex(line.annotationDetails.start_time / 1_000_000),
    }));
  const areas = markAreas
    .filter(([from]: any[]) => {
      const start = from.annotationDetails?.start_time / 1_000_000;
      const end = from.annotationDetails?.end_time / 1_000_000;
      return Number.isFinite(start) && Number.isFinite(end) && end >= first && start <= last;
    })
    .map(([from, to]: any[]) => [
      {
        ...from,
        xAxis: nearestIndex(Math.max(from.annotationDetails.start_time / 1_000_000, first)),
      },
      { ...to, xAxis: nearestIndex(Math.min(from.annotationDetails.end_time / 1_000_000, last)) },
    ]);
  if (lines.length === 0 && areas.length === 0) return;

  options.series?.push({
    type: "line",
    data: [],
    markLine: {
      itemStyle: { color: "rgba(108, 122, 125, 1)" },
      silent: false,
      animation: false,
      data: lines,
    },
    markArea: {
      itemStyle: { color: CHART_SELECTION_FILL },
      data: areas,
    },
    zlevel: 2,
  });
}
