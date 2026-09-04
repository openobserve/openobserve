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

// The "Open in Metrics explorer" drilldown every non-probe chart panel declares
// (design §6.6). On a viewOnly page the description icon is hidden, so this is
// the only path from a number to the query behind it.

import { b64EncodeUnicode } from "@/utils/formatters";

/** A v8 `byUrl` drilldown carrying the panel's own query, base64 per METRICS_PARAMS. */
export function explorerDrilldown(stream: string, query: string) {
  const params = new URLSearchParams({
    query_type: "promql",
    stream_name: stream,
    query: b64EncodeUnicode(query) ?? "",
  });
  return {
    name: "openInMetricsExplorer",
    type: "byUrl",
    targetBlank: true,
    data: { url: `/metrics?${params.toString()}` },
  };
}
