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

import type { RouteLocationRaw } from "vue-router";
import type { ExemplarMarker, TraceVerdict } from "@/ts/interfaces/exemplars";

/** The stream an unverified trace falls back to, as RUM correlation does. */
export const EXEMPLAR_FALLBACK_TRACES_STREAM = "default";
/** Half-width of the window opened around an unverified exemplar, in µs. */
export const EXEMPLAR_FALLBACK_WINDOW_US = 15 * 60 * 1_000_000;

/** Where a marker click goes; null when the trace is unavailable or absent. */
export function buildExemplarTraceRoute(
  marker: ExemplarMarker,
  verdict: TraceVerdict,
  org: string,
): RouteLocationRaw | null {
  if (!marker.traceId) return null;
  let stream: string;
  let from: number;
  let to: number;
  if (verdict.state === "found") {
    stream = verdict.stream;
    from = verdict.startUs;
    to = verdict.endUs;
  } else if (verdict.state === "unverified") {
    const tsUs = Math.round(marker.tsMs * 1000);
    stream = EXEMPLAR_FALLBACK_TRACES_STREAM;
    from = tsUs - EXEMPLAR_FALLBACK_WINDOW_US;
    to = tsUs + EXEMPLAR_FALLBACK_WINDOW_US;
  } else {
    return null;
  }
  const query: Record<string, string> = {
    stream,
    trace_id: marker.traceId,
    from: String(from),
    to: String(to),
    org_identifier: org,
  };
  if (marker.spanId) query.span_id = marker.spanId;
  return { name: "traceDetails", query };
}
