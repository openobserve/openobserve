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

import { ref, computed } from "vue";
import { useStore } from "vuex";
import { useLogsState } from "@/composables/useLogsState";
import useQuery from "@/composables/useQuery";
import type { SearchRequestPayload } from "@/ts/interfaces";
import { 
  createSQLParserFunctions,
  extractValueQuery as extractValueQueryUtil 
} from "@/utils/logs/parsers";
import { 
  validateAggregationQuery 
} from "@/utils/logs/validators";

interface QueryTransformParams {
  [key: string]: any;
}

interface ValueQueryParams {
  org_identifier: string;
  stream_name: string;
  start_time: number;
  end_time: number;
  fields: string[];
  size: number;
  type: string;
}

/**
 * Query management composable for logs functionality
 * Contains all query parsing, building, validation, and transformation operations
 */
export const useLogsQuery = () => {
  const store = useStore();
  const { buildQueryPayload, getTimeInterval } = useQuery();
  const { searchObj, initialQueryPayload } = useLogsState();

  // Create SQL parser functions (need to check what parser instance to pass)
  // For now, using a simple object since we don't have access to the actual parser
  const mockParser = {}; // This would normally be the actual parser instance
  const { parseSQL: parsedSQL, unparseSQL: unparsedSQL } = createSQLParserFunctions(mockParser);

  // Query validation computed properties
  const isValidQuery = computed(() => {
    if (!searchObj.data.query) return false;
    try {
      const parsed = parsedSQL(searchObj.data.query);
      return parsed !== null && parsed !== undefined;
    } catch {
      return false;
    }
  });

  const isSQLMode = computed(() => searchObj.meta.sqlMode);

  const hasValidStreams = computed(() => 
    searchObj.data.stream.selectedStream.length > 0
  );

  /**
   * Parse SQL query string
   */
  const parseQuery = (query: string) => {
    try {
      return parsedSQL(query);
    } catch (error: any) {
      console.error("Error parsing SQL query:", error);
      return null;
    }
  };

  /**
   * Build SQL query from parsed components
   */
  const buildQuery = (parsedComponents: any) => {
    try {
      return unparsedSQL(parsedComponents);
    } catch (error: any) {
      console.error("Error building SQL query:", error);
      return "";
    }
  };

  /**
   * Check if query is a LIMIT query
   */
  const isLimitQuery = (parsedSQLObj: any = null) => {
    const parsed = parsedSQLObj || parseQuery(searchObj.data.query);
    return parsed?.limit != null;
  };

  /**
   * Check if query is a DISTINCT query
   */
  const isDistinctQuery = (parsedSQLObj: any = null) => {
    const parsed = parsedSQLObj || parseQuery(searchObj.data.query);
    return parsed?.distinct != null;
  };

  /**
   * Check if query is a WITH query
   */
  const isWithQuery = (parsedSQLObj: any = null) => {
    const parsed = parsedSQLObj || parseQuery(searchObj.data.query);
    return parsed?.with != null;
  };

  /**
   * Check if query has aggregation
   */
  const hasQueryAggregation = (parsedSQLObj: any = null) => {
    const parsed = parsedSQLObj || parseQuery(searchObj.data.query);
    return parsed && (hasAggregation(parsed.columns) || parsed.groupby != null);
  };

  /**
   * Build complete search request payload
   */
  const buildSearchRequest = (): SearchRequestPayload => {
    const identifier = searchObj.organizationIdentifier || 
                      store.state.selectedOrganization?.identifier || 
                      "default";

    try {
      const timestamps = searchObj.data.datetime.type === "relative"
        ? getTimeInterval(searchObj.data.datetime.relativeTimePeriod)
        : searchObj.data.datetime.type === "absolute"
        ? {
            start_time: searchObj.data.datetime.startTime,
            end_time: searchObj.data.datetime.endTime,
          }
        : { start_time: 0, end_time: 0 };

      let query = "";
      const queryReq = JSON.parse(JSON.stringify(searchObj.data.query));
      
      if (queryReq !== "") {
        const parseQuery = queryReq.split("|");
        const queryFunctions = parseQuery.length > 1 ? "," + parseQuery[0].trim() : "";
        query = parseQuery.length > 1 ? parseQuery[1].trim() : parseQuery[0];

        // Handle function integration for non-SQL mode
        if (queryFunctions !== "" && queryFunctions !== "," && !searchObj.meta.sqlMode) {
          query = query.replace("SELECT *", "SELECT " + queryFunctions);

          // Validate function field exists in selected stream fields
          for (const field of searchObj.data.stream.selectedStreamFields) {
            if (field.name === queryFunctions.replaceAll(",", "")) {
              break;
            }
          }
        }
      }

      const queryPayloadData = {
        org_identifier: identifier,
        query: {
          sql: query,
          start_time: timestamps.start_time,
          end_time: timestamps.end_time,
          from: 0,
          size: searchObj.meta.resultGrid.rowsPerPage,
          quick_mode: searchObj.meta.quickMode,
          track_total_hits: searchObj.data.countEnabled,
          sql_mode: searchObj.meta.sqlMode,
          query_type: "",
        },
        aggs: {
          histogram: `SELECT histogram(_timestamp, '${searchObj.meta.resultGrid.chartInterval}') AS zo_sql_key, count(*) AS zo_sql_num FROM query GROUP BY zo_sql_key ORDER BY zo_sql_key`,
        },
        encoding: "base64",
      };

      const request = buildQueryPayload(queryPayloadData);
      
      // Add regions if specified
      if (searchObj.meta.regions?.length) {
        request.regions = searchObj.meta.regions;
      }
      
      // Store the initial payload
      initialQueryPayload.value = request;
      
      return request;
    } catch (error: any) {
      console.error("Error building search request:", error);
      throw new Error("Failed to build search request: " + error.message);
    }
  };

  /**
   * Build histogram query for multi-stream searches
   */
  const buildHistogramQuery = (queryReq: any) => {
    try {
      if (searchObj.data.stream.selectedStream.length <= 1 || searchObj.meta.sqlMode) {
        return queryReq;
      }

      const histogramQueries: string[] = [];
      
      for (const stream of searchObj.data.stream.selectedStream) {
        const streamName = stream.value || stream.name;
        const histogramQuery = `SELECT histogram(_timestamp, '${searchObj.meta.resultGrid.chartInterval}') AS zo_sql_key, count(*) AS zo_sql_num FROM "${streamName}" GROUP BY zo_sql_key ORDER BY zo_sql_key`;
        histogramQueries.push(histogramQuery);
      }

      return {
        ...queryReq,
        aggs: {
          histogram: histogramQueries.join(" UNION ALL ")
        }
      };
    } catch (error: any) {
      console.error("Error building histogram query:", error);
      return queryReq;
    }
  };

  /**
   * Transform query for specific requirements
   */
  const transformQuery = (query: string, params: QueryTransformParams = {}) => {
    try {
      let transformedQuery = query;

      // Replace field list placeholder if present
      if (params.fieldList && transformedQuery.includes("[FIELD_LIST]")) {
        transformedQuery = transformedQuery.replace(/\[FIELD_LIST\]/g, params.fieldList);
      }

      // Apply stream-specific transformations
      if (params.streamName) {
        // Add stream name if not present
        if (!transformedQuery.toLowerCase().includes("from")) {
          transformedQuery = `${transformedQuery} FROM "${params.streamName}"`;
        }
      }

      // Apply time range filters
      if (params.timeFilter) {
        const parsed = parseQuery(transformedQuery);
        if (parsed && !parsed.where) {
          transformedQuery = `${transformedQuery} WHERE ${params.timeFilter}`;
        }
      }

      return transformedQuery;
    } catch (error: any) {
      console.error("Error transforming query:", error);
      return query;
    }
  };

  /**
   * Extract value query parameters
   */
  const extractValueQuery = () => {
    try {
      const orgIdentifier = store.state.selectedOrganization?.identifier;
      if (!orgIdentifier) {
        throw new Error("No organization selected");
      }

      const params: ValueQueryParams = {
        org_identifier: orgIdentifier,
        stream_name: searchObj.data.stream.selectedStream[0]?.value || 
                    searchObj.data.stream.selectedStream[0]?.name || "",
        start_time: searchObj.data.datetime.startTime || 0,
        end_time: searchObj.data.datetime.endTime || Date.now(),
        fields: searchObj.data.stream.selectedFields || [],
        size: 100,
        type: searchObj.data.stream.streamType || "logs"
      };

      return extractValueQueryUtil(params);
    } catch (error: any) {
      console.error("Error extracting value query:", error);
      return {};
    }
  };

  /**
   * Validate query against selected streams and fields
   */
  const validateQuery = (query: string = searchObj.data.query) => {
    const errors: string[] = [];

    try {
      // Check if query is provided
      if (!query.trim()) {
        if (searchObj.meta.sqlMode) {
          errors.push("Query is required in SQL mode");
        }
        return { isValid: errors.length === 0, errors };
      }

      // Parse and validate SQL syntax
      const parsed = parseQuery(query);
      if (searchObj.meta.sqlMode && !parsed) {
        errors.push("Invalid SQL syntax");
        return { isValid: false, errors };
      }

      // Check if streams are selected
      if (searchObj.data.stream.selectedStream.length === 0) {
        errors.push("At least one stream must be selected");
      }

      // Validate stream-specific constraints
      if (searchObj.data.stream.selectedStream.length > 1 && searchObj.meta.sqlMode) {
        const hasAggregationFields = parsed && hasAggregation(parsed.columns);
        if (!hasAggregationFields && !isLimitQuery(parsed)) {
          errors.push("Multi-stream queries in SQL mode require aggregation or LIMIT clause");
        }
      }

      // Validate field references in query
      if (parsed && parsed.columns) {
        const availableFields = searchObj.data.stream.selectedStreamFields.map((f: any) => f.name);
        const invalidFields = parsed.columns.filter((col: any) => {
          return col.type === "field" && !availableFields.includes(col.name);
        });
        
        if (invalidFields.length > 0) {
          errors.push(`Unknown fields: ${invalidFields.map((f: any) => f.name).join(", ")}`);
        }
      }

    } catch (error: any) {
      errors.push("Query validation failed: " + error.message);
    }

    return { isValid: errors.length === 0, errors };
  };

  /**
   * Get query statistics and metadata
   */
  const getQueryStats = (query: string = searchObj.data.query) => {
    try {
      const parsed = parseQuery(query);
      
      return {
        hasWhere: parsed?.where != null,
        hasLimit: parsed?.limit != null,
        hasGroupBy: parsed?.groupby != null,
        hasOrderBy: parsed?.orderby != null,
        hasAggregation: parsed && hasAggregation(parsed.columns),
        isDistinct: parsed?.distinct != null,
        columnCount: parsed?.columns?.length || 0,
        estimatedComplexity: calculateQueryComplexity(parsed)
      };
    } catch (error: any) {
      console.error("Error getting query stats:", error);
      return null;
    }
  };

  /**
   * Calculate query complexity score
   */
  const calculateQueryComplexity = (parsed: any) => {
    if (!parsed) return 0;
    
    let complexity = 1;
    
    if (parsed.where) complexity += 2;
    if (parsed.groupby) complexity += 3;
    if (parsed.orderby) complexity += 1;
    if (parsed.limit) complexity -= 1; // LIMIT reduces complexity
    if (hasAggregation(parsed.columns)) complexity += 4;
    if (parsed.distinct) complexity += 2;
    
    return Math.max(1, complexity);
  };

  /**
   * Format query for display
   */
  const formatQuery = (query: string, options: { pretty?: boolean; maxLength?: number } = {}) => {
    try {
      let formatted = query.trim();
      
      if (options.pretty) {
        // Add basic SQL formatting
        formatted = formatted
          .replace(/\bSELECT\b/gi, "SELECT")
          .replace(/\bFROM\b/gi, "\nFROM")
          .replace(/\bWHERE\b/gi, "\nWHERE")
          .replace(/\bGROUP BY\b/gi, "\nGROUP BY")
          .replace(/\bORDER BY\b/gi, "\nORDER BY")
          .replace(/\bLIMIT\b/gi, "\nLIMIT");
      }
      
      if (options.maxLength && formatted.length > options.maxLength) {
        formatted = formatted.substring(0, options.maxLength - 3) + "...";
      }
      
      return formatted;
    } catch (error: any) {
      console.error("Error formatting query:", error);
      return query;
    }
  };

  /**
   * Check if query has aggregation functions
   */
  const hasAggregation = (columns: any) => {
    try {
      return validateAggregationQuery({ columns }, searchObj.data.query);
    } catch (error: any) {
      console.error("Error checking aggregation:", error);
      return false;
    }
  };

  return {
    // Computed properties
    isValidQuery,
    isSQLMode,
    hasValidStreams,
    
    // Core query operations
    parseQuery,
    buildQuery,
    buildSearchRequest,
    transformQuery,
    
    // Query validation
    isLimitQuery,
    isDistinctQuery,
    isWithQuery,
    hasQueryAggregation,
    validateQuery,
    
    // Query analysis
    getQueryStats,
    calculateQueryComplexity,
    formatQuery,
    hasAggregation,
    
    // Specialized operations
    buildHistogramQuery,
    extractValueQuery,
    
    // Parser functions (for backward compatibility)
    parsedSQL,
    unparsedSQL,
    
    // State references
    initialQueryPayload,
  };
};

export default useLogsQuery;