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

import { searchState } from "@/composables/useLogs/searchState";
import { patternsState } from "@/composables/useLogs/usePatterns";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import {
  captureSeverityRequest,
  recordSeverityRequest,
} from "@/composables/useLogs/useLogSeverity";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { cloneDeep } from "lodash-es";
import { SearchRequestPayload } from "@/ts/interfaces/query";
import { getConsumableRelativeTime } from "@/utils/date";
import config from "@/aws-exports";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import { hasLimitClause } from "@/utils/query/nonSqlLimit";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import { buildFieldToGroupIdMap } from "@/utils/telemetryCorrelation";
import { Parser as SqlParser } from "@openobserve/node-sql-parser/build/datafusionsql";
import { buildContextualSqlMessage, isParserLimitation } from "@/utils/query/sqlDiagnostics";
import { maxParenDepth, SQL_PARSE_MAX_DEPTH } from "@/utils/query/sqlComplexity";
import { raw, type TranslateFn } from "@/types/i18n";
import {
  STREAM_NAME_FIELD,
  referencesStreamName,
  replaceStreamNameRefsInWhere,
} from "@/utils/logs/streamNameColumn";
import {
  pruneInterestingFields,
  selectableInterestingFields,
} from "@/utils/logs/interestingFields";
import {
  appendConjunct,
  materializeFreeText,
  renderPlan,
  type FilterPlan,
  type TextSearchTarget,
} from "@/utils/query/freeTextFilter";
import {
  buildFilterContext,
  freeTextDecorations,
  freeTextHighlight,
  markFreeTextBlocked,
  planStreamsFilter,
  type FilterResolveContext,
} from "@/composables/useLogs/freeTextSearch";

export { appendConjunct, materializeFreeText, planStreamsFilter, type FilterResolveContext };

export const NON_SQL_LIMIT_MESSAGE =
  "LIMIT is not supported without SQL mode. Remove it from the filter.";

const BLOCKED_TARGET: TextSearchTarget = { mode: "blocked", candidates: [] };

/** What the multi-stream field check needs beyond the filter context. */
export interface MultiStreamFieldContext {
  selectedStreamFields: { name: string; streams?: string[] }[];
  fieldToGroupId: Map<string, string>;
  parse: (sql: string) => any;
  unparse: (ast: any) => string;
}

export interface StreamFilter {
  where: string | null;
  blocked: boolean;
  sqlNodesOnly: string;
  plan: FilterPlan;
}

export type ExclusionReason = "missing_field" | "no_fts";

export interface StreamExclusion {
  stream: string;
  reason: ExclusionReason;
}

export interface FilterFieldError {
  kind: "mismatch" | "missing";
  field: string;
}

export interface ResolvedStreamFilters {
  perStream: Map<string, string>;
  excluded: StreamExclusion[];
  errors: FilterFieldError[];
  filterColumns: any[];
  fieldMapping: Map<string, Record<string, string>> | null;
  plan: FilterPlan;
}

export class NonSqlLimitError extends Error {
  constructor() {
    super(NON_SQL_LIMIT_MESSAGE);
    this.name = "NonSqlLimitError";
  }
}

// Walk the WHERE clause AST and replace column references whose name matches
// a key in the fieldMapping (original field → stream-specific field).
const replaceColumnRefsInWhere = (node: any, fieldMapping: Record<string, string>): void => {
  if (!node) return;

  if (node.type === "column_ref") {
    const col = node.column;
    const colName: string | null =
      typeof col === "string"
        ? col.replace(/^"|"$/g, "")
        : col?.expr?.value != null
          ? String(col.expr.value)
          : null;
    if (colName !== null && fieldMapping[colName] && fieldMapping[colName] !== colName) {
      const newName = fieldMapping[colName];
      if (typeof col === "string") {
        node.column = `"${newName}"`;
      } else if (col?.expr) {
        col.expr.value = newName;
      }
    }
    return;
  }

  // Recurse into binary expressions (WHERE conditions) and other containers
  replaceColumnRefsInWhere(node.left, fieldMapping);
  replaceColumnRefsInWhere(node.right, fieldMapping);
  replaceColumnRefsInWhere(node.args, fieldMapping);
  if (node.expr) replaceColumnRefsInWhere(node.expr, fieldMapping);
};

const stripCommentLines = (text: string): string =>
  text
    .split("\n")
    .filter((line: string) => !line.trim().startsWith("--"))
    .join("\n");

const columnName = (column: any): string | null => {
  if (typeof column === "string") return column.replace(/^"|"$/g, "");
  return column?.expr?.value != null ? String(column.expr.value) : null;
};

const extractFilterColumnsOf = (expression: any): any[] => {
  const columns: any[] = [];
  const traverse = (node: any) => {
    if (!node) return;
    if (node.type === "column_ref") {
      columns.push(node.column);
    } else if (node.type === "binary_expr") {
      traverse(node.left);
      traverse(node.right);
    } else if (node.type === "function" && node.args?.type === "expr_list") {
      node.args.value.forEach((arg: any) => traverse(arg));
    }
  };
  traverse(expression);
  return columns;
};

/** Field check for multi-stream filters: errors, the streams each field misses, and semantic equivalents. */
const checkFilterFields = (filter: string, streams: string[], fields: MultiStreamFieldContext) => {
  const parsed = fields.parse("select * from stream where " + filter);
  const filterColumns = extractFilterColumnsOf(parsed?.where);
  const errors: FilterFieldError[] = [];
  const missing = new Set<string>();
  let mapping: Map<string, Record<string, string>> | null = null;

  for (const column of filterColumns) {
    const fieldName = columnName(column);
    // Not a stored field: the arm rewrite resolves it per stream.
    if (fieldName === null || fieldName === STREAM_NAME_FIELD) continue;
    const matching = fields.selectedStreamFields.filter((field) => field.name === fieldName);
    if (matching.length > 0) {
      const count = matching[0].streams?.length ?? 0;
      if (!matching.every((field) => (field.streams?.length ?? 0) === count)) {
        errors.push({ kind: "mismatch", field: fieldName });
      }
    }

    const fieldStreams = matching.flatMap((field) => field.streams ?? []);
    let missingForField = streams.filter((stream) => !fieldStreams.includes(stream));
    if (missingForField.length === 0) continue;

    const groupId = fields.fieldToGroupId.get(fieldName.toLowerCase());
    if (groupId) {
      missingForField = missingForField.filter((stream) => {
        const equivalent = fields.selectedStreamFields.find(
          (field) =>
            field.streams?.includes(stream) &&
            fields.fieldToGroupId.get(field.name.toLowerCase()) === groupId,
        );
        if (!equivalent) return true;
        mapping = mapping ?? new Map();
        mapping.set(stream, { ...(mapping.get(stream) ?? {}), [fieldName]: equivalent.name });
        return false;
      });
    }
    if (matching.length === 0 && missingForField.length === streams.length) {
      errors.push({ kind: "missing", field: fieldName });
    }
    missingForField.forEach((stream) => missing.add(stream));
  }
  return {
    errors,
    missing,
    mapping: mapping as Map<string, Record<string, string>> | null,
    filterColumns,
  };
};

// The arm's semantic-field and _stream_name rewrite, applied to a probe statement's WHERE body.
const rewriteArmWhere = (
  where: string,
  stream: string,
  mapping: Record<string, string> | undefined,
  fields: MultiStreamFieldContext,
): string => {
  const parsed = fields.parse(`select * from "${stream}" WHERE ${where}`);
  if (!parsed?.where) return where;
  if (mapping) replaceColumnRefsInWhere(parsed.where, mapping);
  parsed.where = replaceStreamNameRefsInWhere(parsed.where, stream);
  const unparsed = fields.unparse(parsed).replace(/`/g, '"');
  const at = unparsed.search(/\sWHERE\s/i);
  return at < 0 ? where : unparsed.slice(at).replace(/^\sWHERE\s/i, "");
};

/** Single-stream filter normalisation; `where` is null only when text has nowhere to search. */
export function resolveStreamFilter(
  raw: string,
  stream: string,
  ctx: FilterResolveContext,
): StreamFilter {
  const filter = raw.trim();
  if (hasLimitClause(stripCommentLines(filter))) throw new NonSqlLimitError();
  const plan = planStreamsFilter(filter, [stream], ctx);
  if (plan.kind !== "freeText") {
    const where = renderPlan(plan, BLOCKED_TARGET, ctx.knownFields) ?? "";
    return { where, blocked: false, sqlNodesOnly: where, plan };
  }
  const where = renderPlan(plan, ctx.targets[stream] ?? BLOCKED_TARGET, ctx.knownFields);
  return { where, blocked: where === null, sqlNodesOnly: "", plan };
}

/** Per-arm filters plus the union of missing-field and no-FTS exclusions. */
export function resolveFiltersForStreams(
  raw: string,
  streams: string[],
  ctx: FilterResolveContext,
  fields?: MultiStreamFieldContext,
): ResolvedStreamFilters {
  const filter = raw.trim();
  if (hasLimitClause(stripCommentLines(filter))) throw new NonSqlLimitError();
  const plan = planStreamsFilter(filter, streams, ctx);
  const result: ResolvedStreamFilters = {
    perStream: new Map(),
    excluded: [],
    errors: [],
    filterColumns: [],
    fieldMapping: null,
    plan,
  };

  if (plan.kind === "freeText") {
    for (const stream of streams) {
      const where = renderPlan(plan, ctx.targets[stream] ?? BLOCKED_TARGET, ctx.knownFields);
      if (where === null) result.excluded.push({ stream, reason: "no_fts" });
      else result.perStream.set(stream, where);
    }
    return result;
  }

  const where = renderPlan(plan, BLOCKED_TARGET, ctx.knownFields) ?? "";
  if (where.trim() === "" || !fields) {
    streams.forEach((stream) => result.perStream.set(stream, where));
    return result;
  }

  const check = checkFilterFields(filter, streams, fields);
  result.errors = check.errors;
  result.filterColumns = check.filterColumns;
  result.fieldMapping = check.mapping;
  for (const stream of streams) {
    if (check.missing.has(stream)) {
      result.excluded.push({ stream, reason: "missing_field" });
      continue;
    }
    const mapping = check.mapping?.get(stream);
    result.perStream.set(
      stream,
      mapping || referencesStreamName(where)
        ? rewriteArmWhere(where, stream, mapping, fields)
        : where,
    );
  }
  return result;
}

export const useSearchQuery = (t: TranslateFn) => {
  const store = useStore();
  const router = useRouter();
  const {
    fnParsedSQL,
    hasAggregation,
    isDistinctQuery,
    isWithQuery,
    isLimitQuery,
    addTransformToQuery,
    updateUrlQueryParams,
    fnUnparsedSQL,
    checkTimestampAlias,
  } = logsUtils();

  const { searchObj, notificationMsg, initialQueryPayload, searchAggData } = searchState();

  const { semanticGroups } = useServiceCorrelation();

  const filterContext = (): FilterResolveContext =>
    buildFilterContext(searchObj, store.state.zoConfig);

  const multiStreamFields = (): MultiStreamFieldContext => ({
    selectedStreamFields: searchObj.data.stream.selectedStreamFields,
    fieldToGroupId: buildFieldToGroupIdMap(semanticGroups.value),
    parse: (sql: string) => fnParsedSQL(sql),
    unparse: (ast: any) => fnUnparsedSQL(ast),
  });

  const getQueryReq = (isPagination: boolean): SearchRequestPayload | null => {
    searchObj.data.highlightQuery = "";
    searchObj.data.freeTextBlocked = null;

    if (!isPagination) {
      searchObj.data.queryResults = {};
    }

    searchObj.meta.showDetailTab = false;
    searchObj.meta.searchApplied = true;
    searchObj.data.functionError = "";

    searchAggData.total = 0;
    searchAggData.hasAggregation = false;

    if (
      !searchObj.data.stream.streamLists?.length ||
      searchObj.data.stream.selectedStream.length == 0
    ) {
      searchObj.loading = false;
      return null;
    }

    if (Number.isNaN(searchObj.data.datetime.endTime))
      searchObj.data.datetime.endTime = "Invalid Date";
    if (Number.isNaN(searchObj.data.datetime.startTime))
      searchObj.data.datetime.startTime = "Invalid Date";

    const queryReq: SearchRequestPayload | null = buildSearch();
    if (queryReq) {
      recordSeverityRequest(
        captureSeverityRequest(searchObj, !!queryReq.query?.quick_mode, () => fnParsedSQL()),
      );
    }

    // Keep the query's case: str_match and re_match highlight case-sensitively.
    if (searchObj.meta.sqlMode) {
      searchObj.data.highlightQuery = searchObj.data.query.split(/where/i)?.[1] || "";
      searchObj.data.freeTextDecorations = null;
    } else {
      const ctx = filterContext();
      searchObj.data.highlightQuery = freeTextHighlight(searchObj, ctx) ?? searchObj.data.query;
      if (!isPagination) {
        searchObj.data.freeTextDecorations = freeTextDecorations(searchObj, ctx, (key, params) =>
          t(key, params ?? {}),
        );
      }
    }

    if (queryReq === null) {
      searchObj.loading = false;
      // A stale code from the previous run would otherwise pick the error cards.
      searchObj.data.errorCode = 0;
      if (searchObj.data.freeTextBlocked) return null;
      if (!notificationMsg.value) {
        notificationMsg.value = t("search.searchQueryEmptyOrInvalid");
      } else {
        searchObj.data.errorMsg = notificationMsg.value;
      }
      return null;
    }

    if (!queryReq) {
      searchObj.loading = false;
      throw new Error(notificationMsg.value || t("search.somethingWentWrongCreatingSearchRequest"));
    }

    // get function definition
    addTransformToQuery(queryReq);

    if (searchObj.data.datetime.type === "relative") {
      if (!isPagination) initialQueryPayload.value = cloneDeep(queryReq);
      else {
        if (
          searchObj.meta.refreshInterval == 0 &&
          router.currentRoute.value.name == "logs" &&
          Object.prototype.hasOwnProperty.call(searchObj.data.queryResults, "hits")
        ) {
          const start_time: number = initialQueryPayload.value?.query?.start_time || 0;
          const end_time: number = initialQueryPayload.value?.query?.end_time || 0;
          queryReq.query.start_time = start_time;
          queryReq.query.end_time = end_time;
        }
      }
    }

    // copy query request for histogram query and same for customDownload
    searchObj.data.histogramQuery = JSON.parse(JSON.stringify(queryReq));

    // reset errorCode
    searchObj.data.errorCode = 0;

    //here we need to send the actual sql query for histogram
    searchObj.data.histogramQuery.query.sql = queryReq.query.sql;
    searchObj.data.histogramQuery.query.size = -1;
    delete searchObj.data.histogramQuery.query.quick_mode;
    delete searchObj.data.histogramQuery.query.from;
    delete searchObj.data.histogramQuery.aggs;
    delete queryReq.aggs;

    searchObj.data.customDownloadQueryObj = JSON.parse(JSON.stringify(queryReq));

    queryReq.query.from =
      (searchObj.data.resultGrid.currentPage - 1) * searchObj.meta.resultGrid.rowsPerPage;

    // Use configurable scan size when patterns mode is enabled to get data for pattern extraction
    queryReq.query.size =
      searchObj.meta.logsVisualizeToggle === "patterns"
        ? patternsState.value.scanSize
        : searchObj.meta.resultGrid.rowsPerPage;

    const parsedSQL: any = fnParsedSQL();

    searchObj.meta.resultGrid.showPagination = true;

    if (searchObj.meta.sqlMode == true) {
      // if query has aggregation or groupby then we need to set size to -1 to get all records
      // BUT: Don't override size when patterns mode is enabled - we need the configured scan size for pattern extraction
      if (
        (hasAggregation(parsedSQL?.columns) || parsedSQL.groupby != null) &&
        searchObj.meta.logsVisualizeToggle !== "patterns"
      ) {
        queryReq.query.size = -1;
      }

      // Don't apply LIMIT from SQL when patterns mode is enabled - we need the configured scan size for pattern extraction
      if (isLimitQuery(parsedSQL) && searchObj.meta.logsVisualizeToggle !== "patterns") {
        queryReq.query.size = parsedSQL.limit.value[0].value;
        searchObj.meta.resultGrid.showPagination = false;

        if (parsedSQL.limit.separator == "offset") {
          queryReq.query.from = parsedSQL.limit.value[1].value || 0;
        }
        delete queryReq.query.track_total_hits;
      }

      if (
        isDistinctQuery(parsedSQL) ||
        isWithQuery(parsedSQL) ||
        !searchObj.data.queryResults.is_histogram_eligible
      ) {
        delete queryReq.query.track_total_hits;
      }
    }

    return queryReq;
  };

  /**
   * Build search query payload with optional read-only mode
   *
   * Constructs the complete query payload for search operations. Can operate in two modes:
   * 1. Normal mode (readOnly=false): Builds query AND mutates searchObj state (clears errors, updates timestamps, etc.)
   * 2. Read-only mode (readOnly=true): Builds query WITHOUT mutating searchObj state
   *
   * Read-only mode is used for operations that need the query structure but shouldn't
   * affect the current search state (e.g., EXPLAIN/ANALYZE queries in QueryPlanDialog).
   *
   * Mutations that are skipped in read-only mode:
   * - searchObj.data.filterErrMsg, missingStreamMessage, missingStreamMultiStreamFilter
   * - searchObj.data.stream.interestingFieldList (creates filtered copy instead)
   * - searchObj.data.datetime timestamps
   * - searchObj.meta.resultGrid.chartKeyFormat and chartInterval
   * - searchObj.data.queryResults.hits (not cleared when LIMIT is present)
   *
   * @param readOnly - If true, prevents all mutations to searchObj (default: false)
   * @returns SearchRequestPayload - The constructed query payload, or null on error
   */
  const buildSearch = (
    readOnly: boolean = false,
    ignoreQuickMode: boolean = false,
  ): SearchRequestPayload | null => {
    try {
      let query = searchObj.data.query.trim();

      // Only clear error messages in normal mode
      if (!readOnly) {
        searchObj.data.filterErrMsg = "";
        searchObj.data.missingStreamMessage = "";
        searchObj.data.stream.missingStreamMultiStreamFilter = [];
        searchObj.data.freeTextExcluded = [];
        searchObj.data.freeTextBlocked = null;
        searchObj.data.sqlSyntaxErrorRanges = [];
      }

      // Pre-flight SQL syntax check — runs only in SQL mode, before firing the query.
      // Skipped past SQL_PARSE_MAX_DEPTH: astify() is exponential in paren nesting
      // depth and would freeze the tab for seconds; the server still validates.
      if (
        !readOnly &&
        searchObj.meta.sqlMode &&
        query &&
        maxParenDepth(query) <= SQL_PARSE_MAX_DEPTH
      ) {
        try {
          const _sqlParser = new SqlParser();
          _sqlParser.astify(query);
        } catch (syntaxErr: any) {
          // Suppress parser-limitation false positives — these are valid SQL
          // constructs the PEG parser can't handle (e.g. SUM(COUNT(*)) OVER,
          // COALESCE in PARTITION BY) but the DataFusion backend accepts.
          if (isParserLimitation(syntaxErr)) {
            // continue past the error — don't block the query
          } else {
            const loc = syntaxErr?.location?.start;
            const line = loc?.line ?? 1;
            const col = loc?.column ?? 1;
            const msg = buildContextualSqlMessage(query, syntaxErr);
            searchObj.data.errorMsg = t("search.sqlSyntaxErrorDetail", {
              line,
              column: col,
              message: msg,
            });
            searchObj.data.sqlSyntaxErrorRanges = [
              // msg is string|null; `!` is compile-time only (null passes through unchanged).
              { startLine: line, endLine: line, column: col, error: msg! },
            ];
          }
        }
      }

      const req: any = {
        query: {
          sql: searchObj.meta.sqlMode
            ? query
            : 'select [FIELD_LIST][QUERY_FUNCTIONS] from "[INDEX_NAME]" [WHERE_CLAUSE]',
          start_time: (new Date().getTime() - 900000) * 1000,
          end_time: new Date().getTime() * 1000,
          from:
            searchObj.meta.resultGrid.rowsPerPage * (searchObj.data.resultGrid.currentPage - 1) ||
            0,
          size: searchObj.meta.resultGrid.rowsPerPage,
          quick_mode: searchObj.meta.quickMode && !ignoreQuickMode,
        },
      };

      if (config.isEnterprise == "true" && store.state.zoConfig.super_cluster_enabled) {
        req["regions"] = searchObj.meta.regions;
        req["clusters"] = searchObj.meta.clusters;
      }

      // Read-only must not mutate the list; see interestingFields.ts for the predicate.
      const interestingFields: string[] = readOnly
        ? selectableInterestingFields(
            searchObj.data.stream.interestingFieldList,
            searchObj.data.stream.selectedStreamFields,
          )
        : pruneInterestingFields(
            searchObj.data.stream.interestingFieldList,
            searchObj.data.stream.selectedStreamFields,
          );

      // Replace field list placeholder with appropriate values
      if (interestingFields.length > 0 && searchObj.meta.quickMode && !ignoreQuickMode) {
        if (searchObj.data.stream.selectedStream.length == 1) {
          req.query.sql = req.query.sql.replace(
            "[FIELD_LIST]",
            interestingFields.map((field: string) => quoteSqlIdentifierIfNeeded(field)).join(","),
          );
        }
      } else if (searchObj.data.stream.selectedStream.length <= 1) {
        req.query.sql = req.query.sql.replace("[FIELD_LIST]", "*");
      }

      const timestamps: any =
        searchObj.data.datetime.type === "relative"
          ? getConsumableRelativeTime(searchObj.data.datetime.relativeTimePeriod)
          : cloneDeep(searchObj.data.datetime);

      // Only mutate datetime timestamps in normal mode.
      // Guard shouldIgnoreWatcher so the datetime watcher in Index.vue does not
      // re-fire runQueryFn when we update these values internally — otherwise
      // every buildSearch() call on a relative time range would trigger the
      // watcher and create an infinite query loop.
      if (searchObj.data.datetime.type === "relative" && !readOnly) {
        searchObj.shouldIgnoreWatcher = true;
        searchObj.data.datetime.startTime = timestamps.startTime;
        searchObj.data.datetime.endTime = timestamps.endTime;
        // Reset on next tick so the watcher has a chance to observe the flag
        // before processing any pending reactive updates.
        Promise.resolve().then(() => {
          searchObj.shouldIgnoreWatcher = false;
        });
      }

      if (timestamps.startTime != "Invalid Date" && timestamps.endTime != "Invalid Date") {
        if (timestamps.startTime > timestamps.endTime) {
          notificationMsg.value = t("search.startTimeGreaterThanEndTime");
          return null;
        }

        // Only set chartKeyFormat in normal mode
        if (!readOnly) {
          searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";
        }

        req.query.start_time = timestamps.startTime;
        req.query.end_time = timestamps.endTime;

        // Only set chart interval in normal mode
        if (!readOnly) {
          setChartInterval(req);
        }
      } else {
        if (timestamps.startTime == "Invalid Date") {
          notificationMsg.value = t("search.selectedStartTimeInvalid");
        } else if (timestamps.endTime == "Invalid Date") {
          notificationMsg.value = t("search.selectedEndTimeInvalid");
        } else {
          notificationMsg.value = t("search.invalidDateFormat");
        }
        return null;
      }

      if (searchObj.meta.sqlMode == true) {
        return handleSqlMode(query, req, readOnly);
      } else {
        return handleNonSqlMode(query, req, ignoreQuickMode, readOnly);
      }
    } catch (e: any) {
      notificationMsg.value = t("search.errorConstructingSearchQuery");
      return null;
    }
  };

  const setChartInterval = (req: any) => {
    const timeDiff = req.query.end_time - req.query.start_time;

    searchObj.meta.resultGrid.chartInterval = "10 second";
    searchObj.meta.resultGrid.chartKeyFormat = "HH:mm:ss";

    if (timeDiff >= 1000000 * 60 * 30) {
      searchObj.meta.resultGrid.chartInterval = "15 second";
    }
    if (timeDiff >= 1000000 * 60 * 60) {
      searchObj.meta.resultGrid.chartInterval = "30 second";
    }
    if (timeDiff >= 1000000 * 3600 * 2) {
      searchObj.meta.resultGrid.chartInterval = "1 minute";
      searchObj.meta.resultGrid.chartKeyFormat = "MM-DD HH:mm";
    }
    if (timeDiff >= 1000000 * 3600 * 6) {
      searchObj.meta.resultGrid.chartInterval = "5 minute";
    }
    if (timeDiff >= 1000000 * 3600 * 24) {
      searchObj.meta.resultGrid.chartInterval = "30 minute";
    }
    if (timeDiff >= 1000000 * 86400 * 7) {
      searchObj.meta.resultGrid.chartInterval = "1 hour";
    }
    if (timeDiff >= 1000000 * 86400 * 30) {
      searchObj.meta.resultGrid.chartInterval = "1 day";
      searchObj.meta.resultGrid.chartKeyFormat = "YYYY-MM-DD";
    }
  };

  const handleSqlMode = (
    query: string,
    req: any,
    readOnly: boolean = false,
  ): SearchRequestPayload | null => {
    // Only mutate query in normal mode
    if (!readOnly) {
      searchObj.data.query = query;
    }
    const parsedSQL: any = fnParsedSQL();

    if (parsedSQL != undefined) {
      if (!checkTimestampAlias(searchObj.data.query)) {
        const errorMsg = t("search.aliasNotAllowed", {
          alias: store.state.zoConfig.timestamp_column || "_timestamp",
        });
        notificationMsg.value = errorMsg;
        return null;
      }

      if (Array.isArray(parsedSQL) && parsedSQL.length == 0) {
        notificationMsg.value = t("search.sqlQueryMissingOrInvalid");
        return null;
      }

      if (!parsedSQL?.columns?.length && !searchObj.meta.sqlMode) {
        notificationMsg.value = t("search.noColumnFoundInStream");
        return null;
      }

      if (parsedSQL.limit != null && parsedSQL.limit.value.length != 0) {
        req.query.size = parsedSQL.limit.value[0].value;

        if (parsedSQL.limit.separator == "offset") {
          req.query.from = parsedSQL.limit.value[1].value || 0;
        }

        query = fnUnparsedSQL(parsedSQL);
        query = query.replace(/`/g, '"');

        // CRITICAL: Only clear queryResults.hits in normal mode
        // This prevents resetting the logs page results when opening QueryPlanDialog
        if (!readOnly) {
          searchObj.data.queryResults.hits = [];
        }
      }
    }

    req.query.sql = query
      .split("\n")
      .filter((line: string) => !line.trim().startsWith("--"))
      .join("\n");
    req.query["sql_mode"] = "full";

    return finalizeRequest(req);
  };

  /**
   * Convenience wrapper for read-only mode
   * Use this when you need the query payload without mutating searchObj
   */
  const getSearchQueryPayload = (): SearchRequestPayload | null => {
    return buildSearch(true);
  };

  const handleNonSqlMode = (
    query: string,
    req: any,
    ignoreQuickMode: boolean = false,
    readOnly: boolean = false,
  ): SearchRequestPayload | null => {
    req.query.sql = req.query.sql.replace("[QUERY_FUNCTIONS]", "");

    if (searchObj.data.stream.selectedStream.length > 1) {
      return handleMultiStream(query, req, ignoreQuickMode, readOnly);
    }

    const stream = searchObj.data.stream.selectedStream[0];
    let resolved: StreamFilter;
    try {
      // A LIMIT spliced into the WHERE body breaks the histogram query, so the resolver refuses it.
      resolved = resolveStreamFilter(query, stream, filterContext());
    } catch (e) {
      if (!(e instanceof NonSqlLimitError)) throw e;
      notificationMsg.value = NON_SQL_LIMIT_MESSAGE;
      return null;
    }

    if (resolved.where === null) {
      if (!readOnly) markFreeTextBlocked(searchObj, [stream], resolved.plan);
      return null;
    }

    const whereClause = resolved.where;
    if (whereClause.trim() != "") {
      req.query.sql = req.query.sql.split("[WHERE_CLAUSE]").join(" WHERE " + whereClause);
    } else {
      req.query.sql = req.query.sql.replace("[WHERE_CLAUSE]", "");
    }
    req.query.sql = req.query.sql.replace("[INDEX_NAME]", stream);

    return finalizeRequest(req);
  };

  const armProjection = (stream: string, ignoreQuickMode: boolean): string => {
    if (!searchObj.meta.quickMode || ignoreQuickMode) {
      return "*";
    }

    const timestampCol = store.state.zoConfig.timestamp_column || "_timestamp";
    const fields = searchObj.data.stream.interestingFieldList.filter((field: string) =>
      searchObj.data.stream.selectedStreamFields.some(
        (streamField: any) => streamField?.name === field && streamField?.streams?.includes(stream),
      ),
    );

    if (fields.length === 0) {
      return "*";
    }

    // A set operation is never rewritten by AddTimestampVisitor, so the arm must ask for _timestamp.
    return [timestampCol, ...fields.filter((field: string) => field !== timestampCol)]
      .map((field: string) => quoteSqlIdentifierIfNeeded(field))
      .join(",");
  };

  const writeMultiStreamState = (resolved: ResolvedStreamFilters) => {
    searchObj.data.stream.filteredField = resolved.filterColumns;
    searchObj.data.filterErrMsg = resolved.errors
      .map((error) =>
        error.kind === "mismatch"
          ? t("search.fieldStreamCountMismatch", { field: error.field })
          : t("search.fieldMissingInStreams", { field: error.field }),
      )
      .join("");

    const missing = resolved.excluded.filter((e) => e.reason === "missing_field");
    const noFts = resolved.excluded.filter((e) => e.reason === "no_fts");
    searchObj.data.stream.missingStreamMultiStreamFilter = resolved.excluded.map((e) => e.stream);
    searchObj.data.freeTextExcluded = noFts.map((e) => e.stream);
    searchObj.data.missingStreamMessage = [
      missing.length
        ? t("search.missingStreamFilterFields", {
            streams: missing.map((e) => e.stream).join(", "),
          })
        : "",
      noFts.length
        ? t("search.freeTextNotSearched", { streams: noFts.map((e) => e.stream).join(", ") })
        : "",
    ]
      .filter((message) => message !== "")
      .join(" ");
  };

  const handleMultiStream = (
    query: string,
    req: any,
    ignoreQuickMode: boolean = false,
    readOnly: boolean = false,
  ): SearchRequestPayload | null => {
    // A stream listed twice would emit two identical arms and duplicate every row.
    const selected: string[] = [
      ...new Set<string>(searchObj.data.stream.selectedStream.join(",").split(",")),
    ].filter((stream: string) => stream.trim() !== "");

    let resolved: ResolvedStreamFilters;
    try {
      resolved = resolveFiltersForStreams(query, selected, filterContext(), multiStreamFields());
    } catch (e) {
      if (!(e instanceof NonSqlLimitError)) throw e;
      notificationMsg.value = NON_SQL_LIMIT_MESSAGE;
      return null;
    }
    if (!readOnly) writeMultiStreamState(resolved);
    if (resolved.errors.length > 0) return null;

    const streams = selected.filter((stream) => resolved.perStream.has(stream));
    if (streams.length === 0) {
      const noFts = resolved.excluded.filter((e) => e.reason === "no_fts").map((e) => e.stream);
      if (!readOnly && noFts.length > 0) markFreeTextBlocked(searchObj, noFts, resolved.plan);
      return null;
    }

    const preSQLQuery = req.query.sql;
    const arms: string[] = streams.map((item: string) => {
      const where = resolved.perStream.get(item) ?? "";
      const finalQuery =
        where.trim() != ""
          ? preSQLQuery.split("[WHERE_CLAUSE]").join(" WHERE " + where)
          : preSQLQuery.replace("[WHERE_CLAUSE]", "");
      return finalQuery
        .replace("[INDEX_NAME]", item)
        .replace(
          "[FIELD_LIST]",
          `${armProjection(item, ignoreQuickMode)}, '${item}' as _stream_name`,
        );
    });

    // BY NAME merges differing columns, ALL keeps duplicate events, and a set operation gets no implicit ORDER BY.
    req.query.sql =
      arms.length > 1
        ? `${arms.join(" UNION ALL BY NAME ")} ORDER BY ${
            store.state.zoConfig.timestamp_column || "_timestamp"
          } DESC`
        : arms[0];

    return req;
  };

  const finalizeRequest = (req: any): SearchRequestPayload => {
    if (searchObj.data.resultGrid.currentPage > 1 || searchObj.meta.showHistogram === false) {
      if (searchObj.meta.showHistogram === false) {
        searchObj.data.histogram = {
          xData: [],
          yData: [],
          breakdownField: null,
          breakdownSeries: null,
          chartParams: {
            title: raw(""),
            titleParts: null,
            unparsed_x_data: [],
            timezone: "",
          },
          errorCode: 0,
          errorMsg: "",
          errorDetail: "",
        };
        searchObj.meta.histogramDirtyFlag = true;
      } else {
        searchObj.meta.histogramDirtyFlag = false;
      }
    }

    if (store.state.zoConfig.sql_base64_enabled) {
      req["encoding"] = "base64";
      req.query.sql = b64EncodeUnicode(req.query.sql);
    }

    updateUrlQueryParams();
    return req;
  };

  /** Field check for a filter's SQL nodes (default: the editor filter); writes the banner state. */
  const validateFilterForMultiStream = (filter: string = searchObj.data.query): boolean => {
    searchObj.data.filterErrMsg = "";
    searchObj.data.missingStreamMessage = "";
    searchObj.data.stream.missingStreamMultiStreamFilter = [];
    const streams: string[] = searchObj.data.stream.selectedStream;
    try {
      writeMultiStreamState(
        resolveFiltersForStreams(filter, streams, filterContext(), multiStreamFields()),
      );
    } catch (e) {
      if (!(e instanceof NonSqlLimitError)) throw e;
    }
    return searchObj.data.filterErrMsg === "";
  };

  const extractFilterColumns = (expression: any): any[] => extractFilterColumnsOf(expression);

  return {
    getQueryReq,
    buildSearch,
    getSearchQueryPayload,
    validateFilterForMultiStream,
    extractFilterColumns,
  };
};

export default useSearchQuery;
