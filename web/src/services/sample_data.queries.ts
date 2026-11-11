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
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import { orgKey } from "@/composables/query/keys";
import sampleDataService from "./sample_data";
import { sampleDataKeys } from "./sample_data.querykeys";
import {
  loadSampleData,
  removeSampleData,
  type SampleRemoveStepId,
  type SampleLoadResult,
  type SampleProgress,
} from "@/utils/sampleData/loader";

export const sampleDataStateQuery = (org: string) =>
  queryOptions({
    queryKey: sampleDataKeys.state(org),
    queryFn: async () => (await sampleDataService.getState(org)).data,
    staleTime: MEDIUM_STALE_TIME,
  });

export interface LoadSampleDataVars {
  ingestAllowedUptoHours?: number;
  onProgress: (p: SampleProgress) => void;
}

// Sample data touches streams, dashboards, alerts, functions and the org summary at once, so the whole org scope expires.
export const loadSampleDataMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: LoadSampleDataVars): Promise<SampleLoadResult> =>
      loadSampleData(org, vars.ingestAllowedUptoHours, vars.onProgress),
    meta: { invalidates: [orgKey(org)], silentError: true },
  });

export interface RemoveSampleDataVars {
  onStep?: (id: SampleRemoveStepId, status: "running" | "done" | "failed") => void;
}

export const removeSampleDataMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars?: RemoveSampleDataVars) => removeSampleData(org, vars?.onStep),
    meta: { invalidates: [orgKey(org)], removes: [orgKey(org)], silentError: true },
  });
