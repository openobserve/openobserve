// Copyright 2026 OpenObserve Inc.

import { cloneDeep } from "lodash-es";
import { raw, type TranslateFn } from "@/types/i18n";
import type { SearchObject } from "@/composables/useLogs/searchState";
import { removeFieldFromWhereAST } from "@/composables/useLogs/logsUtils";
import {
  freeTextWhereByStream,
  isFilterHeld,
  type FreeTextZoConfig,
} from "@/composables/useLogs/freeTextSearch";
import { enrichmentValuesRange, type FieldValuesRequest } from "@/composables/useFieldValuesStream";
import { addSpacesToOperators, b64EncodeUnicode } from "@/utils/zincutils";
import { getConsumableRelativeTime } from "@/utils/date";

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
  fnParsedSQL: (sql: string) => any;
  fnUnparsedSQL: (ast: unknown) => string;
  extractValueQuery: () => Record<string, string>;
  validateFilterForMultiStream: () => boolean;
}

/** A schema-field name typed bare in quick mode is quoted so reserved words parse as columns. */
export const quoteSchemaFieldsInWhere = (whereClause: string, fieldNames: string[]): string => {
  const parts = addSpacesToOperators(whereClause).split(" ");
  for (const name of fieldNames) {
    parts.forEach((node, index) => {
      if (node === name) parts[index] = `"${node.replaceAll('"', "")}"`;
    });
  }
  return parts.join(" ");
};

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
  const baseQueryContext = (): { context: string; whereClause: string } => {
    const query = searchObj.data.query;
    if (searchObj.meta.sqlMode === true && query.trim().length) {
      const parsed = deps.fnParsedSQL(query);
      let context = deps.fnUnparsedSQL(parsed).replace(/`/g, '"') || "";
      if (context === "" && parsed.columns?.length === 0 && parsed.from?.length === 0) {
        context = `SELECT * FROM "${INDEX_PLACEHOLDER}"`;
      }
      return { context, whereClause: "" };
    }
    const fieldNames = searchObj.data.stream.selectedStreamFields.map(
      (field: { name: string }) => field.name,
    );
    const whereClause = query.trim() ? quoteSchemaFieldsInWhere(query.trim(), fieldNames) : "";
    return {
      context: `SELECT * FROM "${INDEX_PLACEHOLDER}"${whereClause ? ` WHERE ${whereClause}` : ""}`,
      whereClause,
    };
  };

  const vrlFunction = () =>
    searchObj.data.tempFunctionContent !== "" && searchObj.data.transformType === "function"
      ? b64EncodeUnicode(searchObj.data.tempFunctionContent) || ""
      : "";

  // Streams the multi-stream filter check excluded are not asked; an invalid filter stops the request.
  const streamsAfterValidation = (
    streams: string[],
    whereClause: string,
  ): { streams: string[]; error?: string } => {
    if (whereClause === "" || searchObj.data.stream.selectedStream.length <= 1) return { streams };
    if (!deps.validateFilterForMultiStream()) {
      return { streams, error: t("logs.indexList.filterNotValidForStreams") };
    }
    const missing = searchObj.data.stream.missingStreamMultiStreamFilter;
    return { streams: streams.filter((stream) => !missing.includes(stream)) };
  };

  // A stream the text filter cannot search is named; otherwise the filter check already explained the gap.
  const nothingToAskError = (fieldStreams: string[], textWhere: Map<string, string> | null) => {
    const skipped = fieldStreams.filter((stream) => textWhere?.get(stream) === "FALSE");
    return skipped.length
      ? skipped.map((stream) => t("search.noFtsRecovery.skipped", { stream })).join(" ")
      : String(searchObj.data.missingStreamMessage) || t("logs.indexList.filterNotValidForStreams");
  };

  const streamContextFor = (
    stream: string,
    context: string,
    several: boolean,
    textWhere: Map<string, string> | null,
    perStreamQueries: Record<string, string>,
  ): string | null => {
    let streamContext = several ? `select * from ${INDEX_PLACEHOLDER}` : context;
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

  const buildValuesPlan = (name: string, fieldStreams: string[], range: TimeRange): ValuesPlan => {
    const zoConfig = deps.zoConfig();
    searchObj.data.filterErrMsg = "";
    searchObj.data.missingStreamMessage = raw("");
    searchObj.data.stream.missingStreamMultiStreamFilter = [];
    const { context, whereClause } = baseQueryContext();
    const perStreamQueries =
      searchObj.meta.sqlMode === true && searchObj.data.stream.selectedStream.length > 1
        ? deps.extractValueQuery()
        : {};
    const vrlFn = vrlFunction();

    const validated = streamsAfterValidation(fieldStreams, whereClause);
    if (validated.error !== undefined) return { error: validated.error, payloads: [] };
    const streams = validated.streams;
    if (isFilterHeld(searchObj, zoConfig)) {
      return { error: t("search.searchQueryEmptyOrInvalid"), payloads: [] };
    }
    const textWhere = freeTextWhereByStream(searchObj, zoConfig);
    if (!streams.length || (textWhere && streams.every((s) => textWhere.get(s) === "FALSE"))) {
      return { error: nothingToAskError(fieldStreams, textWhere), payloads: [] };
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
          b64EncodeUnicode(
            withoutOwnCondition(streamContext.replace(INDEX_PLACEHOLDER, stream), name),
          ) || "",
      });
    }
    return { payloads };
  };

  return { buildValuesPlan };
}
