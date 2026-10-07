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
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import RelatedPodsTable from "./RelatedPodsTable.vue";
import type { DetailsRef } from "./kubernetesUrlState";
import {
  formatBytes,
  formatCores,
  membersOf,
  nodeConditionWords,
  type Inventory,
  type NodeRow,
} from "./kubernetesModel";

const props = defineProps<{ row: NodeRow; inventory: Inventory; end: number }>();

const emit = defineEmits<{ open: [ref: DetailsRef] }>();

const { t } = useI18nTyped();

const FILLED: Partial<Record<BadgeVariant, BadgeVariant>> = {
  "success-soft": "success",
  "warning-soft": "warning",
  "error-soft": "error",
};

const ALLOCATABLE_FORMAT: Record<string, (v: number) => string> = {
  cpu: formatCores,
  memory: formatBytes,
  ephemeral_storage: formatBytes,
};

const status = computed(() => props.row.object?.status ?? null);

const addresses = computed(() => {
  const out: string[] = [];
  if (props.row.info?.internal_ip) out.push(`InternalIP: ${props.row.info.internal_ip}`);
  const hostname = ((status.value?.addresses ?? []) as any[]).find((a) => a?.type === "Hostname");
  if (hostname?.address) out.push(`Hostname: ${hostname.address}`);
  return out;
});

const os = computed(() => {
  const info = status.value?.nodeInfo;
  if (!info?.operatingSystem) return null;
  return info.architecture
    ? `${info.operatingSystem} (${info.architecture})`
    : info.operatingSystem;
});

const INFO_ROWS = [
  { id: "os-image", label: "infra.k8s2.drawerOsImage", field: "os_image" },
  { id: "kernel", label: "infra.k8s2.drawerKernel", field: "kernel_version" },
  { id: "runtime", label: "infra.k8s2.drawerRuntime", field: "container_runtime_version" },
  { id: "kubelet", label: "infra.k8s2.drawerKubelet", field: "kubelet_version" },
] as const;

const taints = computed(() =>
  (props.row.taints ?? []).map((tn) => `${tn.key}${tn.value ? `=${tn.value}` : ""}:${tn.effect}`),
);

const conditions = computed(() =>
  nodeConditionWords(props.row).map((w) => ({
    text: w.text,
    variant: FILLED[w.variant] ?? ("default" as BadgeVariant),
  })),
);

const allocatable = computed(() =>
  Object.entries(props.row.allocatable)
    .map(([k, v]) => `${k}: ${(ALLOCATABLE_FORMAT[k] ?? String)(v)}`)
    .join(", "),
);

const capacity = computed(() => {
  const cap = status.value?.capacity;
  return cap && typeof cap === "object"
    ? Object.entries(cap)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    : "";
});

const pods = computed(() => membersOf(props.inventory.pods, props.row));
</script>

<template>
  <div class="flex flex-col gap-4">
    <ODescriptionList dense>
      <ODescriptionItem :label="t('infra.k8s2.drawerAddresses')" data-test="k8s2-node-addresses">
        <template v-if="addresses.length">
          <div v-for="a in addresses" :key="a">{{ raw(a) }}</div>
        </template>
      </ODescriptionItem>
      <ODescriptionItem :label="t('infra.k8s2.drawerOs')" data-test="k8s2-node-os">
        <template v-if="os">{{ raw(os) }}</template>
      </ODescriptionItem>
      <ODescriptionItem
        v-for="r in INFO_ROWS"
        :key="r.id"
        :label="t(r.label)"
        :data-test="`k8s2-node-${r.id}`"
      >
        <template v-if="row.info?.[r.field]">{{ raw(row.info[r.field]) }}</template>
      </ODescriptionItem>
      <ODescriptionItem :label="t('infra.k8s2.drawerTaints')" data-test="k8s2-node-taints">
        <div v-if="taints.length" class="flex flex-col items-start gap-1">
          <OTag v-for="(s, i) in taints" :key="i" size="sm" variant="default-soft">{{
            raw(s)
          }}</OTag>
        </div>
      </ODescriptionItem>
      <ODescriptionItem :label="t('infra.k8s2.drawerConditions')" data-test="k8s2-node-conditions">
        <div v-if="conditions.length" class="flex flex-wrap gap-1">
          <OTag v-for="c in conditions" :key="c.text" size="sm" :variant="c.variant">{{
            raw(c.text)
          }}</OTag>
          <OTooltip>
            <template #content>
              <div class="grid grid-cols-2 gap-x-3">
                <template v-for="(value, condition) in row.conditions" :key="condition">
                  <span>{{ raw(String(condition)) }}</span>
                  <span>{{ raw(value) }}</span>
                </template>
              </div>
            </template>
          </OTooltip>
        </div>
      </ODescriptionItem>
      <ODescriptionItem :label="t('infra.k8s2.drawerCapacity')" data-test="k8s2-node-capacity">
        <template v-if="capacity">{{ raw(capacity) }}</template>
      </ODescriptionItem>
      <ODescriptionItem
        :label="t('infra.k8s2.drawerAllocatable')"
        data-test="k8s2-node-allocatable"
      >
        <template v-if="allocatable">{{ raw(allocatable) }}</template>
      </ODescriptionItem>
    </ODescriptionList>
    <section class="flex flex-col gap-2">
      <OText variant="card-title" as="h4">{{ t("infra.k8s2.columnPods") }}</OText>
      <RelatedPodsTable
        :pods="pods"
        :end="end"
        :allocatable="row.allocatable"
        @open="(r: DetailsRef) => emit('open', r)"
      />
    </section>
  </div>
</template>
