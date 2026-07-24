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
  <div
    class="sessions-list h-full! flex flex-col bg-card-glass-bg"
  >
    <!-- No LLM streams exist in the org at all — nothing to select, so show
         the rich first-run empty state on its own (no table chrome). -->
    <div
      v-if="streamsLoaded && availableStreams.length === 0"
      class="flex-1 min-h-0 flex items-center justify-center"
      data-test="sessions-empty-no-streams"
    >
      <OEmptyState size="hero" preset="no-llm-sessions" @action="onEmptyAction" />
    </div>

    <!-- Scope control — left-aligned Stream/Agent bar directly under the page
         header, matching Agent Graph / Agent Behavior / LLM Insights so every
         AI page places its scope selector identically. Sits above the table
         rather than inside the OTable toolbar. -->
    <div
      v-if="!(streamsLoaded && availableStreams.length === 0)"
      class="flex items-center gap-3 px-page-edge py-2 border-b border-border-default"
    >
      <OToggleGroup
        :model-value="filterMode"
        type="single"
        data-test="sessions-list-filter-mode"
        @update:model-value="onFilterModeChange"
      >
        <OToggleGroupItem value="agent" size="sm">{{ t('traces.sessionsList.agent') }}</OToggleGroupItem>
        <OToggleGroupItem value="stream" size="sm">{{ t('traces.sessionsList.stream') }}</OToggleGroupItem>
      </OToggleGroup>

      <div
        v-if="filterMode === 'stream'"
        data-test="sessions-list-stream-selector"
        class="w-56 flex-shrink-0"
      >
        <OSelect
          :model-value="streamsLoaded ? activeStream : ''"
          :label="t('traces.sessionsList.streamLabel')"
          label-position="inside"
          :options="availableStreams.map((s) => ({ label: s, value: s }))"
          labelKey="label"
          valueKey="value"
          :loading="!streamsLoaded"
          :placeholder="streamsLoaded ? undefined : t('traces.sessionsList.loadingStreams')"
          class="w-full rounded-default"
          @update:model-value="onStreamChange"
        />
      </div>
      <div
        v-else
        data-test="sessions-list-agent-selector"
        class="w-56 flex-shrink-0"
      >
        <OSelect
          :model-value="agentsLoaded ? activeAgent : ''"
          :label="t('traces.sessionsList.agent')"
          label-position="inside"
          :options="agentSelectOptions"
          labelKey="label"
          valueKey="value"
          :loading="!agentsLoaded"
          :placeholder="agentsLoaded ? undefined : t('traces.sessionsList.loadingAgents')"
          class="w-full rounded-default"
          @update:model-value="onAgentChange"
        />
      </div>
    </div>

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
      class="w-full h-full"
      data-test="sessions-list-table"
      :get-row-style="sessionRowStyle"
      :row-class="sessionRowClass"
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
        <div
          v-else
          class="flex items-center justify-center py-12"
          data-test="sessions-empty"
        >
          <OEmptyState size="hero" preset="no-llm-sessions" @action="onEmptyAction" />
        </div>
      </template>
        <!-- Timestamp — relative recency ("5 min ago"), full datetime on hover. -->
        <template #cell-firstSeenNanos="{ row }">
          <OTimeCell
            :value="row.firstSeenNanos"
            unit="ns"
            mode="relative"
            empty-label="—"
          />
        </template>

        <!-- Session ID -->
        <template #cell-sessionId="{ row }">
          <div class="text-xs truncate w-full">
            {{ row.sessionId }}
            <OTooltip :content="row.sessionId" />
          </div>
        </template>

        <!-- User -->
        <template #cell-userId="{ row }">
          <OUserCell
            :value="row.userId"
            :empty-label="t('traces.sessionsList.unknownUser')"
          />
        </template>

        <!-- First user message -->
        <template #cell-firstUserMessage="{ row }">
          <div
            v-if="row.firstUserMessage"
            class="text-xs text-text-secondary truncate w-full"
          >
            {{ row.firstUserMessage }}
            <OTooltip :content="row.firstUserMessage" />
          </div>
          <span v-else class="text-xs text-text-muted">—</span>
        </template>

        <!-- Turns -->
        <template #cell-turns="{ row }">
          <span class="text-xs">{{ row.turns }}</span>
        </template>

        <!-- Duration -->
        <template #cell-durationNanos="{ row }">
          <span class="text-xs">
            {{ formatDuration(row.durationNanos) }}
            <OTooltip :content="`${row.durationNanos.toLocaleString()} ${t('traces.sessionsList.durationNs')}`" />
          </span>
        </template>

        <!-- Tokens -->
        <template #cell-tokens="{ row }">
          <span class="text-xs tabular-nums">
            {{ formatTokens(row.inputTokens) }} → {{ formatTokens(row.outputTokens) }} = {{ formatTokens(row.tokens) }}
            <OTooltip :content="t('traces.sessionsList.tokenTooltip', { input: row.inputTokens.toLocaleString(), output: row.outputTokens.toLocaleString(), total: row.tokens.toLocaleString() })" />
          </span>
        </template>

        <!-- Cost -->
        <template #cell-cost="{ row }">
          <span class="text-xs">${{ row.cost.toFixed(4) }}</span>
        </template>

        <!-- Status (derived from error_count) — the error count rides INSIDE the
             chip as a trailing segment (hidden when 0), so the count is the
             primary signal without a second element beside the pill. -->
        <template #cell-status="{ row }">
          <OTag
            type="sessionStatus"
            :value="row.status"
            :count="row.errorCount"
            hide-zero-count
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
import { useI18n } from "vue-i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import useStreams from "@/composables/useStreams";
import { useSessions, type SessionRow } from "./composables/useSessions";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import type { AcceptableValue } from "reka-ui";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import genAiAgentMappingService, {
  type GenAiAgentListItem,
} from "@/services/gen-ai-agent-mapping.service";
import {
  ALL_AGENTS_VALUE,
  agentOptionKey,
  buildAgentSessionFilter,
} from "./llmAgentFilter";
import {
  splitNumberWithUnit,
  splitDuration,
} from "./llmInsightsDashboard.utils";

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
const { getStreams } = useStreams();
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

const availableStreams = ref<string[]>([]);
const streamsLoaded = ref(false);
const activeStream = ref<string>(
  urlStream || localStorage.getItem(STREAM_LS_KEY) || props.streamName || "",
);
const MODE_LS_KEY = "sessionsList_filterMode";
const AGENT_LS_KEY = "sessionsList_agentFilter";
// Default scope is "agent" — the AI module is agent-centric. Explicit choices
// still win (URL `?type=`, then saved localStorage preference); the agent
// default applies only when neither is present.
const filterMode = ref<"stream" | "agent">(
  urlType === "agent"
    ? "agent"
    : urlType === "stream"
      ? "stream"
      : localStorage.getItem(MODE_LS_KEY) === "stream"
        ? "stream"
        : "agent",
);
const activeAgent = ref<string>(localStorage.getItem(AGENT_LS_KEY) || ALL_AGENTS_VALUE);
// `agents` / `agentsLoaded` are module-scoped (see useSessions) so the agent
// picker keeps its options — and stays off its skeleton — across a remount.
const pendingAgentName = ref<string | null>(
  filterMode.value === "agent" && urlAgentName ? urlAgentName : null,
);

// Server-side pagination (1-indexed). OTable owns the footer controls in
// `pagination="server"` mode and emits `pagination-change`; `currentPage` /
// `rowsPerPage` come from useSessions (module-scoped) so the page/size survives
// the unmount/remount cycle and stays in sync with the restored rows.
// Page-size options match the dashboards' table pagination
// (TablePaginationControls) so the AI module stays consistent.
const rowsPerPageOptions = [20, 50, 100, 250, 500];

const agentSelectOptions = computed(() =>
  agents.value.map((agent) => ({
    label: agent.id ? `${agent.name} (${agent.id})` : agent.name,
    value: agentOptionKey(agent),
  })),
);

const selectedAgent = computed<GenAiAgentListItem | null>(() => {
  if (activeAgent.value === ALL_AGENTS_VALUE) return null;
  return agents.value.find((agent) => agentOptionKey(agent) === activeAgent.value) ?? null;
});

const effectiveStream = computed(() =>
  filterMode.value === "agent"
    ? (selectedAgent.value?.source_stream ?? "")
    : activeStream.value,
);
const effectiveAgent = computed<GenAiAgentListItem | null>(() =>
  filterMode.value === "agent" ? selectedAgent.value : null,
);
const agentFilterClause = computed(() =>
  buildAgentSessionFilter(effectiveAgent.value, effectiveStream.value),
);
const agentEmpty = computed(
  () => filterMode.value === "agent" && agentsLoaded.value && agents.value.length === 0,
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
const tableColumns = computed(() => [
  {
    id: "firstSeenNanos",
    header: t('traces.sessionsList.columns.timestamp'),
    accessorKey: "firstSeenNanos",
    size: 170,
    sortable: false,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "sessionId",
    header: t('traces.sessionsList.columns.sessionId'),
    accessorKey: "sessionId",
    size: 250,
    sortable: false,
    meta: { align: "left" },
  },
  {
    id: "userId",
    header: t('traces.sessionsList.columns.user'),
    accessorKey: "userId",
    size: 110,
    sortable: false,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "firstUserMessage",
    header: t('traces.sessionsList.columns.firstMessage'),
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
    header: t('traces.sessionsList.columns.turns'),
    accessorKey: "turns",
    size: 50,
    sortable: false,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "durationNanos",
    header: t('traces.sessionsList.columns.duration'),
    accessorKey: "durationNanos",
    size: 90,
    sortable: false,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "tokens",
    header: t('traces.sessionsList.columns.tokens'),
    accessorKey: "tokens",
    size: 150,
    minSize: 150,
    sortable: false,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "cost",
    header: t('traces.sessionsList.columns.cost'),
    accessorKey: "cost",
    size: 100,
    sortable: false,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "status",
    header: t('traces.sessionsList.columns.status'),
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
})));

// Exception-only rail: paint the extreme-left edge red on sessions that errored
// (errorCount > 0), leaving clean sessions unmarked — so a failed session pops
// out of a long list at a glance. Mirrors the Alerts / Incidents row rail.
function sessionRowStyle(row: SessionRow): Record<string, string> {
  if (!row || (row.errorCount ?? 0) <= 0) return {};
  return { boxShadow: "inset 0.25rem 0 0 0 var(--color-error-500)" };
}

// Light exception wash on the whole row for errored sessions (matches the Alerts
// list) — clean sessions stay unwashed, so attention goes to the failures.
function sessionRowClass(row: SessionRow): string {
  return row && (row.errorCount ?? 0) > 0 ? "!bg-status-error-bg" : "";
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


// Load the trace-stream list at most once per mount. Both the initial mount
// and the (parent-driven) session load await the SAME promise, so a load can
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

async function loadAgents(startTime?: number, endTime?: number) {
  const orgId = store.state.selectedOrganization?.identifier;
  const start = startTime ?? props.startTime;
  const end = endTime ?? props.endTime;
  if (!orgId || !start || !end) return;
  agentsLoaded.value = false;
  try {
    const agentList = await genAiAgentMappingService.listAgents(orgId, start, end);
    agents.value = agentList.agents;
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

async function loadSessions(
  startTime?: number,
  endTime?: number,
  force = false,
) {
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
    if (pendingAgentName.value) {
      const match = agents.value.find((agent) => agent.name === pendingAgentName.value);
      if (match) activeAgent.value = agentOptionKey(match);
      pendingAgentName.value = null;
    }
    if (!selectedAgent.value && agents.value.length > 0) {
      activeAgent.value = agentOptionKey(agents.value[0]);
    }
    localStorage.setItem(AGENT_LS_KEY, activeAgent.value);
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
function onStreamChange(val?: AcceptableValue | AcceptableValue[] | boolean) {
  activeStream.value = typeof val === "string" ? val : "";
  currentPage.value = 1;
  loadSessions(undefined, undefined, true);
}

function onFilterModeChange(
  mode?: AcceptableValue | AcceptableValue[] | boolean,
) {
  const next = mode === "agent" ? "agent" : "stream";
  if (next === filterMode.value) return;
  filterMode.value = next;
  currentPage.value = 1;
  clearSessionRows();
  loadSessions(undefined, undefined, true);
}

function onAgentChange(val?: AcceptableValue | AcceptableValue[] | boolean) {
  activeAgent.value = typeof val === "string" ? val : ALL_AGENTS_VALUE;
  currentPage.value = 1;
  loadSessions(undefined, undefined, true);
}

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
  { id: "sessionsRefresh", handler: () => { if (!isInputFocused()) refresh(); } },
]);
</script>
