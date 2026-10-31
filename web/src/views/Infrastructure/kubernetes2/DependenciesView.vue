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
import { computed, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { queryClient } from "@/composables/query/queryClient";
import { k8sInstantQuery } from "@/services/kubernetes.queries";
import { chartColor } from "@/utils/chartTheme";
import { getColorPalette } from "@/utils/dashboard/colorPalette";
import { escapeHtml } from "@/utils/html";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import K8sListHeader from "./K8sListHeader.vue";
import { detailKindOf } from "./kubernetesEvents";
import type { Series } from "./kubernetesModel";
import { SHORT_KIND } from "./mapFill";
import type { DetailsRef, K8sUrlState } from "./kubernetesUrlState";
import type { K8sTime } from "./useKubernetesInventory";
import {
  FLOW_STREAM,
  buildGraph,
  filterFlows,
  flowQuery,
  flowWindowSeconds,
  layoutGraph,
  pairFlows,
  type FlowEdge,
  type FlowEnd,
} from "./dependencyGraph";

const props = defineProps<{
  state: K8sUrlState;
  cluster: string | null;
  namespaceOptions: string[];
  range: K8sTime;
  orgId: string;
  refreshNonce: number;
  hasStream: (name: string) => boolean;
}>();

const emit = defineEmits<{
  update: [patch: Partial<K8sUrlState>];
  open: [details: DetailsRef];
  refresh: [];
}>();

const MAX_EDGE_LINKS = 50;

const { t } = useI18nTyped();
const router = useRouter();

const series = shallowRef<Series[]>([]);
const loading = ref(false);
const loadError = ref(false);
const loaded = ref(false);
const lastUpdatedAt = ref<number | null>(null);
const showSystem = ref(false);
const showNodeTraffic = ref(false);
const selectedEdgeId = ref<string | null>(null);

const hasFlows = computed(() => props.hasStream(FLOW_STREAM));

const windowS = computed(() => flowWindowSeconds(props.range.start, props.range.end));

let generation = 0;

async function load() {
  const gen = ++generation;
  if (!hasFlows.value) {
    series.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  loadError.value = false;
  try {
    const text = flowQuery(props.cluster, windowS.value);
    const out = await queryClient.fetchQuery(
      k8sInstantQuery(props.orgId, "FLOW", text, props.range.end, props.range.relative),
    );
    if (gen !== generation) return;
    series.value = out;
    loaded.value = true;
    lastUpdatedAt.value = Date.now();
  } catch {
    if (gen === generation) loadError.value = true;
  } finally {
    if (gen === generation) loading.value = false;
  }
}

watch(
  () => [
    props.orgId,
    props.cluster,
    props.range.start,
    props.range.end,
    props.refreshNonce,
    hasFlows.value,
  ],
  load,
  { immediate: true },
);

const allEdges = computed(() => pairFlows(series.value));

const scope = computed(() => ({
  namespaces: props.state.namespaces,
  search: props.state.search,
}));

const edges = computed(() =>
  filterFlows(allEdges.value, {
    ...scope.value,
    showSystem: showSystem.value,
    showNodeTraffic: showNodeTraffic.value,
  }),
);

// The header reads as filtered when the switches, not only the namespace filter or search, hide edges.
const switchesHide = computed(
  () =>
    filterFlows(allEdges.value, { ...scope.value, showSystem: true, showNodeTraffic: true })
      .length > edges.value.length,
);

const graph = computed(() => buildGraph(edges.value));

const capped = computed(() => graph.value.nodes.length < graph.value.totalNodes);

const selectedEdge = computed(
  () => graph.value.edges.find((e) => e.id === selectedEdgeId.value) ?? null,
);

const navEdges = computed(() =>
  [...graph.value.edges].sort((a, b) => b.total - a.total).slice(0, MAX_EDGE_LINKS),
);

const formatRate = (value: number) => formatUnitValue(getUnitValue(value, "bps", "", 1));

const pct = (part: number, total: number) => `${total > 0 ? Math.round((part / total) * 100) : 0}%`;

function endLabel(end: FlowEnd): string {
  return end.kind === "external" ? t("infra.k8s2.depsExternal") : end.name;
}

function endDetail(end: FlowEnd): I18nText {
  if (end.kind === "external") return t("infra.k8s2.depsOutsideCluster");
  if (end.kind === "node") return t("infra.k8s2.depsHostTraffic");
  return t("infra.k8s2.depsTypeIn", { type: end.ownerType, namespace: end.namespace });
}

const arrowOf = (edge: FlowEdge) => (edge.directed ? "→" : "↔");

const edgeText = (edge: FlowEdge) =>
  `${endLabel(edge.source)} ${arrowOf(edge)} ${endLabel(edge.target)}`;

const ways = (edge: FlowEdge): I18nText[] => [
  t("infra.k8s2.depsEdgeWay", {
    from: endLabel(edge.source),
    to: endLabel(edge.target),
    rate: formatRate(edge.forward),
  }),
  t("infra.k8s2.depsEdgeWay", {
    from: endLabel(edge.target),
    to: endLabel(edge.source),
    rate: formatRate(edge.backward),
  }),
];

const split = (edge: FlowEdge) =>
  t("infra.k8s2.depsEdgeSplit", {
    request: pct(edge.request, edge.total),
    response: pct(edge.response, edge.total),
    unknown: pct(edge.unknown, edge.total),
  });

const categoryOf = (end: FlowEnd) =>
  end.kind === "workload"
    ? end.namespace
    : end.kind === "node"
      ? t("infra.k8s2.depsNodes")
      : t("infra.k8s2.depsExternal");

const SYMBOL = { workload: "circle", node: "roundRect", external: "diamond" } as const;

const chartData = computed(() => {
  const { nodes, edges } = graph.value;
  const positions = layoutGraph(nodes);
  const neutral = chartColor("--color-grey-500");
  const line = chartColor("--color-grey-400");
  const palette = getColorPalette();
  const namespaces = [
    ...new Set(nodes.filter((n) => n.end.kind === "workload").map((n) => n.end.namespace)),
  ];
  namespaces.sort((a, b) => a.localeCompare(b));
  const has = (kind: FlowEnd["kind"]) => nodes.some((n) => n.end.kind === kind);
  const special = [
    ...(has("node") ? [t("infra.k8s2.depsNodes")] : []),
    ...(has("external") ? [t("infra.k8s2.depsExternal")] : []),
  ];
  const categories = [
    ...namespaces.map((name, i) => ({ name, itemStyle: { color: palette[i % palette.length] } })),
    ...special.map((name) => ({ name, itemStyle: { color: neutral } })),
  ];
  const index = new Map(categories.map((c, i) => [c.name, i]));
  const max = Math.max(1, ...edges.map((e) => e.total));
  return {
    options: {
      animation: false,
      tooltip: { trigger: "item", confine: true },
      legend: { type: "scroll", bottom: 0 },
      series: [
        {
          type: "graph",
          layout: "none",
          roam: true,
          top: 24,
          bottom: 48,
          left: 80,
          right: 160,
          categories,
          emphasis: { focus: "adjacency" },
          data: nodes.map((n) => {
            const kind = SHORT_KIND[n.end.ownerType] ?? n.end.ownerType.toLowerCase();
            return {
              id: n.end.id,
              name: endLabel(n.end),
              ...positions.get(n.end.id),
              category: index.get(categoryOf(n.end)),
              symbol: SYMBOL[n.end.kind],
              symbolSize: 16,
              label: {
                show: true,
                position: "right",
                formatter: n.end.kind === "workload" ? `{b}  ${kind}` : "{b}",
              },
              tooltip: {
                formatter:
                  `<strong>${escapeHtml(endLabel(n.end))}</strong><br/>` +
                  `${escapeHtml(endDetail(n.end))}<br/>` +
                  escapeHtml(t("infra.k8s2.depsEndTotal", { rate: formatRate(n.total) })),
              },
            };
          }),
          links: edges.map((e) => ({
            id: e.id,
            source: e.source.id,
            target: e.target.id,
            value: e.total,
            symbol: ["none", e.directed ? "arrow" : "none"],
            symbolSize: [0, 8],
            lineStyle: {
              color: line,
              opacity: 0.7,
              curveness: 0.15,
              width: 1 + 7 * Math.sqrt(e.total / max),
            },
            tooltip: {
              formatter: [edgeText(e), ...ways(e)].map(escapeHtml).join("<br/>"),
            },
          })),
        },
      ],
    },
  };
});

const ariaLabel = computed(() =>
  t("infra.k8s2.depsAria", { count: graph.value.edges.length }, graph.value.edges.length),
);

// Whole days or hours when exact, else minutes, so a 90 minute window does not read as 1h.
const windowText = computed(() => {
  const minutes = Math.round(windowS.value / 60);
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
});

watch(graph, (next) => {
  if (selectedEdgeId.value && !next.edges.some((e) => e.id === selectedEdgeId.value)) {
    selectedEdgeId.value = null;
  }
});

// Outside addresses, and owner types without a drawer, have nothing to open.
const kindOf = (end: FlowEnd) => (end.kind === "external" ? null : detailKindOf(end.ownerType));

const canOpen = (end: FlowEnd) => kindOf(end) != null;

function openEnd(end: FlowEnd) {
  const kind = kindOf(end);
  if (!kind) return;
  emit("open", {
    kind,
    cluster: end.cluster || props.cluster || "",
    namespace: end.kind === "node" ? "" : end.namespace,
    name: end.name,
  });
}

function onChartClick(params: any) {
  const id = params?.data?.id;
  if (params?.dataType === "edge") selectedEdgeId.value = id ?? null;
  else if (params?.dataType === "node") {
    const node = graph.value.nodes.find((n) => n.end.id === id);
    if (node) openEnd(node.end);
  }
}

function onSetUp() {
  router.push({ name: "ingestFromKubernetes", query: { org_identifier: props.orgId } });
}

// The switches filter too, so clearing filters turns them on.
function showEverything() {
  showSystem.value = true;
  showNodeTraffic.value = true;
  emit("update", { namespaces: [], search: "" });
}
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col gap-2 p-3 max-md:overflow-y-auto"
    data-test="k8s2-deps-view"
  >
    <K8sListHeader
      :title="t('infra.k8s2.depsTitle')"
      :count="graph.edges.length"
      :total="allEdges.length"
      :count-label="t('infra.k8s2.depsCount', { count: graph.edges.length }, graph.edges.length)"
      :filtered="switchesHide"
      namespaced
      :namespace-options="namespaceOptions"
      :namespaces="state.namespaces"
      :search="state.search"
      :search-placeholder="t('infra.k8s2.depsSearch')"
      @update:namespaces="(namespaces: string[]) => emit('update', { namespaces })"
      @update:search="(search: string) => emit('update', { search })"
      @clear="showEverything"
    >
      <template #trailing>
        <ORefreshButton
          :last-run-at="lastUpdatedAt"
          :loading="loading"
          data-test="k8s2-deps-refresh"
          @click="emit('refresh')"
        />
      </template>
    </K8sListHeader>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1" data-test="k8s2-deps-controls">
      <OSwitch
        v-model="showSystem"
        size="sm"
        :label="t('infra.k8s2.depsShowSystem')"
        data-test="k8s2-deps-show-system"
      />
      <OSwitch
        v-model="showNodeTraffic"
        size="sm"
        :label="t('infra.k8s2.depsShowNodeTraffic')"
        data-test="k8s2-deps-show-node-traffic"
      />
      <OText tag="span" class="text-text-secondary text-xs" data-test="k8s2-deps-caption">
        {{ t("infra.k8s2.depsCaption", { window: windowText }) }}
      </OText>
    </div>
    <OEmptyState
      v-if="!hasFlows"
      preset="no-data"
      :title="t('infra.k8s2.depsNoStreamTitle')"
      :description="t('infra.k8s2.depsNoStreamDescription', { stream: FLOW_STREAM })"
      :action-label="t('infra.k8s2.depsSetUp')"
      data-test="k8s2-deps-no-stream"
      @action="onSetUp"
    />
    <OEmptyState
      v-else-if="loadError"
      preset="load-error"
      :title="t('infra.k8s2.depsLoadError')"
      data-test="k8s2-deps-error"
      @action="emit('refresh')"
    />
    <div
      v-else-if="!loaded"
      class="flex min-h-60 flex-1 items-center justify-center"
      data-test="k8s2-deps-loading"
    >
      <OSpinner size="lg" />
    </div>
    <OEmptyState
      v-else-if="!allEdges.length"
      preset="no-data"
      :title="t('infra.k8s2.depsNoFlowsTitle')"
      :description="t('infra.k8s2.depsNoFlowsDescription')"
      :action-label="t('infra.k8s2.depsSetUp')"
      data-test="k8s2-deps-no-flows"
      @action="onSetUp"
    />
    <OEmptyState
      v-else-if="!graph.edges.length"
      filtered
      :title="t('infra.k8s2.depsNoMatch')"
      data-test="k8s2-deps-empty"
      @action="showEverything"
    />
    <template v-else>
      <OText
        v-if="capped"
        tag="span"
        class="text-text-secondary text-xs"
        data-test="k8s2-deps-capped"
      >
        {{ t("infra.k8s2.depsCapped", { shown: graph.nodes.length, total: graph.totalNodes }) }}
      </OText>
      <div class="relative flex min-h-0 flex-1 max-md:min-h-96" data-test="k8s2-deps-area">
        <ChartRenderer
          :data="chartData"
          :label="ariaLabel"
          data-test="k8s2-deps-chart"
          @click="onChartClick"
        />
        <!-- not-sr-only resets position to static, so this wrapper does the overlay positioning. -->
        <div class="pointer-events-none absolute start-3 top-3 bottom-3 flex flex-col items-start">
          <nav
            class="bg-surface-overlay rounded-surface pointer-events-auto sr-only flex max-h-full flex-col items-start gap-1 overflow-y-auto p-2 focus-within:not-sr-only"
            :aria-label="t('infra.k8s2.depsConnections')"
            data-test="k8s2-deps-links"
          >
            <OButton
              v-for="edge in navEdges"
              :key="edge.id"
              variant="ghost-primary"
              size="xs"
              data-test="k8s2-deps-link"
              @click="selectedEdgeId = edge.id"
            >
              {{ raw(edgeText(edge)) }}
            </OButton>
          </nav>
        </div>
        <div
          v-if="selectedEdge"
          class="bg-surface-overlay rounded-surface border-border-default absolute end-3 top-3 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-1 border p-3 shadow-md"
          role="region"
          :aria-label="raw(edgeText(selectedEdge))"
          data-test="k8s2-deps-edge"
        >
          <div class="flex items-center gap-1">
            <OButton
              variant="ghost-primary"
              size="xs"
              :disabled="!canOpen(selectedEdge.source)"
              data-test="k8s2-deps-edge-source"
              @click="openEnd(selectedEdge.source)"
            >
              {{ raw(endLabel(selectedEdge.source)) }}
            </OButton>
            <OText tag="span" class="text-text-secondary">{{ raw(arrowOf(selectedEdge)) }}</OText>
            <OButton
              variant="ghost-primary"
              size="xs"
              :disabled="!canOpen(selectedEdge.target)"
              data-test="k8s2-deps-edge-target"
              @click="openEnd(selectedEdge.target)"
            >
              {{ raw(endLabel(selectedEdge.target)) }}
            </OButton>
            <OButton
              class="ms-auto"
              variant="ghost"
              size="icon-sm"
              icon-left="close"
              :aria-label="t('common.close')"
              data-test="k8s2-deps-edge-close"
              @click="selectedEdgeId = null"
            />
          </div>
          <OText
            v-for="(way, i) in ways(selectedEdge)"
            :key="i"
            tag="span"
            class="text-sm"
            data-test="k8s2-deps-edge-way"
          >
            {{ way }}
          </OText>
          <OText tag="span" class="text-text-secondary text-xs" data-test="k8s2-deps-edge-split">
            {{ split(selectedEdge) }}
          </OText>
          <OText
            v-if="!selectedEdge.directed"
            tag="span"
            class="text-text-secondary text-xs"
            data-test="k8s2-deps-edge-undirected"
          >
            {{
              selectedEdge.unknown > selectedEdge.total / 2
                ? t("infra.k8s2.depsEdgeUndirected")
                : t("infra.k8s2.depsEdgeBothClients")
            }}
          </OText>
        </div>
      </div>
    </template>
  </div>
</template>
