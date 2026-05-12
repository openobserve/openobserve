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
    <!-- Toolbar: stream selector + count pill + pagination -->
    <div class="tw:flex tw:items-center tw:gap-2 tw:py-[0.625rem]">
      <!-- Stream selector -->
      <div
        data-test="sessions-list-stream-selector"
        class="tw:w-[14rem] tw:flex-shrink-0"
      >
        <q-select
          v-model="activeStream"
          :options="
            availableStreams.length > 0
              ? availableStreams.map((s) => ({ label: s, value: s }))
              : []
          "
          dense
          borderless
          emit-value
          map-options
          class="tw:w-[auto] tw:flex-shrink-0 tw:rounded"
          @update:model-value="onStreamChange"
          :disable="availableStreams.length === 0"
        >
          <q-tooltip v-if="availableStreams.length === 0">
            No LLM streams available.
          </q-tooltip>
        </q-select>
      </div>

      <!-- Count pill -->
      <template v-if="!loading && sessions.length > 0">
        <div
          class="tw:flex tw:items-center tw:gap-[0.375rem] tw:px-[0.625rem] tw:py-[0.25rem] tw:rounded tw:text-[0.75rem] tw:text-[var(--o2-text-4)] tw:bg-[var(--o2-tag-grey-1)]"
          data-test="sessions-list-count-pill"
        >
          {{ sessions.length }} of {{ total }}
          {{ total === 1 ? "session" : "sessions" }}
        </div>
      </template>

      <!-- Pagination controls -->
      <div
        v-if="total > 0"
        class="row items-center tw:justify-end tw:px-[0.5rem] tw:py-[0.25rem] tw:ml-auto"
        data-test="sessions-list-pagination-bar"
      >
        <q-select
          v-model="rowsPerPage"
          :options="rowsPerPageOptions"
          class="select-pagination tw:mr-[0.25rem] tw:mt-0!"
          size="sm"
          dense
          borderless
          data-test="sessions-list-records-per-page"
          @update:model-value="changeRowsPerPage"
        />
        <q-pagination
          v-model="currentPage"
          :max="totalPages"
          :input="false"
          direction-links
          :boundary-numbers="false"
          :max-pages="5"
          :ellipses="false"
          icon-first="skip_previous"
          icon-last="skip_next"
          icon-prev="fast_rewind"
          icon-next="fast_forward"
          class="float-right paginator-section tw:mt-0!"
          data-test="sessions-list-pagination"
          @update:model-value="changePage"
        />
      </div>
    </div>

    <!-- No LLM streams in this org -->
    <div
      v-if="streamsLoaded && availableStreams.length === 0"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:flex-1 tw:text-[var(--o2-text-secondary)] tw:text-center"
    >
      <q-icon name="forum" size="3rem" class="tw:mb-3 tw:opacity-40" />
      <div class="tw:text-base tw:text-[var(--o2-text-primary)] tw:mb-2">
        No LLM streams found
      </div>
      <p class="tw:text-sm tw:max-w-[30rem]">
        Sessions group spans by <code>gen_ai_conversation_id</code> across
        traces streams marked as LLM streams. Either no such stream exists,
        or no spans have been ingested yet.
      </p>
    </div>

    <!-- Generic error -->
    <div
      v-else-if="error && hasLoadedOnce"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:flex-1 tw:text-center"
    >
      <q-icon
        name="error_outline"
        size="3rem"
        class="tw:mb-3 tw:text-[var(--o2-status-error-text)]"
      />
      <div class="tw:text-base tw:text-[var(--o2-text-primary)] tw:mb-2">
        Failed to load sessions
      </div>
      <div
        class="tw:text-sm tw:text-[var(--o2-text-muted)] tw:mb-3 tw:max-w-[30rem]"
      >
        {{ error }}
      </div>
      <OButton variant="outline" size="sm" @click="loadSessions()">
        Retry
      </OButton>
    </div>

    <!-- Table -->
    <div
      v-else
      class="tw:w-full tw:h-auto! tw:overflow-x-auto tw:relative tw:flex-1"
    >
      <TenstackTable
        class="tw:h-auto!"
        :rows="sessions"
        :columns="tableColumns"
        :loading="loading"
        :row-height="32"
        :enable-column-reorder="true"
        :enable-row-expand="false"
        :enable-text-highlight="false"
        :enable-status-bar="false"
        :default-columns="false"
        data-test="sessions-list-table"
        @click:dataRow="handleRowClick"
      >
        <!-- Timestamp -->
        <template #cell-firstSeenMicros="{ item }">
          <span class="tw:font-mono tw:text-[0.75rem]">
            {{ formatTimestamp(item.firstSeenMicros) }}
          </span>
        </template>

        <!-- Session ID -->
        <template #cell-sessionId="{ item }">
          <span class="tw:font-mono tw:text-[0.75rem]">
            {{ shortId(item.sessionId) }}
            <q-tooltip>{{ item.sessionId }}</q-tooltip>
          </span>
        </template>

        <!-- Turns -->
        <template #cell-turns="{ item }">
          <span class="tw:text-[0.75rem]">{{ item.turns }}</span>
        </template>

        <!-- Duration -->
        <template #cell-durationMicros="{ item }">
          <span class="tw:text-[0.75rem]">
            {{ formatDuration(item.durationMicros) }}
            <q-tooltip
              >{{ item.durationMicros.toLocaleString() }} µs</q-tooltip
            >
          </span>
        </template>

        <!-- Tokens -->
        <template #cell-tokens="{ item }">
          <span class="tw:text-[0.75rem]">
            {{ formatTokens(item.tokens) }}
            <q-tooltip>{{ item.tokens.toLocaleString() }}</q-tooltip>
          </span>
        </template>

        <!-- Cost -->
        <template #cell-cost="{ item }">
          <span class="tw:text-[0.75rem]">${{ item.cost.toFixed(4) }}</span>
        </template>

        <!-- Initial loading -->
        <template #loading>
          <div
            data-test="sessions-list-loading"
            class="row no-wrap items-center q-px-sm tw:min-w-max tw:min-h-[3.25rem] tw:bg-[var(--o2-card-bg)] tw:border-b tw:border-[var(--o2-border-2)]!"
          >
            <q-spinner-hourglass
              color="primary"
              size="1.25rem"
              class="tw:mr-[0.25rem]"
            />
            <span
              class="tw:tracking-[0.03rem] tw:text-[0.85rem] tw:text-[var(--o2-text-1)] tw:font-bold"
            >
              Loading sessions…
            </span>
          </div>
        </template>

        <template #empty />
      </TenstackTable>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { date } from "quasar";
import TenstackTable from "@/components/TenstackTable.vue";
import useStreams from "@/composables/useStreams";
import { useSessions, type SessionRow } from "./composables/useSessions";
import OButton from "@/lib/core/Button/OButton.vue";
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
    id: "firstSeenMicros",
    header: "Timestamp",
    accessorKey: "firstSeenMicros",
    size: 170,
    enableSorting: false,
    meta: { slot: true, align: "left" },
  },
  {
    id: "sessionId",
    header: "Session ID",
    accessorKey: "sessionId",
    size: 200,
    enableSorting: false,
    meta: { slot: true, align: "left" },
  },
  {
    id: "turns",
    header: "Turns",
    accessorKey: "turns",
    size: 90,
    enableSorting: false,
    meta: { slot: true, align: "right" },
  },
  {
    id: "durationMicros",
    header: "Duration",
    accessorKey: "durationMicros",
    size: 120,
    enableSorting: false,
    meta: { slot: true, align: "right" },
  },
  {
    id: "tokens",
    header: "Tokens",
    accessorKey: "tokens",
    size: 110,
    enableSorting: false,
    meta: { slot: true, align: "right" },
  },
  {
    id: "cost",
    header: "Cost",
    accessorKey: "cost",
    size: 100,
    enableSorting: false,
    meta: { slot: true, align: "right" },
  },
]);

function formatTimestamp(micros: number): string {
  if (!micros) return "—";
  return date.formatDate(Math.floor(micros / 1000), "YYYY-MM-DD HH:mm:ss");
}

function shortId(id: string): string {
  if (!id) return "—";
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-5)}`;
}

function formatDuration(micros: number): string {
  if (!micros) return "—";
  const d = splitDuration(micros);
  return `${d.value}${d.unit}`;
}

function formatTokens(n: number): string {
  if (!n) return "0";
  const t = splitNumberWithUnit(n);
  return `${t.value}${t.unit}`;
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
