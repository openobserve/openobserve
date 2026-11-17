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

import {
  isNavigationFailure,
  NavigationFailureType,
  type RouteLocationNormalized,
  type Router,
} from "vue-router";

const trackedRouters = new WeakSet<Router>();

let pendingNavigation: RouteLocationNormalized | null = null;

export function trackPendingNavigation(router: Router): void {
  if (trackedRouters.has(router) || typeof router.beforeEach !== "function") return;
  trackedRouters.add(router);
  router.beforeEach((to) => {
    pendingNavigation = to;
  });
  router.afterEach((to, _from, failure) => {
    // A redirect that fails ends on a different `to`; a plain duplicate or a superseded navigation must not clear a held one.
    const redirectFailed =
      !!to.redirectedFrom &&
      !!failure &&
      !isNavigationFailure(failure, NavigationFailureType.cancelled);
    if (pendingNavigation === to || redirectFailed) pendingNavigation = null;
  });
  // A guard that throws skips afterEach, so clear here or URL writes stay blocked.
  router.onError((_error, to) => {
    if (pendingNavigation === to) pendingNavigation = null;
  });
}

/** True while a navigation to a route other than `routeName` has not settled. */
export function isLeavingRoute(routeName: string): boolean {
  return !!pendingNavigation && pendingNavigation.name !== routeName;
}

export function resetPendingNavigationForTests(): void {
  pendingNavigation = null;
}
