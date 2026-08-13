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
 * Re-sync a kept-alive DBM page with the URL scope when the reader returns.
 *
 * The DBM tabs are held by one `<keep-alive>` in DbmShell.vue, so a tab
 * switch does not destroy them: `onMounted` runs ONCE, for the whole session
 * on that tab. That is the point — it is what stops the refetch.
 *
 * But it also means nothing re-reads the URL on return. Each page reads
 * `route.query` at setup and writes the range back to the URL on change, so
 * the URL is how the tabs agree on a window — yet under keep-alive no
 * lifecycle hook re-reads it, and a page the reader comes back to would still
 * show the window it was left with — silently, with a stale timestamp beside
 * fresh numbers on the neighbouring tab.
 *
 * So this reloads on activation IF AND ONLY IF the scope in the URL differs
 * from the one the page currently holds. Reloading unconditionally (what RUM's
 * ErrorViewer does, correctly, for a single detail view) would refetch on every
 * tab switch and give back exactly the behaviour keep-alive was added to fix.
 *
 * Not a `watch` on `route.query`: an inactive kept-alive page still has live
 * watchers, so every tab would react to one tab's range change and fire
 * background fan-outs nobody asked for. Activation is the moment the answer is
 * about to be looked at, and the only moment it needs to be right.
 */

import { onActivated } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";

import { rangeFromQuery, type DbmRange } from "@/composables/dbm/useDbmScope";

/**
 * The identity of a scope, for comparison only.
 *
 * Built from the RANGE rather than from resolved bounds: a relative window's
 * microsecond bounds move with the clock, so comparing those would report a
 * change on every activation and reload every time.
 */
const scopeIdentity = (range: DbmRange): string =>
  range.type === "absolute"
    ? `abs|${range.startTime}|${range.endTime}`
    : `rel|${range.relativeTimePeriod ?? ""}`;

export interface DbmScopeSyncOptions {
  /** The page's live route. */
  route: RouteLocationNormalizedLoaded;
  /** The range the page currently holds. */
  current: () => DbmRange;
  /** Adopt the URL's range. Called only when it actually differs. */
  adopt: (range: DbmRange) => void;
  /** Refetch under the adopted range. */
  reload: () => void;
}

export function useDbmScopeSync({ route, current, adopt, reload }: DbmScopeSyncOptions): void {
  onActivated(() => {
    const fromUrl = rangeFromQuery(route.query);
    if (scopeIdentity(fromUrl) === scopeIdentity(current())) return;
    adopt(fromUrl);
    reload();
  });
}
