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
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OText from "@/lib/core/Typography/OText.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { escapeLabel, type QueryId } from "./kubernetesQueries";
import type { DetailsRef } from "./kubernetesUrlState";
import { detailKindOf, warningListRows, type WarningListRow } from "./kubernetesEvents";
import { promqlPanelSchema } from "./kubernetesPanels";
import {
  clusterLabelOf,
  formatAge,
  formatBytes,
  formatPct,
  inScope,
  usageBarVariant,
  type Inventory,
  type QueryResults,
  type Series,
  type WarningEvent,
} from "./kubernetesModel";

type Resource = "cpu" | "memory";

interface GaugeRow {
  id: "usage" | "requests" | "limits";
  label: I18nKey;
  value: number | null;
}

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
}>();

const emit = defineEmits<{
  open: [ref: DetailsRef];
  refresh: [];
}>();

const { t } = useI18nTyped();

const HOUR_US = 3_600_000_000;

const USAGE: Record<Resource, { stream: string; query: QueryId }> = {
  cpu: { stream: "k8s_node_cpu_usage", query: "O4" },
  memory: { stream: "k8s_node_memory_working_set", query: "O5" },
};

const resource = ref<Resource>("cpu");

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

const allocatable = (kind: string) => present("O1", kind);

const gauges = computed(() =>
  (["cpu", "memory"] as Resource[]).map((kind) => {
    const alloc = allocatable(kind);
    const rows: GaugeRow[] = [
      { id: "usage", label: "infra.k8s2.overviewUsage", value: present(USAGE[kind].query) },
      { id: "requests", label: "infra.k8s2.overviewRequests", value: sparse("O2", kind) },
      { id: "limits", label: "infra.k8s2.overviewLimits", value: sparse("O3", kind) },
    ];
    const limits = rows[2].value;
    return {
      kind,
      title: (kind === "cpu" ? "infra.k8s2.overviewCpu" : "infra.k8s2.overviewMemory") as I18nKey,
      alloc,
      rows: rows.map((row) => ({ ...row, pct: pctOf(row.value, alloc) })),
      limitsHigher: limits != null && alloc != null && limits > alloc,
    };
  }),
);

const podsGauge = computed(() => {
  const running = props.inventory.pods.filter(
    (p) => inScope(p, { cluster: props.cluster, namespaces: [] }) && p.phase === "Running",
  ).length;
  const total = allocatable("pods");
  return { running, total, pct: pctOf(running, total) };
});

const chartLabel = computed(
  () => clusterLabelOf(seriesOf(USAGE[resource.value].query)[0]?.metric ?? {}) ?? "k8s_cluster",
);

const chartSchema = computed(() => {
  const { stream } = USAGE[resource.value];
  const matcher =
    props.cluster == null ? "" : `{${chartLabel.value}="${escapeLabel(props.cluster)}"}`;
  const alloc = allocatable(resource.value);
  return promqlPanelSchema({
    id: `k8s2-cluster-${resource.value}`,
    type: "bar",
    unit: resource.value === "memory" ? "bytes" : null,
    queries: [{ query: `sum(${stream}${matcher})`, stream }],
    markLines: alloc == null ? [] : [{ value: alloc, name: t("infra.k8s2.overviewAllocatable") }],
  });
});

const chartTime = computed(() => ({
  start_time: new Date((props.range.end - HOUR_US) / 1000),
  end_time: new Date(props.range.end / 1000),
}));

const warningRows = computed(() => warningListRows(props.inventory, props.warnings, props.cluster));

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

function pctOf(value: number | null, of: number | null) {
  return value != null && of != null && of > 0 ? (value / of) * 100 : null;
}

function barValue(pct: number | null) {
  return pct == null ? 0 : Math.min(pct, 100) / 100;
}

function gaugeText(kind: Resource, value: number | null, pct: number | null): I18nText {
  if (value == null) return raw("—");
  return kind === "cpu"
    ? t("infra.k8s2.overviewCoresPct", { value: value.toFixed(2), pct: formatPct(pct) })
    : t("infra.k8s2.overviewBytesPct", { value: formatBytes(value), pct: formatPct(pct) });
}

function allocatableText(kind: Resource, value: number | null): I18nText {
  if (value == null) return raw("—");
  return kind === "cpu"
    ? t("infra.k8s2.overviewAllocatableCores", { value: value.toFixed(2) })
    : t("infra.k8s2.overviewAllocatableBytes", { value: formatBytes(value) });
}

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

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <section
        class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-2 border p-3"
        data-test="k8s2-overview-chart-card"
      >
        <OToggleGroup v-model="resource" class="self-start" data-test="k8s2-overview-chart-toggle">
          <OToggleGroupItem value="cpu" size="sm">{{
            t("infra.k8s2.overviewCpu")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="memory" size="sm">{{
            t("infra.k8s2.overviewMemory")
          }}</OToggleGroupItem>
        </OToggleGroup>
        <div class="h-60 min-w-0" data-test="k8s2-overview-chart">
          <PanelSchemaRenderer
            v-if="hasStream(USAGE[resource].stream)"
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

      <div
        v-if="hasNodes"
        class="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-1 2xl:grid-cols-3"
      >
        <section
          v-for="gauge in gauges"
          :key="gauge.kind"
          class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-2 border p-3"
          :data-test="`k8s2-overview-${gauge.kind}-card`"
        >
          <OText variant="card-title">{{ t(gauge.title) }}</OText>
          <div
            v-for="row in gauge.rows"
            :key="row.id"
            class="flex flex-col gap-1"
            :data-test="`k8s2-overview-${gauge.kind}-${row.id}`"
          >
            <div class="flex items-center justify-between gap-2 text-xs">
              <span class="text-text-secondary">{{ t(row.label) }}</span>
              <span class="tabular-nums">{{ gaugeText(gauge.kind, row.value, row.pct) }}</span>
            </div>
            <OProgressBar
              size="xs"
              :value="barValue(row.pct)"
              :variant="usageBarVariant(row.pct)"
              :data-test="`k8s2-overview-${gauge.kind}-${row.id}-bar`"
            />
          </div>
          <OText
            v-if="gauge.limitsHigher"
            variant="meta"
            class="text-status-warning-text"
            :data-test="`k8s2-overview-${gauge.kind}-limits-higher`"
          >
            {{ t("infra.k8s2.overviewLimitsHigher") }}
          </OText>
          <OText
            variant="meta"
            class="text-text-secondary mt-auto"
            :data-test="`k8s2-overview-${gauge.kind}-allocatable`"
            >{{ allocatableText(gauge.kind, gauge.alloc) }}</OText
          >
        </section>
        <section
          class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-2 border p-3"
          data-test="k8s2-overview-pods-card"
        >
          <OText variant="card-title">{{ t("infra.k8s2.overviewPods") }}</OText>
          <div class="flex flex-col gap-1" data-test="k8s2-overview-pods-running">
            <div class="flex items-center justify-between gap-2 text-xs">
              <span class="text-text-secondary">{{ t("infra.k8s2.overviewPhaseRunning") }}</span>
              <span class="tabular-nums">{{
                t("infra.k8s2.overviewPodsOf", {
                  count: podsGauge.running,
                  total: podsGauge.total ?? "—",
                  pct: formatPct(podsGauge.pct),
                })
              }}</span>
            </div>
            <OProgressBar
              size="xs"
              :value="barValue(podsGauge.pct)"
              :variant="usageBarVariant(podsGauge.pct)"
              data-test="k8s2-overview-pods-running-bar"
            />
          </div>
          <OText variant="meta" class="text-text-secondary" data-test="k8s2-overview-pods-note">
            {{ t("infra.k8s2.overviewPodsNote") }}
          </OText>
        </section>
      </div>
      <section
        v-else
        class="bg-surface-panel border-border-default rounded-surface flex min-w-0 items-center justify-center border p-3"
        data-test="k8s2-overview-no-nodes"
      >
        <OEmptyState size="inline" preset="no-data" :title="t('infra.k8s2.overviewNoNodes')" />
      </section>
    </div>

    <section
      class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-2 border p-3"
      data-test="k8s2-overview-warnings-card"
    >
      <OText variant="card-title" data-test="k8s2-overview-warnings-title">
        {{ t("infra.k8s2.overviewWarnings", { count: warningRows.length }) }}
      </OText>
      <OTable
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
  </div>
</template>
