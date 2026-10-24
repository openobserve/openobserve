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

/** How many series a chart kept against how many distinct series the result had. */
export interface SeriesLimitInfo {
  shown: number;
  total: number;
  cap: number;
}

/** One query's server-side stats and notices, merged over its partitions. */
export interface QueryDiagnostics {
  took?: number;
  scanSizeMb?: number;
  scanRecords?: number;
  rowsReturned?: number;
  seriesReturned?: number;
  cacheRatio?: number;
  serverPartial: boolean;
  /** The server stopped at its row limit, so counts derived from the rows are lower bounds. */
  rowsCapped: boolean;
  partialReasons: string[];
  functionErrors: string[];
}

export interface PanelDiagnostics {
  queries: QueryDiagnostics[];
  serverPartial: boolean;
  rowsCapped: boolean;
  partialReasons: string[];
  functionErrors: string[];
}

// Server-authored texts (src/search_service) that ride in `function_error` but are not function failures.
// Range clamps: non-streaming/multi-stream wording, and the streaming wording, which arrives
// appended to the partial-data notice ("…based on partial data \n reached max query range limit").
const RANGE_CLAMP_MARKERS = ["due to query range restriction", "reached max query range limit"];
const PARTIAL_DATA_MESSAGE = "Please be aware that the response is based on partial data";
const CAPPED_RESULTS_PREFIX = "Warn: results are capped";

export const toPartitions = (entry: unknown): Record<string, any>[] => {
  if (Array.isArray(entry)) return entry.filter((p) => p && typeof p === "object");
  return entry && typeof entry === "object" ? [entry as Record<string, any>] : [];
};

const toMessages = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((m): m is string => typeof m === "string" && m.trim() !== "");
  }
  return typeof value === "string" && value.trim() !== "" ? [value] : [];
};

const isRangeClamp = (message: string) =>
  RANGE_CLAMP_MARKERS.some((marker) => message.includes(marker));

type MessageKind = "range" | "function" | "partial";

const isRowCap = (message: string) => message.startsWith(CAPPED_RESULTS_PREFIX);

const classifyMessage = (message: string, queryHasFunction: boolean): MessageKind => {
  if (isRangeClamp(message)) return "range";
  if (queryHasFunction && message !== PARTIAL_DATA_MESSAGE && !isRowCap(message)) {
    return "function";
  }
  return "partial";
};

const sumOf = (partitions: Record<string, any>[], key: string): number | undefined => {
  const values = partitions.map((p) => p[key]).filter((v) => typeof v === "number");
  return values.length ? values.reduce((total, v) => total + v, 0) : undefined;
};

const pushUnique = (target: string[], values: string[]) => {
  for (const value of values) if (!target.includes(value)) target.push(value);
};

const countReturned = (rows: unknown, queryType?: string) => {
  if (queryType === "promql") {
    const result = (rows as { result?: unknown })?.result;
    return { seriesReturned: Array.isArray(result) ? result.length : undefined };
  }
  return { rowsReturned: Array.isArray(rows) ? rows.length : undefined };
};

export const summarizeQueryDiagnostics = (
  entry: unknown,
  options: { rows?: unknown; queryHasFunction?: boolean; queryType?: string } = {},
): QueryDiagnostics => {
  const partitions = toPartitions(entry);
  const functionErrors: string[] = [];
  const partialReasons: string[] = [];
  let serverPartial = false;
  let rowsCapped = false;

  for (const partition of partitions) {
    const messages = toMessages(partition.function_error);
    if (messages.some(isRowCap)) rowsCapped = true;
    const kinds = messages.map((message) => {
      const kind = classifyMessage(message, !!options.queryHasFunction);
      if (kind === "function") pushUnique(functionErrors, [message]);
      if (kind === "partial" && partition.is_partial === true)
        pushUnique(partialReasons, [message]);
      return kind;
    });
    // A partial flag explained only by a range clamp or a function failure already has its own notice.
    if (partition.is_partial === true && (!kinds.length || kinds.includes("partial"))) {
      serverPartial = true;
    }
  }

  const ratios = partitions
    .map((p) => p.result_cache_ratio)
    .filter((v): v is number => typeof v === "number");

  return {
    took: sumOf(partitions, "took"),
    scanSizeMb: sumOf(partitions, "scan_size"),
    scanRecords: sumOf(partitions, "scan_records"),
    ...countReturned(options.rows, options.queryType),
    cacheRatio: ratios.length
      ? Math.round(ratios.reduce((total, v) => total + v, 0) / ratios.length)
      : undefined,
    serverPartial,
    rowsCapped,
    partialReasons,
    functionErrors,
  };
};

export const summarizePanelDiagnostics = (options: {
  resultMetaData: unknown;
  data?: unknown;
  queryType?: string;
  queryHasFunction?: (queryIndex: number) => boolean;
}): PanelDiagnostics => {
  const entries = Array.isArray(options.resultMetaData) ? options.resultMetaData : [];
  const rows = Array.isArray(options.data) ? options.data : [];
  // PromQL fills resultMetaData by query index out of order; map() would keep the holes.
  const queries = Array.from(entries, (entry, index) =>
    summarizeQueryDiagnostics(entry, {
      rows: rows[index],
      queryType: options.queryType,
      queryHasFunction: options.queryHasFunction?.(index) ?? false,
    }),
  );
  const partialReasons: string[] = [];
  const functionErrors: string[] = [];
  for (const query of queries) {
    pushUnique(partialReasons, query.partialReasons);
    pushUnique(functionErrors, query.functionErrors);
  }
  return {
    queries,
    serverPartial: queries.some((q) => q.serverPartial),
    rowsCapped: queries.some((q) => q.rowsCapped),
    partialReasons,
    functionErrors,
  };
};

/** Copy of the result metadata without the messages a header chip already shows, for the legacy warning icon. */
export const omitFunctionErrorMessages = (resultMetaData: unknown, messages: string[]): any => {
  if (!messages.length || !Array.isArray(resultMetaData)) return resultMetaData;
  const routed = new Set(messages);
  const strip = (partition: any) => {
    if (!partition || typeof partition !== "object" || !("function_error" in partition)) {
      return partition;
    }
    const remaining = toMessages(partition.function_error).filter((m) => !routed.has(m));
    return { ...partition, function_error: remaining.length ? remaining : undefined };
  };
  return resultMetaData.map((entry) => (Array.isArray(entry) ? entry.map(strip) : strip(entry)));
};
