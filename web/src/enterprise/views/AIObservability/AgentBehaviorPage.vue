<!--
  Copyright 2026 OpenObserve Inc.

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->
<template>
  <AiPageShell
    data-test="ai-agent-behavior"
    :title="t('aiObservability.nav.agentBehavior')"
    :subtitle="t('aiObservability.subtitle.agentBehavior')"
    icon="troubleshoot"
    :date-state="dateState"
    :last-run-at="behaviorLastRunAt"
    :is-loading="isLoading"
    @date-change="onDateChange"
    @refresh="refresh"
  >
    <!-- Scope control — same Stream/Agent pattern as Agent Graph, so the AI
         pages read as one product. Stream tab shows every agent's signals for
         the stream; Agent tab narrows to one discovered agent (and follows its
         source_stream). Lives in OPageLayout's #subnav (full-bleed divider). -->
    <template #subnav>
      <!-- Shared scope control. #subnav already draws the full-bleed divider,
           so the bar itself is unbordered. allAgents:false → the agent picker
           falls back to the plain agent label (no All-Agents concept here). -->
      <AiScopeBar
        v-model:filter-mode="filterMode"
        v-model:active-stream="activeStream"
        v-model:selected-env="selectedEnv"
        v-model:selected-agent-name="selectedAgentName"
        v-model:selected-version="selectedVersion"
        data-test="agent-behavior"
        :bordered="false"
        :labels="{
          agent: t('aiObservability.agentGraph.agent'),
          stream: t('aiObservability.agentGraph.stream'),
          streamLabel: t('aiObservability.agentGraph.stream'),
          allAgents: t('aiObservability.agentGraph.agent'),
        }"
        :stream-select-options="streamSelectOptions"
        :envs="envs"
        :agent-names="agentNames"
        :versions="versions"
        :selected-stream-count="selectedStreamCount"
        :streams-loaded="true"
        :agents-loaded="agentsLoaded"
        @filter-mode-change="onFilterModeChange"
      />
    </template>

    <!-- Full-height column: the panel splits the available height between its
         two cards, so the page itself never scrolls — each table scrolls
         internally when its rows overflow. -->
    <div class="px-page-edge flex min-h-0 flex-1 flex-col py-4">
      <AgentBehaviorPanel
        ref="panelRef"
        class="min-h-0 flex-1"
        :source-stream="effectiveStream"
        :agent-filter="agentFilter"
        :agent-env="filterMode === 'agent' ? selectedAgent?.env : null"
        :agent-version="filterMode === 'agent' ? selectedAgent?.version : null"
        :start-time="timeRange.startTime"
        :end-time="timeRange.endTime"
      />
    </div>
  </AiPageShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import AiPageShell from "@/enterprise/components/AIObservability/AiPageShell.vue";
import AgentBehaviorPanel from "./AgentBehaviorPanel.vue";
import AiScopeBar from "@/enterprise/components/AIObservability/AiScopeBar.vue";
import useStreams from "@/composables/useStreams";
import { useStore } from "vuex";
import { useAgentScope } from "@/enterprise/composables/useAgentScope";
import { useAiDateController } from "@/enterprise/composables/useAiDateController";
import { useChildRefresh } from "@/enterprise/composables/useChildRefresh";

defineOptions({ name: "AgentBehaviorPage" });

const { t } = useI18n();
const { getStreams } = useStreams();
const store = useStore();

// Shared with LLM Insights / Sessions / Quality — see useAiDateRange.ts.
// Agent Behavior has no from/to/period URL sync (urlSync:false), matching its
// prior behavior of resolving from shared state only.
const { dateState, timeRange, applyRelative, onDateChange, mountResolve, DEFAULT_RELATIVE } =
  useAiDateController({ urlSync: false });

// Agent is the default scope: the page is about a specific agent's behaviour,
// so it opens focused on one agent. Stream mode widens to every agent's signals.
const filterMode = ref<"stream" | "agent">("agent");
const availableStreams = ref<string[]>([]);
const activeStream = ref<string>("");
const panelRef = ref<any>(null);

// Agent-mode selection — mirrors Agent Graph. Same stream-scoped identity so
// same-named agents in different streams don't collide. Owned by the shared
// useAgentScope composable (allAgents:false → first agent auto-selected).
const {
  agentsLoaded,
  loadAgents,
  streamSelectOptions,
  selectedStreamCount,
  selectedAgent,
  effectiveStream,
  envs,
  agentNames,
  versions,
  selectedEnv,
  selectedAgentName,
  selectedVersion,
} = useAgentScope({
  filterMode,
  activeStream,
  availableStreams,
  orgId: () => store.state.selectedOrganization?.identifier,
  getWindow: () => ({
    start: timeRange.value.startTime,
    end: timeRange.value.endTime,
  }),
  allAgents: false,
  cascade: true,
  t,
});
// In Agent mode, narrow the panel to that one agent's name; Stream mode shows all.
// Kept page-local: Behavior passes the agent NAME to its panel.
const agentFilter = computed(() =>
  filterMode.value === "agent" ? (selectedAgent.value?.name ?? "") : "",
);

function onFilterModeChange(mode: unknown) {
  if (mode === "stream" || mode === "agent") filterMode.value = mode;
  if (mode === "agent" && !agentsLoaded.value) loadAgents();
}

// Last-refresh + loading for the header's ORefreshButton — the panel stamps
// `lastRunAt` when its fetch settles and exposes its own `loading`. The
// child-refresh composable derives both off the panel ref and re-anchors a
// relative window (onBeforeRefresh) before delegating to the panel's refresh().
const {
  lastRunAt: behaviorLastRunAt,
  isLoading,
  refresh,
} = useChildRefresh(panelRef, {
  onBeforeRefresh: () => {
    if (dateState.value.valueType === "relative") {
      applyRelative(dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
    }
  },
});

onMounted(async () => {
  mountResolve();

  try {
    const res = (await getStreams("traces", false, false)) as {
      list?: { name: string; settings?: { is_llm_stream?: boolean } }[];
    };
    // Only LLM trace streams belong here — Agent Behaviour has no signals for a
    // plain service/HTTP trace stream. `is_llm_stream` is the backend-maintained
    // flag (auto-detected at ingest from gen_ai_* columns). Exclude only streams
    // explicitly flagged non-LLM, matching LLM Insights / Sessions / Agent Graph.
    availableStreams.value = (res?.list ?? [])
      .filter((s) => s.settings?.is_llm_stream !== false)
      .map((s) => s.name);
    if (availableStreams.value.length && !activeStream.value) {
      activeStream.value = availableStreams.value[0];
    }
  } catch {
    availableStreams.value = [];
  }

  // Agent is the default scope, so the agent list must be ready on first paint.
  await loadAgents();
});
</script>
