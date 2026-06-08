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

// Single source of truth for the default builder fields seeded into a dashboard
// panel (Add Panel) and the Metrics page. Both surfaces share the same
// PanelEditor component, so they share these definitions.
//
// See designs/dashboards/default-panel-fields for the full design.

/** Default x-axis field for the SQL builder: histogram(_timestamp). */
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

/**
 * Default y-axis measure: count(_timestamp).
 * Universal, schema-independent measure used for logs and traces streams, and
 * for metrics streams that do not expose a numeric "value" column. Renders a
 * bar chart immediately, even before the stream schema has loaded.
 */
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

/**
 * Y-axis upgrade for metrics streams that expose a numeric "value" column:
 * avg(value). Metrics-only — logs and traces always use count(_timestamp).
 */
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
 * Returns true when any stream in the grouped field list exposes a "value"
 * column. `groupedFields` is `dashboardPanelData.meta.streamFields.groupedFields`.
 */
export const hasValueColumn = (groupedFields: any[]): boolean =>
  (groupedFields ?? []).some((stream: any) =>
    stream?.schema?.some((field: any) => field?.name === "value"),
  );

/**
 * Build the default x/y builder fields for SQL mode, keyed by stream type:
 *  - logs / traces        -> x = histogram(_timestamp), y = count(_timestamp)
 *  - metrics (has value)  -> x = histogram(_timestamp), y = avg(value)
 *  - metrics (no value)   -> x = histogram(_timestamp), y = count(_timestamp)
 *
 * The avg(value) upgrade is metrics-only by design; traces deliberately use the
 * same count(_timestamp) measure as logs.
 */
export const buildDefaultSqlFields = (
  streamType: string,
  groupedFields: any[],
): { x: any[]; y: any[] } => {
  const useValueMeasure =
    streamType === "metrics" && hasValueColumn(groupedFields);

  return {
    x: [DEFAULT_SQL_X_FIELD()],
    y: [useValueMeasure ? DEFAULT_SQL_Y_FIELD_VALUE() : DEFAULT_SQL_Y_FIELD_COUNT()],
  };
};
