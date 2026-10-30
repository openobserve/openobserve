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

// Metrics panel <-> URL codec: the whole panel as one versioned base64 blob (metrics_data),
// plus applyDeepLinkOverrides (inbound override params via the registry engine).

import { b64EncodeUnicode, b64DecodeUnicodeSafe } from "@/utils/zincutils";
import { applyOverridesFromRegistry } from "@/utils/url/deepLinkParams";
import { METRICS_PARAMS, defaultMetricsQuery } from "@/utils/metrics/metricsParamRegistry";

// bump when the blob payload shape changes; older blobs decode to null
export const METRICS_BLOB_VERSION = 1;

export interface MetricsBlob {
  v: number;
  data: Record<string, any>;
}

// volatile bits that must NOT travel in a shared blob
const VOLATILE_DATA_KEYS = ["id", "title", "description"];

// deep, non-reactive clone of dashboardPanelData.data minus volatile bits
export const getMetricsConfig = (dashboardPanelData: any): MetricsBlob => {
  const data = JSON.parse(JSON.stringify(dashboardPanelData?.data ?? {}));
  for (const key of VOLATILE_DATA_KEYS) delete data[key];
  return { v: METRICS_BLOB_VERSION, data };
};

export const encodeMetricsConfig = (blob: MetricsBlob): string => {
  try {
    return b64EncodeUnicode(JSON.stringify(blob)) ?? "";
  } catch (e) {
    return "";
  }
};

// base64 metrics_data -> { v, data }, or null on bad/old/empty input (never throws)
export const decodeMetricsConfig = (raw: string | null | undefined): MetricsBlob | null => {
  if (!raw) return null;
  try {
    const decoded = b64DecodeUnicodeSafe(raw);
    if (!decoded) return null;
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || !parsed.data) return null;
    if (parsed.v !== METRICS_BLOB_VERSION) return null; // version gate / migration hook
    return parsed as MetricsBlob;
  } catch (e) {
    return null;
  }
};

// A blob query filled out to the full panel schema. The blob comes from a URL
// anyone can hand-write or truncate, and the panel reads `fields.x.length` and
// `fields.filter.conditions.length` without guarding, so a query missing either
// throws mid-render and blanks the whole metrics page.
const normaliseBlobQuery = (q: any): any => {
  const slot = defaultMetricsQuery();
  const fields = { ...slot.fields, ...(q?.fields ?? {}) };
  fields.filter = { ...slot.fields?.filter, ...(q?.fields?.filter ?? {}) };
  fields.stream_type = "metrics";
  return { ...slot, ...(q ?? {}), fields, config: { ...slot.config, ...(q?.config ?? {}) } };
};

// Blob panel data made safe to lay over a panel, mutated in place. Every route
// that seeds a panel from a URL blob must go through this, not just the codec —
// the explorer's Visualize pane seeds from the decoded object directly.
export const normaliseMetricsBlobData = (data: Record<string, any>): Record<string, any> => {
  // An empty array would leave the panel with no query at all, so it keeps the default.
  if (Array.isArray(data.queries) && data.queries.length) {
    data.queries = data.queries.map(normaliseBlobQuery);
  } else {
    delete data.queries;
  }
  return data;
};

// apply a decoded blob onto the live panel IN PLACE (never reassign .data); returns true if applied
export const applyMetricsBlob = (
  raw: string | null | undefined,
  dashboardPanelData: any,
): boolean => {
  const blob = decodeMetricsConfig(raw);
  if (!blob) return false;

  Object.assign(dashboardPanelData.data, normaliseMetricsBlobData(blob.data ?? {}));
  if (dashboardPanelData.layout) dashboardPanelData.layout.currentQueryIndex = 0;
  return true;
};

// apply inbound deep-link override params on top of the current panel
export const applyDeepLinkOverrides = (
  query: Record<string, any>,
  dashboardPanelData: any,
): void => {
  applyOverridesFromRegistry(METRICS_PARAMS, query, dashboardPanelData, {
    makeDefaultQuery: defaultMetricsQuery,
    // no blob base -> compact (build from scratch); with a blob -> literal index (surgical)
    compactIndices: !query.metrics_data,
    onIndexApplied: (slot) => {
      if (slot?.fields) slot.fields.stream_type = "metrics";
    },
  });
};
