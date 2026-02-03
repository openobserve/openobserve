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
 * SQL Query Parser for Build Query Mode
 *
 * This module provides utilities to:
 * 1. Detect if a SQL query is "parseable" (can be converted to auto/builder mode)
 * 2. Parse SQL queries into structured panel builder format (x, y, breakdown fields)
 * 3. Detect complex patterns that require custom mode
 */

import { getFieldsFromQuery, getStreamFromQuery } from "./sqlUtils";

// ============================================================================
// Types
// ============================================================================

export interface ParsedField {
  column: string;
  alias: string;
  aggregationFunction: string | null;
  /** Stream alias for JOIN queries (e.g., "stream_0") */
  streamAlias?: string | null;
  /** Field type: "build" for normal fields, "raw" for complex expressions like CASE/WHEN */
  type?: "build" | "raw";
  /** Raw SQL expression for type: "raw" fields (e.g., CASE WHEN ... END) */
  rawQuery?: string;
}

export interface ParsedFilter {
  filterType: "condition" | "group";
  logicalOperator: string;
  column?: string;
  operator?: string;
  value?: string;
  values?: string[];
  conditions?: ParsedFilter[];
}

export interface JoinCondition {
  leftField: { streamAlias: string | null; field: string };
  rightField: { streamAlias: string | null; field: string };
  operation: string;
}

export interface ParsedJoin {
  stream: string;
  streamAlias: string;
  joinType: string;
  conditions: JoinCondition[];
}

export interface ParsedQuery {
  /** Stream/table name */
  stream: string;
  /** Stream type (logs, metrics, etc.) */
  streamType: string;
  /** X-axis fields (usually histogram or time-based) */
  xFields: ParsedField[];
  /** Y-axis fields (usually aggregations) */
  yFields: ParsedField[];
  /** Breakdown/group by fields */
  breakdownFields: ParsedField[];
  /** Filter conditions */
  filters: ParsedFilter;
  /** JOIN clauses */
  joins: ParsedJoin[];
  /** Whether this is a custom (unparseable) query */
  customQuery: boolean;
  /** Original raw query */
  rawQuery: string;
  /** Parse error message if any */
  parseError?: string;
}

// ============================================================================
// Complex Pattern Detection
// ============================================================================

/**
 * Patterns that indicate a query cannot be parsed into builder mode
 *
 * NOTE: The following are SUPPORTED in auto mode and should NOT be in this list:
 * - CASE/WHEN statements: Supported via field type "raw" with rawQuery property
 * - Multiple JOINs: Supported (a JOIN b JOIN c, etc.)
 * - HAVING clause: Supported via havingConditions on y-axis fields
 */
const COMPLEX_PATTERNS = {
  // Subqueries and derived tables (e.g., JOIN (SELECT ...) AS alias)
  // This catches nested SELECTs which we cannot represent in panel schema
  subquery: /\(\s*SELECT\s+/i,

  // Parenthesized/nested JOINs (e.g., a JOIN (b JOIN c ON ...) ON ...)
  // Our flat joins array structure cannot represent nested JOIN groupings
  parenthesizedJoin: /\bJOIN\s*\(/i,

  // Common Table Expressions (CTEs)
  cte: /\bWITH\s+\w+\s+AS\s*\(/i,

  // UNION/INTERSECT/EXCEPT
  setOperations: /\b(UNION|INTERSECT|EXCEPT)\b/i,

  // Window functions
  windowFunctions: /\b(OVER\s*\(|PARTITION\s+BY|ROW_NUMBER|RANK|DENSE_RANK|LAG|LEAD|FIRST_VALUE|LAST_VALUE|NTH_VALUE)\b/i,

  // Complex nested functions (more than 2 levels)
  nestedFunctions: /\w+\s*\(\s*\w+\s*\(\s*\w+\s*\(/i,

  // LATERAL JOIN
  lateralJoin: /\bLATERAL\b/i,

  // DISTINCT ON
  distinctOn: /\bDISTINCT\s+ON\b/i,

  // ARRAY operations
  arrayOperations: /\b(ARRAY_AGG|UNNEST|ANY|ALL)\s*\(/i,

  // JSON operations
  jsonOperations: /->|->>/,
};

/**
 * Check if a query contains complex patterns that cannot be parsed
 * @param query The SQL query to check
 * @returns Object with isParseable flag and reason if not parseable
 */
export function isQueryParseable(query: string): {
  isParseable: boolean;
  reason?: string;
} {
  if (!query || typeof query !== "string") {
    return { isParseable: false, reason: "Invalid query" };
  }

  const normalizedQuery = query.trim();

  // Check each complex pattern
  for (const [patternName, pattern] of Object.entries(COMPLEX_PATTERNS)) {
    if (pattern.test(normalizedQuery)) {
      return {
        isParseable: false,
        reason: getPatternDescription(patternName),
      };
    }
  }

  return { isParseable: true };
}

/**
 * Get human-readable description for a complex pattern
 */
function getPatternDescription(patternName: string): string {
  const descriptions: Record<string, string> = {
    subquery: "Contains subqueries or derived tables",
    parenthesizedJoin: "Contains parenthesized/nested JOINs",
    cte: "Contains WITH clause (CTE)",
    setOperations: "Contains UNION/INTERSECT/EXCEPT",
    windowFunctions: "Contains window functions",
    nestedFunctions: "Contains deeply nested functions",
    lateralJoin: "Contains LATERAL JOIN",
    distinctOn: "Contains DISTINCT ON",
    arrayOperations: "Contains array operations",
    jsonOperations: "Contains JSON operations",
  };

  return descriptions[patternName] || "Contains complex SQL patterns";
}

// ============================================================================
// Field Classification
// ============================================================================

/**
 * Known aggregation functions
 */
const AGGREGATION_FUNCTIONS = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "p50",
  "p90",
  "p95",
  "p99",
  "count-distinct",
  "approx_percentile",
  "stddev",
  "variance",
]);

/**
 * Known time/histogram functions
 */
const TIME_FUNCTIONS = new Set(["histogram", "date_bin", "time_range"]);

/**
 * Classify a field into x-axis, y-axis, or breakdown
 */
function classifyField(field: ParsedField): "x" | "y" | "breakdown" {
  const func = field.aggregationFunction?.toLowerCase();

  if (!func) {
    // No aggregation - likely a breakdown field
    return "breakdown";
  }

  if (TIME_FUNCTIONS.has(func)) {
    // Time-based function - x-axis
    return "x";
  }

  if (AGGREGATION_FUNCTIONS.has(func)) {
    // Aggregation function - y-axis
    return "y";
  }

  // Default to breakdown
  return "breakdown";
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parse a SQL query into structured panel builder format
 * @param query The SQL query to parse
 * @param streamType The stream type (default: 'logs')
 * @returns ParsedQuery object
 */
export async function parseSQL(
  query: string,
  streamType: string = "logs",
): Promise<ParsedQuery> {
  // Default result for unparseable queries
  const defaultResult: ParsedQuery = {
    stream: "",
    streamType,
    xFields: [],
    yFields: [],
    breakdownFields: [],
    filters: {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
    },
    joins: [],
    customQuery: true,
    rawQuery: query,
  };

  // Check if query is empty
  if (!query || typeof query !== "string" || !query.trim()) {
    return {
      ...defaultResult,
      customQuery: false, // Empty query is valid for builder mode
    };
  }

  // Check for complex patterns
  const parseability = isQueryParseable(query);
  if (!parseability.isParseable) {
    return {
      ...defaultResult,
      parseError: parseability.reason,
    };
  }

  try {
    // Extract stream name
    const stream = await getStreamFromQuery(query);

    // Extract fields, filters, and joins
    const { fields, filters, streamName, joins } = await getFieldsFromQuery(query);

    // If no fields extracted, use custom mode
    if (!fields || fields.length === 0) {
      return {
        ...defaultResult,
        stream: stream || streamName || "",
        filters: filters as ParsedFilter,
        joins: joins || [],
      };
    }

    // Classify fields into x, y, breakdown
    const xFields: ParsedField[] = [];
    const yFields: ParsedField[] = [];
    const breakdownFields: ParsedField[] = [];

    for (const field of fields) {
      const classification = classifyField(field);
      switch (classification) {
        case "x":
          xFields.push(field);
          break;
        case "y":
          yFields.push(field);
          break;
        case "breakdown":
          breakdownFields.push(field);
          break;
      }
    }

    return {
      stream: stream || streamName || "",
      streamType,
      xFields,
      yFields,
      breakdownFields,
      filters: filters as ParsedFilter,
      joins: joins || [],
      customQuery: false,
      rawQuery: query,
    };
  } catch (error: any) {
    return {
      ...defaultResult,
      parseError: error?.message || "Failed to parse query",
    };
  }
}

/**
 * Convert parsed query to dashboard panel data format
 * @param parsed The parsed query
 * @returns Panel fields structure with joins and recommended chart type
 */
export function parsedQueryToPanelFields(parsed: ParsedQuery): {
  stream: string;
  stream_type: string;
  x: any[];
  y: any[];
  breakdown: any[];
  filter: any;
  joins: any[];
  /** True if table chart should be used (e.g., more than 2 GROUP BY fields) */
  useTableChart: boolean;
} {
  const mapFieldToPanel = (field: ParsedField, index: number, axis: string) => {
    // Check if this is a raw field (e.g., CASE/WHEN expression)
    if (field.type === "raw" && field.rawQuery) {
      return {
        label: field.alias || `${axis}_axis_${index + 1}`,
        alias: field.alias || `${axis}_axis_${index + 1}`,
        column: "",
        color: null,
        type: "raw",
        rawQuery: field.rawQuery,
        sortBy: null,
        isDerived: false,
        havingConditions: [],
      };
    }

    // Field structure must match dashboard builder format with functionName and args
    const baseField: any = {
      label: field.column,
      alias: field.alias || `${axis}_axis_${index + 1}`,
      column: field.column,
      color: null,
      type: "build",
      functionName: field.aggregationFunction || null,
      args: [
        {
          type: "field",
          value: {
            field: field.column,
            // Use streamAlias from parsed field for JOIN queries
            streamAlias: field.streamAlias || null,
          },
        },
      ],
      sortBy: axis === "x" ? "ASC" : null,
      isDerived: false,
      havingConditions: [],
    };
    return baseField;
  };

  let xFields = parsed.xFields;
  let breakdownFields = parsed.breakdownFields;
  let useTableChart = false;

  // Calculate total non-aggregation fields (x-axis + breakdown)
  // We support single x-axis and single breakdown for most charts
  // If more than 2 GROUP BY fields, use table chart with all fields on x-axis
  const totalGroupByFields = xFields.length + breakdownFields.length;

  if (totalGroupByFields > 2) {
    // Use table chart: move all breakdown fields to x-axis
    xFields = [...xFields, ...breakdownFields];
    breakdownFields = [];
    useTableChart = true;
  } else if (xFields.length === 0 && breakdownFields.length > 0) {
    // If no timeseries/histogram field on X-axis but there are breakdown fields,
    // move the first breakdown field to X-axis
    xFields = [breakdownFields[0]];
    breakdownFields = breakdownFields.slice(1);
  }

  return {
    stream: parsed.stream,
    stream_type: parsed.streamType,
    x: xFields.map((f, i) => mapFieldToPanel(f, i, "x")),
    y: parsed.yFields.map((f, i) => mapFieldToPanel(f, i, "y")),
    breakdown: breakdownFields.map((f, i) => mapFieldToPanel(f, i, "z")),
    filter: parsed.filters,
    joins: parsed.joins || [],
    useTableChart,
  };
}

/**
 * Quick check if query should use custom mode
 * @param query The SQL query to check
 * @returns true if query should use custom mode
 */
export function shouldUseCustomMode(query: string): boolean {
  if (!query || !query.trim()) {
    return false;
  }

  const parseability = isQueryParseable(query);
  return !parseability.isParseable;
}
