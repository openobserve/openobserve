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

import type { LocationQuery, Router } from "vue-router";

/**
 * Query writes that do not undo each other. A write made before the router has settled the
 * previous one starts from the query that write asked for, not from the stale route.
 */
export function useQueryWriter(route: { query: LocationQuery }, router: Router) {
  let intended: LocationQuery | null = null;

  /** Set a key, or drop it with `undefined`; every other key is kept. */
  function write(patch: Record<string, string | undefined>, mode: "push" | "replace") {
    const next: LocationQuery = { ...(intended ?? route.query) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    intended = next;
    return router[mode]({ query: next })
      .catch(() => {})
      .finally(() => {
        if (intended === next) intended = null;
      });
  }

  /** True while the key is in the URL, or in a write that has not committed yet. */
  function holds(key: string): boolean {
    return route.query[key] !== undefined || intended?.[key] !== undefined;
  }

  return { write, holds };
}
