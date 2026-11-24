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

import { fieldPredicate, type FieldFilter } from "@/utils/dashboard/chartPointExplore";
import {
  DEFAULT_METRIC_GROUP_DEFINITIONS,
  K8S_METRIC_GROUP_DEFINITIONS,
  NODE_PATTERNS,
  POD_PATTERNS,
  groupMetricsByCategory,
  type MetricGroupDefinition,
} from "@/utils/metrics/metricGrouping";
import type { I18nKey } from "@/types/i18n";

const ONE_MINUTE_US = 60_000_000;

/** A trace's detail window: its own start and end, one minute wider on each side, in µs. */
export const traceDetailWindow = (trace: {
  trace_start_time: number;
  trace_end_time: number;
}): { startTime: number; endTime: number } => ({
  startTime: Math.floor(trace.trace_start_time) - ONE_MINUTE_US,
  endTime: Math.ceil(trace.trace_end_time) + ONE_MINUTE_US,
});

const ONE_SECOND_US = 1_000_000;

/**
 * The whole second holding an event, in µs: the Logs page's time picker keeps whole seconds,
 * so this is the narrowest range that survives its round trip and still contains the event.
 */
export const eventSecondWindow = (ts: number): { startTime: number; endTime: number } => {
  const startTime = Math.floor(ts / ONE_SECOND_US) * ONE_SECOND_US;
  return { startTime, endTime: startTime + ONE_SECOND_US };
};

/** The next page exists while the last one came back full; the traces list has no total. */
export const hasFullPage = (rows: number, pageSize: number): boolean =>
  rows > 0 && rows >= pageSize;

/** The clicked labels the metric carries; any other would match no sample, so it is left out. */
export const labelsOnMetric = (filters: FieldFilter[], labels: string[]): FieldFilter[] => {
  const known = new Set(labels);
  return filters.filter((f) => known.has(f.field));
};

/** The raw-sample SQL of a metric under its label filters, newest first. */
export const metricsSql = (stream: string, filters: FieldFilter[]): string => {
  const where = filters.map(fieldPredicate).join(" AND ");
  return `SELECT * FROM "${stream}"${where ? ` WHERE ${where}` : ""} ORDER BY _timestamp DESC`;
};

// A sample's own columns: its time, its value and the engine's bookkeeping, not labels.
const isSampleColumn = (key: string): boolean => key === "value" || key.startsWith("_");

/** The label set that names a sample's series: every column but its time, value and internals. */
export const sampleLabels = (row: Record<string, unknown>): FieldFilter[] =>
  Object.entries(row)
    .filter(([key]) => !isSampleColumn(key))
    .map(([field, value]) => ({
      field,
      value: value === null || value === undefined || value === "" ? null : String(value),
    }));

/** Whether a µs timestamp falls inside the clicked bucket. */
export const inBucket = (ts: number, bucket: { startTime: number; endTime: number }): boolean =>
  ts >= bucket.startTime && ts < bucket.endTime;

export type MetricPickerTab = "pods" | "nodes";

const matchesAny = (name: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(name.toLowerCase()));

/** Whether the metric streams follow the Kubernetes naming that splits them into Pods and Nodes. */
export const isK8sMetricSet = (streams: string[]): boolean =>
  streams.some((name) => matchesAny(name, POD_PATTERNS) || matchesAny(name, NODE_PATTERNS));

export interface MetricPickerGroup {
  id: string;
  labelKey: I18nKey;
  streams: string[];
}

/** The picker's groups for a search; Kubernetes sets list only the active tab's pod or node metrics. */
export const metricPickerGroups = (
  streams: string[],
  search: string,
  tab: MetricPickerTab | null,
): MetricPickerGroup[] => {
  const needle = search.trim().toLowerCase();
  const scoped = streams.filter((name) => {
    if (needle && !name.toLowerCase().includes(needle)) return false;
    if (tab === "pods") return matchesAny(name, POD_PATTERNS);
    if (tab === "nodes") return matchesAny(name, NODE_PATTERNS);
    return true;
  });
  const defs: MetricGroupDefinition[] = tab
    ? (K8S_METRIC_GROUP_DEFINITIONS.find((g) => g.id === tab)?.children ??
      DEFAULT_METRIC_GROUP_DEFINITIONS)
    : DEFAULT_METRIC_GROUP_DEFINITIONS;
  const grouped = groupMetricsByCategory(
    scoped.map((name) => ({ stream_name: name, stream_type: "metrics" })),
    defs,
  );
  return grouped.groups
    .filter((group) => group.streams.length)
    .map((group) => ({
      id: group.id,
      labelKey: group.labelKey,
      streams: group.streams.map((s) => s.stream_name),
    }));
};
