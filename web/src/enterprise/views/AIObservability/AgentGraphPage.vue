<!-- Copyright 2026 OpenObserve Inc.

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
    data-test="ai-agent-graph"
    :title="t('aiObservability.nav.agentGraph')"
    :subtitle="t('aiObservability.subtitle.agentGraph')"
    icon="hub"
    :date-state="dateState"
    :last-run-at="graphLastRunAt"
    :is-loading="isGraphLoading"
    @date-change="onDateChange"
    @refresh="refresh"
  >
    <!-- Scope control — same Stream/Agent pattern as LLM Insights, so the two
         AI pages read as one product. Stream tab picks a trace stream; Agent
         tab picks a discovered agent and the graph follows its source_stream.
         Lives in OPageLayout's #subnav (which draws the full-bleed divider). -->
    <template #subnav>
      <!-- Shared scope control. #subnav already draws the full-bleed divider
           (bordered:false). allAgents:false → agent picker falls back to the
           plain agent label. Graph's version-agnostic hint rides in the #badges
           slot; its viz-type + layout controls ride in #trailing. -->
      <AiScopeBar
        v-model:filter-mode="filterMode"
        v-model:active-stream="activeStream"
        v-model:selected-env="selectedEnv"
        v-model:selected-agent-name="selectedAgentName"
        v-model:selected-version="selectedVersion"
        data-test="agent-graph"
        :bordered="false"
        :stream-option-tooltip="true"
        :show-version="false"
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
        @agent-pick="modeExplicit = true"
      >
        <!-- Version-agnostic hint. Agent Graph hides the cascade's Version
             dropdown (topology is the same across versions), so this info
             affordance beside the cascade explains why version isn't a scope
             here and points to version comparison. Graph-only (rides the
             #badges slot no other page passes). -->
        <template #badges>
          <OIcon
            name="info-outline"
            size="sm"
            class="text-text-secondary shrink-0"
            data-test="agent-graph-version-agnostic-hint"
          >
            <OTooltip
              :content="t('aiObservability.agentGraph.versionAgnosticHint')"
              max-width="18.75rem"
            />
          </OIcon>
        </template>
        <!-- Agent Graph's OWN visualization + layout selection. Kept fully
             independent of the Traces Service Graph tab (its own state + distinct
             localStorage keys), so the two surfaces don't share a type. Same
             control shape as the Traces SearchBar toolbar for consistency. -->
        <template #trailing>
          <div class="ms-auto flex shrink-0 items-center gap-2">
            <OToggleGroup
              :model-value="vizType"
              type="single"
              data-test="agent-graph-viz-type"
              @update:model-value="onVizTypeChange"
            >
              <OToggleGroupItem value="tree" size="sm">
                <template #icon-left>
                  <OIcon name="git-branch" size="sm" />
                </template>
                {{ t("traces.treeView") }}
              </OToggleGroupItem>
              <OToggleGroupItem value="graph" size="sm">
                <template #icon-left>
                  <OIcon name="share" size="sm" class="shrink-0" />
                </template>
                {{ t("traces.graphView") }}
              </OToggleGroupItem>
            </OToggleGroup>
            <OSelect
              v-model="layoutType"
              :options="layoutOptions"
              :searchable="false"
              data-test="agent-graph-layout-type"
              class="h-8! min-h-8! w-30"
              :disabled="vizType === 'graph'"
              @update:model-value="onLayoutTypeChange"
            />
          </div>
        </template>
      </AiScopeBar>
    </template>

    <!-- Stream mode because these LLM spans carry no agent identity: the graph
         shows the stream's services; the banner says why there is no agent. -->
    <AiNoAgentIdentityBanner v-if="noAgentIdentity && scopeReady" data-test="agent-graph" />

    <!-- Gate the graph until the effective stream is genuinely resolved.
         ServiceGraph loads unconditionally in its own onMounted, so mounting it
         before loadAgents() resolves would fire an initial query against the
         fallback ("default") stream — rendering the wrong, non-agent graph that
         only a manual refresh replaced. Rendering only once `graphReady` is true
         mounts ServiceGraph exactly once, with the correct stream. Later agent
         switches keep it mounted and go through the streamFilter watcher. -->
    <ServiceGraph
      v-if="graphReady"
      ref="graphRef"
      :stream-filter="effectiveStream"
      :time-range="timeRange"
      :agent-id="filterMode === 'agent' ? (selectedAgent?.id ?? null) : null"
      :agent-name="filterMode === 'agent' ? (selectedAgent?.name ?? null) : null"
      :agent-env="filterMode === 'agent' ? (selectedAgent?.env ?? null) : null"
      :viz-type="vizType"
      :layout-type="layoutType"
      hide-stream-selector
      agent-highlight
      class="min-h-0 flex-1"
    />
    <!-- Agent mode whose agents list failed to load: not "no agents". -->
    <div
      v-else-if="scopeReady && agentsLoadFailed"
      class="flex min-h-0 flex-1 items-center justify-center"
    >
      <AiAgentsLoadError
        :error="agentsError ?? 'failed'"
        size="block"
        data-test="agent-graph"
        @retry="loadAgents(true)"
      />
    </div>
    <!-- Nothing to graph in the current org / time window: no agents in Agent
         mode, or no LLM stream at all — an empty state, NOT the fallback
         `default` service graph (the original bug). -->
    <div
      v-else-if="hasNoAgents"
      data-test="agent-graph-no-agents"
      class="flex min-h-0 flex-1 items-center justify-center"
    >
      <OEmptyState
        size="block"
        illustration="service-graph"
        :title="t('aiObservability.agentGraph.noAgentsTitle')"
        :description="t('aiObservability.agentGraph.noAgentsDescription')"
      />
    </div>
    <!-- Agents / stream still resolving. -->
    <div
      v-else
      data-test="agent-graph-loading"
      class="flex min-h-0 flex-1 items-center justify-center"
    >
      <OSpinner />
    </div>
  </AiPageShell>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { AcceptableValue } from "reka-ui";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import AiPageShell from "@/enterprise/components/AIObservability/AiPageShell.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { getConsumableRelativeTime } from "@/utils/date";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import AiScopeBar from "@/enterprise/components/AIObservability/AiScopeBar.vue";
import AiNoAgentIdentityBanner from "@/enterprise/components/AIObservability/AiNoAgentIdentityBanner.vue";
import AiAgentsLoadError from "@/enterprise/components/AIObservability/AiAgentsLoadError.vue";
import { useAiDateController } from "@/enterprise/composables/useAiDateController";
import { useChildRefresh } from "@/enterprise/composables/useChildRefresh";
import { useLlmTraceStreams } from "@/enterprise/composables/useLlmTraceStreams";
import {
  useAgentScope,
  readUrlScope,
  explicitScopeMode,
  resolveScopeMode,
  rememberModeChoice,
  scopeUrlQuery,
  type ScopeMode,
} from "@/enterprise/composables/useAgentScope";

defineOptions({ name: "AIAgentGraphPage" });

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

// Shared AI-module date range — the same singleton LLM Insights / Sessions /
// Agent Behavior use, so picking a time on any AI tab lands on all of them.
// Agent Graph has no from/to/period URL sync (urlSync:false), matching its
// prior behavior of resolving from shared state only. `timeRange` is the
// resolved absolute window (µs) the graph + agent-list queries read.
const {
  dateState,
  timeRange,
  applyRelative,
  onDateChange: onDateStateChange,
  mountResolve,
} = useAiDateController({ urlSync: false });

const ServiceGraph = defineAsyncComponent(() => import("@/plugins/traces/ServiceGraph.vue"));

// The scope in the URL (`type`, `stream`, `agent`, `env`, `version`) wins over
// the defaults, so a link shared from any Monitor page opens the same agent
// here. Without an explicit mode (URL or remembered toggle) the agents list
// decides: Agent when the window has agents, Stream when it has none.
const urlScope = readUrlScope(route.query);
const explicitMode = explicitScopeMode(urlScope);
const filterMode = ref<ScopeMode>(explicitMode ?? "agent");
const modeExplicit = ref(explicitMode !== null);
// False until the first agents load has settled the mode and the selection;
// the graph mounts only after it, exactly once.
const scopeReady = ref(false);
// Whether an agents list has decided the mode. A failed agents load decides
// nothing, so the next load after it decides again; so does a window the user
// picks, whose agents may differ (unless the user chose the mode).
let modeSettled = false;
// Seeded once from the URL after the first agents load, then cleared.
let pendingUrlScope: { env: string; name: string; version: string } | null =
  urlScope.agent || urlScope.env || urlScope.version
    ? { env: urlScope.env, name: urlScope.agent, version: urlScope.version }
    : null;
const activeStream = ref<string>(urlScope.stream);

// Agent Graph's OWN visualization + layout selection — deliberately NOT the
// shared traces store (`searchObj.meta.serviceGraph*Type`) that the Traces
// Service Graph tab uses. Kept independent so the Agent Graph type doesn't bleed
// in from that tab, and so a remount can't render the stale shared type. Its
// own localStorage keys persist the choice across visits. Passed down to
// ServiceGraph via `viz-type` / `layout-type` props, which override the store.
const vizType = ref<"tree" | "graph">(
  (localStorage.getItem("agentGraph_visualizationType") as "tree" | "graph") || "tree",
);
const layoutType = ref<string>(localStorage.getItem("agentGraph_layoutType") || "horizontal");

const layoutOptions = computed(() =>
  vizType.value === "graph"
    ? [{ label: t("traces.layoutForce"), value: "force" }]
    : [
        { label: t("traces.layoutHorizontal"), value: "horizontal" },
        { label: t("traces.layoutVertical"), value: "vertical" },
      ],
);

function onVizTypeChange(value: boolean | AcceptableValue | AcceptableValue[]) {
  if (value !== "tree" && value !== "graph") return;
  vizType.value = value;
  localStorage.setItem("agentGraph_visualizationType", value);
  // Mirror the SearchBar toolbar: each view has a sensible default layout.
  const nextLayout = value === "tree" ? "horizontal" : "force";
  layoutType.value = nextLayout;
  localStorage.setItem("agentGraph_layoutType", nextLayout);
}

function onLayoutTypeChange(value: SelectModelValue) {
  // Layout options are always plain string values (horizontal/vertical/force);
  // v-model already assigned layoutType — this handler only persists it.
  if (typeof value !== "string") return;
  localStorage.setItem("agentGraph_layoutType", value);
}

// Graph child ref + header refresh state. ServiceGraph exposes
// { refresh, loading, lastRunAt }.
const graphRef = ref<any>(null);
// Header refresh state derived off the graph child. onBeforeRefresh re-anchors a
// relative window first so "last 15m" refreshes to now, then delegates to the
// graph's exposed refresh().
const {
  lastRunAt: graphLastRunAt,
  isLoading: isGraphLoading,
  refresh,
} = useChildRefresh(graphRef, {
  onBeforeRefresh: () => {
    if (dateState.value.valueType === "relative" && dateState.value.relativeTimePeriod) {
      applyRelative(dateState.value.relativeTimePeriod);
    }
  },
});

// Graph owns its `agents`/`agentsLoaded` refs and its `availableStreams`
// computed, injected INTO useAgentScope for the shared derived computeds and
// its loader.
const agents = ref<GenAiAgentListItem[]>([]);
const agentsLoaded = ref(false);

// LLM trace streams, for Stream mode when no agent identity exists. Loaded into
// a ref of their own: the loader clamps the ref it is given to its own list.
const llmStreamPick = ref("");
const { availableStreams: llmStreams, ensureStreamsLoaded } = useLlmTraceStreams(llmStreamPick, t);

// Streams offered in the Stream picker: the agent-bearing streams (the distinct
// source_streams of discovered agents) when agents exist — a trace stream with
// services but no agents (e.g. `introspection`) has nothing agent-related to
// show. With no agents at all, the LLM streams, so an org whose spans carry no
// agent identity still sees its LLM services graphed.
const availableStreams = computed(() =>
  agents.value.length ? [...new Set(agents.value.map((a) => a.source_stream))] : llmStreams.value,
);

// `allAgents:false` → no All-Agents entry; the cascade defaults to the first
// agent.
const {
  loadAgents: loadAgentList,
  agentsError,
  agentsLoadFailed,
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
  agents,
  agentsLoaded,
  availableStreams,
  orgId: () => store.state.selectedOrganization?.identifier,
  getWindow: () => {
    const w = effectiveWindow();
    return { start: w.startTime, end: w.endTime };
  },
  allAgents: false,
  cascade: true,
  // Graph is version-agnostic: it hides the Version dropdown, so the cascade
  // must resolve an agent from env + name alone (auto-pick the first version).
  versionAgnostic: true,
  t,
});

// Nothing to graph in the current org / time window: no agent to pick in Agent
// mode, or no stream at all in Stream mode.
const hasNoAgents = computed(
  () =>
    scopeReady.value &&
    (filterMode.value === "agent" ? !agents.value.length : !availableStreams.value.length),
);

// The graph may only mount once it has a real stream to query. In agent mode
// that requires an actually-selected agent (whose source_stream is the stream);
// in stream mode, a chosen stream. This prevents ServiceGraph's mount-time load
// from ever firing against a fallback stream, or before the mode is settled.
const graphReady = computed(
  () =>
    scopeReady.value &&
    (filterMode.value === "agent"
      ? !!selectedAgent.value && !!effectiveStream.value
      : !!activeStream.value),
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
function onFilterModeChange(mode: boolean | AcceptableValue | AcceptableValue[]) {
  if (mode !== "stream" && mode !== "agent") return;
  filterMode.value = mode;
  modeExplicit.value = true;
  rememberModeChoice(mode);
  syncScopeUrl();
}

watch([activeStream, selectedEnv, selectedAgentName], () => {
  if (scopeReady.value) syncScopeUrl();
});

function effectiveWindow() {
  if (dateState.value.valueType === "relative" && dateState.value.relativeTimePeriod) {
    const r = getConsumableRelativeTime(dateState.value.relativeTimePeriod);
    if (r) return { startTime: r.startTime, endTime: r.endTime };
  }
  return {
    startTime: dateState.value.startTime ?? 0,
    endTime: dateState.value.endTime ?? 0,
  };
}

// Loads the agents (and LLM streams) for the window, then settles the scope:
// on the first load the mode (unless explicit) and the URL's agent; on every
// load the Stream picker, whose options can change with the list. The cascade
// itself is reconciled against the fresh list by useAgentScope. `force` (the
// load-error retry) bypasses the agents cache.
async function loadAgents(force = false, windowPicked = false) {
  const { startTime, endTime } = effectiveWindow();
  await Promise.all([loadAgentList(startTime, endTime, force), ensureStreamsLoaded()]);
  if ((!modeSettled || windowPicked) && !modeExplicit.value) {
    filterMode.value = resolveScopeMode(null, agents.value.length, agentsError.value);
  }
  if (!agentsError.value) modeSettled = true;
  if (pendingUrlScope && agents.value.length) {
    selectAgentByScope(pendingUrlScope.env, pendingUrlScope.name, pendingUrlScope.version);
    pendingUrlScope = null;
  }
  if (activeStream.value && !availableStreams.value.includes(activeStream.value)) {
    activeStream.value = "";
  }
  if (!activeStream.value && availableStreams.value.length) {
    activeStream.value = availableStreams.value[0];
  }
  scopeReady.value = true;
  syncScopeUrl();
}

// Date-only state update is owned by useAiDateController; the page's extra
// effect on a date change is to reload the agent list for the new window. A
// user's pick also re-decides an auto mode for that window, as Agent Behavior
// does; the replay DateTime fires on mount does not.
function onDateChange(value: any) {
  onDateStateChange(value);
  loadAgents(false, value?.userChangedValue === true);
}

onMounted(() => {
  // Resolve the shared range to an absolute window on mount (re-anchoring a
  // relative range to "now"), so the graph and agent list query the same window
  // the other AI tabs use. urlSync:false → no URL read, resolve from shared state.
  mountResolve();
  loadAgents();
});
</script>
