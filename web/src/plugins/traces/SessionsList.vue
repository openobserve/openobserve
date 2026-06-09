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
    class="sessions-list tw:h-full! tw:flex tw:flex-col tw:bg-[var(--o2-card-bg-solid)] card-container tw:px-[0.625rem]"
  >
    <!-- Toolbar: stream selector + count pill + pagination.
         Padding mirrors LLMInsightsDashboard so the upper band height is
         consistent across the AI Observability sections. -->
    <div class="tw:flex tw:items-center tw:gap-[0.5rem] tw:py-[0.5rem]">
      <!-- Stream selector — hidden when there are no LLM streams (empty state is shown below) -->
      <div
        v-if="availableStreams.length > 0"
        data-test="sessions-list-stream-selector"
        class="tw:w-[14rem] tw:flex-shrink-0"
      >
        <OSelect
          v-model="activeStream"
          :options="availableStreams.map((s) => ({ label: s, value: s }))"
          class="tw:w-[auto] tw:flex-shrink-0 tw:rounded"
          @update:model-value="onStreamChange"
        />
      </div>

      <!-- Count pill -->
      <template v-if="!loading && sessions.length > 0">
        <div
          class="tw:flex tw:items-center tw:gap-[0.375rem] tw:px-[0.625rem] tw:py-[0.25rem] tw:rounded tw:text-[0.75rem] tw:text-[var(--o2-text-4)] tw:bg-[var(--o2-tag-grey-1)]"
          data-test="sessions-list-count-pill"
        >
          {{ t('traces.sessionsList.countPill', { count: sessions.length, total, unit: total === 1 ? t('traces.sessionsList.session') : t('traces.sessionsList.sessions') }) }}
        </div>
      </template>

      <!-- Pagination controls -->
      <div
        v-if="total > 0"
        class="tw:flex tw:items-center tw:justify-end tw:px-[0.5rem] tw:py-[0.25rem] tw:ml-auto"
        data-test="sessions-list-pagination-bar"
      >
        <OSelect
          v-model="rowsPerPage"
          :options="rowsPerPageOptions"
          class="select-pagination tw:mr-[0.25rem] tw:mt-0!"
          size="sm"
          data-test="sessions-list-records-per-page"
          @update:model-value="changeRowsPerPage"
        />
        <OPagination
          v-model="currentPage"
          :max="totalPages"
          :max-pages="5"
          class="float-right paginator-section tw:mt-0!"
          data-test="sessions-list-pagination"
          @update:model-value="changePage"
        />
      </div>
    </div>

    <!-- Shared EvalEmptyState shell (same design language used by every
         Evaluate-tab page and LLM Insights), so the empty states across
         the AI Observability section look identical. -->

    <!-- No LLM streams in this org -->
    <EvalEmptyState
      v-if="streamsLoaded && availableStreams.length === 0"
      data-test="sessions-empty-no-streams"
      icon="forum"
      :title="t('traces.sessionsList.noStreamsFound')"
      :description="`${t('traces.sessionsList.noStreamsDescription1')} gen_ai_conversation_id ${t('traces.sessionsList.noStreamsDescription2')}`"
    />

    <!-- Generic error -->
    <EvalEmptyState
      v-else-if="error && hasLoadedOnce"
      data-test="sessions-empty-error"
      icon="error-outline"
      :title="t('traces.sessionsList.failedToLoad')"
      :description="error || ''"
      :cta-label="t('traces.sessionsList.retry')"
      cta-data-test="sessions-empty-retry-btn"
      @create="loadSessions()"
    />

    <!-- Empty state — query succeeded but no sessions in this window -->
    <EvalEmptyState
      v-else-if="hasLoadedOnce && !loading && sessions.length === 0"
      data-test="sessions-empty-no-data"
      icon="forum"
      :title="t('traces.sessionsList.noSessionsFound')"
      :description="t('traces.sessionsList.noSessionsDescription', { stream: activeStream })"
    />

    <!-- Table — OTable with built-in loading skeleton + own pagination
         disabled (the toolbar above already drives `currentPage` /
         `rowsPerPage`). Empty/error cases are handled by the
         EvalEmptyState branches above, so we never render this block
         with zero rows. -->
    <div
      v-else
      class="tw:w-full tw:relative tw:flex-1 tw:min-h-0 tw:flex"
    >
      <OTable
        :data="sessions"
        :columns="tableColumns"
        :loading="loading"
        row-key="sessionId"
        :show-global-filter="false"
        pagination="none"
        :frame="false"
        class="tw:w-full tw:h-full"
        data-test="sessions-list-table"
        @row-click="(row: any) => handleRowClick(row)"
      >
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
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPagination from "@/lib/navigation/Pagination/OPagination.vue";
import {
  splitNumberWithUnit,
  splitDuration,
} from "./llmInsightsDashboard.utils";

interface Props {
  streamName: string;
  startTime: number; // microseconds
  endTime: number; // microseconds
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

// Server-side pagination state (1-indexed for q-pagination).
const currentPage = ref(1);
const rowsPerPage = ref(25);
const rowsPerPageOptions = [10, 25, 50, 100];

const totalPages = computed(() =>
  total.value && rowsPerPage.value
    ? Math.max(1, Math.ceil(total.value / rowsPerPage.value))
    : 1,
);

watch(totalPages, (n) => {
  // Clamp the page when the total shrinks (e.g. after a re-fetch with
  // fewer matches than before).
  if (currentPage.value > n) currentPage.value = n;
});

const tableColumns = computed(() => [
  {
    id: "firstSeenNanos",
    header: t('traces.sessionsList.columns.timestamp'),
    accessorKey: "firstSeenNanos",
    size: 170,
    sortable: false,
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
    meta: { align: "left" },
  },
  {
    id: "firstUserMessage",
    header: t('traces.sessionsList.columns.firstMessage'),
    accessorKey: "firstUserMessage",
    size: 200,
    sortable: false,
    meta: { align: "left" },
  },
  {
    id: "turns",
    header: t('traces.sessionsList.columns.turns'),
    accessorKey: "turns",
    size: 90,
    sortable: false,
    meta: { align: "center" },
  },
  {
    id: "durationNanos",
    header: t('traces.sessionsList.columns.duration'),
    accessorKey: "durationNanos",
    size: 120,
    sortable: false,
    meta: { align: "center" },
  },
  {
    id: "tokens",
    header: t('traces.sessionsList.columns.tokens'),
    accessorKey: "tokens",
    size: 250,
    sortable: false,
    meta: { align: "center" },
  },
  {
    id: "cost",
    header: t('traces.sessionsList.columns.cost'),
    accessorKey: "cost",
    size: 100,
    sortable: false,
    meta: { align: "center" },
  },
  {
    id: "status",
    header: t('traces.sessionsList.columns.status'),
    accessorKey: "status",
    size: 100,
    sortable: false,
    meta: { align: "center", disableCellAction: true },
  },
]);

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

function changePage(page: number) {
  currentPage.value = page;
  loadSessions();
}

function changeRowsPerPage(val: number) {
  rowsPerPage.value = val;
  currentPage.value = 1;
  loadSessions();
}

function handleRowClick(row: SessionRow) {
  emit("sessionSelected", row);
  router.push({
    name: "sessionDetails",
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

<style lang="scss" scoped>
.sessions-list {
  // Match ServicesCatalog: card surface, scoped paginator + selector
  // styles so we inherit the global table theme from TenstackTable.
  :deep(.paginator-section .q-btn) {
    min-width: 1.5rem;
    min-height: 1.5rem;
  }

  :deep(.select-pagination .q-field__control) {
    min-height: 1.75rem;
  }
}
</style>
