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
import { raw, useI18nTyped } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef, OTableSortParams } from "@/lib/core/Table/OTable.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { formatPct, usageBarVariant, type NodeRow } from "./kubernetesModel";

defineProps<{
  rows: NodeRow[];
  total: number;
  page: number;
  sortBy: string;
  desc: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  sort: [column: string, desc: boolean];
  page: [page: number];
  open: [row: NodeRow];
}>();

const { t } = useI18nTyped();

const columns = computed<OTableColumnDef<NodeRow>[]>(() => [
  { id: "name", header: t("infra.k8s2.columnName"), accessorKey: "name", sortable: true },
  {
    id: "cluster",
    header: t("infra.k8s2.columnCluster"),
    accessorKey: "cluster",
    size: 150,
    sortable: true,
  },
  { id: "status", header: t("infra.k8s2.columnStatus"), size: 260, sortable: true },
  {
    id: "pods",
    header: t("infra.k8s2.columnPods"),
    accessorKey: "pods",
    size: 90,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "cpu",
    header: t("infra.k8s2.columnCpuUsed"),
    accessorKey: "cpuPct",
    size: 160,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "memory",
    header: t("infra.k8s2.columnMemoryUsed"),
    accessorKey: "memoryPct",
    size: 160,
    sortable: true,
    meta: { align: "right" },
  },
]);

const onSort = (params: OTableSortParams) => emit("sort", params.column, params.order === "desc");
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
    data-test="k8s2-nodes-table"
    @sort-change="onSort"
    @pagination-change="(p) => emit('page', p.page)"
  >
    <template #cell-name="{ row }">
      <OButton
        variant="ghost-primary"
        size="xs"
        :data-test="`k8s2-node-open-${row.key}`"
        @click="emit('open', row)"
      >
        {{ raw(row.name) }}
      </OButton>
    </template>
    <template #cell-status="{ row }">
      <div class="flex flex-wrap items-center gap-1" :data-test="`k8s2-node-status-${row.key}`">
        <OTag v-if="row.status" :variant="row.status.variant" size="xs">{{
          raw(row.status.text)
        }}</OTag>
        <span v-else>{{ raw("—") }}</span>
        <OTag v-for="pressure in row.pressures" :key="pressure" variant="warning-soft" size="xs">{{
          raw(pressure)
        }}</OTag>
      </div>
    </template>
    <template #cell-pods="{ row }">
      <span class="tabular-nums">{{ raw(row.pods == null ? "—" : String(row.pods)) }}</span>
    </template>
    <template #cell-cpu="{ row }">
      <div
        class="flex w-full min-w-0 items-center justify-end gap-2"
        :data-test="`k8s2-node-cpu-${row.key}`"
      >
        <OProgressBar
          v-if="row.cpuPct != null"
          size="xs"
          class="min-w-0 flex-1"
          :value="Math.min(row.cpuPct, 100) / 100"
          :variant="usageBarVariant(row.cpuPct)"
        />
        <span class="shrink-0 tabular-nums">{{ raw(formatPct(row.cpuPct)) }}</span>
      </div>
    </template>
    <template #cell-memory="{ row }">
      <div
        class="flex w-full min-w-0 items-center justify-end gap-2"
        :data-test="`k8s2-node-memory-${row.key}`"
      >
        <OProgressBar
          v-if="row.memoryPct != null"
          size="xs"
          class="min-w-0 flex-1"
          :value="Math.min(row.memoryPct, 100) / 100"
          :variant="usageBarVariant(row.memoryPct)"
        />
        <span class="shrink-0 tabular-nums">{{ raw(formatPct(row.memoryPct)) }}</span>
      </div>
    </template>
  </OTable>
</template>
