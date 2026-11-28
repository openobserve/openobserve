//  Copyright 2026 OpenObserve Inc.

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

import type { LocationQuery, Router } from "vue-router";

// The URL keys that name a search; columns, rows and the open trace are view state a step keeps.
const SEARCH_PARAMS = [
  "stream",
  "tab",
  "query",
  "sql_mode",
  "from",
  "to",
  "period",
  "scope",
  "group_by",
  "page",
] as const;

const valueOf = (query: LocationQuery, key: string) => String(query[key] ?? "");

/** Calls `onRestore` when Back or Forward moves between two Traces entries that hold different searches. */
export function useTracesHistoryRestore(router: Router, onRestore: () => void): () => void {
  let popPending = false;
  const stopListen = router.options.history.listen((_to, _from, info) => {
    popPending = info.type === "pop";
  });
  const stopAfter = router.afterEach((to, from, failure) => {
    const isPop = popPending;
    popPending = false;
    if (!isPop || failure || to.name !== "traces" || from.name !== "traces") return;
    if (SEARCH_PARAMS.some((key) => valueOf(to.query, key) !== valueOf(from.query, key))) {
      onRestore();
    }
  });
  return () => {
    stopListen();
    stopAfter();
  };
}
