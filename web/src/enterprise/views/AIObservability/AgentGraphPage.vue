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
  <OPageLayout
    data-test="ai-agent-graph-page"
    :title="t('aiObservability.nav.agentGraph')"
    :subtitle="t('aiObservability.subtitle.agentGraph')"
    icon="hub"
    bleed
    :scroll="false"
  >
    <template #actions>
      <DateTime
        ref="dateTimeRef"
        auto-apply
        menu-align="end"
        :default-type="searchObj.data.datetime.type"
        :default-absolute-time="{
          startTime: searchObj.data.datetime.startTime ?? 0,
          endTime: searchObj.data.datetime.endTime ?? 0,
        }"
        :default-relative-time="searchObj.data.datetime.relativeTimePeriod ?? '15m'"
        data-test="ai-agent-graph-date-time"
        class="h-8"
        @on:date-change="onDateChange"
      />
      <!-- Last-refresh + refresh control, consistent with LLM Insights /
             Sessions / Agent Behavior page headers. -->
      <div
        class="border-border-default rounded-default inline-flex h-8 items-center overflow-hidden border px-1"
      >
        <ORefreshButton
          :last-run-at="graphLastRunAt"
          :loading="isGraphLoading"
          :disabled="isGraphLoading"
          data-test="ai-agent-graph-refresh-btn"
          @click="refresh"
        />
      </div>
    </template>

    <!-- Scope control — same Stream/Agent pattern as LLM Insights, so the two
         AI pages read as one product. Stream tab picks a trace stream; Agent
         tab picks a discovered agent and the graph follows its source_stream.
         Lives in OPageLayout's #subnav (which draws the full-bleed divider). -->
    <template #subnav>
      <div class="px-page-edge flex items-center gap-3 py-2">
        <OToggleGroup
          :model-value="filterMode"
          type="single"
          data-test="agent-graph-filter-mode"
          @update:model-value="onFilterModeChange"
        >
          <OToggleGroupItem value="agent" size="sm">{{
            t("aiObservability.agentGraph.agent")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="stream" size="sm">{{
            t("aiObservability.agentGraph.stream")
          }}</OToggleGroupItem>
        </OToggleGroup>

        <div
          v-if="filterMode === 'stream'"
          data-test="agent-graph-stream-selector"
          class="w-80 shrink-0"
        >
          <OSelect
            v-model="activeStream"
            :label="t('aiObservability.agentGraph.stream')"
            label-position="inside"
            :options="streamSelectOptions"
            labelKey="label"
            valueKey="value"
            option-tooltip
            class="rounded-default w-full"
          />
        </div>
        <div v-else data-test="agent-graph-agent-selector" class="w-80 shrink-0">
          <OSelect
            v-model="activeAgentKey"
            :label="t('aiObservability.agentGraph.agent')"
            label-position="inside"
            :options="agentSelectOptions"
            labelKey="label"
            valueKey="value"
            :loading="!agentsLoaded"
            class="rounded-default w-full"
          />
        </div>

        <!-- Agent Graph's OWN visualization + layout selection. Kept fully
           independent of the Traces Service Graph tab (its own state + distinct
           localStorage keys), so the two surfaces don't share a type. Same
           control shape as the Traces SearchBar toolbar for consistency. -->
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
      </div>
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
  </OPageLayout>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref, computed, onMounted } from "vue";
import type { AcceptableValue } from "reka-ui";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import DateTime from "@/components/DateTime.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import useTraces from "@/composables/useTraces";
import { getConsumableRelativeTime } from "@/utils/date";
import genAiAgentMappingService, {
  type GenAiAgentListItem,
} from "@/services/gen-ai-agent-mapping.service";

defineOptions({ name: "AIAgentGraphPage" });

const { t } = useI18n();
const store = useStore();
const { searchObj } = useTraces();

const ServiceGraph = defineAsyncComponent(() => import("@/plugins/traces/ServiceGraph.vue"));

const DEFAULT_RELATIVE = "15m";

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
const isRefreshing = ref(false);
const graphLastRunAt = computed<number | null>(() => graphRef.value?.lastRunAt ?? null);
const isGraphLoading = computed(() => isRefreshing.value || graphRef.value?.loading || false);

async function refresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    // Re-anchor a relative window first so "last 15m" refreshes to now.
    const dt = searchObj.data.datetime;
    if (dt.type === "relative" && dt.relativeTimePeriod) {
      const r = getConsumableRelativeTime(dt.relativeTimePeriod);
      if (r) {
        searchObj.data.datetime = {
          ...dt,
          startTime: r.startTime,
          endTime: r.endTime,
        };
      }
    }
    await graphRef.value?.refresh?.();
  } finally {
    isRefreshing.value = false;
  }
}

const agents = ref<GenAiAgentListItem[]>([]);
const agentsLoaded = ref(false);
const activeAgentKey = ref<string>("");

// Stream-scoped identity, mirroring LLM Insights — same-named agents in
// different streams don't collide.
const agentKey = (a: GenAiAgentListItem) => `${a.source_stream}::${a.name}`;

const agentSelectOptions = computed(() =>
  agents.value.map((a) => ({
    label: a.id ? `${a.name} (${a.id})` : a.name,
    value: agentKey(a),
  })),
);

// Streams offered in the Stream picker are ONLY those that actually carry agent
// data — i.e. the distinct source_streams of discovered agents. A trace stream
// with services but no agents (e.g. `introspection`) has nothing agent-related
// to show here, so it must not appear. Derived from the agents list rather than
// from all trace streams for exactly this reason.
const availableStreams = computed(() => [...new Set(agents.value.map((a) => a.source_stream))]);

// Stream picker options: the stream name annotated with how many agents it
// contains, e.g. "sre_agent_traces_production (2 agents)". The count makes it
// clear a stream holds multiple agents and disambiguates otherwise similar (or
// truncated) stream names. `value` stays the bare stream name. The full stream
// name is kept in `title` so a truncated label still reveals itself on hover.
const streamSelectOptions = computed(() => {
  const counts = new Map<string, number>();
  for (const a of agents.value) {
    counts.set(a.source_stream, (counts.get(a.source_stream) ?? 0) + 1);
  }
  return availableStreams.value.map((s) => {
    const n = counts.get(s) ?? 0;
    return {
      label: `${s} (${n} ${
        n === 1
          ? t("aiObservability.agentGraph.agentCountSingular")
          : t("aiObservability.agentGraph.agentCountPlural")
      })`,
      value: s,
    };
  });
});

const selectedAgent = computed<GenAiAgentListItem | null>(
  () => agents.value.find((a) => agentKey(a) === activeAgentKey.value) ?? null,
);

// The stream the graph queries: the picked stream, or the SELECTED agent's
// source_stream. In agent mode with no agent selected there is NO valid stream —
// it must be empty, NOT `activeStream` ("default"). Falling back to "default"
// here was the bug: with no agent selected (e.g. no agents in the window) the
// graph rendered the whole `default` trace stream's service topology instead of
// an agent-scoped graph.
const effectiveStream = computed(() =>
  filterMode.value === "agent" ? (selectedAgent.value?.source_stream ?? "") : activeStream.value,
);

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
  const dt = searchObj.data.datetime;
  if (dt.type === "relative" && dt.relativeTimePeriod) {
    const r = getConsumableRelativeTime(dt.relativeTimePeriod);
    if (r) return { startTime: r.startTime, endTime: r.endTime };
  }
  return { startTime: dt.startTime, endTime: dt.endTime };
}

async function loadAgents() {
  try {
    const org = store.state.selectedOrganization.identifier;
    const { startTime, endTime } = effectiveWindow();
    const res = await genAiAgentMappingService.listAgents(org, startTime, endTime);
    agents.value = res.agents ?? [];
    // Reconcile the selection against the fresh list. Reloading (e.g. after a
    // time-range change) can return a different or empty set, which would
    // otherwise leave `activeAgentKey` pointing at an agent no longer present —
    // the dropdown then shows a stale name while the graph has no agent. Clear a
    // now-invalid key, and auto-select the first agent when none is selected.
    const keys = new Set(agents.value.map((a) => agentKey(a)));
    if (activeAgentKey.value && !keys.has(activeAgentKey.value)) {
      activeAgentKey.value = "";
    }
    if (!activeAgentKey.value && agents.value.length) {
      activeAgentKey.value = agentKey(agents.value[0]);
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
    activeAgentKey.value = "";
    activeStream.value = "";
  } finally {
    agentsLoaded.value = true;
  }
}

function applyRelative(period: string) {
  const range = getConsumableRelativeTime(period);
  if (!range) return;
  searchObj.data.datetime = {
    type: "relative",
    relativeTimePeriod: period,
    startTime: range.startTime,
    endTime: range.endTime,
  };
}

function onDateChange(value: any) {
  if (value?.valueType === "relative" && value.relativeTimePeriod) {
    applyRelative(value.relativeTimePeriod);
  } else {
    searchObj.data.datetime = {
      type: "absolute",
      relativeTimePeriod: "",
      startTime: value.startTime,
      endTime: value.endTime,
    };
  }
  loadAgents();
}

onMounted(() => {
  if (searchObj.data.datetime.type === "relative" || !searchObj.data.datetime.startTime) {
    applyRelative(searchObj.data.datetime.relativeTimePeriod || DEFAULT_RELATIVE);
  }
  loadAgents();
});
</script>
