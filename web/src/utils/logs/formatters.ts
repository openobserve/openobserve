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

import { formatSizeFromMB } from "@/utils/zincutils";

/**
 * Interface for histogram title generation parameters
 */
export interface HistogramTitleParams {
  currentPage: number;
  rowsPerPage: number;
  totalCount: number;
  hitsLength: number;
  showPagination: boolean;
  communicationMethod: string;
  jobId: string;
  paginationLength: number;
  partitionPaginationLength: number;
  sqlMode: boolean;
  aggregationTotal: number;
  hasAggregation: boolean;
  partitionCount: number;
  showHistogram: boolean;
  took: number;
  scanSize: number;
  resultCacheRatio?: number;
}

/**
 * Interface for filter expression parameters
 */
export interface FilterExpressionParams {
  field: string | number;
  fieldValue: string | number | boolean;
  action: string;
  streamResults: any[];
  selectedStreams: string[];
}

/**
 * Generates a formatted histogram title showing search results summary
 * 
 * @param params - Parameters for title generation
 * @returns Formatted histogram title string
 * 
 * @example
 * ```typescript
 * const title = generateHistogramTitle({
 *   currentPage: 1,
 *   rowsPerPage: 50,
 *   totalCount: 1000,
 *   // ... other params
 * });
 * // Returns: "Showing 1 to 50 out of 1,000 events in 45 ms. (Scan Size: 2.5 MB)"
 * ```
 */
export function generateHistogramTitle(params: HistogramTitleParams): string {
  try {
    const currentPageIndex = params.currentPage - 1 || 0;
    const startCount = currentPageIndex * params.rowsPerPage + 1;
    let endCount: number;
    let totalCount = Math.max(params.hitsLength, params.totalCount);

    if (!params.showPagination) {
      endCount = params.hitsLength;
      totalCount = params.hitsLength;
    } else {
      endCount = params.rowsPerPage * (currentPageIndex + 1);
      const maxPageIndex = (params.communicationMethod === "ws" || 
        params.communicationMethod === "streaming" || 
        params.jobId !== ""
          ? params.paginationLength
          : params.partitionPaginationLength || 0) - 1;

      if (currentPageIndex >= maxPageIndex) {
        endCount = Math.min(
          startCount + params.rowsPerPage - 1,
          totalCount
        );
      } else {
        endCount = params.rowsPerPage * (currentPageIndex + 1);
      }
    }

    if (params.sqlMode && params.hasAggregation) {
      totalCount = params.aggregationTotal;
    }

    if (isNaN(totalCount)) {
      totalCount = 0;
    }

    if (isNaN(endCount)) {
      endCount = 0;
    }

    let plusSign = "";
    if (
      params.partitionCount > 1 &&
      endCount < totalCount &&
      !params.showHistogram
    ) {
      plusSign = "+";
    }

    if (
      (params.communicationMethod === "ws" || params.communicationMethod === "streaming") &&
      endCount < totalCount &&
      !params.showHistogram
    ) {
      plusSign = "+";
    }

    const scanSizeLabel = params.resultCacheRatio !== undefined && params.resultCacheRatio > 0
      ? "Delta Scan Size"
      : "Scan Size";

    const title = `Showing ${startCount} to ${endCount} out of ${totalCount.toLocaleString()}${plusSign} events in ${params.took} ms. (${scanSizeLabel}: ${formatSizeFromMB(params.scanSize)}${plusSign})`;
    
    return title;
  } catch (error) {
    console.error("Error while generating histogram title:", error);
    return "";
  }
}

/**
 * Generates a filter expression based on field type and value
 * 
 * @param params - Parameters for filter expression generation
 * @returns Formatted filter expression string
 * 
 * @example
 * ```typescript
 * const expression = generateFilterExpressionByFieldType({
 *   field: "status",
 *   fieldValue: "error",
 *   action: "include",
 *   streamResults: [...],
 *   selectedStreams: ["logs"]
 * });
 * // Returns: "status = 'error'"
 * ```
 */
export function generateFilterExpressionByFieldType(params: FilterExpressionParams): string {
  let operator = params.action === "include" ? "=" : "!=";
  
  try {
    let fieldType = "utf8";
    let fieldValue = params.fieldValue;

    const getStreamFieldTypes = (stream: any) => {
      if (!stream.schema) return {};
      return Object.fromEntries(
        stream.schema.map((schema: any) => [schema.name, schema.type])
      );
    };

    const fieldTypeList = params.streamResults
      .filter((stream: any) => params.selectedStreams.includes(stream.name))
      .reduce((acc: any, stream: any) => ({
        ...acc,
        ...getStreamFieldTypes(stream),
      }), {});

    if (Object.hasOwnProperty.call(fieldTypeList, params.field)) {
      fieldType = fieldTypeList[params.field as string];
    }

    if (fieldValue === "null" || fieldValue === "" || fieldValue === null) {
      operator = params.action === "include" ? "is" : "is not";
      fieldValue = "null";
    }

    let expression = fieldValue === "null"
      ? `${params.field} ${operator} ${fieldValue}`
      : `${params.field} ${operator} '${fieldValue}'`;

    const isNumericType = (type: string) => 
      ["int64", "float64"].includes(type.toLowerCase());
    const isBooleanType = (type: string) => 
      type.toLowerCase() === "boolean";

    if (isNumericType(fieldType)) {
      expression = `${params.field} ${operator} ${fieldValue}`;
    } else if (isBooleanType(fieldType)) {
      operator = params.action === "include" ? "is" : "is not";
      expression = `${params.field} ${operator} ${fieldValue}`;
    }

    return expression;
  } catch (error) {
    console.error("Error while generating filter expression by field type:", error);
    return `${params.field} ${operator} '${params.fieldValue}'`;
  }
}

/**
 * Formats a field value for display based on its type and content
 * 
 * @param value - The field value to format
 * @param fieldType - The type of the field (optional)
 * @returns Formatted value string
 * 
 * @example
 * ```typescript
 * const formatted = formatFieldValue(12345, "int64");
 * // Returns: "12,345"
 * 
 * const formatted2 = formatFieldValue(true, "boolean");
 * // Returns: "true"
 * ```
 */
export function formatFieldValue(value: any, fieldType?: string): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    if (fieldType && ["int64", "float64"].includes(fieldType.toLowerCase())) {
      return value.toLocaleString();
    }
    return value.toString();
  }

  if (typeof value === "boolean") {
    return value.toString();
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "[Object]";
    }
  }

  return String(value);
}

/**
 * Formats a list of items into a readable string
 * 
 * @param items - Array of items to format
 * @param separator - Separator to use between items (default: ", ")
 * @param maxItems - Maximum number of items to show before truncating (default: 5)
 * @returns Formatted list string
 * 
 * @example
 * ```typescript
 * const formatted = formatList(["item1", "item2", "item3"]);
 * // Returns: "item1, item2, item3"
 * 
 * const formatted2 = formatList(["a", "b", "c", "d", "e", "f"], ", ", 3);
 * // Returns: "a, b, c... (and 3 more)"
 * ```
 */
export function formatList(items: string[], separator: string = ", ", maxItems: number = 5): string {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }

  if (items.length <= maxItems) {
    return items.join(separator);
  }

  const visibleItems = items.slice(0, maxItems);
  const remainingCount = items.length - maxItems;
  
  return `${visibleItems.join(separator)}... (and ${remainingCount} more)`;
}

/**
 * Formats a number with appropriate units (K, M, B, etc.)
 * 
 * @param value - Number to format
 * @param precision - Number of decimal places (default: 1)
 * @returns Formatted number string with units
 * 
 * @example
 * ```typescript
 * const formatted = formatNumber(1500);
 * // Returns: "1.5K"
 * 
 * const formatted2 = formatNumber(2500000);
 * // Returns: "2.5M"
 * ```
 */
export function formatNumber(value: number, precision: number = 1): string {
  if (isNaN(value) || value === null || value === undefined) {
    return "0";
  }

  const abs = Math.abs(value);
  
  if (abs >= 1e9) {
    return (value / 1e9).toFixed(precision) + "B";
  } else if (abs >= 1e6) {
    return (value / 1e6).toFixed(precision) + "M";
  } else if (abs >= 1e3) {
    return (value / 1e3).toFixed(precision) + "K";
  }
  
  return value.toString();
}

/**
 * Truncates text to a specified length with ellipsis
 * 
 * @param text - Text to truncate
 * @param maxLength - Maximum length before truncation
 * @param suffix - Suffix to append when truncated (default: "...")
 * @returns Truncated text string
 * 
 * @example
 * ```typescript
 * const truncated = truncateText("This is a very long text", 10);
 * // Returns: "This is a..."
 * ```
 */
export function truncateText(text: string, maxLength: number, suffix: string = "..."): string {
  if (typeof text !== "string") {
    return String(text);
  }

  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= suffix.length) {
    return suffix;
  }

  return text.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Escapes special characters in a string for safe display
 * 
 * @param text - Text to escape
 * @returns Escaped text string
 * 
 * @example
 * ```typescript
 * const escaped = escapeText("<script>alert('xss')</script>");
 * // Returns: "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"
 * ```
 */
export function escapeText(text: string): string {
  if (typeof text !== "string") {
    return String(text);
  }

  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}