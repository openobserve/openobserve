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

// The "Open in Metrics explorer" drilldown (design §6.6) — on a viewOnly page it is the only path to the query.

import { b64EncodeUnicode } from "@/utils/formatters";

/**
 * A v8 `byUrl` drilldown carrying the panel's own query, base64 per METRICS_PARAMS.
 * `range` is threaded because the explorer reads from/to/period off the query string
 * (ViewDashboard.vue:470-475) and otherwise silently lands on its own 15m default —
 * which would show a DIFFERENT window than the panel the user clicked.
 */
export function explorerDrilldown(
  stream: string,
  query: string,
  range?: { period?: string; from?: number; to?: number },
) {
  const params = new URLSearchParams({
    query_type: "promql",
    stream_name: stream,
    query: b64EncodeUnicode(query) ?? "",
  });
  // A relative window travels as its PERIOD so the destination re-anchors it.
  if (range?.period) {
    params.set("period", range.period);
  } else if (range?.from != null && range?.to != null) {
    params.set("from", String(range.from));
    params.set("to", String(range.to));
  }
  return {
    name: "openInMetricsExplorer",
    type: "byUrl",
    targetBlank: true,
    data: { url: `/metrics?${params.toString()}` },
  };
}
