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
 * Global admission control for dashboard panel loads.
 *
 * A dashboard has no cap on panel count, and every panel that loads lands its
 * streaming results, converts them, and builds a chart on the main thread at
 * whatever moment the server replies. Without a cap, a dashboard entry or a
 * fast scroll fires dozens of loads whose results all land together and the
 * page stutters. This bounds how many panels are in flight at once so the rest
 * queue instead of competing.
 */

/** Matches the metrics explorer's PREVIEW_CONCURRENCY. Fixed, so perf runs are reproducible. */
export const MAX_CONCURRENT_PANEL_LOADS = 6;

interface PendingLoad {
  resolve: () => void;
  reject: (error: any) => void;
  detach: () => void;
}

let activeLoads = 0;
const pendingLoads: PendingLoad[] = [];

const pump = () => {
  while (activeLoads < MAX_CONCURRENT_PANEL_LOADS && pendingLoads.length > 0) {
    const next = pendingLoads.shift() as PendingLoad;
    activeLoads++;
    next.detach();
    next.resolve();
  }
};

/**
 * Resolves once a slot is free. Every resolved call MUST be paired with a
 * `releasePanelLoadSlot()` in a `finally` — a leaked slot permanently shrinks
 * the pool and eventually stalls every panel on the dashboard.
 *
 * Rejects with the abort reason if `signal` fires while still queued; a panel
 * whose load was superseded gives up its place rather than loading stale data.
 */
export const acquirePanelLoadSlot = (signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return Promise.reject(new Error("Aborted waiting for a panel load slot"));
  }

  if (activeLoads < MAX_CONCURRENT_PANEL_LOADS) {
    activeLoads++;
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const entry: PendingLoad = {
      resolve,
      reject,
      detach: () => signal?.removeEventListener("abort", onAbort),
    };

    function onAbort() {
      const index = pendingLoads.indexOf(entry);
      if (index !== -1) pendingLoads.splice(index, 1);
      entry.detach();
      reject(new Error("Aborted waiting for a panel load slot"));
    }

    signal?.addEventListener("abort", onAbort);
    pendingLoads.push(entry);
  });
};

export const releasePanelLoadSlot = (): void => {
  if (activeLoads > 0) activeLoads--;
  pump();
};

/** Test-only: drop all queued waiters and reset the counter. */
export const resetPanelLoadQueue = (): void => {
  while (pendingLoads.length > 0) {
    const entry = pendingLoads.shift() as PendingLoad;
    entry.detach();
    entry.reject(new Error("Panel load queue reset"));
  }
  activeLoads = 0;
};

export const getPanelLoadQueueStats = () => ({
  active: activeLoads,
  queued: pendingLoads.length,
});
