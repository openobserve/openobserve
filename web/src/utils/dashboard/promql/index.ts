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

/**
 * PromQL Chart Conversion Module
 *
 * This module provides a modular, extensible architecture for converting
 * PromQL query results into various chart types.
 *
 * ## Architecture
 *
 * - **Main Router**: convertPromQLChartData.ts - Routes to appropriate converter
 * - **Converters**: Chart-type-specific conversion logic
 * - **Shared Utilities**: Common data processing, legend, axis builders
 *
 * ## Supported Chart Types
 *
 * - Time Series: line, area, area-stacked, bar, scatter
 * - Aggregated: pie, donut
 * - Data Display: table, heatmap
 * - Bar Variants: h-bar, stacked, h-stacked
 * - Single Value: gauge, metric
 * - Geographic: geomap
 * - Flow: sankey
 *
 * ## Usage
 *
 * ```typescript
 * import { convertPromQLChartData } from './promql';
 *
 * const result = await convertPromQLChartData(promqlResponses, context);
 * ```
 */

// Main conversion function
export { convertPromQLChartData } from "./convertPromQLChartData";

// Individual converters (for advanced use cases)
export { TimeSeriesConverter } from "./convertPromQLTimeSeriesChart";
export { PieConverter } from "./convertPromQLPieChart";
export { TableConverter } from "./convertPromQLTableChart";
export { GaugeConverter } from "./convertPromQLGaugeChart";
export { MetricConverter } from "./convertPromQLMetricChart";
export { HeatmapConverter } from "./convertPromQLHeatmapChart";
export { BarConverter } from "./convertPromQLBarChart";
export { GeoConverter } from "./convertPromQLGeoChart";
export { SankeyConverter } from "./convertPromQLSankeyChart";

// Shared utilities
export * from "./shared/types";
export * from "./shared/dataProcessor";
export * from "./shared/legendBuilder";
export * from "./shared/axisBuilder";
