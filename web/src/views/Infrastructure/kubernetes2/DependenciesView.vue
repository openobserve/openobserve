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
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { EmptyStateAction } from "@/lib/core/EmptyState/presets";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { queryClient } from "@/composables/query/queryClient";
import { k8sInstantQuery } from "@/services/kubernetes.queries";
import DependencyMap, { type MapEdge, type MapNode } from "./DependencyMap.vue";
import K8sListHeader from "./K8sListHeader.vue";
import { useEscapeToClose } from "./useEscapeToClose";
import { detailKindOf } from "./kubernetesEvents";
import type { Series } from "./kubernetesModel";
import { VIEW_ICON } from "./k8sTree";
import type { DetailsRef, K8sUrlState } from "./kubernetesUrlState";
import type { K8sTime } from "./useKubernetesInventory";
import {
  FLOW_STREAM,
  buildGraph,
  filterFlows,
  flowQuery,
  flowWindowSeconds,
  formatRate,
  layoutGraph,
  namespaceColors,
  pairFlows,
  type FlowEdge,
  type FlowEnd,
} from "./dependencyGraph";

const props = defineProps<{
  state: K8sUrlState;
  cluster: string | null;
  // The page has not yet learnt which cluster to show; an unscoped query now would be thrown away.
  clusterPending?: boolean;
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

const { t } = useI18nTyped();
const router = useRouter();

const series = shallowRef<Series[]>([]);
const loading = ref(false);
const loadError = ref(false);
const forbidden = ref(false);
const loaded = ref(false);
const lastUpdatedAt = ref<number | null>(null);
const selectedEdgeId = ref<string | null>(null);

const hasFlows = computed(() => props.hasStream(FLOW_STREAM));

const windowS = computed(() => flowWindowSeconds(props.range.start, props.range.end));

let generation = 0;
// The org, cluster and window the drawn graph belongs to; another one's graph must not stay clickable.
// A relative range moves its end on every refresh, so only an absolute range is keyed by its end.
let loadedFor: string | null = null;

async function load() {
  const gen = ++generation;
  const scopeKey = JSON.stringify([
    props.orgId,
    props.cluster,
    windowS.value,
    props.range.relative ? null : props.range.end,
  ]);
  if (scopeKey !== loadedFor) {
    series.value = [];
    loaded.value = false;
    selectedEdgeId.value = null;
    loadedFor = null;
  }
  if (!hasFlows.value || props.clusterPending) {
    loading.value = false;
    return;
  }
  loading.value = true;
  loadError.value = false;
  forbidden.value = false;
  try {
    const text = flowQuery(props.cluster, windowS.value);
    const out = await queryClient.fetchQuery(
      k8sInstantQuery(props.orgId, "FLOW", text, props.range.end, props.range.relative),
    );
    if (gen !== generation) return;
    series.value = out;
    loaded.value = true;
    loadedFor = scopeKey;
    lastUpdatedAt.value = Date.now();
  } catch (e: any) {
    if (gen !== generation) return;
    loadError.value = true;
    forbidden.value = (e?.response?.status ?? e?.status) === 403;
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
    props.clusterPending,
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
    showSystem: props.state.system,
    showNodeTraffic: props.state.nodeTraffic,
  }),
);

const graph = computed(() => buildGraph(edges.value));

const capped = computed(() => graph.value.edges.length < edges.value.length);

const selectedEdge = computed(
  () => graph.value.edges.find((e) => e.id === selectedEdgeId.value) ?? null,
);

const navEdges = computed(() => [...graph.value.edges].sort((a, b) => b.total - a.total));

// Flows can name namespaces the inventory has not seen, so the filter offers both.
const namespaceChoices = computed(() => {
  const names = new Set(props.namespaceOptions);
  for (const e of allEdges.value) {
    for (const end of [e.source, e.target]) if (end.namespace) names.add(end.namespace);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
});

const pct = (part: number, total: number) => `${total > 0 ? Math.round((part / total) * 100) : 0}%`;

function endLabel(end: FlowEnd): string {
  return end.kind === "external" ? t("infra.k8s2.depsExternal") : end.name;
}

function endDetail(end: FlowEnd): I18nText {
  if (end.kind === "external") return t("infra.k8s2.depsOutsideCluster");
  if (end.kind === "node") return t("infra.k8s2.depsHostTraffic");
  return t("infra.k8s2.depsTypeIn", { type: end.ownerType, namespace: end.namespace });
}

// The card's short second line; endDetail's longer text goes in its hover text.
function kindText(end: FlowEnd): I18nText {
  if (end.kind === "external") return t("infra.k8s2.depsKindExternal");
  if (end.kind === "node") return t("infra.k8s2.depsKindNode");
  return endDetail(end);
}

const arrowOf = (edge: FlowEdge) => (edge.directed ? "→" : "↔");

// Workloads by namespace too, so two namespaces' web → api read apart.
const fullLabel = (end: FlowEnd) =>
  end.kind === "workload" ? `${end.namespace}/${end.name}` : endLabel(end);

const edgeText = (edge: FlowEdge) =>
  `${fullLabel(edge.source)} ${arrowOf(edge)} ${fullLabel(edge.target)}`;

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

// A chart colour per namespace; nodes and the outside world are neutral and told apart by their icons.
const NEUTRAL = "var(--color-grey-500)";

// Over every namespace the view knows, not only those drawn, so the namespace filter, search and switches never
// recolour one.
const colors = computed(() => namespaceColors(namespaceChoices.value));

const colorOf = (end: FlowEnd) =>
  end.kind === "workload" ? (colors.value.get(end.namespace) ?? NEUTRAL) : NEUTRAL;

// A workload by its owner's kind, as the resource tree shows it.
function iconOf(end: FlowEnd): IconName {
  if (end.kind === "external") return "public";
  if (end.kind === "node") return VIEW_ICON.nodes;
  return (VIEW_ICON as Record<string, IconName>)[`${end.ownerType.toLowerCase()}s`] ?? "widgets";
}

const layout = computed(() => layoutGraph(graph.value));

const mapNodes = computed<MapNode[]>(() => {
  const { positions } = layout.value;
  return graph.value.nodes.map(({ end, total }) => ({
    id: end.id,
    position: positions.get(end.id)!,
    label: endLabel(end),
    detail: kindText(end),
    title: `${fullLabel(end)}\n${endDetail(end)}`,
    icon: iconOf(end),
    color: colorOf(end),
    clickable: canOpen(end),
    total,
  }));
});

const mapEdges = computed<MapEdge[]>(() =>
  graph.value.edges.map((e) => ({
    id: e.id,
    source: e.source.id,
    target: e.target.id,
    directed: e.directed,
    total: e.total,
    waypoints: layout.value.waypoints.get(e.id) ?? [],
  })),
);

const legend = computed(() =>
  [
    ...new Set(
      graph.value.nodes.filter((n) => n.end.kind === "workload").map((n) => n.end.namespace),
    ),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((label) => ({ label, color: colors.value.get(label) ?? NEUTRAL })),
);

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

const edgePanel = ref<HTMLElement | null>(null);

// The keyboard list's button that opened the panel, so closing it returns there.
let openedFrom: HTMLElement | null = null;

// From the keyboard list, focus follows to the panel, which comes after the map.
function showEdge(id: string, event: Event) {
  openedFrom = (event.target as HTMLElement | null)?.closest("button") ?? null;
  selectedEdgeId.value = id;
  nextTick(() => edgePanel.value?.focus());
}

// Picked on the map, so a later close has no list button to return to. Empty map space dismisses it: focus goes back
// to the list only if the panel holds it, so a mouse user's focus stays where it is and the hidden list stays shut.
function selectEdge(id: string | null) {
  if (id == null) {
    if (!edgePanel.value?.contains(document.activeElement)) openedFrom = null;
    return closeEdge();
  }
  openedFrom = null;
  selectedEdgeId.value = id;
}

function closeEdge() {
  selectedEdgeId.value = null;
  const back = openedFrom;
  openedFrom = null;
  if (back?.isConnected) nextTick(() => back.focus());
}

function openNode(id: string) {
  const node = graph.value.nodes.find((n) => n.end.id === id);
  if (node) openEnd(node.end);
}

function onSetUp() {
  router.push({ name: "ingestFromKubernetes", query: { org_identifier: props.orgId } });
}

// Clear filters here resets only the namespace filter and search, so it says so.
const CLEAR_ACTION: EmptyStateAction[] = [
  {
    id: "clear-filters",
    icon: "filter-list",
    titleKey: "emptyState.filtered.action",
    descriptionKey: "infra.k8s2.depsClearDescription",
  },
];

const filtersSet = computed(() => props.state.namespaces.length > 0 || !!props.state.search);

// Whether the switches, not only the namespace filter and search, keep flows off the map.
const switchesHide = computed(
  () =>
    filterFlows(allEdges.value, { ...scope.value, showSystem: true, showNodeTraffic: true })
      .length > edges.value.length,
);

useEscapeToClose(
  computed(() => !!selectedEdge.value),
  () => closeEdge(),
);

// What the switches leave, before the namespace filter and search: the header's total.
const switchedEdges = computed(() =>
  filterFlows(allEdges.value, {
    namespaces: [],
    search: "",
    showSystem: props.state.system,
    showNodeTraffic: props.state.nodeTraffic,
  }),
);

// Only the namespace filter and search; the switches keep what they show.
function clearFilters() {
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
      :total="switchedEdges.length"
      :count-label="t('infra.k8s2.depsCount', { count: graph.edges.length }, graph.edges.length)"
      namespaced
      :namespace-options="namespaceChoices"
      :namespaces="state.namespaces"
      :search="state.search"
      :search-placeholder="t('infra.k8s2.depsSearch')"
      @update:namespaces="(namespaces: string[]) => emit('update', { namespaces })"
      @update:search="(search: string) => emit('update', { search })"
      @clear="clearFilters"
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
        :model-value="state.system"
        size="sm"
        :label="t('infra.k8s2.depsShowSystem')"
        data-test="k8s2-deps-show-system"
        @update:model-value="(system: unknown) => emit('update', { system: !!system })"
      />
      <OSwitch
        :model-value="state.nodeTraffic"
        size="sm"
        :label="t('infra.k8s2.depsShowNodeTraffic')"
        data-test="k8s2-deps-show-node-traffic"
        @update:model-value="
          (nodeTraffic: unknown) => emit('update', { nodeTraffic: !!nodeTraffic })
        "
      />
      <div class="flex items-center gap-1">
        <OText tag="span" class="text-text-secondary text-xs" data-test="k8s2-deps-caption">
          {{ t("infra.k8s2.depsCaption", { window: windowText }) }}
        </OText>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="info"
          :aria-label="t('infra.k8s2.depsCaptionMore')"
          data-test="k8s2-deps-caption-more"
        >
          <OTooltip :content="t('infra.k8s2.depsCaptionMore')" max-width="20rem" />
        </OButton>
      </div>
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
    <OEmptyState v-else-if="forbidden" preset="no-access" data-test="k8s2-deps-forbidden" />
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
      :description="t('infra.k8s2.depsNoFlowsDescription', { window: windowText })"
      :action-label="t('infra.k8s2.depsSetUp')"
      data-test="k8s2-deps-no-flows"
      @action="onSetUp"
    />
    <!-- The switches hide what the namespace filter and search let through: turning them on shows it. -->
    <OEmptyState
      v-else-if="!graph.edges.length && switchesHide"
      variant="no-results"
      :title="t('infra.k8s2.depsNoMatch')"
      :description="t('infra.k8s2.depsHiddenBySwitches')"
      :action-label="t('infra.k8s2.depsShowAll')"
      :secondary-action-label="filtersSet ? t('emptyState.filtered.action') : undefined"
      data-test="k8s2-deps-empty"
      @action="emit('update', { system: true, nodeTraffic: true })"
      @secondary-action="clearFilters"
    />
    <OEmptyState
      v-else-if="!graph.edges.length"
      variant="no-results"
      :title="t('infra.k8s2.depsNoMatch')"
      :actions="CLEAR_ACTION"
      data-test="k8s2-deps-empty"
      @action="clearFilters"
    />
    <template v-else>
      <OText
        v-if="capped"
        tag="span"
        class="text-text-secondary text-xs"
        data-test="k8s2-deps-capped"
      >
        {{ t("infra.k8s2.depsCapped", { shown: graph.edges.length, total: edges.length }) }}
      </OText>
      <div class="relative flex min-h-0 flex-1 max-md:min-h-96" data-test="k8s2-deps-area">
        <!-- Before the map, so keyboard users reach the edge list without tabbing through every card. not-sr-only
             resets position to static, so this wrapper does the overlay positioning. -->
        <div
          class="pointer-events-none absolute start-3 top-3 bottom-3 z-10 flex flex-col items-start"
        >
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
              @click="showEdge(edge.id, $event)"
            >
              {{ raw(edgeText(edge)) }}
            </OButton>
          </nav>
        </div>
        <DependencyMap
          :nodes="mapNodes"
          :edges="mapEdges"
          :selected-edge-id="selectedEdgeId"
          :label="ariaLabel"
          :legend="legend"
          data-test="k8s2-deps-chart"
          @open="openNode"
          @select="selectEdge"
        />
        <div
          v-if="selectedEdge"
          class="bg-surface-overlay rounded-surface border-border-default absolute end-3 top-3 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-1 border p-3 shadow-md"
          role="region"
          :aria-label="raw(edgeText(selectedEdge))"
          ref="edgePanel"
          tabindex="-1"
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
              @click="closeEdge"
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
