<!-- Copyright 2025 OpenObserve Inc.

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
  <div class="alert-triggers-table tw:flex tw:flex-col tw:h-full tw:overflow-hidden">
    <q-table
      ref="qTableRef"
      :rows="triggers"
      :columns="columns"
      row-key="alert_id"
      :pagination="pagination"
      style="height: calc(100vh - 220px)"
      flat
      class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky tw:flex-1 o2-custom-table"
      @row-click="onRowClick"
    >
      <template #no-data>
        <div class="tw:text-center tw:py-8">
          <span :class="isDarkMode ? 'tw:text-gray-500' : 'tw:text-gray-400'" class="tw:text-sm">
            No triggers loaded
          </span>
        </div>
      </template>

      <template #body-cell-alert_name="props">
        <q-td :props="props">
          <span :class="isDarkMode ? 'tw:text-gray-200' : 'tw:text-gray-800'" class="tw:text-xs tw:font-medium">
            {{ props.row.alert_name }}
          </span>
        </q-td>
      </template>

      <template #body-cell-alert_fired_at="props">
        <q-td :props="props">
          <span class="tw:text-xs">
            {{ formatTimestamp(props.row.alert_fired_at) }}
          </span>
        </q-td>
      </template>

      <template #body-cell-correlation_reason="props">
        <q-td :props="props" class="tw:text-right">
          <q-badge
            :color="getReasonColor(props.row.correlation_reason)"
            :label="getReasonLabel(props.row.correlation_reason)"
            outline
          />
        </q-td>
      </template>

      <template #bottom="scope">
        <QTablePagination
          :scope="scope"
          :position="'bottom'"
          :resultTotal="triggers.length"
          :perPageOptions="perPageOptions"
          @update:changeRecordPerPage="changePagination"
        />
      </template>
    </q-table>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { date } from "quasar";
import type { QTableProps } from "quasar";
import QTablePagination from "@/components/shared/grid/Pagination.vue";

interface IncidentAlert {
  incident_id: string;
  alert_id: string;
  alert_name: string;
  alert_fired_at: number;
  correlation_reason: "service_discovery" | "manual_extraction" | "temporal";
  created_at: number;
}

export default defineComponent({
  name: "IncidentAlertTriggersTable",
  components: {
    QTablePagination,
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

    const qTableRef = ref<any>(null);

    const perPageOptions = [
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "250", value: 250 },
      { label: "500", value: 500 },
    ];

    const pagination = ref({
      rowsPerPage: 20,
    });

    const columns = computed<QTableProps["columns"]>(() => [
      {
        name: "alert_name",
        field: "alert_name",
        label: "Alert Name",
        align: "left",
        sortable: true,
      },
      {
        name: "alert_fired_at",
        field: "alert_fired_at",
        label: "Fired At",
        align: "left",
        sortable: true,
        style: "width: 200px",
      },
      {
        name: "correlation_reason",
        field: "correlation_reason",
        label: "Corelation Reason",
        align: "right",
        sortable: false,
        style: "width: 150px",
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
        case "manual_extraction":
          return "purple";
        case "temporal":
          return "teal";
        default:
          return "grey";
      }
    };

    const getReasonLabel = (reason: string) => {
      switch (reason) {
        case "service_discovery":
          return t("alerts.incidents.correlationServiceDiscovery");
        case "manual_extraction":
          return t("alerts.incidents.correlationManualExtraction");
        case "temporal":
          return t("alerts.incidents.correlationTemporal");
        default:
          return reason;
      }
    };

    const changePagination = (val: { label: string; value: any }) => {
      pagination.value.rowsPerPage = val.value;
      qTableRef.value?.setPagination(pagination.value);
    };

    const onRowClick = (evt: Event, row: IncidentAlert) => {
      emit('row-click', row.alert_name);
    };

    return {
      qTableRef,
      pagination,
      perPageOptions,
      columns,
      formatTimestamp,
      getReasonColor,
      getReasonLabel,
      changePagination,
      onRowClick,
    };
  },
});
</script>

<style scoped>
:deep(.q-table tbody tr) {
  cursor: pointer;
}

</style>
