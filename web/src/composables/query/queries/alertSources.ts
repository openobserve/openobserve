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
 * External alert sources (incident integrations).
 *
 * Client-paginated: the page filters, sorts and pages in the browser, so none
 * of that reaches the query key.
 */

import alertSourcesService from "@/services/alert_sources";
import { createOrgListQuery } from "../createOrgListQuery";
import { qk } from "../queryKeys";

export const alertSourcesQuery = createOrgListQuery<any>({
  key: (org) => qk.alerts.sources(org),
  fetch: async (org) => (await alertSourcesService.list(org)).data?.integrations ?? [],
  tier: "ENTITY_LIST",
});
