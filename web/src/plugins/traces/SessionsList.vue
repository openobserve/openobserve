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
      <!-- Toolbar: stream filter pushed to the right; OTable auto-injects the
           column chooser immediately after it. -->
      <template #toolbar>
        <div class="tw:flex tw:items-center tw:justify-end tw:gap-2 tw:flex-1 tw:min-w-0">
          <div
            data-test="sessions-list-stream-selector"
            class="tw:w-[14rem] tw:flex-shrink-0"
          >
            <OSelect
              v-model="activeStream"
              :label="t('traces.sessionsList.streamLabel')"
              label-position="inside"
              :options="availableStreams.map((s) => ({ label: s, value: s }))"
              class="tw:w-[auto] tw:flex-shrink-0 tw:rounded"
              @update:model-value="onStreamChange"
            />
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
          <span class="tw:font-mono tw:text-[0.75rem]">
            {{ formatTimestamp(row.firstSeenNanos) }}
          </span>
        </template>

        <!-- Session ID -->
        <template #cell-sessionId="{ row }">
          <span class="tw:font-mono tw:text-[0.75rem]">
            {{ shortId(row.sessionId) }}
            <OTooltip :content="row.sessionId" />
          </span>
        </template>

        <!-- User -->
        <template #cell-userId="{ row }">
          <span
            v-if="row.userId"
            class="tw:text-[0.75rem] tw:text-[var(--o2-text-primary)] tw:truncate tw:max-w-[160px] tw:block"
          >
            {{ row.userId }}
          </span>
          <span v-else class="tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]">
            {{ t('traces.sessionsList.unknownUser') }}
          </span>
        </template>

        <!-- First user message -->
        <template #cell-firstUserMessage="{ row }">
          <span
            v-if="row.firstUserMessage"
            class="tw:text-[0.75rem] tw:text-[var(--o2-text-secondary)]"
          >
            {{ row.firstUserMessage.length > 30 ? row.firstUserMessage.slice(0, 30) + '…' : row.firstUserMessage }}
            <OTooltip v-if="row.firstUserMessage.length > 30" :content="row.firstUserMessage" />
          </span>
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
            {{ formatTokens(row.inputTokens) }} → {{ formatTokens(row.outputTokens) }} (Σ {{ formatTokens(row.tokens) }})
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
import { useRouter } from "vue-router";
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

const availableStreams = ref<string[]>([]);
const streamsLoaded = ref(false);
const activeStream = ref<string>(
  localStorage.getItem(STREAM_LS_KEY) || props.streamName || "",
);

// Server-side pagination state (1-indexed). OTable owns the footer controls
// in `pagination="server"` mode and emits `pagination-change`; these refs are
// the source of truth it reads back via `:current-page` / `:page-size`.
const currentPage = ref(1);
const rowsPerPage = ref(25);
const rowsPerPageOptions = [10, 25, 50, 100];

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
    size: 180,
    sortable: false,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "firstUserMessage",
    header: t('traces.sessionsList.columns.firstMessage'),
    accessorKey: "firstUserMessage",
    size: 200,
    sortable: false,
    hideable: true,
    meta: { align: "left", flex: true },
  },
  {
    id: "turns",
    header: t('traces.sessionsList.columns.turns'),
    accessorKey: "turns",
    size: 90,
    sortable: false,
    hideable: true,
    meta: { align: "center" },
  },
  {
    id: "durationNanos",
    header: t('traces.sessionsList.columns.duration'),
    accessorKey: "durationNanos",
    size: 120,
    sortable: false,
    hideable: true,
    meta: { align: "center" },
  },
  {
    id: "tokens",
    header: t('traces.sessionsList.columns.tokens'),
    accessorKey: "tokens",
    size: 250,
    sortable: false,
    hideable: true,
    meta: { align: "center" },
  },
  {
    id: "cost",
    header: t('traces.sessionsList.columns.cost'),
    accessorKey: "cost",
    size: 100,
    sortable: false,
    hideable: true,
    meta: { align: "center" },
  },
  {
    id: "status",
    header: t('traces.sessionsList.columns.status'),
    accessorKey: "status",
    size: 100,
    sortable: false,
    hideable: true,
    meta: { align: "center", disableCellAction: true },
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

function shortId(id: string): string {
  if (!id) return "—";
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-5)}`;
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

async function loadSessions(startTime?: number, endTime?: number) {
  const start = startTime ?? props.startTime;
  const end = endTime ?? props.endTime;
  if (!activeStream.value || !start || !end) return;
  localStorage.setItem(STREAM_LS_KEY, activeStream.value);
  await fetchPage(
    activeStream.value,
    start,
    end,
    currentPage.value - 1,
    rowsPerPage.value,
  );
}

function onStreamChange() {
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
      stream: activeStream.value,
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
  if (activeStream.value) {
    loadSessions();
  }
});

onUnmounted(() => {
  cancelAll();
});
</script>
