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
              max-width="300px"
            />
          </OIcon>
        </template>
        <!-- Agent Graph's OWN visualization + layout selection. Kept fully
             independent of the Traces Service Graph tab (its own state + distinct
             localStorage keys), so the two surfaces don't share a type. Same
             control shape as the Traces SearchBar toolbar for consistency. -->
        <template #trailing>
          <div class="ml-auto flex shrink-0 items-center gap-2">
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
              class="h-8! min-h-8! w-[7.5rem]"
              :disabled="vizType === 'graph'"
              @update:model-value="onLayoutTypeChange"
            />
          </div>
        </template>
      </AiScopeBar>
    </template>

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
    <!-- No agents discovered in the current org / time window — show an empty
         state, NOT the fallback `default` service graph (the original bug). -->
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
import { defineAsyncComponent, ref, computed, onMounted } from "vue";
import type { AcceptableValue } from "reka-ui";
import { useI18n } from "vue-i18n";
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
import useTraces from "@/composables/useTraces";
import { getConsumableRelativeTime } from "@/utils/date";
import genAiAgentMappingService, {
  type GenAiAgentListItem,
} from "@/services/gen-ai-agent-mapping.service";
import { agentOptionKey } from "@/plugins/traces/llmAgentFilter";
import AiScopeBar from "@/enterprise/components/AIObservability/AiScopeBar.vue";
import { useAiDateController } from "@/enterprise/composables/useAiDateController";
import { useChildRefresh } from "@/enterprise/composables/useChildRefresh";
import { useAgentScope } from "@/enterprise/composables/useAgentScope";

defineOptions({ name: "AIAgentGraphPage" });

const { t } = useI18n();
const store = useStore();
const { searchObj } = useTraces();

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

// Default scope is "agent" — the AI module is agent-centric (agents load on
// mount, so the default is ready on first paint).
const filterMode = ref<"stream" | "agent">("agent");
const activeStream = ref<string>("");

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

// Graph owns its `agents`/`agentsLoaded` refs and its from-agents
// `availableStreams` computed (its Stream picker is derived from agent-bearing
// streams, not from all trace streams). Its own reconciling `loadAgents`
// (evict-stale-key + evict-stale-stream + default-both) also stays page-local.
// These are injected INTO useAgentScope purely to obtain the shared derived
// computeds (agentSelectOptions/streamSelectOptions/selectedStreamCount/
// selectedAgent/effectiveStream); Graph does NOT use the composable's loadAgents.
const agents = ref<GenAiAgentListItem[]>([]);
const agentsLoaded = ref(false);

// Stream-scoped identity, mirroring LLM Insights — same-named agents in
// different streams (or different env/version) don't collide.
const agentKey = (a: GenAiAgentListItem) => agentOptionKey(a);

// Streams offered in the Stream picker are ONLY those that actually carry agent
// data — i.e. the distinct source_streams of discovered agents. A trace stream
// with services but no agents (e.g. `introspection`) has nothing agent-related
// to show here, so it must not appear. Derived from the agents list rather than
// from all trace streams for exactly this reason. Passed into useAgentScope,
// which only READS it (streamSelectOptions/selectedStreamCount).
const availableStreams = computed(() => [...new Set(agents.value.map((a) => a.source_stream))]);

// Shared derived scope computeds from useAgentScope. `activeAgent` (the
// composable's single selection ref) replaces Graph's former `activeAgentKey`;
// Graph's `loadAgents` reconciliation writes into it. `allAgents:false` → no
// All-Agents entry, matching Graph's first-agent-default behavior. Graph's own
// `agents`/`agentsLoaded` refs and from-agents `availableStreams` computed are
// injected, so the composable reads Graph's data and never loads on its own.
const {
  activeAgent,
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

// Whether there is simply nothing agent-related to graph in the current org /
// time window. There are no agents at all → both modes have nothing to show
// (the Stream picker is itself derived from agent-bearing streams).
const hasNoAgents = computed(() => agentsLoaded.value && !agents.value.length);

// The graph may only mount once it has a real stream to query. In agent mode
// that requires an actually-selected agent (whose source_stream is the stream);
// in stream mode, a chosen agent-bearing stream. This prevents ServiceGraph's
// mount-time load from ever firing against a fallback/agentless stream.
const graphReady = computed(() =>
  filterMode.value === "agent"
    ? !!selectedAgent.value && !!effectiveStream.value
    : !!activeStream.value,
);

function onFilterModeChange(mode: boolean | AcceptableValue | AcceptableValue[]) {
  if (mode === "stream" || mode === "agent") filterMode.value = mode;
}

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

async function loadAgents() {
  try {
    const org = store.state.selectedOrganization.identifier;
    const { startTime, endTime } = effectiveWindow();
    const res = await genAiAgentMappingService.listAgents(org, startTime, endTime);
    agents.value = res.agents ?? [];
    // Reconcile the selection against the fresh list. Reloading (e.g. after a
    // time-range change) can return a different or empty set, which would
    // otherwise leave `activeAgent` pointing at an agent no longer present —
    // the dropdown then shows a stale name while the graph has no agent. Clear a
    // now-invalid key, and auto-select the first agent when none is selected.
    // `activeAgent` is useAgentScope's selection ref (Graph keeps its OWN richer
    // reconciliation here rather than the composable's key-only clamp).
    const keys = new Set(agents.value.map((a) => agentKey(a)));
    if (activeAgent.value && !keys.has(activeAgent.value)) {
      activeAgent.value = "";
    }
    if (!activeAgent.value && agents.value.length) {
      activeAgent.value = agentKey(agents.value[0]);
    }
    // Same reconciliation for the Stream picker, whose options are the distinct
    // agent-bearing source_streams (availableStreams). Clear a now-absent
    // stream, and default to the first agent-bearing stream.
    if (activeStream.value && !availableStreams.value.includes(activeStream.value)) {
      activeStream.value = "";
    }
    if (!activeStream.value && availableStreams.value.length) {
      activeStream.value = availableStreams.value[0];
    }
  } catch {
    agents.value = [];
    activeAgent.value = "";
    activeStream.value = "";
  } finally {
    agentsLoaded.value = true;
  }
}

// Date-only state update is owned by useAiDateController; the page's extra
// effect on a date change is to reload the agent list for the new window.
function onDateChange(value: any) {
  onDateStateChange(value);
  loadAgents();
}

onMounted(() => {
  // Resolve the shared range to an absolute window on mount (re-anchoring a
  // relative range to "now"), so the graph and agent list query the same window
  // the other AI tabs use. urlSync:false → no URL read, resolve from shared state.
  mountResolve();
  loadAgents();
});
</script>
