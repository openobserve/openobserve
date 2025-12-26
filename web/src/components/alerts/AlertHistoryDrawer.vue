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
  <q-drawer
    v-model="isOpen"
    side="right"
    bordered
    :width="600"
    overlay
    elevated
    class="alert-history-drawer"
  >
    <div class="tw:h-full tw:flex tw:flex-col">
      <!-- Header -->
      <div
        class="tw:flex tw:items-center tw:justify-between tw:p-4 tw:border-b"
        :class="
          store.state.theme === 'dark'
            ? 'tw:border-gray-600'
            : 'tw:border-gray-200'
        "
      >
        <div class="tw:flex tw:items-center tw:gap-3">
          <q-icon name="history" size="24px" />
          <div>
            <div class="tw:font-semibold tw:text-lg">{{ props.alertName }}</div>
            <div class="tw:text-sm tw:text-gray-500 dark:tw:text-gray-400">
              {{ t("alerts.alertHistory") }}
            </div>
          </div>
        </div>
        <q-btn
          icon="close"
          flat
          round
          dense
          @click="close"
          data-test="alert-history-drawer-close-btn"
        />
      </div>

      <!-- Stats Summary -->
      <div
        v-if="stats"
        class="tw:p-4 tw:border-b"
        :class="
          store.state.theme === 'dark'
            ? 'tw:border-gray-600 tw:bg-gray-800'
            : 'tw:border-gray-200 tw:bg-gray-50'
        "
      >
        <div class="tw:grid tw:grid-cols-2 tw:gap-4">
          <div>
            <div class="tw:text-xs tw:text-gray-500 dark:tw:text-gray-400">
              {{ t("alerts.totalEvaluations") }}
            </div>
            <div class="tw:text-xl tw:font-semibold">
              {{ stats.total }}
            </div>
          </div>
          <div>
            <div class="tw:text-xs tw:text-gray-500 dark:tw:text-gray-400">
              {{ t("alerts.firingCount") }}
            </div>
            <div class="tw:text-xl tw:font-semibold tw:text-red-500">
              {{ stats.firing }}
            </div>
          </div>
          <div>
            <div class="tw:text-xs tw:text-gray-500 dark:tw:text-gray-400">
              {{ t("alerts.avgEvaluationTime") }}
            </div>
            <div class="tw:text-lg tw:font-semibold">
              {{ formatDuration(stats.avgDuration) }}
            </div>
          </div>
          <div>
            <div class="tw:text-xs tw:text-gray-500 dark:tw:text-gray-400">
              {{ t("alerts.successRate") }}
            </div>
            <div class="tw:text-lg tw:font-semibold tw:text-green-500">
              {{ stats.successRate }}%
            </div>
          </div>
        </div>
      </div>

      <!-- Timeline -->
      <div class="tw:flex-1 tw:overflow-y-auto tw:p-4">
        <div v-if="loading" class="tw:flex tw:justify-center tw:py-8">
          <q-spinner color="primary" size="40px" />
        </div>

        <div v-else-if="historyItems.length === 0" class="tw:text-center tw:py-8">
          <q-icon name="history" size="48px" class="tw:text-gray-400" />
          <div class="tw:mt-2 tw:text-gray-600 dark:tw:text-gray-400">
            {{ t("alerts.noHistoryData") }}
          </div>
        </div>

        <q-timeline v-else color="primary" class="tw:mt-2">
          <q-timeline-entry
            v-for="(item, index) in historyItems"
            :key="index"
            :color="getStatusColor(item.status)"
            :icon="getStatusIcon(item.status)"
          >
            <template #title>
              <div class="tw:flex tw:items-center tw:justify-between">
                <span class="tw:font-medium">{{ formatStatus(item.status) }}</span>
                <span class="tw:text-xs tw:text-gray-500">
                  {{ formatTimestamp(item.timestamp) }}
                </span>
              </div>
            </template>

            <template #subtitle>
              <div class="tw:text-sm tw:mt-1 tw:space-y-1">
                <div v-if="item.is_realtime">
                  <q-badge color="blue" label="Real-time" />
                </div>
                <div v-if="item.is_silenced">
                  <q-badge color="orange" label="Silenced" />
                </div>
                <div v-if="item.evaluation_took_in_secs">
                  <span class="tw:text-gray-600 dark:tw:text-gray-400">
                    Duration: {{ formatDuration(item.evaluation_took_in_secs) }}
                  </span>
                </div>
                <div v-if="item.error" class="tw:text-red-500 tw:mt-1">
                  <q-icon name="error" size="14px" class="tw:mr-1" />
                  {{ item.error }}
                </div>
              </div>
            </template>
          </q-timeline-entry>
        </q-timeline>

        <!-- Load more button -->
        <div v-if="hasMore && !loading" class="tw:text-center tw:mt-4">
          <q-btn
            flat
            color="primary"
            :label="t('alerts.loadMore')"
            @click="loadMore"
            data-test="alert-history-load-more-btn"
          />
        </div>
      </div>
    </div>
  </q-drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import alertsService from "@/services/alerts";
import { date } from "quasar";

const { t } = useI18n();
const store = useStore();

interface AlertHistoryItem {
  timestamp: number;
  status: string;
  is_realtime: boolean;
  is_silenced: boolean;
  evaluation_took_in_secs?: number;
  error?: string;
}

interface AlertHistoryStats {
  total: number;
  firing: number;
  avgDuration: number;
  successRate: number;
}

interface Props {
  modelValue: boolean;
  alertId: string;
  alertName: string;
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
const historyItems = ref<AlertHistoryItem[]>([]);
const stats = ref<AlertHistoryStats | null>(null);
const currentPage = ref(0);
const pageSize = 50;
const hasMore = ref(true);

const getStatusIcon = (status: string) => {
  switch (status.toLowerCase()) {
    case "firing":
      return "warning";
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
      return "warning";
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

const fetchHistory = async (append = false) => {
  if (!props.alertId) return;

  loading.value = true;
  try {
    const orgIdentifier = store.state.selectedOrganization.identifier;
    const endTime = Date.now() * 1000; // microseconds
    const startTime = endTime - 30 * 24 * 60 * 60 * 1000000; // 30 days ago

    const response = await alertsService.getHistory(orgIdentifier, {
      alert_id: props.alertId,
      start_time: startTime,
      end_time: endTime,
      from: currentPage.value * pageSize,
      size: pageSize,
    });

    if (response.data && response.data.hits) {
      const items = response.data.hits.map((hit: any) => ({
        timestamp: hit.timestamp,
        status: hit.status,
        is_realtime: hit.is_realtime,
        is_silenced: hit.is_silenced,
        evaluation_took_in_secs: hit.evaluation_took_in_secs,
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
  } catch (error) {
    console.error("Failed to fetch alert history:", error);
    store.dispatch("showNotification", {
      message: t("alerts.failedToFetchHistory"),
      color: "negative",
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
  const firing = historyItems.value.filter(
    (item) => item.status === "firing" || item.status === "error"
  ).length;

  const durations = historyItems.value
    .filter((item) => item.evaluation_took_in_secs)
    .map((item) => item.evaluation_took_in_secs!);

  const avgDuration =
    durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

  const successful = historyItems.value.filter(
    (item) => item.status === "ok" || item.status === "completed"
  ).length;

  const successRate = total > 0 ? Math.round((successful / total) * 100) : 0;

  stats.value = {
    total,
    firing,
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

// Watch for drawer opening
watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal && props.alertId) {
      currentPage.value = 0;
      historyItems.value = [];
      fetchHistory();
    }
  }
);

// Watch for alert name changes
watch(
  () => props.alertId,
  (newVal) => {
    if (newVal && props.modelValue) {
      currentPage.value = 0;
      historyItems.value = [];
      fetchHistory();
    }
  }
);
</script>

<style scoped lang="scss">
.alert-history-drawer {
  :deep(.q-drawer__content) {
    overflow: hidden;
  }

  :deep(.q-timeline) {
    padding: 0;
  }

  :deep(.q-timeline__entry) {
    margin-bottom: 16px;
  }
}
</style>
