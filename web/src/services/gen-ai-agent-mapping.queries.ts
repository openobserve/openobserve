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
import genAiAgentMappingService, {
  type GenAiAgentListResponse,
} from "./gen-ai-agent-mapping.service";
import { genAiAgentKeys } from "./gen-ai-agent-mapping.querykeys";
import { CONFIG_STALE_TIME } from "@/composables/query/cachePolicy";
import { quantizeRange } from "@/composables/query/queryClient";

/** Keyed on a quantized window: callers derive their range from `Date.now()`, so raw anchors would fork the entry on every visit and never hit. */
export const genAiAgentsQuery = (org: string, startTime: number, endTime: number) => {
  const { start, end } = quantizeRange(startTime, endTime);
  return queryOptions({
    queryKey: genAiAgentKeys.agents(org, start, end),
    queryFn: (): Promise<GenAiAgentListResponse> =>
      genAiAgentMappingService.listAgents(org, startTime, endTime),
    staleTime: CONFIG_STALE_TIME,
  });
};

// ── Writes ──────────────────────────────────────────────────────────────────

/** The mapping is what turns spans into agents, so a save re-derives the list. */
export const saveGenAiAgentMappingMutation = (org: string) =>
  mutationOptions({
    mutationFn: (config: any) => genAiAgentMappingService.save(org, config),
    meta: { invalidates: [genAiAgentKeys.all(org)], silentError: true },
  });

/** Wipes the registry the agent list is built from — seven surfaces read it. */
export const clearGenAiAgentRegistryMutation = (org: string) =>
  mutationOptions({
    mutationFn: () => genAiAgentMappingService.clearRegistry(org),
    meta: { invalidates: [genAiAgentKeys.all(org)], silentError: true },
  });
