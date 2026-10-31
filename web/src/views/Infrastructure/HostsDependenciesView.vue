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
import OText from "@/lib/core/Typography/OText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import searchService from "@/services/search";
import { chartColor } from "@/utils/chartTheme";
import { getColorPalette } from "@/utils/dashboard/colorPalette";
import { escapeHtml } from "@/utils/html";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import { parseVector, type Series } from "./kubernetes2/kubernetesModel";
import { buildGraph, flowWindowSeconds } from "./kubernetes2/dependencyGraph";
import {
  hostFlowQuery,
  isSelfEdge,
  layoutHostGraph,
  pairHostFlows,
  type HostEnd,
  type HostFlowEdge,
} from "./hostsDependencyGraph";

const props = defineProps<{
  orgId: string;
  range: { start: number; end: number; relative: boolean };
  refreshNonce: number;
}>();

const emit = defineEmits<{
  open: [host: string];
  refresh: [];
}>();

const { t } = useI18nTyped();
const router = useRouter();

const series = shallowRef<Series[]>([]);
const loadError = ref(false);
const forbidden = ref(false);
const loaded = ref(false);
const showSelf = ref(false);
const selectedEdgeId = ref<string | null>(null);

const windowS = computed(() => flowWindowSeconds(props.range.start, props.range.end));

// metrics_query takes no AbortSignal, so a superseded response is dropped by generation.
let generation = 0;
// The org and window the drawn graph belongs to; another one's graph must not stay clickable.
// A relative range moves its end on every refresh, so only an absolute range is keyed by its end.
let loadedFor: string | null = null;

async function load() {
  const gen = ++generation;
  const scopeKey = JSON.stringify([
    props.orgId,
    windowS.value,
    props.range.relative ? null : props.range.end,
  ]);
  if (scopeKey !== loadedFor) {
    series.value = [];
    loaded.value = false;
    selectedEdgeId.value = null;
    loadedFor = null;
  }
  loadError.value = false;
  forbidden.value = false;
  try {
    const out = await searchService.metrics_query({
      org_identifier: props.orgId,
      // metrics_query interpolates the query raw into the URL.
      query: encodeURIComponent(hostFlowQuery(windowS.value)),
      end_time: props.range.end,
    });
    if (gen !== generation) return;
    series.value = parseVector(out);
    loaded.value = true;
    loadedFor = scopeKey;
  } catch (e: any) {
    if (gen !== generation) return;
    loadError.value = true;
    forbidden.value = (e?.response?.status ?? e?.status) === 403;
  }
}

// The page bumps refreshNonce whenever it reloads, after it has moved the range.
watch(() => [props.orgId, props.refreshNonce], load, { immediate: true });

const allEdges = computed(() => pairHostFlows(series.value));

const edges = computed(() =>
  showSelf.value ? allEdges.value : allEdges.value.filter((e) => !isSelfEdge(e)),
);

const graph = computed(() => buildGraph(edges.value));

const capped = computed(() => graph.value.edges.length < edges.value.length);

const selectedEdge = computed(
  () => graph.value.edges.find((e) => e.id === selectedEdgeId.value) ?? null,
);

const navEdges = computed(() => [...graph.value.edges].sort((a, b) => b.total - a.total));

const formatRate = (value: number) => formatUnitValue(getUnitValue(value, "bps", "", 1));

const pct = (part: number, total: number) => `${total > 0 ? Math.round((part / total) * 100) : 0}%`;

const endLabel = (end: HostEnd) => (end.name ? end.name : t("infra.hosts.depsUnnamed"));

function endDetail(end: HostEnd): I18nText {
  if (end.kind === "host") return t("infra.hosts.depsHostDetail");
  if (end.kind === "network") return t("infra.hosts.depsNetworkDetail");
  return t("infra.hosts.depsUnnamedDetail");
}

const arrowOf = (edge: HostFlowEdge) => (edge.directed ? "→" : "↔");

const edgeText = (edge: HostFlowEdge) =>
  isSelfEdge(edge)
    ? t("infra.hosts.depsSelfEdge", { name: endLabel(edge.source) })
    : `${endLabel(edge.source)} ${arrowOf(edge)} ${endLabel(edge.target)}`;

const ways = (edge: HostFlowEdge): I18nText[] =>
  isSelfEdge(edge)
    ? [
        t("infra.hosts.depsEdgeWithin", {
          name: endLabel(edge.source),
          rate: formatRate(edge.total),
        }),
      ]
    : [
        t("infra.hosts.depsEdgeWay", {
          from: endLabel(edge.source),
          to: endLabel(edge.target),
          rate: formatRate(edge.forward),
        }),
        t("infra.hosts.depsEdgeWay", {
          from: endLabel(edge.target),
          to: endLabel(edge.source),
          rate: formatRate(edge.backward),
        }),
      ];

const split = (edge: HostFlowEdge) =>
  t("infra.hosts.depsEdgeSplit", {
    request: pct(edge.request, edge.total),
    response: pct(edge.response, edge.total),
    unknown: pct(edge.unknown, edge.total),
  });

const CATEGORY = {
  host: "infra.hosts.depsHosts",
  network: "infra.hosts.depsNetworks",
  unnamed: "infra.hosts.depsUnnamed",
} as const;

const SYMBOL = { host: "circle", network: "roundRect", unnamed: "diamond" } as const;

const KINDS = ["host", "network", "unnamed"] as const;

// The chart cannot draw an edge from a box to itself, so traffic within a name rides on its box.
const selfEdges = computed(
  () => new Map(graph.value.edges.filter(isSelfEdge).map((e) => [e.source.id, e])),
);

const chartData = computed(() => {
  const { nodes, edges } = graph.value;
  const positions = layoutHostGraph(nodes);
  const neutral = chartColor("--color-grey-500");
  const line = chartColor("--color-grey-400");
  const host = getColorPalette()[0];
  const kinds = KINDS.filter((kind) => nodes.some((n) => n.end.kind === kind));
  // The symbol too, so the legend tells networks from unnamed addresses, which share a colour.
  const categories = kinds.map((kind) => ({
    name: t(CATEGORY[kind]),
    symbol: SYMBOL[kind],
    itemStyle: { color: kind === "host" ? host : neutral },
  }));
  const links = edges.filter((e) => !isSelfEdge(e));
  const max = Math.max(1, ...links.map((e) => e.total));
  return {
    options: {
      animation: false,
      tooltip: { trigger: "item", confine: true },
      // Informational only: hiding a kind here would not reach the edge list.
      legend: { type: "scroll", bottom: 0, selectedMode: false },
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
          data: nodes.map((n) => ({
            id: n.end.id,
            name: endLabel(n.end),
            ...positions.get(n.end.id),
            category: kinds.indexOf(n.end.kind),
            symbol: SYMBOL[n.end.kind],
            symbolSize: 16,
            label: { show: true, position: "right" },
            tooltip: {
              formatter:
                `<strong>${escapeHtml(endLabel(n.end))}</strong><br/>` +
                [
                  endDetail(n.end),
                  t("infra.hosts.depsEndTotal", { rate: formatRate(n.total) }),
                  ...(selfEdges.value.has(n.end.id) ? ways(selfEdges.value.get(n.end.id)!) : []),
                ]
                  .map(escapeHtml)
                  .join("<br/>"),
            },
          })),
          links: links.map((e) => ({
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
  t("infra.hosts.depsAria", { count: graph.value.edges.length }, graph.value.edges.length),
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

// Only a host has a drawer; a network or unnamed box is many addresses.
function openEnd(end: HostEnd) {
  if (end.kind === "host") emit("open", end.name);
}

// A host box opens the host; another box opens the traffic within it, if shown.
function onChartClick(params: any) {
  const id = params?.data?.id;
  if (params?.dataType === "edge") selectedEdgeId.value = id ?? null;
  else if (params?.dataType === "node") {
    const node = graph.value.nodes.find((n) => n.end.id === id);
    const self = node && selfEdges.value.get(node.end.id);
    if (node?.end.kind === "host") openEnd(node.end);
    else if (self) selectedEdgeId.value = self.id;
  }
}

function onSetUp() {
  router.push({ name: "ingestFromLinux", query: { org_identifier: props.orgId } });
}
</script>

<template>
  <div
    class="px-page-edge flex h-full min-h-0 flex-col gap-2 py-3 max-md:overflow-y-auto"
    data-test="hosts-deps-view"
  >
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1" data-test="hosts-deps-controls">
      <OSwitch
        v-model="showSelf"
        size="sm"
        :label="t('infra.hosts.depsShowSelf')"
        data-test="hosts-deps-show-self"
      />
      <OText tag="span" class="text-text-secondary text-xs" data-test="hosts-deps-caption">
        {{ t("infra.hosts.depsCaption", { window: windowText }) }}
      </OText>
    </div>
    <OEmptyState v-if="forbidden" preset="no-access" data-test="hosts-deps-forbidden" />
    <OEmptyState
      v-else-if="loadError"
      preset="load-error"
      :title="t('infra.hosts.depsLoadError')"
      data-test="hosts-deps-error"
      @action="emit('refresh')"
    />
    <div
      v-else-if="!loaded"
      class="flex min-h-60 flex-1 items-center justify-center"
      data-test="hosts-deps-loading"
    >
      <OSpinner size="lg" />
    </div>
    <OEmptyState
      v-else-if="!allEdges.length"
      preset="no-data"
      :title="t('infra.hosts.depsNoFlowsTitle')"
      :description="t('infra.hosts.depsNoFlowsDescription', { window: windowText })"
      :action-label="t('infra.hosts.depsSetUp')"
      data-test="hosts-deps-no-flows"
      @action="onSetUp"
    />
    <OEmptyState
      v-else-if="!graph.edges.length"
      filtered
      :title="t('infra.hosts.depsNoMatch')"
      data-test="hosts-deps-empty"
      @action="showSelf = true"
    />
    <template v-else>
      <OText
        v-if="capped"
        tag="span"
        class="text-text-secondary text-xs"
        data-test="hosts-deps-capped"
      >
        {{ t("infra.hosts.depsCapped", { shown: graph.edges.length, total: edges.length }) }}
      </OText>
      <div class="relative flex min-h-0 flex-1 max-md:min-h-96" data-test="hosts-deps-area">
        <ChartRenderer
          :data="chartData"
          :label="ariaLabel"
          data-test="hosts-deps-chart"
          @click="onChartClick"
        />
        <!-- not-sr-only resets position to static, so this wrapper does the overlay positioning. -->
        <div class="pointer-events-none absolute start-3 top-3 bottom-3 flex flex-col items-start">
          <nav
            class="bg-surface-overlay rounded-surface pointer-events-auto sr-only flex max-h-full flex-col items-start gap-1 overflow-y-auto p-2 focus-within:not-sr-only"
            :aria-label="t('infra.hosts.depsConnections')"
            data-test="hosts-deps-links"
          >
            <OButton
              v-for="edge in navEdges"
              :key="edge.id"
              variant="ghost-primary"
              size="xs"
              data-test="hosts-deps-link"
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
          data-test="hosts-deps-edge"
        >
          <div class="flex items-center gap-1">
            <OButton
              variant="ghost-primary"
              size="xs"
              :disabled="selectedEdge.source.kind !== 'host'"
              data-test="hosts-deps-edge-source"
              @click="openEnd(selectedEdge.source)"
            >
              {{ raw(endLabel(selectedEdge.source)) }}
            </OButton>
            <template v-if="!isSelfEdge(selectedEdge)">
              <OText tag="span" class="text-text-secondary">{{ raw(arrowOf(selectedEdge)) }}</OText>
              <OButton
                variant="ghost-primary"
                size="xs"
                :disabled="selectedEdge.target.kind !== 'host'"
                data-test="hosts-deps-edge-target"
                @click="openEnd(selectedEdge.target)"
              >
                {{ raw(endLabel(selectedEdge.target)) }}
              </OButton>
            </template>
            <OButton
              class="ms-auto"
              variant="ghost"
              size="icon-sm"
              icon-left="close"
              :aria-label="t('common.close')"
              data-test="hosts-deps-edge-close"
              @click="selectedEdgeId = null"
            />
          </div>
          <OText
            v-for="(way, i) in ways(selectedEdge)"
            :key="i"
            tag="span"
            class="text-sm"
            data-test="hosts-deps-edge-way"
          >
            {{ way }}
          </OText>
          <OText tag="span" class="text-text-secondary text-xs" data-test="hosts-deps-edge-split">
            {{ split(selectedEdge) }}
          </OText>
          <OText
            v-if="!selectedEdge.directed && !isSelfEdge(selectedEdge)"
            tag="span"
            class="text-text-secondary text-xs"
            data-test="hosts-deps-edge-undirected"
          >
            {{
              selectedEdge.unknown > selectedEdge.total / 2
                ? t("infra.hosts.depsEdgeUndirected")
                : t("infra.hosts.depsEdgeBothClients")
            }}
          </OText>
        </div>
      </div>
    </template>
  </div>
</template>
