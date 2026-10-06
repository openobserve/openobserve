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
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import {
  formatBytes,
  formatCores,
  formatPct,
  usageBarVariant,
  type PodRow,
} from "./kubernetesModel";

defineProps<{
  rows: PodRow[];
  total: number;
  page: number;
  sortBy: string;
  desc: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  sort: [column: string, desc: boolean];
  page: [page: number];
  open: [row: PodRow];
  "filter-node": [row: PodRow];
  "filter-owner": [row: PodRow];
}>();

const { t } = useI18nTyped();

const columns = computed<OTableColumnDef<PodRow>[]>(() => [
  { id: "name", header: t("infra.k8s2.columnName"), accessorKey: "name", sortable: true },
  {
    id: "namespace",
    header: t("infra.k8s2.columnNamespace"),
    accessorKey: "namespace",
    size: 130,
    sortable: true,
  },
  {
    id: "cluster",
    header: t("infra.k8s2.columnCluster"),
    accessorKey: "cluster",
    size: 130,
    sortable: true,
  },
  { id: "status", header: t("infra.k8s2.columnStatus"), size: 170, sortable: true },
  { id: "owner", header: t("infra.k8s2.columnOwner"), size: 200, sortable: true },
  {
    id: "node",
    header: t("infra.k8s2.columnNode"),
    accessorKey: "node",
    size: 200,
    sortable: true,
  },
  {
    id: "restarts",
    header: t("infra.k8s2.columnRestarts"),
    accessorKey: "restarts",
    size: 100,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "cpu",
    header: t("infra.k8s2.columnCpu"),
    accessorKey: "cpuPctOfRequest",
    size: 150,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "memory",
    header: t("infra.k8s2.columnMemory"),
    accessorKey: "memoryPctOfLimit",
    size: 170,
    minSize: 120,
    sortable: true,
    meta: { align: "right" },
  },
]);

const onSort = (params: OTableSortParams) => emit("sort", params.column, params.order === "desc");

const ownerText = (row: PodRow) => (row.owner ? raw(`${row.owner.kind}/${row.owner.name}`) : "");

const cpuDetail = (row: PodRow) => {
  if (row.cpuPctOfRequest != null) {
    return t("infra.k8s2.pctOfRequest", { pct: formatPct(row.cpuPctOfRequest) });
  }
  return row.cpuRequest === "missing" ? t("infra.k8s2.noRequest") : null;
};
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
    data-test="k8s2-pods-table"
    @sort-change="onSort"
    @pagination-change="(p) => emit('page', p.page)"
  >
    <template #cell-name="{ row }">
      <OButton
        variant="ghost-primary"
        size="xs"
        :data-test="`k8s2-pod-open-${row.key}`"
        @click="emit('open', row)"
      >
        {{ raw(row.name) }}
      </OButton>
    </template>
    <template #cell-cluster="{ row }">
      <span :data-test="`k8s2-pod-cluster-${row.key}`">{{ raw(row.cluster || "—") }}</span>
    </template>
    <template #cell-status="{ row }">
      <div class="flex min-w-0 flex-col items-start" :data-test="`k8s2-pod-status-${row.key}`">
        <OTooltip v-if="row.ambiguous" :content="t('infra.k8s2.ambiguous')">
          <span data-test="k8s2-pod-ambiguous">{{ raw("—") }}</span>
        </OTooltip>
        <OTag v-else-if="row.status" :variant="row.status.variant" size="xs">{{
          raw(row.status.text)
        }}</OTag>
        <span v-else>{{ raw("—") }}</span>
        <OText v-if="row.lastTerminatedReason" variant="meta" class="text-2xs">{{
          t("infra.k8s2.lastReason", { reason: raw(row.lastTerminatedReason) })
        }}</OText>
      </div>
    </template>
    <template #cell-owner="{ row }">
      <OButton
        v-if="row.owner"
        variant="ghost"
        size="xs"
        :data-test="`k8s2-pod-owner-${row.key}`"
        @click="emit('filter-owner', row)"
      >
        {{ ownerText(row) }}
      </OButton>
      <span v-else>{{ raw("—") }}</span>
    </template>
    <template #cell-node="{ row }">
      <OButton
        v-if="row.node"
        variant="ghost"
        size="xs"
        :data-test="`k8s2-pod-node-${row.key}`"
        @click="emit('filter-node', row)"
      >
        {{ raw(row.node) }}
      </OButton>
      <span v-else>{{ raw("—") }}</span>
    </template>
    <template #cell-restarts="{ row }">
      <span class="tabular-nums">{{ raw(row.restarts == null ? "—" : String(row.restarts)) }}</span>
    </template>
    <template #cell-cpu="{ row }">
      <div class="flex w-full flex-col items-end" :data-test="`k8s2-pod-cpu-${row.key}`">
        <span class="tabular-nums">{{ raw(formatCores(row.cpuCores)) }}</span>
        <OText v-if="cpuDetail(row)" variant="meta" class="text-2xs tabular-nums">{{
          cpuDetail(row)
        }}</OText>
      </div>
    </template>
    <template #cell-memory="{ row }">
      <div class="flex w-full min-w-0 flex-col items-end" :data-test="`k8s2-pod-memory-${row.key}`">
        <span class="tabular-nums">{{ raw(formatBytes(row.memoryBytes)) }}</span>
        <div
          v-if="row.memoryPctOfLimit != null"
          class="flex w-full min-w-0 items-center justify-end gap-2"
        >
          <OProgressBar
            size="xs"
            class="min-w-0 flex-1"
            :value="Math.min(row.memoryPctOfLimit, 100) / 100"
            :variant="usageBarVariant(row.memoryPctOfLimit)"
            :data-test="`k8s2-pod-memory-bar-${row.key}`"
          />
          <OText variant="meta" class="text-2xs shrink-0 tabular-nums">{{
            raw(formatPct(row.memoryPctOfLimit))
          }}</OText>
        </div>
        <OText v-else-if="row.memoryLimit === 'missing'" variant="meta" class="text-2xs">{{
          t("infra.k8s2.noLimit")
        }}</OText>
      </div>
    </template>
  </OTable>
</template>
