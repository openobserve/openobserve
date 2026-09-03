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

import { queryOptions } from "@tanstack/vue-query";
import reports from "./reports";
import type { ReportListFilters } from "./reports";
import { reportKeys } from "./reports.querykeys";

export const reportsQuery = (org: string, filters: ReportListFilters) =>
  queryOptions({
    queryKey: reportKeys.list(org, filters),
    queryFn: async (): Promise<any[]> =>
      (
        await reports.listByFolderId(
          org,
          filters.folder,
          undefined,
          filters.isCache,
          filters.nameQuery || undefined,
        )
      ).data ?? [],
    refetchOnWindowFocus: true,
  });

export const reportDetailQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: reportKeys.detail(org, id),
    queryFn: async () => (await reports.getReportById(org, id)).data,
  });
