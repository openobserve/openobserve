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
export const ROW_TIMELINE_TYPES: readonly string[] = ["state-timeline", "status-history"];

export const isRowTimeline = (type: unknown): boolean =>
  typeof type === "string" && ROW_TIMELINE_TYPES.includes(type);

/** Panel types built from source, target and value fields instead of x/y/breakdown. */
export const FLOW_TYPES: readonly string[] = ["sankey", "node-graph"];

export const isFlowChart = (type: unknown): boolean =>
  typeof type === "string" && FLOW_TYPES.includes(type);

/** Panel types that read raw, unaggregated y values and summarise them client-side. */
export const RAW_VALUE_TYPES: readonly string[] = ["distribution", "boxplot"];

export const isRawValueChart = (type: unknown): boolean =>
  typeof type === "string" && RAW_VALUE_TYPES.includes(type);

/** Rows a builder raw-value chart asks for when the query sets no limit; the search API otherwise caps raw rows far lower. */
export const DISTRIBUTION_ROW_LIMIT = 10000;
