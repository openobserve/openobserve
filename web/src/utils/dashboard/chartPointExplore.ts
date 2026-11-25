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
import { NULL_BREAKDOWN_VALUE, OTHERS_BREAKDOWN_VALUE } from "@/utils/dashboard/sqlProcessData";
import type { I18nText } from "@/types/i18n";

/** One `field = value` condition; a null value matches rows where the field is empty. */
export interface FieldFilter {
  field: string;
  value: string | number | null;
}

/** One View logs / traces / metrics row of the point menu; `detail` is its slice or its lock reason. */
export type PointExploreItem =
  // A license lock stays visible so the user learns what the plan lacks; any other gap is hidden.
  | { state: "enabled" | "pending" | "locked"; detail: I18nText }
  | { state: "hidden"; detail?: never };

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

/** Where View traces opens: a trace stream, its WHERE, and whether correlation chose it. */
export interface TracesTarget {
  stream: string;
  filter: string;
  filters: FieldFilter[];
}

/** Where View metrics opens: the metric (the chart's own, or correlation's first) and its label filters. */
export interface MetricsTarget {
  stream: string;
  filters: FieldFilter[];
}

/** The point menu's section: its target, the three rows, and where traces and metrics open once known. */
export interface PointExplore {
  target: PointTarget;
  logs: PointExploreItem;
  traces: PointExploreItem;
  metrics: PointExploreItem;
  tracesTarget: TracesTarget | null;
  metricsTarget: MetricsTarget | null;
}

/** What a clicked point is scoped by: its time bucket, or the whole panel range. */
export type PointFamily = "time" | "category" | "heatmap";

/** Which signal the explorer drawer shows. */
export type ExplorerMode = "logs" | "traces" | "metrics";

/** The explored span: the clicked bucket, the whole panel range, or a PromQL point's look-back. */
export type TimeSlice = "bucket" | "panelRange" | "lookBack";

const DURATION_UNIT_US: Record<string, number> = {
  ms: 1_000,
  s: 1_000_000,
  m: 60_000_000,
  h: 3_600_000_000,
  d: 86_400_000_000,
  w: 604_800_000_000,
  y: 31_536_000_000_000,
};

/** A PromQL duration such as `1h30m` in µs; 0 when it is not one. */
export const promqlDurationUs = (text: string): number => {
  const parts = [...text.trim().matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d|w|y)/g)];
  if (!parts.length || parts.map((p) => p[0]).join("") !== text.trim()) return 0;
  return parts.reduce((sum, [, n, unit]) => sum + Number(n) * DURATION_UNIT_US[unit], 0);
};

/** PromQL's default look-back: a point reads the latest sample up to five minutes before it. */
export const PROMQL_DEFAULT_LOOK_BACK_US = 5 * 60_000_000;

/** How far back a PromQL point reads samples: the default look-back or its widest range vector. */
export const promqlLookBackUs = (expression: string | undefined): number => {
  // A subquery's step (after the colon) is a resolution, not a span the point reads.
  const ranges = [...String(expression ?? "").matchAll(/\[([^\]:]+)(?::[^\]]*)?\]/g)].map(
    ([, range]) => promqlDurationUs(range),
  );
  return Math.max(PROMQL_DEFAULT_LOOK_BACK_US, ...ranges);
};

// Words that are not metric names; the first group is followed by a label list, not a selector.
const PROMQL_LABEL_LIST_WORDS = new Set([
  "by",
  "without",
  "on",
  "ignoring",
  "group_left",
  "group_right",
]);
const PROMQL_KEYWORDS = new Set(["bool", "and", "or", "unless", "atan2", "inf", "nan", "offset"]);

// The index just past a quoted run starting at `start`; a backslash escapes the next character.
const skipPromqlString = (src: string, start: number): number => {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
  return i + 1;
};

// The index just past the bracket group opening at `start`, skipping quoted runs.
const skipGroup = (src: string, start: number, open: string, close: string): number => {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipPromqlString(src, i);
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i + 1;
    i++;
  }
  return src.length;
};

/**
 * The offset each vector selector of a PromQL expression reads at, in µs: its own `offset` plus
 * that of every subquery around it. Negative offsets read later, as the engine does
 * (`selector.rs` `selector_time_range`). The `@` modifier is skipped: the engine rejects it.
 */
export const promqlSelectorOffsetsUs = (expression: string | undefined): number[] => {
  const src = String(expression ?? "");
  const selectors: { end: number; offset: number }[] = [];
  const opens: number[] = [];
  // What an `offset` right here modifies: the selector just read, or the group just closed.
  let target: { selector: number } | { from: number; to: number } | null = null;
  const nextChar = (from: number) => src.slice(from).match(/^\s*(\S)/)?.[1] ?? "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "#") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      i = skipPromqlString(src, i);
      target = null;
    } else if (ch === "{") {
      // A bare label set is a selector of its own; after a metric name it is part of that one.
      const sel = target && "selector" in target ? selectors[target.selector] : null;
      const ofName = !!sel && /^\s*$/.test(src.slice(sel.end, i));
      i = skipGroup(src, i, "{", "}");
      if (ofName && sel) sel.end = i;
      else {
        selectors.push({ end: i, offset: 0 });
        target = { selector: selectors.length - 1 };
      }
    } else if (ch === "[") {
      // A range or a subquery keeps the selector or group before it as the offset's target.
      i = skipGroup(src, i, "[", "]");
    } else if (ch === "(") {
      opens.push(i);
      target = null;
      i++;
    } else if (ch === ")") {
      target = { from: opens.pop() ?? 0, to: i };
      i++;
    } else if (ch === "@") {
      i++;
      const at = src.slice(i).match(/^\s*(?:[\d.]+|(?:start|end)\s*\(\s*\))/);
      i += at?.[0].length ?? 0;
    } else if (/[A-Za-z_:]/.test(ch)) {
      let j = i;
      while (j < src.length && /[\w:]/.test(src[j])) j++;
      const word = src.slice(i, j).toLowerCase();
      if (word === "offset") {
        const m = src.slice(j).match(/^\s*(-?)\s*((?:\d+(?:\.\d+)?(?:ms|s|m|h|d|w|y))+)/);
        const us = m ? (m[1] ? -1 : 1) * promqlDurationUs(m[2]) : 0;
        if (target && "selector" in target) selectors[target.selector].offset += us;
        else if (target) {
          const { from, to } = target;
          selectors.forEach((sel) => {
            if (sel.end > from && sel.end <= to) sel.offset += us;
          });
        }
        target = null;
        j += m?.[0].length ?? 0;
      } else if (PROMQL_LABEL_LIST_WORDS.has(word)) {
        target = null;
        if (nextChar(j) === "(") j = skipGroup(src, src.indexOf("(", j), "(", ")");
      } else if (PROMQL_KEYWORDS.has(word)) {
        target = null;
      } else if (nextChar(j) === "(" || /^\s*(by|without)\b/i.test(src.slice(j))) {
        // A function or an aggregation, not a metric.
        target = null;
      } else {
        selectors.push({ end: j, offset: 0 });
        target = { selector: selectors.length - 1 };
      }
      i = j;
    } else if (/[\d.]/.test(ch)) {
      while (i < src.length && /[\w.]/.test(src[i])) i++;
      target = null;
    } else {
      target = null;
      i++;
    }
  }
  return selectors.map((sel) => sel.offset);
};

/**
 * The samples behind a PromQL point, in µs: each selector reads its look-back before the point,
 * moved back by its offset; several offsets give the span that covers them all.
 */
export const promqlPointWindow = (
  pointUs: number,
  expression: string | undefined,
): { startTime: number; endTime: number } => {
  const offsets = [...new Set(promqlSelectorOffsetsUs(expression))];
  if (!offsets.length) offsets.push(0);
  const lookBack = promqlLookBackUs(expression);
  return {
    startTime: pointUs - lookBack - Math.max(...offsets),
    endTime: pointUs - Math.min(...offsets),
  };
};

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
  /** A PromQL series' label set; it names the point instead of the builder fields. */
  seriesLabels?: Record<string, string>;
}

export type LogsAvailability =
  { kind: "enabled" } | { kind: "locked"; feature: string } | { kind: "blocked" };

export type TracesAvailability =
  | { kind: "tracesStream" }
  | { kind: "correlate" }
  | { kind: "locked"; feature: string }
  | { kind: "blocked" };

export type MetricsAvailability =
  | { kind: "metricsStream" }
  | { kind: "correlate" }
  | { kind: "locked"; feature: string }
  | { kind: "blocked" };

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
  // A NULL breakdown series is named by its stand-in, never a value of the field.
  if (value === null || value === undefined || value === "" || value === NULL_BREAKDOWN_VALUE)
    return null;
  return typeof value === "number" ? value : String(value);
};

/** A PromQL series' labels as conditions; `__name__` names the metric, not a label value. */
export const seriesLabelFilters = (labels: Record<string, string>): FieldFilter[] =>
  Object.entries(labels)
    .filter(([label]) => label !== "__name__")
    .map(([field, value]) => ({ field, value: toFilterValue(value) }));

const PROMQL_WORDS = new Set([
  "by",
  "without",
  "on",
  "ignoring",
  "group_left",
  "group_right",
  "bool",
  "offset",
  "and",
  "or",
  "unless",
  "atan2",
  "inf",
  "nan",
]);

/** The metric a PromQL series plots: its `__name__`, else the expression's first vector selector. */
export const promqlMetricName = (
  expression: string | undefined,
  labels: Record<string, string> | undefined,
): string => {
  if (labels?.__name__) return labels.__name__;
  // Strings, label matchers, ranges and grouping lists hold names that are not selectors.
  const bare = String(expression ?? "")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, '""')
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(?:by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g, " ");
  const tokens = bare.matchAll(/(?<![\w:.])[A-Za-z_:][\w:]*(?![\w:]|\s*\()/g);
  for (const [token] of tokens) {
    if (!PROMQL_WORDS.has(token.toLowerCase())) return token;
  }
  return "";
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
  if (click.seriesLabels) return seriesLabelFilters(click.seriesLabels);
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
      const isOthers = breakdown.includes(field) && label === OTHERS_BREAKDOWN_VALUE;
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
  joinsStreams?: boolean;
  isLocked: (feature: string) => boolean;
}): LogsAvailability => {
  if (input.queryType === "promql" || (input.streamType || "logs") !== "logs") {
    return { kind: "blocked" };
  }
  // A JOIN's WHERE and group-by fields span several streams, so no one stream's logs match the point.
  if (input.joinsStreams) return { kind: "blocked" };
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
    return { kind: "blocked" };
  }
  if (input.isLocked("correlation")) return { kind: "locked", feature: "correlation" };
  if (!input.hasGroupValues) return { kind: "blocked" };
  return { kind: "correlate" };
};

/** Which metrics view a point click can open; a lock shows only where the licence would let it open. */
export const metricsAvailability = (input: {
  queryType?: string;
  streamType?: string;
  hasGroupValues: boolean;
  correlationEnabled: boolean;
  isLocked: (feature: string) => boolean;
}): MetricsAvailability => {
  const streamType = input.streamType || "logs";
  if (input.queryType === "promql" || streamType === "metrics") {
    return input.isLocked("metrics")
      ? { kind: "locked", feature: "metrics" }
      : { kind: "metricsStream" };
  }
  if (!["logs", "traces"].includes(streamType) || !input.correlationEnabled) {
    return { kind: "blocked" };
  }
  if (!input.hasGroupValues) return { kind: "blocked" };
  if (input.isLocked("metrics")) return { kind: "locked", feature: "metrics" };
  if (input.isLocked("correlation")) return { kind: "locked", feature: "correlation" };
  return { kind: "correlate" };
};

/** Whether service correlation is set up: an enterprise build with service streams on. */
export const correlationConfigured = (isEnterprise: unknown, zoConfig: any): boolean =>
  isEnterprise == "true" && zoConfig?.service_streams_enabled !== false;

export const isPathChart = (type: unknown): boolean =>
  typeof type === "string" && PATH_TYPES.includes(type);

/** The one query whose rows name the clicked funnel stage; null when none or several do. */
export const funnelStageQuery = (schema: any, data: unknown[], stage: unknown): number | null => {
  const name = String(stage ?? "");
  // A funnel adds every query's stages into one series, so the stage name is all that says which query it came from.
  const owners = (schema?.queries ?? []).flatMap((query: any, index: number) => {
    const field = query?.fields?.x?.[0];
    const rows = data?.[index];
    if (query?.config?.hide || !field || !Array.isArray(rows)) return [];
    const named = rows.some((row: any) => String(getDataValue(row, field.alias) ?? "") === name);
    return named ? [index] : [];
  });
  return owners.length === 1 ? owners[0] : null;
};

/** Whether a treemap or sunburst tile can offer any row of the point menu. */
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
    ["tracesStream", "correlate"].includes(tracesAvailability(input).kind) ||
    ["metricsStream", "correlate"].includes(metricsAvailability(input).kind)
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
