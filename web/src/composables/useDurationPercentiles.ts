// Copyright 2026 OpenObserve Inc.

import { ref } from "vue";
import store from "@/stores";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import useHttpStreaming from "@/composables/useStreamingSearch";

export interface DurationPercentiles {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  p99: number | null;
}

export interface FetchPercentilesPayload {
  streamName: string;
  startTime: number;
  endTime: number;
  whereClause?: string;
}

const DURATION_UNIT_MULTIPLIERS: Record<string, number> = {
  us: 1,
  ms: 1_000,
  s: 1_000_000,
  m: 60 * 1_000_000,
};

/**
 * Converts duration comparisons in a WHERE clause that carry human-readable
 * unit suffixes (produced by `formatTimeWithSuffix`) back to raw microseconds.
 *
 * Accepts a WHERE clause and the already-loaded SQL parser instance.  Wraps
 * the clause in a full `SELECT * FROM "stream" WHERE …` query, uses the parser
 * to produce an AST, walks the tree to locate duration binary expressions whose
 * right-hand side is a quoted string value (e.g. `'1.50ms'`), converts the
 * value, and applies the replacement back on the original WHERE string.
 *
 * Falls back to the original string if the parser throws (malformed input).
 *
 * Examples:
 *   `duration >= '100.00us'`  →  `duration >= 100`
 *   `duration >= '1.50ms'`    →  `duration >= 1500`
 *   `duration >= '2.50s'`     →  `duration >= 2500000`
 *   `duration >= '1.50m'`     →  `duration >= 90000000`
/** Maps every accepted unit spelling to a canonical key in DURATION_UNIT_MULTIPLIERS. */
const UNIT_ALIASES: Record<string, string> = {
  // Microseconds
  us: "us",
  µs: "us",
  usec: "us",
  usecs: "us",
  microsecond: "us",
  microseconds: "us",
  micros: "us",
  // Milliseconds
  ms: "ms",
  msec: "ms",
  msecs: "ms",
  millisecond: "ms",
  milliseconds: "ms",
  millis: "ms",
  // Seconds
  s: "s",
  sec: "s",
  secs: "s",
  second: "s",
  seconds: "s",
  // Minutes
  m: "m",
  min: "m",
  mins: "m",
  minute: "m",
  minutes: "m",
};

export type ParseDurationResult = string | { error: string };

/**
 * Converts duration comparisons in a WHERE clause that carry human-readable
 * unit suffixes back to raw microseconds.
 *
 * Parses the clause into a SQL AST, walks the tree to locate duration binary
 * expressions whose right-hand side is a quoted string (e.g. `'1.50ms'`),
 * mutates each node to a numeric literal, then re-serialises with sqlify.
 *
 * Tolerates optional whitespace between the number and unit, and accepts all
 * common unit aliases (e.g. "second", "seconds", "sec", "secs" → s).
 *
 * Returns `{ error }` when a duration value contains an unrecognised unit.
 * Falls back to the original string if the SQL parser throws (malformed input).
 *
 * Examples:
 *   `duration >= '100us'`       →  `duration >= 100`
 *   `duration >= '1.50 ms'`     →  `duration >= 1500`
 *   `duration >= '2 seconds'`   →  `duration >= 2000000`
 *   `duration >= '1.50m'`       →  `duration >= 90000000`
 *   `duration >= '5 lightyears'` → `{ error: 'Unknown duration unit: "lightyears"' }`
 */
export const parseDurationWhereClause = (
  whereClause: string,
  parser: any,
  streamName: string = "x",
): ParseDurationResult => {
  if (!parser || !whereClause.trim()) return whereClause;

  try {
    const fullSql = `SELECT * FROM "${streamName}" WHERE ${whereClause}`;
    const ast = parser.astify(fullSql);

    let unknownUnit: string | null = null;

    const processNode = (node: any) => {
      if (!node || node.type !== "binary_expr" || unknownUnit) return;

      if (
        (node.left?.column === "duration" ||
          node.left?.column?.expr?.value === "duration") &&
        (node.right?.type === "single_quote_string" ||
          node.right?.type === "string")
      ) {
        const strVal = String(node.right.value).trim();
        // Allow optional whitespace between number and unit; unit may be multi-char.
        const match = strVal.match(/^(\d+(?:\.\d+)?)\s*([a-zµ]+)$/i);
        if (match) {
          const rawUnit = match[2].toLowerCase();
          const canonicalUnit = UNIT_ALIASES[rawUnit];
          if (!canonicalUnit) {
            unknownUnit = rawUnit;
            return;
          }
          const num = parseFloat(match[1]);
          const us = Math.round(
            num * (DURATION_UNIT_MULTIPLIERS[canonicalUnit] ?? 1),
          );
          // Mutate the AST node in place — replace quoted string with a numeric literal.
          node.right = { type: "number", value: us };
        }
      }

      processNode(node.left);
      processNode(node.right);
    };

    processNode(ast.where);

    if (unknownUnit !== null) {
      return { error: `Unknown duration unit: "${unknownUnit}"` };
    }

    // Re-serialise the mutated AST and extract only the WHERE clause.
    const resultSql: string = parser.sqlify(ast);
    const whereMatch = resultSql.match(/\bWHERE\b\s+([\s\S]+)$/i);
    return whereMatch ? whereMatch[1].trim() : whereClause;
  } catch {
    return whereClause;
  }
};

/**
 * Fetches P25/P50/P75/P95/P99 percentile values for the duration field
 * using a single aggregation SQL query against the traces stream.
 *
 * Values are returned in raw microseconds (µs), matching how duration is
 * stored in the stream. Formatting for display is the caller's responsibility.
 */
const useDurationPercentiles = () => {
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
    useHttpStreaming();

  const percentiles = ref<DurationPercentiles>({
    p25: null,
    p50: null,
    p75: null,
    p95: null,
    p99: null,
  });
  const isLoading = ref(false);
  const errMsg = ref("");

  let currentTraceId: string | null = null;

  const fetchPercentiles = (payload: FetchPercentilesPayload) => {
    const orgId = store.state.selectedOrganization.identifier;

    if (currentTraceId) {
      cancelStreamQueryBasedOnRequestId({
        trace_id: currentTraceId,
        org_id: orgId,
      });
      currentTraceId = null;
    }

    isLoading.value = true;
    errMsg.value = "";
    percentiles.value = {
      p25: null,
      p50: null,
      p75: null,
      p95: null,
      p99: null,
    };

    const { traceId } = generateTraceContext();
    currentTraceId = traceId;

    const where = payload.whereClause?.trim()
      ? ` WHERE ${payload.whereClause.trim()}`
      : "";
    const sql =
      `SELECT approx_percentile_cont(duration, 0.25) as p25,` +
      ` approx_percentile_cont(duration, 0.50) as p50,` +
      ` approx_percentile_cont(duration, 0.75) as p75,` +
      ` approx_percentile_cont(duration, 0.95) as p95,` +
      ` approx_percentile_cont(duration, 0.99) as p99` +
      ` FROM "${payload.streamName}"${where}`;

    fetchQueryDataWithHttpStream(
      {
        queryReq: {
          query: {
            sql: b64EncodeUnicode(sql),
            start_time: payload.startTime,
            end_time: payload.endTime,
            from: 0,
            size: 10,
          },
          encoding: "base64",
        },
        type: "search",
        traceId,
        org_id: orgId,
        pageType: "traces",
        searchType: "ui",
      },
      {
        data: (_p: any, response: any) => {
          if (
            response.type === "search_response_hits" ||
            response.type === "search_response_metadata"
          ) {
            const hits: any[] = response.content?.results?.hits ?? [];
            if (hits.length > 0) {
              const row = hits[0];
              percentiles.value = {
                p25: row.p25 ?? null,
                p50: row.p50 ?? null,
                p75: row.p75 ?? null,
                p95: row.p95 ?? null,
                p99: row.p99 ?? null,
              };
              isLoading.value = false;
            }
          }
        },
        error: (_p: any, _r: any) => {
          errMsg.value = "Failed to load percentiles";
          isLoading.value = false;
          currentTraceId = null;
        },
        complete: (_p: any, _r: any) => {
          isLoading.value = false;
          currentTraceId = null;
        },
        reset: (_p: any, _r: any) => {
          // no-op — percentile fetches are not retriable via reset
        },
      },
    );
  };

  const cancelFetch = () => {
    const orgId = store.state.selectedOrganization.identifier;
    if (currentTraceId) {
      cancelStreamQueryBasedOnRequestId({
        trace_id: currentTraceId,
        org_id: orgId,
      });
      currentTraceId = null;
    }
    isLoading.value = false;
  };

  return { percentiles, isLoading, errMsg, fetchPercentiles, cancelFetch };
};

export default useDurationPercentiles;
