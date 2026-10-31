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

<!--
  The dependency map canvas shared by Infra > Kubernetes and Infra > Hosts: a card per end at the
  position the view's layout gave it, and an edge per connection. Edge width follows its bytes/s, its
  colour its source's stripe, and only a directed edge has an arrow. Hovering or focusing a card
  dims everything it does not talk to. Clicking a clickable card emits `open`, an edge `select`.
-->
<script lang="ts">
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nText } from "@/types/i18n";

export interface MapNode {
  id: string;
  position: { x: number; y: number };
  label: string;
  detail: I18nText;
  // The card's hover text, since the label and detail truncate.
  title: string;
  icon: IconName;
  // Any CSS colour, so a theme token follows light and dark mode.
  color: string;
  clickable: boolean;
  // Bytes/s in and out.
  total: number;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  directed: boolean;
  total: number;
}

export interface MapLegendItem {
  label: string;
  color: string;
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  VueFlow,
  getBezierPath,
  useVueFlow,
  type Edge,
  type EdgeProps,
  type Node,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";
import { raw, useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { formatRate } from "./dependencyGraph";

const props = defineProps<{
  nodes: MapNode[];
  edges: MapEdge[];
  selectedEdgeId: string | null;
  label: I18nText;
  legend?: MapLegendItem[];
}>();

const emit = defineEmits<{
  open: [id: string];
  select: [id: string];
}>();

const { t } = useI18nTyped();
const { fitView, areNodesInitialized } = useVueFlow();

// Rate labels only on the busiest edges, so the rest of the map stays readable.
const LABELLED = 8;

// Never below a zoom where the cards stay readable; a wider map is then panned.
const FIT = { padding: 0.06, minZoom: 0.8, maxZoom: 1 };

// Both sides take edges either way: an edge leaves the side facing its target, and one within a
// column loops out to the right.
const HANDLES = [
  { id: "tl", type: "target", position: Position.Left },
  { id: "sl", type: "source", position: Position.Left },
  { id: "tr", type: "target", position: Position.Right },
  { id: "sr", type: "source", position: Position.Right },
] as const;

const LABEL_STYLE = {
  fill: "var(--color-text-secondary)",
  fontSize: "0.6875rem",
  fontWeight: 500,
};
const LABEL_BG_STYLE = { fill: "var(--color-surface-base)" };

const hovered = ref<string | null>(null);

const byId = computed(() => new Map(props.nodes.map((n) => [n.id, n])));

const drawn = computed(() =>
  props.edges.filter((e) => byId.value.has(e.source) && byId.value.has(e.target)),
);

// A redraw can remove the hovered card without a mouse-leave, which would leave the whole map dimmed.
watch(byId, (ends) => {
  if (hovered.value && !ends.has(hovered.value)) hovered.value = null;
});

const neighbours = computed(() => {
  const out = new Map<string, Set<string>>();
  for (const { source, target } of drawn.value) {
    if (!out.has(source)) out.set(source, new Set());
    if (!out.has(target)) out.set(target, new Set());
    out.get(source)!.add(target);
    out.get(target)!.add(source);
  }
  return out;
});

const busiest = computed(
  () =>
    new Set(
      [...drawn.value]
        .sort((a, b) => b.total - a.total)
        .slice(0, LABELLED)
        .map((e) => e.id),
    ),
);

function summaryOf(node: MapNode) {
  const count = neighbours.value.get(node.id)?.size ?? 0;
  return t("infra.k8s2.depsEndSummary", { count, rate: formatRate(node.total) }, count);
}

const flowNodes = computed<Node<MapNode>[]>(() =>
  props.nodes.map((n) => ({
    id: n.id,
    type: "end",
    position: n.position,
    data: n,
    focusable: n.clickable,
    ariaLabel: `${n.label}, ${n.detail}, ${summaryOf(n)}`,
  })),
);

const flowEdges = computed<Edge[]>(() => {
  const max = Math.max(1, ...drawn.value.map((e) => e.total));
  return drawn.value.map((e) => {
    const from = byId.value.get(e.source)!;
    const dx = byId.value.get(e.target)!.position.x - from.position.x;
    const [sourceHandle, targetHandle] =
      dx > 0 ? ["sr", "tl"] : dx < 0 ? ["sl", "tr"] : ["sr", "tr"];
    const width = 1.5 + 6 * Math.sqrt(e.total / max);
    // Rounded, so edges share a handful of marker definitions.
    const arrow = 20 + 4 * Math.round(width);
    return {
      id: e.id,
      type: "flow",
      source: e.source,
      target: e.target,
      sourceHandle,
      targetHandle,
      markerEnd: e.directed
        ? {
            type: MarkerType.ArrowClosed,
            color: from.color,
            width: arrow,
            height: arrow,
            markerUnits: "userSpaceOnUse",
          }
        : undefined,
      data: { color: from.color, width, directed: e.directed, rate: formatRate(e.total) },
    };
  });
});

const touches = (edge: { source: string; target: string }, id: string) =>
  edge.source === id || edge.target === id;

const dimmed = (id: string) =>
  hovered.value != null && hovered.value !== id && !neighbours.value.get(hovered.value)?.has(id);

function strokeOf(edge: EdgeProps) {
  const lit = edge.id === props.selectedEdgeId || (hovered.value && touches(edge, hovered.value));
  const faded = hovered.value && !touches(edge, hovered.value);
  return {
    stroke: edge.data.color,
    strokeWidth: edge.data.width + (edge.id === props.selectedEdgeId ? 1.5 : 0),
    strokeDasharray: edge.data.directed ? undefined : "6 4",
    opacity: faded ? 0.08 : lit ? 1 : 0.6,
    transition: "opacity 0.15s ease",
  };
}

// The busiest edges' rates, or while a card is hovered only its own edges' rates.
const labelOf = (edge: EdgeProps) =>
  (hovered.value ? touches(edge, hovered.value) : busiest.value.has(edge.id))
    ? edge.data.rate
    : undefined;

const pathOf = (edge: EdgeProps) => getBezierPath(edge);

// Fit when the drawn ends or their places change, not on a refresh that redraws the same map.
let fitPending = true;
function fitIfPending() {
  if (!fitPending) return;
  fitPending = false;
  fitView(FIT);
}
watch(
  () => props.nodes.map((n) => `${n.id}@${n.position.x},${n.position.y}`).join("\n"),
  () => {
    fitPending = true;
    nextTick(() => {
      if (areNodesInitialized.value) fitIfPending();
    });
  },
);

const endAt = (target: EventTarget | null) => {
  const id = (target as HTMLElement | null)?.closest?.(".vue-flow__node")?.getAttribute("data-id");
  return id ? byId.value.get(id) : undefined;
};

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const node = endAt(event.target);
  if (!node?.clickable) return;
  event.preventDefault();
  emit("open", node.id);
}
</script>

<template>
  <div
    class="dependency-map bg-surface-panel border-border-default rounded-default relative h-full w-full overflow-hidden border"
    role="group"
    :aria-label="label"
    data-test="dependency-map"
    @keydown="onKeydown"
    @focusin="hovered = endAt($event.target)?.id ?? null"
    @focusout="hovered = null"
  >
    <VueFlow
      :nodes="flowNodes"
      :edges="flowEdges"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      :edges-focusable="false"
      :min-zoom="0.1"
      :max-zoom="2"
      @nodes-initialized="fitIfPending"
      @node-click="({ node }) => node.data.clickable && emit('open', node.id)"
      @edge-click="({ edge }) => emit('select', edge.id)"
      @node-mouse-enter="({ node }) => (hovered = node.id)"
      @node-mouse-leave="hovered = null"
    >
      <Background :size="2" :gap="22" />
      <Controls :show-interactive="false" :fit-view-params="FIT" position="top-left" />

      <template #node-end="{ id, data }">
        <div
          class="bg-surface-base border-border-default rounded-default relative flex w-56 items-center gap-2.5 overflow-hidden border py-2 ps-3.5 pe-3 shadow-sm transition-[opacity,box-shadow,border-color] duration-150"
          :class="[
            data.clickable ? 'hover:border-border-strong cursor-pointer hover:shadow-md' : '',
            dimmed(id) ? 'opacity-30' : '',
          ]"
          :title="data.title"
          data-test="dependency-map-node"
        >
          <span
            class="absolute inset-y-0 start-0 w-1"
            :style="{ backgroundColor: data.color }"
            aria-hidden="true"
          />
          <OIcon :name="data.icon" size="md" class="text-text-secondary shrink-0" />
          <div class="min-w-0 flex-1 leading-tight">
            <div class="text-text-heading truncate text-sm font-semibold">
              {{ raw(data.label) }}
            </div>
            <div class="text-text-secondary truncate text-xs">{{ data.detail }}</div>
            <div class="text-text-secondary truncate text-xs tabular-nums">
              {{ summaryOf(data) }}
            </div>
          </div>
          <Handle
            v-for="h in HANDLES"
            :id="h.id"
            :key="h.id"
            :type="h.type"
            :position="h.position"
            :connectable="false"
            class="invisible"
          />
        </div>
      </template>

      <template #edge-flow="edge">
        <BaseEdge
          :id="edge.id"
          :path="pathOf(edge)[0]"
          :marker-end="edge.markerEnd"
          :style="strokeOf(edge)"
          :label="labelOf(edge)"
          :label-x="pathOf(edge)[1]"
          :label-y="pathOf(edge)[2]"
          :label-style="LABEL_STYLE"
          :label-show-bg="true"
          :label-bg-style="LABEL_BG_STYLE"
          :label-bg-padding="[4, 2]"
          :label-bg-border-radius="4"
        />
      </template>
    </VueFlow>
    <!-- Informational only: it names the stripe colours and filters nothing. -->
    <ul
      v-if="legend?.length"
      class="bg-surface-overlay rounded-default border-border-default pointer-events-none absolute start-3 bottom-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-x-3 gap-y-1 border px-2.5 py-1.5"
      data-test="dependency-map-legend"
    >
      <li
        v-for="item in legend"
        :key="item.label"
        class="text-text-secondary flex items-center gap-1.5 text-xs"
      >
        <span
          class="h-3 w-1 rounded-full"
          :style="{ backgroundColor: item.color }"
          aria-hidden="true"
        />
        {{ raw(item.label) }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* keep: lib-override:vue-flow — the library paints its own background, controls and node cursor,
   which have to follow the theme tokens and the non-draggable cards here. */
.dependency-map :deep(.vue-flow__background) {
  background-color: var(--color-surface-panel);
}

.dependency-map :deep(.vue-flow__background circle) {
  fill: var(--color-border-strong);
}

.dependency-map :deep(.vue-flow__node) {
  cursor: default;
}

.dependency-map :deep(.vue-flow__node:focus-visible) {
  outline: 0.125rem solid var(--color-primary-600);
  outline-offset: 0.125rem;
  border-radius: 0.5rem;
}

.dependency-map :deep(.vue-flow__edge) {
  cursor: pointer;
}

.dependency-map :deep(.vue-flow__controls-button) {
  background: var(--color-surface-base);
  border-bottom-color: var(--color-border-default);
  fill: var(--color-text-secondary);
}

.dependency-map :deep(.vue-flow__controls-button:hover) {
  background: var(--color-surface-panel);
}
</style>
