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

// Metrics deep-link param registry: the inbound override params the page accepts (consumed by deepLinkParams).
// time (from/to/period) and refresh are not descriptors — they ride urlTimeParams.

import store from "@/stores";
import { getDefaultDashboardPanelData } from "@/composables/dashboard/useDashboardPanelDefaults";
import { b64EncodeUnicode, b64DecodeUnicodeSafe } from "@/utils/zincutils";
import type { ParamDescriptor } from "@/utils/url/deepLinkParams";

// valid panel chart types (ChartSelection.vue ids); unknown -> ignored
const VALID_CHART_TYPES = new Set<string>([
  "area",
  "area-stacked",
  "bar",
  "h-bar",
  "line",
  "scatter",
  "stacked",
  "h-stacked",
  "geomap",
  "maps",
  "pie",
  "donut",
  "heatmap",
  "table",
  "metric",
  "gauge",
  "html",
  "markdown",
  "sankey",
  "custom_chart",
]);

export const sanitizeChartType = (raw: string): string | null =>
  VALID_CHART_TYPES.has(raw) ? raw : null;

// a fresh metrics query slot (cloned from the panel default, stream_type=metrics)
export const defaultMetricsQuery = (): any => {
  const q = JSON.parse(JSON.stringify(getDefaultDashboardPanelData(store).data.queries[0]));
  if (q?.fields) q.fields.stream_type = "metrics";
  return q;
};

export const METRICS_PARAMS: ParamDescriptor[] = [
  {
    key: "chart_type",
    scope: "panel",
    apply: (dpd, value) => {
      const t = sanitizeChartType(String(value));
      if (t) dpd.data.type = t;
    },
    read: (intent) => intent?.chartType,
  },
  {
    key: "query_type",
    scope: "panel",
    apply: (dpd, value) => {
      dpd.data.queryType = value === "sql" ? "sql" : "promql";
    },
    read: (intent) => intent?.queryType,
  },
  {
    key: "stream_name",
    aliases: ["stream"], // legacy: logs/alerts/incidents emit `stream`
    scope: "perQuery",
    apply: (slot, value) => {
      if (!slot.fields) slot.fields = {};
      slot.fields.stream = value;
      slot.fields.stream_type = "metrics";
    },
    read: (q) => q?.stream,
  },
  {
    key: "query",
    scope: "perQuery",
    // base64 of the raw PromQL/SQL; presence ⇒ custom, honored verbatim
    decode: (raw) => b64DecodeUnicodeSafe(raw),
    encode: (value) => b64EncodeUnicode(String(value)),
    apply: (slot, value) => {
      slot.query = value;
      slot.customQuery = true;
    },
    read: (q) => q?.query,
  },
];
