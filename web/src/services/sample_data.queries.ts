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

import { mutationOptions } from "@tanstack/vue-query";
import { orgKey } from "@/composables/query/keys";
import {
  loadSampleData,
  removeSampleData,
  type SampleLoadResult,
  type SampleProgress,
} from "@/utils/sampleData/loader";

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

export const removeSampleDataMutation = (org: string) =>
  mutationOptions({
    mutationFn: () => removeSampleData(org),
    meta: { invalidates: [orgKey(org)], removes: [orgKey(org)], silentError: true },
  });
