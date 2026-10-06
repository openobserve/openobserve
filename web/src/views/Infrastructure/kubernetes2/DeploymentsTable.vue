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

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef, OTableSortParams } from "@/lib/core/Table/OTable.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { DeploymentRow, DeploymentState } from "./kubernetesModel";

defineProps<{
  rows: DeploymentRow[];
  total: number;
  page: number;
  sortBy: string;
  desc: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  sort: [column: string, desc: boolean];
  page: [page: number];
  open: [row: DeploymentRow];
}>();

const { t } = useI18nTyped();

const STATE_LABEL: Record<DeploymentState, I18nKey> = {
  Available: "infra.k8s2.deploymentAvailable",
  Degraded: "infra.k8s2.deploymentDegraded",
  Unavailable: "infra.k8s2.deploymentUnavailable",
  ScaledToZero: "infra.k8s2.deploymentScaledToZero",
};

const columns = computed<OTableColumnDef<DeploymentRow>[]>(() => [
  { id: "name", header: t("infra.k8s2.columnName"), accessorKey: "name", sortable: true },
  {
    id: "namespace",
    header: t("infra.k8s2.columnNamespace"),
    accessorKey: "namespace",
    size: 150,
    sortable: true,
  },
  {
    id: "cluster",
    header: t("infra.k8s2.columnCluster"),
    accessorKey: "cluster",
    size: 150,
    sortable: true,
  },
  {
    id: "available",
    header: t("infra.k8s2.columnAvailable"),
    accessorKey: "available",
    size: 110,
    sortable: true,
    meta: { align: "right" },
  },
  { id: "status", header: t("infra.k8s2.columnStatus"), size: 140, sortable: true },
  {
    id: "pods",
    header: t("infra.k8s2.columnPods"),
    accessorKey: "pods",
    size: 90,
    sortable: true,
    meta: { align: "right" },
  },
]);

const onSort = (params: OTableSortParams) => emit("sort", params.column, params.order === "desc");

const availableText = (row: DeploymentRow) =>
  row.available == null || row.desired == null
    ? raw("—")
    : t("infra.k8s2.availableOfDesired", { available: row.available, desired: row.desired });
</script>

<template>
  <OTable
    :data="rows"
    :columns="columns"
    :loading="loading"
    row-key="key"
    sorting="server"
    :sort-by="sortBy"
    :sort-order="desc ? 'desc' : 'asc'"
    pagination="server"
    :page-size="50"
    :current-page="page"
    :total-count="total"
    :show-global-filter="false"
    data-test="k8s2-deployments-table"
    @sort-change="onSort"
    @pagination-change="(p) => emit('page', p.page)"
  >
    <template #cell-name="{ row }">
      <OButton
        variant="ghost-primary"
        size="xs"
        :data-test="`k8s2-deployment-open-${row.key}`"
        @click="emit('open', row)"
      >
        {{ raw(row.name) }}
      </OButton>
    </template>
    <template #cell-available="{ row }">
      <span class="tabular-nums">{{ availableText(row) }}</span>
    </template>
    <template #cell-status="{ row }">
      <OTag
        v-if="row.status"
        :variant="row.status.variant"
        size="xs"
        :data-test="`k8s2-deployment-status-${row.key}`"
        >{{ t(STATE_LABEL[row.status.state]) }}</OTag
      >
      <span v-else :data-test="`k8s2-deployment-status-${row.key}`">{{ raw("—") }}</span>
    </template>
    <template #cell-pods="{ row }">
      <span class="tabular-nums">{{ raw(row.pods == null ? "—" : String(row.pods)) }}</span>
    </template>
  </OTable>
</template>
