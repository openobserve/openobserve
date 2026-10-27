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
  <div class="flex h-full min-h-0 w-full flex-col" data-test="dashboard-alert-list-panel">
    <OEmptyState
      v-if="query.data.value?.forbidden"
      preset="no-access"
      size="inline"
      :backdrop="false"
      data-test="dashboard-alert-list-panel-forbidden"
    />
    <OEmptyState
      v-else-if="query.isError.value"
      size="inline"
      icon="warning"
      :title="t('common.errorLoadingData')"
      :backdrop="false"
      data-test="dashboard-alert-list-panel-error"
    />
    <OTable
      v-else
      class="min-h-0 flex-1"
      :data="rows"
      :columns="columns"
      row-key="id"
      pagination="none"
      sorting="none"
      :frame="false"
      dense
      fill-height
      :loading="query.isPending.value"
      :row-rail-tone="railTone"
      data-test="dashboard-alert-list-panel-table"
      @row-click="openAlert"
    >
      <template #cell-state="{ row }">
        <OTag
          v-if="row.state === 'paused'"
          type="alertStatus"
          value="paused"
          size="xs"
          :data-test="`dashboard-alert-list-panel-state-${row.id}`"
        />
        <OTag
          v-else-if="row.state !== 'unknown'"
          type="alertState"
          :value="row.state"
          size="xs"
          :data-test="`dashboard-alert-list-panel-state-${row.id}`"
        />
        <span v-else class="text-text-muted">{{ emDash }}</span>
      </template>
      <template #cell-lastTriggeredAt="{ row }">
        <OTimeCell
          :value="row.lastTriggeredAt"
          unit="us"
          mode="relative"
          :timezone="store.state.timezone"
          :empty-label="t('dashboard.alertListNever')"
        />
      </template>
      <template #empty>
        <OEmptyState
          size="inline"
          icon="notifications"
          :title="t('dashboard.alertListEmpty')"
          :backdrop="false"
          data-test="dashboard-alert-list-panel-empty"
        />
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { OTableColumnDef, RowRailTone } from "@/lib/core/Table/OTable.types";
import { panelAlertsQuery } from "@/services/alerts.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { buildAlertListRows, type AlertListRow } from "@/utils/dashboard/alertListPanel";

const props = defineProps<{
  config?: Record<string, any> | null;
}>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const emDash = raw("—");

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const folder = computed<string>(() =>
  typeof props.config?.alert_list_folder === "string" ? props.config.alert_list_folder : "",
);
const query = useQuery(() =>
  Object.assign(panelAlertsQuery(org.value, folder.value), { enabled: !!org.value }),
);

const rows = computed<AlertListRow[]>(() =>
  buildAlertListRows(query.data.value?.alerts ?? [], props.config),
);

const columns = computed<OTableColumnDef<AlertListRow>[]>(() => [
  {
    id: "name",
    accessorKey: "name",
    header: t("dashboard.alertListColumnAlert"),
    meta: { align: "left", autoWidth: true, fillRemaining: true, isName: true },
  },
  { id: "state", accessorKey: "state", header: t("dashboard.alertListSortState"), size: 110 },
  {
    id: "folderName",
    accessorKey: "folderName",
    header: t("dashboard.alertListFolder"),
    size: 130,
  },
  {
    id: "lastTriggeredAt",
    accessorKey: "lastTriggeredAt",
    header: t("dashboard.alertListSortTime"),
    size: 130,
  },
]);

const RAIL_TONES: Partial<Record<AlertListRow["state"], RowRailTone>> = {
  firing: "error",
  error: "warning",
  pending: "info",
};
const railTone = (row: AlertListRow): RowRailTone | null => RAIL_TONES[row.state] ?? null;

const openAlert = (row: AlertListRow) => {
  if (store.state.kioskMode || store.state.printMode || !row?.id) return;
  router.push({
    name: "alertDetail",
    params: { alert_id: row.id },
    query: { org_identifier: org.value, folder: row.folderId || "default" },
  });
};
</script>
