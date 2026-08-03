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
          <span class="text-text-secondary text-sm"> No triggers loaded </span>
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

      <template #cell-detected_source="{ row }">
        <OTag
          v-if="row.alert_kind === 'external' && row.detected_source"
          data-test="trigger-source-badge"
          variant="default-outline"
        >
          {{ row.detected_source }}
        </OTag>
        <span v-else class="text-text-secondary text-xs">—</span>
      </template>

      <template #cell-labels="{ row }">
        <div v-if="row.labels && Object.keys(row.labels).length" class="flex flex-wrap gap-1">
          <OTag
            v-for="(value, key) in row.labels"
            :key="key"
            data-test="trigger-label-chip"
            variant="default-outline"
          >
            {{ key }}={{ value }}
          </OTag>
        </div>
        <span v-else class="text-text-secondary text-xs">—</span>
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

      <template #cell-actions="{ row }">
        <OButton
          v-if="row.alert_kind === 'external'"
          data-test="trigger-view-payload-btn"
          variant="ghost"
          size="icon-sm"
          icon-left="visibility"
          :title="t('alerts.incidents.viewPayload')"
          @click.stop="openPayload(row)"
        />
      </template>
    </OTable>

    <ODialog
      data-test="trigger-payload-dialog"
      v-model:open="payloadDialogOpen"
      size="md"
      :title="t('alerts.incidents.rawPayloadTitle')"
      primary-button-label="Close"
      @click:primary="payloadDialogOpen = false"
    >
      <div v-if="payloadLoading" class="text-text-secondary py-4 text-center text-sm">
        {{ t("common.loading") }}
      </div>
      <div v-else-if="payloadError" class="text-status-error-text py-4 text-center text-sm">
        {{ payloadError }}
      </div>
      <template v-else-if="payloadData">
        <div class="text-text-secondary mb-2 text-xs">
          <span>Source: {{ payloadData.detected_source }}</span>
          <span v-if="payloadData.source_url" class="ml-3">{{ payloadData.source_url }}</span>
        </div>
        <pre
          data-test="trigger-payload-json"
          class="bg-surface-secondary rounded-surface max-h-[60vh] overflow-auto p-3 text-xs"
          >{{ formattedPayload }}</pre
        >
      </template>
    </ODialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { formatToReadable } from "@/utils/date";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import incidentsService, { type ExternalAlertPayload } from "@/services/incidents";

interface IncidentAlert {
  incident_id: string;
  alert_id: string;
  alert_name: string;
  alert_kind?: "internal" | "external";
  alert_fired_at: number;
  correlation_reason: "service_discovery" | "primary_match" | "secondary_match" | "alert_id";
  created_at: number;
  source_url?: string | null;
  labels?: Record<string, string> | null;
  detected_source?: string | null;
}

export default defineComponent({
  name: "IncidentAlertTriggersTable",
  components: {
    OTag,
    OTooltip,
    OTable,
    OButton,
    ODialog,
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
    const store = useStore();

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
        id: "detected_source",
        header: "Source",
        accessorKey: "detected_source",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 120,
        meta: { align: "left" },
      },
      {
        id: "labels",
        header: "Labels",
        accessorKey: "labels",
        sortable: false,
        resizable: true,
        hideable: true,
        size: 220,
        meta: { align: "left" },
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
      {
        id: "actions",
        header: "",
        isAction: true,
        size: 60,
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

    const payloadDialogOpen = ref(false);
    const payloadLoading = ref(false);
    const payloadError = ref("");
    const payloadData = ref<ExternalAlertPayload | null>(null);

    const formattedPayload = computed(() => {
      if (!payloadData.value) return "";
      try {
        return JSON.stringify(payloadData.value.last_payload, null, 2);
      } catch {
        return String(payloadData.value.last_payload);
      }
    });

    const openPayload = async (row: IncidentAlert) => {
      payloadDialogOpen.value = true;
      payloadLoading.value = true;
      payloadError.value = "";
      payloadData.value = null;
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const response = await incidentsService.getExternalAlertPayload(orgId, row.alert_id);
        payloadData.value = response.data;
      } catch (err: any) {
        payloadError.value = err?.response?.data?.message || t("alerts.incidents.rawPayloadError");
      } finally {
        payloadLoading.value = false;
      }
    };

    return {
      columns,
      formatTimestamp,
      getReasonTooltip,
      onRowClick,
      payloadDialogOpen,
      payloadLoading,
      payloadError,
      payloadData,
      formattedPayload,
      openPayload,
      t,
    };
  },
});
</script>
