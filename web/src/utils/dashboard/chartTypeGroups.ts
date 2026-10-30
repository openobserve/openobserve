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

/** Panel types drawn as one band per entity over time by the state timeline converter. */
export const ROW_TIMELINE_TYPES: readonly string[] = ["state-timeline"];

export const isRowTimeline = (type: unknown): boolean =>
  typeof type === "string" && ROW_TIMELINE_TYPES.includes(type);

/** Panel types built from source, target and value fields instead of x/y/breakdown. */
export const FLOW_TYPES: readonly string[] = ["sankey", "node-graph"];

export const isFlowChart = (type: unknown): boolean =>
  typeof type === "string" && FLOW_TYPES.includes(type);

/** Panel types that read raw, unaggregated y values and summarise them client-side. */
export const RAW_VALUE_TYPES: readonly string[] = ["distribution"];

export const isRawValueChart = (type: unknown): boolean =>
  typeof type === "string" && RAW_VALUE_TYPES.includes(type);

/** Rows a builder raw-value chart asks for when the query sets no limit; the search API otherwise caps raw rows far lower. */
export const DISTRIBUTION_ROW_LIMIT = 10000;

/** Panel types drawn as HTML by their own renderer instead of an ECharts option. */
export const HTML_PANEL_TYPES: readonly string[] = ["alert-list", "flame-graph"];

export const isHtmlPanel = (type: unknown): boolean =>
  typeof type === "string" && HTML_PANEL_TYPES.includes(type);

/** HTML panel types that read the rows of a hand-written SQL query; the builder cannot express them. */
export const CUSTOM_SQL_PANEL_TYPES: readonly string[] = ["flame-graph"];

export const isCustomSqlPanel = (type: unknown): boolean =>
  typeof type === "string" && CUSTOM_SQL_PANEL_TYPES.includes(type);
