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
        <CorrelationReasonBadge :reason="row.correlation_reason" data-test="correlation-reason-badge" />
      </template>
    </OTable>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatToReadable } from "@/utils/date";
import CorrelationReasonBadge from "@/components/alerts/badges/CorrelationReasonBadge.vue";
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
    CorrelationReasonBadge,
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
      return formatToReadable(timestamp);
    };

    const onRowClick = (row: IncidentAlert) => {
      emit('row-click', row.alert_name);
    };

    return {
      columns,
      formatTimestamp,
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
