<!-- Copyright 2023 OpenObserve Inc.

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
  <div style="width: 50vw;" :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'">
    <!-- Header -->
    <q-card-section class="q-ma-none">
      <div class="row items-center no-wrap">
        <div class="col">
          <div class="tw-text-[18px] tw-flex tw-items-center" data-test="pipeline-history-title">
            {{ t("pipeline.history") }}
            <!-- Pipeline Name Badge -->
            <span
              :class="[
                'tw-font-bold tw-mr-4 tw-px-2 tw-py-1 tw-rounded-md tw-ml-2 tw-max-w-xs tw-truncate tw-inline-block',
                store.state.theme === 'dark'
                  ? 'tw-text-blue-400 tw-bg-blue-900/50'
                  : 'tw-text-blue-600 tw-bg-blue-50'
              ]"
            >
              {{ props.pipelineName }}
              <q-tooltip v-if="props.pipelineName && props.pipelineName.length > 20" class="tw-text-xs">
                {{ props.pipelineName }}
              </q-tooltip>
            </span>
            <!-- Pipeline Type Badge -->
            <div class="tw-flex tw-items-center tw-gap-2">
              <q-icon
                :name="props.pipelineType === 'realtime' ? 'bolt' : 'schedule'"
                size="20px"
                color="grey"
              >
                <q-tooltip>{{ props.pipelineType === 'realtime' ? 'Real-time' : 'Scheduled' }}</q-tooltip>
              </q-icon>
            </div>
          </div>
        </div>
        <div class="col-auto tw-flex tw-items-center tw-gap-2">
          <q-btn
            data-test="pipeline-history-refresh-btn"
            class="text-bold no-border o2-secondary-button tw-h-[36px]"
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            flat
            no-caps
            @click="refreshHistory"
            :loading="loading"
            :disable="loading"
          >
            <q-icon name="refresh" size="18px" />
            <span class="tw-ml-2">{{ t("common.refresh") }}</span>
          </q-btn>
          <q-btn
            data-test="pipeline-history-close-btn"
            v-close-popup="true"
            round
            flat
            dense
            icon="cancel"
          />
        </div>
      </div>
    </q-card-section>
    <q-separator />

    <!-- Stats Summary -->
    <q-card-section class="q-ma-none q-pa-md">
      <div class="tw-grid tw-grid-cols-4 tw-gap-2">
        <!-- Total Executions Tile -->
        <div class="tile" data-test="total-executions-tile">
          <div
            class="tile-content tw-rounded-lg tw-p-3 tw-text-center tw-border tw-shadow-sm tw-h-20 tw-flex tw-flex-col tw-justify-between"
            :class="store.state.theme === 'dark' ? 'tw-bg-gray-800/50 tw-border-gray-700' : 'tw-bg-white tw-border-gray-200'"
          >
            <div class="tile-header tw-flex tw-justify-between tw-items-start">
              <div
                class="tile-title tw-text-xs tw-font-bold tw-text-left"
                :class="store.state.theme === 'dark' ? 'tw-text-gray-400' : 'tw-text-gray-500'"
              >
                {{ t("pipeline.totalExecutions") }}
              </div>
            </div>
            <div
              class="tile-value tw-text-lg tw-flex tw-items-end tw-justify-start"
              :class="store.state.theme === 'dark' ? 'tw-text-white' : 'tw-text-gray-900'"
            >
              {{ stats?.total || 0 }}
            </div>
          </div>
        </div>

        <!-- Error Count Tile -->
        <div class="tile" data-test="error-count-tile">
          <div
            class="tile-content tw-rounded-lg tw-p-3 tw-text-center tw-border tw-shadow-sm tw-h-20 tw-flex tw-flex-col tw-justify-between"
            :class="store.state.theme === 'dark' ? 'tw-bg-gray-800/50 tw-border-gray-700' : 'tw-bg-white tw-border-gray-200'"
          >
            <div class="tile-header tw-flex tw-justify-between tw-items-start">
              <div
                class="tile-title tw-text-xs tw-font-bold tw-text-left"
                :class="store.state.theme === 'dark' ? 'tw-text-gray-400' : 'tw-text-gray-500'"
              >
                {{ t("pipeline.errorCount") }}
              </div>
            </div>
            <div
              class="tile-value tw-text-lg tw-flex tw-items-end tw-justify-start tw-text-red-500"
            >
              {{ stats?.errors || 0 }}
            </div>
          </div>
        </div>

        <!-- Avg Execution Time Tile -->
        <div class="tile" data-test="avg-execution-time-tile">
          <div
            class="tile-content tw-rounded-lg tw-p-3 tw-text-center tw-border tw-shadow-sm tw-h-20 tw-flex tw-flex-col tw-justify-between"
            :class="store.state.theme === 'dark' ? 'tw-bg-gray-800/50 tw-border-gray-700' : 'tw-bg-white tw-border-gray-200'"
          >
            <div class="tile-header tw-flex tw-justify-between tw-items-start">
              <div
                class="tile-title tw-text-xs tw-font-bold tw-text-left"
                :class="store.state.theme === 'dark' ? 'tw-text-gray-400' : 'tw-text-gray-500'"
              >
                {{ t("pipeline.avgExecutionTime") }}
              </div>
            </div>
            <div
              class="tile-value tw-text-lg tw-flex tw-items-end tw-justify-start"
              :class="store.state.theme === 'dark' ? 'tw-text-white' : 'tw-text-gray-900'"
            >
              {{ stats ? formatDuration(stats.avgDuration) : 0 }}
            </div>
          </div>
        </div>

        <!-- Success Rate Tile -->
        <div class="tile" data-test="success-rate-tile">
          <div
            class="tile-content tw-rounded-lg tw-p-3 tw-text-center tw-border tw-shadow-sm tw-h-20 tw-flex tw-flex-col tw-justify-between"
            :class="store.state.theme === 'dark' ? 'tw-bg-gray-800/50 tw-border-gray-700' : 'tw-bg-white tw-border-gray-200'"
          >
            <div class="tile-header tw-flex tw-justify-between tw-items-start">
              <div
                class="tile-title tw-text-xs tw-font-bold tw-text-left"
                :class="store.state.theme === 'dark' ? 'tw-text-gray-400' : 'tw-text-gray-500'"
              >
                {{ t("pipeline.successRate") }}
              </div>
            </div>
            <div
              class="tile-value tw-text-lg tw-flex tw-items-end tw-justify-start tw-text-green-500"
            >
              {{ stats?.successRate || 0 }}%
            </div>
          </div>
        </div>
      </div>
    </q-card-section>

    <!-- Execution History Table -->
    <div class="tw-px-2">
      <div v-if="loading" class="tw-flex tw-flex-col tw-items-center tw-justify-center" style="min-height: 300px;">
        <q-spinner-hourglass color="primary" size="40px" />
      </div>

      <div
        v-else-if="historyItems.length === 0"
        class="tw-flex tw-flex-col tw-items-center tw-justify-center"
        :class="store.state.theme === 'dark' ? 'tw-text-gray-400' : 'tw-text-gray-500'"
        style="min-height: 300px;"
      >
        <q-icon name="history" size="48px" class="tw-opacity-30" />
        <div class="tw-mt-2">
          {{ t("pipeline.noHistoryData") }}
        </div>
      </div>

      <q-table
        v-else
        ref="qTableRef"
        :rows="historyItems"
        :columns="historyTableColumns"
        row-key="timestamp"
        :pagination="pagination"
        :style="historyItems.length > 0
          ? 'width: 100%; height: calc(100vh - 190px)'
          : 'width: 100%'"
        class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
        data-test="pipeline-history-table"
      >
        <template v-slot:body="props">
          <q-tr :props="props">
            <q-td v-for="col in historyTableColumns" :key="col.name" :props="props">
              <template v-if="col.name === 'status'">
                <q-badge
                  :color="getStatusColor(props.row.status)"
                  :label="formatStatus(props.row.status)"
                />
              </template>
              <template v-else-if="col.name === 'timestamp'">
                {{ formatTimestamp(props.row.timestamp) }}
              </template>
              <template v-else-if="col.name === 'duration'">
                {{ props.row.start_time && props.row.end_time
                  ? formatDuration((props.row.end_time - props.row.start_time) / 1000000)
                  : '-'
                }}
              </template>
              <template v-else-if="col.name === 'error'">
                <div v-if="props.row.error" class="tw-flex tw-items-center">
                  <q-icon name="error" size="20px" class="tw-text-red-500 tw-cursor-pointer">
                    <q-tooltip class="tw-text-xs tw-max-w-md">
                      {{ props.row.error }}
                    </q-tooltip>
                  </q-icon>
                </div>
                <span v-else>--</span>
              </template>
            </q-td>
          </q-tr>
        </template>

        <template #bottom="scope">
          <div class="bottom-btn tw-h-[48px] tw-flex tw-w-full">
            <div class="o2-table-footer-title tw-flex tw-items-center tw-w-[220px] tw-mr-md">
              {{ historyItems.length }} {{ t('pipeline_list.results') }}
            </div>
            <QTablePagination
              :scope="scope"
              :position="'bottom'"
              :resultTotal="historyItems.length"
              :perPageOptions="perPageOptions"
              @update:changeRecordPerPage="changePagination"
            />
          </div>
        </template>
      </q-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useQuasar, date } from "quasar";
import http from "@/services/http";
import type { Ref } from "vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";

// Composables
const { t } = useI18n();
const store = useStore();
const $q = useQuasar();

// Props & Emits
interface PipelineHistoryItem {
  timestamp: number;
  status: string;
  is_realtime: boolean;
  is_silenced: boolean;
  start_time?: number;
  end_time?: number;
  evaluation_took_in_secs?: number;
  retries?: number;
  is_partial?: boolean;
  delay_in_secs?: number;
  query_took?: number;
  error?: string;
}

interface PipelineHistoryStats {
  total: number;
  errors: number;
  avgDuration: number;
  successRate: number;
}

interface Props {
  pipelineId: string;
  pipelineName: string;
  pipelineType?: string;
}

const props = defineProps<Props>();

// Emit is not used since v-close-popup handles closing
// const emit = defineEmits(["close"]);

// Refs
const loading = ref(false);
const historyItems: Ref<PipelineHistoryItem[]> = ref([]);
const stats: Ref<PipelineHistoryStats | null> = ref(null);
const qTableRef: Ref<any> = ref(null);

// Pagination (offline pagination - fetch 100 records by default)
const selectedPerPage = ref<number>(100);
const pagination: any = ref({
  page: 1,
  rowsPerPage: 100,
});

const perPageOptions = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
];

const changePagination = (val: { label: string; value: any }) => {
  selectedPerPage.value = val.value;
  pagination.value.rowsPerPage = val.value;
  pagination.value.page = 1; // Reset to first page when changing rows per page
  qTableRef.value?.setPagination(pagination.value);
};

// Table Columns
const historyTableColumns = [
  {
    name: "timestamp",
    field: "timestamp",
    label: "Timestamp",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "status",
    field: "status",
    label: "Status",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "duration",
    field: "duration",
    label: "Duration",
    align: "left" as const,
    sortable: false,
  },
  {
    name: "error",
    field: "error",
    label: "Error",
    align: "left" as const,
    sortable: false,
  },
];

// Helper Functions

const getStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case "firing":
    case "error":
    case "failed":
      return "negative";
    case "ok":
    case "completed":
      return "positive";
    default:
      return "grey";
  }
};

const formatStatus = (status: string) => {
  return status.charAt(0).toUpperCase() + status.slice(1);
};

const formatTimestamp = (timestamp: number) => {
  if (!timestamp) return "N/A";
  const now = Date.now() * 1000; // microseconds
  const diff = now - timestamp;

  // Less than 1 hour
  if (diff < 3600000000) {
    const minutes = Math.floor(diff / 60000000);
    return `${minutes} min ago`;
  }

  // Less than 24 hours
  if (diff < 86400000000) {
    const hours = Math.floor(diff / 3600000000);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  }

  // Less than 7 days
  if (diff < 604800000000) {
    const days = Math.floor(diff / 86400000000);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }

  // Format as date
  return date.formatDate(timestamp / 1000, "MMM DD, YYYY HH:mm");
};

const formatDuration = (seconds: number) => {
  if (!seconds) return "N/A";
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(0);
  return `${minutes}m ${remainingSeconds}s`;
};

// Main Functions
const fetchHistory = async () => {
  if (!props.pipelineId) return;

  loading.value = true; 
  try {
    const orgIdentifier = store.state.selectedOrganization.identifier;
    const endTime = Date.now() * 1000; // microseconds
    const startTime = endTime - 30 * 24 * 60 * 60 * 1000000; // 30 days ago

    const params = {
      pipeline_id: props.pipelineId,
      start_time: startTime.toString(),
      end_time: endTime.toString(),
      from: "0",
      size: "100", // Fetch 100 records for offline pagination
    };

    const url = `/api/${orgIdentifier}/pipelines/history`;
    const response = await http().get(url, { params });

    if (response.data && response.data.hits) {
      const items = response.data.hits.map((hit: any) => ({
        timestamp: hit.timestamp,
        status: hit.status,
        is_realtime: hit.is_realtime || false,
        is_silenced: hit.is_silenced || false,
        start_time: hit.start_time,
        end_time: hit.end_time,
        evaluation_took_in_secs: hit.evaluation_took_in_secs,
        retries: hit.retries,
        is_partial: hit.is_partial,
        delay_in_secs: hit.delay_in_secs,
        query_took: hit.query_took,
        error: hit.error,
      }));

      historyItems.value = items;

      // Calculate stats
      calculateStats();
    }
  } catch (error: any) {
    console.error("Failed to fetch pipeline history:", error);
    $q.notify({
      type: "negative",
      message:
        error.response?.data?.message ||
        error.message ||
        t("pipeline.failedToFetchHistory"),
    });
  } finally {
    loading.value = false;
  }
};

const refreshHistory = () => {
  fetchHistory();
};

const calculateStats = () => {
  if (historyItems.value.length === 0) {
    stats.value = null;
    return;
  }

  const total = historyItems.value.length;
  const errors = historyItems.value.filter(
    (item) => item.status === "error" || item.status === "firing"
  ).length;

  const durations = historyItems.value
    .filter((item) => item.evaluation_took_in_secs)
    .map((item) => item.evaluation_took_in_secs!);

  const avgDuration =
    durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

  const successRate = total > 0 ? Math.round(((total - errors) / total) * 100) : 0;

  stats.value = {
    total,
    errors,
    avgDuration,
    successRate,
  };
};

// Watchers
watch(
  () => props.pipelineId,
  (newVal) => {
    if (newVal) {
      historyItems.value = [];
      stats.value = null;
      fetchHistory();
    }
  },
  { immediate: true }
);
</script>

<style lang="scss" scoped>
</style>
