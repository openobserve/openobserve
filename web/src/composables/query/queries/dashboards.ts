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
 * Dashboards in one folder. Replaces the `organizationData.allDashboardList`
 * map, which had no TTL and was invalidated by hand from a dozen sites.
 */

import dashboardService from "@/services/dashboards";
import { createOrgListQuery } from "../createOrgListQuery";
import { qk } from "../queryKeys";
import { annotationService } from "@/services/dashboard_annotations";
import { createDetailQuery } from "../createDetailQuery";

const PAGE_SIZE = 1000;

export const dashboardsByFolderQuery = createOrgListQuery<any, [folderId: string]>({
  key: (org, folderId) => qk.dashboards.list(org, folderId),
  fetch: async (org, folderId) =>
    (
      await dashboardService.list(
        0,
        PAGE_SIZE,
        "name",
        false,
        "",
        org,
        folderId,
        // Empty title — the param exists on the endpoint and omitting it errors.
        "",
      )
    ).data?.dashboards ?? [],
  tier: "ENTITY_LIST",
  root: (org) => qk.dashboards.root(org),
});

export const dashboardAnnotationsQuery = createDetailQuery<[dashboardId: string, params: unknown]>({
  key: (org, dashboardId, params) => qk.dashboards.annotations(org, dashboardId, params),
  // `?? null` because a query result may not be undefined — TanStack rejects it.
  // All three "no annotations" shapes (missing .data, null, undefined) therefore
  // normalise to null, which is what two of them already returned.
  fetch: async (org, dashboardId, params) =>
    (await annotationService.get_timed_annotations(org, dashboardId, params as any)).data ?? null,
  root: (org) => qk.dashboards.root(org),
});
