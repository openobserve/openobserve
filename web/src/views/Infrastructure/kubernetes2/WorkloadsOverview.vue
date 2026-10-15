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
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OText from "@/lib/core/Typography/OText.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import K8sListHeader from "./K8sListHeader.vue";
import { KIND_INFO, type View } from "./kubernetesQueries";
import type { DetailsRef, K8sUrlState } from "./kubernetesUrlState";
import { detailKindOf, type EventRow } from "./kubernetesEvents";
import { INVENTORY_KEY, filterRows, formatAge, type Inventory } from "./kubernetesModel";
import {
  statusCounts,
  type StatusKind,
  type StatusRow,
  type WorkloadStatus,
} from "./kubernetesStatus";

const props = defineProps<{
  inventory: Inventory;
  cluster: string | null;
  namespaces: string[];
  namespaceOptions: string[];
  events: EventRow[];
  eventLinksEnabled: boolean;
  // µs
  endUs: number;
  loading: boolean;
  lastUpdatedAt: number | null;
}>();

const emit = defineEmits<{
  update: [patch: Partial<K8sUrlState>];
  view: [view: View];
  open: [ref: DetailsRef];
  refresh: [];
}>();

const { t } = useI18nTyped();

const RECENT_EVENTS = 10;

const COMPACT = { cellClass: "text-compact" };

const CARDS: Array<{ kind: StatusKind; title: I18nKey }> = [
  { kind: "pod", title: "infra.k8s2.workloadsCardPods" },
  { kind: "deployment", title: "infra.k8s2.workloadsCardDeployments" },
  { kind: "daemonset", title: "infra.k8s2.workloadsCardDaemonSets" },
  { kind: "statefulset", title: "infra.k8s2.workloadsCardStatefulSets" },
  { kind: "replicaset", title: "infra.k8s2.workloadsCardReplicaSets" },
  { kind: "job", title: "infra.k8s2.workloadsCardJobs" },
  { kind: "cronjob", title: "infra.k8s2.workloadsCardCronJobs" },
];

const STATUS_LABEL: Record<WorkloadStatus, I18nKey> = {
  running: "infra.k8s2.workloadsStatusRunning",
  pending: "infra.k8s2.workloadsStatusPending",
  succeeded: "infra.k8s2.workloadsStatusSucceeded",
  failed: "infra.k8s2.workloadsStatusFailed",
  evicted: "infra.k8s2.workloadsStatusEvicted",
  unknown: "infra.k8s2.workloadsStatusUnknown",
  scheduled: "infra.k8s2.workloadsStatusScheduled",
  suspended: "infra.k8s2.workloadsStatusSuspended",
};

const scope = computed(() => ({ cluster: props.cluster, namespaces: props.namespaces }));

const clusterPods = computed(() =>
  filterRows(props.inventory.pods, { cluster: props.cluster, namespaces: [] }, ""),
);

const cards = computed(() =>
  CARDS.map(({ kind, title }) => {
    const rows = filterRows(props.inventory[INVENTORY_KEY[kind]] as StatusRow[], scope.value, "");
    return {
      kind,
      title,
      view: KIND_INFO[kind].view,
      total: rows.length,
      counts: statusCounts(kind, rows, props.inventory.pods),
    };
  }),
);

const podCount = computed(() => cards.value[0].total);

const recentEvents = computed(() => props.events.slice(0, RECENT_EVENTS));

const columns = computed<OTableColumnDef<EventRow>[]>(() => [
  {
    id: "type",
    header: t("infra.k8s2.workloadsColType"),
    accessorKey: "type",
    size: 90,
    meta: COMPACT,
  },
  {
    id: "message",
    header: t("infra.k8s2.workloadsColMessage"),
    accessorKey: "note",
    size: 360,
    minSize: 160,
    meta: COMPACT,
  },
  {
    id: "namespace",
    header: t("infra.k8s2.workloadsColNamespace"),
    accessorFn: (row) => row.object.namespace,
    size: 130,
    meta: COMPACT,
  },
  {
    id: "object",
    header: t("infra.k8s2.workloadsColObject"),
    accessorFn: (row) => `${row.object.kind}: ${row.object.name}`,
    size: 240,
    meta: COMPACT,
  },
  {
    id: "source",
    header: t("infra.k8s2.workloadsColSource"),
    accessorKey: "source",
    size: 180,
    meta: COMPACT,
  },
  {
    id: "count",
    header: t("infra.k8s2.workloadsColCount"),
    accessorKey: "count",
    size: 80,
    meta: COMPACT,
  },
  {
    id: "age",
    header: t("infra.k8s2.workloadsColAge"),
    accessorKey: "firstSeen",
    size: 80,
    meta: COMPACT,
  },
  {
    id: "lastSeen",
    header: t("infra.k8s2.workloadsColLastSeen"),
    accessorKey: "lastSeen",
    size: 90,
    meta: COMPACT,
  },
]);

function since(us: number | null) {
  return raw(formatAge(us == null ? null : props.endUs - us));
}

function linkable(row: EventRow) {
  return props.eventLinksEnabled && detailKindOf(row.object.kind) != null;
}

function openObject(row: EventRow) {
  const kind = detailKindOf(row.object.kind);
  if (!kind || !props.eventLinksEnabled) return;
  emit("open", {
    kind,
    cluster: props.cluster ?? "",
    namespace: row.object.namespace,
    name: row.object.name,
  });
}

function setNamespaces(namespaces: string[]) {
  emit("update", { namespaces });
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3 p-3" data-test="k8s2-workloads-overview">
    <K8sListHeader
      :title="t('infra.k8s2.workloadsTitle')"
      :count="podCount"
      :total="clusterPods.length"
      :count-label="raw('')"
      namespaced
      :namespace-options="namespaceOptions"
      :namespaces="namespaces"
      :searchable="false"
      @update:namespaces="setNamespaces"
      @clear="setNamespaces([])"
    >
      <template #trailing>
        <ORefreshButton
          :last-run-at="lastUpdatedAt"
          :loading="loading"
          data-test="k8s2-workloads-refresh"
          @click="emit('refresh')"
        />
      </template>
    </K8sListHeader>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <section
        v-for="card in cards"
        :key="card.kind"
        class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-2 border p-3"
        :data-test="`k8s2-workloads-card-${card.kind}`"
      >
        <OButton
          variant="ghost-primary"
          size="xs"
          class="self-start"
          :data-test="`k8s2-workloads-title-${card.kind}`"
          @click="emit('view', card.view)"
          >{{ t(card.title, { count: card.total }) }}</OButton
        >
        <template v-if="card.counts.length">
          <div
            v-for="row in card.counts"
            :key="row.status"
            class="flex flex-col gap-1"
            :data-test="`k8s2-workloads-status-${card.kind}-${row.status}`"
          >
            <div class="flex items-center gap-1 text-xs">
              <span data-test="k8s2-workloads-status-label">{{
                t(STATUS_LABEL[row.status], { count: row.count })
              }}</span>
              <span v-if="row.rule" class="text-text-secondary inline-flex">
                <OIcon name="info" size="xs" />
                <OTooltip :content="t('infra.k8s2.workloadsRuleTip')" />
              </span>
            </div>
            <OProgressBar
              size="xs"
              :value="row.count / card.total"
              :variant="row.variant"
              :data-test="`k8s2-workloads-bar-${card.kind}-${row.status}`"
            />
          </div>
        </template>
        <OText v-else variant="meta" class="text-text-secondary">{{
          t("infra.k8s2.workloadsNone")
        }}</OText>
      </section>
    </div>

    <section
      class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-2 border p-3"
      data-test="k8s2-workloads-events-card"
    >
      <div class="flex items-center gap-2">
        <OText variant="card-title" data-test="k8s2-workloads-events-title">{{
          t("infra.k8s2.workloadsRecentEvents")
        }}</OText>
        <OButton
          variant="ghost-primary"
          size="xs"
          class="ms-auto"
          data-test="k8s2-workloads-events-view-all"
          @click="emit('view', 'events')"
          >{{ t("infra.k8s2.workloadsViewAll") }}</OButton
        >
      </div>
      <OTable
        :data="recentEvents"
        :columns="columns"
        row-key="key"
        dense
        :row-height="32"
        :frame="false"
        :show-global-filter="false"
        pagination="none"
        data-test="k8s2-workloads-events-table"
      >
        <template #cell-type="{ row }">
          <span :data-test="`k8s2-workloads-event-type-${row.key}`">{{ raw(row.type) }}</span>
        </template>
        <template #cell-message="{ row }">
          <span
            class="min-w-0 truncate"
            :class="row.type === 'Warning' ? 'text-status-error-text' : ''"
            :data-test="`k8s2-workloads-event-message-${row.key}`"
            >{{ raw(row.note) }}<OTooltip :content="raw(row.note)"
          /></span>
        </template>
        <template #cell-namespace="{ row }">
          <OButton
            v-if="row.object.namespace"
            variant="ghost-primary"
            size="xs"
            :data-test="`k8s2-workloads-event-namespace-${row.key}`"
            @click.stop="setNamespaces([row.object.namespace])"
            >{{ raw(row.object.namespace) }}</OButton
          >
        </template>
        <template #cell-object="{ row }">
          <OButton
            v-if="linkable(row)"
            variant="ghost-primary"
            size="xs"
            :data-test="`k8s2-workloads-event-object-${row.key}`"
            @click.stop="openObject(row)"
            >{{ raw(`${row.object.kind}: ${row.object.name}`) }}</OButton
          >
          <span
            v-else
            class="min-w-0 truncate"
            :data-test="`k8s2-workloads-event-object-${row.key}`"
            >{{ raw(`${row.object.kind}: ${row.object.name}`)
            }}<OTooltip
              v-if="!eventLinksEnabled && detailKindOf(row.object.kind)"
              :content="t('infra.k8s2.workloadsClusterUnknown')"
          /></span>
        </template>
        <template #cell-source="{ row }">
          <span class="min-w-0 truncate">{{ raw(row.source || "—") }}</span>
        </template>
        <template #cell-count="{ row }">
          <span class="tabular-nums">{{ raw(row.count ?? "—") }}</span>
        </template>
        <template #cell-age="{ row }">
          <span class="tabular-nums" :data-test="`k8s2-workloads-event-age-${row.key}`">{{
            since(row.firstSeen)
          }}</span>
        </template>
        <template #cell-lastSeen="{ row }">
          <span class="tabular-nums" :data-test="`k8s2-workloads-event-last-seen-${row.key}`">{{
            since(row.lastSeen)
          }}</span>
        </template>
      </OTable>
    </section>
  </div>
</template>
