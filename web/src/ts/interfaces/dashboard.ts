// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

interface Label {
  show: boolean;
  position: string;
  rotate: number;
}

interface MarkLine {
  silent: boolean;
  animation: boolean;
  data: any[];
}

export interface TrellisLayout {
  layout: "vertical" | "horizontal" | "custom" | null;
  num_of_columns: number;
  group_by_y_axis: boolean;
}
export interface SeriesObject {
  name: string;
  label: Label;
  markLine: MarkLine;
  connectNulls: boolean;
  large: boolean;
  color: string | null;
  data: Array<number | null>;
  [key: string]: any;
}

export type AnnotationSourceMode = "builder" | "sql";

/** AND/OR condition tree, the alerts condition-builder shape (the engine V2 tree). */
export type AnnotationConditionLogicalOperator = "AND" | "OR";

export interface AnnotationConditionLeaf {
  id?: string;
  filterType: "condition";
  column: string;
  operator: string;
  /** `in` / `not_in` hold a JSON array string, since the backend stores the value as text. */
  value: string;
  case_insensitive?: boolean;
  logicalOperator: AnnotationConditionLogicalOperator;
}

export interface AnnotationConditionGroup {
  groupId?: string;
  filterType: "group";
  logicalOperator: AnnotationConditionLogicalOperator;
  conditions: Array<AnnotationConditionLeaf | AnnotationConditionGroup>;
}

/** A dashboard-level query whose rows become annotation markers on time-series panels. */
export interface AnnotationSource {
  id: string;
  name: string;
  color?: string | null;
  enabled: boolean;
  mode: AnnotationSourceMode;
  streamType: string;
  stream: string;
  filters: AnnotationConditionGroup;
  query?: string | null;
  title: string;
  description?: string | null;
  endTimeField?: string | null;
  /** Panel ids to draw on; absent means every time-series panel, empty means none. */
  panels?: string[] | null;
}

/** One marker produced by an annotation source row, in the shape the chart converters draw. */
export interface QueryAnnotationMarker {
  start_time: number;
  end_time: number | null;
  title: string;
  text: string;
  source: {
    id: string;
    name: string;
    color: string;
  };
}
