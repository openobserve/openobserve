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
import dashboards from "./dashboards";
import { readyMadeKeys } from "./readyMade.querykeys";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import {
  getReadyMadeSource,
  parseReadyMadeMarker,
  readyMadeTitleQuery,
  type ReadyMadeSourceId,
} from "@/composables/readyMade/catalog";

/** A dashboard in the org carrying a source's ready-made marker. */
export interface ReadyMadeCopy {
  dashboardId: string;
  folderId: string;
  folderName: string;
  title: string;
  key: string;
  created: string;
}

/** Every marked copy of a source anywhere in the org, oldest first. */
export const readyMadeCopiesQuery = (org: string, sourceId: ReadyMadeSourceId) =>
  queryOptions({
    queryKey: readyMadeKeys.copies(org, sourceId),
    queryFn: async (): Promise<ReadyMadeCopy[]> => {
      // No folder + a title runs the list across every folder.
      const res = await dashboards.list(
        0,
        100,
        "name",
        false,
        "",
        org,
        "",
        readyMadeTitleQuery(getReadyMadeSource(sourceId)),
      );
      const rows: any[] = res.data?.dashboards ?? [];
      return rows
        .flatMap((row): ReadyMadeCopy[] => {
          const marker = parseReadyMadeMarker(row.role);
          if (marker?.sourceId !== sourceId) return [];
          return [
            {
              dashboardId: row.dashboard_id,
              folderId: row.folder_id,
              folderName: row.folder_name,
              title: row.title,
              key: marker.key,
              created: String(row.created ?? ""),
            },
          ];
        })
        .sort(oldestFirst);
    },
    staleTime: NORMAL_STALE_TIME,
  });

/** Oldest `created` wins, then the smaller id, so two clients agree on one survivor. */
export function oldestFirst(a: ReadyMadeCopy, b: ReadyMadeCopy): number {
  const byTime = (Date.parse(a.created) || 0) - (Date.parse(b.created) || 0);
  if (byTime !== 0) return byTime;
  return a.dashboardId < b.dashboardId ? -1 : a.dashboardId > b.dashboardId ? 1 : 0;
}
