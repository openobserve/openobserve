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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
import {
  LABEL_FONT,
  LABEL_H,
  arrowBox,
  fitTransform,
  labelBox,
  labelWidth,
  overlaps,
  placeLabels,
  routeEdge,
} from "./dependencyMapGeometry";

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

// No rate at rest: edge width already shows volume, and a card's summary its total. Hovering a card labels up to
// this many of its own edges; the hovered and the selected edge are labelled too.
const LABELLED = 8;

// How far zooming out goes, and how far the fit button goes to show a big map whole.
const MIN_ZOOM = 0.1;
// On load and on a resize the map is never fitted below this, so card text and rates stay readable; a bigger map
// starts at its top-left, the callers, and is panned or fitted whole with the fit button.
const READABLE_ZOOM = 0.75;

// The map, cards and the edges routed past them, never zoomed in past its natural size. fitView only knows the
// cards, and stops zooming out at 0.5.
function fit(duration = 0, floor = READABLE_ZOOM) {
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
  setViewport(fitTransform(points, width, height, floor), { duration });
  userMoved.value = false;
  lastFloor = floor;
}

// The floor the last fit used, so a resize after the fit button keeps showing the whole map.
let lastFloor = READABLE_ZOOM;

// Set once the user pans or zooms, so a resize no longer refits over what they chose.
const userMoved = ref(false);

function zoomBy(inward: boolean) {
  userMoved.value = true;
  if (inward) zoomIn({ duration: 150 });
  else zoomOut({ duration: 150 });
}

const UNDIRECTED = "var(--color-grey-500)";

// Exactly the size the layout routes edges around, whatever the root font size.
const CARD_SIZE = { width: `${CARD_W}px`, height: `${CARD_H}px` };

// Vue Flow places an edge only between handles, though each edge draws its own route from the layout.
const HANDLES = [
  { id: "tl", type: "target", position: Position.Left },
  { id: "sl", type: "source", position: Position.Left },
  { id: "tr", type: "target", position: Position.Right },
  { id: "sr", type: "source", position: Position.Right },
] as const;

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

// While a card is hovered its own busiest edges, a hub can have dozens; otherwise only the selected edge.
const labelled = computed(() => {
  if (hovered.value) return busiestOf(drawn.value.filter((e) => touches(e, hovered.value!)));
  return new Set(props.selectedEdgeId ? [props.selectedEdgeId] : []);
});

const openLabel = (node: MapNode) =>
  t("infra.k8s2.depsOpenEnd", { name: node.label, detail: node.detail, summary: summaryOf(node) });

function summaryOf(node: MapNode) {
  const count = neighbours.value.get(node.id)?.size ?? 0;
  const rate = formatRate(node.total);
  // "<0.1B/s" is already a bound, not an estimate.
  const approx = rate.startsWith("<") ? rate : t("infra.k8s2.depsApprox", { rate });
  return t("infra.k8s2.depsEndSummary", { count, rate: approx }, count);
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

// From the data alone: hovering never rebuilds them, which would make Vue Flow reparse every edge.
// Where each edge leaves and enters a card side, as offsets from its middle: the edges at one side spread out in
// the order their other ends lie, so they fan out instead of converging on one point or crossing at the card. A bow
// to a card in the same column leaves past the straight edges, toward its other end, and the deeper bow to a farther
// card leaves nearer the middle, outside the shallower one.
const PORT_SPACING = 10;
type Port = { id: string; end: "from" | "to"; tier: number; toward: number };
const ports = computed(() => {
  const sides = new Map<string, Port[]>();
  const middle = (id: string) => byId.value.get(id)!.position.y + CARD_H / 2;
  for (const e of drawn.value) {
    const [a, b] = [byId.value.get(e.source)!.position, byId.value.get(e.target)!.position];
    const forward = a.x < b.x;
    const loop = a.x === b.x;
    const slots = [...e.waypoints].sort((p, q) => (forward ? p.x - q.x : q.x - p.x));
    const sourceSide = loop || forward ? "right" : "left";
    const targetSide = loop || !forward ? "right" : "left";
    const add = (key: string, entry: Port) => sides.set(key, [...(sides.get(key) ?? []), entry]);
    // Below or above the straight edges by the bow's direction, the nearer card the further out.
    const bow = (self: string, other: string) => {
      const dy = middle(other) - middle(self);
      return { tier: Math.sign(dy), toward: -dy };
    };
    add(`${e.source}|${sourceSide}`, {
      id: e.id,
      end: "from",
      ...(loop ? bow(e.source, e.target) : { tier: 0, toward: slots[0]?.y ?? middle(e.target) }),
    });
    add(`${e.target}|${targetSide}`, {
      id: e.id,
      end: "to",
      ...(loop ? bow(e.target, e.source) : { tier: 0, toward: slots.at(-1)?.y ?? middle(e.source) }),
    });
  }
  const out = new Map<string, { from?: number; to?: number }>();
  for (const entries of sides.values()) {
    entries.sort((p, q) => p.tier - q.tier || p.toward - q.toward || p.id.localeCompare(q.id));
    const step = Math.min(PORT_SPACING, (CARD_H - 24) / Math.max(1, entries.length - 1));
    entries.forEach((entry, i) => {
      const offset = (i - (entries.length - 1) / 2) * step;
      out.set(entry.id, { ...out.get(entry.id), [entry.end]: offset });
    });
  }
  return out;
});

const flowEdges = computed<Edge[]>(() => {
  const max = Math.max(1, ...drawn.value.map((e) => e.total));
  return drawn.value.map((e) => {
    const from = byId.value.get(e.source)!;
    const to = byId.value.get(e.target)!;
    const dx = to.position.x - from.position.x;
    const [sourceHandle, targetHandle] =
      dx > 0 ? ["sr", "tl"] : dx < 0 ? ["sl", "tr"] : ["sr", "tr"];
    // Width by rate; one with no known client is drawn in a neutral grey, without an arrow.
    const width = 1.5 + 5 * Math.sqrt(e.total / max);
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
        color: e.directed ? from.color : UNDIRECTED,
        width,
        directed: e.directed,
        rate: formatRate(e.total),
        route: routeEdge(from.position, to.position, e.waypoints, ports.value.get(e.id)),
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
    // An undirected edge is a quiet line, lit like the rest when its card or itself is hovered.
    opacity: faded ? (hovered.value ? 0.08 : 0.2) : lit ? 1 : edge.data.directed ? 0.65 : 0.4,
    filter: selected ? `drop-shadow(0 0 0.25rem ${edge.data.color})` : undefined,
    transition: "opacity 0.15s ease",
  };
}

// Busiest first, each label where it clears the cards and the labels already placed; a hovered edge's always shows.
const routes = computed(() => new Map(flowEdges.value.map((e) => [e.id, e.data])));

// Placed without the hovered edge, so hovering one does not move the others.
const placed = computed(() => {
  const wanted = drawn.value
    .filter((e) => labelled.value.has(e.id))
    .sort((a, b) => b.total - a.total)
    .map((e) => ({
      id: e.id,
      text: routes.value.get(e.id)!.rate,
      spots: routes.value.get(e.id)!.route.spots,
    }));
  // Clear of every arrowhead, so a rate never covers where an edge lands.
  const arrows = flowEdges.value.filter((e) => e.data.directed).map((e) => arrowBox(e.data.route));
  // Clear of every other edge's line too, so none runs under a pill.
  const traces = new Map(flowEdges.value.map((e) => [e.id, e.data.route.trace]));
  return placeLabels(
    wanted,
    props.nodes.map((n) => n.position),
    arrows,
    traces,
  );
});

// Where each pill is drawn and how big, in the label layer above every edge. A resting pill the hovered edge's
// pill would cover is left out while it is hovered.
const pills = computed(() => {
  const out = new Map<string, { text: string; x: number; y: number }>();
  const hover = hoveredLabel.value;
  const hoverBox = hover ? labelBox(hover.text, hover.at) : null;
  for (const [id, at] of placed.value) {
    const text = routes.value.get(id)!.rate;
    if (hover && id !== hover.id && overlaps(labelBox(text, at), hoverBox!)) continue;
    out.set(id, { text, ...at });
  }
  if (hover) out.set(hover.id, { text: hover.text, ...hover.at });
  return out;
});

// In pixels throughout, like the cards, so the pill is the size the overlap checks assume whatever the root font size.
const pillStyle = (pill: { text: string; x: number; y: number }) => ({
  width: `${labelWidth(pill.text)}px`,
  height: `${LABEL_H}px`,
  fontSize: `${LABEL_FONT}px`,
  lineHeight: `${LABEL_H}px`,
  "--dep-label": `translate(-50%, -50%) translate(${pill.x}px, ${pill.y}px)`,
});

// The hovered edge's label, where it was placed or else on its route, drawn in the HTML label layer above every edge
// so no other edge or label covers it.
const hoveredLabel = computed(() => {
  const id = hoveredEdge.value;
  const route = id ? routes.value.get(id) : undefined;
  if (!id || !route) return null;
  const at = placed.value.get(id) ?? route.route.spots[0];
  return { id, text: route.rate, at };
});

// A resize refits, a moment after it settles, unless the user has moved the map since the last fit.
const pane = ref<HTMLElement | null>(null);

// Vue Flow's label layer, once its viewport is drawn: the pills are teleported into it.
const labelLayer = ref<HTMLElement | null>(null);
const findLabelLayer = () => {
  labelLayer.value ??= pane.value?.querySelector<HTMLElement>(".vue-flow__edge-labels") ?? null;
};
onMounted(() => nextTick(findLabelLayer));
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (typeof ResizeObserver === "undefined" || !pane.value) return;
  observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!userMoved.value && areNodesInitialized.value) fit(0, lastFloor);
    }, 150);
  });
  observer.observe(pane.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  clearTimeout(resizeTimer);
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
      ref="pane"
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
        :min-zoom="MIN_ZOOM"
        :max-zoom="2"
        @pane-ready="findLabelLayer"
        @nodes-initialized="fitIfPending"
        @node-click="({ node }) => node.data.clickable && emit('open', node.id)"
        @edge-click="({ edge }) => emit('select', edge.id)"
        @pane-click="emit('select', null)"
        @move-end="({ event }) => event && (userMoved = true)"
        @node-mouse-enter="({ node }) => (hovered = node.id)"
        @node-mouse-leave="hovered = null"
        @edge-mouse-enter="({ edge }) => (hoveredEdge = edge.id)"
        @edge-mouse-leave="hoveredEdge = null"
      >
        <Background :size="2" :gap="22" />

        <template #node-end="{ id, data }">
          <div
            class="bg-surface-base border-border-default rounded-default focus-visible:ring-accent/40 relative flex items-center gap-2 overflow-hidden border py-2 ps-3 pe-2 shadow-sm transition-[opacity,box-shadow,border-color] duration-150"
            :class="[
              data.clickable
                ? 'hover:border-border-strong cursor-pointer hover:shadow-md focus-visible:ring-2 focus-visible:outline-none'
                : '',
              dimmed(id) ? 'opacity-30' : '',
            ]"
            :style="CARD_SIZE"
            :title="data.title"
            :role="data.clickable ? 'button' : undefined"
            :tabindex="data.clickable ? 0 : undefined"
            :aria-label="data.clickable ? openLabel(data) : undefined"
            data-test="dependency-map-node"
          >
            <span
              class="absolute inset-y-0 start-0 w-1.5"
              :style="{ backgroundColor: data.color }"
              aria-hidden="true"
            />
            <OIcon :name="data.icon" size="sm" class="text-text-secondary shrink-0" />
            <div class="min-w-0 flex-1 leading-tight">
              <div class="text-text-heading truncate text-base leading-tight font-semibold">
                {{ raw(data.label) }}
              </div>
              <div class="text-text-secondary truncate text-sm leading-tight">
                {{ data.detail }}
              </div>
              <div class="text-text-secondary text-compact truncate leading-tight tabular-nums">
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
            :marker-end="edge.data.directed ? edge.markerEnd : undefined"
            :style="strokeOf(edge)"
          />
        </template>
      </VueFlow>
      <!-- Every rate pill in one layer, in Vue Flow's label layer inside the viewport: it moves with the map, sits
           above every edge and arrowhead, and the wheel and drags over a pill reach the map's pan and zoom. The
           rates are in the edge panel and the connection list too, so the layer is hidden from screen readers. A pill
           is part of its edge: hovering or clicking it does what the edge does, not what the pane does. -->
      <Teleport v-if="labelLayer" :to="labelLayer">
        <div class="absolute top-0 left-0" aria-hidden="true">
          <div
            v-for="[id, pill] in pills"
            :key="id"
            class="bg-surface-base border-border-strong text-text-body pointer-events-auto absolute top-0 left-0 flex [transform:var(--dep-label,none)] cursor-pointer items-center justify-center rounded-full border font-medium whitespace-nowrap tabular-nums"
            :style="pillStyle(pill)"
            :data-edge="id"
            :data-test="
              id === hoveredLabel?.id ? 'dependency-map-hovered-label' : 'dependency-map-label'
            "
            @click.stop="emit('select', id)"
            @mouseenter="hoveredEdge = id"
            @mouseleave="hoveredEdge = null"
          >
            {{ raw(pill.text) }}
          </div>
        </div>
      </Teleport>
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
          @click="zoomBy(true)"
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
          @click="zoomBy(false)"
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
          @click="fit(150, MIN_ZOOM)"
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
