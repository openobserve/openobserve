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

    <!-- Stream mode because these LLM spans carry no agent identity: the
         signals show for every span in the stream (agent "unknown"). -->
    <AiNoAgentIdentityBanner v-if="noAgentIdentity && scopeReady" data-test="agent-behavior" />

    <!-- Agent mode whose agents list failed to load: not "no agents". -->
    <div
      v-if="scopeReady && agentsLoadFailed"
      class="px-page-edge flex min-h-0 flex-1 items-center justify-center"
    >
      <AiAgentsLoadError
        :error="agentsError ?? 'failed'"
        data-test="agent-behavior"
        @retry="settleScope(true)"
      />
    </div>
    <!-- Full-height column: the panel splits the available height between its
         two cards, so the page itself never scrolls — each table scrolls
         internally when its rows overflow. The stream is withheld until the
         scope is settled, so the panel fetches once, for the final scope. -->
    <div v-else class="px-page-edge flex min-h-0 flex-1 flex-col py-4">
      <AgentBehaviorPanel
        ref="panelRef"
        class="min-h-0 flex-1"
        :scope-ready="scopeReady"
        :source-stream="scopeReady ? effectiveStream : ''"
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
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import AiPageShell from "@/enterprise/components/AIObservability/AiPageShell.vue";
import AgentBehaviorPanel from "./AgentBehaviorPanel.vue";
import AiScopeBar from "@/enterprise/components/AIObservability/AiScopeBar.vue";
import AiNoAgentIdentityBanner from "@/enterprise/components/AIObservability/AiNoAgentIdentityBanner.vue";
import AiAgentsLoadError from "@/enterprise/components/AIObservability/AiAgentsLoadError.vue";
import useStreams from "@/composables/useStreams";
import { useStore } from "vuex";
import {
  useAgentScope,
  readUrlScope,
  explicitScopeMode,
  resolveScopeMode,
  rememberModeChoice,
  scopeUrlQuery,
  type ScopeMode,
} from "@/enterprise/composables/useAgentScope";
import { useAiDateController } from "@/enterprise/composables/useAiDateController";
import { useChildRefresh } from "@/enterprise/composables/useChildRefresh";

defineOptions({ name: "AgentBehaviorPage" });

const { t } = useI18nTyped();
const { getStreams } = useStreams(t);
const store = useStore();
const route = useRoute();
const router = useRouter();

// Shared with LLM Insights / Sessions / Quality — see useAiDateRange.ts.
// Agent Behavior has no from/to/period URL sync (urlSync:false), matching its
// prior behavior of resolving from shared state only.
const { dateState, timeRange, applyRelative, onDateChange, mountResolve, DEFAULT_RELATIVE } =
  useAiDateController({ urlSync: false });

// The scope in the URL (`type`, `stream`, `agent`, `env`, `version`) wins over
// the defaults, so a link shared from any Monitor page opens the same agent
// here. Without an explicit mode (URL or remembered toggle) the agents list
// decides: Agent (the page is about one agent's behaviour) when the window has
// agents, Stream (every span's signals) when it has none.
const urlScope = readUrlScope(route.query);
const explicitMode = explicitScopeMode(urlScope);
const filterMode = ref<ScopeMode>(explicitMode ?? "agent");
const modeExplicit = ref(explicitMode !== null);
// False until streams and agents have loaded and the mode and selection are
// settled; the panel gets its stream only then.
const scopeReady = ref(false);
const availableStreams = ref<string[]>([]);
const activeStream = ref<string>(urlScope.stream);
const panelRef = ref<any>(null);

// Agent-mode selection — mirrors Agent Graph. Same stream-scoped identity so
// same-named agents in different streams don't collide. Owned by the shared
// useAgentScope composable (allAgents:false → first agent auto-selected).
const {
  agentsLoaded,
  agentsError,
  agentsLoadFailed,
  agents,
  loadAgents,
  noAgentIdentity,
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
  selectAgentByScope,
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

function syncScopeUrl() {
  const agent = selectedAgent.value
    ? { name: selectedAgent.value.name, env: selectedEnv.value, version: selectedVersion.value }
    : null;
  const query = scopeUrlQuery(route.query, {
    mode: filterMode.value,
    explicit: modeExplicit.value,
    stream: activeStream.value,
    agent,
  });
  router.replace({ query }).catch(() => {});
}

// A toggle click is an explicit choice: kept in the URL and remembered for the
// other Monitor pages.
function onFilterModeChange(mode: unknown) {
  if (mode !== "stream" && mode !== "agent") return;
  filterMode.value = mode;
  modeExplicit.value = true;
  rememberModeChoice(mode);
  syncScopeUrl();
}

watch([activeStream, selectedEnv, selectedAgentName, selectedVersion], () => {
  if (scopeReady.value) syncScopeUrl();
});

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

async function loadStreams() {
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
    if (!availableStreams.value.includes(activeStream.value)) {
      activeStream.value = availableStreams.value[0] ?? "";
    }
  } catch {
    availableStreams.value = [];
  }
}

// Streams and agents in parallel: together they settle the mode (agents in the
// window → Agent, none → Stream) and the URL's agent before the panel gets a
// stream, so it fetches once. A failed agents load settles nothing (the page
// stays on Agent with the error); its retry (`force`) runs this again.
async function settleScope(force = false) {
  const { startTime, endTime } = timeRange.value;
  await Promise.all([loadStreams(), loadAgents(startTime, endTime, force)]);
  if (!modeExplicit.value) {
    filterMode.value = resolveScopeMode(null, agents.value.length, agentsError.value);
  }
  if (urlScope.agent || urlScope.env || urlScope.version) {
    selectAgentByScope(urlScope.env, urlScope.agent, urlScope.version);
  }
  scopeReady.value = true;
  syncScopeUrl();
}

onMounted(() => {
  mountResolve();
  settleScope();
});
</script>
