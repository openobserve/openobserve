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

// ---------------------------------------------------------------------------
// Redirection entry point — build a deep-link INTO the Metrics page.
//
// Owns the param names + indexing so callers (metric list / alert / dashboard
// panel "Open in Metrics") never hardcode URL keys. Panel/per-query params are
// emitted by the registry engine; time/refresh/org are set directly. The raw
// `query` is base64-encoded by the registry — callers pass plain text.
//
// Mirrors the logs precedent `onLogPanel`/`constructLogsUrl`
// (`PanelContainer.vue`) but multi-query and registry-driven.
// ---------------------------------------------------------------------------

import shortURL from "@/services/short_url";
import { buildUrlFromRegistry } from "@/utils/url/deepLinkParams";
import { METRICS_PARAMS } from "@/utils/metrics/metricsParamRegistry";

export interface MetricsQueryIntent {
  /** metric/stream name -> `stream_name`. */
  stream?: string;
  /** raw PromQL/SQL (NOT base64 — the registry encodes it) -> `query`. */
  query?: string;
}

export interface MetricsLinkIntent {
  orgId: string;
  /** optional `metrics_data` blob to layer overrides on (a template). */
  base?: string;
  /** index 0..N-1 -> bare key, `.1`, `.2` … */
  queries?: MetricsQueryIntent[];
  chartType?: string;
  queryType?: "promql" | "sql";
  /** relative `period` OR absolute `from`+`to`. */
  time?: { period?: string } | { from: string | number; to: string | number };
  /** auto-refresh label, e.g. "30s" | "off". */
  refresh?: string;
  /** override the web base (defaults to the current app base). */
  baseUrl?: string;
}

/** The app web base (handles the optional `/web` sub-path), mirroring onLogPanel. */
const webBase = (): string => {
  const pos = window.location.pathname.indexOf("/web/");
  return pos > -1
    ? window.location.origin + window.location.pathname.slice(0, pos) + "/web"
    : window.location.origin;
};

/** Build a `/metrics?…` deep-link URL from a caller intent. */
export const buildMetricsUrl = (intent: MetricsLinkIntent): URL => {
  const url = new URL((intent.baseUrl ?? webBase()) + "/metrics");
  const p = url.searchParams;

  p.set("org_identifier", intent.orgId);
  if (intent.base) p.set("metrics_data", intent.base);

  // time (relative period OR absolute from/to)
  const time: any = intent.time;
  if (time?.period) {
    p.set("period", String(time.period));
  } else if (time?.from != null && time?.to != null) {
    p.set("from", String(time.from));
    p.set("to", String(time.to));
  }
  if (intent.refresh) p.set("refresh", intent.refresh);

  // panel-level + per-query (indexed) overrides, registry-driven
  buildUrlFromRegistry(url, METRICS_PARAMS, intent);

  return url;
};

/**
 * Build the deep-link, shorten it via `short_url`, and open it (new tab by
 * default, mirroring `onLogPanel`). Falls back to the long URL on failure.
 * Returns the URL actually opened.
 */
export const openMetricsDeepLink = async (
  intent: MetricsLinkIntent,
  opts: { newTab?: boolean } = {},
): Promise<string> => {
  const newTab = opts.newTab ?? true;
  const longUrl = buildMetricsUrl(intent).toString();
  let target = longUrl;
  try {
    const res = await shortURL.create(intent.orgId, longUrl);
    target = res?.data?.short_url || longUrl;
  } catch (e) {
    target = longUrl;
  }
  if (newTab) window.open(target, "_blank");
  else window.location.href = target;
  return target;
};
