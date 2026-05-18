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
  <div data-test="alert-triggers-table" class="alert-triggers-table tw:flex tw:flex-col tw:h-full tw:overflow-hidden">
    <OTable
      data-test="triggers-qtable"
      :data="triggers"
      :columns="columns"
      row-key="created_at"
      pagination="client"
      :page-size="20"
      :page-size-options="[20, 50, 100, 250, 500]"
      sorting="client"
      :default-columns="false"
      :show-global-filter="false"
      @row-click="onRowClick"
    >
      <template #empty>
        <div data-test="no-triggers-message" class="tw:text-center tw:py-8">
          <span :class="isDarkMode ? 'tw:text-gray-500' : 'tw:text-gray-400'" class="tw:text-sm">
            No triggers loaded
          </span>
        </div>
      </template>

      <template #cell-alert_name="{ row }">
        <span data-test="alert-name-text" :class="isDarkMode ? 'tw:text-gray-200' : 'tw:text-gray-800'" class="tw:text-xs tw:font-medium">
          {{ row.alert_name }}
        </span>
      </template>

      <template #cell-alert_fired_at="{ row }">
        <span data-test="fired-at-timestamp" class="tw:text-xs">
          {{ formatTimestamp(row.alert_fired_at) }}
        </span>
      </template>

      <template #cell-correlation_reason="{ row }">
        <span
          data-test="correlation-reason-badge"
          class="tw:inline-flex tw:items-center tw:px-2 tw:py-0.5 tw:rounded-full tw:text-xs tw:font-medium tw:border"
          :class="getReasonClasses(row.correlation_reason)"
          :title="getReasonTooltip(row.correlation_reason)"
        >
          {{ getReasonLabel(row.correlation_reason) }}
        </span>
      </template>
    </OTable>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, computed } from "vue";
import { useI18n } from "vue-i18n";
import { date } from "quasar";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";

interface IncidentAlert {
  incident_id: string;
  alert_id: string;
  alert_name: string;
  alert_fired_at: number;
  correlation_reason: "service_discovery" | "primary_match" | "secondary_match" | "alert_id";
  created_at: number;
}

export default defineComponent({
  name: "IncidentAlertTriggersTable",
  components: {
    OTable,
  },
  props: {
    triggers: {
      type: Array as PropType<IncidentAlert[]>,
      required: true,
    },
    isDarkMode: {
      type: Boolean,
      required: true,
    },
  },
  emits: ['row-click'],
  setup(props, { emit }) {
    const { t } = useI18n();

    const columns = computed<OTableColumnDef[]>(() => [
      {
        id: "alert_name",
        header: "Alert Name",
        accessorKey: "alert_name",
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "alert_fired_at",
        header: "Fired At",
        accessorKey: "alert_fired_at",
        sortable: true,
        size: 200,
        meta: { align: "left" },
      },
      {
        id: "correlation_reason",
        header: "Correlation Reason",
        accessorKey: "correlation_reason",
        sortable: false,
        size: 150,
        meta: { align: "right" },
      },
    ]);

    const formatTimestamp = (timestamp: number) => {
      if (!timestamp) return "N/A";
      return date.formatDate(timestamp / 1000, "YYYY-MM-DD HH:mm:ss");
    };

    const getReasonColor = (reason: string) => {
      switch (reason) {
        case "service_discovery":
          return "blue";
        case "primary_match":
          return "purple";
        case "secondary_match":
          return "orange";
        case "alert_id":
          return "grey";
        default:
          return "grey";
      }
    };

    const getReasonClasses = (reason: string) => {
      switch (reason) {
        case "service_discovery":
          return "tw:border-blue-500 tw:text-blue-500";
        case "primary_match":
          return "tw:border-purple-500 tw:text-purple-500";
        case "secondary_match":
          return "tw:border-orange-500 tw:text-orange-500";
        case "alert_id":
          return "tw:border-gray-500 tw:text-gray-500";
        default:
          return "tw:border-gray-500 tw:text-gray-500";
      }
    };

    const getReasonLabel = (reason: string) => {
      switch (reason) {
        case "service_discovery":
          return t("alerts.incidents.correlationServiceDiscovery");
        case "primary_match":
          return t("alerts.incidents.correlationPrimaryMatch");
        case "secondary_match":
          return t("alerts.incidents.correlationSecondaryMatch");
        case "alert_id":
          return t("alerts.incidents.correlationAlertId");
        default:
          return reason;
      }
    };

    const getReasonTooltip = (reason: string) => {
      switch (reason) {
        case "service_discovery":
          return t("alerts.incidents.correlationServiceDiscoveryTooltip");
        case "primary_match":
          return t("alerts.incidents.correlationPrimaryMatchTooltip");
        case "secondary_match":
          return t("alerts.incidents.correlationSecondaryMatchTooltip");
        case "alert_id":
          return t("alerts.incidents.correlationAlertIdTooltip");
        default:
          return "";
      }
    };

    const onRowClick = (row: IncidentAlert) => {
      emit('row-click', row.alert_name);
    };

    return {
      columns,
      formatTimestamp,
      getReasonColor,
      getReasonLabel,
      getReasonTooltip,
      getReasonClasses,
      onRowClick,
    };
  },
});
</script>

<style scoped>
:deep(.o2-table tbody tr) {
  cursor: pointer;
}
</style>
