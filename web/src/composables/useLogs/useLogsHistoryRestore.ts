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

/** Calls `onRestore` when Back/Forward lands on a different Logs search, so the page can re-read the URL. */
export function useLogsHistoryRestore(router: Router, onRestore: () => void): () => void {
  let popPending = false;
  const stopListen = router.options.history.listen((_to, _from, info) => {
    popPending = info.type === "pop";
  });
  const stopAfter = router.afterEach((to, from, failure) => {
    const isPop = popPending;
    popPending = false;
    if (!isPop || failure || to.name !== "logs" || from.name !== "logs") return;
    if (changedParams(from.query, to.query).some((key) => !VIEW_STATE_PARAMS.has(key))) {
      onRestore();
    }
  });
  return () => {
    stopListen();
    stopAfter();
  };
}
