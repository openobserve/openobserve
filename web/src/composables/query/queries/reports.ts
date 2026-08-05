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
 * Reports, per folder.
 *
 * The server applies the folder, the cached/scheduled tab and the name search,
 * so all three belong in the key — which is what makes re-typing a search a
 * cache hit instead of a request. The table's own filtering and paging stay out.
 */

import reportsService from "@/services/reports";
import { createOrgListQuery } from "../createOrgListQuery";
import { qk, stableFilters } from "../queryKeys";

export interface ReportListFilters {
  /** undefined = search across every folder. */
  folder?: string;
  isCache?: boolean;
  nameQuery?: string;
}

export const reportsQuery = createOrgListQuery<any, [filters: ReportListFilters]>({
  key: (org, filters) => [
    ...qk.reports.listByFolder(org, filters.folder ?? "__all__"),
    stableFilters({ isCache: filters.isCache, nameQuery: filters.nameQuery }),
  ],
  fetch: async (org, filters) =>
    (
      await reportsService.listByFolderId(
        org,
        filters.folder,
        undefined,
        filters.isCache,
        filters.nameQuery || undefined,
      )
    ).data ?? [],
  tier: "ENTITY_LIST",
  root: (org) => qk.reports.root(org),
});
