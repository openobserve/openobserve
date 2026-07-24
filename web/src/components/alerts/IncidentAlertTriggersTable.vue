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
    data-test="alert-triggers-table"
    class="alert-triggers-table flex h-full flex-col overflow-hidden"
  >
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
      :enable-column-resize="true"
      :persist-columns="true"
      table-id="incidents-alert-triggers"
      :show-global-filter="false"
      @row-click="onRowClick"
    >
      <template #empty>
        <div data-test="no-triggers-message" class="py-8 text-center">
          <span class="text-text-secondary text-sm">
            {{ t("alerts.noTriggersLoaded") }}
          </span>
        </div>
      </template>

      <template #cell-alert_name="{ row }">
        <span data-test="alert-name-text" class="text-text-body text-xs font-medium">
          {{ row.alert_name }}
        </span>
      </template>

      <template #cell-alert_fired_at="{ row }">
        <span data-test="fired-at-timestamp" class="text-xs">
          {{ formatTimestamp(row.alert_fired_at) }}
        </span>
      </template>

      <template #cell-correlation_reason="{ row }">
        <span class="inline-flex">
          <OTag
            data-test="correlation-reason-badge"
            type="correlationReason"
            :value="row.correlation_reason"
          />
          <OTooltip :content="getReasonTooltip(row.correlation_reason)" side="top" />
        </span>
      </template>
    </OTable>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatToReadable } from "@/utils/date";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";

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
    OTag,
    OTooltip,
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
  emits: ["row-click"],
  setup(props, { emit }) {
    const { t } = useI18n();

    const columns = computed<OTableColumnDef[]>(() => [
      {
        id: "alert_name",
        header: "Alert Name",
        accessorKey: "alert_name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "alert_fired_at",
        header: "Fired At",
        accessorKey: "alert_fired_at",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.date,
        meta: { align: "left" },
      },
      {
        id: "correlation_reason",
        header: "Correlation Reason",
        accessorKey: "correlation_reason",
        sortable: false,
        resizable: true,
        hideable: true,
        size: 150,
        meta: { align: "left" },
      },
    ]);

    const formatTimestamp = (timestamp: number) => {
      if (!timestamp) return "N/A";
      return formatToReadable(timestamp);
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
      emit("row-click", row.alert_name);
    };

    return {
      t,
      columns,
      formatTimestamp,
      getReasonTooltip,
      onRowClick,
    };
  },
});
</script>
