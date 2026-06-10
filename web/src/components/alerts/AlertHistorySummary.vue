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
  <div class="alert-history-summary tw:h-full tw:w-full">
    <OTable
      data-test="alert-history-summary-table"
      :data="historyRows"
      :columns="columns"
      row-key="alert_name"
      pagination="client"
      :page-size="100"
      :loading="loading"
      sorting="client"
      filter-mode="client"
      :default-columns="false"
      :show-global-filter="false"
      class="tw:h-full"
    >
      <template #cell-alert_name="{ row }">
        <div
          class="tw:flex tw:items-center tw:cursor-pointer"
          @click="openDrawer(row)"
        >
          <span class="tw:font-medium">{{ row.alert_name }}</span>
        </div>
      </template>

      <template #cell-current_state="{ row }">
        <div class="tw:flex tw:items-center tw:gap-2">
          <OIcon
            :name="getStateIcon(row.current_state)"
            :class="getStateColorClass(row.current_state)"
            size="sm"
          />
          <span>{{ row.current_state }}</span>
        </div>
      </template>

      <template #cell-frequency="{ row }">
        <span>{{ formatFrequency(row.frequency) }}</span>
      </template>

      <template #cell-last_evaluation="{ row }">
        {{ formatTimestamp(row.last_evaluation) }}
      </template>

      <template #empty>
        <div class="tw:w-full tw:text-center tw:py-8">
          <OIcon name="history" size="xl" class="tw:text-gray-400" />
          <div class="tw:mt-2 tw:text-gray-600 dark:tw:text-gray-400">
            {{ t("alerts.noHistoryData") }}
          </div>
        </div>
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import alertsService from "@/services/alerts";
import { formatToReadable } from "@/utils/date";

const { t } = useI18n();
const store = useStore();

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

const columns: OTableColumnDef[] = [
  {
    id: "alert_name",
    header: t("alerts.name"),
    accessorKey: "alert_name",
    sortable: true,
    size: COL.name,
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "total_evaluations",
    header: t("alerts.totalEvaluations"),
    accessorKey: "total_evaluations",
    sortable: true,
    size: COL.count,
    meta: { align: "center" },
  },
  {
    id: "firing_count",
    header: t("alerts.firingCount"),
    accessorKey: "firing_count",
    sortable: true,
    size: COL.count,
    meta: { align: "center" },
  },
  {
    id: "current_state",
    header: t("alerts.currentState"),
    accessorKey: "current_state",
    sortable: true,
    size: COL.status,
    meta: { align: "center" },
  },
  {
    id: "frequency",
    header: t("alerts.frequency"),
    accessorKey: "frequency",
    sortable: true,
    size: COL.frequency,
    meta: { align: "center" },
  },
  {
    id: "last_evaluation",
    header: t("alerts.lastEvaluation"),
    accessorKey: "last_evaluation",
    sortable: true,
    size: COL.date,
    meta: { align: "center" },
  },
];

const getStateIcon = (state: string) => {
  switch (state.toLowerCase()) {
    case "firing":
    case "error":
      return "error";
    case "ok":
    case "completed":
      return "check-circle";
    default:
      return "info";
  }
};

const getStateColorClass = (state: string) => {
  switch (state.toLowerCase()) {
    case "firing":
    case "error":
      return "tw:text-[var(--o2-negative)]";
    case "ok":
    case "completed":
      return "tw:text-[var(--o2-positive)]";
    default:
      return "tw:text-gray-500";
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
  return formatToReadable(timestamp);
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

        if (hit.status === "completed") {
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
</style>
