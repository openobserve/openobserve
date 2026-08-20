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

import { queryOptions, useQuery } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query/useOrgId";
import dashboards from "./dashboards";
import { dashboardKeys } from "./dashboards.querykeys";

export const dashboardsByFolderQuery = (org: string, folderId: string) =>
  queryOptions({
    queryKey: dashboardKeys.byFolder(org, folderId),
    queryFn: async (): Promise<any[]> =>
      (await dashboards.list(0, 1000, "name", false, "", org, folderId, "")).data?.dashboards ?? [],
    refetchOnWindowFocus: true,
  });

/**
 * Reactive sugar for `setup()` consumers: the same cache entry and policy, only
 * the consumption shape differs. A null folder disables the read rather than
 * keying on a sentinel.
 */
export const useDashboards = (folderId: () => string | null | undefined) => {
  const org = useOrgId();
  return useQuery(() =>
    Object.assign(dashboardsByFolderQuery(org.value, (folderId() ?? "") as string), {
      enabled: !!org.value && !!folderId(),
    }),
  );
};
