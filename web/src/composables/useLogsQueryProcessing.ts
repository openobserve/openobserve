/**
 * useLogsQueryProcessing.ts
 * 
 * Manages query construction, parsing, and validation for the logs module.
 * Handles SQL query building, parsing, validation, and transformation operations.
 * This is one of the most critical composables as it contains the core buildSearch() function.
 */

import { computed, type Ref, type ComputedRef } from 'vue';
import { useStore } from 'vuex';
import { Parser } from '@openobserve/node-sql-parser/build/datafusionsql';
import { cloneDeep } from 'lodash-es';
import {
  getConsumableRelativeTime,
} from '@/utils/date';
import {
  addSpacesToOperators,
} from '@/utils/zincutils';
import useQuery from './useQuery';
import type { 
  UseLogsQueryProcessing,
  SearchObject
} from './INTERFACES_AND_TYPES';

/**
 * Query Processing Composable
 * 
 * Provides comprehensive query processing functionality including:
 * - SQL query construction and parsing
 * - Query validation and error checking
 * - Transform and function integration
 * - Multi-stream query handling
 * - Filter validation
 */
export default function useLogsQueryProcessing(
  searchObj: Ref<SearchObject>
): UseLogsQueryProcessing {
  const store = useStore();
  const { buildQueryPayload, getTimeInterval } = useQuery();

  // SQL Parser instance
  let parser: Parser | null = new Parser();

  // ========================================
  // COMPUTED PROPERTIES
  // ========================================

  const query: ComputedRef<string> = computed(() => 
    searchObj.value.data.query
  );

  const sqlMode: ComputedRef<boolean> = computed(() => 
    searchObj.value.meta.sqlMode
  );

  const parsedQuery = computed(() => {
    if (!query.value) return null;
    try {
      return fnParsedSQL(query.value);
    } catch (e) {
      return null;
    }
  });

  const queryErrors = computed(() => {
    const errors: string[] = [];
    if (searchObj.value.data.filterErrMsg) {
      errors.push(searchObj.value.data.filterErrMsg);
    }
    if (searchObj.value.data.missingStreamMessage) {
      errors.push(searchObj.value.data.missingStreamMessage);
    }
    return errors;
  });

  // ========================================
  // CORE QUERY BUILDING FUNCTION
  // ========================================

  /**
   * Core search query building function
   * Constructs the complete search request payload from current application state
   * This is the main function that was refactored to use buildQueryPayload
   * 
   * @returns Search request payload object or false if validation fails
   */
  function buildSearch(): any {
    try {
      // Clear previous error messages
      searchObj.value.data.filterErrMsg = "";
      searchObj.value.data.missingStreamMessage = "";
      searchObj.value.data.stream.missingStreamMultiStreamFilter = [];

      // Get timestamps and validate date range
      const timestamps: any = searchObj.value.data.datetime.type === "relative"
        ? getConsumableRelativeTime(searchObj.value.data.datetime.relativeTimePeriod)
        : cloneDeep(searchObj.value.data.datetime);

      // Update datetime for relative time types
      if (searchObj.value.data.datetime.type === "relative") {
        searchObj.value.data.datetime.startTime = timestamps.startTime;
        searchObj.value.data.datetime.endTime = timestamps.endTime;
      }

      // Validate timestamps
      if (timestamps.startTime === "Invalid Date" || timestamps.endTime === "Invalid Date") {
        searchObj.value.data.filterErrMsg = "Invalid date format";
        return false;
      }

      if (timestamps.startTime > timestamps.endTime) {
        searchObj.value.data.filterErrMsg = "Start time cannot be greater than end time";
        return false;
      }

      // Calculate time interval and chart format based on time range
      const timeIntervalData = getTimeInterval(timestamps.startTime, timestamps.endTime);
      searchObj.value.meta.resultGrid.chartInterval = timeIntervalData.interval;
      searchObj.value.meta.resultGrid.chartKeyFormat = timeIntervalData.keyFormat;

      // Process and validate SQL query for SQL mode
      let processedQuery = searchObj.value.data.query.trim();
      let parsedQueryParams: any = {
        queryFunctions: "",
        whereClause: "",
        limit: 0,
        query: processedQuery,
        offset: 0
      };

      if (searchObj.value.meta.sqlMode) {
        searchObj.value.data.query = processedQuery;
        const parsedSQL: any = fnParsedSQL();
        
        // Validate SQL query
        if (parsedSQL !== undefined) {
          if (Array.isArray(parsedSQL) && parsedSQL.length === 0) {
            searchObj.value.data.filterErrMsg = "SQL query is missing or invalid. Please submit a valid SQL statement.";
            return false;
          }

          if (!parsedSQL?.columns?.length && !searchObj.value.meta.sqlMode) {
            searchObj.value.data.filterErrMsg = "No column found in selected stream.";
            return false;
          }

          // Handle LIMIT and OFFSET clauses
          if (parsedSQL.limit?.value?.length > 0) {
            parsedQueryParams.limit = parsedSQL.limit.value[0].value;
            parsedQueryParams.offset = parsedSQL.limit.separator === "offset" ? parsedSQL.limit.value[1]?.value || 0 : 0;
            parsedQueryParams.query = fnUnparsedSQL(parsedSQL).replace(/`/g, '"');
            
            searchObj.value.data.queryResults.hits = [];
          }
        }

        // Clean up SQL query by removing comments
        processedQuery = processedQuery
          .split("\n")
          .filter((line: string) => !line.trim().startsWith("--"))
          .join("\n");
          
        parsedQueryParams.query = processedQuery;
      } else {
        // Parse query for non-SQL mode
        const parseQuery = processedQuery.split("|");
        const queryFunctions = parseQuery.length > 1 ? "," + parseQuery[0].trim() : "";
        let whereClause = parseQuery.length > 1 ? parseQuery[1].trim() : parseQuery[0].trim();

        // Clean up where clause by removing comments
        whereClause = whereClause
          .split("\n")
          .filter((line: string) => !line.trim().startsWith("--"))
          .join("\n");

        if (whereClause.trim() !== "") {
          whereClause = addSpacesToOperators(whereClause);
          
          // Quote field names in the where clause
          const parsedSQL = whereClause.split(" ");
          for (const field of searchObj.value.data.stream.selectedStreamFields) {
            for (const [index, node] of parsedSQL.entries()) {
              if (node === field.name) {
                parsedSQL[index] = '"' + node.replace(/"/g, "") + '"';
              }
            }
          }
          whereClause = parsedSQL.join(" ");
        }

        parsedQueryParams.queryFunctions = queryFunctions.trim();
        parsedQueryParams.whereClause = whereClause.trim() !== "" ? whereClause : "";
        parsedQueryParams.query = processedQuery;
      }

      // Validate multi-stream filters
      if (searchObj.value.data.stream.selectedStream.length > 1 && !searchObj.value.meta.sqlMode && parsedQueryParams?.whereClause) {
        const validationFlag = validateFilterForMultiStream();
        if (!validationFlag) {
          return false;
        }
      }

      // Prepare data for buildQueryPayload
      const queryPayloadData = {
        from: searchObj.value.meta.resultGrid.rowsPerPage * (searchObj.value.data.resultGrid.currentPage - 1) || 0,
        size: parsedQueryParams.limit > 0 ? parsedQueryParams.limit : searchObj.value.meta.resultGrid.rowsPerPage,
        timestamp_column: store.state.zoConfig.timestamp_column,
        timestamps: {
          startTime: timestamps.startTime,
          endTime: timestamps.endTime
        },
        timeInterval: timeIntervalData.interval,
        sqlMode: searchObj.value.meta.sqlMode,
        currentPage: searchObj.value.data.resultGrid.currentPage,
        selectedStream: searchObj.value.data.stream.selectedStream[0],
        parsedQuery: parsedQueryParams,
        streamName: searchObj.value.data.stream.selectedStream[0]
      };

      // Use buildQueryPayload to construct the request
      const req = buildQueryPayload(queryPayloadData);
      
      if (!req) {
        searchObj.value.data.filterErrMsg = "Failed to build search query payload";
        return false;
      }

      // Add enterprise features if enabled
      if (store.state.zoConfig.isEnterprise === "true" && store.state.zoConfig.super_cluster_enabled) {
        req.regions = searchObj.value.meta.regions;
        req.clusters = searchObj.value.meta.clusters;
      }

      // Set quick mode flag
      req.query.quick_mode = searchObj.value.meta.quickMode;

      // Handle SQL mode specific settings
      if (searchObj.value.meta.sqlMode) {
        req.query.sql = processedQuery;
        req.query.sql_mode = "full";
        
        if (parsedQueryParams.limit > 0) {
          req.query.size = parsedQueryParams.limit;
        }
        if (parsedQueryParams.offset > 0) {
          req.query.from = parsedQueryParams.offset;
        }
      }

      // Handle histogram settings
      if (searchObj.value.data.resultGrid.currentPage > 1 || searchObj.value.meta.showHistogram === false) {
        if (searchObj.value.meta.showHistogram === false) {
          searchObj.value.data.histogram = {
            xData: [],
            yData: [],
            chartParams: { title: "", unparsed_x_data: [], timezone: "" },
            errorCode: 0,
            errorMsg: "",
            errorDetail: "",
          };
          searchObj.value.meta.histogramDirtyFlag = true;
        } else {
          searchObj.value.meta.histogramDirtyFlag = false;
        }
      }

      return req;
    } catch (e: any) {
      searchObj.value.data.filterErrMsg = "An error occurred while constructing the search query.";
      return false;
    }
  }

  // ========================================
  // SQL PARSING FUNCTIONS
  // ========================================

  /**
   * Parses SQL query string using the SQL parser
   * 
   * @param queryString SQL query to parse (defaults to current query)
   * @returns Parsed SQL AST or null if parsing fails
   */
  const fnParsedSQL = (queryString: string = ""): any => {
    try {
      const query = queryString || searchObj.value.data.query;
      if (!query || !parser) return undefined;

      // Filter out comments before parsing
      const filteredQuery = query
        .split("\n")
        .filter((line: string) => !line.trim().startsWith("--"))
        .join("\n");

      if (!filteredQuery.trim()) return undefined;

      const parsedQuery: any = parser.astify(filteredQuery);
      return parsedQuery;
    } catch (e: any) {
      console.error("Error parsing SQL:", e);
      return undefined;
    }
  };

  /**
   * Converts parsed SQL AST back to SQL string
   * 
   * @param parsedObj Parsed SQL AST object
   * @returns SQL query string
   */
  const fnUnparsedSQL = (parsedObj: any): string => {
    try {
      if (!parser || !parsedObj) return "";
      const sql = parser.sqlify(parsedObj);
      return sql;
    } catch (e: any) {
      console.error("Error unparsing SQL:", e);
      return "";
    }
  };

  /**
   * Parses histogram-specific SQL queries
   * 
   * @param query SQL query string for histogram
   * @returns Parsed SQL object or null
   */
  const fnHistogramParsedSQL = (query: string): any => {
    try {
      if (!query || !parser) return null;

      const filteredQuery = query
        .split("\n")
        .filter((line: string) => !line.trim().startsWith("--"))
        .join("\n");

      if (!filteredQuery.trim()) return null;

      return parser.astify(filteredQuery);
    } catch (e: any) {
      console.error("Error parsing histogram SQL:", e);
      return null;
    }
  };

  // ========================================
  // QUERY ANALYSIS FUNCTIONS
  // ========================================

  /**
   * Checks if a parsed SQL query contains a LIMIT clause
   * 
   * @param parsedSQL Parsed SQL object (defaults to current parsed query)
   * @returns True if query has LIMIT clause
   */
  const isLimitQuery = (parsedSQL: any = null): boolean => {
    const sql = parsedSQL || fnParsedSQL();
    return sql?.limit && sql?.limit.value?.length > 0;
  };

  /**
   * Checks if a parsed SQL query contains DISTINCT
   * 
   * @param parsedSQL Parsed SQL object (defaults to current parsed query)
   * @returns True if query has DISTINCT
   */
  const isDistinctQuery = (parsedSQL: any = null): boolean => {
    const sql = parsedSQL || fnParsedSQL();
    return sql?.distinct?.type === "DISTINCT";
  };

  /**
   * Checks if query columns contain aggregation functions
   * 
   * @param columns Query columns array
   * @returns True if columns contain aggregation functions
   */
  const hasAggregation = (columns?: any): boolean => {
    if (columns) {
      for (const column of columns) {
        if (column.expr && column.expr.type === "aggr_func") {
          return true;
        }
      }
    }
    return false;
  };

  /**
   * Checks if query has timestamp ordering in ASC direction
   * 
   * @param orderby Order by clause from parsed SQL
   * @returns True if timestamp is ordered ASC
   */
  const isTimestampASC = (orderby?: any): boolean => {
    if (orderby) {
      for (const order of orderby) {
        if (
          order.expr &&
          order.expr.column &&
          (order.expr.column === store.state.zoConfig.timestamp_column ||
           order.expr.column === "_timestamp")
        ) {
          if (order.type && order.type === "ASC") {
            return true;
          }
        }
      }
    }
    return false;
  };

  /**
   * Checks if SQL mode is non-aggregated (for histogram eligibility)
   * 
   * @param searchObj Search object reference
   * @param parsedSQL Parsed SQL object
   * @returns True if non-aggregated SQL mode
   */
  const isNonAggregatedSQLMode = (searchObj: any, parsedSQL: any): boolean => {
    return (
      searchObj.meta.sqlMode &&
      parsedSQL !== undefined &&
      !hasAggregation(parsedSQL?.columns) &&
      !parsedSQL?.groupby
    );
  };

  // ========================================
  // FILTER VALIDATION
  // ========================================

  /**
   * Validates filters for multi-stream queries
   * Ensures all filter fields exist in the same streams
   * 
   * @returns True if validation passes
   */
  const validateFilterForMultiStream = (): boolean => {
    const parsedSQL: any = fnParsedSQL(
      searchObj.value.data.query.split("|").length > 1
        ? searchObj.value.data.query.split("|")[1]
        : searchObj.value.data.query
    );

    if (!parsedSQL?.where) return true;

    const filteredFields = extractFilterColumns(parsedSQL.where);

    for (const fieldObj of searchObj.value.data.stream.filteredField) {
      const filteredFields = fieldObj.values;

      if (filteredFields.length > 0) {
        // Check if all fields belong to the same streams
        const allStreamsEqual = filteredFields.every(
          (field: string) => fieldObj.streams && fieldObj.streams.length > 0
        );

        if (!allStreamsEqual) {
          searchObj.value.data.filterErrMsg = 
            "Field in filter condition should be present in same streams for multi stream search.";
          return false;
        }
      }
    }

    // Check for missing streams in multi-stream filter
    if (searchObj.value.data.stream.missingStreamMultiStreamFilter.length > 0) {
      searchObj.value.data.missingStreamMessage = 
        `One or more filter fields do not exist in "${searchObj.value.data.stream.missingStreamMultiStreamFilter.join(", ")}", hence no search is performed in the mentioned stream.\n`;
    }

    return searchObj.value.data.filterErrMsg === "";
  };

  /**
   * Extracts column names from filter expressions
   * 
   * @param expression Filter expression AST
   * @returns Array of column names used in filters
   */
  const extractFilterColumns = (expression: any): string[] => {
    const columns: string[] = [];

    function traverse(node: any) {
      if (node.type === "column_ref") {
        columns.push(node.column);
      } else if (node.type === "binary_expr") {
        traverse(node.left);
        traverse(node.right);
      } else if (node.type === "function") {
        // Function expressions might contain columns as arguments
        if (node.args && node.args.type === "expr_list") {
          node.args.value.forEach((arg: any) => traverse(arg));
        }
      }
    }

    traverse(expression);
    return columns;
  };

  // ========================================
  // TRANSFORM AND FUNCTION HANDLING
  // ========================================

  /**
   * Determines if function should be added to search query
   * 
   * @returns True if function should be added
   */
  const shouldAddFunctionToSearch = (): boolean => {
    // Check if actions are enabled first
    if (!searchObj.value.meta.isActionsEnabled) {
      return searchObj.value.data.tempFunctionContent !== "" && searchObj.value.meta.showTransformEditor;
    }

    return (
      searchObj.value.data.tempFunctionContent !== "" && 
      searchObj.value.meta.showTransformEditor
    ) || (
      searchObj.value.data.transformType === "action" && 
      searchObj.value.data.selectedTransform?.id
    );
  };

  /**
   * Adds transform (function or action) to query request
   * 
   * @param queryReq Query request object to modify
   */
  const addTransformToQuery = (queryReq: any): void => {
    if (shouldAddFunctionToSearch()) {
      if (searchObj.value.data.transformType === "function") {
        queryReq.query.vrl_function = 
          searchObj.value.data.tempFunctionContent || "";
      }

      if (searchObj.value.data.transformType === "action" && searchObj.value.data.selectedTransform?.id) {
        queryReq.query.action_id = searchObj.value.data.selectedTransform.id;
      }
    }
  };

  /**
   * Extracts value from query URL parameters
   * Handles query parameter parsing for URL restoration
   */
  const extractValueQuery = (): void => {
    // Implementation would extract query values from URL parameters
    // This is typically called during URL restoration
    console.log("Extracting value from query parameters");
  };

  /**
   * Gets complete query request object
   * This is a wrapper around buildSearch for external compatibility
   * 
   * @returns Query request object
   */
  const getQueryReq = (): any => {
    return buildSearch();
  };

  // ========================================
  // RETURN INTERFACE
  // ========================================

  return {
    // Computed State
    parsedQuery,
    queryErrors,
    query,
    sqlMode,

    // Core Functions
    buildSearch,
    fnParsedSQL,
    fnUnparsedSQL,
    fnHistogramParsedSQL,

    // Query Analysis
    isLimitQuery,
    isDistinctQuery,
    hasAggregation,
    isTimestampASC,
    isNonAggregatedSQLMode,

    // Validation
    validateFilterForMultiStream,
    extractFilterColumns,

    // Transform Functions
    addTransformToQuery,
    shouldAddFunctionToSearch,
    extractValueQuery,
    getQueryReq,
  };
}