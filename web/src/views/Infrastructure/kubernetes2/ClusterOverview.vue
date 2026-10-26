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
import { computed, ref, toRef } from "vue";
import { useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OText from "@/lib/core/Typography/OText.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OStatCard from "@/lib/data/StatStrip/OStatCard.vue";
import type { StatTone } from "@/lib/data/StatStrip/OStatStrip.types";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useOrgId } from "@/composables/query";
import { escapeLabel, type QueryId } from "./kubernetesQueries";
import type { DetailsRef, K8sUrlState } from "./kubernetesUrlState";
import { detailKindOf, warningListRows, type WarningListRow } from "./kubernetesEvents";
import { promqlPanelSchema } from "./kubernetesPanels";
import {
  clusterLabelOf,
  formatAge,
  inScope,
  type Inventory,
  type QueryResults,
  type Series,
  type WarningEvent,
} from "./kubernetesModel";
import { ATTENTION_LIMIT, attentionItems, pctOf, podBuckets } from "./overviewModel";
import { useOverviewSignals } from "./useOverviewSignals";
import K8sAttentionList from "./K8sAttentionList.vue";
import K8sCapacityCard from "./K8sCapacityCard.vue";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import {
  SEGMENT_SWATCH,
  type SegmentedBarVariant,
} from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import K8sSignalCards from "./K8sSignalCards.vue";

type Resource = "cpu" | "memory";

const props = defineProps<{
  inventory: Inventory;
  results: QueryResults;
  warnings: WarningEvent[];
  cluster: string | null;
  // µs
  range: { start: number; end: number };
  refreshNonce: number;
  hasStream: (stream: string) => boolean;
  loading: boolean;
  lastUpdatedAt: number | null;
  forbidden?: boolean;
}>();

const emit = defineEmits<{
  open: [ref: DetailsRef];
  refresh: [];
  navigate: [patch: Partial<K8sUrlState>];
  action: [type: "logs" | "explain", ref: DetailsRef];
}>();

const { t } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();

const HOUR_US = 3_600_000_000;

const USAGE: Record<Resource, { stream: string; query: QueryId }> = {
  cpu: { stream: "k8s_node_cpu_usage", query: "O4" },
  memory: { stream: "k8s_node_memory_working_set", query: "O5" },
};

const resource = ref<Resource>("cpu");

const signals = useOverviewSignals(
  toRef(props, "cluster"),
  computed(() => props.refreshNonce),
);

const clusterValue = (metric: Record<string, string>) => {
  const label = clusterLabelOf(metric);
  return label ? metric[label] : "";
};

const seriesOf = (id: QueryId, kind?: string): Series[] =>
  (props.results.get(id) ?? []).filter(
    (s) =>
      (props.cluster == null || clusterValue(s.metric) === props.cluster) &&
      (kind == null || s.metric.resource === kind),
  );

const sum = (series: Series[]) => series.reduce((acc, s) => acc + s.value, 0);

// Usage and allocatable need a series; requests and limits are sparse, so an empty answer is 0.
const present = (id: QueryId, kind?: string) => {
  const series = seriesOf(id, kind);
  return series.length ? sum(series) : null;
};

const sparse = (id: QueryId, kind: string) =>
  props.results.has(id) ? sum(seriesOf(id, kind)) : null;

const hasNodes = computed(() => seriesOf("O1").length > 0);

// Results land after the first render, so an empty answer only counts once a load has finished.
const awaiting = computed(() => !hasNodes.value && (props.loading || props.lastUpdatedAt == null));

const allocatable = (kind: string) => present("O1", kind);

const capacity = computed(() =>
  (["cpu", "memory"] as Resource[]).map((kind) => ({
    kind,
    usage: present(USAGE[kind].query),
    requests: sparse("O2", kind),
    limits: sparse("O3", kind),
    allocatable: allocatable(kind),
  })),
);

const partial = computed(() => capacity.value.some((c) => c.requests == null || c.limits == null));

const buckets = computed(() => podBuckets(props.inventory, props.cluster));

const podSlots = computed(() => {
  const used = buckets.value.total - buckets.value.completed;
  const total = allocatable("pods");
  return { used, total, pct: pctOf(used, total) };
});

const podSegments = computed(() => {
  const b = buckets.value;
  const share = (n: number) => (b.total ? (n / b.total) * 100 : 0);
  const segments: {
    id: string;
    count: number;
    variant: SegmentedBarVariant;
    label: I18nText;
  }[] = [
    {
      id: "ready",
      count: b.ready,
      variant: "success",
      label: t("infra.k8s2.overviewPodsReady", { count: b.ready }),
    },
    {
      id: "pending",
      count: b.pending,
      variant: "warning",
      label: t("infra.k8s2.overviewPodsPending", { count: b.pending }),
    },
    {
      id: "failing",
      count: b.failing,
      variant: "danger",
      label: t("infra.k8s2.overviewPodsFailing", { count: b.failing }),
    },
    {
      id: "completed",
      count: b.completed,
      variant: "neutral",
      label: t("infra.k8s2.overviewPodsCompleted", { count: b.completed }),
    },
    {
      id: "unknown",
      count: b.unknown,
      variant: "muted",
      label: t("infra.k8s2.overviewPodsUnknown", { count: b.unknown }),
    },
  ];
  return segments.map((seg) => ({ ...seg, pct: share(seg.count) }));
});

const podLegend = computed(() => podSegments.value.filter((s) => s.id !== "unknown" || s.count));

const podBarSegments = computed(() => podSegments.value.filter((s) => s.pct > 0));

const podSlotText = computed<I18nText>(() => {
  const { used, total, pct } = podSlots.value;
  return total == null
    ? t("infra.k8s2.overviewPodSlotsUnknown", { used })
    : t("infra.k8s2.overviewPodSlots", { used, total, pct: `${Math.round(pct ?? 0)}%` });
});

const attention = computed(() => attentionItems(props.inventory, props.cluster));

const warningRows = computed(() => warningListRows(props.inventory, props.warnings, props.cluster));

const scopedNodes = computed(() =>
  props.inventory.nodes.filter((n) => inScope(n, { cluster: props.cluster, namespaces: [] })),
);

const nodesTile = computed(() => {
  const nodes = scopedNodes.value;
  const ready = nodes.filter((n) => n.ready === "true").length;
  const tone: StatTone = nodes.some((n) => n.ready === "false")
    ? "error"
    : ready < nodes.length
      ? "warning"
      : nodes.length
        ? "success"
        : "neutral";
  return { value: `${ready} / ${nodes.length}`, tone };
});

const podsTone = computed<StatTone>(() =>
  buckets.value.failing ? "error" : buckets.value.pending ? "warning" : "success",
);

const alertsTile = computed(() => {
  const firing = signals.firingAlerts.value.length;
  const incidents = signals.openIncidents.value.length;
  if (!signals.alertsAvailable.value && !signals.incidentsAvailable.value) {
    return {
      value: "—",
      sub: t("infra.k8s2.overviewKpiUnavailable"),
      tone: "neutral" as StatTone,
    };
  }
  const sub =
    signals.incidentsAvailable.value && incidents
      ? t("infra.k8s2.overviewKpiAlertsIncidents", { count: incidents }, incidents)
      : t("infra.k8s2.overviewKpiAlertsFiring");
  return { value: firing, sub, tone: (firing || incidents ? "error" : "success") as StatTone };
});

const chartLabel = computed(
  () => clusterLabelOf(seriesOf(USAGE[resource.value].query)[0]?.metric ?? {}) ?? "k8s_cluster",
);

const chartSchema = computed(() => {
  const { stream } = USAGE[resource.value];
  const matcher =
    props.cluster == null ? "" : `{${chartLabel.value}="${escapeLabel(props.cluster)}"}`;
  const current = capacity.value.find((c) => c.kind === resource.value)!;
  const lines: { value: number | null; name: I18nText }[] = [
    { value: current.allocatable, name: t("infra.k8s2.overviewAllocatable") },
    { value: current.limits, name: t("infra.k8s2.overviewLimits") },
    { value: current.requests, name: t("infra.k8s2.overviewRequests") },
  ];
  return promqlPanelSchema({
    id: `k8s2-cluster-${resource.value}`,
    type: "bar",
    unit: resource.value === "memory" ? "bytes" : null,
    queries: [{ query: `sum(${stream}${matcher})`, stream }],
    markLines: lines.flatMap((l) => (l.value != null ? [{ value: l.value, name: l.name }] : [])),
  });
});

// The dashboard engine reads these Dates as microsecond epochs, as DbmMetricPanel passes them.
const chartTime = computed(() => ({
  start_time: new Date(props.range.end - HOUR_US),
  end_time: new Date(props.range.end),
}));

const columns = computed<OTableColumnDef<WarningListRow>[]>(() => [
  {
    id: "message",
    header: t("infra.k8s2.overviewColMessage"),
    accessorFn: (row) => row.message.text ?? "",
    size: 480,
    minSize: 200,
    sortable: true,
    meta: { cellClass: "text-compact" },
  },
  {
    id: "object",
    header: t("infra.k8s2.overviewColObject"),
    accessorFn: (row) => row.object.name,
    size: 240,
    sortable: true,
    meta: { cellClass: "text-compact" },
  },
  {
    id: "type",
    header: t("infra.k8s2.overviewColType"),
    accessorFn: (row) => row.object.kind,
    size: 140,
    sortable: true,
    meta: { cellClass: "text-compact" },
  },
  {
    id: "age",
    header: t("infra.k8s2.overviewColAge"),
    accessorFn: (row) => row.lastSeen ?? undefined,
    size: 90,
    sortable: true,
    sortUndefined: "last",
    meta: { cellClass: "text-compact" },
  },
]);

function messageText(row: WarningListRow): I18nText {
  return row.message.key ? t(row.message.key) : raw(row.message.text ?? "");
}

function ageText(row: WarningListRow) {
  return formatAge(row.lastSeen == null ? null : props.range.end - row.lastSeen);
}

function openRow(row: WarningListRow) {
  const kind = detailKindOf(row.object.kind);
  if (!kind) return;
  emit("open", {
    kind,
    cluster: props.cluster ?? "",
    namespace: row.object.namespace,
    name: row.object.name,
  });
}

const orgQuery = () => ({ org_identifier: orgId.value });

function openIncident(id: string) {
  void router.push({ name: "incidentDetail", params: { id }, query: orgQuery() });
}

function openIncidents() {
  void router.push({ name: "incidentList", query: { ...orgQuery(), status: "open" } });
}

function openAlerts() {
  void router.push({ name: "alertList", query: orgQuery() });
}

function onAlertsTile() {
  if (!signals.alertsAvailable.value && signals.incidentsAvailable.value) openIncidents();
  else openAlerts();
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3 p-3" data-test="k8s2-cluster-overview">
    <div class="flex min-w-0 items-center gap-2">
      <OText tag="h2" class="min-w-0 truncate text-lg font-semibold">
        {{ t("infra.k8s2.overviewTitle") }}
      </OText>
      <ORefreshButton
        class="ms-auto"
        :last-run-at="lastUpdatedAt"
        :loading="loading"
        data-test="k8s2-overview-refresh"
        @click="emit('refresh')"
      />
    </div>

    <OEmptyState v-if="forbidden" preset="no-access" data-test="k8s2-overview-forbidden" />

    <template v-else>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4" data-test="k8s2-overview-kpis">
        <OStatCard
          clickable
          icon="dns"
          :label="t('infra.k8s2.overviewKpiNodes')"
          :value="nodesTile.value"
          :sub="t('infra.k8s2.overviewKpiNodesSub')"
          :tone="nodesTile.tone"
          :loading="awaiting"
          data-test="k8s2-overview-kpi-nodes"
          @click="emit('navigate', { view: 'nodes' })"
        />
        <OStatCard
          clickable
          icon="hub"
          :label="t('infra.k8s2.overviewPods')"
          :value="`${buckets.ready} / ${buckets.total}`"
          sub-icon="info"
          :sub="
            t('infra.k8s2.overviewKpiPodsSub', {
              pending: buckets.pending,
              failing: buckets.failing,
            })
          "
          :tone="podsTone"
          :loading="awaiting"
          data-test="k8s2-overview-kpi-pods"
          @click="emit('navigate', { view: 'pods', status: 'failing' })"
        />
        <OStatCard
          clickable
          icon="notifications"
          :label="t('infra.k8s2.overviewKpiWarnings')"
          :value="warningRows.length"
          sub-icon="info"
          :sub="t('infra.k8s2.overviewKpiWarningsSub')"
          :tone="warningRows.length ? 'warning' : 'success'"
          :loading="awaiting"
          data-test="k8s2-overview-kpi-warnings"
          @click="emit('navigate', { view: 'events', status: 'warnings' })"
        />
        <OStatCard
          clickable
          icon="campaign"
          :label="t('infra.k8s2.overviewKpiAlerts')"
          :value="alertsTile.value"
          :sub="alertsTile.sub"
          :tone="alertsTile.tone"
          :loading="signals.alertsLoading.value"
          data-test="k8s2-overview-kpi-alerts"
          @click="onAlertsTile"
        />
      </div>

      <div class="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-3">
          <section
            class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-2 border p-3"
            data-test="k8s2-overview-chart-card"
          >
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <OText variant="card-title">{{ t("infra.k8s2.overviewChartTitle") }}</OText>
              <OText variant="meta" class="text-text-secondary">{{
                resource === "cpu"
                  ? t("infra.k8s2.overviewChartCoresHint")
                  : t("infra.k8s2.overviewChartBytesHint")
              }}</OText>
              <OToggleGroup
                v-model="resource"
                class="ms-auto"
                data-test="k8s2-overview-chart-toggle"
              >
                <OToggleGroupItem value="cpu" size="sm">{{
                  t("infra.k8s2.overviewCpu")
                }}</OToggleGroupItem>
                <OToggleGroupItem value="memory" size="sm">{{
                  t("infra.k8s2.overviewMemory")
                }}</OToggleGroupItem>
              </OToggleGroup>
            </div>
            <div class="h-60 min-w-0" data-test="k8s2-overview-chart">
              <OSkeleton v-if="awaiting" class="h-full" data-test="k8s2-overview-chart-loading" />
              <PanelSchemaRenderer
                v-else-if="hasStream(USAGE[resource].stream)"
                :key="`${resource}-${refreshNonce}`"
                :panel-schema="chartSchema"
                :selected-time-obj="chartTime"
                :variables-data="{}"
                :force-load="true"
                search-type="ui"
              />
              <OEmptyState
                v-else
                size="inline"
                preset="no-data"
                :title="t('infra.k8s2.overviewMetricsUnavailable')"
              />
            </div>
          </section>

          <K8sAttentionList
            :items="attention.slice(0, ATTENTION_LIMIT)"
            :total="attention.length"
            :loading="awaiting"
            :end-us="range.end"
            @open="emit('open', $event)"
            @action="(type, ref) => emit('action', type, ref)"
            @navigate="emit('navigate', $event)"
          />
        </div>

        <div class="flex min-w-0 flex-col gap-3" data-test="k8s2-overview-side">
          <template v-if="awaiting">
            <OSkeleton
              v-for="n in 3"
              :key="n"
              class="h-32"
              data-test="k8s2-overview-side-loading"
            />
          </template>
          <section
            v-else-if="!hasNodes"
            class="bg-surface-panel border-border-default rounded-surface flex min-w-0 items-center justify-center border p-3"
            data-test="k8s2-overview-no-nodes"
          >
            <OEmptyState size="inline" preset="no-data" :title="t('infra.k8s2.overviewNoNodes')" />
          </section>
          <template v-else>
            <OText
              v-if="partial"
              variant="meta"
              class="text-status-warning-text"
              data-test="k8s2-overview-partial"
              >{{ t("infra.k8s2.overviewPartialNotice") }}</OText
            >
            <K8sCapacityCard v-for="c in capacity" :key="c.kind" v-bind="c" />
            <section
              class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-3 border p-3"
              data-test="k8s2-overview-pods-card"
            >
              <div class="flex min-w-0 items-baseline justify-between gap-2">
                <OText variant="card-title">{{ t("infra.k8s2.overviewPods") }}</OText>
                <OText
                  variant="meta"
                  class="text-text-secondary"
                  data-test="k8s2-overview-pods-slots"
                  >{{ podSlotText }}</OText
                >
              </div>
              <OSegmentedBar
                :segments="podBarSegments"
                size="md"
                data-test="k8s2-overview-pods-bar"
              />
              <div
                class="flex flex-wrap gap-x-4 gap-y-1 text-xs"
                data-test="k8s2-overview-pods-legend"
              >
                <span
                  v-for="seg in podLegend"
                  :key="seg.id"
                  class="text-text-secondary flex items-center gap-1.5"
                  :data-test="`k8s2-overview-pods-legend-${seg.id}`"
                >
                  <span
                    class="rounded-default size-2 shrink-0"
                    :class="SEGMENT_SWATCH[seg.variant]"
                  />{{ seg.label }}
                </span>
              </div>
            </section>
          </template>
          <K8sSignalCards
            :incidents="signals.openIncidents.value"
            :incidents-visible="signals.incidentsAvailable.value"
            :incidents-loading="signals.incidentsLoading.value"
            :alerts="signals.firingAlerts.value"
            :alerts-visible="signals.alertsAvailable.value"
            :alerts-loading="signals.alertsLoading.value"
            :end-us="range.end"
            @open-incident="openIncident"
            @open-incidents="openIncidents"
            @open-alerts="openAlerts"
          />
        </div>
      </div>

      <section
        class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-2 border p-3"
        data-test="k8s2-overview-warnings-card"
      >
        <OText variant="card-title" data-test="k8s2-overview-warnings-title">
          {{
            awaiting
              ? t("infra.k8s2.overviewKpiWarnings")
              : t("infra.k8s2.overviewWarnings", { count: warningRows.length })
          }}
        </OText>
        <div v-if="awaiting" class="flex flex-col gap-2" data-test="k8s2-overview-warnings-loading">
          <OSkeleton v-for="n in 3" :key="n" type="text" class="h-6" />
        </div>
        <OTable
          v-else
          :data="warningRows"
          :columns="columns"
          row-key="key"
          dense
          :row-height="32"
          :frame="false"
          :show-global-filter="false"
          pagination="none"
          sorting="client"
          sort-by="object"
          sort-order="asc"
          :row-class="
            (row: WarningListRow) => (detailKindOf(row.object.kind) ? 'cursor-pointer' : '')
          "
          data-test="k8s2-overview-warnings-table"
          @row-click="openRow"
        >
          <template #cell-message="{ row }">
            <span class="min-w-0 truncate" :data-test="`k8s2-overview-warning-message-${row.key}`"
              >{{ messageText(row)
              }}<OTooltip
                v-if="!detailKindOf(row.object.kind)"
                :content="t('infra.k8s2.overviewNoDetails', { kind: row.object.kind })"
            /></span>
          </template>
          <template #cell-object="{ row }">
            <span class="min-w-0 truncate">{{ raw(row.object.name) }}</span>
          </template>
          <template #cell-type="{ row }">
            <span :data-test="`k8s2-overview-warning-type-${row.key}`">{{
              raw(row.object.kind)
            }}</span>
          </template>
          <template #cell-age="{ row }">
            <span class="tabular-nums" :data-test="`k8s2-overview-warning-age-${row.key}`">{{
              raw(ageText(row))
            }}</span>
          </template>
          <template #empty>
            <OEmptyState
              size="inline"
              preset="no-data"
              :title="t('infra.k8s2.overviewNoIssues')"
              :description="t('infra.k8s2.overviewNoIssuesDesc')"
            />
          </template>
        </OTable>
      </section>
    </template>
  </div>
</template>
