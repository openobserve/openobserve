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

/** Rows a builder distribution asks for when the query sets no limit; the search API otherwise caps raw rows far lower. */
export const DISTRIBUTION_ROW_LIMIT = 10000;
