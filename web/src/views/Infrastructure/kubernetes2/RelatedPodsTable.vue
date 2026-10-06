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
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import type { DetailsRef } from "./kubernetesUrlState";
import {
  TONE_TEXT_CLASS,
  chipLabel,
  formatBytes,
  formatCores,
  formatPct,
  severityOf,
  sortRows,
  toneOf,
  usageBarVariant,
  warningLabel,
  type PodRow,
} from "./kubernetesModel";

const props = defineProps<{
  pods: PodRow[];
  // µs; the picker END, for event ages in the ⚠ tooltip.
  end: number;
  // The node's allocatable, when the table sits in a node drawer.
  allocatable?: Record<string, number> | null;
}>();

const emit = defineEmits<{ open: [ref: DetailsRef] }>();

const { t } = useI18nTyped();

const rows = computed(() => sortRows(props.pods, (p) => p.cpuCores, true));

const containersOf = (pod: PodRow) => pod.containers.filter((c) => !c.init);

const readyText = (pod: PodRow) => {
  const containers = containersOf(pod);
  return `${containers.filter((c) => c.running).length}/${containers.length}`;
};

const USAGE = [
  {
    id: "cpu",
    used: (p: PodRow) => p.cpuCores,
    format: formatCores,
    tip: "infra.k8s2.drawerCpuShare",
  },
  {
    id: "memory",
    used: (p: PodRow) => p.memoryBytes,
    format: formatBytes,
    tip: "infra.k8s2.drawerMemoryShare",
  },
] as const;

// A share of the node's allocatable; null off the node drawer or without data.
const shareOf = (pod: PodRow, r: (typeof USAGE)[number]) => {
  const used = r.used(pod);
  const of = props.allocatable?.[r.id];
  return used != null && of ? (used / of) * 100 : null;
};

const columns = computed<OTableColumnDef<PodRow>[]>(() => [
  {
    id: "name",
    header: t("infra.k8s2.columnName"),
    accessorFn: (p) => p.name,
    sortable: true,
    isName: true,
  },
  {
    id: "warn",
    header: raw(""),
    accessorFn: (p) => p.warnings.length,
    size: 40,
    sortable: true,
  },
  {
    id: "node",
    header: t("infra.k8s2.columnNode"),
    accessorFn: (p) => p.node ?? undefined,
    sortable: true,
    sortUndefined: "last",
  },
  {
    id: "namespace",
    header: t("infra.k8s2.columnNamespace"),
    accessorFn: (p) => p.namespace,
    sortable: true,
  },
  { id: "ready", header: t("infra.k8s2.factReady"), accessorFn: readyText, size: 80 },
  {
    id: "cpu",
    header: t("infra.k8s2.columnCpu"),
    accessorFn: (p) => p.cpuCores ?? undefined,
    sortable: true,
    sortUndefined: "last",
  },
  {
    id: "memory",
    header: t("infra.k8s2.columnMemory"),
    accessorFn: (p) => p.memoryBytes ?? undefined,
    sortable: true,
    sortUndefined: "last",
  },
  {
    id: "status",
    header: t("infra.k8s2.columnStatus"),
    accessorFn: (p) => (p.status ? chipLabel(p.status, t) : undefined),
    sortable: true,
    sortUndefined: "last",
  },
]);

const openPod = (p: PodRow) =>
  emit("open", { kind: "pod", cluster: p.cluster, namespace: p.namespace, name: p.name });

const openNode = (p: PodRow) =>
  emit("open", { kind: "node", cluster: p.cluster, namespace: "", name: p.node ?? "" });
</script>

<template>
  <OTable
    :data="rows"
    :columns="columns"
    row-key="key"
    dense
    virtual-scroll
    max-height="41.25rem"
    pagination="none"
    :frame="false"
    :show-global-filter="false"
    data-test="k8s2-related-pods"
  >
    <template #cell-name="{ row }">
      <OButton variant="ghost-primary" size="xs" @click.stop="openPod(row)">{{
        raw(row.name)
      }}</OButton>
    </template>
    <template #cell-warn="{ row }">
      <span v-if="row.warnings.length" data-test="k8s2-related-warn" class="inline-flex">
        <OIcon
          :name="severityOf(row.warnings) === 'error' ? 'error' : 'warning'"
          size="sm"
          :class="
            severityOf(row.warnings) === 'error'
              ? 'text-status-error-text'
              : 'text-status-warning-text'
          "
        />
        <OTooltip>
          <template #content>
            <div v-for="(w, i) in row.warnings" :key="i">{{ warningLabel(w, t, end) }}</div>
          </template>
        </OTooltip>
      </span>
    </template>
    <template #cell-node="{ row }">
      <OButton v-if="row.node" variant="ghost-primary" size="xs" @click.stop="openNode(row)">{{
        raw(row.node)
      }}</OButton>
      <span v-else>{{ raw("—") }}</span>
    </template>
    <template #cell-namespace="{ row }">
      <span>{{ raw(row.namespace) }}</span>
    </template>
    <template #cell-ready="{ row }">
      <span class="tabular-nums">{{ raw(readyText(row)) }}</span>
    </template>
    <template v-for="r in USAGE" :key="r.id" #[`cell-${r.id}`]="{ row }">
      <div v-if="shareOf(row, r) != null" class="flex w-full min-w-0 items-center gap-2">
        <OProgressBar
          size="xs"
          class="min-w-0 flex-1"
          :value="Math.min(shareOf(row, r) ?? 0, 100) / 100"
          :variant="usageBarVariant(shareOf(row, r))"
        />
        <OTooltip
          :content="t(r.tip, { pct: formatPct(shareOf(row, r)), value: r.format(r.used(row)) })"
        />
      </div>
      <span v-else class="tabular-nums">{{ raw(r.format(r.used(row))) }}</span>
    </template>
    <template #cell-status="{ row }">
      <span :class="TONE_TEXT_CLASS[toneOf(row.status?.variant)]">{{
        row.status ? chipLabel(row.status, t) : raw("—")
      }}</span>
    </template>
  </OTable>
</template>
