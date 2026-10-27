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

// Default builder fields shared by the Add Panel and Metrics pages.

// The builder's last_value has no ORDER BY, so it is not the latest sample; max reads any column type.
export const STATE_TIMELINE_Y_FUNCTION = "max";

/** Default x-axis: histogram(_timestamp). */
export const DEFAULT_SQL_X_FIELD = () => ({
  label: "",
  alias: "x_axis_1",
  column: "_timestamp",
  color: null,
  type: "build",
  functionName: "histogram",
  args: [
    { type: "field", value: { field: "_timestamp" } },
    { type: "histogramInterval", value: null },
  ],
  sortBy: "ASC",
  isDerived: false,
  havingConditions: [],
});

/** Default y-axis for logs/traces (and metrics without a "value" column): count(_timestamp). */
export const DEFAULT_SQL_Y_FIELD_COUNT = () => ({
  label: "",
  alias: "y_axis_1",
  column: "_timestamp",
  color: "#5960b2",
  type: "build",
  functionName: "count",
  args: [{ type: "field", value: { field: "_timestamp" } }],
  sortBy: null,
  isDerived: false,
  havingConditions: [],
});

/** Metrics-only y-axis when the stream has a "value" column: avg(value). */
export const DEFAULT_SQL_Y_FIELD_VALUE = () => ({
  label: "",
  alias: "y_axis_1",
  column: "value",
  color: "#5960b2",
  type: "build",
  functionName: "avg",
  args: [{ type: "field", value: { field: "value" } }],
  sortBy: null,
  isDerived: false,
  havingConditions: [],
});

/**
 * True if a stream exposes a "value" column. When `streamName` is given, only
 * that stream is checked (groupedFields also holds joined streams for SQL joins).
 */
export const hasValueColumn = (groupedFields: any[], streamName?: string): boolean => {
  const streams = streamName
    ? (groupedFields ?? []).filter((stream: any) => stream?.name === streamName)
    : (groupedFields ?? []);
  return streams.some((stream: any) =>
    stream?.schema?.some((field: any) => field?.name === "value"),
  );
};

/** Default x/y for SQL builder mode; `streamName` scopes the value-column check. */
export const buildDefaultSqlFields = (
  streamType: string,
  groupedFields: any[],
  streamName?: string,
): { x: any[]; y: any[] } => {
  const useValueMeasure = streamType === "metrics" && hasValueColumn(groupedFields, streamName);

  return {
    x: [DEFAULT_SQL_X_FIELD()],
    y: [useValueMeasure ? DEFAULT_SQL_Y_FIELD_VALUE() : DEFAULT_SQL_Y_FIELD_COUNT()],
  };
};

const NUMERIC_SCHEMA_TYPE = /^(u?int|float|double|decimal)/i;

/** The stream's first numeric column that is not a timestamp, the value a raw-value chart can summarise. */
export const firstNumericField = (
  groupedFields: any[],
  streamName?: string,
  timestampColumn = "_timestamp",
): string | null => {
  const streams = streamName
    ? (groupedFields ?? []).filter((stream: any) => stream?.name === streamName)
    : (groupedFields ?? []);
  const timestamps = new Set(["_timestamp", timestampColumn]);
  for (const stream of streams) {
    const field = (stream?.schema ?? []).find(
      (candidate: any) =>
        typeof candidate?.name === "string" &&
        !timestamps.has(candidate.name) &&
        NUMERIC_SCHEMA_TYPE.test(String(candidate?.type ?? "")),
    );
    if (field) return field.name;
  }
  return null;
};

/** A raw, unaggregated y field on `column`, as a raw-value chart reads it. */
export const rawValueYField = (column: string) => ({
  label: "",
  alias: "y_axis_1",
  column,
  color: null,
  type: "build",
  functionName: null,
  args: [{ type: "field", value: { field: column } }],
  sortBy: null,
  isDerived: false,
  havingConditions: [],
  treatAsNonTimestamp: true,
});

/** Drops y fields a raw-value chart cannot read (a timestamp or a count's column) and falls back to the first numeric column. */
export const keepRawValueFields = (
  query: any,
  groupedFields: any[],
  timestampColumn = "_timestamp",
) => {
  const timestamps = new Set(["_timestamp", timestampColumn]);
  query.fields.y = query.fields.y.filter(
    (itemY: any) =>
      itemY.isDerived || !timestamps.has(itemY?.args?.[0]?.value?.field ?? itemY?.column),
  );
  if (query.fields.y.length || query.customQuery) return;
  const column = firstNumericField(groupedFields, query.fields.stream, timestampColumn);
  if (column) query.fields.y = [rawValueYField(column)];
};

// Chart types that drive their own builder and must not get the cartesian x/y seed.
// heatmap is included because its measure lives on the Z/value axis — its Y axis is
// a dimension that disallows aggregation, so a count(_timestamp) Y seed is invalid.
export const SKIP_SEED_TYPES = [
  "geomap",
  "sankey",
  "node-graph",
  "maps",
  "custom_chart",
  "html",
  "markdown",
  "heatmap",
  "alert-list",
  "flame-graph",
];

/**
 * Chart-type-aware default builder fields, computed synchronously from the
 * already-loaded stream schema (no network). Mirrors applyDefaultPanelFields'
 * axis rules: self-driven builders get nothing, metric gets a measure (y) but no
 * x-axis, everything else gets the cartesian histogram-x + count/avg-y seed.
 */
export const buildDefaultBuilderFields = (
  chartType: string,
  streamType: string,
  groupedFields: any[],
  streamName?: string,
  timestampColumn = "_timestamp",
): { x: any[]; y: any[] } => {
  if (SKIP_SEED_TYPES.includes(chartType)) return { x: [], y: [] };
  const { x, y } = buildDefaultSqlFields(streamType, groupedFields, streamName);
  // metric has no x-axis — it renders a single measure.
  if (chartType === "metric") return { x: [], y };
  // A count is not a state; the user picks the state column.
  if (chartType === "state-timeline") return { x, y: [] };
  // One bar per label, so a time bucket is not a useful default label.
  if (chartType === "bar-gauge") return { x: [], y };
  // A histogram summarises raw values, so it starts from a numeric column, never a count or the timestamp.
  if (chartType === "distribution") {
    const column = firstNumericField(groupedFields, streamName, timestampColumn);
    return { x: [], y: column ? [rawValueYField(column)] : [] };
  }
  // One tile per label, so a time bucket is not a useful default label.
  if (chartType === "treemap") return { x: [], y };
  // One ring segment per label, so a time bucket is not a useful default label.
  if (chartType === "sunburst") return { x: [], y };
  // One stage per label, so a time bucket is not a useful default label.
  if (chartType === "funnel") return { x: [], y };
  // A time bucket is not an entity; the user picks the entity field.
  if (chartType === "hostmap") return { x: [], y };
  return { x, y };
};
