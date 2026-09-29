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

// Mirrors the `query_exemplars` response in `src/api/search/src/promql/mod.rs`.

export interface ExemplarApiItem {
  labels: Record<string, string>;
  value: string;
  /** Seconds, possibly fractional. */
  timestamp: number;
}

export interface ExemplarApiSeries {
  seriesLabels: Record<string, string>;
  exemplars: ExemplarApiItem[];
}

export interface ExemplarApiResponse {
  status: string;
  data: ExemplarApiSeries[];
}

export interface ExemplarQueryResult {
  queryIndex: number;
  query: string;
  response: ExemplarApiResponse;
}

export interface ExemplarMarker {
  /** Cross-query identity; holds no query index so shared selectors merge. */
  id: string;
  /** Sorted ascending; the first entry picks the marker colour. */
  queryIndexes: number[];
  tsMs: number;
  value: number;
  labels: Record<string, string>;
  seriesLabels: Record<string, string>;
  traceId?: string;
  spanId?: string;
}

export type ExemplarStatus = "off" | "loading" | "ready" | "empty" | "error";

export type ExemplarUnverifiedReason = "timeout" | "partial" | "error" | "forbidden";

export type TraceVerdict =
  | { state: "checking" }
  | { state: "found"; stream: string; startUs: number; endUs: number }
  | { state: "not_available" }
  | { state: "unverified"; reason: ExemplarUnverifiedReason }
  | { state: "none" };

/** Exemplar state an owner outside the renderer (the explorer grid) pushes in. */
export interface InjectedExemplars {
  status: ExemplarStatus;
  markers: ExemplarMarker[];
  errorMessage: string;
  /** Tag text per query index, e.g. the percentile legend. */
  queryLabels?: string[];
  /** The metric's own unit, which exemplar values are in. */
  valueUnit?: string;
  valueUnitCustom?: string | null;
}

/** Dashboard attribution forwarded on every exemplar request. */
export interface ExemplarRequestMeta {
  dashboard_id?: string;
  dashboard_name?: string;
  folder_id?: string;
  folder_name?: string;
  panel_id?: string;
  panel_name?: string;
  run_id?: string;
  tab_id?: string;
  tab_name?: string;
}

/** A drawn marker with its pixel position on the chart canvas. */
export interface ExemplarPoint {
  marker: ExemplarMarker;
  xPx: number;
  yPx: number;
  clamped: "top" | "bottom" | false;
  placement: "value" | "line";
}
