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
import { b64EncodeUnicode, escapeSingleQuotes } from "@/utils/zincutils";
import {
  formatPromSeries,
  mapSqlRowsToOptions,
  mapValuesToOptions,
  parsePromVariableQuery,
  resolveSqlOptionColumns,
  type PromSeriesResult,
  type QueryVariableLanguage,
  type QueryVariableOption,
} from "./queryVariableUtils";

interface SqlStreamPayload {
  queryReq: {
    query: { sql: string | null; start_time: number; end_time: number; from: number; size: number };
    encoding: string;
  };
  type: "search";
  traceId: string;
  org_id: string;
  pageType: string;
  searchType: string;
}

/** The fields of a search stream event the SQL runner reads. */
interface SqlStreamEvent {
  type?: string;
  content?: { results?: { hits?: Record<string, unknown>[]; streaming_aggs?: boolean } };
}

type StreamHandlers = {
  data: (payload: unknown, response: SqlStreamEvent) => void;
  error: (payload: unknown, response: unknown) => void;
  complete: (payload: unknown, response: unknown) => void;
};

export type FetchQueryDataWithHttpStream = (
  payload: SqlStreamPayload,
  handlers: StreamHandlers,
) => unknown;

interface QueryVariableErrorFields {
  content?: { error_detail?: unknown; message?: unknown };
  response?: { data?: { error_detail?: unknown; error?: unknown; message?: unknown } };
  error_detail?: unknown;
  error?: unknown;
  message?: unknown;
}

/** A Prometheus HTTP API answer as axios returns it. */
interface PromApiResponse {
  data?: { status?: string; data?: unknown };
}

const METRIC_SCAN_LIMIT = 200;
const MICROS_THRESHOLD = 1e14;
const MILLIS_THRESHOLD = 1e11;
const METRIC_SCAN_BATCH = 8;
const DAY_SECONDS = 24 * 3600;
const NAME_LOOKBACK_DAYS = 30;

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
  /** Typed text the values must contain; SQL matches it in `searchColumn` on the server. */
  search?: string;
  searchColumn?: string;
  /** Aborts the PromQL requests; SQL runs are cancelled through their trace id instead. */
  signal?: AbortSignal;
}

export interface QueryVariableLoadResult {
  options: QueryVariableOption[];
  capped: boolean;
  /** Set when an unscoped metrics label scan skipped metric names past the scan limit. */
  metricsTruncated?: boolean;
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
export const getQueryVariableErrorMessage = (thrown: unknown): string => {
  const error = thrown as QueryVariableErrorFields | null | undefined;
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
  const message = candidates.find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
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
        data: (_payload, response) => {
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
        error: (_payload, error) =>
          settle(() => reject(new Error(getQueryVariableErrorMessage(error)))),
        complete: () => settle(() => resolve(rows)),
      },
    );
  });

const promValues = (response: PromApiResponse): unknown[] => {
  const body = response?.data;
  if (body?.status && body.status !== "success") {
    throw new Error(getQueryVariableErrorMessage(body));
  }
  return Array.isArray(body?.data) ? body.data : [];
};

type PromRange = {
  org_identifier: string;
  start_time: number;
  end_time: number;
  signal?: AbortSignal;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new QueryVariableCancelledError();
};

/** Prometheus HTTP API times are unix seconds; dashboards hand over microseconds, tests milliseconds. */
export const toPromSeconds = (time: number): number => {
  if (time > MICROS_THRESHOLD) return Math.floor(time / 1e6);
  if (time > MILLIS_THRESHOLD) return Math.floor(time / 1e3);
  return Math.floor(time);
};

// Names come from stream stats, which can lag ingestion by hours; a short window drops live metrics, so look back 30 days.
const withIndexLagWindows = (
  range: PromRange,
  load: (window: PromRange) => Promise<unknown[]>,
): Promise<unknown[]> =>
  load({
    ...range,
    start_time: Math.min(range.start_time, range.end_time - NAME_LOOKBACK_DAYS * DAY_SECONDS),
  });

const loadMetricNames = (range: PromRange): Promise<unknown[]> =>
  withIndexLagWindows(range, async (window) =>
    promValues(await metricsService.labelValues({ ...window, label: "__name__" })),
  );

interface MetricScan {
  names: string[];
  /** More metric names exist than the scan reads, so values on the rest are missing. */
  truncated: boolean;
  next: number;
  values: Set<string>;
}

interface MetricScanEntry {
  scan: Promise<MetricScan>;
  loadedAt: number;
  signal?: AbortSignal;
}

interface PromValuesResult {
  values: unknown[];
  truncated?: boolean;
}

const METRIC_SCAN_CACHE_SIZE = 20;
// Short enough that a refresh over a fixed range soon sees new label values or recovers from a failed lookup.
const METRIC_SCAN_CACHE_TTL_MS = 60_000;

// Search keystrokes reuse one scan per label and range instead of re-reading up to 200 metrics each time.
const metricScanCache = new Map<string, MetricScanEntry>();

const metricScanKey = (range: PromRange, label: string): string =>
  JSON.stringify([range.org_identifier, label, range.start_time, range.end_time]);

export const clearMetricScanCache = (): void => metricScanCache.clear();

const getLiveMetricScan = (key: string): MetricScanEntry | undefined => {
  const entry = metricScanCache.get(key);
  if (!entry) return undefined;
  metricScanCache.delete(key);
  if (Date.now() - entry.loadedAt > METRIC_SCAN_CACHE_TTL_MS) return undefined;
  metricScanCache.set(key, entry);
  return entry;
};

const startMetricScan = (range: PromRange, key: string): Promise<MetricScan> => {
  const scan = loadMetricNames(range).then((loaded): MetricScan => {
    throwIfAborted(range.signal);
    const names = loaded.map(String);
    return {
      names: names.slice(0, METRIC_SCAN_LIMIT),
      truncated: names.length > METRIC_SCAN_LIMIT,
      next: 0,
      values: new Set<string>(),
    };
  });
  // Concurrent callers share the in-flight scan, but a failed or aborted one must not stay cached.
  const entry: MetricScanEntry = { scan, loadedAt: Date.now(), signal: range.signal };
  metricScanCache.set(key, entry);
  if (metricScanCache.size > METRIC_SCAN_CACHE_SIZE) {
    metricScanCache.delete(metricScanCache.keys().next().value as string);
  }
  scan.catch(() => {
    if (metricScanCache.get(key) === entry) metricScanCache.delete(key);
  });
  return scan;
};

const getMetricScan = async (range: PromRange, label: string): Promise<MetricScan> => {
  const key = metricScanKey(range, label);
  const live = getLiveMetricScan(key);
  if (!live) return startMetricScan(range, key);
  try {
    return await live.scan;
  } catch (error) {
    throwIfAborted(range.signal);
    // Another caller's cancellation rejected the shared scan, so join a newer scan or start one.
    if (live.signal?.aborted) return getMetricScan(range, label);
    throw error;
  }
};

const matching = (values: Set<string>, search: string): string[] =>
  [...values].filter((value) => value.includes(search));

// The backend answers label values only for one metric, so an unscoped lookup unions them across metrics.
const labelValuesAcrossMetrics = async (
  range: PromRange,
  label: string,
  maxRecords: number,
  search = "",
): Promise<PromValuesResult> => {
  const scan = await getMetricScan(range, label);
  // Resumes where the last call stopped, and stops once one value past the cap matches.
  while (scan.next < scan.names.length && matching(scan.values, search).length <= maxRecords) {
    throwIfAborted(range.signal);
    const start = scan.next;
    const batch = await Promise.allSettled(
      scan.names
        .slice(start, start + METRIC_SCAN_BATCH)
        .map((name) => metricsService.labelValues({ ...range, label, match: name })),
    );
    // An aborted request settles as a failure, which must not be cached as "label missing".
    throwIfAborted(range.signal);
    // A concurrent call already stored this batch.
    if (scan.next !== start) continue;
    scan.next = Math.min(start + METRIC_SCAN_BATCH, scan.names.length);
    batch.forEach((result) => {
      if (result.status !== "fulfilled") return;
      try {
        promValues(result.value)
          .map(String)
          .forEach((value) => scan.values.add(value));
      } catch {
        // A metric without the label answers with an error; the others still count.
      }
    });
  }
  return {
    values: matching(scan.values, search).sort((a, b) => a.localeCompare(b)),
    truncated: scan.truncated,
  };
};

const loadLabelValues = async (
  range: PromRange,
  label: string,
  match: string | undefined,
  maxRecords: number,
  search?: string,
): Promise<PromValuesResult> => {
  if (match) {
    return { values: promValues(await metricsService.labelValues({ ...range, label, match })) };
  }
  if (label === "__name__") return { values: await loadMetricNames(range) };
  // A live scan means the unscoped lookup already failed for this label and range.
  if (getLiveMetricScan(metricScanKey(range, label))) {
    return labelValuesAcrossMetrics(range, label, maxRecords, search);
  }
  try {
    return { values: promValues(await metricsService.labelValues({ ...range, label })) };
  } catch {
    throwIfAborted(range.signal);
    return labelValuesAcrossMetrics(range, label, maxRecords, search);
  }
};

const loadPromValues = async (params: QueryVariableLoadParams): Promise<PromValuesResult> => {
  const parsed = parsePromVariableQuery(params.query);
  if (!parsed) throw new Error(gt("dashboard.queryVariable.unsupportedPromql"));
  const range: PromRange = {
    org_identifier: params.orgId,
    start_time: toPromSeconds(params.startTime),
    end_time: toPromSeconds(params.endTime),
    signal: params.signal,
  };

  switch (parsed.kind) {
    case "label_values":
      return loadLabelValues(range, parsed.label, parsed.match, params.maxRecords, params.search);
    case "label_names":
      return {
        values: await withIndexLagWindows(range, async (window) =>
          promValues(await metricsService.labels({ ...window, match: parsed.match })),
        ),
      };
    case "metrics": {
      let matcher: RegExp;
      try {
        matcher = new RegExp(parsed.regex || ".*");
      } catch {
        throw new Error(gt("dashboard.queryVariable.invalidRegex", { regex: parsed.regex }));
      }
      const names = await loadMetricNames(range);
      return { values: names.filter((name) => matcher.test(String(name))) };
    }
    case "query_result": {
      const response = await searchService.metrics_query({
        org_identifier: params.orgId,
        query: encodeURIComponent(parsed.expr),
        end_time: range.end_time,
        signal: params.signal,
      });
      const body = response?.data;
      if (body?.status && body.status !== "success") {
        throw new Error(getQueryVariableErrorMessage(body));
      }
      const result = body?.data?.result;
      if (!Array.isArray(result)) return { values: [] };
      // A scalar or string result is a single [timestamp, value] pair, not a series list.
      if (body?.data?.resultType === "scalar" || body?.data?.resultType === "string") {
        return { values: [formatPromSeries({ value: result as [number, string] })] };
      }
      return { values: result.map((series: PromSeriesResult) => formatPromSeries(series)) };
    }
  }
};

const quoteIdentifier = (name: string): string => `"${name.replace(/"/g, '""')}"`;

const asSubquery = (query: string): string => query.trim().replace(/[;\s]+$/, "");

// The outer ORDER BY keeps the list stable, as GROUP BY returns groups in no fixed order.
const distinctValuesSql = (query: string, valueColumn: string, labelColumn: string): string => {
  const value = quoteIdentifier(valueColumn);
  const label =
    labelColumn === valueColumn
      ? ""
      : `, MIN(${quoteIdentifier(labelColumn)}) AS ${quoteIdentifier(labelColumn)}`;
  return `SELECT ${value}${label} FROM (${asSubquery(query)}) GROUP BY ${value} ORDER BY ${value}`;
};

// str_match, as a Query Values search sends it, so both kinds of variable find the same values.
const searchSql = (query: string, column: string, text: string): string =>
  `SELECT * FROM (${asSubquery(query)}) WHERE str_match(${quoteIdentifier(column)}, '${escapeSingleQuotes(text)}')`;

const loadSqlValues = async (params: QueryVariableLoadParams): Promise<QueryVariableLoadResult> => {
  const request = {
    streamType: params.streamType,
    startTime: params.startTime,
    endTime: params.endTime,
    // One extra row tells a capped result apart from one that fills the cap.
    size: params.maxRecords + 1,
  };
  const toOptions = (rows: Record<string, unknown>[]) =>
    mapSqlRowsToOptions(rows, {
      valueField: params.valueField,
      labelField: params.labelField,
      maxRecords: params.maxRecords,
    });
  const query =
    params.search && params.searchColumn
      ? searchSql(params.query, params.searchColumn, params.search)
      : params.query;
  const rows = await params.runSql({ ...request, sql: query });
  const mapped = toOptions(rows);
  const picked = resolveSqlOptionColumns(mapped.columns, params.valueField, params.labelField);
  if (mapped.capped || rows.length <= params.maxRecords || !picked) return { ...mapped, rows };

  // Duplicate rows filled the cap and may hide later values, so ask again for one row per value.
  try {
    const sql = distinctValuesSql(query, picked.valueColumn, picked.labelColumn);
    const { options, capped } = toOptions(await params.runSql({ ...request, sql }));
    return { options, capped, columns: mapped.columns, rows };
  } catch (error) {
    if (error instanceof QueryVariableCancelledError) throw error;
    // The query itself ran; if the backend rejects the wrapper, only the exact value count is lost.
    return { ...mapped, capped: true, rows };
  }
};

/** Loads the options of a `query` variable whose query already has its parent values substituted. */
export const loadQueryVariableValues = async (
  params: QueryVariableLoadParams,
): Promise<QueryVariableLoadResult> => {
  if (params.language === "promql") {
    const loaded = await loadPromValues(params).catch((error) => {
      throwIfAborted(params.signal);
      throw error;
    });
    const values = loaded.values.filter((value) => String(value).includes(params.search ?? ""));
    const { options, capped } = mapValuesToOptions(values, params.maxRecords);
    return {
      options,
      capped: capped || !!loaded.truncated,
      metricsTruncated: !!loaded.truncated,
      columns: [],
      rows: [],
    };
  }
  return loadSqlValues(params);
};
