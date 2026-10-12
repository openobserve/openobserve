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

import type { InjectionKey } from "vue";

export interface DashboardFreshOnOpen {
  /** Whether a panel restored from cache re-queries; read when the panel loads, not live. */
  appliesTo: (panel: any) => boolean;
  wasRefreshed: (key: string) => boolean;
  markRefreshed: (key: string) => void;
  reset: () => void;
}

// Dashboard-only: RUM AppPerformance also provides "dashboardAutoRun", so that key cannot gate this.
export const DASHBOARD_FRESH_ON_OPEN: InjectionKey<DashboardFreshOnOpen> =
  Symbol("dashboardFreshOnOpen");

export const createDashboardFreshOnOpen = (
  appliesTo: (panel: any) => boolean,
): DashboardFreshOnOpen => {
  // Lives as long as one dashboard visit, so a revisited tab restores its fresh entry without a query.
  const refreshed = new Set<string>();
  return {
    appliesTo,
    wasRefreshed: (key) => refreshed.has(key),
    markRefreshed: (key) => {
      refreshed.add(key);
    },
    reset: () => refreshed.clear(),
  };
};
