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

import type { FieldAlias, ServiceIdentityConfig } from "@/services/service_streams";
import {
  buildSqlCondition,
  extractSemanticDimensions,
  filterDimensionsForCorrelation,
} from "@/utils/telemetryCorrelation";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { b64EncodeUnicode } from "@/utils/zincutils";

/** The default `service` group lists `__name__`, so sending it would match on the metric name. */
const NEVER_SENT = new Set(["__name__", "le", "quantile"]);
const SERVICE_GROUP = "service";

export type DrilldownAvailability = "oss" | "discoveryOff" | "pending" | "forbidden" | "available";

/** A read's outcome: pending, ok, or the HTTP status it failed with (0 when there was none). */
export type ReadStatus = "pending" | "ok" | number;

interface LabelFilterLike {
  label: string;
  value: string;
  operator?: string;
}

interface TimeWindow {
  start_time: number;
  end_time: number;
}

const filterKey = (f: LabelFilterLike) => `${f.label}\u0000${f.operator ?? "="}\u0000${f.value}`;

/** `_correlate` takes label values, so only the equality filters this metric applies are usable. */
export const contextToDimensions = (
  filters: LabelFilterLike[],
  inapplicableFilters: LabelFilterLike[],
  semanticGroups: FieldAlias[],
  identityConfig: ServiceIdentityConfig,
): { dimensions: Record<string, string>; labelByGroupId: Record<string, string> } => {
  const skipped = new Set(inapplicableFilters.map(filterKey));
  const fields: Record<string, string> = {};
  for (const f of filters) {
    if ((f.operator ?? "=") !== "=" || skipped.has(filterKey(f)) || NEVER_SENT.has(f.label))
      continue;
    fields[f.label] = f.value;
  }
  const dimensions = filterDimensionsForCorrelation(
    extractSemanticDimensions({ timestamp: 0, fields }, semanticGroups),
    identityConfig,
  );
  const labelByGroupId: Record<string, string> = {};
  for (const group of semanticGroups) {
    if (!(group.id in dimensions)) continue;
    const label = group.fields.find((field) => field in fields);
    if (label) labelByGroupId[group.id] = label;
  }
  return { dimensions, labelByGroupId };
};

/** The label "Pick a service" offers the values of: the service group's first one the metric has. */
export const serviceLabelFor = (
  metricLabels: string[],
  semanticGroups: FieldAlias[],
): string | null => {
  const group = semanticGroups.find((g) => g.id === SERVICE_GROUP);
  return (
    group?.fields.find((field) => !NEVER_SENT.has(field) && metricLabels.includes(field)) ?? null
  );
};

export const availability = (state: {
  isEnterprise: string | undefined;
  serviceStreamsEnabled: boolean;
  identityStatus: ReadStatus;
  groupsStatus: ReadStatus;
}): DrilldownAvailability => {
  if (state.isEnterprise !== "true") return "oss";
  if (!state.serviceStreamsEnabled) return "discoveryOff";
  if (state.identityStatus === 403 || state.groupsStatus === 403) return "forbidden";
  // Until both reads answer, a refusal is still possible: the button must not show enabled and then flip.
  if (state.identityStatus === "pending" || state.groupsStatus === "pending") return "pending";
  return "available";
};

export const droppedLabelNames = (
  droppedGroupIds: string[],
  labelByGroupId: Record<string, string>,
): string[] => droppedGroupIds.map((id) => labelByGroupId[id] ?? id);

const whereOf = (filters: Record<string, string>) =>
  b64EncodeUnicode(
    Object.entries(filters)
      .filter(([, value]) => value && value !== SELECT_ALL_VALUE)
      .map(([field, value]) => buildSqlCondition(field, value))
      .join(" AND "),
  );

interface RouteArgs {
  stream: string;
  filters: Record<string, string>;
  timeRange: TimeWindow;
  org: string;
}

/** `defined_schemas` must be present, or restoring the URL pushes a second entry and Back lands on logs again. */
export const buildLogsRoute = ({ stream, filters, timeRange, org }: RouteArgs) => ({
  path: "/logs",
  query: {
    stream_type: "logs",
    stream,
    from: String(timeRange.start_time),
    to: String(timeRange.end_time),
    sql_mode: "false",
    query: whereOf(filters),
    quick_mode: "false",
    show_histogram: "true",
    refresh: "0",
    defined_schemas: "user_defined_schema",
    org_identifier: org,
  },
});

export const buildTracesRoute = ({ stream, filters, timeRange, org }: RouteArgs) => ({
  name: "traces",
  query: {
    stream,
    from: String(timeRange.start_time),
    to: String(timeRange.end_time),
    query: whereOf(filters),
    // Same key order as the traces page's own URL: vue-router compares query strings by order.
    org_identifier: org,
    tab: "traces",
  },
});
