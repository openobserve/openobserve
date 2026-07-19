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

import { computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import { b64EncodeUnicode, useLocalLogFilterField, } from "@/utils/zincutils";
import { canvasFont } from "@/utils/fonts";

import {
  encodeVisualizationConfig,
  getVisualizationConfig,
  encodeBuildConfig,
  getBuildConfig,
} from "@/composables/useLogs/logsVisualization";

import { searchState } from "@/composables/useLogs/searchState";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import {
  TimestampRange,
  ParsedSQLResult,
  TimePeriodUnit,
} from "@/ts/interfaces";
import { TIME_MULTIPLIERS } from "@/utils/logs/constants";
import { toast } from "@/lib/feedback/Toast/useToast";

interface SQLColumn {
  expr?: {
    type: string;
    name?: string;
  };
  as?: string;
}

/**
 * Recursively removes all WHERE conditions that reference `fieldName` from the
 * given AST node.  Works with AND / OR chains of any depth.
 *
 * The DataFusion SQL parser stores column references as:
 *   { type: "column_ref", column: { expr: { type: "...", value: "fieldName" } } }
 * rather than a plain string, so we extract the name via `col?.expr?.value`.
 *
 * Returns `null` when the entire sub-tree has been removed (caller should treat
 * a `null` WHERE as "no WHERE clause").
 */
export const removeFieldFromWhereAST = (
  whereNode: any,
  fieldName: string,
): any => {
  if (!whereNode) return null;

  const operator = whereNode.operator?.toUpperCase();

  if (operator === "AND" || operator === "OR") {
    const newLeft = removeFieldFromWhereAST(whereNode.left, fieldName);
    const newRight = removeFieldFromWhereAST(whereNode.right, fieldName);
    if (newLeft === null && newRight === null) return null;
    if (newLeft === null) return newRight;
    if (newRight === null) return newLeft;
    return { ...whereNode, left: newLeft, right: newRight };
  }

  if (whereNode.left?.type === "column_ref") {
    const col = whereNode.left.column;
    const colName =
      typeof col === "string"
        ? col.replace(/^"|"$/g, "")
        : col?.expr?.value != null
          ? String(col.expr.value)
          : null;
    if (colName === fieldName) return null;
  }

  return whereNode;
};

export const logsUtils = () => {
  const { searchObj } = searchState();
  let parser: Parser | null = new Parser();
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
   * Removes comment lines (starting with '--') before parsing with the DataFusion
   * SQL parser.
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
   * @param parsedObj - The parsed SQL object to convert back to string.
   *                    Can be a ParsedSQLResult interface or any AST object
   *                    from the SQL parser
   * @returns A SQL query string representation of the parsed object.
   *          Returns empty string if parsing fails or input is invalid
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
   * Parses a time period string (e.g., "5m", "2h", "1d") and returns a range from
   * the calculated past time to now. Supports s/m/h/d/w/M, with special handling
   * for months to account for variable month lengths.
   *
   * @param period - Time period string ending with unit (s/m/h/d/w/M)
   *                 Examples: "30s", "5m", "2h", "1d", "1w", "1M"
   * @returns Object containing 'from' and 'to' timestamps in milliseconds,
   *          or undefined if the period format is invalid
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
   * Checks the parsed column expressions for aggregation functions and the raw
   * query string for GROUP BY.
   *
   * @param columns - Array of parsed SQL column objects from the query AST
   * @returns true if aggregation is detected, false otherwise
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
   * @param parsedSQL - The parsed SQL AST object (typically from fnParsedSQL)
   * @returns true if a LIMIT clause with values is present, false otherwise
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
   * @param parsedSQL - The parsed SQL AST object (typically from fnParsedSQL)
   * @returns true if DISTINCT clause is present, false otherwise
   */
  const isDistinctQuery = (
    parsedSQL: ParsedSQLResult | any = null,
  ): boolean => {
    return parsedSQL?.distinct?.type === "DISTINCT";
  };

  /**
   * Determines if a parsed SQL query contains WITH clauses (Common Table Expressions).
   *
   * @param parsedSQL - The parsed SQL AST object (typically from fnParsedSQL)
   * @returns true if WITH clauses are present, false otherwise
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
   * Adds a trace ID to the search request trace-ID collection, skipping duplicates.
   *
   * @param traceId - The unique trace identifier to add to the collection.
   *                  Must be a non-empty string representing a valid trace ID
   * @returns void - No return value, modifies searchObj state directly
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
   * Removes a trace ID from the search request trace-ID collection.
   *
   * @param traceId - The unique trace identifier to remove from the collection.
   *                  Must be a string representing the trace ID to be removed
   * @returns void - No return value, modifies searchObj state directly
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
    // Font of table header — must match what actually renders, or the measured
    // width is wrong and cells truncate/overflow.
    context.font = canvasFont("14px", "sans", "bold");
    let max = context.measureText(field).width + 16;

    // Font of the table content
    context.font = canvasFont("12px", "mono");
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
    toast({
      variant: "info",
      message: "Running query cancelled successfully",
    });
  };

  const generateURLQuery = (
    isShareLink: boolean = false,
    dashboardPanelData: any = null,
    buildPanelData: any = null,
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

    // Preserve build data in URL
    // - If in build mode and build panel data is provided, encode the buildPanelData
    if (
      searchObj.meta.logsVisualizeToggle === "build" &&
      buildPanelData
    ) {
      const buildData = getBuildConfig(buildPanelData);
      if (buildData) {
        const encoded = encodeBuildConfig(buildData);
        if (encoded) {
          query["build_data"] = encoded;
        }
      }
    } else {
      // else preserve existing build data from the current URL
      const existingEncodedBuildConfig = router.currentRoute.value?.query
        ?.build_data as string | undefined;
      if (existingEncodedBuildConfig) {
        query["build_data"] = existingEncodedBuildConfig;
      }
    }

    return query;
  };

  const updateUrlQueryParams = (dashboardPanelData: any = null, buildPanelData: any = null) => {
    const query = generateURLQuery(false, dashboardPanelData, buildPanelData);
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
    // Don't persist a system-picked FTS default column. It is recomputed from
    // search results each time, so persisting it would leak a stale auto-pick
    // (e.g. "body") back into later searches and SQL mode as if the user had
    // chosen it. Only genuine user actions (pin/reorder/remove) clear this flag
    // and reach persistence.
    if (searchObj.meta?.isFtsDefaultColumn) {
      return;
    }
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
    const tsCol =
      timestampColumnName ?? store.state.zoConfig.timestamp_column ?? "_timestamp";
    const parsedSQL = fnParsedSQL(query);

    const columns = parsedSQL?.columns;
    if (Array.isArray(columns)) {
      const invalid = columns.some(
        (field: any) => field.as === tsCol,
      );
      if (invalid) {
        return false;
      }
    }

    // Escape special regex characters in timestamp column name
    const escapedTimestamp = tsCol.replace(
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
