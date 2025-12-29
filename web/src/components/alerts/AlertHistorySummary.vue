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
  <div class="alert-history-summary tw:h-full tw:w-full">
    <q-table
      data-test="alert-history-summary-table"
      :rows="historyRows"
      :columns="columns"
      row-key="alert_name"
      :pagination="pagination"
      :loading="loading"
      @request="onRequest"
      class="tw:h-full"
      flat
      bordered
    >
      <template #body-cell-alert_name="props">
        <q-td :props="props" class="cursor-pointer hover:tw:bg-gray-100 dark:hover:tw:bg-gray-700">
          <div class="tw:flex tw:items-center" @click="openDrawer(props.row)">
            <span class="tw:font-medium">{{ props.row.alert_name }}</span>
          </div>
        </q-td>
      </template>

      <template #body-cell-current_state="props">
        <q-td :props="props">
          <div class="tw:flex tw:items-center tw:gap-2">
            <q-icon
              :name="getStateIcon(props.row.current_state)"
              :color="getStateColor(props.row.current_state)"
              size="18px"
            />
            <span>{{ props.row.current_state }}</span>
          </div>
        </q-td>
      </template>

      <template #body-cell-frequency="props">
        <q-td :props="props">
          <span>{{ formatFrequency(props.row.frequency) }}</span>
        </q-td>
      </template>

      <template #no-data>
        <div class="tw:w-full tw:text-center tw:py-8">
          <q-icon name="history" size="48px" class="tw:text-gray-400" />
          <div class="tw:mt-2 tw:text-gray-600 dark:tw:text-gray-400">
            {{ t("alerts.noHistoryData") }}
          </div>
        </div>
      </template>
    </q-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import alertsService from "@/services/alerts";
import { date } from "quasar";

const { t } = useI18n();
const store = useStore();
const router = useRouter();

interface AlertHistorySummary {
  alert_name: string;
  total_evaluations: number;
  firing_count: number;
  current_state: string;
  frequency: number | null;
  last_evaluation: number;
}

const emit = defineEmits<{
  (e: "open-drawer", alertName: string): void;
}>();

const loading = ref(false);
const historyRows = ref<AlertHistorySummary[]>([]);
const pagination = ref({
  sortBy: "last_evaluation",
  descending: true,
  page: 1,
  rowsPerPage: 100,
  rowsNumber: 0,
});

const columns = computed(() => [
  {
    name: "alert_name",
    label: t("alerts.name"),
    field: "alert_name",
    align: "left",
    sortable: true,
  },
  {
    name: "total_evaluations",
    label: t("alerts.totalEvaluations"),
    field: "total_evaluations",
    align: "center",
    sortable: true,
  },
  {
    name: "firing_count",
    label: t("alerts.firingCount"),
    field: "firing_count",
    align: "center",
    sortable: true,
  },
  {
    name: "current_state",
    label: t("alerts.currentState"),
    field: "current_state",
    align: "center",
    sortable: true,
  },
  {
    name: "frequency",
    label: t("alerts.frequency"),
    field: "frequency",
    align: "center",
    sortable: true,
  },
  {
    name: "last_evaluation",
    label: t("alerts.lastEvaluation"),
    field: "last_evaluation",
    align: "center",
    sortable: true,
    format: (val: number) => formatTimestamp(val),
  },
]);

const getStateIcon = (state: string) => {
  switch (state.toLowerCase()) {
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

const getStateColor = (state: string) => {
  switch (state.toLowerCase()) {
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

const formatFrequency = (seconds: number | null) => {
  if (!seconds) return "N/A";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
};

const formatTimestamp = (timestamp: number) => {
  if (!timestamp) return "N/A";
  return date.formatDate(timestamp / 1000, "YYYY-MM-DD HH:mm:ss");
};

const fetchHistorySummary = async () => {
  loading.value = true;
  try {
    const orgIdentifier = store.state.selectedOrganization.identifier;

    // Fetch all alert history for the last 7 days
    const endTime = Date.now() * 1000; // microseconds
    const startTime = endTime - 7 * 24 * 60 * 60 * 1000000; // 7 days ago

    const response = await alertsService.getHistory(orgIdentifier, {
      start_time: startTime,
      end_time: endTime,
      from: 0,
      size: 10000, // Get all records for aggregation
    });

    if (response.data && response.data.hits) {
      // Aggregate by alert name
      const aggregated = new Map<string, AlertHistorySummary>();

      response.data.hits.forEach((hit: any) => {
        const alertName = hit.alert_name;
        if (!alertName) return;

        if (!aggregated.has(alertName)) {
          aggregated.set(alertName, {
            alert_name: alertName,
            total_evaluations: 0,
            firing_count: 0,
            current_state: "unknown",
            frequency: null,
            last_evaluation: 0,
          });
        }

        const summary = aggregated.get(alertName)!;
        summary.total_evaluations++;

        if (hit.status === "firing" || hit.status === "error") {
          summary.firing_count++;
        }

        // Update last evaluation
        if (hit.timestamp > summary.last_evaluation) {
          summary.last_evaluation = hit.timestamp;
          summary.current_state = hit.status || "unknown";
        }

        // Try to extract frequency from trigger data if available
        // This would need to be added to the API response or fetched separately
      });

      historyRows.value = Array.from(aggregated.values());
      pagination.value.rowsNumber = historyRows.value.length;
    }
  } catch (error) {
    console.error("Failed to fetch alert history summary:", error);
    store.dispatch("showNotification", {
      message: t("alerts.failedToFetchHistory"),
      color: "negative",
    });
  } finally {
    loading.value = false;
  }
};

const onRequest = async (props: any) => {
  const { page, rowsPerPage, sortBy, descending } = props.pagination;
  pagination.value.page = page;
  pagination.value.rowsPerPage = rowsPerPage;
  pagination.value.sortBy = sortBy;
  pagination.value.descending = descending;

  // Sort locally since we have all data
  historyRows.value.sort((a: any, b: any) => {
    const fieldA = a[sortBy];
    const fieldB = b[sortBy];

    if (fieldA < fieldB) return descending ? 1 : -1;
    if (fieldA > fieldB) return descending ? -1 : 1;
    return 0;
  });
};

const openDrawer = (row: AlertHistorySummary) => {
  emit("open-drawer", row.alert_name);
};

onMounted(() => {
  fetchHistorySummary();
});

// Refresh data when organization changes
watch(
  () => store.state.selectedOrganization.identifier,
  () => {
    fetchHistorySummary();
  }
);

defineExpose({
  refresh: fetchHistorySummary,
});
</script>

<style scoped lang="scss">
.alert-history-summary {
  :deep(.q-table__top) {
    padding: 8px 16px;
  }

  :deep(.q-table tbody td) {
    cursor: pointer;
  }

  :deep(.q-table tbody tr:hover) {
    background-color: rgba(0, 0, 0, 0.03);
  }
}
</style>
