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

export type PagePosition = "first" | "last";

export interface PendingPageSelection {
  page: number;
  position: PagePosition;
  requestId: string | null;
}

export interface PageRequest {
  requestId: string;
}

export type PageLoadReason = "done" | "error" | "cancelled";

export interface PageLoad {
  requestId: string;
  ok: boolean;
  reason: PageLoadReason;
}

export interface PageCrossingNavigation {
  pendingPageSelection: PendingPageSelection | null;
}

export interface PageCrossingGrid {
  pageRequest: PageRequest | null;
  pageLoad: PageLoad | null;
}

export function recordPageRequest(
  navigation: PageCrossingNavigation,
  grid: PageCrossingGrid,
  requestId: string,
): void {
  grid.pageRequest = { requestId };
  const pending = navigation.pendingPageSelection;
  if (!pending) return;
  if (pending.requestId === null) {
    navigation.pendingPageSelection = { ...pending, requestId };
  } else if (pending.requestId !== requestId) {
    navigation.pendingPageSelection = null;
  }
}

export function recordPageLoad(grid: PageCrossingGrid, load: PageLoad): void {
  if (grid.pageLoad?.requestId === load.requestId) return;
  grid.pageLoad = { ...load };
}

export function unbindForRetry(navigation: PageCrossingNavigation, requestId: string): void {
  const pending = navigation.pendingPageSelection;
  if (pending?.requestId === requestId) {
    navigation.pendingPageSelection = { ...pending, requestId: null };
  }
}

export function acceptsPageLoad(
  pending: PendingPageSelection | null,
  load: PageLoad | null,
): load is PageLoad {
  return !!pending && !!load && pending.requestId !== null && load.requestId === pending.requestId;
}
