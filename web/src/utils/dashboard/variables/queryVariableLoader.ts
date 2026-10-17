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

import { gt } from "@/types/i18n";
import metricsService from "@/services/metrics";
import searchService from "@/services/search";
import { b64EncodeUnicode } from "@/utils/zincutils";
import {
  formatPromSeries,
  mapSqlRowsToOptions,
  mapValuesToOptions,
  parsePromVariableQuery,
  type QueryVariableLanguage,
  type QueryVariableOption,
} from "./queryVariableUtils";

type StreamHandlers = {
  data: (payload: any, response: any) => void;
  error: (payload: any, response: any) => void;
  complete: (payload: any, response: any) => void;
};

export type FetchQueryDataWithHttpStream = (payload: any, handlers: StreamHandlers) => unknown;

const METRIC_SCAN_LIMIT = 200;
const MICROS_THRESHOLD = 1e14;
const MILLIS_THRESHOLD = 1e11;
const METRIC_SCAN_BATCH = 8;

export interface SqlVariableQueryRequest {
  sql: string;
  streamType?: string;
  startTime: number;
  endTime: number;
  size: number;
}

export type SqlVariableQueryRunner = (
  request: SqlVariableQueryRequest,
) => Promise<Record<string, unknown>[]>;

export interface QueryVariableLoadParams {
  query: string;
  language: QueryVariableLanguage;
  streamType?: string;
  valueField?: string | null;
  labelField?: string | null;
  maxRecords: number;
  startTime: number;
  endTime: number;
  orgId: string;
  runSql: SqlVariableQueryRunner;
}

export interface QueryVariableLoadResult {
  options: QueryVariableOption[];
  capped: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
}

/** Thrown when a stream is cancelled, so callers can tell it apart from a failed query. */
export class QueryVariableCancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "QueryVariableCancelledError";
  }
}

/** Pulls the readable message out of a stream error, a server error body or an axios error. */
export const getQueryVariableErrorMessage = (error: any): string => {
  const candidates = [
    error?.content?.error_detail,
    error?.content?.message,
    error?.response?.data?.error_detail,
    error?.response?.data?.error,
    error?.response?.data?.message,
    error?.error_detail,
    error?.error,
    error?.message,
  ];
  const message = candidates.find((value) => typeof value === "string" && value.trim() !== "");
  return message ?? gt("dashboard.queryVariable.unknownError");
};

/** Runs a SQL query on the panel search stream and resolves with every returned row. */
export const runSqlVariableQueryOnStream = (
  fetchStream: FetchQueryDataWithHttpStream,
  request: SqlVariableQueryRequest & { orgId: string; traceId: string },
): Promise<Record<string, unknown>[]> =>
  new Promise((resolve, reject) => {
    let rows: Record<string, unknown>[] = [];
    let streamingAggs = false;
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      finish();
    };

    fetchStream(
      {
        queryReq: {
          query: {
            sql: b64EncodeUnicode(request.sql),
            start_time: request.startTime,
            end_time: request.endTime,
            from: 0,
            size: request.size,
          },
          encoding: "base64",
        },
        type: "search",
        traceId: request.traceId,
        org_id: request.orgId,
        pageType: request.streamType || "logs",
        searchType: "dashboards",
      },
      {
        data: (_payload: any, response: any) => {
          const hits = response?.content?.results?.hits;
          switch (response?.type) {
            case "search_response_metadata":
              streamingAggs = !!response?.content?.results?.streaming_aggs;
              break;
            case "search_response_hits":
              // Streaming aggregations resend the whole result on every partition.
              rows = streamingAggs ? [...(hits ?? [])] : [...rows, ...(hits ?? [])];
              break;
            case "search_response":
              rows = Array.isArray(hits) ? hits : rows;
              break;
            case "error":
              settle(() => reject(new Error(getQueryVariableErrorMessage(response))));
              break;
            case "cancel_response":
              settle(() => reject(new QueryVariableCancelledError()));
              break;
            case "end":
              settle(() => resolve(rows));
              break;
          }
        },
        error: (_payload: any, error: any) =>
          settle(() => reject(new Error(getQueryVariableErrorMessage(error)))),
        complete: () => settle(() => resolve(rows)),
      },
    );
  });

const promValues = (response: any): unknown[] => {
  const body = response?.data;
  if (body?.status && body.status !== "success") {
    throw new Error(getQueryVariableErrorMessage(body));
  }
  return Array.isArray(body?.data) ? body.data : [];
};

type PromRange = { org_identifier: string; start_time: number; end_time: number };

/** Prometheus HTTP API times are unix seconds; dashboards hand over microseconds, tests milliseconds. */
export const toPromSeconds = (time: number): number => {
  if (time > MICROS_THRESHOLD) return Math.floor(time / 1e6);
  if (time > MILLIS_THRESHOLD) return Math.floor(time / 1e3);
  return Math.floor(time);
};

// The backend answers label values only for one metric, so an unscoped lookup unions them across metrics.
const labelValuesAcrossMetrics = async (
  range: PromRange,
  label: string,
  maxRecords: number,
): Promise<unknown[]> => {
  const names = promValues(await metricsService.labelValues({ ...range, label: "__name__" }));
  const values = new Set<string>();
  const scanned = names.slice(0, METRIC_SCAN_LIMIT);
  for (let i = 0; i < scanned.length && values.size <= maxRecords; i += METRIC_SCAN_BATCH) {
    const batch = await Promise.allSettled(
      scanned
        .slice(i, i + METRIC_SCAN_BATCH)
        .map((name) => metricsService.labelValues({ ...range, label, match: String(name) })),
    );
    batch.forEach((result) => {
      if (result.status !== "fulfilled") return;
      try {
        promValues(result.value).forEach((value) => values.add(String(value)));
      } catch {
        // A metric without the label answers with an error; the others still count.
      }
    });
  }
  return [...values].sort((a, b) => a.localeCompare(b));
};

const loadLabelValues = async (
  range: PromRange,
  label: string,
  match: string | undefined,
  maxRecords: number,
): Promise<unknown[]> => {
  if (match) return promValues(await metricsService.labelValues({ ...range, label, match }));
  try {
    return promValues(await metricsService.labelValues({ ...range, label }));
  } catch {
    return labelValuesAcrossMetrics(range, label, maxRecords);
  }
};

const loadPromValues = async (params: QueryVariableLoadParams): Promise<unknown[]> => {
  const parsed = parsePromVariableQuery(params.query);
  if (!parsed) throw new Error(gt("dashboard.queryVariable.unsupportedPromql"));
  const range: PromRange = {
    org_identifier: params.orgId,
    start_time: toPromSeconds(params.startTime),
    end_time: toPromSeconds(params.endTime),
  };

  switch (parsed.kind) {
    case "label_values":
      return loadLabelValues(range, parsed.label, parsed.match, params.maxRecords);
    case "label_names":
      return promValues(await metricsService.labels({ ...range, match: parsed.match }));
    case "metrics": {
      let matcher: RegExp;
      try {
        matcher = new RegExp(parsed.regex || ".*");
      } catch {
        throw new Error(gt("dashboard.queryVariable.invalidRegex", { regex: parsed.regex }));
      }
      const names = promValues(await metricsService.labelValues({ ...range, label: "__name__" }));
      return names.filter((name) => matcher.test(String(name)));
    }
    case "query_result": {
      const response = await searchService.metrics_query({
        org_identifier: params.orgId,
        query: encodeURIComponent(parsed.expr),
        end_time: range.end_time,
      });
      const body = response?.data;
      if (body?.status && body.status !== "success") {
        throw new Error(getQueryVariableErrorMessage(body));
      }
      const result = body?.data?.result;
      if (!Array.isArray(result)) return [];
      // A scalar or string result is a single [timestamp, value] pair, not a series list.
      if (body?.data?.resultType === "scalar" || body?.data?.resultType === "string") {
        return [formatPromSeries({ value: result as [number, string] })];
      }
      return result.map((series: any) => formatPromSeries(series));
    }
  }
};

/** Loads the options of a `query` variable whose query already has its parent values substituted. */
export const loadQueryVariableValues = async (
  params: QueryVariableLoadParams,
): Promise<QueryVariableLoadResult> => {
  if (params.language === "promql") {
    const { options, capped } = mapValuesToOptions(await loadPromValues(params), params.maxRecords);
    return { options, capped, columns: [], rows: [] };
  }

  // One extra row tells a capped result apart from one that happens to fill the cap.
  const rows = await params.runSql({
    sql: params.query,
    streamType: params.streamType,
    startTime: params.startTime,
    endTime: params.endTime,
    size: params.maxRecords + 1,
  });
  const mapped = mapSqlRowsToOptions(rows, {
    valueField: params.valueField,
    labelField: params.labelField,
    maxRecords: params.maxRecords,
  });
  return { ...mapped, rows };
};
