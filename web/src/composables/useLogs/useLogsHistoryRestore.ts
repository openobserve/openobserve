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

import type { Router } from "vue-router";

import { changedParams, VIEW_STATE_PARAMS } from "@/composables/useLogs/useLogsUrl";

/** Calls `onRestore` when Back/Forward, or a link to a stream Logs does not show, changes the search. */
export function useLogsHistoryRestore(
  router: Router,
  onRestore: () => void,
  shownStreams: () => string = () => "",
): () => void {
  let popPending = false;
  const stopListen = router.options.history.listen((_to, _from, info) => {
    popPending = info.type === "pop";
  });
  const stopAfter = router.afterEach((to, from, failure) => {
    const isPop = popPending;
    popPending = false;
    if (failure || to.name !== "logs" || from.name !== "logs") return;
    if (!isPop) {
      const stream = to.query.stream;
      // Logs writes its own selection to the URL, so only a stream it does not show came from a link.
      if (typeof stream === "string" && stream !== from.query.stream && stream !== shownStreams())
        onRestore();
      return;
    }
    if (changedParams(from.query, to.query).some((key) => !VIEW_STATE_PARAMS.has(key))) {
      onRestore();
    }
  });
  return () => {
    stopListen();
    stopAfter();
  };
}
