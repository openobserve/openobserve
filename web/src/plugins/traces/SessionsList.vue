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
  <div class="sessions-list bg-card-glass-bg flex h-full! flex-col">
    <!-- No LLM streams exist in the org at all — nothing to select, so show
         the rich first-run empty state on its own (no table chrome). -->
    <div
      v-if="streamsLoaded && availableStreams.length === 0"
      class="flex min-h-0 flex-1 items-center justify-center"
      data-test="sessions-empty-no-streams"
    >
      <OEmptyState size="hero" preset="no-llm-sessions" @action="onEmptyAction" />
    </div>

    <!-- Scope control — left-aligned Stream/Agent bar directly under the page
         header, matching Agent Graph / Agent Behavior / LLM Insights so every
         AI page places its scope selector identically. Sits above the table
         rather than inside the OTable toolbar. -->
    <!-- Shared scope control. The outer guard (no bar until we know there ARE
         streams) stays here, wrapping the component. Sessions' original bar mixed
         its data-test prefix — `sessions-list-*` for the toggle/pickers but
         `sessions-*` for the count/badges — so those two are passed explicitly to
         stay byte-identical. solidAgentTrigger keeps the "All Agents" empty state
         in solid text (Sessions never dimmed it). -->
    <AiScopeBar
      v-if="!(streamsLoaded && availableStreams.length === 0)"
      v-model:filter-mode="filterMode"
      v-model:active-stream="activeStream"
      v-model:selected-env="selectedEnv"
      v-model:selected-agent-name="selectedAgentName"
      v-model:selected-version="selectedVersion"
      data-test="sessions-list"
      count-data-test="sessions-stream-count"
      all-agents
      show-stream-skeleton
      :labels="{
        agent: t('traces.sessionsList.agent'),
        stream: t('traces.sessionsList.stream'),
        streamLabel: t('traces.sessionsList.streamLabel'),
        allAgents: t('traces.allAgents'),
      }"
      :stream-select-options="streamSelectOptions"
      :envs="envs"
      :agent-names="agentNames"
      :versions="versions"
      :selected-stream-count="selectedStreamCount"
      :streams-loaded="streamsLoaded"
      :agents-loaded="agentsLoaded"
      @filter-mode-change="onFilterModeChange"
      @stream-change="onStreamChange"
    />

    <!-- Streams exist: OTable owns the data surface (column chooser, server-side
         pagination footer, column resize, empty/error body). The scope control
         lives in the page-level bar above; the header owns refresh + date.
         NOTE: explicit v-if (not v-else) — the scope bar above carries its own
         v-if, so a v-else here would chain to the bar and hide the table
         whenever streams exist. -->
    <OTable
      v-if="!(streamsLoaded && availableStreams.length === 0)"
      :data="sessions"
      :columns="tableColumns"
      :loading="loading"
      row-key="sessionId"
      show-index
      pagination="server"
      :current-page="currentPage"
      :total-count="total"
      :page-size="rowsPerPage"
      :page-size-options="rowsPerPageOptions"
      :footer-title="t('traces.sessionsList.sessions')"
      :enable-column-resize="true"
      :persist-columns="true"
      table-id="ai-sessions-list"
      :default-columns="false"
      :show-global-filter="false"
      :frame="false"
      width="100%"
      class="h-full w-full"
      data-test="sessions-list-table"
      @row-click="(row: any) => handleRowClick(row)"
      @pagination-change="onPaginationChange"
    >
      <!-- Empty / error body — rendered inside the frame so the toolbar (and
           thus the stream selector) stays visible. -->
      <template #empty>
        <OEmptyState
          v-if="error && hasLoadedOnce"
          size="hero"
          illustration="broken-panel"
          variant="error"
          data-test="sessions-empty-error"
          :title="t('traces.sessionsList.failedToLoad')"
          :description="error || ''"
          :action-label="t('traces.sessionsList.retry')"
          action-icon="refresh"
          @action="loadSessions()"
        />
        <OEmptyState
          v-else-if="agentEmpty"
          size="hero"
          illustration="constellation"
          data-test="sessions-empty-no-agents"
          :title="t('traces.sessionsList.noAgentsTitle')"
          :description="t('traces.sessionsList.noAgentsDescription')"
          :action-label="t('traces.sessionsList.viewByStream')"
          @action="onFilterModeChange('stream')"
        />
        <div v-else class="flex items-center justify-center py-12" data-test="sessions-empty">
          <OEmptyState size="hero" preset="no-llm-sessions" @action="onEmptyAction" />
        </div>
      </template>
      <!-- Timestamp -->
      <template #cell-firstSeenNanos="{ row }">
        <span class="text-xs tabular-nums">
          {{ formatTimestamp(row.firstSeenNanos) }}
        </span>
      </template>

      <!-- Session ID -->
      <template #cell-sessionId="{ row }">
        <div class="w-full truncate text-xs">
          {{ row.sessionId }}
          <OTooltip :content="row.sessionId" />
        </div>
      </template>

      <!-- User -->
      <template #cell-userId="{ row }">
        <OUserCell :value="row.userId" :empty-label="t('traces.sessionsList.unknownUser')" />
      </template>

      <!-- First user message -->
      <template #cell-firstUserMessage="{ row }">
        <div v-if="row.firstUserMessage" class="text-text-secondary w-full truncate text-xs">
          {{ row.firstUserMessage }}
          <OTooltip :content="row.firstUserMessage" />
        </div>
        <span v-else class="text-text-muted text-xs">—</span>
      </template>

      <!-- Turns -->
      <template #cell-turns="{ row }">
        <span class="text-xs">{{ row.turns }}</span>
      </template>

      <!-- Duration -->
      <template #cell-durationNanos="{ row }">
        <span class="text-xs">
          {{ formatDuration(row.durationNanos) }}
          <OTooltip
            :content="`${row.durationNanos.toLocaleString()} ${t('traces.sessionsList.durationNs')}`"
          />
        </span>
      </template>

      <!-- Tokens -->
      <template #cell-tokens="{ row }">
        <span class="text-xs tabular-nums">
          {{ formatTokens(row.inputTokens) }} → {{ formatTokens(row.outputTokens) }} =
          {{ formatTokens(row.tokens) }}
          <OTooltip
            :content="
              t('traces.sessionsList.tokenTooltip', {
                input: row.inputTokens.toLocaleString(),
                output: row.outputTokens.toLocaleString(),
                total: row.tokens.toLocaleString(),
              })
            "
          />
        </span>
      </template>

      <!-- Cost -->
      <template #cell-cost="{ row }">
        <span class="text-xs">${{ row.cost.toFixed(4) }}</span>
      </template>

      <!-- Status (derived from error_count) -->
      <template #cell-status="{ row }">
        <OTag
          type="sessionStatus"
          :value="row.status"
          :data-test="`sessions-list-status-${row.sessionId}`"
        />
      </template>
    </OTable>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { formatDate } from "@/utils/date";
import { useI18n } from "vue-i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import { useLlmTraceStreams } from "@/enterprise/composables/useLlmTraceStreams";
import { useAgentScope } from "@/enterprise/composables/useAgentScope";
import { useSessions, type SessionRow } from "./composables/useSessions";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import type { AcceptableValue } from "reka-ui";
import genAiAgentMappingService from "@/services/gen-ai-agent-mapping.service";
import { buildAgentSessionFilter } from "./llmAgentFilter";
import { splitNumberWithUnit, splitDuration } from "./llmInsightsDashboard.utils";
import AiScopeBar from "@/enterprise/components/AIObservability/AiScopeBar.vue";

interface Props {
  streamName: string;
  startTime: number; // microseconds
  endTime: number; // microseconds
  // Route to open on row click. Defaults to the Traces session-details route;
  // the AI/LLM Sessions page passes its own route so it stays in the AI menu.
  detailRouteName?: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "sessionSelected", session: SessionRow): void;
}>();

const STREAM_LS_KEY = "sessionsList_streamFilter";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const store = useStore();
const {
  sessions,
  total,
  loading,
  error,
  hasLoadedOnce,
  lastRunAt,
  loadedOrg,
  currentPage,
  rowsPerPage,
  agents,
  agentsLoaded,
  fetchPage,
  cancelAll,
} = useSessions();

const urlType = typeof route.query.type === "string" ? route.query.type : "";
const urlStream = typeof route.query.stream === "string" ? route.query.stream : "";
const urlAgentName = typeof route.query.agent === "string" ? route.query.agent : "";

const activeStream = ref<string>(
  urlStream || localStorage.getItem(STREAM_LS_KEY) || props.streamName || "",
);
// Trace-stream loading is shared with the other AI pages via
// useLlmTraceStreams. availableStreams/streamsLoaded/ensureStreamsLoaded are
// byte-identical to the previous inline versions.
const { availableStreams, streamsLoaded, ensureStreamsLoaded } = useLlmTraceStreams(activeStream);
const MODE_LS_KEY = "sessionsList_filterMode";
// Persists the RESOLVED agent NAME of the cascade selection (was the old single
// `activeAgent` key). On reload we re-seed the cascade from it (see
// `pendingAgentName` + `selectAgentByName`), so the last-picked agent is
// remembered exactly as before — just via the cascade, not the retired
// `activeAgent` ref.
const AGENT_LS_KEY = "sessionsList_agentFilter";
// Default scope is ALWAYS "agent" — every AI page lands on Agent for consistency.
// Only an explicit `?type=stream` URL param overrides it (a stale saved
// preference must not silently land on Stream).
const filterMode = ref<"stream" | "agent">(urlType === "stream" ? "stream" : "agent");
// `agents` / `agentsLoaded` are module-scoped (see useSessions) so the agent
// picker keeps its options — and stays off its skeleton — across a remount.
// Agent NAME to seed the cascade with once the list loads: the URL `?agent=`
// deep-link first, else the persisted last selection. Resolved into
// selectedEnv/AgentName/Version via `selectAgentByName`, then cleared.
const pendingAgentName = ref<string | null>(
  filterMode.value === "agent" ? urlAgentName || localStorage.getItem(AGENT_LS_KEY) || null : null,
);

// Server-side pagination (1-indexed). OTable owns the footer controls in
// `pagination="server"` mode and emits `pagination-change`; `currentPage` /
// `rowsPerPage` come from useSessions (module-scoped) so the page/size survives
// the unmount/remount cycle and stays in sync with the restored rows.
// Page-size options match the dashboards' table pagination
// (TablePaginationControls) so the AI module stays consistent.
const rowsPerPageOptions = [20, 50, 100, 250, 500];

// Shared derived scope computeds come from useAgentScope. Sessions injects its
// OWN refs so the composable only produces the derived outputs: `agents`/
// `agentsLoaded` are module-scoped (from useSessions, survive remount);
// `availableStreams` is Sessions' trace-stream list. Agent selection now flows
// through the Env→Agent→Version cascade (selectedEnv/AgentName/Version →
// selectedAgent), so the old single `activeAgent` ref is gone. The `?agent=`
// deep-link and last-selection restore seed the cascade via `selectAgentByName`
// (see loadSessions). `agentFilterClause` stays page-local (Sessions' session-
// filter builder). Injected refs are the SAME instances the page owns, so
// module scoping is unchanged.
const {
  streamSelectOptions,
  selectedStreamCount,
  selectedAgent,
  effectiveStream,
  effectiveAgent,
  agentEmpty,
  envs,
  agentNames,
  versions,
  selectedEnv,
  selectedAgentName,
  selectedVersion,
  selectAgentByName,
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
  buildAgentSessionFilter(effectiveAgent.value, effectiveStream.value),
);

// `instrument` is the only action id the preset emits. Send the user to
// the in-app AI integrations page (the closest "set this up" surface) so
// they don't have to leave the product to find the OpenTelemetry guide.
function onEmptyAction(id?: string) {
  if (id !== "instrument") return;
  router.push({
    name: "ai-integrations",
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
    },
  });
}

// Clamp the page when the total shrinks (e.g. a re-fetch returns fewer
// matches than the current page offset).
watch(total, () => {
  const pages = Math.max(1, Math.ceil((total.value || 0) / rowsPerPage.value));
  if (currentPage.value > pages) currentPage.value = pages;
});

// `hideable` exposes a column in OTable's auto-injected column chooser;
// `sessionId` stays mandatory (it's the row identity). `firstUserMessage` is
// the flex column — it fills leftover width on load and freezes on first
// resize. All widths are user-resizable + persisted via `table-id`.
const tableColumns = computed(() =>
  [
    {
      id: "firstSeenNanos",
      header: t("traces.sessionsList.columns.timestamp"),
      accessorKey: "firstSeenNanos",
      size: 170,
      sortable: false,
      hideable: true,
      meta: { align: "left" },
    },
    {
      id: "sessionId",
      header: t("traces.sessionsList.columns.sessionId"),
      accessorKey: "sessionId",
      size: 250,
      sortable: false,
      meta: { align: "left" },
    },
    {
      id: "userId",
      header: t("traces.sessionsList.columns.user"),
      accessorKey: "userId",
      size: 110,
      sortable: false,
      hideable: true,
      meta: { align: "left" },
    },
    {
      id: "firstUserMessage",
      header: t("traces.sessionsList.columns.firstMessage"),
      accessorKey: "firstUserMessage",
      size: 360,
      // Flex columns collapse to `minSize` when the table overflows horizontally;
      // pin a floor so the message stays readable instead of clipping to "Han…".
      // The user drives how much they want to see via resize, capped by maxSize.
      minSize: 200,
      maxSize: 600,
      sortable: false,
      hideable: true,
      meta: { align: "left", flex: true },
    },
    {
      id: "turns",
      header: t("traces.sessionsList.columns.turns"),
      accessorKey: "turns",
      size: 50,
      sortable: false,
      hideable: true,
      meta: { align: "right" },
    },
    {
      id: "durationNanos",
      header: t("traces.sessionsList.columns.duration"),
      accessorKey: "durationNanos",
      size: 90,
      sortable: false,
      hideable: true,
      meta: { align: "left" },
    },
    {
      id: "tokens",
      header: t("traces.sessionsList.columns.tokens"),
      accessorKey: "tokens",
      size: 150,
      minSize: 150,
      sortable: false,
      hideable: true,
      meta: { align: "right" },
    },
    {
      id: "cost",
      header: t("traces.sessionsList.columns.cost"),
      accessorKey: "cost",
      size: 100,
      sortable: false,
      hideable: true,
      meta: { align: "right" },
    },
    {
      id: "status",
      header: t("traces.sessionsList.columns.status"),
      accessorKey: "status",
      size: 100,
      sortable: false,
      hideable: true,
      meta: { align: "left", disableCellAction: true },
    },
  ].map((c: any) => ({
    ...c,
    // Offer every column except the session id (row identity) in OTable's
    // "Manage columns" chooser.
    hideable: c.id !== "sessionId",
  })),
);

function formatTimestamp(nanos: number): string {
  if (!nanos) return "—";
  // Backend ships timestamps as nanoseconds — formatDate wants ms.
  return formatDate(Math.floor(nanos / 1_000_000), "YYYY-MM-DD HH:mm:ss");
}

function formatDuration(nanos: number): string {
  if (!nanos) return "—";
  // splitDuration expects microseconds.
  const d = splitDuration(nanos / 1000);
  return `${d.value}${d.unit}`;
}

function formatTokens(n: number): string {
  if (!n) return "0";
  const t = splitNumberWithUnit(n);
  return `${t.value}${t.unit}`;
}

async function loadAgents(startTime?: number, endTime?: number) {
  const orgId = store.state.selectedOrganization?.identifier;
  const start = startTime ?? props.startTime;
  const end = endTime ?? props.endTime;
  if (!orgId || !start || !end) return;
  agentsLoaded.value = false;
  try {
    const agentList = await genAiAgentMappingService.listAgents(orgId, start, end);
    agents.value = agentList.agents;
    // The cascade selection is reconciled against the fresh list by
    // useAgentScope's watcher (invalid env/name/version fall back / clear), so
    // there is no page-local selection to clamp here anymore.
  } catch (e) {
    console.warn("Failed to load GenAI agents", e);
    agents.value = [];
  } finally {
    agentsLoaded.value = true;
  }
}

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
  router.replace({ query }).catch(() => {});
}

function clearSessionRows() {
  sessions.value = [];
  total.value = 0;
}

async function loadSessions(startTime?: number, endTime?: number, force = false) {
  const start = startTime ?? props.startTime;
  const end = endTime ?? props.endTime;
  if (!start || !end) return;

  // Serve the already-loaded list from memory. This is the back-navigation
  // case (SessionsList remounts, the parent's DateTime replays its window
  // programmatically) — we keep the previous page instead of re-fetching. Only
  // an explicit refresh or a real date change passes `force`. A prior error or
  // an org switch invalidates the cache so those still re-fetch.
  const orgId = store.state.selectedOrganization?.identifier || "default";
  if (!force && hasLoadedOnce.value && !error.value && loadedOrg.value === orgId) {
    return;
  }

  localStorage.setItem(MODE_LS_KEY, filterMode.value);

  // Hold the table skeleton across the whole load. We await the stream list and
  // (in Agent mode) the agents API before `fetchPage`, which is the only thing
  // that flips `loading`. Setting it true up front means the table shows one
  // continuous skeleton instead of flashing its empty body between phases.
  loading.value = true;

  // Stream-mode reads `effectiveStream` from `activeStream`, which is only set
  // once the stream list loads — so make sure that's done before we fetch,
  // regardless of whether this call raced ahead of the mount's stream load.
  await ensureStreamsLoaded();

  // Agents API is only relevant in Agent mode — don't touch it in Stream mode.
  if (filterMode.value === "agent") {
    await loadAgents(start, end);
    // Seed the cascade from a carried-over agent NAME (URL `?agent=` deep-link,
    // else the persisted last selection) now that the list exists. On a match
    // this pins env→name→version so `selectedAgent` resolves; then it's a
    // one-shot, so clear it.
    if (pendingAgentName.value) {
      selectAgentByName(pendingAgentName.value);
      pendingAgentName.value = null;
    }
    // Fall back to the first agent when nothing valid is selected (fresh entry,
    // or the previously-picked agent is gone for this window). Seeding by name
    // resolves the whole cascade.
    if (!selectedAgent.value && agents.value.length > 0) {
      selectAgentByName(agents.value[0].name);
    }
    // Persist the resolved agent NAME so a reload restores the same selection.
    if (selectedAgent.value?.name) {
      localStorage.setItem(AGENT_LS_KEY, selectedAgent.value.name);
    }
  } else {
    localStorage.setItem(STREAM_LS_KEY, activeStream.value);
  }

  syncFilterUrl();

  const stream = effectiveStream.value;
  if (!stream) {
    clearSessionRows();
    loading.value = false; // nothing to fetch — release the held skeleton
    return;
  }
  await fetchPage(
    stream,
    start,
    end,
    currentPage.value - 1,
    rowsPerPage.value,
    agentFilterClause.value,
  );
}

// Filter / pagination changes are deliberate user actions — force a re-fetch
// so they bypass the "already loaded" cache guard.
function onStreamChange() {
  currentPage.value = 1;
  loadSessions(undefined, undefined, true);
}

function onFilterModeChange(mode?: AcceptableValue | AcceptableValue[] | boolean) {
  const next = mode === "agent" ? "agent" : "stream";
  if (next === filterMode.value) return;
  filterMode.value = next;
  currentPage.value = 1;
  clearSessionRows();
  loadSessions(undefined, undefined, true);
}

// Agent selection now flows through the Env→Agent→Version cascade: changing any
// dropdown re-resolves `selectedAgent` (via useAgentScope's reconciler). Re-fetch
// whenever that resolved agent changes while in Agent mode, mirroring the former
// @agent-change handler. Keyed on the agent's stream-scoped identity + version so
// a same-named agent in a different stream/version still triggers a reload.
watch(
  () => {
    const a = selectedAgent.value;
    return a ? `${a.source_stream}::${a.name}::${a.env ?? ""}::${a.version ?? ""}` : "";
  },
  () => {
    if (filterMode.value !== "agent") return;
    currentPage.value = 1;
    loadSessions(undefined, undefined, true);
  },
);

// Single handler for OTable's server pagination footer. A page-size change
// resets to the first page (the old offset may be out of range under the new
// size); a page click just moves to that page. Either way we re-fetch.
function onPaginationChange({ page, size }: { page: number; size: number }) {
  if (size !== rowsPerPage.value) {
    rowsPerPage.value = size;
    currentPage.value = 1;
  } else {
    currentPage.value = page;
  }
  loadSessions(undefined, undefined, true);
}

function handleRowClick(row: SessionRow) {
  emit("sessionSelected", row);
  router.push({
    name: props.detailRouteName || "sessionDetails",
    query: {
      stream: effectiveStream.value,
      session_id: row.sessionId,
      from: props.startTime,
      to: props.endTime,
      org_identifier: store.state.selectedOrganization?.identifier,
      user_id: row.userId || undefined,
    },
  });
}

// Explicit refresh (header button) / real date change — always re-fetches,
// bypassing the cache guard. `lastRunAt` is stamped inside `fetchPage`, so it
// only advances on an actual load, never on a cache hit.
async function refresh(startTime?: number, endTime?: number, force = true) {
  // Only snap back to page 1 when we're actually going to fetch. On the
  // non-forced mount replay we skip the fetch and keep the restored page.
  if (force) currentPage.value = 1;
  await loadSessions(startTime, endTime, force);
}

defineExpose({ refresh, lastRunAt, loading });

onMounted(() => {
  // Only kick off the stream-list load here. The session fetch is driven by the
  // parent (its DateTime fires an initial `on:date-change` on mount, plus the
  // refresh button) — a single owner, so we don't double-fetch on load.
  ensureStreamsLoaded();
});

onUnmounted(() => {
  cancelAll();
});

useShortcuts([
  {
    id: "sessionsRefresh",
    handler: () => {
      if (!isInputFocused()) refresh();
    },
  },
]);
</script>
