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
import modelPricing from "./model_pricing";
import { modelPricingKeys } from "./model_pricing.querykeys";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";

export const modelPricingQuery = (org: string) =>
  queryOptions({
    queryKey: modelPricingKeys.list(org),
    queryFn: async (): Promise<any[]> => (await modelPricing.list(org)).data ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

/** The list is an hour-long cached read, so the editor would otherwise route back to a pre-write copy. */
export const saveModelPricingMutation = (org: string) =>
  mutationOptions({
    // The id travels in the vars: the editor only knows it per submitted model.
    mutationFn: (vars: { id?: string; data: any }) =>
      vars.id ? modelPricing.update(org, vars.id, vars.data) : modelPricing.create(org, vars.data),
    // The editor composes its own toast, including the pattern-conflict warning.
    meta: { invalidates: [modelPricingKeys.all(org)], silentError: true },
  });
