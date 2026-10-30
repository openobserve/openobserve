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
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import K8sListHeader from "./K8sListHeader.vue";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import {
  SEGMENT_SWATCH,
  type SegmentedBarVariant,
} from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import { KIND_INFO, type View } from "./kubernetesQueries";
import type { DetailsRef, K8sUrlState } from "./kubernetesUrlState";
import { detailKindOf, type EventRow } from "./kubernetesEvents";
import {
  INVENTORY_KEY,
  chipLabel,
  filterRows,
  formatAge,
  podBucket,
  type Inventory,
  type PodBucket,
  type PodRow,
} from "./kubernetesModel";
import { workloadProblems, type WorkloadProblem } from "./workloadProblems";
import { problemStatusWord, workloadStatusWord } from "./workloadStatusLabel";
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
  action: [action: { type: "logs"; ref: DetailsRef }];
  refresh: [];
}>();

const { t } = useI18nTyped();

const RECENT_EVENTS = 10;

const COMPACT = { cellClass: "text-compact" };

const CARDS: Array<{ kind: StatusKind; title: I18nKey; icon: IconName }> = [
  { kind: "pod", title: "infra.k8s2.workloadsCardPods", icon: "view-in-ar" },
  { kind: "deployment", title: "infra.k8s2.workloadsCardDeployments", icon: "layers" },
  { kind: "daemonset", title: "infra.k8s2.workloadsCardDaemonSets", icon: "lan" },
  { kind: "statefulset", title: "infra.k8s2.workloadsCardStatefulSets", icon: "database" },
  { kind: "replicaset", title: "infra.k8s2.workloadsCardReplicaSets", icon: "content-copy" },
  { kind: "job", title: "infra.k8s2.workloadsCardJobs", icon: "task-alt" },
  { kind: "cronjob", title: "infra.k8s2.workloadsCardCronJobs", icon: "schedule" },
];

const KIND_TITLE: Record<WorkloadProblem["kind"], I18nKey> = {
  deployment: "infra.k8s2.kindDeployment",
  daemonset: "infra.k8s2.kindDaemonSet",
  statefulset: "infra.k8s2.kindStatefulSet",
  job: "infra.k8s2.kindJob",
};

const SEGMENT_VARIANT: Record<string, SegmentedBarVariant> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  default: "neutral",
  neutral: "neutral",
};

const POD_BUCKETS: Array<{ id: PodBucket; label: I18nKey; variant: SegmentedBarVariant }> = [
  { id: "ready", label: "infra.k8s2.workloadsLegendReady", variant: "success" },
  { id: "pending", label: "infra.k8s2.workloadsLegendPending", variant: "warning" },
  { id: "failing", label: "infra.k8s2.workloadsLegendFailing", variant: "danger" },
  { id: "completed", label: "infra.k8s2.workloadsLegendCompleted", variant: "neutral" },
  { id: "unknown", label: "infra.k8s2.workloadsLegendUnknown", variant: "muted" },
];

const LEGEND_LABEL: Record<WorkloadStatus, I18nKey> = {
  running: "infra.k8s2.workloadsLegendRunning",
  pending: "infra.k8s2.workloadsLegendPending",
  succeeded: "infra.k8s2.workloadsLegendSucceeded",
  failed: "infra.k8s2.workloadsLegendFailed",
  evicted: "infra.k8s2.workloadsLegendEvicted",
  unknown: "infra.k8s2.workloadsLegendUnknown",
  scheduled: "infra.k8s2.workloadsLegendScheduled",
  suspended: "infra.k8s2.workloadsLegendSuspended",
};

const scope = computed(() => ({ cluster: props.cluster, namespaces: props.namespaces }));

const clusterPods = computed(() =>
  filterRows(props.inventory.pods, { cluster: props.cluster, namespaces: [] }, ""),
);

function podCounts(rows: PodRow[]) {
  const tally = new Map<PodBucket, number>();
  for (const row of rows) tally.set(podBucket(row), (tally.get(podBucket(row)) ?? 0) + 1);
  return POD_BUCKETS.flatMap(({ id, label, variant }) =>
    tally.has(id)
      ? [{ status: id, count: tally.get(id)!, rule: id === "unknown", variant, label }]
      : [],
  );
}

function controllerCounts(kind: StatusKind, rows: StatusRow[]) {
  return statusCounts(kind, rows, props.inventory.pods).map((c) => ({
    status: c.status as string,
    count: c.count,
    rule: c.rule,
    variant: SEGMENT_VARIANT[c.variant],
    label: workloadStatusWord(kind, c.status) ?? LEGEND_LABEL[c.status],
  }));
}

const cards = computed(() =>
  CARDS.map(({ kind, title, icon }) => {
    const rows = filterRows(props.inventory[INVENTORY_KEY[kind]] as StatusRow[], scope.value, "");
    const counts = (
      kind === "pod" ? podCounts(rows as PodRow[]) : controllerCounts(kind, rows)
    ).map((c) => ({ ...c, dot: SEGMENT_SWATCH[c.variant] }));
    return {
      kind,
      title,
      icon,
      view: KIND_INFO[kind].view,
      total: rows.length,
      counts,
      segments: counts.map((c) => ({
        id: c.status,
        pct: (c.count / rows.length) * 100,
        variant: c.variant,
      })),
    };
  }),
);

const podCount = computed(() => cards.value[0].total);

const problemResult = computed(() =>
  workloadProblems(
    {
      deployments: filterRows(props.inventory.deployments, scope.value, ""),
      daemonsets: filterRows(props.inventory.daemonsets, scope.value, ""),
      statefulsets: filterRows(props.inventory.statefulsets, scope.value, ""),
      jobs: filterRows(props.inventory.jobs, scope.value, ""),
    },
    props.inventory.pods,
  ),
);

const problems = computed(() => problemResult.value.rows);

const problemColumns = computed<OTableColumnDef<WorkloadProblem>[]>(() => [
  {
    id: "name",
    header: t("infra.k8s2.workloadsColWorkload"),
    accessorKey: "name",
    size: 260,
    meta: COMPACT,
  },
  {
    id: "kind",
    header: t("infra.k8s2.workloadsColKind"),
    accessorFn: (row) => t(KIND_TITLE[row.kind]),
    size: 130,
    meta: COMPACT,
  },
  {
    id: "ready",
    header: t("infra.k8s2.workloadsColPods"),
    accessorFn: (row) => row.ready?.ready ?? 0,
    size: 120,
    meta: COMPACT,
  },
  {
    id: "reason",
    header: t("infra.k8s2.workloadsColReason"),
    accessorFn: (row) => (row.reason ? chipLabel(row.reason, t) : ""),
    size: 260,
    minSize: 140,
    meta: COMPACT,
  },
  {
    id: "status",
    header: t("infra.k8s2.workloadsColStatus"),
    accessorKey: "severity",
    size: 120,
    meta: COMPACT,
  },
  { id: "actions", header: raw(""), size: 90, enableSorting: false, meta: COMPACT },
]);

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

function openProblem(row: WorkloadProblem) {
  emit("open", { kind: row.kind, cluster: row.cluster, namespace: row.namespace, name: row.name });
}

function logsOf(row: WorkloadProblem) {
  const pod = row.pod;
  if (!pod) return;
  emit("action", {
    type: "logs",
    ref: { kind: "pod", cluster: pod.cluster, namespace: pod.namespace, name: pod.name },
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
      :count-label="t('infra.k8s2.podCount', { count: podCount }, podCount)"
      :count-noun="t('infra.k8s2.podNoun', {}, clusterPods.length)"
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
        <div class="flex items-center justify-between gap-2">
          <OButton
            variant="ghost-primary"
            size="xs"
            :data-test="`k8s2-workloads-title-${card.kind}`"
            @click="emit('view', card.view)"
          >
            <OIcon :name="card.icon" size="sm" />
            {{ t(card.title) }}
          </OButton>
          <span
            class="text-xl font-semibold tabular-nums"
            :data-test="`k8s2-workloads-total-${card.kind}`"
            >{{ raw(card.total) }}</span
          >
        </div>
        <template v-if="card.counts.length">
          <OSegmentedBar :segments="card.segments" :data-test="`k8s2-workloads-bar-${card.kind}`" />
          <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <span
              v-for="row in card.counts"
              :key="row.status"
              class="flex items-center gap-1"
              :data-test="`k8s2-workloads-status-${card.kind}-${row.status}`"
            >
              <span class="size-2 shrink-0 rounded-full" :class="row.dot" />
              <span class="text-text-secondary" data-test="k8s2-workloads-status-label">{{
                t(row.label)
              }}</span>
              <span class="font-semibold tabular-nums" data-test="k8s2-workloads-status-count">{{
                raw(row.count)
              }}</span>
              <span v-if="row.rule" class="text-text-secondary inline-flex">
                <OIcon name="info" size="xs" />
                <OTooltip :content="t('infra.k8s2.workloadsRuleTip')" />
              </span>
            </span>
          </div>
        </template>
        <OText v-else variant="meta" class="text-text-secondary">{{
          t("infra.k8s2.workloadsNone")
        }}</OText>
      </section>
    </div>

    <section
      class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-2 border p-3"
      data-test="k8s2-workloads-problems-card"
    >
      <OText variant="card-title" data-test="k8s2-workloads-problems-title">{{
        t("infra.k8s2.workloadsProblems")
      }}</OText>
      <OTable
        v-if="problems.length"
        :data="problems"
        :columns="problemColumns"
        row-key="key"
        dense
        :row-height="40"
        :frame="false"
        :show-global-filter="false"
        pagination="none"
        data-test="k8s2-workloads-problems-table"
        @row-click="openProblem"
      >
        <template #cell-name="{ row }">
          <span class="flex min-w-0 flex-col leading-tight">
            <OTruncatedText
              class="text-text-heading font-semibold"
              :data-test="`k8s2-workloads-problem-name-${row.key}`"
              >{{ raw(row.name) }}</OTruncatedText
            >
            <OTruncatedText class="text-text-secondary text-xs">{{
              raw(row.namespace)
            }}</OTruncatedText>
          </span>
        </template>
        <template #cell-ready="{ row }">
          <span v-if="row.ready" class="tabular-nums">{{
            t("infra.k8s2.workloadsReadyOf", { ready: row.ready.ready, desired: row.ready.desired })
          }}</span>
          <span v-else>{{ raw("—") }}</span>
        </template>
        <template #cell-reason="{ row }">
          <OTruncatedText>{{ row.reason ? chipLabel(row.reason, t) : raw("—") }}</OTruncatedText>
        </template>
        <template #cell-status="{ row }">
          <OTag
            size="xs"
            :variant="row.severity === 'failed' ? 'error-soft' : 'warning-soft'"
            :data-test="`k8s2-workloads-problem-status-${row.key}`"
            >{{ t(problemStatusWord(row.kind, row.severity)) }}</OTag
          >
        </template>
        <template #cell-actions="{ row }">
          <OButton
            v-if="row.pod"
            variant="ghost-primary"
            size="xs"
            :data-test="`k8s2-workloads-problem-logs-${row.key}`"
            @click.stop="logsOf(row)"
            >{{ t("infra.k8s2.workloadsLogs") }}</OButton
          >
        </template>
      </OTable>
      <OText
        v-if="problemResult.total > problems.length"
        variant="meta"
        class="text-text-secondary"
        data-test="k8s2-workloads-problems-showing"
        >{{
          t("infra.k8s2.workloadsProblemsShowing", {
            shown: problems.length,
            total: problemResult.total,
          })
        }}</OText
      >
      <OEmptyState
        v-else-if="!problems.length"
        size="inline"
        preset="no-data"
        :title="t('infra.k8s2.workloadsNoProblems')"
        data-test="k8s2-workloads-problems-empty"
      />
    </section>

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
          <OTruncatedText
            :class="row.type === 'Warning' ? 'text-status-error-text' : ''"
            :data-test="`k8s2-workloads-event-message-${row.key}`"
            >{{ raw(row.note) }}</OTruncatedText
          >
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
          <OTruncatedText
            v-else
            :tooltip="false"
            :data-test="`k8s2-workloads-event-object-${row.key}`"
            >{{ raw(`${row.object.kind}: ${row.object.name}`)
            }}<OTooltip
              v-if="!eventLinksEnabled && detailKindOf(row.object.kind)"
              :content="t('infra.k8s2.workloadsClusterUnknown')"
          /></OTruncatedText>
        </template>
        <template #cell-source="{ row }">
          <OTruncatedText>{{ raw(row.source || "—") }}</OTruncatedText>
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
