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
// Metrics panel <-> URL codec (Feature 1 / "Mechanism A").
//
// Encodes the WHOLE panel (`dashboardPanelData.data` — every query incl.
// builder-mode, chart type, query type, all per-query/panel configs) into one
// opaque, versioned, url-safe base64 blob (`metrics_data`). Field-agnostic by
// design: it never enumerates a query or a field, so adding a query/config
// requires ZERO change here — multi-query is free.
//
// This module also owns `applyDeepLinkOverrides` (Feature 2 / "Mechanism B"),
// which delegates to the page-agnostic registry engine. See
// `@/utils/url/deepLinkParams` and `@/utils/metrics/metricsParamRegistry`.
// ---------------------------------------------------------------------------

import { b64EncodeUnicode, b64DecodeUnicodeSafe } from "@/utils/zincutils";
import { applyOverridesFromRegistry } from "@/utils/url/deepLinkParams";
import {
  METRICS_PARAMS,
  defaultMetricsQuery,
} from "@/utils/metrics/metricsParamRegistry";

/** Bump when the blob payload shape changes; older blobs decode to `null`. */
export const METRICS_BLOB_VERSION = 1;

export interface MetricsBlob {
  v: number;
  data: Record<string, any>;
}

// Volatile / per-instance bits that must NOT travel in a shared blob.
const VOLATILE_DATA_KEYS = ["id", "title", "description"];

/**
 * Snapshot the shareable panel config: a deep, non-reactive clone of
 * `dashboardPanelData.data` minus volatile bits. `meta` lives outside `data`
 * and is excluded by construction.
 */
export const getMetricsConfig = (dashboardPanelData: any): MetricsBlob => {
  const data = JSON.parse(JSON.stringify(dashboardPanelData?.data ?? {}));
  for (const key of VOLATILE_DATA_KEYS) delete data[key];
  return { v: METRICS_BLOB_VERSION, data };
};

/** Panel config -> url-safe base64 of `{ v, data }` (empty string on failure). */
export const encodeMetricsConfig = (blob: MetricsBlob): string => {
  try {
    return b64EncodeUnicode(JSON.stringify(blob)) ?? "";
  } catch (e) {
    console.log("Error: encodeMetricsConfig: failed to encode metrics blob.");
    return "";
  }
};

/**
 * base64 `metrics_data` -> `{ v, data }`, or `null` on bad/old/empty input
 * (never throws). Callers fall back to defaults when `null`.
 */
export const decodeMetricsConfig = (
  raw: string | null | undefined,
): MetricsBlob | null => {
  if (!raw) return null;
  try {
    const decoded = b64DecodeUnicodeSafe(raw);
    if (!decoded) return null;
    const parsed = JSON.parse(decoded);
    // Version gate + minimal shape check. Migration hook lives here.
    if (!parsed || typeof parsed !== "object" || !parsed.data) return null;
    if (parsed.v !== METRICS_BLOB_VERSION) return null;
    return parsed as MetricsBlob;
  } catch (e) {
    console.log("Error: decodeMetricsConfig: invalid metrics blob.");
    return null;
  }
};

/**
 * Apply a decoded blob onto the live panel IN PLACE (preserves the reactive
 * `data` identity — never reassign `.data`). Forces `stream_type = "metrics"`
 * on every query and resets the current query index. Returns true if applied.
 */
export const applyMetricsBlob = (
  raw: string | null | undefined,
  dashboardPanelData: any,
): boolean => {
  const blob = decodeMetricsConfig(raw);
  if (!blob) return false;

  const data = blob.data ?? {};
  if (Array.isArray(data.queries)) {
    for (const q of data.queries) {
      if (q && q.fields) q.fields.stream_type = "metrics";
    }
  }

  Object.assign(dashboardPanelData.data, data);
  if (dashboardPanelData.layout) dashboardPanelData.layout.currentQueryIndex = 0;
  return true;
};

/**
 * Apply inbound deep-link OVERRIDE params (Feature 2) on top of the current
 * panel (base = blob or defaults). Thin wrapper over the page-agnostic engine
 * driven by the metrics param registry.
 */
export const applyDeepLinkOverrides = (
  query: Record<string, any>,
  dashboardPanelData: any,
): void => {
  applyOverridesFromRegistry(METRICS_PARAMS, query, dashboardPanelData, {
    makeDefaultQuery: defaultMetricsQuery,
    // no blob base -> build from scratch, so compact indices (no empty leading/
    // middle queries); with a blob base, keep literal indices for surgical
    // per-series override.
    compactIndices: !query.metrics_data,
    // every addressed slot is a metrics query (covers query-only slots too)
    onIndexApplied: (slot) => {
      if (slot?.fields) slot.fields.stream_type = "metrics";
    },
  });
};
