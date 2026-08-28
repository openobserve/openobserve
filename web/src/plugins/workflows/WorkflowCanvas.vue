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
  Workflow canvas — fork of plugins/pipelines/PipelineFlow.vue.

  Renders the VueFlow surface with the colour-coded WorkflowNode, shared
  FlowEdge, a dotted grid background, zoom controls and an empty-state hint.
  Nodes are added via the docked palette (drag-drop or click) and the hover-`+`
  step picker.
-->
<template>
  <VueFlow
    ref="vueFlowRef"
    v-model:nodes="workflowObj.currentSelectedWorkflow.nodes"
    v-model:edges="workflowObj.currentSelectedWorkflow.edges"
    class="workflow-flow o2vf_node"
    :class="{ 'workflow-flow--readonly': readOnly }"
    :connect-on-click="false"
    :default-viewport="{ zoom: 0.8 }"
    :min-zoom="0.2"
    :max-zoom="4"
    :nodes-draggable="!readOnly"
    :nodes-connectable="!readOnly"
    :edges-updatable="!readOnly"
    :pan-on-drag="!isEmptyCanvas"
    @node-change="onNodeChange"
    @nodes-change="onNodesChange"
    @edges-change="onEdgesChange"
    @node-drag-start="onNodeDragStart"
    @node-drag-stop="onNodeDragStop"
    @node-mouse-enter="onNodeMouseEnter"
    @node-mouse-leave="onNodeMouseLeave"
    @edge-mouse-enter="onEdgeMouseEnter"
    @edge-mouse-leave="onEdgeMouseLeave"
    @edge-click="onEdgeClick"
    @connect="onConnect"
    @drop="onDrop"
    @dragover="onDragOver"
  >
    <!-- Dot colour is token-driven via CSS (flow-canvas.css); the
         library applies `pattern-color` as an SVG attribute, where var() would
         not resolve. -->
    <Background :size="2" :gap="22" />

    <!-- Edge-delete hint — on edge click, a top-center banner reminds the user that
         Backspace/Delete removes the edge (same affordance as the Pipelines canvas).
         Inserting a step is done via the mid-edge `+`, so the edge has no menu. -->
    <div
      v-if="showEdgeHint && !readOnly"
      data-test="workflow-edge-delete-hint"
      class="bg-surface-base text-text-body border-border-default rounded-default absolute top-5 left-1/2 z-1000 flex -translate-x-1/2 items-center border px-4 py-2.5 text-sm shadow-lg dark:shadow-lg"
    >
      <OIcon name="info" class="mr-1" size="sm" />
      {{ t("workflow.canvas.edgeDeleteHint") }}
    </div>

    <!-- All three VueFlow templates render the same node; handle layout is
         derived from node_type inside WorkflowNode, so no io_type prop. -->
    <template #node-input="{ id, data }">
      <WorkflowNode :id="id" :data="data" />
    </template>
    <template #node-output="{ id, data }">
      <WorkflowNode :id="id" :data="data" />
    </template>
    <template #node-default="{ id, data }">
      <WorkflowNode :id="id" :data="data" />
    </template>

    <template #edge-custom="edgeProps">
      <FlowEdge
        :id="edgeProps.id"
        :source-x="edgeProps.sourceX"
        :source-y="edgeProps.sourceY"
        :target-x="edgeProps.targetX"
        :target-y="edgeProps.targetY"
        :source-position="edgeProps.sourcePosition"
        :target-position="edgeProps.targetPosition"
        :data="edgeProps.data"
        :marker-end="edgeProps.markerEnd"
        :style="edgeProps.style"
        :insertable="!readOnly && isEdgeRevealed(edgeProps.id)"
        @insert="onEdgeInsert(edgeProps.id, $event)"
        @insert-enter="onInsertEnter(edgeProps.id)"
        @insert-leave="onInsertLeave"
      />
    </template>

    <Controls :show-interactive="false" class="controls-grp" position="top-left">
      <!-- Node-rail toggle, same as the pipeline canvas: `#top` puts it ABOVE
           zoom-in / zoom-out / fit-view, and the glyph is a bare 32x32
           currentColor <svg> so it matches Vue Flow's own control icons. -->
      <template #top>
        <!-- Hidden on the read-only Runs canvas: the node palette only exists in
             the editor, so the toggle would be a no-op there. -->
        <ControlButton
          v-if="!readOnly"
          data-test="workflow-palette-collapse-btn"
          :title="
            workflowObj.showNodePalette ? t('pipeline.collapseNodes') : t('pipeline.openNodes')
          "
          @click="workflowObj.showNodePalette = !workflowObj.showNodePalette"
        >
          <!-- » chevrons; mirrored in place to « once the rail is open. -->
          <svg viewBox="0 0 32 32">
            <path
              :transform="workflowObj.showNodePalette ? 'translate(32,0) scale(-1,1)' : undefined"
              d="M2 5.5 5.5 2 19.5 16 5.5 30 2 26.5 12.5 16ZM14.5 5.5 18 2 32 16 18 30 14.5 26.5 25 16Z"
            />
          </svg>
        </ControlButton>

        <!-- Undo (T1) — editor-only, sits with the palette toggle ABOVE zoom/fit.
             Undo is the ONLY history button; redo is keyboard-only (Ctrl/Cmd+Shift+Z).
             Bare currentColor <svg> (like the palette toggle) so it matches Vue
             Flow's own control icons and adapts to light/dark. -->
        <ControlButton
          v-if="!readOnly"
          data-test="workflows-canvas-undo"
          :disabled="!canUndo"
          :title="t('workflow.canvas.undo')"
          @click="onUndo"
        >
          <!-- Undo — curved arrow. -->
          <svg viewBox="0 0 24 24">
            <path
              d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"
            />
          </svg>
        </ControlButton>
      </template>

      <!-- Tidy up (T9) — placed in the DEFAULT slot so it renders LAST, after
           zoom-in / zoom-out / fit-view. Editor-only. -->
      <ControlButton
        v-if="!readOnly"
        data-test="workflows-canvas-tidy"
        :title="t('workflow.canvas.tidyUp')"
        @click="onTidy"
      >
        <!-- Tidy up — magic wand / auto-arrange (Material auto_fix_high). -->
        <svg viewBox="0 0 24 24">
          <path
            d="M7.5 5.6 10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7l2.5-1.4zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14l-2.5 1.4zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5L22 2zm-7.63 5.29a.9959.9959 0 0 0-1.41 0L1.29 18.96a.9959.9959 0 0 0 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 11.05c.39-.39.39-1.02 0-1.41l-2.33-2.35zm-1.03 5.49-2.12-2.12 2.44-2.44 2.12 2.12-2.44 2.44z"
          />
        </svg>
      </ControlButton>
    </Controls>
  </VueFlow>

  <!-- Empty-canvas start scaffold — two DASHED placeholder cards (Trigger on top,
       Action below, joined by a dashed connector), mirroring the reference
       builder's start state so the trigger→action shape is legible before
       anything is placed. Clicking Trigger opens the trigger-kind picker; clicking
       Action opens the step picker for the addable (non-trigger) node types.

       OVERLAYS, not Vue Flow nodes: real nodes would land in
       `currentSelectedWorkflow.nodes` and show up in save, validation and the
       dirty flag. Scaled by the LIVE viewport zoom (like a real node inside
       `.vue-flow__viewport`, which carries the canvas transform) so the cards
       track the canvas. Read-only Runs canvases show nothing. -->
  <div
    v-if="isEmptyCanvas && !readOnly"
    data-test="workflow-flow-start-scaffold"
    class="absolute top-24 left-1/2 z-10 flex origin-top -translate-x-1/2 scale-[var(--ghost-zoom,1)] flex-col items-center"
    :style="{ '--ghost-zoom': viewport.zoom }"
  >
    <WorkflowStartCard
      :tag="t('workflow.node.kindTrigger')"
      :title="t('workflow.chooseTrigger')"
      :hint="t('workflow.start.triggerHint')"
      icon="notifications-active"
      tint="bg-badge-blue-soft-bg text-badge-blue-soft-text"
      data-test="workflow-flow-start-trigger"
      @click="openTriggerPicker($event)"
    />

    <!-- Dashed connector + `+` between the two slots — same chip as every other
         "add a step here" affordance; here it opens the Action picker. -->
    <div class="flex flex-col items-center">
      <span class="border-border-strong h-5 border-l-2"></span>
      <FlowAddButton data-test="workflow-flow-start-add" @click="openActionPicker($event)" />
      <span class="border-border-strong h-5 border-l-2"></span>
    </div>

    <WorkflowStartCard
      :tag="t('workflow.node.kindAction')"
      :title="t('workflow.start.chooseAction')"
      :hint="t('workflow.start.actionHint')"
      icon="bolt"
      tint="bg-badge-success-soft-bg text-badge-success-soft-text"
      data-test="workflow-flow-start-action"
      @click="openActionPicker($event)"
    />
  </div>

  <!-- Persistent Action slot — once the Trigger is placed but no step follows it
       yet, the Action ghost stays right below the real trigger node (so "picking
       one keeps the other"). Anchored in FLOW space (viewport-transformed) to the
       trigger's measured position + height, so it tracks pan/zoom and sits flush
       under the node. Clicking it (or the connector `+`) opens the Action picker,
       which appends + wires the first step after the trigger. -->
  <div
    v-if="actionSlot && !readOnly"
    data-test="workflow-flow-action-slot"
    class="absolute top-[var(--wf-oy,0)] left-[var(--wf-ox,0)] z-10 flex origin-top -translate-x-1/2 scale-[var(--wf-oz,1)] flex-col items-center"
    :style="{
      '--wf-ox': actionSlot.left + 'px',
      '--wf-oy': actionSlot.top + 'px',
      '--wf-oz': actionSlot.zoom,
    }"
  >
    <div class="flex flex-col items-center">
      <span class="border-border-strong h-5 border-l-2"></span>
      <FlowAddButton data-test="workflow-flow-action-add" @click="openActionPicker($event)" />
      <span class="border-border-strong h-5 border-l-2"></span>
    </div>
    <WorkflowStartCard
      :tag="t('workflow.node.kindAction')"
      :title="t('workflow.start.chooseAction')"
      :hint="t('workflow.start.actionHint')"
      icon="bolt"
      tint="bg-badge-success-soft-bg text-badge-success-soft-text"
      data-test="workflow-flow-action-slot-card"
      @click="openActionPicker($event)"
    />
  </div>

  <!-- Append `+` — every step that can still chain onward gets a straight-down `+`
       to add the next step / fan out a branch. A leaf's is persistent; a node whose
       centre slot is already taken by a child reveals it on HOVER only. The `+`'s own
       mouse events keep the reveal alive while the cursor is on it. Flow-anchored so
       it tracks the node. -->
  <div
    v-for="pt in appendPoints"
    :key="pt.id"
    data-test="workflow-flow-append-add"
    class="absolute top-[var(--wf-oy,0)] left-[var(--wf-ox,0)] z-20 flex origin-top -translate-x-1/2 scale-[var(--wf-oz,1)] flex-col items-center"
    :style="{ '--wf-ox': pt.left + 'px', '--wf-oy': pt.top + 'px', '--wf-oz': pt.zoom }"
    @mouseenter="onAppendEnter(pt.id)"
    @mouseleave="onNodeMouseLeave"
  >
    <!-- Connector is ALWAYS drawn for a shown point — a leaf's straight stub, or a
         branch's short side-nudged curve. Option C: the point only renders while its
         node is hovered, so at rest there's nothing here. -->
    <span v-if="!pt.svgW" class="border-border-strong h-5 border-l-2"></span>
    <svg
      v-else
      :width="pt.svgW"
      height="20"
      :viewBox="`${-pt.svgW / 2} 0 ${pt.svgW} 20`"
      aria-hidden="true"
    >
      <path
        :d="`M ${pt.cx} 0 Q ${pt.cx} 13 0 20`"
        fill="none"
        stroke="var(--color-border-strong)"
        stroke-width="2"
      />
    </svg>
    <FlowAddButton @click="openStepPicker(pt.id, 'out', $event)" />
  </div>

  <!-- Trigger-missing fallback: no trigger but the canvas isn't empty (a step was
       placed first, or the trigger was deleted mid-graph). The two-slot scaffold
       is for the EMPTY canvas only; here we show a single dashed "Choose a Trigger"
       card so the user can pick a kind (adding it auto-wires a lone orphan step). -->
  <div
    v-if="needsTrigger && !isEmptyCanvas && !readOnly"
    data-test="workflow-flow-start-node"
    class="absolute top-24 left-1/2 z-10 flex origin-top -translate-x-1/2 scale-[var(--ghost-zoom,1)] flex-col items-center"
    :style="{ '--ghost-zoom': viewport.zoom }"
  >
    <WorkflowStartCard
      :tag="t('workflow.node.kindTrigger')"
      :title="t('workflow.chooseTrigger')"
      :hint="t('workflow.start.triggerHint')"
      icon="notifications-active"
      tint="bg-badge-blue-soft-bg text-badge-blue-soft-text"
      data-test="workflow-flow-start-trigger-fallback"
      @click="openTriggerPicker($event)"
    />
  </div>
</template>

<script setup lang="ts">
// Shared, token-driven canvas styling lives in ONE place so the pipeline and
// workflow canvases cannot drift. Intentionally global: the selectors target
// VueFlow's own markup, which never carries a scoped data-attribute.
import "@/components/flow/flow-canvas.css";
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from "vue";
import { VueFlow, useVueFlow } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls, ControlButton } from "@vue-flow/controls";
import { useI18nTyped } from "@/types/i18n";
import WorkflowNode from "./WorkflowNode.vue";
import WorkflowStartCard from "./WorkflowStartCard.vue";
import FlowEdge from "@/components/flow/FlowEdge.vue";
import FlowAddButton from "@/components/flow/FlowAddButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import useWorkflowCanvas, {
  workflowHistory,
  pushWorkflowHistory,
  undoWorkflow,
  redoWorkflow,
  tidyWorkflowLayout,
  nodeMeta,
} from "./useWorkflowCanvas";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

const { t } = useI18nTyped();
const {
  workflowObj,
  onNodeChange,
  onNodesChange,
  onEdgesChange,
  onNodeDragStart,
  onNodeDragStop,
  onConnect,
  onDrop,
  onDragOver,
  openTriggerPicker,
  openActionPicker,
  openStepPicker,
  openInsertPicker,
} = useWorkflowCanvas(t);

const {
  onNodesInitialized,
  setViewport,
  viewport,
  dimensions,
  findNode,
  getSelectedEdges,
  removeEdges,
  fitView,
  setCenter,
} = useVueFlow();

// Undo availability drives the button's disabled state (T1).
const canUndo = computed(() => workflowHistory.past.length > 0);
const onUndo = () => undoWorkflow();
// Tidy re-lays-out the tree (T9), then PANS the view so the tidied graph is
// centered on screen — WITHOUT changing the zoom level (users found fit-view's
// zoom jump disorienting; but with no re-frame at all the re-laid-out graph landed
// off-screen). We keep the current zoom and move the viewport to the graph's
// bounding-box centre via setCenter. Pass the measured node width so cards centre
// on their column; fall back to a default width for any node not measured yet.
const onTidy = () => {
  const getWidth = (id: string) => findNode(id)?.dimensions?.width;
  if (!tidyWorkflowLayout(getWidth)) return;
  const nodes = workflowObj.currentSelectedWorkflow?.nodes || [];
  if (!nodes.length) return;
  // Compute the graph's bounding box from the just-applied positions. Node
  // DIMENSIONS are measured from the DOM and don't depend on position, so they're
  // valid synchronously here — no nextTick needed. Doing this in the SAME tick (and
  // with duration 0 below) means the layout change and the recenter flush in one
  // paint, so there's no visible "snap left, then glide back to centre" movement.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const dims = findNode(n.id)?.dimensions;
    const w = dims?.width || 240;
    const h = dims?.height || 60;
    const x = n.position?.x ?? 0;
    const y = n.position?.y ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  // Centre the graph, kept at the CURRENT zoom (no zoom in/out) and with NO
  // animation (duration 0) so the recenter is instant, not a visible pan.
  setCenter((minX + maxX) / 2, (minY + maxY) / 2, {
    zoom: viewport.value.zoom,
    duration: 0,
  });
};

const vueFlowRef = ref<any>(null);
// Read-only inspection canvas (the Runs view) — disables node drag/connect and,
// via WorkflowNode, the hover add/delete + click-to-edit. Run overlays stay.
const readOnly = computed(() => workflowObj.readOnly);

// Edges have no menu — a step is inserted via the mid-edge `+` (onEdgeInsert) and a
// connection is removed with Backspace/Delete on the selected edge. Clicking an edge
// just flashes a top-center hint advertising that shortcut (same as the Pipelines
// canvas). Skipped on the read-only Runs canvas, where edges can't be edited.
const showEdgeHint = ref(false);
let edgeHintTimeout: ReturnType<typeof setTimeout> | null = null;
const onEdgeClick = () => {
  if (readOnly.value) return;
  if (edgeHintTimeout) clearTimeout(edgeHintTimeout);
  showEdgeHint.value = true;
  edgeHintTimeout = setTimeout(() => {
    showEdgeHint.value = false;
    edgeHintTimeout = null;
  }, 3500);
};

// Is the user typing in a field / code editor? Undo/redo + edge-delete must not
// hijack keystrokes meant for an input (a node config field, Monaco, etc.).
const isTextInputTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    el.isContentEditable ||
    !!el.closest?.(".monaco-editor")
  );
};

// Keyboard handling on the canvas:
//   • Backspace/Delete removes the selected edge (the action the hint advertises;
//     scoped to EDGES only so node deletion keeps flowing through the confirm dialog).
//   • Ctrl/Cmd+Z undoes the last structural change; Ctrl/Cmd+Shift+Z redoes it
//     (redo is keyboard-only — no on-screen button, by product decision).
// All of these are inert on the read-only Runs canvas and while a text input /
// Monaco editor is focused.
const onKeydown = (event: KeyboardEvent) => {
  if (readOnly.value) return;
  if (isTextInputTarget(event.target)) return;

  const mod = event.metaKey || event.ctrlKey;
  if (mod && (event.key === "z" || event.key === "Z")) {
    event.preventDefault();
    if (event.shiftKey) redoWorkflow();
    else undoWorkflow();
    return;
  }

  if (event.key !== "Delete" && event.key !== "Backspace") return;
  const selected = getSelectedEdges.value;
  if (!selected.length) return;
  event.preventDefault();
  // Snapshot BEFORE removal so the edge-delete is a single undo step.
  pushWorkflowHistory();
  removeEdges(selected.map((e) => e.id));
};

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  if (edgeHintTimeout) clearTimeout(edgeHintTimeout);
});
// The "Choose a Trigger" start node shows whenever the workflow has NO TRIGGER —
// not only when the canvas is empty. A workflow needs exactly one trigger, and
// the trigger is now deletable (its kind can be swapped); if the user deletes it
// while other steps remain they'd be stranded with no way to add one back.
// Keying off "no workflow_trigger node" (the same test validate() uses) covers
// both the empty canvas and the trigger-deleted-mid-graph case.
const needsTrigger = computed(
  () =>
    !workflowObj.currentSelectedWorkflow.nodes.some(
      (n: any) => n.data?.node_type === "workflow_trigger",
    ),
);

// A brand-new, untouched canvas — nothing placed yet. This is when the two-slot
// Trigger + Action start scaffold shows; once ANY node exists we fall back to the
// single "Choose a Trigger" card (only if the trigger is missing) and the flow-
// anchored `+` add affordances below.
const isEmptyCanvas = computed(
  () => (workflowObj.currentSelectedWorkflow.nodes || []).length === 0,
);

// The trigger node (if placed) and how many NON-trigger steps exist — drive which
// start affordances show.
const triggerNode = computed<any>(() =>
  (workflowObj.currentSelectedWorkflow.nodes || []).find(
    (n: any) => n.data?.node_type === "workflow_trigger",
  ),
);
const hasTrigger = computed(() => !!triggerNode.value);
const stepCount = computed(
  () =>
    (workflowObj.currentSelectedWorkflow.nodes || []).filter(
      (n: any) => n.data?.node_type !== "workflow_trigger",
    ).length,
);

// Flow-coordinate → screen-pixel (relative to the canvas pane, whose origin the
// viewport transform is measured from). Used to pin the flow-anchored overlays
// (the persistent Action slot + the leaf-append `+`s) under their nodes so they
// pan and zoom exactly like a real node. `left`/`top` land the node's BOTTOM-CENTRE
// at the screen point; the overlay then grows downward from there.
const screenBelow = (node: any) => {
  const dims = findNode(node.id)?.dimensions;
  const w = dims?.width ?? 240;
  const h = dims?.height ?? 54;
  const { x, y, zoom } = viewport.value;
  return {
    left: x + ((node.position?.x ?? 0) + w / 2) * zoom,
    top: y + ((node.position?.y ?? 0) + h) * zoom,
    zoom,
  };
};

// Persistent Action slot: shown once the trigger is placed but no step follows it
// yet, pinned flush under the trigger node (so choosing the trigger keeps the
// Action ghost in view). Null otherwise.
const actionSlot = computed(() => {
  if (readOnly.value || !hasTrigger.value || stepCount.value !== 0) return null;
  return screenBelow(triggerNode.value);
});

// Option C reveal state: the currently-hovered node and edge drive the append `+` and
// the mid-edge insert `+`. A generous hide delay so the cursor can travel the connector
// path onto the small `+` without it vanishing first (the `+`'s own mouseenter cancels
// the timer anyway; this covers the gap in between).
const HIDE_DELAY = 300;
const hoveredNodeId = ref("");
const hoveredEdgeId = ref("");
let nodeHideTimer: ReturnType<typeof setTimeout> | null = null;
let edgeHideTimer: ReturnType<typeof setTimeout> | null = null;
const cancelNodeHide = () => {
  if (nodeHideTimer) clearTimeout(nodeHideTimer);
  nodeHideTimer = null;
};
const cancelEdgeHide = () => {
  if (edgeHideTimer) clearTimeout(edgeHideTimer);
  edgeHideTimer = null;
};
const onNodeMouseEnter = (e: any) => {
  cancelNodeHide();
  hoveredNodeId.value = e?.node?.id || "";
};
const onNodeMouseLeave = () => {
  cancelNodeHide();
  nodeHideTimer = setTimeout(() => (hoveredNodeId.value = ""), HIDE_DELAY);
};
// Hovering the EDGE line itself reveals that edge's insert `+`, so you can drop a step
// between two nodes without travelling up to a node first.
const onEdgeMouseEnter = (e: any) => {
  cancelEdgeHide();
  hoveredEdgeId.value = e?.edge?.id || "";
};
const onEdgeMouseLeave = () => {
  cancelEdgeHide();
  edgeHideTimer = setTimeout(() => (hoveredEdgeId.value = ""), HIDE_DELAY);
};
// Hovering an append `+` keeps its node the hovered one, so the `+` (and any edge
// inserts on that node) stay up while the cursor is on the chip.
const onAppendEnter = (id: string) => {
  cancelNodeHide();
  hoveredNodeId.value = id;
};
// Cursor moved onto a mid-edge `+`: keep it up regardless of whether it was revealed by
// the edge line or an endpoint node (re-assert the edge as hovered, freeze both timers).
const onInsertEnter = (edgeId: string) => {
  cancelNodeHide();
  cancelEdgeHide();
  hoveredEdgeId.value = edgeId;
};
const onInsertLeave = () => {
  onNodeMouseLeave();
  onEdgeMouseLeave();
};
// Option C: a mid-edge insert `+` shows while the edge line is hovered OR while either
// of its endpoint nodes is hovered — so it's reachable both ways, and the canvas is
// otherwise quiet at rest.
const isEdgeRevealed = (edgeId: string) => {
  if (hoveredEdgeId.value === edgeId) return true;
  const id = hoveredNodeId.value;
  if (!id) return false;
  const e = (workflowObj.currentSelectedWorkflow?.edges || []).find((x: any) => x.id === edgeId);
  return !!e && (e.source === id || e.target === id);
};

// The append `+` for ONE node. A leaf (no children) shows a persistent STRAIGHT-DOWN
// `+` — the "add next step" affordance. A node that ALREADY has children reveals its
// `+` on HOVER only (`hoverOnly`, so the canvas isn't cluttered) and nudges it a
// little to the side AWAY from the existing edge(s) — with a short connector — so it
// reads as a separate branch handle rather than sitting on the edge. Clicking fans out.
const appendPointFor = (node: any) => {
  const base = screenBelow(node); // { left, top, zoom } — below centre
  const wf = workflowObj.currentSelectedWorkflow;
  const childIds = (wf.edges || [])
    .filter((e: any) => e.source === node.id)
    .map((e: any) => e.target);
  if (!childIds.length) return { ...base, hoverOnly: false, cx: 0, svgW: 0 }; // leaf → stub

  // Where do the existing children sit relative to the node centre?
  const nodeW = findNode(node.id)?.dimensions?.width ?? 240;
  const nodeCx = (node.position?.x ?? 0) + nodeW / 2;
  const byId = new Map((wf.nodes || []).map((n: any) => [n.id, n]));
  const TH = 40;
  let hasLeft = false;
  let hasRight = false;
  for (const cid of childIds) {
    const c: any = byId.get(cid);
    if (!c) continue;
    const cw = findNode(cid)?.dimensions?.width ?? 240;
    const ccx = (c.position?.x ?? 0) + cw / 2;
    if (ccx > nodeCx + TH) hasRight = true;
    else if (ccx < nodeCx - TH) hasLeft = true;
  }
  // Both sides busy (a fanned-out node like the trigger) → the open space is the V-gap
  // straight below centre, so drop the `+` there with a clean vertical stub (any side
  // offset just lands it back on top of an existing branch edge). One side / a lone
  // centred child → a small nudge to the free side, off the existing edge.
  let sign: number;
  let off: number;
  if (hasLeft && hasRight) {
    sign = 1;
    off = 0; // centred in the V-gap — straight-down stub
  } else {
    sign = hasRight ? -1 : 1;
    off = 40; // a little difference, not the old wide swing
  }
  return {
    ...base,
    hoverOnly: true,
    left: base.left + off * base.zoom * sign,
    cx: -off * sign, // node's LOCAL x relative to the `+` (connector start)
    svgW: 2 * off,
  };
};

// Append `+` points: one under EVERY step that can still chain onward (not a
// terminal/output node), so a fan-out branch can be added from any node — but a
// point whose slot is taken (`hoverOnly`) shows only while its node is hovered.
// Excludes the trigger while the Action slot covers it, so there's never a bare `+`
// and a labelled Action card on the same node.
const appendPoints = computed(() => {
  if (readOnly.value) return [];
  const wf = workflowObj.currentSelectedWorkflow;
  const nodes = wf.nodes || [];
  return (
    nodes
      .filter((n: any) => {
        if (nodeMeta(n.data?.node_type)?.ioType === "output") return false; // terminal
        // The trigger's first step is offered via the labelled Action slot instead.
        if (hasTrigger.value && stepCount.value === 0) return false;
        return true;
      })
      .map((n: any) => ({ id: n.id, ...appendPointFor(n) }))
      // Option C: nothing shows at rest — a node's append `+` appears only while that
      // node (or its own `+`) is hovered. Leaves hover-gate too, so at rest the whole
      // canvas is quiet.
      .filter((pt: any) => pt.id === hoveredNodeId.value)
  );
});

// Mid-edge `+` clicked → splice a step onto that edge (A→new→B). Reuses the same
// insert picker the edge action-menu uses.
const onEdgeInsert = (edgeId: string, event: MouseEvent) => {
  const edge = (workflowObj.currentSelectedWorkflow.edges || []).find((e: any) => e.id === edgeId);
  if (edge) openInsertPicker(edge, event);
};

// Frame the graph once nodes have measured dimensions. Runs once per editor mount.
//  • Existing/loaded workflow (Edit, or History → Edit) or a run to inspect:
//    fitView so the WHOLE graph is centered on screen (top-aligning a saved graph
//    left it pushed off the top — the reported "not centering" bug).
//  • Brand-new workflow (create): keep the trigger near the top and only center it
//    horizontally, so the first steps flow DOWN from the top as you build.
let centered = false;
onNodesInitialized(() => {
  if (centered) return;
  const nodes = workflowObj.currentSelectedWorkflow.nodes;
  const trigger = nodes.find((n: any) => n.data?.node_type === "workflow_trigger");
  if (!trigger) return;
  if (workflowObj.isEditWorkflow || workflowObj.testRun.result) {
    nextTick(() => fitView({ padding: 0.2 }));
    centered = true;
    return;
  }
  const nodeW = findNode(trigger.id)?.dimensions?.width;
  const paneW = dimensions.value?.width;
  if (!nodeW || !paneW) return; // dimensions not ready yet — try next init
  const { zoom, y } = viewport.value;
  setViewport({
    x: paneW / 2 - (trigger.position.x + nodeW / 2) * zoom,
    y,
    zoom,
  });
  centered = true;
});

// NOTE: a run result no longer reframes the canvas. That reframe existed for the old
// results DOCK, which shrank the canvas when it opened; the NDV redesign removed the
// dock, so running a Test / Run Step leaves the canvas size unchanged — auto-fitting
// there just yanked the user's view (an unwanted zoom on every run). The view now stays
// exactly where the user left it when a result arrives.

// Publish validation flags incomplete (dummy) nodes → frame just those and thicken
// their border in the node's own type colour (WorkflowNode adds `wf-needs-setup`).
// Clear the flag after a few seconds so it's a transient nudge — the persistent
// "Set up later" badge still marks them afterwards.
let incompleteHighlightTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => workflowObj.incompleteHighlight,
  (ids) => {
    if (incompleteHighlightTimer) clearTimeout(incompleteHighlightTimer);
    if (!ids.length) return;
    nextTick(() => fitView({ nodes: ids, padding: 0.3, duration: 500 }));
    incompleteHighlightTimer = setTimeout(() => {
      workflowObj.incompleteHighlight = [];
      incompleteHighlightTimer = null;
    }, 4500);
  },
);
onBeforeUnmount(() => {
  if (incompleteHighlightTimer) clearTimeout(incompleteHighlightTimer);
});

defineExpose({ vueFlowRef });
</script>

<!-- Node card + handle styling ported from PipelineEditor's `.o2vf_node` rules
     so workflow nodes match pipeline nodes. Unscoped: targets VueFlow's
     internal node wrapper. -->
