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

import { formatInTimeZone } from "date-fns-tz";
import { getDataValue } from "@/utils/dashboard/aliasUtils";
import type { I18nText } from "@/types/i18n";

/** One `field = value` condition; a null value matches rows where the field is empty. */
export interface FieldFilter {
  field: string;
  value: string | number | null;
}

/** One View logs / View traces row of the point menu; `detail` is its slice or why it is off. */
export interface PointExploreItem {
  state: "enabled" | "disabled" | "pending";
  detail: I18nText;
  // Only a licence lock shows the lock icon; a chart that lacks data shows a neutral one.
  locked?: boolean;
}

/** The slice a clicked point explores, in microseconds. */
export interface PointTarget {
  queryIndex: number;
  stream: string;
  streamType: string;
  startTime: number;
  endTime: number;
  timeSlice: TimeSlice;
  filters: FieldFilter[];
}

/** The point menu's section: its target, both rows, and where View traces opens once known. */
export interface PointExplore {
  target: PointTarget;
  logs: PointExploreItem;
  traces: PointExploreItem;
  tracesTarget: { stream: string; filter: string } | null;
}

/** What a clicked point is scoped by: its time bucket, or the whole panel range. */
export type PointFamily = "time" | "category" | "heatmap";

/** Whether the explored time span is the clicked bucket or the whole panel range. */
export type TimeSlice = "bucket" | "panelRange";

/** The parts of a chart click that name its group-by values. */
export interface PointClick {
  /** The clicked category, slice or bar label. */
  name?: unknown;
  /** The clicked series' breakdown value. */
  seriesValue?: unknown;
  /** The tile path of a treemap or sunburst click, outermost first. */
  path?: unknown[];
  /** A heatmap cell's raw row value. */
  heatmapRow?: unknown;
  /** A heatmap cell's column label when its x axis is not time. */
  heatmapColumn?: unknown;
  /** Each x and breakdown field's value read off the clicked row's own axes, by alias. */
  fieldValues?: Map<string, unknown>;
}

/** Why View logs or View traces cannot open for this chart. */
export type ExploreBlock = "logsNeedLogsStream" | "noTraceCorrelation" | "needsGroupBy";

export type LogsAvailability =
  | { kind: "enabled" }
  | { kind: "locked"; feature: string }
  | { kind: "blocked"; reason: ExploreBlock };

export type TracesAvailability =
  | { kind: "tracesStream" }
  | { kind: "correlate" }
  | { kind: "locked"; feature: string }
  | { kind: "blocked"; reason: ExploreBlock };

const TIME_TYPES = ["line", "area", "area-stacked", "bar", "stacked", "scatter"];
const HORIZONTAL_TYPES = ["h-bar", "h-stacked"];
const CATEGORY_TYPES = ["pie", "donut", "treemap", "sunburst", "funnel"];
const PATH_TYPES = ["treemap", "sunburst"];

/** How a click on `type` is scoped, or null where the chart has no point menu. */
export const pointFamily = (type: unknown, timeAxis: boolean): PointFamily | null => {
  if (typeof type !== "string") return null;
  if (type === "heatmap") return "heatmap";
  if (TIME_TYPES.includes(type) || HORIZONTAL_TYPES.includes(type)) {
    return timeAxis ? "time" : "category";
  }
  return CATEGORY_TYPES.includes(type) ? "category" : null;
};

export const isHorizontalBarChart = (type: unknown): boolean =>
  typeof type === "string" && HORIZONTAL_TYPES.includes(type);

/** Whether a builder x field buckets or reads the timestamp column. */
export const isTimeXField = (field: any, timestampColumn: string): boolean =>
  field?.args?.[0]?.value?.field === timestampColumn &&
  (!field?.functionName || field.functionName === "histogram");

/** The stream column a builder group-by field reads, or null for a computed one. */
export const groupFieldColumn = (
  field: any,
  customColumns?: Map<string, string>,
): string | null => {
  if (!field) return null;
  if (customColumns) return customColumns.get(field.alias) ?? null;
  if (field.isDerived || field.functionName || field.aggregationFunction) return null;
  if (Array.isArray(field.args)) {
    return field.args[0]?.type === "field" ? (field.args[0]?.value?.field ?? null) : null;
  }
  return field.column ?? null;
};

// A clicked label is always text; the row it came from keeps the value's own type.
const rowValue = (rows: any[] | undefined, alias: string, label: unknown): unknown => {
  const text = String(label ?? "");
  const row = (rows ?? []).find((r) => String(getDataValue(r, alias) ?? "") === text);
  return row ? getDataValue(row, alias) : label;
};

const toFilterValue = (value: unknown): string | number | null => {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "number" ? value : String(value);
};

/** The group-by conditions of a clicked point: its category, series and tile values. */
export const pointGroupFilters = (
  query: any,
  panel: { type: string; config?: any },
  family: PointFamily,
  click: PointClick,
  rows: any[] | undefined,
  customColumns?: Map<string, string>,
): FieldFilter[] => {
  const fields = query?.fields ?? {};
  const x: any[] = fields.x ?? [];
  const breakdown: any[] = fields.breakdown ?? [];
  const pairs: [any, unknown][] = [];
  if (family === "heatmap") {
    pairs.push([fields.y?.[0], click.heatmapRow]);
    if (click.heatmapColumn !== undefined) pairs.push([x[0], click.heatmapColumn]);
  } else if (PATH_TYPES.includes(panel.type)) {
    [...x, ...breakdown].forEach((field, index) => pairs.push([field, click.path?.[index]]));
  } else {
    // A time chart's first x field is the bucket the slice already covers.
    const timeField = family === "time" ? x[0] : undefined;
    [...x, ...breakdown].forEach((field) => {
      if (field === timeField) return;
      const fromAxes = click.fieldValues?.get(field?.alias);
      const label =
        fromAxes !== undefined
          ? fromAxes
          : field === x[0]
            ? click.name
            : field === breakdown[0]
              ? click.seriesValue
              : undefined;
      // The aggregate of every series past the top N is not a value of the field.
      const isOthers =
        breakdown.includes(field) && panel.config?.top_results_others && label === "others";
      if (!isOthers) pairs.push([field, label]);
    });
  }
  return pairs.flatMap(([field, label]) => {
    if (!field || label === undefined) return [];
    // A bucketed heatmap row is a range's lower bound, not a value of the field.
    if (field === fields.y?.[0] && panel.config?.heatmap_y_bucket?.mode) return [];
    const column = groupFieldColumn(field, customColumns);
    if (!column) return [];
    return [{ field: column, value: toFilterValue(rowValue(rows, field.alias, label)) }];
  });
};

const escSql = (value: string | number): string => String(value).replace(/'/g, "''");

/** One condition as SQL: IS NULL for empty, unquoted for numbers, an escaped literal otherwise. */
export const fieldPredicate = ({ field, value }: FieldFilter): string => {
  if (value === null || value === undefined || value === "") return `${field} IS NULL`;
  if (typeof value === "number") return `${field} = ${value}`;
  return `${field} = '${escSql(value)}'`;
};

/** The panel WHERE AND every condition, or "" when there is neither. */
export const filtersWhere = (baseWhere: string | undefined, filters: FieldFilter[]): string =>
  [...(baseWhere ? [`(${baseWhere})`] : []), ...filters.map(fieldPredicate)].join(" AND ");

/** Which logs view a point click can open. */
export const logsAvailability = (input: {
  queryType?: string;
  streamType?: string;
  isLocked: (feature: string) => boolean;
}): LogsAvailability => {
  if (input.queryType === "promql" || (input.streamType || "logs") !== "logs") {
    return { kind: "blocked", reason: "logsNeedLogsStream" };
  }
  return input.isLocked("logs") ? { kind: "locked", feature: "logs" } : { kind: "enabled" };
};

/** Which traces view a point click can open. */
export const tracesAvailability = (input: {
  queryType?: string;
  streamType?: string;
  hasGroupValues: boolean;
  correlationEnabled: boolean;
  isLocked: (feature: string) => boolean;
}): TracesAvailability => {
  if (input.isLocked("traces")) return { kind: "locked", feature: "traces" };
  const streamType = input.streamType || "logs";
  if (input.queryType !== "promql" && streamType === "traces") return { kind: "tracesStream" };
  if (!["logs", "metrics"].includes(streamType) || !input.correlationEnabled) {
    return { kind: "blocked", reason: "noTraceCorrelation" };
  }
  if (input.isLocked("correlation")) return { kind: "locked", feature: "correlation" };
  if (!input.hasGroupValues) return { kind: "blocked", reason: "needsGroupBy" };
  return { kind: "correlate" };
};

/** Whether service correlation is set up: an enterprise build with service streams on. */
export const correlationConfigured = (isEnterprise: unknown, zoConfig: any): boolean =>
  isEnterprise == "true" && zoConfig?.service_streams_enabled !== false;

export const isPathChart = (type: unknown): boolean =>
  typeof type === "string" && PATH_TYPES.includes(type);

/** Whether a treemap or sunburst click opens the point menu, so it must not also zoom. */
export const treeOpensPointMenu = (
  schema: any,
  context: { correlationEnabled: boolean; isLocked: (feature: string) => boolean },
): boolean => {
  if (!isPathChart(schema?.type)) return false;
  const visible = (schema.queries ?? []).filter((q: any) => !q?.config?.hide);
  // The tiles merge every query's rows, so with several queries a tile names no one query.
  if (visible.length !== 1) return false;
  const input = {
    queryType: schema.queryType,
    streamType: visible[0]?.fields?.stream_type,
    hasGroupValues: true,
    ...context,
  };
  return (
    logsAvailability(input).kind === "enabled" ||
    ["tracesStream", "correlate"].includes(tracesAvailability(input).kind)
  );
};

/** The Traces page query that opens `stream` over the slice with `filter` applied. */
export const tracesPageQuery = (input: {
  org: string;
  stream: string;
  startTime: number;
  endTime: number;
  filter: string;
}): Record<string, string> => ({
  org_identifier: input.org,
  stream: input.stream,
  from: String(input.startTime),
  to: String(input.endTime),
  // The page shows a handoff `filter` in its query bar; a `query` param only filters the results.
  filter: input.filter,
});

/** The slice's bounds in the dashboard timezone: seconds when either bound is off the minute, the date across days. */
export const sliceBounds = (
  startTime: number,
  endTime: number,
  timezone: string,
): { start: string; end: string } => {
  const zone = timezone || "UTC";
  const startMs = startTime / 1000;
  const endMs = endTime / 1000;
  const sameDay =
    formatInTimeZone(startMs, zone, "yyyy-MM-dd") === formatInTimeZone(endMs, zone, "yyyy-MM-dd");
  const offMinute = startMs % 60_000 !== 0 || endMs % 60_000 !== 0;
  const time = offMinute ? "HH:mm:ss" : "HH:mm";
  const pattern = sameDay ? time : `MMM d ${time}`;
  return {
    start: formatInTimeZone(startMs, zone, pattern),
    end: formatInTimeZone(endMs, zone, pattern),
  };
};

/** The filters as `field=value` pairs for a one-line summary. */
export const filtersSummary = (filters: FieldFilter[]): string =>
  filters
    .map((f) => (f.value === null ? `${f.field} IS NULL` : `${f.field}=${f.value}`))
    .join(", ");
