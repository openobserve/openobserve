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

import type { LocationQuery, RouteLocationRaw, RouteRecordNameGeneric } from "vue-router";

// Their dashboard and playlist ids belong to one org.
const DASHBOARD_ITEM_ROUTES = new Set<RouteRecordNameGeneric>([
  "viewDashboard",
  "addPanel",
  "dashboardTvPlaylist",
]);

export const isDashboardItemRoute = (name: RouteRecordNameGeneric): boolean =>
  DASHBOARD_ITEM_ROUTES.has(name);

/** Route to open after an org switch: dashboard item pages go to the new org's list. */
export const getOrgSwitchRoute = (
  path: string,
  name: RouteRecordNameGeneric,
  query: LocationQuery,
  orgIdentifier: string,
): RouteLocationRaw => {
  if (isDashboardItemRoute(name)) {
    return { path: "/dashboards", query: { org_identifier: orgIdentifier } };
  }
  const queryParams = path.indexOf(".logs") > -1 ? query : {};
  return { path, query: { ...queryParams, org_identifier: orgIdentifier } };
};
