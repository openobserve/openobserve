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

import { useQuasar } from "quasar";
import { computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import { b64EncodeUnicode, useLocalLogFilterField, } from "@/utils/zincutils";

import {
  encodeVisualizationConfig,
  getVisualizationConfig,
} from "@/composables/useLogs/logsVisualization";

import { searchState } from "@/composables/useLogs/searchState";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import {
  TimestampRange,
  ParsedSQLResult,
  TimePeriodUnit,
} from "@/ts/interfaces";
import { TIME_MULTIPLIERS } from "@/utils/logs/constants";

interface SQLColumn {
  expr?: {
    type: string;
    name?: string;
  };
  as?: string;
}
export const logsUtils = () => {
  const { searchObj } = searchState();
  let parser: Parser | null = new Parser();
  const q = useQuasar();
  const router = useRouter();
  const store = useStore();
  const timestampColumnName = store.state.zoConfig.timestamp_column;

  const DEFAULT_PARSED_RESULT: ParsedSQLResult = {
    columns: [],
    from: [],
    orderby: null,
    limit: null,
    groupby: null,
    where: null,
  } as const;

  /**
   * Parses a SQL query string into a structured AST (Abstract Syntax Tree) object.
   *
   * This function takes a SQL query string, removes comment lines (lines starting with '--'),
   * and parses it using the DataFusion SQL parser to return a structured object containing
   * the query components like columns, tables, conditions, etc.
   *
   * @param queryString - The SQL query string to parse. If empty or not provided,
   *                      it will use the query from searchObj.data.query
   * @returns A ParsedSQLResult object containing structured SQL components:
   *          - columns: Array of selected columns
   *          - from: Array of tables/sources
   *          - orderby: ORDER BY clauses (null if none)
   *          - limit: LIMIT clause (null if none)
   *          - groupby: GROUP BY clauses (null if none)
   *          - where: WHERE conditions (null if none)
   *
   * @example
   * ```typescript
   * const result = fnParsedSQL("SELECT name, age FROM users WHERE age > 25");
   * console.log(result.columns); // Array of column definitions
   * console.log(result.from);    // Array with 'users' table
   * console.log(result.where);   // WHERE condition object
   * ```
   */
  const fnParsedSQL = (queryString: string = ""): ParsedSQLResult => {
    try {
      const finalQueryString: string = queryString || searchObj.data.query;
      const filteredQuery: string = finalQueryString
        .split("\n")
        .filter((line: string) => !line.trim().startsWith("--"))
        .join("\n");

      const parsedQuery: ParsedSQLResult | null = parser?.astify(
        filteredQuery,
      ) as unknown as ParsedSQLResult;
      return parsedQuery || DEFAULT_PARSED_RESULT;

      // return convertPostgreToMySql(parser.astify(filteredQuery));
    } catch {
      return DEFAULT_PARSED_RESULT;
    }
  };

  /**
   * Converts a parsed SQL AST object back into a SQL query string.
   *
   * This function takes a structured SQL object (typically returned by fnParsedSQL)
   * and converts it back into a valid SQL query string using the DataFusion SQL parser.
   *
   * @param parsedObj - The parsed SQL object to convert back to string.
   *                    Can be a ParsedSQLResult interface or any AST object
   *                    from the SQL parser
   * @returns A SQL query string representation of the parsed object.
   *          Returns empty string if parsing fails or input is invalid
   *
   * @example
   * ```typescript
   * const parsedSQL = fnParsedSQL("SELECT * FROM users");
   * const sqlString = fnUnparsedSQL(parsedSQL);
   * console.log(sqlString); // "SELECT * FROM users"
   * ```
   *
   * @example
   * ```typescript
   * // Handle conversion errors gracefully
   * const malformedObj = { invalid: "structure" };
   * const result = fnUnparsedSQL(malformedObj);
   * console.log(result); // "" (empty string on error)
   * ```
   */
  const fnUnparsedSQL = (parsedObj: ParsedSQLResult | any): string => {
    try {
      const sql: string | undefined = parser?.sqlify(parsedObj);
      return sql || "";
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.info(`Error while unparsing SQL : ${errorMessage}`);
      return "";
    }
  };

  /**
   * Extracts timestamp range based on a relative time period string.
   *
   * This function parses a time period string (e.g., "5m", "2h", "1d") and returns
   * a timestamp range from the calculated past time to the current time. It supports
   * seconds, minutes, hours, days, weeks, and months with special handling for
   * month calculations to account for variable month lengths.
   *
   * @param period - Time period string ending with unit (s/m/h/d/w/M)
   *                 Examples: "30s", "5m", "2h", "1d", "1w", "1M"
   * @returns Object containing 'from' and 'to' timestamps in milliseconds,
   *          or undefined if the period format is invalid
   *
   * @example
   * ```typescript
   * // Get timestamps for last 5 minutes
   * const range = extractTimestamps("5m");
   * console.log(range); // { from: 1640000000000, to: 1640000300000 }
   *
   * // Get timestamps for last 2 hours
   * const hourRange = extractTimestamps("2h");
   * console.log(hourRange); // { from: 1639992800000, to: 1640000000000 }
   *
   * // Handle invalid format
   * const invalid = extractTimestamps("5x");
   * console.log(invalid); // undefined
   * ```
   *
   * @throws {Error} Logs error to console for invalid period formats
   */
  const extractTimestamps = (
    period: string,
  ): TimestampRange | undefined => {
    if (!period || typeof period !== "string") {
      console.error("Invalid period: must be a non-empty string");
      return undefined;
    }

    const currentTime = new Date();
    const toTimestamp = currentTime.getTime();
    const unit = period.slice(-1) as TimePeriodUnit;
    const value = parseInt(period.slice(0, -1), 10);

    // Validate parsed value
    if (isNaN(value) || value <= 0) {
      console.error(
        `Invalid period value: "${period}". Must be a positive number followed by unit (s/m/h/d/w/M)`,
      );
      return undefined;
    }

    let fromTimestamp: number;

    // Handle month calculation separately due to variable month lengths
    if (unit === "M") {
      const monthsToSubtract = value;
      const fromDate = new Date(currentTime);
      fromDate.setMonth(fromDate.getMonth() - monthsToSubtract);
      fromTimestamp = fromDate.getTime();
    } else if (unit in TIME_MULTIPLIERS) {
      // Handle standard time units
      const multiplier = TIME_MULTIPLIERS[unit];
      fromTimestamp = toTimestamp - value * multiplier;
    } else {
      console.error(
        `Invalid period unit: "${unit}". Supported units: s, m, h, d, w, M`,
      );
      return undefined;
    }

    return {
      from: fromTimestamp,
      to: toTimestamp,
    };
  };

  /**
   * Determines if a SQL query contains aggregation functions or GROUP BY clauses.
   *
   * This function checks for aggregation by examining both the parsed column expressions
   * for aggregation functions (like COUNT, SUM, AVG) and the raw query string for
   * GROUP BY keywords. It's used to determine whether a query requires aggregation
   * processing or can be handled as a simple select query.
   *
   * @param columns - Array of parsed SQL column objects from the query AST
   * @returns true if aggregation is detected, false otherwise
   *
   * @example
   * ```typescript
   * // Query with aggregation function
   * const parsedQuery = fnParsedSQL("SELECT COUNT(*) FROM users");
   * const hasAgg = hasAggregation(parsedQuery.columns);
   * console.log(hasAgg); // true
   *
   * // Query with GROUP BY
   * searchObj.data.query = "SELECT name FROM users GROUP BY department";
   * const hasGroupBy = hasAggregation([]);
   * console.log(hasGroupBy); // true
   *
   * // Simple select query
   * const simpleQuery = hasAggregation([{ expr: { type: 'column' } }]);
   * console.log(simpleQuery); // false
   * ```
   */
  const hasAggregation = (columns: SQLColumn[]): boolean => {
    // Check for aggregation functions in column expressions
    if (columns && Array.isArray(columns)) {
      for (const column of columns) {
        if (column?.expr?.type === "aggr_func") {
          return true;
        }
      }
    }

    // Check for GROUP BY clause in the raw query string
    const currentQuery = searchObj?.data?.query || "";
    if (currentQuery.toLowerCase().includes("group by")) {
      return true;
    }

    return false;
  };

  /**
   * Determines if a parsed SQL query contains a LIMIT clause.
   *
   * This function checks whether the parsed SQL AST includes a LIMIT clause
   * with valid values. It's used to identify queries that restrict the number
   * of returned results, which affects result processing and pagination behavior.
   *
   * @param parsedSQL - The parsed SQL AST object (typically from fnParsedSQL)
   * @returns true if a LIMIT clause with values is present, false otherwise
   *
   * @example
   * ```typescript
   * const query1 = fnParsedSQL("SELECT * FROM users LIMIT 10");
   * console.log(isLimitQuery(query1)); // true
   *
   * const query2 = fnParsedSQL("SELECT * FROM users");
   * console.log(isLimitQuery(query2)); // false
   *
   * // Handle null/undefined input
   * console.log(isLimitQuery(null)); // false
   * ```
   */
  const isLimitQuery = (
    parsedSQL: ParsedSQLResult | null = null,
  ): boolean => {
    return Boolean(
      parsedSQL?.limit &&
        parsedSQL.limit.value &&
        Array.isArray(parsedSQL.limit.value) &&
        parsedSQL.limit.value.length > 0,
    );
  };

  /**
   * Determines if a parsed SQL query contains a DISTINCT clause.
   *
   * This function checks whether the parsed SQL AST includes a DISTINCT modifier
   * in the SELECT statement. DISTINCT queries eliminate duplicate rows from
   * results, which affects query execution and result processing strategies.
   *
   * @param parsedSQL - The parsed SQL AST object (typically from fnParsedSQL)
   * @returns true if DISTINCT clause is present, false otherwise
   *
   * @example
   * ```typescript
   * const query1 = fnParsedSQL("SELECT DISTINCT name FROM users");
   * console.log(isDistinctQuery(query1)); // true
   *
   * const query2 = fnParsedSQL("SELECT name FROM users");
   * console.log(isDistinctQuery(query2)); // false
   *
   * // Handle null/undefined input
   * console.log(isDistinctQuery(null)); // false
   * ```
   */
  const isDistinctQuery = (
    parsedSQL: ParsedSQLResult | any = null,
  ): boolean => {
    return parsedSQL?.distinct?.type === "DISTINCT";
  };

  /**
   * Determines if a parsed SQL query contains WITH clauses (Common Table Expressions).
   *
   * This function checks whether the parsed SQL AST includes WITH clauses,
   * also known as Common Table Expressions (CTEs). WITH clauses allow for
   * complex query structuring and temporary result set definitions.
   *
   * @param parsedSQL - The parsed SQL AST object (typically from fnParsedSQL)
   * @returns true if WITH clauses are present, false otherwise
   *
   * @example
   * ```typescript
   * const query1 = fnParsedSQL(`
   *   WITH user_stats AS (SELECT COUNT(*) as total FROM users)
   *   SELECT * FROM user_stats
   * `);
   * console.log(isWithQuery(query1)); // true
   *
   * const query2 = fnParsedSQL("SELECT * FROM users");
   * console.log(isWithQuery(query2)); // false
   *
   * // Handle null/undefined input
   * console.log(isWithQuery(null)); // false
   * ```
   */
  const isWithQuery = (
    parsedSQL: ParsedSQLResult | any = null,
  ): boolean => {
    return Boolean(
      parsedSQL?.with &&
        Array.isArray(parsedSQL.with) &&
        parsedSQL.with.length > 0,
    );
  };

  // Todo: Duplicate function in IndexList.vue same for removeTraceId
  /**
   * Adds a trace ID to the appropriate trace ID collection based on communication method.
   *
   * This function adds a trace ID to either the HTTP request trace IDs or WebSocket
   * trace IDs array, depending on the current communication method. It prevents
   * duplicate trace IDs by checking if the ID already exists before adding it.
   * This is essential for tracking ongoing search operations and preventing
   * duplicate request handling.
   *
   * @param traceId - The unique trace identifier to add to the collection.
   *                  Must be a non-empty string representing a valid trace ID
   * @returns void - No return value, modifies searchObj state directly
   *
   * @example
   * ```typescript
   * // Add trace ID for HTTP communication
   * searchObj.communicationMethod = "http";
   * addTraceId("trace-123-456-789");
   * console.log(searchObj.data.searchRequestTraceIds); // ["trace-123-456-789"]
   *
   * // Attempting to add duplicate trace ID (no-op)
   * addTraceId("trace-123-456-789"); // Won't add duplicate
   * ```
   *
   * @throws {Error} Implicitly throws if traceId is not a string or searchObj is undefined
   */
  const addTraceId = (traceId: string): void => {
    // Validate input parameter
    if (!traceId || typeof traceId !== "string") {
      console.error("addTraceId: traceId must be a non-empty string");
      return;
    }

    // Determine target array based on communication method
    const targetTraceIds = searchObj.data.searchRequestTraceIds;

    // Early return if trace ID already exists (prevent duplicates)
    if (targetTraceIds.includes(traceId)) {
      return;
    }

    // Add trace ID to the appropriate collection
    targetTraceIds.push(traceId);
  };

  /**
   * Removes a trace ID from the appropriate trace ID collection based on communication method.
   *
   * This function removes a specific trace ID from either the HTTP request trace IDs
   * or WebSocket trace IDs array, depending on the current communication method.
   * It uses the filter method to create a new array without the specified trace ID,
   * which is essential for cleanup when search operations complete or are cancelled.
   *
   * @param traceId - The unique trace identifier to remove from the collection.
   *                  Must be a string representing the trace ID to be removed
   * @returns void - No return value, modifies searchObj state directly
   *
   * @example
   * ```typescript
   * // Remove trace ID from HTTP communication
   * searchObj.communicationMethod = "http";
   * searchObj.data.searchRequestTraceIds = ["trace-123", "trace-456"];
   * removeTraceId("trace-123");
   * console.log(searchObj.data.searchRequestTraceIds); // ["trace-456"]
   *
   * // Attempting to remove non-existent trace ID (no effect)
   * removeTraceId("non-existent-id"); // Array remains unchanged
   * ```
   *
   * @throws {Error} Implicitly throws if searchObj or its data properties are undefined
   */
  const removeTraceId = (traceId: string): void => {
    // Validate input parameter
    if (!traceId || typeof traceId !== "string") {
      console.error("removeTraceId: traceId must be a non-empty string");
      return;
    }
    // Remove trace ID from HTTP request trace IDs array
    searchObj.data.searchRequestTraceIds =
      searchObj.data.searchRequestTraceIds.filter(
        (existingTraceId: string) => existingTraceId !== traceId,
      );
  };

  const shouldAddFunctionToSearch = () => {
    if (!isActionsEnabled.value)
      return (
        searchObj.data.tempFunctionContent != "" &&
        searchObj.meta.showTransformEditor
      );

    return (
      searchObj.data.transformType === "function" &&
      searchObj.data.tempFunctionContent != ""
    );
  };

  const addTransformToQuery = (queryReq: any) => {
    if (shouldAddFunctionToSearch()) {
      queryReq.query["query_fn"] =
        b64EncodeUnicode(searchObj.data.tempFunctionContent) || "";
    }

    // Add action ID if it exists
    if (
      searchObj.data.transformType === "action" &&
      searchObj.data.selectedTransform?.id
    ) {
      queryReq.query["action_id"] = searchObj.data.selectedTransform.id;
    }
  };

  const isActionsEnabled = computed(() => {
    return (
      (config.isEnterprise == "true" || config.isCloud == "true") &&
      store.state.zoConfig.actions_enabled
    );
  });

  /**
   * Helper function to calculate width of the column based on its content(from first 5 rows)
   * @param context - Canvas Context to calculate width of column using its content
   * @param field - Field name for which width needs to be calculated
   * @returns - Width of the column
   */
  const getColumnWidth = (context: any, field: string) => {
    // Font of table header
    context.font = "bold 14px sans-serif";
    let max = context.measureText(field).width + 16;

    // Font of the table content
    context.font = "12px monospace";
    let width = 0;
    try {
      for (let i = 0; i < 5; i++) {
        if (searchObj.data.queryResults.hits?.[i]?.[field]) {
          width = context.measureText(
            searchObj.data.queryResults.hits[i][field],
          ).width;

          if (width > max) max = width;
        }
      }
    } catch (err) {
      console.log("Error while calculation column width");
    }

    max += 24; // 24px padding

    if (max > 800) return 800;

    if (max < 150) return 150;

    return max;
  };

  const showCancelSearchNotification = () => {
    q.notify({
      message: "Running query cancelled successfully",
      color: "positive",
      position: "bottom",
      timeout: 4000,
    });
  };

  const generateURLQuery = (
    isShareLink: boolean = false,
    dashboardPanelData: any = null,
  ) => {
    const date = searchObj.data.datetime;

    const query: any = {};

    if (searchObj.data.stream.streamType) {
      query["stream_type"] = searchObj.data.stream.streamType;
    }

    if (
      searchObj.data.stream.selectedStream.length > 0 &&
      typeof searchObj.data.stream.selectedStream != "object"
    ) {
      query["stream"] = searchObj.data.stream.selectedStream.join(",");
    } else if (
      typeof searchObj.data.stream.selectedStream == "object" &&
      searchObj.data.stream.selectedStream.hasOwnProperty("value")
    ) {
      query["stream"] = searchObj.data.stream.selectedStream.value;
    } else {
      query["stream"] = searchObj.data.stream.selectedStream.join(",");
    }

    if (date.type == "relative") {
      if (isShareLink) {
        query["from"] = date.startTime;
        query["to"] = date.endTime;
      } else {
        query["period"] = date.relativeTimePeriod;
      }
    } else if (date.type == "absolute") {
      query["from"] = date.startTime;
      query["to"] = date.endTime;
    }

    query["refresh"] = searchObj.meta.refreshInterval;

    if (searchObj.data.query) {
      query["sql_mode"] = searchObj.meta.sqlMode;
      query["query"] = b64EncodeUnicode(searchObj.data.query.trim());
    }

    //add the function editor toggle is true or false
    //it will help to retain the function editor state when we refresh the page
    query["fn_editor"] = searchObj.meta.showTransformEditor;
    if (
      searchObj.data.transformType === "function" &&
      searchObj.data.tempFunctionContent != ""
    ) {
      query["functionContent"] = b64EncodeUnicode(
        searchObj.data.tempFunctionContent.trim(),
      );
    }

    // TODO : Add type in query params for all types
    if (searchObj.meta.pageType !== "logs") {
      query["type"] = searchObj.meta.pageType;
    }

    query["defined_schemas"] = searchObj.meta.useUserDefinedSchemas;
    query["org_identifier"] = store.state.selectedOrganization.identifier;
    query["quick_mode"] = searchObj.meta.quickMode;
    query["show_histogram"] = searchObj.meta.showHistogram;

    if (
      store.state.zoConfig?.super_cluster_enabled &&
      searchObj.meta?.regions?.length
    ) {
      query["regions"] = searchObj.meta.regions.join(",");
    }

    if (
      store.state.zoConfig?.super_cluster_enabled &&
      searchObj.meta?.clusters?.length
    ) {
      query["clusters"] = searchObj.meta.clusters.join(",");
    }

    if (searchObj.meta.logsVisualizeToggle) {
      query["logs_visualize_toggle"] = searchObj.meta.logsVisualizeToggle;
    }

    // Preserve visualization data in URL
    // - If in visualize mode and panel data is provided, encode the dashboardPanelData
    if (
      searchObj.meta.logsVisualizeToggle === "visualize" &&
      dashboardPanelData
    ) {
      const visualizationData = getVisualizationConfig(dashboardPanelData);
      if (visualizationData) {
        const encoded = encodeVisualizationConfig(visualizationData);
        if (encoded) {
          query["visualization_data"] = encoded;
        }
      }
    } else {
      // else preserve existing visualization data from the current URL
      const existingEncodedConfig = router.currentRoute.value?.query
        ?.visualization_data as string | undefined;
      if (existingEncodedConfig) {
        query["visualization_data"] = existingEncodedConfig;
      }
    }

    return query;
  };

  const updateUrlQueryParams = (dashboardPanelData: any = null) => {
    const query = generateURLQuery(false, dashboardPanelData);
    if (
      (Object.hasOwn(query, "type") && query.type == "search_history_re_apply") ||
      query.type == "search_scheduler"
    ) {
      delete query.type;
    }
    router.push({ query });
  };

  const isNonAggregatedSQLMode = (searchObj: any, parsedSQL: any) => {
    return !(
      searchObj.meta.sqlMode &&
      (isLimitQuery(parsedSQL) ||
        isDistinctQuery(parsedSQL) ||
        isWithQuery(parsedSQL) ||
        !searchObj.data.queryResults.is_histogram_eligible)
    );
  };

  const updatedLocalLogFilterField = (): void => {
    const identifier: string = searchObj.organizationIdentifier || "default";
    const selectedFields: any =
      useLocalLogFilterField()?.value != null
        ? useLocalLogFilterField()?.value
        : {};
    const stream = searchObj.data.stream.selectedStream.sort().join("_");
    selectedFields[`${identifier}_${stream}`] =
      searchObj.data.stream.selectedFields.filter(
        (_field) =>
          _field !== (store?.state?.zoConfig?.timestamp_column || "_timestamp"),
      );
    useLocalLogFilterField(selectedFields);
  };

  function isTimestampASC(orderby: any) {
    if (orderby) {
      for (const order of orderby) {
        if (
          order.expr &&
          order.expr.column === store.state.zoConfig.timestamp_column
        ) {
          if (order.type && order.type === "ASC") {
            return true;
          }
        }
      }
    }
    return false;
  }

  // validate if timestamp column alias is used for any field
  const checkTimestampAlias = (query: string): boolean => {
    const parsedSQL = fnParsedSQL(query);

    const columns = parsedSQL?.columns;
    if (Array.isArray(columns)) {
      const invalid = columns.some(
        (field: any) => field.as === timestampColumnName,
      );
      if (invalid) {
        return false;
      }
    }

    // Escape special regex characters in timestamp column name
    const escapedTimestamp = timestampColumnName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

    // Patterns for alias check
    const patterns = [
      new RegExp(`\\bas\\s*'${escapedTimestamp}'`, "i"), // AS '_timestamp'
      new RegExp(`\\bas\\s*"${escapedTimestamp}"`, "i"), // AS "_timestamp"
      new RegExp(`\\bas\\s+${escapedTimestamp}\\b`, "i"), // AS _timestamp (unquoted)
    ];

    if (patterns.some((p) => p.test(query))) {
      return false;
    }

    return true;
  };

  return {
    fnParsedSQL,
    fnUnparsedSQL,
    extractTimestamps,
    hasAggregation,
    isLimitQuery,
    isDistinctQuery,
    isWithQuery,
    addTraceId,
    removeTraceId,
    shouldAddFunctionToSearch,
    addTransformToQuery,
    isActionsEnabled,
    getColumnWidth,
    showCancelSearchNotification,
    generateURLQuery,
    updateUrlQueryParams,
    isNonAggregatedSQLMode,
    updatedLocalLogFilterField,
    isTimestampASC,
    checkTimestampAlias,
  };
};

export default logsUtils;
