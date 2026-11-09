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

import { onScopeDispose, ref, shallowRef, toValue, type MaybeRefOrGetter } from "vue";
import useHttpStreaming from "@/composables/useStreamingSearch";
import type { RcaEvidenceTarget } from "@/services/incidents";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";

/** Rows an evidence card shows; the rest open in Logs. */
export const RCA_RESULT_ROWS = 5;

/** Series an evidence card draws; more stay in Metrics. */
export const RCA_RESULT_SERIES = 5;

export type RcaEvidenceResultState = "idle" | "loading" | "ready" | "error";

export interface RcaEvidenceRows {
  kind: "rows";
  columns: string[];
  rows: Record<string, unknown>[];
  /** Rows the query matched, when the server said. */
  total: number | null;
}

export interface RcaEvidenceSeries {
  kind: "series";
  series: { name: string; points: number[]; latest: number | null }[];
}

export type RcaEvidenceResult = RcaEvidenceRows | RcaEvidenceSeries;

interface StreamFrame {
  type?: string;
  content?: { results?: unknown };
}

interface PromqlSeries {
  metric?: Record<string, string>;
  values?: [number, string | number][];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored query a click can run again: SQL over logs or traces, or a PromQL range. */
export function rcaEvidenceRunnable(link: RcaEvidenceTarget): "sql" | "promql" | null {
  if (link.start_us === undefined || link.end_us === undefined) return null;
  if (link.promql) return "promql";
  if (link.sql && (link.signal === "logs" || link.signal === "traces")) return "sql";
  return null;
}

/** `{__name__="up", job="api"}` → `up{job="api"}`, the way Metrics names a series. */
export function rcaSeriesName(metric: Record<string, string> = {}): string {
  const { __name__: name = "", ...labels } = metric;
  const parts = Object.keys(labels)
    .sort()
    .map((key) => `${key}="${labels[key]}"`);
  if (parts.length === 0) return name || "value";
  return `${name}{${parts.join(", ")}}`;
}

/** Folds one `search_response_*` frame into the rows read so far. */
export function foldSearchFrame(acc: RcaEvidenceRows, frame: StreamFrame): RcaEvidenceRows {
  const results = frame.content?.results;
  if (!isRecord(results)) return acc;
  const total = typeof results.total === "number" ? results.total : acc.total;
  const hits = Array.isArray(results.hits) ? results.hits.filter(isRecord) : [];
  const rows = [...acc.rows, ...hits].slice(0, RCA_RESULT_ROWS);
  const columns = [...new Set([...acc.columns, ...hits.flatMap((hit) => Object.keys(hit))])];
  return { kind: "rows", columns, rows, total };
}

/** Folds one `promql_response` frame (a matrix chunk) into the series read so far. */
export function foldPromqlFrame(acc: RcaEvidenceSeries, frame: StreamFrame): RcaEvidenceSeries {
  const results = frame.content?.results;
  const matrix = isRecord(results) && Array.isArray(results.result) ? results.result : [];
  const byName = new Map(acc.series.map((series) => [series.name, [...series.points]]));
  for (const item of matrix as PromqlSeries[]) {
    const name = rcaSeriesName(item.metric);
    const points = byName.get(name) ?? [];
    for (const [, raw] of item.values ?? []) {
      const value = typeof raw === "number" ? raw : Number.parseFloat(raw);
      if (Number.isFinite(value)) points.push(value);
    }
    byName.set(name, points);
  }
  const series = [...byName.entries()]
    .slice(0, RCA_RESULT_SERIES)
    .map(([name, points]) => ({ name, points, latest: points.at(-1) ?? null }));
  return { kind: "series", series };
}

/** A step that draws about 60 points across the stored window, never under 15 s. */
const promqlStep = (link: RcaEvidenceTarget): string => {
  const seconds = ((link.end_us ?? 0) - (link.start_us ?? 0)) / 1_000_000;
  return `${Math.max(15, Math.round(seconds / 60))}s`;
};

/** Runs an evidence entry's stored query over the streaming endpoints, only when asked. */
export function useRcaEvidenceResult(org: MaybeRefOrGetter<string>) {
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
  const state = ref<RcaEvidenceResultState>("idle");
  const result = shallowRef<RcaEvidenceResult | null>(null);
  let traceId: string | null = null;

  const cancel = () => {
    if (!traceId) return;
    cancelStreamQueryBasedOnRequestId({ trace_id: traceId, org_id: toValue(org) });
    traceId = null;
  };

  const run = (link: RcaEvidenceTarget) => {
    const runnable = rcaEvidenceRunnable(link);
    if (!runnable) return;
    cancel();
    const current = generateTraceContext().traceId;
    traceId = current;
    state.value = "loading";
    result.value =
      runnable === "sql"
        ? { kind: "rows", columns: [], rows: [], total: null }
        : { kind: "series", series: [] };
    const handlers = {
      data: (_request: unknown, frame: StreamFrame) => {
        if (traceId !== current || !result.value) return;
        if (result.value.kind === "rows" && frame.type?.startsWith("search_response")) {
          result.value = foldSearchFrame(result.value, frame);
        } else if (result.value.kind === "series" && frame.type === "promql_response") {
          result.value = foldPromqlFrame(result.value, frame);
        }
      },
      error: (_request: unknown, error: unknown) => {
        if (traceId !== current) return;
        console.error("RCA evidence query failed:", error);
        state.value = "error";
        traceId = null;
      },
      complete: () => {
        if (traceId !== current) return;
        state.value = "ready";
        traceId = null;
      },
    };
    const range = { start_time: link.start_us, end_time: link.end_us };
    if (runnable === "sql") {
      void fetchQueryDataWithHttpStream(
        {
          queryReq: {
            query: {
              sql: b64EncodeUnicode(link.sql ?? ""),
              ...range,
              from: 0,
              size: RCA_RESULT_ROWS,
            },
            encoding: "base64",
          },
          type: "search",
          traceId: current,
          org_id: toValue(org),
          pageType: link.signal === "traces" ? "traces" : "logs",
          searchType: "ui",
        },
        handlers,
      );
    } else {
      void fetchQueryDataWithHttpStream(
        {
          queryReq: { query: link.promql, ...range, step: promqlStep(link), query_type: "range" },
          type: "promql",
          traceId: current,
          org_id: toValue(org),
        },
        handlers,
      );
    }
  };

  onScopeDispose(cancel);

  return { state, result, run, cancel };
}
