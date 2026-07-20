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
  <!-- Page wrapper is intentionally chrome-less: KPI tiles and trend
       panels each carry their own `card-container`. Wrapping them in
       another card-container would render same-bg-on-same-bg and the
       inner cards would visually disappear (no border contrast). -->
  <div
    class="bg-transparent h-full flex flex-col px-2.5"
  >
    <!-- Toolbar: Stream/Agent mode tab (left) + the matching picker (right) —
         hidden when no streams are available. Padding lives on the toolbar +
         scroll area (not the root) so the scrollbar hugs the content-area edge
         instead of floating inside a padded box. -->
    <div
      v-if="availableStreams.length > 0"
      class="flex items-center gap-3 px-4 py-2 border-b border-border-default"
    >
      <!-- Scope control — left-aligned Stream/Agent bar directly under the
           header, matching Agent Graph / Agent Behavior / Sessions so every AI
           page places its scope selector the same way. Switching mode and
           choosing the value are one motion. On the Agent tab the stream +
           trace filter are derived from the agents API (agent.source_stream). -->
      <OToggleGroup
        :model-value="filterMode"
        type="single"
        data-test="llm-insights-filter-mode"
        @update:model-value="onFilterModeChange"
      >
        <OToggleGroupItem value="agent" size="sm">{{ t('traces.lLMInsightsDashboard.agent') }}</OToggleGroupItem>
        <OToggleGroupItem value="stream" size="sm">{{ t('traces.lLMInsightsDashboard.stream') }}</OToggleGroupItem>
      </OToggleGroup>

      <!-- Picker: Stream tab → stream picker; Agent tab → agent picker. -->
      <div
        v-if="filterMode === 'stream'"
        data-test="llm-insights-stream-selector"
        class="w-[14rem] flex-shrink-0"
      >
        <OSelect
          v-model="activeStream"
          :label="t('traces.sessionsList.streamLabel')"
          label-position="inside"
          :options="availableStreams.map((s) => ({ label: s, value: s }))"
          labelKey="label"
          valueKey="value"
          class="w-full rounded"
          @update:model-value="onStreamChange"
        />
      </div>
      <div
        v-else
        data-test="llm-insights-agent-selector"
        class="w-[14rem] flex-shrink-0"
      >
        <!-- Hold a picker-shaped skeleton until the agents list lands the first
             time, so the dropdown doesn't flash an empty "Agent" picker before
             its options exist. -->
        <SkeletonBox
          v-if="!agentsLoaded"
          width="100%"
          height="2.125rem"
          rounded
        />
        <OSelect
          v-else
          v-model="activeAgent"
          :label="t('traces.lLMInsightsDashboard.agent')"
          label-position="inside"
          :options="agentSelectOptions"
          labelKey="label"
          valueKey="value"
          class="w-full rounded"
          @update:model-value="onAgentChange"
        />
      </div>
    </div>

    <!-- Full-page skeleton only until the stream list is known. Once we have a
         stream, we fall through to the content so the trend/table panels mount
         and fire their queries immediately — in parallel with the KPI fetch,
         rather than waiting for it (the KPI strip keeps its own skeleton). -->
    <LLMInsightsSkeleton
      v-if="!streamsLoaded || switching"
      :hide-toolbar="streamsLoaded"
      class="flex-1 px-4"
    />

    <!-- Generic error state — kept separate because a failed request is a
         different signal from "no data yet". Once we have a result we fall
         through to the consolidated empty / dashboard branches below. -->
    <OEmptyState
      v-else-if="error && hasLoadedOnce"
      size="hero"
      illustration="broken-panel"
      variant="error"
      data-test="llm-insights-empty-error"
      :title="t('traces.lLMInsightsDashboard.failedToLoad')"
      :description="error || ''"
      :action-label="t('traces.lLMInsightsDashboard.retry')"
      action-icon="refresh"
      @action="loadInsights()"
    />

    <!-- Consolidated empty state — single OEmptyState covers all three
         "no data" shapes (no LLM streams in the org, the active stream has
         no gen_ai_* fields, or the time window returned nothing). The page
         doesn't expose a search/filter widget, so we never set `:filtered`
         — both the first-run and the "no data right now" cases land on
         the preset's "Instrument with OpenTelemetry" call to action. -->
    <div
      v-else-if="isEmpty"
      class="flex-1 min-h-0 flex items-center justify-center px-4"
      data-test="llm-insights-empty"
    >
      <OEmptyState
        size="hero"
        preset="no-llm-insights"
        @action="onEmptyAction"
      />
    </div>

    <!-- Agent tab with no agents in the window — its own empty state (reuses
         the same constellation illustration) rather than bare text, with a way
         back to the Stream tab. -->
    <div
      v-else-if="agentEmpty"
      class="flex-1 min-h-0 flex items-center justify-center px-4"
      data-test="llm-insights-agent-empty"
    >
      <OEmptyState
        size="hero"
        illustration="constellation"
        :title="t('traces.lLMInsightsDashboard.noAgentsInRange')"
        :description="t('traces.lLMInsightsDashboard.noAgentsDescription')"
        :action-label="t('traces.lLMInsightsDashboard.viewByStream')"
        @action="onFilterModeChange('stream')"
      />
    </div>

    <!-- Dashboard content — scrollable panel area. Horizontal padding lives
         here (inside the scroll container) so the scrollbar sits at the
         content-area edge with content padded away from it. -->
    <div v-else class="flex-1 overflow-y-auto px-4 pb-3">
      <!-- KPI strip: keep a skeleton until the first KPI result lands so the
           cards never flash zeros. The panels below render regardless, so
           their queries fire in parallel with the KPI fetch. -->
      <LLMInsightsSkeleton
        v-if="loading || !hasLoadedOnce"
        kpi-only
        class="mt-[0.625rem] mb-[0.625rem]"
      />
      <!-- KPI Cards Row -->
      <div
        v-else
        class="grid grid-cols-5 gap-[0.625rem] mt-[0.625rem] mb-[0.625rem]"
      >
        <div
          v-for="card in kpiCards"
          :key="card.label"
          class="card-container rounded-lg flex flex-col px-3.5 pt-2.5 pb-2.5 gap-1 bg-(--color-surface-base) border border-(--color-border-default) transition-shadow duration-200 hover:shadow-[0_1px_6px_rgba(0,0,0,0.08)]"
        >
          <!-- P95 rides its own (slower) query — skeleton the WHOLE card while
               it loads, matching the initial strip skeleton tile (see
               LLMInsightsSkeleton). Its sparkline comes from the histogram, but
               showing a chart before the number reads as ready, so we hold both. -->
          <template v-if="card.loading">
            <div class="flex flex-col gap-[0.25rem]">
              <SkeletonBox width="60%" height="12px" rounded />
              <SkeletonBox width="55%" height="22px" rounded />
            </div>
            <div class="flex items-end gap-[0.15rem] h-[32px] mt-auto">
              <SkeletonBox
                v-for="bar in 16"
                :key="bar"
                width="100%"
                :height="`${30 + ((bar * 23) % 65)}%`"
                rounded
              />
            </div>
          </template>
          <template v-else>
            <div class="flex flex-col gap-[0.25rem]">
              <div class="flex items-center justify-between gap-2 mb-[0.25rem]">
                <div class="text-[0.7rem] leading-normal font-semibold text-(--color-text-secondary) min-w-0 truncate">
                  {{ card.label }}
                </div>
                <span
                  class="inline-flex items-center justify-center shrink-0 w-6 h-6 rounded-md bg-(--color-surface-subtle) text-(--color-text-secondary)"
                >
                  <OIcon :name="card.icon" size="sm" />
                </span>
              </div>
              <div class="flex items-baseline gap-[0.2rem]">
                <span class="text-[1.4rem] font-bold leading-none text-(--color-grey-600)">
                  {{ card.value }}
                </span>
                <span
                  v-if="card.unit"
                  class="text-[0.8rem] font-semibold text-(--color-text-secondary)"
                >
                  {{ card.unit }}
                </span>
              </div>
            </div>
            <KpiSparkline
              v-if="card.sparkData && card.sparkData.length > 1"
              :data="card.sparkData"
              :color="card.sparkColor"
              :height="32"
              class="mt-auto"
            />
          </template>
        </div>
      </div>

      <!-- Trend panels (config-driven). The key carries the panel-cache id
           (stream + agent + window), so changing tab / agent / time range
           REMOUNTS each panel. That remount is deliberate: PanelSchemaRenderer
           only consults its IndexedDB cache on mount (runCount === 0), so a
           remount is what lets it restore an already-fetched result instead of
           re-querying. Same selection + window → instant cache hit; a new one →
           a clean miss that fetches. -->
      <div class="grid grid-cols-2 gap-[0.625rem]">
        <div
          v-for="panel in LLM_INSIGHTS_PANELS"
          :key="`${panel.id}::${panelCacheDashboardId}`"
          :class="panel.layout.colSpan === 2 ? 'col-span-2' : ''"
        >
          <!-- Table panels use OTable (interactive, app-navigation) — matches
               the other AI Observability tables; every chart panel renders
               through the shared dashboards engine (PanelSchemaRenderer). -->
          <LLMErrorTable
            v-if="panel.type === 'table'"
            :panel="panel"
            :streamName="effectiveStream"
            :startTime="startTime"
            :endTime="endTime"
            :agent-filter="agentFilterClause"
            :cache-key="panelCacheDashboardId"
            @view-trace="onViewTrace"
          />
          <LLMSchemaPanel
            v-else
            :panel="panel"
            :streamName="effectiveStream"
            :startTime="startTime"
            :endTime="endTime"
            :agent-filter="agentFilterClause"
            :dashboard-id="panelCacheDashboardId"
            :folder-id="PANEL_CACHE_FOLDER"
          />
        </div>
      </div>

      <!-- Agent behavior signals (loops / failure taxonomy) moved to their own
           dedicated "Agent Behavior" page under Monitor. LLM Insights keeps the
           cost/latency/error story; behavior lives beside Agent Graph. -->
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useLLMInsights } from "./composables/useLLMInsights";
import {
  splitNumberWithUnit,
  splitDuration,
  splitCost,
} from "./llmInsightsDashboard.utils";
import KpiSparkline from "./KpiSparkline.vue";
import LLMSchemaPanel from "./LLMSchemaPanel.vue";
import LLMErrorTable from "./LLMErrorTable.vue";
import LLMInsightsSkeleton from "./LLMInsightsSkeleton.vue";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { LLM_INSIGHTS_PANELS } from "./config/llmInsightsPanels";
import { kpiCache, selectionKey } from "./llmInsightsCache";
import useStreams from "@/composables/useStreams";
import genAiAgentMappingService, {
  type GenAiAgentListItem,
} from "@/services/gen-ai-agent-mapping.service";
import {
  ALL_AGENTS_VALUE,
  agentOptionKey,
  buildAgentTraceFilter,
} from "./llmAgentFilter";

const { getStreams } = useStreams();
const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const store = useStore();

// Initial filter selection precedence: URL query (deep link / shareable) >
// localStorage (last used) > default. Read once at setup; we write the URL
// back on every change via syncFilterUrl().
const urlType = typeof route.query.type === "string" ? route.query.type : "";
const urlStream = typeof route.query.stream === "string" ? route.query.stream : "";
const urlAgentName = typeof route.query.agent === "string" ? route.query.agent : "";

interface Props {
  streamName: string;
  startTime: number; // microseconds
  endTime: number; // microseconds
}

const props = defineProps<Props>();

// --- Stream selection (mirrors ServiceGraph's pattern) ---
const STREAM_LS_KEY = "llmInsights_streamFilter";

const {
  kpi,
  sparklines,
  loading,
  p95Loading,
  error,
  fetchAll,
  cancelAll,
  hasLoadedOnce,
  availableStreams,
  streamsLoaded,
} = useLLMInsights();

// activeStream is component-local (drives the q-select v-model), but its
// initial value falls back to localStorage / parent prop. Once the streams
// list is reconciled, it's clamped to a valid option.
const activeStream = ref<string>(
  urlStream || localStorage.getItem(STREAM_LS_KEY) || props.streamName || "",
);
const AGENT_LS_KEY = "llmInsights_agentFilter";
const activeAgent = ref<string>(localStorage.getItem(AGENT_LS_KEY) || ALL_AGENTS_VALUE);
const agents = ref<GenAiAgentListItem[]>([]);
// True once the agents API has resolved at least once — lets us tell "agents
// not loaded yet" apart from "this window genuinely has no agents".
const agentsLoaded = ref(false);

// True while a user-driven switch (clicking the Agent tab or changing the agent)
// is resolving — the agents list fetch happens BEFORE the KPI fetch flips
// `loading`, so without this the page would show stale stream data during that
// gap. We show the full skeleton instead so the switch feels immediate.
const switching = ref(false);

// Filter mode: "stream" = view a whole stream; "agent" = view a single agent,
// whose source stream + trace filter both come from the agents API.
const MODE_LS_KEY = "llmInsights_filterMode";
// Default scope is "agent" — the AI module is agent-centric. Explicit choices
// still win: a `?type=` URL param, then a saved localStorage preference; only
// when neither is present do we fall back to the agent default.
const filterMode = ref<"stream" | "agent">(
  urlType === "agent"
    ? "agent"
    : urlType === "stream"
      ? "stream"
      : localStorage.getItem(MODE_LS_KEY) === "stream"
        ? "stream"
        : "agent",
);
// An agent name from the URL we still need to resolve to a concrete agent once
// the agents list loads (the URL carries the readable name, not the internal
// stream-scoped key).
const pendingAgentName = ref<string | null>(
  filterMode.value === "agent" && urlAgentName ? urlAgentName : null,
);

// Agent-tab dropdown: individual agents only (no "All Agents" — whole-stream
// viewing lives on the Stream tab). Keyed by stream-scoped identity (spec §8),
// not display name, so same-named agents in different streams don't collide.
const agentSelectOptions = computed(() =>
  agents.value.map((agent) => ({
    label: agent.id ? `${agent.name} (${agent.id})` : agent.name,
    value: agentOptionKey(agent),
  })),
);

// The full agent object behind the current selection (null when none).
const selectedAgent = computed<GenAiAgentListItem | null>(() => {
  if (activeAgent.value === ALL_AGENTS_VALUE) return null;
  return (
    agents.value.find((a) => agentOptionKey(a) === activeAgent.value) ?? null
  );
});

// The effective stream + agent the whole dashboard queries on:
//  - Stream tab → the picked stream, no agent.
//  - Agent tab  → the selected agent's source stream + the agent itself
//    (→ direct canonical-agent filter). Deriving the stream from the agent is the whole
//    point: we don't ask the user to pick a stream AND an agent separately.
const effectiveStream = computed(() =>
  filterMode.value === "agent"
    ? (selectedAgent.value?.source_stream ?? "")
    : activeStream.value,
);
const effectiveAgent = computed<GenAiAgentListItem | null>(() =>
  filterMode.value === "agent" ? selectedAgent.value : null,
);
const agentFilterClause = computed(() =>
  buildAgentTraceFilter(effectiveAgent.value, effectiveStream.value),
);

// --- Panel result cache (the dashboards IndexedDB cache) --------------------
// PanelSchemaRenderer restores a panel's data from IndexedDB on mount and skips
// the query when the cache key matches — the same mechanism the Dashboards page
// uses to survive panel remounts. It's keyed `folderId:dashboardId:panelId` and
// is a no-op unless all three are non-empty (usePanelCache), so we mint a
// stable, scoped identity for our panels:
//   folder      → one constant bucket for this whole page.
//   dashboardId → stream + agent + exact time window, so a different selection
//                 or a new window is a clean miss (fresh fetch) while the same
//                 one is a hit. Built from the agent NAME, never the SQL filter,
//                 so no query text leaks into ids/URLs.
//   panelId     → the schema's `llm-<panel.id>` (set in buildLLMPanelSchema).
//
// This SAME id is the canonical "which selection are we looking at" key for the
// whole page: it's the panel dashboardId, the KPI cache key, AND the error
// table's cache key (passed down as a prop) — so all three caches agree on one
// identity instead of each deriving its own. `agentKey` is the agent's name, or
// a placeholder when there's no agent (`_stream` on the Stream tab, `_none` on
// the Agent tab before one resolves) — handled here, in one place.
const PANEL_CACHE_FOLDER = "ai-llm-insights";
const panelCacheDashboardId = computed(() => {
  const agentKey =
    filterMode.value === "agent"
      ? (effectiveAgent.value?.name ?? "_none")
      : "_stream";
  return selectionKey(
    effectiveStream.value,
    agentKey,
    props.startTime,
    props.endTime,
  );
});
// PanelSchemaRenderer (via its annotation composable) calls getDashboard() on
// mount, which hits the network for any dashboardId not already in the Vuex
// store. Our id is synthetic and never loaded, so without help every panel
// mount would fire a GET /dashboards/<id>. Seeding a tiny empty-dashboard stub
// makes getDashboard a store lookup instead — no request, no SQL in the URL.
// Direct assignment (not the setDashboardData action) on purpose: that action
// REPLACES the whole map and would evict real dashboards. Empty `tabs` means
// getDashboard's duplicate-panel-id repair can't fire, so it never saves.
// A *synchronous* watcher seeds the stub the instant the id changes — before
// any render — so it wins the race against the panel's onMounted even on the
// Agent tab, whose id settles through several intermediate values during the
// async agent lookup (each of which would otherwise remount a panel and fire
// its own getDashboard).
function ensurePanelCacheStub(id: string) {
  const all = store.state.organizationData?.allDashboardData;
  if (all && id && !all[id]) {
    all[id] = {
      title: "",
      dashboardId: id,
      tabs: [],
      variables: { list: [] },
      version: 5,
    };
  }
}
watch(panelCacheDashboardId, (id) => ensurePanelCacheStub(id), {
  immediate: true,
  flush: "sync",
});

// Agent tab is open but the agents API returned none for this window — drives a
// dedicated empty state (vs. the generic "no LLM data" one). Only true once the
// list has actually loaded, so we don't flash it before the first fetch.
const agentEmpty = computed(
  () =>
    filterMode.value === "agent" &&
    agentsLoaded.value &&
    agents.value.length === 0,
);

// Reflect the current filter in the URL so the view is shareable / survives a
// reload: `?type=stream&stream=<name>` or `?type=agent&agent=<name>`. We keep
// the readable name (not the internal agent key) and preserve other params
// (e.g. the time range owned by the parent).
function syncFilterUrl() {
  const query: Record<string, any> = { ...route.query, type: filterMode.value };
  if (filterMode.value === "agent") {
    delete query.stream;
    if (selectedAgent.value?.name) query.agent = selectedAgent.value.name;
    else delete query.agent;
  } else {
    delete query.agent;
    if (activeStream.value) query.stream = activeStream.value;
    else delete query.stream;
  }
  // replace (not push) — filter tweaks shouldn't pile up in browser history.
  router.replace({ query }).catch(() => {});
}

function onViewTrace(traceId: string) {
  if (!traceId) return;
  router.push({
    name: "traceDetails",
    query: {
      stream: effectiveStream.value,
      trace_id: traceId,
      from: props.startTime,
      to: props.endTime,
      org_identifier: store.state.selectedOrganization?.identifier,
    },
  });
}

// Load the trace-stream list at most once per mount. Both the initial mount
// and the (parent-driven) insights load await the SAME promise, so a load can
// neither race ahead of the stream list nor trigger a second stream fetch.
let streamsPromise: Promise<void> | null = null;
function ensureStreamsLoaded(): Promise<void> {
  if (!streamsPromise) streamsPromise = loadTraceStreams();
  return streamsPromise;
}

async function loadTraceStreams() {
  streamsLoaded.value = false;
  try {
    const res = await getStreams("traces", false, false);
    const list = res?.list || [];
    const llmStreams = list.filter(
      (stream: any) => stream?.settings?.is_llm_stream !== false,
    );
    availableStreams.value = llmStreams.map((stream: any) => stream.name);
    if (!availableStreams.value.includes(activeStream.value)) {
      activeStream.value = availableStreams.value[0] || "";
    }
  } catch (e) {
    console.error("Error loading trace streams:", e);
    availableStreams.value = [];
    activeStream.value = "";
  } finally {
    streamsLoaded.value = true;
  }
}

// The window the agent list was last loaded for. The agents API is scoped to a
// time range, so the list only needs refreshing when that window changes — not
// on every tab toggle. Guarding on this kills a redundant /gen_ai/agents call
// per toggle.
let agentsLoadedWindow = "";
async function loadAgents(startTime?: number, endTime?: number) {
  const orgId = store.state.selectedOrganization?.identifier;
  const start = startTime ?? props.startTime;
  const end = endTime ?? props.endTime;
  if (!orgId || !start || !end) return;
  const windowKey = `${start}-${end}`;
  if (agentsLoaded.value && agentsLoadedWindow === windowKey) return;
  try {
    const agentList = await genAiAgentMappingService.listAgents(orgId, start, end);
    agents.value = agentList.agents;
    agentsLoadedWindow = windowKey;
    // Proactively seed the panel-cache stub for every selection at this window —
    // the Stream tab plus each agent. A cold tab/agent switch can mount the
    // panels before the per-id sync watcher fires, so pre-seeding here (right
    // after the list resolves, before any switch) closes that race and keeps
    // getDashboard a store lookup in every case.
    ensurePanelCacheStub(`${activeStream.value}::_stream::${start}-${end}`);
    for (const agent of agents.value) {
      ensurePanelCacheStub(
        `${agent.source_stream}::${agent.name}::${start}-${end}`,
      );
    }
    if (
      activeAgent.value !== ALL_AGENTS_VALUE &&
      !agents.value.some((agent) => agentOptionKey(agent) === activeAgent.value)
    ) {
      activeAgent.value = ALL_AGENTS_VALUE;
    }
  } catch (e) {
    console.warn("Failed to load GenAI agents", e);
    agents.value = [];
    activeAgent.value = ALL_AGENTS_VALUE;
  } finally {
    agentsLoaded.value = true;
  }
}

const hasData = computed(() => kpi.value.requestCount > 0);

// DataFusion returns "Schema error: No field named gen_ai_..." when the
// chosen stream lacks LLM instrumentation. Detect that specific case so we
// can show a friendly empty state instead of the generic error fallback.
const streamHasNoLLMFields = computed(() => {
  if (!error.value) return false;
  const msg = String(error.value);
  return /No field named\s+gen_ai_/i.test(msg);
});

// Drives the consolidated OEmptyState branch in the template. True for any
// shape of "no LLM data right now": no LLM streams in the org, the active
// stream has no gen_ai_* fields, or the load completed and the KPI rollup
// came back empty. The dashboard's KPI tiles + trend panels render only
// when this is false — so we never show "0" tiles next to empty charts.
//
// The "empty KPI" clause is gated on `!loading`: a refresh resets the KPI to
// EMPTY_KPI before the new result lands, so without this guard the empty state
// would flash mid-refresh (hasData briefly false while a fetch is in flight).
const isEmpty = computed<boolean>(
  () =>
    streamsLoaded.value &&
    (availableStreams.value.length === 0 ||
      streamHasNoLLMFields.value ||
      (hasLoadedOnce.value && !hasData.value && !loading.value)),
);

// The empty-state action card emits its `id` here. `instrument` routes to
// the in-app AI integrations page (OpenTelemetry / Gen-AI guides) — the
// closest thing we have to a "set this up" landing surface and keeps the
// user inside the product instead of bouncing to docs.
function onEmptyAction(id?: string) {
  if (id !== "instrument") return;
  router.push({
    name: "ai-integrations",
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
    },
  });
}

interface KpiCard {
  label: string;
  /** Material-symbol icon name (OIcon) shown in the card's corner tile. */
  icon: string;
  value: string;
  unit?: string;
  sparkData?: number[];
  sparkColor?: string;
  // True while this card's own value is still loading (P95 only — it rides a
  // separate query). The histogram-backed cards are ready when the strip is.
  loading?: boolean;
}

const kpiCards = computed<KpiCard[]>(() => {
  const tokens = splitNumberWithUnit(kpi.value.totalTokens);
  const traces = splitNumberWithUnit(kpi.value.traceCount);
  const p95 = splitDuration(kpi.value.p95DurationMicros);
  const errorRate =
    kpi.value.traceCount > 0
      ? (kpi.value.errorCount / kpi.value.traceCount) * 100
      : 0;

  // Cost comes straight from SUM(gen_ai_usage_cost) on the KPI summary.
  // If it's 0, either there are no LLM spans in the window or the SDK
  // isn't emitting cost; either way we render "$0".
  const costCard: KpiCard = {
    label: t('traces.lLMInsightsDashboard.totalCost'),
    icon: "payments",
    ...splitCost(kpi.value.totalCost),
    sparkData: sparklines.value.cost,
    sparkColor: "#0ea5e9",
  };

  return [
    costCard,
    {
      label: t('traces.lLMInsightsDashboard.totalTokens'),
      icon: "tag",
      value: tokens.value,
      unit: tokens.unit,
      sparkData: sparklines.value.tokens,
      sparkColor: "#a855f7",
    },
    {
      label: t('traces.lLMInsightsDashboard.totalTraces'),
      icon: "account-tree",
      value: traces.value,
      unit: traces.unit,
      sparkData: sparklines.value.traces,
      sparkColor: "#3b82f6",
    },
    {
      label: t('traces.lLMInsightsDashboard.p95Latency'),
      icon: "schedule",
      value: p95.value,
      unit: p95.unit,
      sparkData: sparklines.value.p95Micros,
      sparkColor: "#f97316",
      loading: p95Loading.value,
    },
    {
      label: t('traces.lLMInsightsDashboard.errorRate'),
      icon: "error",
      value: errorRate.toFixed(1),
      unit: "%",
      sparkData: sparklines.value.errorRate,
      sparkColor: "#ef4444",
    },
  ];
});

// The KPI strip is dashboard-owned (fetched by useLLMInsights), so it can't ride
// the chart panels' IndexedDB cache. `kpiCache` (shared module singleton — see
// llmInsightsCache.ts) is its in-memory equivalent, keyed by the same
// stream+agent+window scope and restored on a tab toggle / same-window revisit.
function kpiCacheKey(start: number, end: number): string {
  const agentKey =
    filterMode.value === "agent"
      ? (effectiveAgent.value?.name ?? "_none")
      : "_stream";
  return selectionKey(effectiveStream.value, agentKey, start, end);
}

// Single fetch entry point. Always pulls from the current props (which the
// parent keeps in sync via `recomputeInsightsTimeRange`). Stream selector
// changes, refresh button, and onMounted all funnel through here. `force`
// (manual refresh) bypasses the KPI cache and pulls fresh numbers.
async function loadInsights(
  startTime?: number,
  endTime?: number,
  opts?: { force?: boolean },
) {
  try {
    const force = opts?.force ?? false;
    const start = startTime ?? props.startTime;
    const end = endTime ?? props.endTime;
    if (!start || !end) return;
    localStorage.setItem(MODE_LS_KEY, filterMode.value);

    // Stream-mode reads `effectiveStream` from `activeStream`, which is only set
    // once the stream list loads — so make sure that's done before we fetch,
    // regardless of whether this call raced ahead of the mount's stream load.
    await ensureStreamsLoaded();

    if (filterMode.value === "agent") {
      // Agent tab can't fetch until it knows the agent's source stream, so the
      // agents list must be loaded first — await it here. (Agents API is only
      // ever hit on the Agent tab.)
      await loadAgents(start, end);
      // Resolve an agent name carried in the URL to its concrete (stream-scoped)
      // selection now that the list exists.
      if (pendingAgentName.value) {
        const match = agents.value.find(
          (a) => a.name === pendingAgentName.value,
        );
        if (match) activeAgent.value = agentOptionKey(match);
        pendingAgentName.value = null;
      }
      // Default to the first agent when nothing valid is selected (fresh entry
      // to the tab, or the previously-picked agent is gone for this window).
      if (!selectedAgent.value && agents.value.length > 0) {
        activeAgent.value = agentOptionKey(agents.value[0]);
      }
      localStorage.setItem(AGENT_LS_KEY, activeAgent.value);
    } else {
      // Agents API is only relevant on the Agent tab — don't touch it in Stream
      // mode. The list loads lazily when the user switches to the Agent tab.
      localStorage.setItem(STREAM_LS_KEY, activeStream.value);
    }

    // Keep the URL in step with the resolved selection (runs even when there's
    // nothing to query, e.g. the Agent tab with no agents).
    syncFilterUrl();

    // Stream comes from the agent (Agent tab) or the picker (Stream tab).
    const stream = effectiveStream.value;
    if (!stream) return;

    // Per-selection KPI retention: restore the summary numbers for this exact
    // stream+agent+window instead of refetching on a tab toggle. `force`
    // (manual refresh) skips the cache.
    const ck = kpiCacheKey(start, end);
    if (!force && kpiCache.has(ck)) {
      const snap = kpiCache.get(ck)!;
      kpi.value = snap.kpi;
      sparklines.value = snap.sparklines;
      lastRunAt.value = snap.lastRunAt;
      error.value = null; // restoring a prior success — drop any stale error
      hasLoadedOnce.value = true; // we have data → no first-load skeleton
      return;
    }

    await fetchAll(stream, start, end, effectiveAgent.value);
    // `loading` true→false already stamped lastRunAt via the watcher; snapshot
    // the fresh result so returning to this selection skips the network.
    if (!error.value) {
      kpiCache.set(ck, {
        kpi: kpi.value,
        sparklines: sparklines.value,
        lastRunAt: lastRunAt.value,
      });
    }
  } finally {
    // The switch is resolved (data ready, or we bailed early) — drop the switch
    // skeleton. Any in-flight KPI/panel fetch keeps its own skeleton from here.
    switching.value = false;
  }
}

function onFilterModeChange(mode?: string | number | null) {
  const next = mode === "agent" ? "agent" : "stream";
  if (next === filterMode.value) return;
  filterMode.value = next;
  // Entering the Agent tab fetches the agents list before any KPI fetch — show
  // the skeleton for that whole stretch so the switch is immediate, not stale.
  if (next === "agent") switching.value = true;
  loadInsights();
}

function onStreamChange() {
  loadInsights();
}

function onAgentChange() {
  switching.value = true;
  loadInsights();
}

// Parent calls this on Run Query / Refresh / date-range change, passing
// the freshly computed start/end so we don't have to wait for Vue's
// next-tick prop propagation.
async function refresh(startTime?: number, endTime?: number) {
  await loadInsights(startTime, endTime, { force: true });
}

// "Last refreshed" timestamp for the whole-page refresh indicator. Stamped when
// the KPI fetch settles (loading true→false), mirroring how the Logs page keys
// its single last-refresh off `searchObj.loading`. Exposed to the page header,
// which renders it via ORefreshButton.
const lastRunAt = ref<number | null>(null);
watch(loading, (isLoading, wasLoading) => {
  if (wasLoading && !isLoading) lastRunAt.value = Date.now();
});

defineExpose({ refresh, lastRunAt, loading });

onMounted(() => {
  // Only kick off the stream-list load here. The insights fetch is driven by the
  // parent (its DateTime fires an initial `on:date-change` on mount, plus the
  // refresh button) — a single owner, so we don't double-fetch on load.
  ensureStreamsLoaded();
});

// Cancel any in-flight stream queries when the dashboard goes away
// (tab switch, org switch, full page nav). Without this, the server
// keeps streaming results to a component that's no longer there and
// the user pays for work they don't see.
onUnmounted(() => {
  cancelAll();
});
</script>
