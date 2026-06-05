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

/**
 * Whether VRL is enabled for a query — true iff the query has a non-empty VRL
 * function. The editor fx toggle and query execution both rely on this single
 * rule, so VRL presence is the source of truth (no separate flag).
 */
export const isQueryVrlEnabled = (query: any): boolean =>
  !!query?.vrlFunctionQuery && query.vrlFunctionQuery.trim() !== "";
