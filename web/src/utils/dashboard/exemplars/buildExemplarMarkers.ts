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

import type { ExemplarMarker, ExemplarQueryResult } from "@/ts/interfaces/exemplars";

export const TRACE_ID_LABEL = "trace_id";
export const SPAN_ID_LABEL = "span_id";

const sortedLabelsKey = (labels: Record<string, string>): string =>
  Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join(",");

/** Cross-query identity: query_exemplars walks only selectors, so two queries can return the same exemplar. */
export function exemplarIdentity(
  labels: Record<string, string>,
  tsMs: number,
  value: number,
): string {
  const traceId = labels[TRACE_ID_LABEL];
  if (traceId) return `${traceId}|${labels[SPAN_ID_LABEL] ?? ""}|${tsMs}`;
  return `${tsMs}|${value}|${sortedLabelsKey(labels)}`;
}

const isEmpty = (labels: Record<string, string> | undefined): boolean =>
  !labels || Object.keys(labels).length === 0;

export function buildExemplarMarkers(
  results: ExemplarQueryResult[],
  window: { startMs: number; endMs: number },
): ExemplarMarker[] {
  const byId = new Map<string, ExemplarMarker>();
  const ordered = [...results].sort((a, b) => a.queryIndex - b.queryIndex);
  for (const result of ordered) {
    for (const series of result.response?.data ?? []) {
      for (const item of series?.exemplars ?? []) {
        const value = Number(item?.value);
        const tsMs = Math.round(Number(item?.timestamp) * 1000);
        if (!Number.isFinite(value) || !Number.isFinite(tsMs)) continue;
        // The API returns exemplars from before `start`, so each one is checked against the window itself.
        if (tsMs < window.startMs || tsMs > window.endMs) continue;
        const labels = item.labels ?? {};
        const id = exemplarIdentity(labels, tsMs, value);
        const existing = byId.get(id);
        if (existing) {
          if (!existing.queryIndexes.includes(result.queryIndex)) {
            existing.queryIndexes.push(result.queryIndex);
            existing.queryIndexes.sort((a, b) => a - b);
          }
          if (isEmpty(existing.seriesLabels) && !isEmpty(series.seriesLabels)) {
            existing.seriesLabels = { ...series.seriesLabels };
          }
          continue;
        }
        byId.set(id, {
          id,
          queryIndexes: [result.queryIndex],
          tsMs,
          value,
          labels: { ...labels },
          seriesLabels: { ...(series.seriesLabels ?? {}) },
          traceId: labels[TRACE_ID_LABEL] || undefined,
          spanId: labels[SPAN_ID_LABEL] || undefined,
        });
      }
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.tsMs !== b.tsMs ? a.tsMs - b.tsMs : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}
