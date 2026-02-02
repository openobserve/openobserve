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
 * Shared tooltip overflow CSS style for chart tooltips
 */
export const TOOLTIP_SCROLL_STYLE =
  "max-height: 200px; overflow: auto; max-width: 400px; word-wrap: break-word; user-select: text; scrollbar-width: thin; scrollbar-color: rgba(128,128,128,0.5) transparent;";

/**
 * PromQL result item structure
 */
export interface PromQLResultItem {
  metric: Record<string, string>; // Labels
  values?: Array<[number, string]>; // [timestamp, value] for matrix
  value?: [number, string]; // [timestamp, value] for vector
}

/**
 * Standard PromQL API response structure
 * Supports both standard PromQL format (data.result) and OpenObserve format (result)
 */
export interface PromQLResponse {
  status?: "success" | "error";
  resultType?: "matrix" | "vector" | "scalar" | "string";
  // Standard PromQL format
  data?: {
    resultType: "matrix" | "vector" | "scalar" | "string";
    result: Array<PromQLResultItem>;
  };
  // OpenObserve format (direct result)
  result?: Array<PromQLResultItem>;
}

/**
 * Processed data structure used by converters
 */
export interface ProcessedPromQLData {
  timestamps: Array<[number, Date | string]>; // [unix_ts, formatted_date]
  series: Array<{
    name: string;
    metric: Record<string, string>;
    values: Array<[number, string]>; // [timestamp, value]
    data: Record<number, string>; // timestamp -> value map
  }>;
  queryIndex: number;
  queryConfig: any;
}

/**
 * Common converter interface
 */
export interface PromQLChartConverter {
  /**
   * Converts PromQL response to ECharts series configuration
   */
  convert(
    processedData: ProcessedPromQLData[],
    panelSchema: any,
    store: any,
    extras: any,
    chartPanelRef?: any,
  ): {
    series: any[];
    xAxis?: any;
    yAxis?: any;
    grid?: any;
    tooltip?: any;
    legend?: any;
    [key: string]: any;
  };

  /**
   * Chart types supported by this converter
   */
  supportedTypes: string[];
}

/**
 * Conversion context
 */
export interface ConversionContext {
  panelSchema: any;
  store: any;
  chartPanelRef: any;
  hoveredSeriesState: any;
  annotations: any;
  metadata?: any;
}

/**
 * Aggregation function type for single-value charts
 */
export type AggregationFunction =
  | "last"
  | "first"
  | "min"
  | "max"
  | "avg"
  | "sum"
  | "count"
  | "range"
  | "diff";

/**
 * Configuration options for table charts
 */
export interface TableColumnConfig {
  name: string;
  field: string;
  label: string;
  align: "left" | "center" | "right";
  sortable: boolean;
  format?: (val: any) => string;
  type?:
    | "string"
    | "number"
    | "timestamp"
    | "duration"
    | "bytes"
    | "boolean"
    | "link"
    | "json";
}

/**
 * Configuration options for geomap charts
 * Requires lat, lon, weight fields
 */
export interface GeoMapConfig {
  lat_label?: string;
  lon_label?: string;
  weight_label?: string;
  name_label?: string;
}

/**
 * Configuration options for maps charts
 * Requires name (location) and value fields
 */
export interface MapsConfig {
  name_label?: string;
  map_type?: {
    type: string;
  };
  enable_roam?: boolean;
  aggregation?: string;
  emphasis_area_color?: string;
  select_area_color?: string;
}
