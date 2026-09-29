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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import { quantizeRange, stableFilters } from "@/composables/query/queryClient";
import pipelines from "./pipelines";
import { pipelineKeys } from "./pipelines.querykeys";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";

export const pipelinesQuery = (org: string) =>
  queryOptions({
    queryKey: pipelineKeys.list(org),
    queryFn: async (): Promise<any[]> => (await pipelines.getPipelines(org)).data?.list ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

export const pipelineHistoryQuery = (org: string, params: Record<string, string>) => {
  // Callers anchor the range to a raw `now`; bucket it so a revisit inside the
  // freshness window is a cache hit instead of a new key per mount.
  const { start, end } = quantizeRange(Number(params.start_time), Number(params.end_time));
  const q = { ...params, start_time: String(start), end_time: String(end) };
  return queryOptions({
    queryKey: pipelineKeys.history(org, stableFilters(q)),
    // Only the key buckets: a bucketed `end` would hide every run from the current minute.
    queryFn: async () => (await pipelines.getPipelineHistory(org, params)).data,
    staleTime: NORMAL_STALE_TIME,
  });
};

// ── Writes ──────────────────────────────────────────────────────────────────

/** Create and update drop the same scope, so the editor declares neither. */
export const savePipelineMutation = (org: string, isUpdate: () => boolean) =>
  mutationOptions({
    mutationFn: (data: any) =>
      isUpdate()
        ? pipelines.updatePipeline({ org_identifier: org, data })
        : pipelines.createPipeline({ org_identifier: org, data }),
    // The editor renders the failure itself and keeps the canvas open on error.
    meta: { invalidates: [pipelineKeys.all(org)], silentError: true },
  });
