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
       panels each carry their own `bg-card-glass-bg`. Wrapping them in
       another bg-card-glass-bg would render same-bg-on-same-bg and the
       inner cards would visually disappear (no border contrast). -->
  <div class="flex h-full flex-col bg-transparent">
    <!-- Toolbar: Stream/Agent mode tab (left) + the matching picker (right) —
         hidden when no streams are available. Padding lives on the toolbar +
         scroll area (not the root) so the scrollbar hugs the content-area edge
         instead of floating inside a padded box. -->
    <!-- Shared scope control — left-aligned Stream/Agent bar directly under the
         header, matching Agent Graph / Agent Behavior / Sessions so every AI page
         places its scope selector the same way. The outer guard (no bar until we
         know there ARE streams) stays here, wrapping the component. agentSkeleton
         holds a picker-shaped skeleton until the agents list first lands;
         solidAgentTrigger keeps the "All Agents" empty state in solid text. -->
    <AiScopeBar
      v-if="availableStreams.length > 0 && scopeReady"
      :filter-mode="filterMode"
      v-model:active-stream="activeStream"
      v-model:selected-env="selectedEnv"
      v-model:selected-agent-name="selectedAgentName"
      v-model:selected-version="selectedVersion"
      data-test="llm-insights"
      all-agents
      agent-skeleton
      :show-agent-toggle="genAiAgentMappingAccess.allowed"
      :agent-toggle-locked-message="
        !genAiAgentMappingAccess.allowed ? genAiAgentMappingAccess.message : undefined
      "
      :show-version="!compareMode"
      :labels="{
        agent: t('traces.lLMInsightsDashboard.agent'),
        stream: t('traces.lLMInsightsDashboard.stream'),
        streamLabel: t('traces.sessionsList.streamLabel'),
        allAgents: t('traces.allAgents'),
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
      @stream-change="onStreamChange"
    >
      <template #trailing>
        <!-- Enter compare: only offered when the selected agent actually has ≥2
             versions to compare. A disabled button reads as "broken"; hiding the
             affordance when it can't apply is cleaner (ui-architect empty-affordance
             rule). The tooltip explains the concept when the entry IS available. -->
        <OTooltip
          v-if="genAiAgentMappingAccess.allowed && canCompare && !compareMode"
          :content="t('traces.lLMInsightsDashboard.compareEntryHint')"
        >
          <OButton
            variant="outline"
            size="sm"
            icon-left="compare-arrows"
            data-test="llm-insights-compare-entry"
            @click="enterCompareMode"
          >
            {{ t("traces.lLMInsightsDashboard.compareEntry") }}
          </OButton>
        </OTooltip>
        <!-- OSS can't reach Agent mode at all, so `canCompare` (which needs
             real agent-version data) is never meaningful here — show the
             entry locked instead of hiding it, same treatment as the Agent
             toggle above. -->
        <template v-else-if="!genAiAgentMappingAccess.allowed && !compareMode">
          <OButton
            variant="outline"
            size="sm"
            icon-left="compare-arrows"
            data-test="llm-insights-compare-locked"
            @click="openUpgradeDialog"
          >
            <template #icon-right
              ><OIcon name="lock" size="sm" class="text-warning-600"
            /></template>
            {{ t("traces.lLMInsightsDashboard.compareEntry") }}
          </OButton>
        </template>
        <!-- Exit compare lives in the SAME spot as the enter affordance, so the
             two toggle in place — the user leaves compare where they entered it. -->
        <OButton
          v-else-if="compareMode"
          variant="outline"
          size="sm"
          icon-left="close"
          data-test="llm-insights-compare-exit"
          @click="exitCompareMode"
        >
          {{ t("aiObservability.versionCompare.bar.exit") }}
        </OButton>
      </template>
    </AiScopeBar>

    <!-- Stream mode because these LLM spans carry no agent identity: say so and
         link to GenAI Agent Mapping. Not over the first-run empty state, which
         already says what is missing. -->
    <AiNoAgentIdentityBanner
      v-if="noAgentIdentity && scopeReady && !isEmpty"
      data-test="llm-insights"
    />

    <VersionCompareView
      v-if="genAiAgentMappingAccess.allowed && compareMode"
      :version-list="compareVersionList"
      :stream="effectiveStream"
      :windows="versionCompare.windows.value"
      :result="versionCompare.result.value"
      :error-diff="versionCompare.errorDiff.value"
      :sparklines-a="versionCompare.sparklinesA.value"
      :sparklines-b="versionCompare.sparklinesB.value"
      :sampled-note="versionCompare.sampledNote.value"
      :loading="versionCompare.loadingA.value || versionCompare.loadingB.value"
      class="flex-1 overflow-y-auto pb-3"
      data-test="llm-insights-compare-view"
      @exit="exitCompareMode"
      @run="onCompareRun"
    />

    <!-- Single-select dashboard body — hidden entirely while compareMode is
         ON (VersionCompareView renders in its place above). Grouped under one
         `<template>` so the v-if/v-else-if chain across skeleton / error /
         empty states / dashboard content stays intact without adding a DOM
         wrapper node. -->
    <template v-if="!compareMode">
      <!-- Full-page skeleton until the stream list is known and the first load
         has settled the mode and the selection (agents list included). The
         panels then mount once, with the final scope, and fire their queries
         in parallel with the KPI fetch (the KPI strip keeps its own skeleton).
         Mounting them earlier meant a mode or agent flip remounted them and
         cancelled their in-flight queries. -->
      <LLMInsightsSkeleton
        v-if="!streamsLoaded || !scopeReady || switching"
        :hide-toolbar="streamsLoaded && scopeReady"
        class="px-page-edge flex-1"
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
        :description="raw(error || '')"
        :action-label="t('traces.lLMInsightsDashboard.retry')"
        action-id="retry"
        action-icon="refresh"
        @action="loadInsights()"
      />

      <!-- Agent tab whose agents list failed to load: not "no agents". -->
      <div
        v-else-if="agentsLoadFailed"
        class="px-page-edge flex min-h-0 flex-1 items-center justify-center"
      >
        <AiAgentsLoadError
          :error="agentsError ?? 'failed'"
          data-test="llm-insights"
          @retry="loadInsights(undefined, undefined, { force: true })"
        />
      </div>

      <!-- Consolidated empty state — single OEmptyState covers all three
         "no data" shapes (no LLM streams in the org, the active stream has
         no gen_ai_* fields, or the time window returned nothing). The page
         doesn't expose a search/filter widget, so we never set `:filtered`.
         Its actions open a specific integration guide: the one whose docs
         page the user came from (first), the coding-agent setup, then all
         integrations, with the most-read guides as chips underneath. -->
      <div
        v-else-if="isEmpty"
        class="px-page-edge flex min-h-0 flex-1 items-center justify-center"
        data-test="llm-insights-empty"
      >
        <OEmptyState
          size="hero"
          preset="no-llm-insights"
          :actions="emptyStateActions"
          @action="onEmptyAction"
        >
          <template #extra>
            <div
              class="flex flex-wrap items-center justify-center gap-2"
              data-test="llm-insights-empty-integrations"
            >
              <span class="text-text-secondary text-compact">
                {{ t("emptyState.noLLMInsights.startFrom") }}
              </span>
              <EmptyStateIngestionChip
                v-for="integration in popularIntegrations"
                :key="integration.routeName"
                :data-test="`o2-empty-state-action-integration-${integration.slug}`"
                :data-empty-state-action="`integration-${integration.slug}`"
                @click="onEmptyAction(`integration-${integration.slug}`)"
              >
                <img
                  v-if="integration.logo"
                  :src="integration.logo"
                  alt=""
                  class="size-3.5 shrink-0 object-contain"
                />
                {{ integration.name }}
              </EmptyStateIngestionChip>
            </div>
          </template>
        </OEmptyState>
      </div>

      <!-- Agent tab with no agents in the window — its own empty state (reuses
         the same constellation illustration) rather than bare text, with a way
         back to the Stream tab. -->
      <div
        v-else-if="agentEmpty"
        class="px-page-edge flex min-h-0 flex-1 items-center justify-center"
        data-test="llm-insights-agent-empty"
      >
        <OEmptyState
          size="hero"
          illustration="constellation"
          :title="t('traces.lLMInsightsDashboard.noAgentsInRange')"
          :description="t('traces.lLMInsightsDashboard.noAgentsDescription')"
          :action-label="t('traces.lLMInsightsDashboard.viewByStream')"
          action-id="view-by-stream"
          @action="onFilterModeChange('stream')"
        />
      </div>

      <!-- Dashboard content — scrollable panel area. Horizontal padding lives
         here (inside the scroll container) so the scrollbar sits at the
         content-area edge with content padded away from it. -->
      <div v-else class="px-page-edge flex-1 overflow-y-auto pb-3">
        <!-- AI data health (AIO-17): between the scope bar and the KPI tiles;
           hidden when every check passes. -->
        <LLMDataHealthStrip
          :health="dataHealth"
          :loading="dataHealthLoading"
          :error="dataHealthError"
          :stream="effectiveStream"
          :samples="dataHealthSamples"
          :samples-loading="dataHealthSamplesLoading"
          @rerun="loadDataHealth(true)"
          @load-samples="fetchSamples"
          @view-trace="onViewTrace"
        />
        <!-- KPI strip: keep a skeleton until the first KPI result lands so the
           cards never flash zeros. The panels below render regardless, so
           their queries fire in parallel with the KPI fetch. -->
        <LLMInsightsSkeleton v-if="loading || !hasLoadedOnce" kpi-only class="mb-2.5" />
        <!-- KPI Cards Row -->
        <KpiCardRow v-else :columns="5" class="mt-2.5 mb-2.5">
          <div
            v-for="card in kpiCards"
            :key="card.label"
            class="bg-card-glass-bg rounded-default border-border-default flex min-w-0 flex-col gap-1 border px-3.5 py-2.5 max-lg:shrink-0 max-lg:basis-auto max-lg:gap-0.5 max-lg:px-2 max-lg:py-1.5"
          >
            <!-- P95 rides its own (slower) query — skeleton the WHOLE card while
               it loads, matching the initial strip skeleton tile (see
               LLMInsightsSkeleton). Its sparkline comes from the histogram, but
               showing a chart before the number reads as ready, so we hold both. -->
            <template v-if="card.loading">
              <div class="mb-1 flex items-center justify-between gap-2">
                <OSkeleton type="text" class="h-3 w-[60%]" />
                <OSkeleton type="text" class="h-6 w-6 shrink-0" />
              </div>
              <OSkeleton type="text" class="h-6 w-[55%]" />
            </template>
            <template v-else>
              <!-- The label stays visible at every width; a compact tile
                 without it is a bare number. -->
              <div class="flex flex-col gap-1 max-lg:gap-0.5">
                <div class="mb-1 flex items-center justify-between gap-2 max-lg:mb-0">
                  <OTruncatedText
                    as="div"
                    class="text-2xs text-text-secondary leading-normal font-semibold"
                  >
                    {{ card.label }}
                  </OTruncatedText>
                  <span
                    class="rounded-default bg-surface-subtle text-text-secondary inline-flex h-6 w-6 shrink-0 items-center justify-center"
                  >
                    <OIcon :name="card.icon" size="sm" />
                  </span>
                </div>
                <div class="flex items-baseline gap-[0.2rem]" data-test="llm-insights-kpi-value">
                  <span
                    v-if="card.prefix"
                    class="text-text-secondary text-lg leading-none font-bold max-lg:text-base"
                    >{{ card.prefix }}</span
                  >
                  <span class="text-text-secondary text-2xl leading-none font-bold max-lg:text-lg">
                    {{ card.value }}
                  </span>
                  <span v-if="card.unit" class="text-compact text-text-secondary font-semibold">
                    {{ card.unit }}
                  </span>
                </div>
                <button
                  v-if="card.note"
                  type="button"
                  class="text-2xs text-status-warning-text self-start text-left underline-offset-2 hover:underline"
                  :title="card.noteTooltip"
                  data-test="llm-insights-cost-unpriced"
                  @click="openUnpricedTab"
                >
                  {{ card.note }}
                </button>
              </div>
              <KpiSparkline
                v-if="card.sparkData && card.sparkData.length > 1"
                :data="card.sparkData"
                :color="card.sparkColor"
                :height="32"
                class="mt-auto max-lg:hidden"
              />
            </template>
          </div>
        </KpiCardRow>

        <!-- Trend panels (config-driven). The key carries the panel-cache id
           (stream + agent + window), so changing tab / agent / time range
           REMOUNTS each panel. That remount is deliberate: PanelSchemaRenderer
           only consults its IndexedDB cache on mount (runCount === 0), so a
           remount is what lets it restore an already-fetched result instead of
           re-querying. Same selection + window → instant cache hit; a new one →
           a clean miss that fetches. -->
        <div class="grid grid-cols-2 gap-2.5">
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
            <!-- Charts name what they leave out: unpriced models are missing from
               the cost trend and tagged on tokens by model (AIO-16). -->
            <div
              v-if="unpriced && (panel.id === 'cost-trend' || panel.id === 'tokens-by-model')"
              class="text-2xs text-text-secondary mt-1 flex flex-wrap items-center gap-1.5 px-1"
              :data-test="`llm-insights-unpriced-note-${panel.id}`"
            >
              <OIcon name="info" size="xs" />
              <span>{{
                panel.id === "cost-trend"
                  ? t("llmDataTrust.chart.costMissing", {
                      models: unpricedModelNames,
                      tokens: formatTokens(unpriced.tokens),
                    })
                  : t("llmDataTrust.chart.unpricedModels", { models: unpricedModelNames })
              }}</span>
              <button
                type="button"
                class="text-text-link hover:text-text-link-hover underline"
                @click="openUnpricedTab"
              >
                {{ t("llmDataTrust.chart.addPrice") }}
              </button>
            </div>
          </div>
        </div>

        <!-- Agent behavior signals (loops / failure taxonomy) moved to their own
           dedicated "Agent Behavior" page under Monitor. LLM Insights keeps the
           cost/latency/error story; behavior lives beside Agent Graph. -->
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import type { AcceptableValue } from "reka-ui";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useLLMInsights } from "./composables/useLLMInsights";
import { splitNumberWithUnit, splitDuration, splitCost } from "./llmInsightsDashboard.utils";
import KpiSparkline from "./KpiSparkline.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import LLMSchemaPanel from "./LLMSchemaPanel.vue";
import LLMErrorTable from "./LLMErrorTable.vue";
import LLMDataHealthStrip from "./LLMDataHealthStrip.vue";
import { useLLMDataHealth } from "./composables/useLLMDataHealth";
import { costKind, unpricedSummary, unpricedTabRoute } from "./llmDataTrust.utils";
import { formatTokens } from "@/utils/llmUtils";
import LLMInsightsSkeleton from "./LLMInsightsSkeleton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateIngestionChip from "@/lib/core/EmptyState/EmptyStateIngestionChip.vue";
import type { EmptyStateAction } from "@/lib/core/EmptyState/presets";
import AiNoAgentIdentityBanner from "@/enterprise/components/AIObservability/AiNoAgentIdentityBanner.vue";
import AiAgentsLoadError from "@/enterprise/components/AIObservability/AiAgentsLoadError.vue";
import { readPrefill } from "@/components/login/firstSourceOptions";
import {
  POPULAR_AI_INTEGRATION_ROUTES,
  aiIntegrationByRoute,
  referredAiIntegration,
} from "./llmInsightsEmptyState";
import { LLM_INSIGHTS_PANELS } from "./config/llmInsightsPanels";
import { kpiCache, selectionKey } from "./llmInsightsCache";
import useStreams from "@/composables/useStreams";
import genAiAgentMappingService, {
  type GenAiAgentListItem,
} from "@/services/gen-ai-agent-mapping.service";
import {
  useAgentScope,
  readUrlScope,
  explicitScopeMode,
  resolveScopeMode,
  rememberModeChoice,
  scopeUrlQuery,
  agentIdentityKey,
  type ScopeMode,
} from "@/enterprise/composables/useAgentScope";
import { buildAgentTraceFilter } from "./llmAgentFilter";
import AiScopeBar from "@/enterprise/components/AIObservability/AiScopeBar.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import VersionCompareView from "@/enterprise/components/AIObservability/VersionCompareView.vue";
import { useVersionCompare } from "./composables/useVersionCompare";
import analytics from "@/services/product_analytics";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";

const { t } = useI18nTyped();
const { getStreams } = useStreams(t);
const router = useRouter();
const route = useRoute();
const store = useStore();

// Initial filter selection precedence: URL query (deep link / shareable) >
// localStorage (last used) > default. Read once at setup; we write the URL
// back on every change via syncFilterUrl().
const urlScope = readUrlScope(route.query);

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

// AI data health (AIO-17) — also feeds the Total Cost tile's unpriced note (AIO-16).
const {
  health: dataHealth,
  loading: dataHealthLoading,
  error: dataHealthError,
  samples: dataHealthSamples,
  samplesLoading: dataHealthSamplesLoading,
  fetchHealth,
  fetchSamples,
} = useLLMDataHealth();
const unpriced = computed(() => unpricedSummary(dataHealth.value));
const unpricedModelNames = computed(
  () =>
    unpriced.value?.models.map((m) => m.model ?? t("llmDataTrust.noModelName")).join(", ") ?? "",
);
function loadDataHealth(refresh = false, start = props.startTime, end = props.endTime) {
  const agent = effectiveAgent.value;
  fetchHealth(store.state.selectedOrganization?.identifier ?? "", {
    stream_name: effectiveStream.value,
    start_time: start,
    end_time: end,
    agent: agent?.name,
    agent_id: agent?.id,
    env: agent?.env,
    version: agent?.version,
    refresh,
  });
}
function openUnpricedTab() {
  router.push(
    unpricedTabRoute(effectiveStream.value, store.state.selectedOrganization?.identifier ?? ""),
  );
}

// activeStream is component-local (drives the select v-model), but its
// initial value falls back to localStorage / parent prop. Once the streams
// list is reconciled, it's clamped to a valid option.
const activeStream = ref<string>(
  urlScope.stream || localStorage.getItem(STREAM_LS_KEY) || props.streamName || "",
);
// Persists the RESOLVED agent name/env/version of the cascade selection. On
// reload we re-seed the cascade from them (see `pendingScope` +
// `selectAgentByScope`), so the last-picked variant is remembered exactly.
const AGENT_LS_KEY = "llmInsights_agentFilter";
const ENV_LS_KEY = "llmInsights_envFilter";
const VERSION_LS_KEY = "llmInsights_versionFilter";
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
// Cloud registers the SAME enterprise route tree and backend as an enterprise
// build (see router/index.ts's userCloudRoutes() picked for isCloud too) — only
// a true OSS build lacks the agent-mapping API this gates. Goes through the
// shared `genAiAgentMapping` registry entry (also used by SessionsList.vue
// and the Settings Gen AI Agent Mapping tab) so a future backend flag only
// has to change in one place (see enterpriseFeatures.ts).
const genAiAgentMappingAccess = checkFeatureAccess(
  "genAiAgentMapping",
  buildFeatureGateContext(store.state.zoConfig),
);
const { open: openUpgradeDialog } = useEnterpriseUpgradeDialog();
// The mode the user asked for (URL `type`/`agent`, else the remembered toggle),
// or null when the agents list decides: Agent when the window has agents,
// Stream when it has none (see loadInsights). OSS has no agent-mapping API, so
// it is pinned to Stream. Until the mode is resolved the panels stay unmounted,
// so they mount once, with the final mode, and no query is started and then
// cancelled by a mode flip.
const explicitMode = genAiAgentMappingAccess.allowed ? explicitScopeMode(urlScope) : "stream";
const filterMode = ref<ScopeMode>(explicitMode ?? "stream");
const modeExplicit = ref(explicitMode !== null);
// False until the first loadInsights has settled the mode and the selection;
// the panels and the scope bar wait for it.
const scopeReady = ref(false);
// Whether an agents list has decided the mode. A failed agents load decides
// nothing, so the next load after it decides again.
let modeSettled = false;
// Env/name/version to seed the cascade with once the list loads: the URL
// deep-link first (any of agent/env/version), else the persisted last
// selection. Resolved into selectedEnv/AgentName/Version via
// `selectAgentByScope`, then cleared. (The URL carries readable values, not the
// internal agent key.) Env/version come from the same source as the name, so a
// name-only link never pairs with a stored variant of another agent.
const urlHasAgentScope = !!(urlScope.agent || urlScope.env || urlScope.version);
const pendingScope = ref<{ env: string; name: string; version: string } | null>(
  urlHasAgentScope
    ? { env: urlScope.env, name: urlScope.agent, version: urlScope.version }
    : localStorage.getItem(AGENT_LS_KEY)
      ? {
          env: localStorage.getItem(ENV_LS_KEY) || "",
          name: localStorage.getItem(AGENT_LS_KEY) || "",
          version: localStorage.getItem(VERSION_LS_KEY) || "",
        }
      : null,
);

// Shared derived scope computeds come from useAgentScope. LLM Insights injects
// its OWN refs so the composable only produces the derived outputs:
// `agents`/`agentsLoaded` are the useLLMInsights refs (survive remount);
// `availableStreams` is LLM's trace-stream list. Agent selection now flows
// through the Env→Agent→Version cascade (selectedEnv/AgentName/Version →
// selectedAgent), so the old single `activeAgent` ref is gone. The `?agent=`
// deep-link and last-selection restore seed the cascade via `selectAgentByScope`
// (see loadInsights). `agentFilterClause` stays page-local (LLM's trace-filter
// builder). Injected refs are the SAME instances the page owns.
const {
  loadAgents: loadAgentList,
  agentsError,
  agentsLoadFailed,
  agentEmpty,
  noAgentIdentity,
  streamSelectOptions,
  selectedStreamCount,
  selectedAgent,
  effectiveStream,
  effectiveAgent,
  envs,
  agentNames,
  versions,
  selectedEnv,
  selectedAgentName,
  selectedVersion,
  selectAgentByName,
  selectAgentByScope,
} = useAgentScope({
  filterMode,
  activeStream,
  agents,
  agentsLoaded,
  availableStreams,
  orgId: () => store.state.selectedOrganization?.identifier,
  getWindow: () => ({ start: props.startTime, end: props.endTime }),
  allAgents: true,
  cascade: true,
  t,
});

const agentFilterClause = computed(() =>
  buildAgentTraceFilter(effectiveAgent.value, effectiveStream.value),
);

// --- Version compare mode ----------------------------------------------------
// "Compare versions…" swaps the single-select dashboard body for
// VersionCompareView. Disabled (entry hidden behind a disabled OButton) when
// the currently-selected agent has fewer than 2 versions across the wide
// (retention-scoped) enumeration — checked via `versions` (page-window-scoped,
// cheap) first; the wide-window `listVersionsForCompare` call is what actually
// feeds the compare bar once entered (enumeration covers the retention window
// and the page date-picker window, whichever reaches further back).
const compareMode = ref(false);
const compareVersionList = ref<GenAiAgentListItem[]>([]);
const versionCompare = useVersionCompare();

// Cheap pre-check from the already-loaded cascade `versions` list (scoped to
// the page window) — good enough to gate the entry button without an extra
// network call on every render. The wide-window list (loaded on entry) is the
// source of truth for the compare bar's own options.
const canCompare = computed(() => {
  const real = versions.value.filter((v) => v.value !== "__unset__");
  return real.length >= 2 && !!selectedAgentName.value;
});

// Exposed to the parent (LLMInsightsPage) so the page-level date-picker can be
// disabled in sinceRollout/manual align modes (their windows are per-version,
// not the page window) and re-enabled in sameWallClock (which the shared
// picker drives). Mirrors the align mode owned by VersionCompareView.
const compareAlign = ref<"sinceRollout" | "sameWallClock" | "manual">("sinceRollout");
// The last A/B pair we called setPair() for. Used to skip the panel-blanking
// setPair() on align-only re-runs (see onCompareRun) so the panels don't flicker.
const lastComparePairKey = ref<string | null>(null);
const compareDateDisabled = computed(
  () => compareMode.value && compareAlign.value !== "sameWallClock",
);

async function enterCompareMode() {
  if (!canCompare.value) return;
  compareMode.value = true;
  const orgId = store.state.selectedOrganization?.identifier;
  if (!orgId || !selectedAgentName.value) return;
  const nowMicros = Date.now() * 1000;
  compareVersionList.value = await genAiAgentMappingService.listVersionsForCompare(
    orgId,
    selectedAgentName.value,
    selectedEnv.value === "__unset__" ? null : selectedEnv.value,
    nowMicros,
    props.startTime,
  );
}

function exitCompareMode() {
  compareMode.value = false;
  compareVersionList.value = [];
  versionCompare.windows.value = null;
  versionCompare.result.value = null;
  // Force a fresh setPair() (and its intentional blank) on the next compare entry.
  lastComparePairKey.value = null;
}

async function onCompareRun(payload: {
  a: GenAiAgentListItem;
  b: GenAiAgentListItem;
  align: "sinceRollout" | "sameWallClock" | "manual";
  manual?: { a?: { start: number; end: number }; b?: { start: number; end: number } };
}) {
  compareAlign.value = payload.align;
  versionCompare.align.value = payload.align;
  // Only reset the pair when the A/B versions actually change. setPair() BLANKS
  // result/errorDiff/windows (→ KPI skeletons, "0 traces", the failure panel
  // unmounts) which is right when you switch agents/versions, but on an ALIGN-only
  // re-run the pair is identical — blanking there is what made the panels flicker
  // (disappear → reappear) on every align click. Keep the current results visible;
  // run() overwrites them in place when the new data lands.
  const key = (x: GenAiAgentListItem) => `${x.env ?? ""}@${x.version ?? ""}`;
  const pairKey = `${key(payload.a)}|${key(payload.b)}`;
  if (pairKey !== lastComparePairKey.value) {
    lastComparePairKey.value = pairKey;
    versionCompare.setPair(payload.a, payload.b);
  }
  const sharedWindow =
    payload.align === "sameWallClock" ? { start: props.startTime, end: props.endTime } : undefined;
  await versionCompare.run(effectiveStream.value, payload.manual, sharedWindow);
  if (versionCompare.result.value && !versionCompare.errorA.value && !versionCompare.errorB.value) {
    analytics.track("agent_version_compare_completed", { align: payload.align });
  }
}

// sameWallClock re-runs the compare whenever the page date-picker changes —
// in this align mode the shared page window IS the query window for both
// arms, so a picker change must re-fetch rather than silently going stale.
watch([() => props.startTime, () => props.endTime], async () => {
  if (!compareMode.value || compareAlign.value !== "sameWallClock") return;
  if (!versionCompare.windows.value) return;
  await versionCompare.run(effectiveStream.value, undefined, {
    start: props.startTime,
    end: props.endTime,
  });
});

// Changing the agent identity (name or env) while comparing invalidates the
// current A/B pair — those versions belong to the OLD agent. Exit compare mode
// so a stale comparison never lingers under a different agent's picker (the
// user re-enters compare for the new agent). Version alone is NOT an identity
// change (it's the very dimension being compared) and must not trigger this.
//
// The ORGANIZATION is also an identity dimension: every agent/version selection
// is org-scoped, so switching orgs while comparing leaves the picker pointed at
// an agent that may not exist in the new org. The compare endpoint then returns
// `insufficient` for that phantom agent, the view drops to the slow raw-sample
// bootstrap fallback, and the KPI cards render STALE cross-org numbers. Reset on
// org change too, so the compare view never queries an agent from another org.
//
// The STREAM is likewise an identity dimension: every compare query runs
// `FROM "<effectiveStream>"` and each stream carries its own agents/versions.
// Switching stream mid-compare left the comparison pinned to the OLD stream's
// agent pair (which may not exist in the new stream) — so reset on stream change
// too. The user re-enters compare for an agent that actually lives in the new
// stream.
watch(
  [
    selectedAgentName,
    selectedEnv,
    effectiveStream,
    () => store.state.selectedOrganization?.identifier,
  ],
  () => {
    if (compareMode.value) exitCompareMode();
  },
);

// --- Panel result cache (the dashboards IndexedDB cache) --------------------
// PanelSchemaRenderer restores a panel's data from IndexedDB on mount and skips
// the query when the cache key matches — the same mechanism the Dashboards page
// uses to survive panel remounts. It's keyed `folderId:dashboardId:panelId` and
// is a no-op unless all three are non-empty (usePanelCache), so we mint a
// stable, scoped identity for our panels:
//   folder      → one constant bucket for this whole page.
//   dashboardId → org + stream + agent + time window, so a different selection
//                 or a new window is a clean miss (fresh fetch) while the same
//                 one is a hit. Built from the agent NAME, never the SQL filter,
//                 so no query text leaks into ids/URLs.
//   panelId     → the schema's `llm-<panel.id>` (set in buildLLMPanelSchema).
//
// This SAME id is the canonical "which selection are we looking at" key for the
// whole page: it's the panel dashboardId, the KPI cache key, AND the error
// table's cache key (passed down as a prop) — so all three caches agree on one
// identity instead of each deriving its own. `agentKey` is the agent variant, or
// a placeholder when there's no agent (`_stream` on the Stream tab, `_none` on
// the Agent tab before one resolves) — handled here, in one place.
const PANEL_CACHE_FOLDER = "ai-llm-insights";
// Env/version are part of the key: each variant filters to different data, so sharing a name must not share a cache slot.
function selectionAgentKey(): string {
  if (filterMode.value !== "agent") return "_stream";
  const a = effectiveAgent.value;
  return a ? `${a.name}::${a.env ?? ""}::${a.version ?? ""}` : "_none";
}
const panelCacheDashboardId = computed(() => {
  const agentKey = selectionAgentKey();
  return selectionKey(
    store.state.selectedOrganization?.identifier ?? "",
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

// Reflect the current filter in the URL so the view is shareable / survives a
// reload: `?stream=<name>` or `?agent=<name>&env=<env>&version=<version>`, plus
// `type` when the mode was chosen rather than picked from the agents list. We
// keep readable values (not the internal agent key) and preserve other params
// (e.g. the time range owned by the parent).
function syncFilterUrl() {
  const agent = selectedAgent.value
    ? { name: selectedAgent.value.name, env: selectedEnv.value, version: selectedVersion.value }
    : null;
  const query = scopeUrlQuery(route.query, {
    mode: filterMode.value,
    explicit: modeExplicit.value,
    stream: activeStream.value,
    agent,
  });
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
    const res: any = await getStreams("traces", false, false);
    const list = res?.list || [];
    const llmStreams = list.filter((stream: any) => stream?.settings?.is_llm_stream !== false);
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

// Agents for the window, through useAgentScope's single loader (one request
// per window bucket; `force` only on a user refresh). Then seed the panel-cache
// stub for every selection at this window — the Stream tab plus each agent — so
// a cold tab/agent switch that mounts the panels before the per-id sync watcher
// fires still finds getDashboard a store lookup.
async function loadAgents(start: number, end: number, force: boolean) {
  await loadAgentList(start, end, force);
  const orgId = store.state.selectedOrganization?.identifier ?? "";
  ensurePanelCacheStub(selectionKey(orgId, activeStream.value, "_stream", start, end));
  for (const a of agents.value) {
    ensurePanelCacheStub(
      selectionKey(
        orgId,
        a.source_stream,
        `${a.name}::${a.env ?? ""}::${a.version ?? ""}`,
        start,
        end,
      ),
    );
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

// The integration guide the user most likely needs: the one whose docs page
// they came from — the signup docs referrer (kept for the Get started dialog
// until it is answered), else this page load's own referrer.
const suggestedIntegration = referredAiIntegration([readPrefill()?.referrer, document.referrer]);
// The guides AI-docs visitors read most, as one-click chips (minus the suggested one).
const popularIntegrations = POPULAR_AI_INTEGRATION_ROUTES.map(aiIntegrationByRoute).filter(
  (i): i is NonNullable<typeof i> => !!i && i.routeName !== suggestedIntegration?.routeName,
);
const emptyStateActions: EmptyStateAction[] = [
  ...(suggestedIntegration
    ? [
        {
          id: `suggested-${suggestedIntegration.slug}`,
          icon: "auto-awesome",
          titleKey: "emptyState.noLLMInsights.suggested",
          titleParams: { name: suggestedIntegration.name },
          descriptionKey: "emptyState.noLLMInsights.suggestedDesc",
          descriptionParams: { name: suggestedIntegration.name },
        } satisfies EmptyStateAction,
      ]
    : []),
  {
    id: "instrument-with-coding-agent",
    icon: "smart-toy",
    titleKey: "emptyState.noLLMInsights.codingAgent",
    descriptionKey: "emptyState.noLLMInsights.codingAgentDesc",
  },
  {
    id: "all-integrations",
    icon: "widgets",
    titleKey: "emptyState.noLLMInsights.action",
    descriptionKey: "emptyState.noLLMInsights.actionDesc",
  },
];

// Every empty-state action opens an in-app integration page. A guide's own
// route (not `ai-integrations`, whose default child redirect lands on the
// first integration and drops the query) is what makes the click land on it.
function onEmptyAction(id?: string) {
  const org_identifier = store.state.selectedOrganization?.identifier;
  if (id === "all-integrations") {
    router.push({ name: "ai-integrations", query: { org_identifier } });
    return;
  }
  if (id === "instrument-with-coding-agent") {
    router.push({ name: "ai-openai-python", query: { org_identifier, tab: "agent" } });
    return;
  }
  const slug = id?.replace(/^(suggested|integration)-/, "");
  const integration =
    suggestedIntegration?.slug === slug
      ? suggestedIntegration
      : popularIntegrations.find((i) => i.slug === slug);
  if (integration) router.push({ name: integration.routeName, query: { org_identifier } });
}

interface KpiCard {
  label: I18nText;
  /** Material-symbol icon name (OIcon) shown in the card's corner tile. */
  icon: string;
  value: string;
  unit?: string;
  /** Shown before the value, e.g. "≥" when the cost is a lower bound. */
  prefix?: string;
  /** Clickable line under the value (unpriced tokens → Model Pricing). */
  note?: string;
  noteTooltip?: string;
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
    kpi.value.traceCount > 0 ? (kpi.value.errorCount / kpi.value.traceCount) * 100 : 0;

  // Cost comes straight from SUM(gen_ai_usage_cost) on the KPI summary. Spans
  // whose model has no price carry no cost, so when the data health check finds
  // unpriced tokens the tile reads as a lower bound ("≥ $X"), or "cost unknown"
  // when none of the window's tokens were priced, with the token count under it.
  const u = unpriced.value;
  const kind = costKind(kpi.value.totalCost, kpi.value.totalTokens, u?.tokens ?? 0);
  const costCard: KpiCard = {
    label: t("traces.lLMInsightsDashboard.totalCost"),
    icon: "payments",
    ...(kind === "unknown"
      ? { value: t("llmDataTrust.cost.unknown") }
      : splitCost(kpi.value.totalCost)),
    ...(kind === "partial" ? { prefix: "≥" } : {}),
    ...(u
      ? {
          note: t("llmDataTrust.tile.unpricedTokens", { tokens: formatTokens(u.tokens) }),
          noteTooltip: t("llmDataTrust.tile.unpricedTooltip", {
            tokens: formatTokens(u.tokens),
            models: unpricedModelNames.value,
          }),
        }
      : {}),
    sparkData: sparklines.value.cost,
    sparkColor: "#0ea5e9",
  };

  return [
    costCard,
    {
      label: t("traces.lLMInsightsDashboard.totalTokens"),
      icon: "tag",
      value: tokens.value,
      unit: tokens.unit,
      sparkData: sparklines.value.tokens,
      sparkColor: "#a855f7",
    },
    {
      label: t("traces.lLMInsightsDashboard.totalTraces"),
      icon: "account-tree",
      value: traces.value,
      unit: traces.unit,
      sparkData: sparklines.value.traces,
      sparkColor: "#3b82f6",
    },
    {
      label: t("traces.lLMInsightsDashboard.p95Latency"),
      icon: "schedule",
      value: p95.value,
      unit: p95.unit,
      sparkData: sparklines.value.p95Micros,
      sparkColor: "#f97316",
      loading: p95Loading.value,
    },
    {
      label: t("traces.lLMInsightsDashboard.errorRate"),
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
  const agentKey = selectionAgentKey();
  return selectionKey(
    store.state.selectedOrganization?.identifier ?? "",
    effectiveStream.value,
    agentKey,
    start,
    end,
  );
}

// Identity of the agent loadInsights last resolved and loaded for, and whether
// a loadInsights is between loading the agents and settling the selection. The
// selected-agent watcher below skips both, so the selection loadInsights itself
// seeds (the cascade's first-agent default, then the URL / remembered agent)
// doesn't start a second load that remounts the panels and cancels their
// queries.
let loadedAgentKey = "";
let resolvingScope = 0;

// Single fetch entry point. Always pulls from the current props (which the
// parent keeps in sync via `recomputeInsightsTimeRange`). Stream selector
// changes, refresh button, and onMounted all funnel through here. `force`
// (manual refresh) bypasses the KPI and agents caches and pulls fresh numbers.
async function loadInsights(startTime?: number, endTime?: number, opts?: { force?: boolean }) {
  try {
    const force = opts?.force ?? false;
    const start = startTime ?? props.startTime;
    const end = endTime ?? props.endTime;
    if (!start || !end) return;

    // Stream-mode reads `effectiveStream` from `activeStream`, which is only set
    // once the stream list loads — so make sure that's done before we fetch,
    // regardless of whether this call raced ahead of the mount's stream load.
    await ensureStreamsLoaded();

    // The agents list decides the mode (when the user didn't choose one), fills
    // the Agent cascade and the stream picker's agent counts, and drives the
    // "No agent identity found" banner — one request per window.
    resolvingScope++;
    try {
      if (genAiAgentMappingAccess.allowed && availableStreams.value.length > 0) {
        await loadAgents(start, end, force);
      }
    } finally {
      resolvingScope--;
    }
    if (!modeSettled && !modeExplicit.value) {
      filterMode.value = resolveScopeMode(null, agents.value.length, agentsError.value);
    }
    if (!agentsError.value) modeSettled = true;

    if (filterMode.value === "agent") {
      // Seed the cascade from the carried-over env/name/version (URL deep-link,
      // else the persisted last selection) now that the list exists; then clear it.
      if (pendingScope.value && agents.value.length > 0) {
        const { env, name, version } = pendingScope.value;
        selectAgentByScope(env, name, version);
        pendingScope.value = null;
      }
      // Default to the first agent when nothing valid is selected (fresh entry
      // to the tab, or the previously-picked agent is gone for this window).
      // Seeding by name resolves the whole cascade.
      if (!selectedAgent.value && agents.value.length > 0) {
        selectAgentByName(agents.value[0].name);
      }
      // Persist the resolved agent variant so a reload restores the same selection.
      if (selectedAgent.value?.name) {
        localStorage.setItem(AGENT_LS_KEY, selectedAgent.value.name);
        localStorage.setItem(ENV_LS_KEY, selectedEnv.value);
        localStorage.setItem(VERSION_LS_KEY, selectedVersion.value);
      }
    } else {
      localStorage.setItem(STREAM_LS_KEY, activeStream.value);
    }
    loadedAgentKey = agentIdentityKey(selectedAgent.value);
    // Mode and selection are final: the panels may mount now, exactly once.
    scopeReady.value = true;

    // Keep the URL in step with the resolved selection (runs even when there's
    // nothing to query, e.g. the Agent tab with no agents).
    syncFilterUrl();

    // Stream comes from the agent (Agent tab) or the picker (Stream tab).
    const stream = effectiveStream.value;
    if (!stream) return;
    // Data health runs alongside (server-cached ~1 min; a manual refresh re-runs it).
    loadDataHealth(force, start, end);

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

// A toggle click is an explicit choice: it is kept in the URL and remembered for
// the other Monitor pages, so the agents list no longer picks the mode.
function onFilterModeChange(mode: boolean | AcceptableValue | AcceptableValue[]) {
  const next = mode === "agent" ? "agent" : "stream";
  if (next === filterMode.value) return;
  filterMode.value = next;
  modeExplicit.value = true;
  rememberModeChoice(next);
  // Entering the Agent tab can wait on the agents list before any KPI fetch —
  // show the skeleton for that stretch so the switch is immediate, not stale.
  if (next === "agent") switching.value = true;
  loadInsights();
}

function onStreamChange() {
  loadInsights();
}

// Agent selection now flows through the Env→Agent→Version cascade: changing any
// dropdown re-resolves `selectedAgent` (via useAgentScope's reconciler). Reload
// insights whenever that resolved agent changes while in Agent mode, mirroring
// the former @agent-change handler. Keyed on the agent's stream-scoped identity +
// version so a same-named agent in a different stream/version still reloads.
watch(
  () => agentIdentityKey(selectedAgent.value),
  (key) => {
    if (
      filterMode.value !== "agent" ||
      !scopeReady.value ||
      resolvingScope > 0 ||
      key === loadedAgentKey
    ) {
      return;
    }
    switching.value = true;
    loadInsights();
  },
);

// Parent calls this on Run Query / Refresh / date-range change, passing
// the freshly computed start/end so we don't have to wait for Vue's
// next-tick prop propagation. `force` is false for the window DateTime replays
// on mount, so entering the page does not bypass the caches.
async function refresh(startTime?: number, endTime?: number, force = true) {
  await loadInsights(startTime, endTime, { force });
}

// "Last refreshed" timestamp for the whole-page refresh indicator. Stamped when
// the KPI fetch settles (loading true→false), mirroring how the Logs page keys
// its single last-refresh off `searchObj.loading`. Exposed to the page header,
// which renders it via ORefreshButton.
const lastRunAt = ref<number | null>(null);
watch(loading, (isLoading, wasLoading) => {
  if (wasLoading && !isLoading) lastRunAt.value = Date.now();
});

defineExpose({
  refresh,
  lastRunAt,
  loading,
  compareDateDisabled,
  versionCompare,
  // Exposed for tests: compareMode + the cascade identity refs so the
  // auto-exit-on-identity-change behavior (agent, env, stream) is assertable.
  compareMode,
  selectedAgentName,
  selectedEnv,
  selectedVersion,
  activeStream,
  filterMode,
});

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
  versionCompare.cancel();
});
</script>
