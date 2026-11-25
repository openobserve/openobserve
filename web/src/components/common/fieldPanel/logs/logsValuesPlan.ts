// Copyright 2026 OpenObserve Inc.

import { cloneDeep } from "lodash-es";
import type { TranslateFn } from "@/types/i18n";
import type { SearchObject } from "@/composables/useLogs/searchState";
import {
  removeFieldFromWhereAST,
  type ExtendedParsedSQLResult,
} from "@/composables/useLogs/logsUtils";
import {
  freeTextWhereByStream,
  isFilterHeld,
  type FreeTextZoConfig,
} from "@/composables/useLogs/freeTextSearch";
import { enrichmentValuesRange, type FieldValuesRequest } from "@/composables/useFieldValuesStream";
import { addSpacesToOperators, b64EncodeUnicode } from "@/utils/zincutils";
import { getConsumableRelativeTime } from "@/utils/date";
import { quoteFieldNames } from "@/utils/query/quoteFieldNames";

const INDEX_PLACEHOLDER = "[INDEX_NAME]";

export interface TimeRange {
  startTime: number;
  endTime: number;
}

export interface ValuesPlan {
  error?: string;
  payloads: FieldValuesRequest[];
}

export interface ValuesPlanDeps {
  searchObj: SearchObject;
  zoConfig: () => FreeTextZoConfig & { query_values_default_num?: number };
  t: TranslateFn;
  fnParsedSQL: (sql: string) => ExtendedParsedSQLResult;
  fnUnparsedSQL: (ast: unknown) => string;
  extractValueQuery: () => Record<string, string>;
}

/** A schema-field name typed bare in quick mode is quoted so reserved words parse as columns. */
export const quoteSchemaFieldsInWhere = (whereClause: string, fieldNames: string[]): string =>
  quoteFieldNames(addSpacesToOperators(whereClause), fieldNames);

/** The range a values request covers: the page's range, or the documents of an enrichment table. */
export const valuesTimeRange = (searchObj: SearchObject): TimeRange => {
  const datetime = searchObj.data.datetime;
  let range =
    datetime.type === "relative"
      ? getConsumableRelativeTime(datetime.relativeTimePeriod)
      : cloneDeep(datetime);
  if (searchObj.data.stream.streamType === "enrichment_tables") {
    const stream = searchObj.data.streamResults?.list?.find((entry: { name: string }) =>
      searchObj.data.stream.selectedStream.includes(entry.name),
    );
    if (stream?.stats) range = enrichmentValuesRange(stream.stats);
  }
  return { startTime: range?.startTime || 0, endTime: range?.endTime || 0 };
};

// Per-stream SQL-mode queries name the placeholder bare, so it is unquoted first and every stream goes in double-quoted.
const withStreamName = (sql: string, stream: string): string =>
  sql
    .replace(`"${INDEX_PLACEHOLDER}"`, INDEX_PLACEHOLDER)
    .replace(INDEX_PLACEHOLDER, () => `"${stream.replace(/"/g, '""')}"`);

export function createValuesPlanner(deps: ValuesPlanDeps) {
  const { searchObj, t } = deps;

  // Parses and re-renders the per-stream SQL without the field's own condition; unparseable SQL is sent as is.
  const withoutOwnCondition = (sql: string, fieldName: string): string => {
    try {
      const parsed = deps.fnParsedSQL(sql);
      if (!(parsed?.from?.length > 0)) return sql;
      const rendered = deps
        .fnUnparsedSQL({ ...parsed, where: removeFieldFromWhereAST(parsed.where, fieldName) })
        .replace(/`/g, '"');
      return rendered || sql;
    } catch {
      return sql;
    }
  };

  // SQL mode re-renders the query (a UNION the parser rejects falls back to a plain select); quick mode is a WHERE.
  const baseQueryContext = (): string => {
    const query = searchObj.data.query;
    if (searchObj.meta.sqlMode === true && query.trim().length) {
      const parsed = deps.fnParsedSQL(query);
      let context = deps.fnUnparsedSQL(parsed).replace(/`/g, '"') || "";
      if (context === "" && parsed.columns?.length === 0 && parsed.from?.length === 0) {
        context = `SELECT * FROM "${INDEX_PLACEHOLDER}"`;
      }
      return context;
    }
    const fieldNames = searchObj.data.stream.selectedStreamFields.map(
      (field: { name: string }) => field.name,
    );
    const whereClause = query.trim() ? quoteSchemaFieldsInWhere(query.trim(), fieldNames) : "";
    return `SELECT * FROM "${INDEX_PLACEHOLDER}"${whereClause ? ` WHERE ${whereClause}` : ""}`;
  };

  const vrlFunction = () =>
    searchObj.data.tempFunctionContent !== "" && searchObj.data.transformType === "function"
      ? b64EncodeUnicode(searchObj.data.tempFunctionContent) || ""
      : "";

  // A stream the text filter cannot search is named.
  const nothingToAskError = (streams: string[], textWhere: Map<string, string> | null) => {
    const skipped = streams.filter((stream) => textWhere?.get(stream) === "FALSE");
    return skipped.length
      ? skipped.map((stream) => t("search.noFtsRecovery.skipped", { stream })).join(" ")
      : t("logs.indexList.filterNotValidForStreams");
  };

  const streamContextFor = (
    stream: string,
    context: string,
    several: boolean,
    textWhere: Map<string, string> | null,
    perStreamQueries: Record<string, string>,
  ): string | null => {
    let streamContext = several ? `SELECT * FROM "${INDEX_PLACEHOLDER}"` : context;
    if (textWhere) {
      const where = textWhere.get(stream) ?? "";
      if (where === "FALSE") return null;
      streamContext = `SELECT * FROM "${INDEX_PLACEHOLDER}"${where ? ` WHERE ${where}` : ""}`;
    }
    if (
      searchObj.data.stream.selectedStream.length > 1 &&
      searchObj.meta.sqlMode &&
      perStreamQueries[stream]
    ) {
      streamContext = perStreamQueries[stream];
    }
    return streamContext === "" ? null : streamContext;
  };

  // Every stream holding the field is asked and the page's search error state is never touched; several streams count unfiltered.
  const buildValuesPlan = (name: string, streams: string[], range: TimeRange): ValuesPlan => {
    const zoConfig = deps.zoConfig();
    const context = baseQueryContext();
    const perStreamQueries =
      searchObj.meta.sqlMode === true && searchObj.data.stream.selectedStream.length > 1
        ? deps.extractValueQuery()
        : {};
    const vrlFn = vrlFunction();

    if (isFilterHeld(searchObj, zoConfig)) {
      return { error: t("search.searchQueryEmptyOrInvalid"), payloads: [] };
    }
    const textWhere = freeTextWhereByStream(searchObj, zoConfig);
    if (!streams.length || (textWhere && streams.every((s) => textWhere.get(s) === "FALSE"))) {
      return { error: nothingToAskError(streams, textWhere), payloads: [] };
    }

    const payloads: FieldValuesRequest[] = [];
    for (const stream of streams) {
      const streamContext = streamContextFor(
        stream,
        context,
        streams.length > 1,
        textWhere,
        perStreamQueries,
      );
      if (streamContext === null) continue;
      payloads.push({
        fields: [name],
        size: zoConfig.query_values_default_num || 10,
        no_count: false,
        regions: searchObj.meta.regions,
        clusters: searchObj.meta.clusters,
        vrl_fn: vrlFn,
        start_time: range.startTime,
        end_time: range.endTime,
        timeout: 30000,
        stream_name: stream,
        stream_type: searchObj.data.stream.streamType,
        use_cache: (globalThis as { use_cache?: boolean }).use_cache ?? true,
        sql:
          b64EncodeUnicode(withoutOwnCondition(withStreamName(streamContext, stream), name)) || "",
      });
    }
    return { payloads };
  };

  return { buildValuesPlan };
}
