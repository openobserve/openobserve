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

import store from "@/stores";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";
import { routeGuard } from "@/utils/zincutils";

/** Sends Settings › Slack to General unless Slack can be on; a cold load has not read /config yet, so only an explicit `false` redirects. */
export const slackRouteGuard = (to: any, from: any, next: any) => {
  const zoConfig = store.state.zoConfig;
  const editionAllows = checkFeatureAccess("slack", buildFeatureGateContext(zoConfig)).allowed;
  if (!editionAllows || zoConfig?.slack_enabled === false) {
    next({ name: "general", query: { org_identifier: to.query?.org_identifier } });
    return;
  }
  routeGuard(to, from, next);
};
