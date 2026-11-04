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

import type {
  HistoryTime,
  QueryHistoryEntry,
  QueryHistoryRecordBody,
} from "@/services/query_history";
import { buildHistoryEntry, historyEntryToLoad } from "@/utils/metrics/queryHistory";
import { selectorMetricNames } from "@/utils/dashboard/exemplars/exemplarPlacement";
import type { SelectedDate } from "@/utils/dashboard/urlTimeParams";
import {
  buildQueryKey,
  plainMessage,
  restoreWindow,
  resultContext,
  toRunError,
  type RestoreTime,
  type RunError,
  type RunResult,
} from "./recentSearches";

/** The parts of the Metrics panel state the record reads. */
export interface MetricsPanelState {
  data?: {
    queryType?: string;
    queries?: { query?: string; fields?: { stream?: string }; config?: { formula?: string } }[];
  };
  layout?: { hiddenQueries?: number[]; currentQueryIndex?: number };
}

export interface MetricsRunRecordInput {
  panel: MetricsPanelState;
  selectedDate: Partial<SelectedDate> | null;
  /** The resolved window of the run, in microseconds; null when the picker has none. */
  window: { startUs: number; endUs: number } | null;
}

/** The panel's `{ message, code }` error, where `code` is a search error code or an HTTP status. */
export interface PanelErrorDetail {
  message?: unknown;
  code?: unknown;
}

export interface MetricsRestore {
  metricsData: string;
  timeRange: SelectedDate;
}

/** Metric names of the visible queries, in panel order. */
const metricStreams = (panel: MetricsPanelState): string[] => {
  const hidden = panel.layout?.hiddenQueries ?? [];
  const promql = (panel.data?.queryType ?? "promql") === "promql";
  // A custom PromQL query keeps the stream picker's last metric, so its selectors are the truth.
  const names = (panel.data?.queries ?? [])
    .filter((_, index) => !hidden.includes(index))
    .flatMap((q) => {
      const text = q.query?.trim() ?? "";
      if (promql && text) return selectorMetricNames(text);
      return q.fields?.stream?.trim() ? [q.fields.stream.trim()] : [];
    })
    .filter((name) => !!name && !name.includes(","));
  return [...new Set(names)];
};

/** True when no visible query has text, so loading a whole recent panel replaces nothing typed. */
export const metricsEditorIsEmpty = (panel: MetricsPanelState | null | undefined): boolean => {
  const hidden = panel?.layout?.hiddenQueries ?? [];
  return (panel?.data?.queries ?? [])
    .filter((_, index) => !hidden.includes(index))
    .every((q) => !String(q.query ?? "").trim() && !String(q.config?.formula ?? "").trim());
};

/** As metricsEditorIsEmpty, with the active query's blankness read from the editor, ahead of the debounced panel. */
export const metricsEditorIsEmptyWith = (
  panel: MetricsPanelState | null | undefined,
  editorBlank: boolean,
): boolean => {
  const current = panel?.layout?.currentQueryIndex ?? 0;
  const hidden = panel?.layout?.hiddenQueries ?? [];
  return (
    editorBlank &&
    (panel?.data?.queries ?? []).every(
      (q, index) =>
        index === current ||
        hidden.includes(index) ||
        (!String(q.query ?? "").trim() && !String(q.config?.formula ?? "").trim()),
    )
  );
};

/** Metrics keeps the v1.1.x context and adds the resolved window, so one loader reads both. */
export const buildMetricsRecord = (input: MetricsRunRecordInput): QueryHistoryRecordBody | null => {
  const legacy = buildHistoryEntry(input.panel, input.selectedDate);
  if (!legacy) return null;
  const streams = metricStreams(input.panel);
  const mode = input.panel.data?.queryType ?? "promql";
  const relative = input.selectedDate?.valueType !== "absolute";
  const time: HistoryTime | undefined = input.window
    ? {
        type: relative ? "relative" : "absolute",
        ...(relative && input.selectedDate?.relativeTimePeriod
          ? { period: input.selectedDate.relativeTimePeriod }
          : {}),
        start_time: input.window.startUs,
        end_time: input.window.endUs,
      }
    : undefined;
  return {
    source: "metrics",
    query: legacy.query,
    query_key: buildQueryKey({ streams, streamType: "metrics", mode, query: legacy.query }),
    streams,
    status: "ok",
    context: { ...legacy.context, ...(time ? { time } : {}) },
  };
};

/** The run error a panel error stands for, or null when the panel cleared its error. */
export const metricsRunError = (
  detail: PanelErrorDetail | string | null | undefined,
): RunError | null => {
  if (!detail) return null;
  const message = plainMessage(typeof detail === "string" ? detail : detail.message);
  if (!message) return null;
  return typeof detail === "string" ? { message } : toRunError({ code: detail.code, message });
};

export const withRunResult = (
  body: QueryHistoryRecordBody,
  result: RunResult,
): QueryHistoryRecordBody => ({
  ...body,
  status: result.status,
  context: { ...body.context, ...resultContext(result) },
});

/** The panel and range a Metrics row reopens with; v1.1.x rows reopen at their stored range. */
export const metricsRestore = (
  entry: QueryHistoryEntry,
  when: RestoreTime,
): MetricsRestore | null => {
  const loaded = historyEntryToLoad(entry.context);
  if (!loaded) return null;
  const window = restoreWindow(entry.context.time, when);
  if (!window || window.type === "relative") return loaded;
  return {
    metricsData: loaded.metricsData,
    timeRange: {
      valueType: "absolute",
      startTime: window.startUs,
      endTime: window.endUs,
      relativeTimePeriod: loaded.timeRange.relativeTimePeriod,
    },
  };
};

/** URL query that opens a Metrics row on its page; the Metrics link carries the window in ms. */
export const metricsRouteQuery = (
  entry: QueryHistoryEntry,
  when: RestoreTime,
  orgId: string,
): Record<string, string> | null => {
  const restore = metricsRestore(entry, when);
  if (!restore) return null;
  const query: Record<string, string> = {
    org_identifier: orgId,
    metrics_data: restore.metricsData,
  };
  const range = restore.timeRange;
  if (range.valueType === "absolute" && range.startTime && range.endTime) {
    query.from = String(Math.floor(Number(range.startTime) / 1000));
    query.to = String(Math.floor(Number(range.endTime) / 1000));
  } else {
    query.period = range.relativeTimePeriod;
  }
  return query;
};
