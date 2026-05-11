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

/** Default x-axis field for metrics builder: histogram(_timestamp) */
export const DEFAULT_METRICS_X_FIELD = () => ({
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

/** Default y-axis field for metrics builder: avg(value) */
export const DEFAULT_METRICS_Y_FIELD = () => ({
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

/** Fallback y-axis field for streams without a "value" column: count(_timestamp) */
export const DEFAULT_METRICS_Y_FIELD_COUNT = () => ({
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
