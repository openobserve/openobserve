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

import { ref } from "vue";
import {
  recordPageLoad,
  recordPageRequest,
  unbindForRetry,
  type PageLoad,
  type PageLoadReason,
  type PageRequest,
  type PendingPageSelection,
} from "@/utils/pageCrossing";

/** The slice of the logs searchObj that the drawer model and page crossings read and write. */
export interface RowNavSearchObj {
  meta: {
    showDetailTab: boolean;
    resultGrid?: { navigation?: RowNavNavigation };
  };
  data: { resultGrid?: { pageRequest?: PageRequest | null; pageLoad?: PageLoad | null } };
}

export interface RowNavNavigation {
  currentRowIndex: number | null;
  selectionActive?: boolean;
  pendingPageSelection?: PendingPageSelection | null;
}

export interface DrawerCloseContext {
  isPagination: boolean;
  searchObj: RowNavSearchObj;
}

export type DrawerCloseExemption = (ctx: DrawerCloseContext) => boolean;

export interface PageNavFailure {
  quiet: boolean;
}

export interface HitsCompletePayload {
  traceId: string;
  type: string;
  isPagination?: boolean;
}

let jobRequestCounter = 0;

/** Text of `logs-row-nav-live`; rendered by the logs page, so a failure that swaps the results for an error state is still announced. */
export const logsRowNavAnnouncement = ref("");
let failureHandler: ((failure: PageNavFailure) => void) | null = null;
const hitsCompleteListeners = new Set<(payload: HitsCompletePayload) => void>();

// A J/K crossing keeps the drawer open over its own pagination request (4a §3.2.2).
const crossingExemption: DrawerCloseExemption = ({ isPagination, searchObj }) =>
  isPagination && !!navigationOf(searchObj)?.pendingPageSelection;

/** Origins whose query keeps the detail drawer open; 4c C appends its permalink entry. */
export const drawerCloseExemptions: DrawerCloseExemption[] = [crossingExemption];

/** The one drawer-close rule shared by both query entry points (4a §3.2.7). */
export function closeDrawerForQuery(searchObj: RowNavSearchObj, isPagination: boolean): void {
  const ctx = { isPagination, searchObj };
  if (drawerCloseExemptions.some((exempt) => exempt(ctx))) return;
  searchObj.meta.showDetailTab = false;
}

/** Drops the J/K anchor, the open-row highlight and any crossing in flight. */
export function resetRowSelection(searchObj: RowNavSearchObj): void {
  const navigation = navigationOf(searchObj);
  if (!navigation) return;
  navigation.selectionActive = false;
  navigation.currentRowIndex = null;
  navigation.pendingPageSelection = null;
}

export function notePageRequest(searchObj: RowNavSearchObj, requestId: string): void {
  const navigation = navigationOf(searchObj);
  const grid = gridOf(searchObj);
  if (navigation && grid) recordPageRequest(navigation, grid, requestId);
}

export function notePageLoad(
  searchObj: RowNavSearchObj,
  requestId: string,
  reason: PageLoadReason,
): void {
  const grid = gridOf(searchObj);
  if (grid) recordPageLoad(grid, { requestId, ok: reason === "done", reason });
}

/** Marks the bound pagination request cancelled when a generation tears it down without a terminal event. */
export function notePageCancelled(searchObj: RowNavSearchObj, traceId: string): void {
  if (searchObj.data?.resultGrid?.pageRequest?.requestId !== traceId) return;
  notePageLoad(searchObj, traceId, "cancelled");
}

export function notePageRetry(searchObj: RowNavSearchObj, previousTraceId: string): void {
  const navigation = navigationOf(searchObj);
  if (navigation) unbindForRetry(navigation, previousTraceId);
}

export function nextJobRequestId(): string {
  jobRequestCounter += 1;
  return `job-${jobRequestCounter}`;
}

/** Installs the drawer's failure handler; the disposer only clears it while it is still the installed one. */
export function setPageNavFailureHandler(handler: (failure: PageNavFailure) => void): () => void {
  failureHandler = handler;
  return () => {
    if (failureHandler === handler) failureHandler = null;
  };
}

/** A crossing whose request was never dispatched (or never reached the server) fails here instead of hanging. */
export function failPendingPageNavigation(
  searchObj: RowNavSearchObj,
  options: { quiet?: boolean } = {},
): void {
  if (!navigationOf(searchObj)?.pendingPageSelection) return;
  if (failureHandler) {
    failureHandler({ quiet: !!options.quiet });
    return;
  }
  resetRowSelection(searchObj);
  searchObj.meta.showDetailTab = false;
}

export function onHitsComplete(listener: (payload: HitsCompletePayload) => void): () => void {
  hitsCompleteListeners.add(listener);
  return () => hitsCompleteListeners.delete(listener);
}

/** Fired once per hits request at its terminal completion; the drawer's row match runs from here. */
export function notifyHitsComplete(payload: HitsCompletePayload): void {
  hitsCompleteListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.warn("logsRowNav: hits-complete listener failed", error);
    }
  });
}

// Partial shapes (an old restored state, a test double) must never throw inside a search callback.
function navigationOf(
  searchObj: RowNavSearchObj,
): (RowNavNavigation & { pendingPageSelection: PendingPageSelection | null }) | null {
  const navigation = searchObj.meta?.resultGrid?.navigation;
  if (!navigation) return null;
  navigation.pendingPageSelection ??= null;
  return navigation as RowNavNavigation & { pendingPageSelection: PendingPageSelection | null };
}

function gridOf(
  searchObj: RowNavSearchObj,
): { pageRequest: PageRequest | null; pageLoad: PageLoad | null } | null {
  const grid = searchObj.data?.resultGrid;
  if (!grid) return null;
  grid.pageRequest ??= null;
  grid.pageLoad ??= null;
  return grid as { pageRequest: PageRequest | null; pageLoad: PageLoad | null };
}
