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

import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import type { TranslateFn } from "@/types/i18n";
import genAiAgentMappingService, {
  type GenAiAgentListItem,
} from "@/services/gen-ai-agent-mapping.service";
import { useLlmTraceStreams } from "./useLlmTraceStreams";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";

export function useLlmPageScope(t: TranslateFn) {
  const store = useStore();
  const stream = ref("");
  const agentName = ref<string | null>(null);
  const agents = ref<GenAiAgentListItem[]>([]);
  const { availableStreams, ensureStreamsLoaded } = useLlmTraceStreams(stream, t);

  async function load(start: number, end: number) {
    await ensureStreamsLoaded();
    try {
      agents.value = (
        await genAiAgentMappingService.listAgents(
          store.state.selectedOrganization?.identifier ?? "",
          start,
          end,
        )
      ).agents;
    } catch {
      // No agent mapping on this edition: the stream alone scopes the page.
      agents.value = [];
    }
  }

  const agentNames = computed(() => [
    ...new Set(agents.value.filter((a) => a.source_stream === stream.value).map((a) => a.name)),
  ]);
  // An agent picked on another stream does not scope this one: drop it.
  watch(stream, () => {
    if (agentName.value && !agentNames.value.includes(agentName.value)) agentName.value = null;
  });
  const scope = computed(() =>
    agentName.value ? `gen_ai_agent_name = ${sqlLiteral(agentName.value)}` : "",
  );

  return { stream, agentName, agents, availableStreams, agentNames, scope, load };
}
