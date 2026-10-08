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

import type { NavigationGuardReturn, RouteLocationNormalized } from "vue-router";
import { PA_ROUTES, PRODUCT_ANALYTICS_PATH } from "@/utils/rum/productAnalyticsRoutes";

/** True for every page of Product Analytics, the named-event editor included. */
export const isProductAnalyticsPath = (path: string): boolean =>
  path === PRODUCT_ANALYTICS_PATH || path.startsWith(`${PRODUCT_ANALYTICS_PATH}/`);

/** The funnels list's beforeRouteEnter: a link from outside naming a funnel opens it in the builder. */
export const forwardFunnelLink = (
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
): NavigationGuardReturn => {
  if (to.query.sf === undefined && to.query.funnel === undefined) return true;
  // A move inside Product Analytics is the app's own navigation, never a shared funnel link.
  if (isProductAnalyticsPath(from.path)) return true;
  return { name: PA_ROUTES.funnelBuilder, query: to.query, replace: true };
};
