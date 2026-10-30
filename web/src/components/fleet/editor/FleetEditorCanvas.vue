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

<template>
  <div
    class="bg-surface-panel relative h-full min-h-0 w-full"
    data-test="fleet-editor-canvas"
    @dragover.prevent="onDragOver"
    @dragleave="dropGroup = null"
    @drop.prevent="onDrop"
  >
    <div
      ref="toolbarEl"
      class="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-2 p-3"
    >
      <div class="flex-1" />
      <div class="pointer-events-auto flex flex-1 justify-center">
        <OTag
          v-if="dirty"
          variant="warning-soft"
          dot
          :label="t('fleet.editor.unsaved')"
          data-test="fleet-editor-canvas-unsaved"
        />
      </div>
      <div class="pointer-events-auto flex flex-1 items-center justify-end gap-1">
        <OButton
          variant="outline"
          size="sm"
          icon-left="add"
          data-test="fleet-editor-canvas-add-pipeline"
          @click="emit('add-pipeline')"
        >
          <span class="max-md:sr-only">{{ t("fleet.editor.addPipeline") }}</span>
        </OButton>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="account-tree"
          data-test="fleet-editor-canvas-auto-layout"
          @click="autoLayout"
        >
          <OTooltip side="bottom" :content="t('fleet.editor.autoLayout')" />
        </OButton>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="fullscreen"
          data-test="fleet-editor-canvas-fit"
          @click="fit"
        >
          <OTooltip side="bottom" :content="t('fleet.editor.fitView')" />
        </OButton>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="delete-sweep"
          :aria-label="t('fleet.editor.clear')"
          data-test="fleet-editor-canvas-clear"
          @click="emit('clear')"
        >
          <OTooltip side="bottom" :content="t('fleet.editor.clear')" />
        </OButton>
      </div>
    </div>

    <VueFlow
      :id="flowId"
      :key="layoutKey"
      :nodes="nodes"
      :edges="edges"
      :nodes-connectable="false"
      :elements-selectable="false"
      :delete-key-code="null"
      :min-zoom="0.3"
      :pan-on-scroll="true"
      :max-zoom="1.5"
      class="h-full w-full"
      @node-click="onNodeClick"
      @pane-click="emit('select-pipeline', null)"
      @nodes-initialized="fitOnce"
    >
      <Background
        :variant="BackgroundVariant.Dots"
        :gap="18"
        :size="1.2"
        :pattern-color="dotColor"
      />
      <template #node-pipeline="nodeProps">
        <FleetEditorGroupNode :id="nodeProps.id" :data="nodeProps.data" />
      </template>
      <template #node-component="nodeProps">
        <FleetEditorNode :id="nodeProps.id" :data="nodeProps.data" />
      </template>
      <template #edge-dashed="edgeProps">
        <FleetEditorEdge v-bind="edgeProps" />
      </template>
    </VueFlow>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { VueFlow, useVueFlow, type Edge, type Node, type NodeMouseEvent } from "@vue-flow/core";
import { Background, BackgroundVariant } from "@vue-flow/background";
import "@vue-flow/core/dist/style.css";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import FleetEditorNode, { type EditorNodeData } from "./FleetEditorNode.vue";
import FleetEditorGroupNode, {
  type EditorGroupData,
  type GroupIssue,
} from "./FleetEditorGroupNode.vue";
import FleetEditorEdge from "./FleetEditorEdge.vue";
import {
  catalogFor,
  compKey,
  pipelinesUsing,
  PALETTE_MIME,
  type EditorGraph,
  type EditorKind,
} from "./editorGraph";

const props = defineProps<{
  graph: EditorGraph;
  selectedNode: string | null;
  selectedPipeline: string | null;
  issues: Record<string, GroupIssue[]>;
  dirty: boolean;
}>();

const emit = defineEmits<{
  "select-node": [nodeId: string, pipelineId: string | null, key: string];
  "select-pipeline": [pipelineId: string | null];
  drop: [paletteKey: string, pipelineId: string | null];
  "add-pipeline": [];
  clear: [];
}>();

const { t } = useI18nTyped();

const flowId = "fleet-config-editor";
const {
  fitView,
  getViewport,
  setViewport,
  setCenter,
  findNode,
  dimensions,
  screenToFlowCoordinate,
} = useVueFlow(flowId);
// Below this zoom node text is unreadable, so the canvas pans instead of shrinking further.
const MIN_READABLE_ZOOM = 0.75;
// SVG fill on the background dots, the one place a token is read by var().
const dotColor = "var(--color-border-strong)";

const NODE_W = 208;
const NODE_H = 60;
const COL_GAP = 64;
const ROW_GAP = 24;
const PAD_X = 32;
const PAD_TOP = 56;
const PAD_BOTTOM = 32;
const GROUP_GAP = 40;
const FIT_GAP = 16;

const layoutKey = ref(0);
const toolbarEl = ref<HTMLElement | null>(null);
// Nodes re-initialize on every add, so only the first measure fits; later the user's pan and zoom stand.
let fitted = false;
const dropGroup = ref<string | null>(null);

interface GroupBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const layout = computed(() => {
  const groups: GroupBox[] = [];
  const placed: { nodeId: string; parent: string; key: string; x: number; y: number }[] = [];
  let y = 0;
  for (const p of props.graph.pipelines) {
    const columns: [EditorKind, string[]][] = [
      ["receiver", p.receivers],
      ...p.processors.map((id) => ["processor", [id]] as [EditorKind, string[]]),
      ["exporter", p.exporters],
    ];
    const rows = Math.max(1, p.receivers.length, p.exporters.length);
    const innerH = rows * NODE_H + (rows - 1) * ROW_GAP;
    const w = PAD_X * 2 + columns.length * NODE_W + (columns.length - 1) * COL_GAP;
    const h = PAD_TOP + innerH + PAD_BOTTOM;
    const groupId = `group|${p.id}`;
    groups.push({ id: groupId, x: 0, y, w, h });
    columns.forEach(([kind, ids], col) => {
      const colH = ids.length * NODE_H + Math.max(0, ids.length - 1) * ROW_GAP;
      ids.forEach((id, row) => {
        placed.push({
          nodeId: `${p.id}|${compKey(kind, id)}`,
          parent: groupId,
          key: compKey(kind, id),
          x: PAD_X + col * (NODE_W + COL_GAP),
          y: PAD_TOP + (innerH - colH) / 2 + row * (NODE_H + ROW_GAP),
        });
      });
    });
    y += h + GROUP_GAP;
  }
  const extensions = props.graph.extensions.map((id, i) => ({
    nodeId: `ext|${compKey("extension", id)}`,
    key: compKey("extension", id),
    x: i * (NODE_W + ROW_GAP),
    y,
  }));
  return { groups, placed, extensions };
});

function nodeData(key: string, nodeId: string): EditorNodeData {
  const c = props.graph.components[key];
  const item = c ? catalogFor(c) : undefined;
  return {
    kind: c?.kind ?? "receiver",
    name: raw(item?.name ?? c?.type ?? key),
    componentId: raw(c?.id ?? key),
    icon: item?.icon ?? "extension",
    sharedCount: c?.kind === "extension" ? 0 : pipelinesUsing(props.graph, key).length,
    selected: props.selectedNode === nodeId,
    fromBase: !!c?.base,
  };
}

const nodes = computed<Node[]>(() => {
  const { groups, placed, extensions } = layout.value;
  const groupNodes: Node<EditorGroupData>[] = groups.map((g) => {
    const pid = g.id.slice("group|".length);
    const pipeline = props.graph.pipelines.find((p) => p.id === pid);
    return {
      id: g.id,
      type: "pipeline",
      position: { x: g.x, y: g.y },
      width: g.w,
      height: g.h,
      draggable: false,
      zIndex: 0,
      data: {
        label: raw(pid),
        signal: pid.split("/")[0],
        selected: props.selectedPipeline === pid,
        dropTarget: dropGroup.value === g.id,
        empty:
          !pipeline ||
          !(pipeline.receivers.length + pipeline.processors.length + pipeline.exporters.length),
        issues: props.issues[pid] ?? [],
      },
    };
  });
  const childNodes: Node<EditorNodeData>[] = placed.map((n) => ({
    id: n.nodeId,
    type: "component",
    parentNode: n.parent,
    extent: "parent",
    position: { x: n.x, y: n.y },
    zIndex: 1,
    data: nodeData(n.key, n.nodeId),
  }));
  const extNodes: Node<EditorNodeData>[] = extensions.map((n) => ({
    id: n.nodeId,
    type: "component",
    position: { x: n.x, y: n.y },
    data: nodeData(n.key, n.nodeId),
  }));
  return [...groupNodes, ...childNodes, ...extNodes];
});

const edges = computed<Edge[]>(() => {
  const out: Edge[] = [];
  for (const p of props.graph.pipelines) {
    const id = (kind: EditorKind, cid: string) => `${p.id}|${compKey(kind, cid)}`;
    const chain = p.processors.map((cid) => id("processor", cid));
    const first = chain[0];
    const last = chain[chain.length - 1];
    const targets = first ? [first] : p.exporters.map((cid) => id("exporter", cid));
    p.receivers.forEach((cid) =>
      targets.forEach((tgt) =>
        out.push({
          id: `${id("receiver", cid)}->${tgt}`,
          source: id("receiver", cid),
          target: tgt,
          type: "dashed",
          zIndex: 1,
          data: { arrow: !first },
        }),
      ),
    );
    chain.slice(1).forEach((tgt, i) =>
      out.push({
        id: `${chain[i]}->${tgt}`,
        source: chain[i],
        target: tgt,
        type: "dashed",
        zIndex: 1,
        data: { arrow: true },
      }),
    );
    if (last)
      p.exporters.forEach((cid) =>
        out.push({
          id: `${last}->${id("exporter", cid)}`,
          source: last,
          target: id("exporter", cid),
          type: "dashed",
          zIndex: 1,
          data: { arrow: true },
        }),
      );
  }
  return out;
});

function groupAt(event: DragEvent): string | null {
  const pos = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  const hit = layout.value.groups.find(
    (g) => pos.x >= g.x && pos.x <= g.x + g.w && pos.y >= g.y && pos.y <= g.y + g.h,
  );
  return hit?.id ?? null;
}

function onDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes(PALETTE_MIME)) return;
  event.dataTransfer.dropEffect = "copy";
  dropGroup.value = groupAt(event);
}

function onDrop(event: DragEvent) {
  const key = event.dataTransfer?.getData(PALETTE_MIME);
  const group = groupAt(event);
  dropGroup.value = null;
  if (key) emit("drop", key, group ? group.slice("group|".length) : null);
}

function onNodeClick({ node }: NodeMouseEvent) {
  if (node.type === "pipeline") {
    emit("select-pipeline", node.id.slice("group|".length));
    return;
  }
  const [scope, key] = node.id.split("|");
  emit("select-node", node.id, scope === "ext" ? null : scope, key);
}

// Two frames: the pane resizes after the side panel mounts, and Vue Flow measures on the next frame.
function afterLayout(run: () => void) {
  nextTick(() => requestAnimationFrame(() => requestAnimationFrame(run)));
}

function toolbarInset() {
  return toolbarEl.value?.offsetHeight ?? 0;
}

function fitOnce() {
  if (fitted) return;
  fitted = true;
  fit();
}

function fit() {
  afterLayout(async () => {
    const top = toolbarInset() + FIT_GAP;
    // Vue Flow's fitView padding accepts px or %, not rem.
    const side = `${FIT_GAP}px` as const;
    await fitView({
      padding: { top: `${top}px` as const, right: side, bottom: side, left: side },
      maxZoom: 1,
    });
    if (getViewport().zoom < MIN_READABLE_ZOOM) {
      setViewport({ x: 2 * FIT_GAP, y: top, zoom: MIN_READABLE_ZOOM });
    }
  });
}

/** Brings one pipeline box into view at a readable zoom, e.g. when Publish is blocked by it. */
function focusPipeline(pipelineId: string) {
  afterLayout(() =>
    fitView({
      nodes: [`group|${pipelineId}`],
      padding: 0.2,
      minZoom: MIN_READABLE_ZOOM,
      maxZoom: 1,
      duration: 300,
    }),
  );
}

function reveal(nodeId: string) {
  afterLayout(() => {
    const node = findNode(nodeId);
    if (!node) return;
    const inset = toolbarInset();
    const { x, y, zoom } = getViewport();
    const { width, height } = dimensions.value;
    const left = node.computedPosition.x * zoom + x;
    const top = node.computedPosition.y * zoom + y;
    const right = left + node.dimensions.width * zoom;
    const bottom = top + node.dimensions.height * zoom;
    if (left >= 0 && top >= inset && right <= width && bottom <= height) return;
    setCenter(
      node.computedPosition.x + node.dimensions.width / 2,
      node.computedPosition.y + node.dimensions.height / 2 - inset / 2 / zoom,
      { zoom, duration: 300 },
    );
  });
}

function autoLayout() {
  fitted = false;
  layoutKey.value++;
}

defineExpose({ focusPipeline, reveal });
</script>
