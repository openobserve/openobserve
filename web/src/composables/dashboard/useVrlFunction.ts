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
 * Shared VRL-enable resolution for dashboard panels.
 *
 * The VRL function toggle is PER QUERY (query.config.vrl_function_enabled).
 * Resolution order, for backward compatibility:
 *   1. the per-query flag, if explicitly set (true/false)
 *   2. the legacy panel-level flag (config.vrl_function_enabled), if set
 *   3. otherwise derive from VRL presence — so dashboards saved before any flag
 *      existed keep applying their VRL, and a query with no VRL reads as "off".
 *
 * Used by the executor (to gate query_fn) and the editor (to drive the fx
 * toggle), so the rule lives in exactly one place.
 */
export const resolveQueryVrlEnabled = (
  query: any,
  panelConfig?: any,
): boolean =>
  query?.config?.vrl_function_enabled ??
  panelConfig?.vrl_function_enabled ??
  !!query?.vrlFunctionQuery;
