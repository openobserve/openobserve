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
    class="sessions-list tw:h-full! tw:flex tw:flex-col tw:bg-[var(--o2-card-bg-solid)] card-container"
  >
    <!-- No LLM streams exist in the org at all — nothing to select, so show
         the rich first-run empty state on its own (no table chrome). -->
    <div
      v-if="streamsLoaded && availableStreams.length === 0"
      class="tw:flex-1 tw:min-h-0 tw:flex tw:items-center tw:justify-center"
      data-test="sessions-empty-no-streams"
    >
      <OEmptyState size="hero" preset="no-llm-sessions" @action="onEmptyAction" />
    </div>

    <!-- Streams exist: OTable owns the whole surface — toolbar (stream filter +
         column chooser), server-side pagination footer, column resize, and the
         empty/error body. Rendering it unconditionally keeps the stream
         selector reachable even when a window returns no sessions. -->
    <OTable
      v-else
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
      class="tw:w-full tw:h-full"
      data-test="sessions-list-table"
      @row-click="(row: any) => handleRowClick(row)"
      @pagination-change="onPaginationChange"
    >
      <!-- Toolbar: Stream/Agent mode + matching picker aligned with the table actions. -->
      <template #toolbar>
        <div class="tw:flex tw:items-center tw:justify-end tw:gap-2 tw:flex-1 tw:min-w-0">
          <!-- Toggle-shaped skeleton during the initial load so the whole
               toolbar (toggle + picker) appears at once, not the toggle first
               then the picker. -->
          <SkeletonBox
            v-if="!streamsLoaded"
            width="7.25rem"
            height="2.125rem"
            rounded
          />
          <OToggleGroup
            v-else
            :model-value="filterMode"
            type="single"
            data-test="sessions-list-filter-mode"
            @update:model-value="onFilterModeChange"
          >
            <OToggleGroupItem value="stream" size="sm">Stream</OToggleGroupItem>
            <OToggleGroupItem value="agent" size="sm">Agent</OToggleGroupItem>
          </OToggleGroup>

          <div class="tw:flex tw:items-center tw:justify-end tw:gap-2 tw:min-w-0">
            <div
              v-if="filterMode === 'stream'"
              data-test="sessions-list-stream-selector"
              class="tw:w-[14rem] tw:flex-shrink-0"
            >
              <!-- Hold a picker-shaped skeleton until the stream list lands, so
                   the selector doesn't flash an empty dropdown then populate. -->
              <SkeletonBox
                v-if="!streamsLoaded"
                width="100%"
                height="2.125rem"
                rounded
              />
              <OSelect
                v-else
                v-model="activeStream"
                :label="t('traces.sessionsList.streamLabel')"
                label-position="inside"
                :options="availableStreams.map((s) => ({ label: s, value: s }))"
                labelKey="label"
                valueKey="value"
                class="tw:w-full tw:rounded"
                @update:model-value="onStreamChange"
              />
            </div>
            <div
              v-else
              data-test="sessions-list-agent-selector"
              class="tw:w-[14rem] tw:flex-shrink-0"
            >
              <!-- Same treatment for agents: toggling to Agent mode kicks off the
                   listAgents fetch, so show the skeleton until it resolves
                   instead of an empty agent picker. -->
              <SkeletonBox
                v-if="!agentsLoaded"
                width="100%"
                height="2.125rem"
                rounded
              />
              <OSelect
                v-else
                v-model="activeAgent"
                label="Agent"
                label-position="inside"
                :options="agentSelectOptions"
                labelKey="label"
                valueKey="value"
                class="tw:w-full tw:rounded"
                @update:model-value="onAgentChange"
              />
            </div>
          </div>
        </div>
      </template>

      <!-- Empty / error body — rendered inside the frame so the toolbar (and
           thus the stream selector) stays visible. -->
      <template #empty>
        <EvalEmptyState
          v-if="error && hasLoadedOnce"
          data-test="sessions-empty-error"
          icon="error-outline"
          :title="t('traces.sessionsList.failedToLoad')"
          :description="error || ''"
          :cta-label="t('traces.sessionsList.retry')"
          cta-data-test="sessions-empty-retry-btn"
          @create="loadSessions()"
        />
        <EvalEmptyState
          v-else-if="agentEmpty"
          data-test="sessions-empty-no-agents"
          icon="groups"
          title="No Agents In This Range"
          description="No GenAI agents were detected for the selected time window. Try a wider range or switch back to stream view."
          cta-label="View by Stream"
          @create="onFilterModeChange('stream')"
        />
        <div
          v-else
          class="tw:flex tw:items-center tw:justify-center tw:py-12"
          data-test="sessions-empty"
        >
          <OEmptyState size="hero" preset="no-llm-sessions" @action="onEmptyAction" />
        </div>
      </template>
        <!-- Timestamp -->
        <template #cell-firstSeenNanos="{ row }">
          <span class="tw:text-[0.75rem] tw:tabular-nums">
            {{ formatTimestamp(row.firstSeenNanos) }}
          </span>
        </template>

        <!-- Session ID -->
        <template #cell-sessionId="{ row }">
          <div class="tw:text-[0.75rem] tw:truncate tw:w-full">
            {{ row.sessionId }}
            <OTooltip :content="row.sessionId" />
          </div>
        </template>

        <!-- User -->
        <template #cell-userId="{ row }">
          <span
            v-if="row.userId"
            class="tw:text-[0.75rem] tw:text-[var(--o2-text-primary)] tw:truncate tw:max-w-[100px] tw:block"
          >
            {{ row.userId }}
          </span>
          <span v-else class="tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]">
            {{ t('traces.sessionsList.unknownUser') }}
          </span>
        </template>

        <!-- First user message -->
        <template #cell-firstUserMessage="{ row }">
          <div
            v-if="row.firstUserMessage"
            class="tw:text-[0.75rem] tw:text-[var(--o2-text-secondary)] tw:truncate tw:w-full"
          >
            {{ row.firstUserMessage }}
            <OTooltip :content="row.firstUserMessage" />
          </div>
          <span v-else class="tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]">—</span>
        </template>

        <!-- Turns -->
        <template #cell-turns="{ row }">
          <span class="tw:text-[0.75rem]">{{ row.turns }}</span>
        </template>

        <!-- Duration -->
        <template #cell-durationNanos="{ row }">
          <span class="tw:text-[0.75rem]">
            {{ formatDuration(row.durationNanos) }}
            <OTooltip :content="`${row.durationNanos.toLocaleString()} ${t('traces.sessionsList.durationNs')}`" />
          </span>
        </template>

        <!-- Tokens -->
        <template #cell-tokens="{ row }">
          <span class="tw:text-[0.75rem] tw:tabular-nums">
            {{ formatTokens(row.inputTokens) }} → {{ formatTokens(row.outputTokens) }} = {{ formatTokens(row.tokens) }}
            <OTooltip :content="t('traces.sessionsList.tokenTooltip', { input: row.inputTokens.toLocaleString(), output: row.outputTokens.toLocaleString(), total: row.tokens.toLocaleString() })" />
          </span>
        </template>

        <!-- Cost -->
        <template #cell-cost="{ row }">
          <span class="tw:text-[0.75rem]">${{ row.cost.toFixed(4) }}</span>
        </template>

        <!-- Status (derived from error_count) -->
        <template #cell-status="{ row }">
          <span
            class="tw:rounded tw:px-[0.5rem] tw:py-[0.125rem] tw:inline-flex tw:items-center tw:gap-[0.25rem] tw:w-fit tw:text-[0.7rem] tw:font-semibold tw:capitalize"
            :class="statusBadgeClass(row.status)"
            :data-test="`sessions-list-status-${row.sessionId}`"
          >
            <span
              class="tw:w-[6px] tw:h-[6px] tw:rounded-full"
              :class="statusDotClass(row.status)"
            />
            {{ row.status }}
          </span>
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
import useStreams from "@/composables/useStreams";
import { useSessions, type SessionRow } from "./composables/useSessions";
import EvalEmptyState from "@/components/EvalEmptyState.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
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
const filterMode = ref<"stream" | "agent">(
  urlType === "agent"
    ? "agent"
    : urlType === "stream"
      ? "stream"
      : localStorage.getItem(MODE_LS_KEY) === "agent"
        ? "agent"
        : "stream",
);
const activeAgent = ref<string>(localStorage.getItem(AGENT_LS_KEY) || ALL_AGENTS_VALUE);
const agents = ref<GenAiAgentListItem[]>([]);
const agentsLoaded = ref(false);
const pendingAgentName = ref<string | null>(
  filterMode.value === "agent" && urlAgentName ? urlAgentName : null,
);

// Server-side pagination state (1-indexed). OTable owns the footer controls
// in `pagination="server"` mode and emits `pagination-change`; these refs are
// the source of truth it reads back via `:current-page` / `:page-size`.
const currentPage = ref(1);
const rowsPerPage = ref(25);
const rowsPerPageOptions = [10, 25, 50, 100];

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
    size: 160,
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
    meta: { align: "left" },
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
    size: 200,
    minSize: 150,
    sortable: false,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "cost",
    header: t('traces.sessionsList.columns.cost'),
    accessorKey: "cost",
    size: 100,
    sortable: false,
    hideable: true,
    meta: { align: "left" },
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

function formatTimestamp(nanos: number): string {
  if (!nanos) return "—";
  // Backend ships timestamps as nanoseconds — quasar's date wants ms.
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

function statusBadgeClass(s: SessionRow["status"]): string {
  switch (s) {
    case "error":
      return "tw:bg-[color-mix(in_srgb,var(--o2-service-health-critical)_12%,transparent)] tw:text-[var(--o2-service-health-critical)]";
    default:
      return "tw:bg-[color-mix(in_srgb,var(--o2-service-health-healthy,#16a34a)_12%,transparent)] tw:text-[var(--o2-service-health-healthy,#16a34a)]";
  }
}

function statusDotClass(s: SessionRow["status"]): string {
  switch (s) {
    case "error":
      return "tw:bg-[var(--o2-service-health-critical)]";
    default:
      return "tw:bg-emerald-500";
  }
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

async function loadSessions(startTime?: number, endTime?: number) {
  const start = startTime ?? props.startTime;
  const end = endTime ?? props.endTime;
  if (!start || !end) return;
  localStorage.setItem(MODE_LS_KEY, filterMode.value);

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
    loadAgents(start, end);
  }

  syncFilterUrl();

  const stream = effectiveStream.value;
  if (!stream) {
    clearSessionRows();
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

function onStreamChange() {
  currentPage.value = 1;
  loadSessions();
}

function onFilterModeChange(mode?: string | number | null) {
  const next = mode === "agent" ? "agent" : "stream";
  if (next === filterMode.value) return;
  filterMode.value = next;
  currentPage.value = 1;
  clearSessionRows();
  loadSessions();
}

function onAgentChange() {
  currentPage.value = 1;
  loadSessions();
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
  loadSessions();
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

async function refresh(startTime?: number, endTime?: number) {
  currentPage.value = 1;
  await loadSessions(startTime, endTime);
}

defineExpose({ refresh });

onMounted(async () => {
  if (!streamsLoaded.value) {
    await loadTraceStreams();
  }
  if (activeStream.value || filterMode.value === "agent") {
    loadSessions();
  }
});

onUnmounted(() => {
  cancelAll();
});
</script>
