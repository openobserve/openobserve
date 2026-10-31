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
  // Where the edge passes the columns between its ends, from the layout.
  waypoints: { x: number; y: number }[];
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
  useVueFlow,
  type Edge,
  type EdgeProps,
  type Node,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { CARD_H, CARD_W, formatRate } from "./dependencyGraph";
import { fitTransform, placeLabels, routeEdge } from "./dependencyMapGeometry";

const props = defineProps<{
  nodes: MapNode[];
  edges: MapEdge[];
  selectedEdgeId: string | null;
  label: I18nText;
  legend?: MapLegendItem[];
}>();

const emit = defineEmits<{
  open: [id: string];
  // null when the selection is dismissed on the map.
  select: [id: string | null];
}>();

const { t } = useI18nTyped();
const { setViewport, dimensions, zoomIn, zoomOut, areNodesInitialized } = useVueFlow();

// Rate labels only on the busiest edges, so the rest of the map stays readable.
const LABELLED = 8;

// The whole map, cards and the edges routed past them, never zoomed in past its natural size. fitView only
// knows the cards, and stops zooming out at 0.5.
function fit(duration = 0) {
  const points = [
    ...props.nodes.flatMap((n) => [
      n.position,
      { x: n.position.x + CARD_W, y: n.position.y + CARD_H },
    ]),
    ...props.edges.flatMap((e) => e.waypoints),
    // A bow's tip, where its label sits, can reach past the right-most column.
    ...flowEdges.value.flatMap((e) => e.data.route.spots),
  ];
  const { width, height } = dimensions.value;
  setViewport(fitTransform(points, width, height), { duration });
}

// Vue Flow places an edge only between handles, though each edge draws its own route from the layout.
const HANDLES = [
  { id: "tl", type: "target", position: Position.Left },
  { id: "sl", type: "source", position: Position.Left },
  { id: "tr", type: "target", position: Position.Right },
  { id: "sr", type: "source", position: Position.Right },
] as const;

const LABEL_STYLE = {
  fill: "var(--color-text-secondary)",
  fontSize: "0.625rem",
  fontWeight: 500,
};
// A pill, so a label reads over the edges it sits on.
const LABEL_BG_STYLE = {
  fill: "var(--color-surface-base)",
  stroke: "var(--color-border-default)",
  strokeWidth: 1,
};

const hovered = ref<string | null>(null);
const hoveredEdge = ref<string | null>(null);

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

const busiestOf = (edges: MapEdge[]) =>
  new Set(
    [...edges]
      .sort((a, b) => b.total - a.total)
      .slice(0, LABELLED)
      .map((e) => e.id),
  );

// The map's busiest edges, or while a card is hovered its own busiest: a hub can have dozens of edges, and each
// new label is measured as it appears.
const labelled = computed(() =>
  busiestOf(hovered.value ? drawn.value.filter((e) => touches(e, hovered.value!)) : drawn.value),
);

const openLabel = (node: MapNode) =>
  t("infra.k8s2.depsOpenEnd", { name: node.label, detail: node.detail, summary: summaryOf(node) });

function summaryOf(node: MapNode) {
  const count = neighbours.value.get(node.id)?.size ?? 0;
  return t("infra.k8s2.depsEndSummary", { count, rate: formatRate(node.total) }, count);
}

// In reading order, column by column, so Tab moves through the cards as they are laid out.
const flowNodes = computed<Node<MapNode>[]>(() =>
  [...props.nodes]
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
    .map((n) => ({
      id: n.id,
      type: "end",
      position: n.position,
      data: n,
      // The card itself takes focus, as a button where it opens something.
      focusable: false,
    })),
);

const flowEdges = computed<Edge[]>(() => {
  const max = Math.max(1, ...drawn.value.map((e) => e.total));
  return drawn.value.map((e) => {
    const from = byId.value.get(e.source)!;
    const to = byId.value.get(e.target)!;
    const dx = to.position.x - from.position.x;
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
      data: {
        color: from.color,
        width,
        directed: e.directed,
        rate: formatRate(e.total),
        route: routeEdge(from.position, to.position, e.waypoints),
      },
    };
  });
});

const touches = (edge: { source: string; target: string }, id: string) =>
  edge.source === id || edge.target === id;

const dimmed = (id: string) =>
  hovered.value != null && hovered.value !== id && !neighbours.value.get(hovered.value)?.has(id);

function strokeOf(edge: EdgeProps) {
  const selected = edge.id === props.selectedEdgeId;
  const lit =
    selected || edge.id === hoveredEdge.value || (hovered.value && touches(edge, hovered.value));
  // A hovered card outranks the selection; with neither, every edge reads at rest.
  const faded = hovered.value
    ? !touches(edge, hovered.value)
    : props.selectedEdgeId != null && !selected && edge.id !== hoveredEdge.value;
  return {
    stroke: edge.data.color,
    strokeWidth: edge.data.width + (selected ? 1.5 : 0),
    strokeDasharray: edge.data.directed ? undefined : "6 4",
    opacity: faded ? (hovered.value ? 0.08 : 0.2) : lit ? 1 : 0.6,
    filter: selected ? `drop-shadow(0 0 0.25rem ${edge.data.color})` : undefined,
    transition: "opacity 0.15s ease",
  };
}

// Busiest first, each label where it clears the cards and the labels already placed; a hovered edge's always shows.
const labelAt = computed(() => {
  const routes = new Map(flowEdges.value.map((e) => [e.id, e.data]));
  const wanted = drawn.value
    .filter((e) => labelled.value.has(e.id) || e.id === hoveredEdge.value)
    .sort((a, b) => b.total - a.total)
    .map((e) => ({
      id: e.id,
      text: routes.get(e.id)!.rate,
      spots: routes.get(e.id)!.route.spots,
      forced: e.id === hoveredEdge.value,
    }));
  return placeLabels(
    wanted,
    props.nodes.map((n) => n.position),
  );
});

// Fit when the drawn ends or their places change, not on a refresh that redraws the same map.
let fitPending = true;
function fitIfPending() {
  if (!fitPending) return;
  fitPending = false;
  fit();
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
  <div class="flex h-full w-full min-w-0 flex-col gap-2">
    <div
      class="dependency-map bg-surface-panel border-border-default rounded-default relative min-h-0 w-full flex-1 overflow-hidden border"
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
        :disable-keyboard-a11y="true"
        :min-zoom="0.1"
        :max-zoom="2"
        @nodes-initialized="fitIfPending"
        @node-click="({ node }) => node.data.clickable && emit('open', node.id)"
        @edge-click="({ edge }) => emit('select', edge.id)"
        @pane-click="emit('select', null)"
        @node-mouse-enter="({ node }) => (hovered = node.id)"
        @node-mouse-leave="hovered = null"
        @edge-mouse-enter="({ edge }) => (hoveredEdge = edge.id)"
        @edge-mouse-leave="hoveredEdge = null"
      >
        <Background :size="2" :gap="22" />

        <template #node-end="{ id, data }">
          <div
            class="bg-surface-base border-border-default rounded-default focus-visible:ring-accent/40 relative flex h-19 w-54 items-center gap-2 overflow-hidden border py-2 ps-3 pe-2 shadow-sm transition-[opacity,box-shadow,border-color] duration-150"
            :class="[
              data.clickable
                ? 'hover:border-border-strong cursor-pointer hover:shadow-md focus-visible:ring-2 focus-visible:outline-none'
                : '',
              dimmed(id) ? 'opacity-30' : '',
            ]"
            :title="data.title"
            :role="data.clickable ? 'button' : undefined"
            :tabindex="data.clickable ? 0 : undefined"
            :aria-label="data.clickable ? openLabel(data) : undefined"
            data-test="dependency-map-node"
          >
            <span
              class="absolute inset-y-0 start-0 w-1"
              :style="{ backgroundColor: data.color }"
              aria-hidden="true"
            />
            <OIcon :name="data.icon" size="sm" class="text-text-secondary shrink-0" />
            <div class="min-w-0 flex-1 leading-tight">
              <div class="text-text-heading truncate text-base font-semibold">
                {{ raw(data.label) }}
              </div>
              <div class="text-text-secondary truncate text-[0.9375rem]">{{ data.detail }}</div>
              <div class="text-text-secondary truncate text-[0.9375rem] tabular-nums">
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
            :path="edge.data.route.path"
            :marker-end="edge.markerEnd"
            :style="strokeOf(edge)"
            :label="labelAt.has(edge.id) ? edge.data.rate : undefined"
            :label-x="labelAt.get(edge.id)?.x"
            :label-y="labelAt.get(edge.id)?.y"
            :label-style="LABEL_STYLE"
            :label-show-bg="true"
            :label-bg-style="LABEL_BG_STYLE"
            :label-bg-padding="[5, 3]"
            :label-bg-border-radius="8"
          />
        </template>
      </VueFlow>
      <div
        class="rounded-default border-border-default bg-surface-panel absolute end-3 bottom-3 z-10 flex flex-col overflow-hidden border"
        data-test="dependency-map-zoom"
      >
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="add"
          class="rounded-none"
          :aria-label="t('fleet.flow.zoomIn')"
          data-test="dependency-map-zoom-in"
          @click="zoomIn({ duration: 150 })"
        >
          <OTooltip side="left" :content="t('fleet.flow.zoomIn')" />
        </OButton>
        <OSeparator />
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="remove"
          class="rounded-none"
          :aria-label="t('fleet.flow.zoomOut')"
          data-test="dependency-map-zoom-out"
          @click="zoomOut({ duration: 150 })"
        >
          <OTooltip side="left" :content="t('fleet.flow.zoomOut')" />
        </OButton>
        <OSeparator />
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="fullscreen"
          class="rounded-none"
          :aria-label="t('fleet.flow.fitView')"
          data-test="dependency-map-fit"
          @click="fit(150)"
        >
          <OTooltip side="left" :content="t('fleet.flow.fitView')" />
        </OButton>
      </div>
    </div>
    <!-- Informational only: it names the stripe colours and filters nothing. Below the canvas, so it never
         covers a card. -->
    <ul
      v-if="legend?.length"
      class="flex flex-wrap gap-x-3 gap-y-1"
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
/* keep: lib-override:vue-flow — the library paints its own background and node cursor, which have to
   follow the theme tokens and the non-draggable cards here. */
.dependency-map :deep(.vue-flow__background) {
  background-color: var(--color-surface-panel);
}

.dependency-map :deep(.vue-flow__background circle) {
  fill: var(--color-border-strong);
}

.dependency-map :deep(.vue-flow__node) {
  cursor: default;
}

.dependency-map :deep(.vue-flow__edge) {
  cursor: pointer;
}
</style>
