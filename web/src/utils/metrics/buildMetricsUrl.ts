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

// Build a deep-link INTO the Metrics page: owns the param names so callers never hardcode URL keys.

import shortURL from "@/services/short_url";
import { buildUrlFromRegistry } from "@/utils/url/deepLinkParams";
import { METRICS_PARAMS } from "@/utils/metrics/metricsParamRegistry";

export interface MetricsQueryIntent {
  stream?: string;
  query?: string; // raw PromQL/SQL (NOT base64 — the registry encodes it)
}

export interface MetricsLinkIntent {
  orgId: string;
  base?: string; // optional metrics_data blob to layer overrides on
  queries?: MetricsQueryIntent[];
  chartType?: string;
  queryType?: "promql" | "sql";
  time?: { period?: string } | { from: string | number; to: string | number };
  refresh?: string;
  baseUrl?: string;
}

// app web base (handles the optional /web sub-path), mirroring onLogPanel
const webBase = (): string => {
  const pos = window.location.pathname.indexOf("/web/");
  return pos > -1
    ? window.location.origin + window.location.pathname.slice(0, pos) + "/web"
    : window.location.origin;
};

export const buildMetricsUrl = (intent: MetricsLinkIntent): URL => {
  const url = new URL((intent.baseUrl ?? webBase()) + "/metrics");
  const p = url.searchParams;

  p.set("org_identifier", intent.orgId);
  if (intent.base) p.set("metrics_data", intent.base);

  const time: any = intent.time;
  if (time?.period) {
    p.set("period", String(time.period));
  } else if (time?.from != null && time?.to != null) {
    p.set("from", String(time.from));
    p.set("to", String(time.to));
  }
  if (intent.refresh) p.set("refresh", intent.refresh);

  buildUrlFromRegistry(url, METRICS_PARAMS, intent);

  return url;
};

// build the deep-link, shorten via short_url, and open it (new tab by default); long-URL fallback
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
