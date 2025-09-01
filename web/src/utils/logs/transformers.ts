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

import { b64EncodeUnicode, b64DecodeUnicode, generateTraceContext } from "@/utils/zincutils";
import type { SearchRequestPayload } from "@/ts/interfaces/query";

/**
 * Interface for query transformation parameters
 */
export interface QueryTransformParams {
  shouldAddFunction: boolean;
  tempFunctionContent: string;
  transformType: "action" | "function";
  selectedTransform?: { id: string };
}

/**
 * Interface for WebSocket payload parameters
 */
export interface WebSocketPayloadParams {
  queryReq: SearchRequestPayload;
  isPagination: boolean;
  type: "search" | "histogram" | "pageCount" | "values";
  organizationIdentifier: string;
  meta?: any;
}

/**
 * Interface for URL query generation parameters
 */
export interface URLQueryParams {
  isShareLink?: boolean;
  dashboardPanelData?: any;
  streamType?: string;
  selectedStream: string[];
  datetime: {
    startTime: string;
    endTime: string;
    relativeTimePeriod?: string;
    type: "relative" | "absolute";
  };
  query: string;
  sqlMode: boolean;
  showTransformEditor?: boolean;
  selectedFields?: string[];
  refreshInterval?: number;
  resultGrid?: {
    showPagination: boolean;
    rowsPerPage: number;
    currentPage: number;
  };
  meta?: {
    showHistogram: boolean;
    showDetailTab: boolean;
    resultGrid?: {
      chartInterval: string;
    };
  };
}

/**
 * Encodes visualization configuration to base64 string
 * 
 * @param config - Visualization configuration object
 * @returns Base64 encoded string or null if encoding fails
 * 
 * @example
 * ```typescript
 * const config = { chart: "bar", data: [1, 2, 3] };
 * const encoded = encodeVisualizationConfig(config);
 * // Returns: "eyJjaGFydCI6ImJhciIsImRhdGEiOlsxLDIsM119"
 * ```
 */
export function encodeVisualizationConfig(config: any): string | null {
  try {
    return b64EncodeUnicode(JSON.stringify(config));
  } catch (error) {
    console.error("Failed to encode visualization config:", error);
    return null;
  }
}

/**
 * Decodes base64 visualization configuration string
 * 
 * @param encodedConfig - Base64 encoded configuration string
 * @returns Parsed configuration object or null if decoding fails
 * 
 * @example
 * ```typescript
 * const encoded = "eyJjaGFydCI6ImJhciIsImRhdGEiOlsxLDIsM119";
 * const config = decodeVisualizationConfig(encoded);
 * // Returns: { chart: "bar", data: [1, 2, 3] }
 * ```
 */
export function decodeVisualizationConfig(encodedConfig: string): any | null {
  try {
    return JSON.parse(b64DecodeUnicode(encodedConfig) ?? "{}");
  } catch (error) {
    console.error("Failed to decode visualization config:", error);
    return null;
  }
}

/**
 * Adds transformation parameters to a query request
 * 
 * @param queryReq - The query request object to modify
 * @param params - Transformation parameters
 * 
 * @example
 * ```typescript
 * const queryReq = { query: {} };
 * const params = {
 *   shouldAddFunction: true,
 *   tempFunctionContent: "SELECT * FROM logs",
 *   transformType: "function" as const,
 *   selectedTransform: { id: "transform-123" }
 * };
 * addTransformToQuery(queryReq, params);
 * // queryReq.query now includes query_fn and/or action_id
 * ```
 */
export function addTransformToQuery(queryReq: any, params: QueryTransformParams): void {
  if (params.shouldAddFunction) {
    queryReq.query["query_fn"] = b64EncodeUnicode(params.tempFunctionContent) || "";
  }

  // Add action ID if it exists
  if (params.transformType === "action" && params.selectedTransform?.id) {
    queryReq.query["action_id"] = params.selectedTransform.id;
  }
}

/**
 * Builds a WebSocket payload for search operations
 * 
 * @param params - WebSocket payload parameters
 * @returns WebSocket payload object with trace ID and metadata
 * 
 * @example
 * ```typescript
 * const params = {
 *   queryReq: { query: { sql: "SELECT * FROM logs" } },
 *   isPagination: false,
 *   type: "search" as const,
 *   organizationIdentifier: "org-123",
 *   meta: { custom: "data" }
 * };
 * const payload = buildWebSocketPayload(params);
 * // Returns: { queryReq, type, isPagination, traceId, org_id, meta }
 * ```
 */
export function buildWebSocketPayload(params: WebSocketPayloadParams) {
  const { traceId } = generateTraceContext();

  const payload = {
    queryReq: params.queryReq,
    type: params.type,
    isPagination: params.isPagination,
    traceId,
    org_id: params.organizationIdentifier,
    ...(params.meta && { meta: params.meta }),
  };

  return { payload, traceId };
}

/**
 * Generates URL query parameters from search state
 * 
 * @param params - URL query generation parameters
 * @returns URL query parameters object
 * 
 * @example
 * ```typescript
 * const params = {
 *   streamType: "logs",
 *   selectedStream: ["app1", "app2"],
 *   datetime: {
 *     startTime: "2023-01-01T00:00:00Z",
 *     endTime: "2023-01-02T00:00:00Z",
 *     type: "absolute" as const
 *   },
 *   query: "error",
 *   sqlMode: false
 * };
 * const urlQuery = generateURLQuery(params);
 * // Returns: { stream_type: "logs", stream: "app1,app2", ... }
 * ```
 */
export function generateURLQuery(params: URLQueryParams): Record<string, any> {
  const query: any = {};

  // Stream type
  if (params.streamType) {
    query["stream_type"] = params.streamType;
  }

  // Selected streams
  if (params.selectedStream.length > 0) {
    if (typeof params.selectedStream === "object") {
      query["stream"] = params.selectedStream.join(",");
    } else {
      query["stream"] = params.selectedStream;
    }
  }

  // Date range
  const date = params.datetime;
  if (date.type === "relative" && date.relativeTimePeriod) {
    query["period"] = date.relativeTimePeriod;
  } else {
    query["from"] = date.startTime;
    query["to"] = date.endTime;
  }

  // Query and SQL mode
  if (params.query) {
    query["query"] = b64EncodeUnicode(params.query);
  }
  query["sql_mode"] = params.sqlMode.toString();

  // Transform editor
  if (params.showTransformEditor !== undefined) {
    query["fn_editor"] = params.showTransformEditor.toString();
  }

  // Selected fields
  if (params.selectedFields && Array.isArray(params.selectedFields) && params.selectedFields.length > 0) {
    query["defined_schemas"] = params.selectedFields.join(",");
  }

  // Refresh interval
  if (params.refreshInterval !== undefined) {
    query["refresh"] = params.refreshInterval.toString();
  }

  // Result grid configuration
  if (params.resultGrid) {
    query["show_pagination"] = params.resultGrid.showPagination.toString();
    query["rows_per_page"] = params.resultGrid.rowsPerPage.toString();
    query["page_num"] = params.resultGrid.currentPage.toString();
  }

  // Meta configuration
  if (params.meta) {
    query["show_histogram"] = params.meta.showHistogram.toString();
    query["show_detailed"] = params.meta.showDetailTab.toString();
    
    if (params.meta.resultGrid?.chartInterval) {
      query["chart_interval"] = params.meta.resultGrid.chartInterval;
    }
  }

  return query;
}

/**
 * Appends source array to target array in chunks to prevent UI blocking
 * 
 * @param target - Target array to append to
 * @param source - Source array to append from
 * @param chunkSize - Number of items to process per chunk (default: 5000)
 * 
 * @example
 * ```typescript
 * const target: number[] = [1, 2, 3];
 * const source = [4, 5, 6, 7, 8];
 * await chunkedAppend(target, source, 2);
 * // target is now [1, 2, 3, 4, 5, 6, 7, 8]
 * // Processing was done in chunks of 2 items with async breaks
 * ```
 */
export async function chunkedAppend(target: any[], source: any[], chunkSize = 5000): Promise<void> {
  for (let i = 0; i < source.length; i += chunkSize) {
    target.push.apply(target, source.slice(i, i + chunkSize));
    // Allow UI to update between chunks
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

/**
 * Transforms array data by applying a transformation function to each element
 * 
 * @param data - Array of data to transform
 * @param transformer - Function to apply to each element
 * @returns Array of transformed data
 * 
 * @example
 * ```typescript
 * const data = [1, 2, 3, 4];
 * const doubled = transformArrayData(data, x => x * 2);
 * // Returns: [2, 4, 6, 8]
 * ```
 */
export function transformArrayData<T, U>(data: T[], transformer: (item: T, index: number) => U): U[] {
  return data.map(transformer);
}

/**
 * Transforms object properties using a mapping function
 * 
 * @param obj - Object to transform
 * @param transformer - Function to transform each property
 * @returns New object with transformed properties
 * 
 * @example
 * ```typescript
 * const obj = { a: 1, b: 2, c: 3 };
 * const doubled = transformObjectData(obj, ([key, value]) => [key, value * 2]);
 * // Returns: { a: 2, b: 4, c: 6 }
 * ```
 */
export function transformObjectData<T, U>(
  obj: Record<string, T>,
  transformer: (entry: [string, T]) => [string, U]
): Record<string, U> {
  const entries = Object.entries(obj).map(transformer);
  return Object.fromEntries(entries);
}

/**
 * Flattens nested object structure into dot-notation keys
 * 
 * @param obj - Object to flatten
 * @param prefix - Optional prefix for keys
 * @returns Flattened object with dot-notation keys
 * 
 * @example
 * ```typescript
 * const nested = { user: { profile: { name: "John", age: 30 } }, active: true };
 * const flattened = flattenObject(nested);
 * // Returns: { "user.profile.name": "John", "user.profile.age": 30, "active": true }
 * ```
 */
export function flattenObject(obj: any, prefix = ""): Record<string, any> {
  const result: Record<string, any> = {};
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      
      if (obj[key] !== null && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
        Object.assign(result, flattenObject(obj[key], newKey));
      } else {
        result[newKey] = obj[key];
      }
    }
  }
  
  return result;
}

/**
 * Groups array elements by a key function
 * 
 * @param array - Array to group
 * @param keyFn - Function that returns the grouping key for each element
 * @returns Object with grouped elements
 * 
 * @example
 * ```typescript
 * const users = [
 *   { name: "John", age: 25, department: "IT" },
 *   { name: "Jane", age: 30, department: "HR" },
 *   { name: "Bob", age: 35, department: "IT" }
 * ];
 * const grouped = groupBy(users, user => user.department);
 * // Returns: { IT: [john, bob], HR: [jane] }
 * ```
 */
export function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return array.reduce((groups, item) => {
    const key = keyFn(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
    return groups;
  }, {} as Record<string, T[]>);
}

/**
 * Process stream data from API response
 * 
 * @param streamList - Raw stream list from API
 * @returns Processed stream data with label/value pairs
 * 
 * @example
 * ```typescript
 * const rawStreams = [{ name: "app-logs" }, { name: "error-logs" }];
 * const processed = processStreamDataUtil(rawStreams);
 * // Returns: [{ name: "app-logs", label: "app-logs", value: "app-logs" }, ...]
 * ```
 */
export function processStreamDataUtil(streamList: any[]): any[] {
  try {
    if (!Array.isArray(streamList)) {
      return [];
    }
    
    return streamList.map(stream => ({
      ...stream,
      label: stream.name || stream.label || 'Unknown',
      value: stream.name || stream.value || stream.label || 'unknown'
    }));
  } catch (error) {
    console.error("Error processing stream data:", error);
    return [];
  }
}

/**
 * Transform log data for histogram visualization
 * 
 * @param aggregationData - Raw aggregation data from search response
 * @returns Transformed data suitable for histogram rendering
 * 
 * @example
 * ```typescript
 * const rawAggs = [{ zo_sql_key: 1640995200000, zo_sql_num: "42" }];
 * const transformed = transformLogDataUtil(rawAggs);
 * // Returns: [{ key: 1640995200000, count: 42, timestamp: 1640995200000 }]
 * ```
 */
export function transformLogDataUtil(aggregationData: any): any[] {
  try {
    if (!aggregationData || !Array.isArray(aggregationData)) {
      return [];
    }
    
    return aggregationData.map(item => ({
      key: item.zo_sql_key,
      count: parseInt(item.zo_sql_num || 0, 10),
      timestamp: item.zo_sql_key,
      // Keep original data for compatibility
      zo_sql_key: item.zo_sql_key,
      zo_sql_num: item.zo_sql_num
    }));
  } catch (error) {
    console.error("Error transforming log data:", error);
    return [];
  }
}