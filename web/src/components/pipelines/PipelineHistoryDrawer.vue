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
  <Teleport to="body">
  <q-drawer
    v-model="isOpen"
    side="right"
    bordered
    :width="600"
    overlay
    elevated
    behavior="mobile"
    class="pipeline-history-drawer"
  >
    <div class="tw-h-full tw-flex tw-flex-col">
      <!-- Header -->
      <div
        class="tw-flex tw-items-center tw-justify-between tw-p-4 tw-border-b"
        :class="
          store.state.theme === 'dark'
            ? 'tw-border-gray-600'
            : 'tw-border-gray-200'
        "
      >
        <div class="tw-flex tw-items-center tw-gap-3">
          <q-icon name="history" size="24px" />
          <div>
            <div class="tw-flex tw-items-center tw-gap-2 tw-font-semibold tw-text-lg">
              <span>{{ props.pipelineName }}</span>
              <q-icon
                :name="props.pipelineType === 'realtime' ? 'check_circle' : 'schedule'"
                size="20px"
                :color="props.pipelineType === 'realtime' ? 'positive' : 'grey'"
              >
                <q-tooltip>{{ props.pipelineType === 'realtime' ? 'Real-time' : 'Scheduled' }}</q-tooltip>
              </q-icon>
              <q-icon
                :name="props.isSilenced ? 'volume_off' : 'volume_up'"
                size="20px"
                :color="props.isSilenced ? 'orange' : 'positive'"
              >
                <q-tooltip>{{ props.isSilenced ? 'Silenced' : 'Not Silenced' }}</q-tooltip>
              </q-icon>
            </div>
            <div class="tw-text-sm tw-text-gray-500 dark:tw-text-gray-400">
              {{ t("pipeline.history") }}
            </div>
          </div>
        </div>
        <q-btn
          icon="close"
          flat
          round
          dense
          @click="close"
          data-test="pipeline-history-drawer-close-btn"
        />
      </div>

      <!-- Stats Summary - Always shown -->
      <div
        class="tw-p-4 tw-border-b"
        :class="
          store.state.theme === 'dark'
            ? 'tw-border-gray-600 tw-bg-gray-800'
            : 'tw-border-gray-200 tw-bg-gray-50'
        "
      >
        <div class="tw-grid tw-grid-cols-2 tw-gap-4">
          <div>
            <div class="tw-text-xs tw-text-gray-500 dark:tw-text-gray-400">
              {{ t("pipeline.totalExecutions") }}
            </div>
            <div class="tw-text-xl tw-font-semibold">
              {{ stats?.total || 0 }}
            </div>
          </div>
          <div>
            <div class="tw-text-xs tw-text-gray-500 dark:tw-text-gray-400">
              {{ t("pipeline.errorCount") }}
            </div>
            <div class="tw-text-xl tw-font-semibold tw-text-red-500">
              {{ stats?.errors || 0 }}
            </div>
          </div>
          <div>
            <div class="tw-text-xs tw-text-gray-500 dark:tw-text-gray-400">
              {{ t("pipeline.avgExecutionTime") }}
            </div>
            <div class="tw-text-lg tw-font-semibold">
              {{ stats ? formatDuration(stats.avgDuration) : 'N/A' }}
            </div>
          </div>
          <div>
            <div class="tw-text-xs tw-text-gray-500 dark:tw-text-gray-400">
              {{ t("pipeline.successRate") }}
            </div>
            <div class="tw-text-lg tw-font-semibold tw-text-green-500">
              {{ stats?.successRate || 0 }}%
            </div>
          </div>
        </div>
      </div>

      <!-- Timeline -->
      <div class="tw-flex-1 tw-overflow-y-auto tw-p-4">
        <div v-if="loading" class="tw-flex tw-justify-center tw-py-8">
          <q-spinner color="primary" size="40px" />
        </div>

        <div v-else-if="historyItems.length === 0" class="tw-text-center tw-py-8">
          <q-icon name="history" size="48px" class="tw-text-gray-400" />
          <div class="tw-mt-2 tw-text-gray-600 dark:tw-text-gray-400">
            {{ t("pipeline.noHistoryData") }}
          </div>
        </div>

        <q-timeline v-else color="primary" class="tw-mt-2">
          <q-timeline-entry
            v-for="(item, index) in historyItems"
            :key="index"
            :color="getStatusColor(item.status)"
            :icon="getStatusIcon(item.status)"
          >
            <template #title>
              <div class="tw-flex tw-items-center tw-justify-between">
                <span class="tw-font-medium">{{ formatStatus(item.status) }}</span>
                <span class="tw-text-xs tw-text-gray-500">
                  {{ formatTimestamp(item.timestamp) }}
                </span>
              </div>
            </template>

            <template #subtitle>
              <div class="tw-text-sm tw-mt-1 tw-space-y-1">
                <div class="tw-flex tw-gap-2 tw-flex-wrap">
                  <q-badge v-if="item.is_realtime" color="blue" label="Real-time" />
                  <q-badge v-if="item.is_silenced" color="orange" label="Silenced" />
                  <q-badge v-if="item.is_partial" color="warning" label="Partial" />
                </div>
                <div v-if="item.start_time" class="tw-text-gray-600 dark:tw-text-gray-400">
                  <strong>Start Time:</strong> {{ formatDate(item.start_time) }}
                </div>
                <div v-if="item.end_time" class="tw-text-gray-600 dark:tw-text-gray-400">
                  <strong>End Time:</strong> {{ formatDate(item.end_time) }}
                </div>
                <div v-if="item.start_time && item.end_time" class="tw-text-gray-600 dark:tw-text-gray-400">
                  <strong>Duration:</strong> {{ formatDuration((item.end_time - item.start_time) / 1000000) }}
                </div>
                <div v-if="item.evaluation_took_in_secs" class="tw-text-gray-600 dark:tw-text-gray-400">
                  <strong>Eval Time:</strong> {{ formatDuration(item.evaluation_took_in_secs) }}
                </div>
                <div v-if="item.query_took" class="tw-text-gray-600 dark:tw-text-gray-400">
                  <strong>Query Time:</strong> {{ (item.query_took / 1000).toFixed(2) }}ms
                </div>
                <div v-if="item.retries" class="tw-text-gray-600 dark:tw-text-gray-400">
                  <strong>Retries:</strong> {{ item.retries }}
                </div>
                <div v-if="item.delay_in_secs" class="tw-text-gray-600 dark:tw-text-gray-400">
                  <strong>Delay:</strong> {{ item.delay_in_secs }}s
                </div>
                <div v-if="item.error" class="tw-text-red-500 tw-mt-1">
                  <q-icon name="error" size="14px" class="tw-mr-1" />
                  {{ item.error }}
                </div>
              </div>
            </template>
          </q-timeline-entry>
        </q-timeline>

        <!-- Load more button -->
        <div v-if="hasMore && !loading" class="tw-text-center tw-mt-4">
          <q-btn
            flat
            color="primary"
            :label="t('common.loadMore')"
            @click="loadMore"
            data-test="pipeline-history-load-more-btn"
          />
        </div>
      </div>
    </div>
  </q-drawer>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useQuasar, date } from "quasar";
import http from "@/services/http";

const { t } = useI18n();
const store = useStore();
const $q = useQuasar();

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
  modelValue: boolean;
  pipelineId: string;
  pipelineName: string;
  pipelineType?: string;
  isSilenced?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

const loading = ref(false);
const historyItems = ref<PipelineHistoryItem[]>([]);
const stats = ref<PipelineHistoryStats | null>(null);
const currentPage = ref(0);
const pageSize = 50;
const hasMore = ref(true);

const getStatusIcon = (status: string) => {
  switch (status.toLowerCase()) {
    case "firing":
    case "error":
      return "error";
    case "ok":
    case "completed":
      return "check_circle";
    default:
      return "info";
  }
};

const getStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case "firing":
    case "error":
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

const formatDate = (timestamp: number) => {
  if (!timestamp) return "-";
  return date.formatDate(timestamp / 1000, "YYYY-MM-DD HH:mm:ss");
};

const fetchHistory = async (append = false) => {
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
      from: (currentPage.value * pageSize).toString(),
      size: pageSize.toString(),
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

      if (append) {
        historyItems.value.push(...items);
      } else {
        historyItems.value = items;
      }

      hasMore.value = response.data.hits.length === pageSize;

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

const loadMore = () => {
  currentPage.value++;
  fetchHistory(true);
};

const close = () => {
  isOpen.value = false;
};

// Handle ESC key
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape" && isOpen.value) {
    close();
  }
};

// Watch for drawer opening
watch(isOpen, (newValue) => {
  if (newValue) {
    currentPage.value = 0;
    historyItems.value = [];
    stats.value = null;
    hasMore.value = true;
    fetchHistory();
  }
});

// Add/remove keyboard event listener
onMounted(() => {
  document.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeyDown);
});
</script>

<style scoped lang="scss">
.pipeline-history-drawer {
  :deep(.q-drawer__content) {
    overflow: hidden;
  }
}
</style>
