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
import workflows from "./workflows";
import { workflowKeys } from "./workflows.querykeys";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import { quantizeRange } from "@/composables/query/queryClient";

// The list handler returns a bare array; older builds wrapped it in `list`.
const rowsOf = (data: any): any[] => (Array.isArray(data) ? data : (data?.list ?? []));

export const workflowsQuery = (org: string) =>
  queryOptions({
    queryKey: workflowKeys.list(org),
    queryFn: async (): Promise<any[]> => rowsOf((await workflows.listWorkflows(org)).data),
    staleTime: NORMAL_STALE_TIME,
  });

export const workflowFolderQuery = (org: string, folderId: string) =>
  queryOptions({
    queryKey: workflowKeys.folder(org, folderId),
    queryFn: async (): Promise<any[]> =>
      rowsOf((await workflows.listWorkflows(org, folderId)).data),
    staleTime: NORMAL_STALE_TIME,
  });

/** Every folder, matched server-side; `all_folders` overrides any folder, so the term alone keys it. */
export const workflowSearchQuery = (org: string, term: string) =>
  queryOptions({
    queryKey: workflowKeys.search(org, term),
    queryFn: async (): Promise<any[]> =>
      rowsOf((await workflows.listWorkflows(org, undefined, true, term)).data),
    staleTime: NORMAL_STALE_TIME,
  });

/** The key buckets the window to the minute; the request keeps the exact range, so a run from the last minute is still in it. */
export const workflowRunsQuery = (
  org: string,
  workflowId: string,
  startTime: number,
  endTime: number,
) => {
  const { start, end } = quantizeRange(startTime, endTime);
  return queryOptions({
    queryKey: workflowKeys.runs(org, workflowId, start, end),
    queryFn: async (): Promise<any[]> =>
      rowsOf(
        (
          await workflows.getWorkflowHistory({
            org_identifier: org,
            id: workflowId,
            start_time: startTime,
            end_time: endTime,
          })
        ).data,
      ),
    staleTime: NORMAL_STALE_TIME,
  });
};
