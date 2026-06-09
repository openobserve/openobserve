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

/** Default x-axis: histogram(_timestamp). */
export const DEFAULT_SQL_X_FIELD = () => ({
  label: "_timestamp",
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
  label: "_timestamp",
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
  label: "value",
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
export const hasValueColumn = (
  groupedFields: any[],
  streamName?: string,
): boolean => {
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
  const useValueMeasure =
    streamType === "metrics" && hasValueColumn(groupedFields, streamName);

  return {
    x: [DEFAULT_SQL_X_FIELD()],
    y: [useValueMeasure ? DEFAULT_SQL_Y_FIELD_VALUE() : DEFAULT_SQL_Y_FIELD_COUNT()],
  };
};

// Chart types that drive their own builder and must not get the cartesian x/y seed.
// heatmap is included because its measure lives on the Z/value axis — its Y axis is
// a dimension that disallows aggregation, so a count(_timestamp) Y seed is invalid.
export const SKIP_SEED_TYPES = [
  "geomap",
  "sankey",
  "maps",
  "custom_chart",
  "html",
  "markdown",
  "heatmap",
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
): { x: any[]; y: any[] } => {
  if (SKIP_SEED_TYPES.includes(chartType)) return { x: [], y: [] };
  const { x, y } = buildDefaultSqlFields(streamType, groupedFields, streamName);
  // metric has no x-axis — it renders a single measure.
  if (chartType === "metric") return { x: [], y };
  return { x, y };
};
