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
    @node-change="onNodeChange"
    @nodes-change="onNodesChange"
    @edges-change="onEdgesChange"
    @node-drag-start="onNodeDragStart"
    @node-drag-stop="onNodeDragStop"
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
        :insertable="!readOnly"
        @insert="onEdgeInsert(edgeProps.id, $event)"
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
    class="absolute top-[var(--wf-oy)] left-[var(--wf-ox)] z-10 flex origin-top -translate-x-1/2 scale-[var(--wf-oz)] flex-col items-center"
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

  <!-- Append `+` — every step that can still chain onward gets a `+` to add the next
       step. A leaf shows it straight below (with a connector stub); a node that
       already has children shows it on the free side to fan out another branch,
       instead of the old click-the-source-dot. Flow-anchored so it tracks the node. -->
  <div
    v-for="pt in appendPoints"
    :key="pt.id"
    data-test="workflow-flow-append-add"
    class="absolute top-[var(--wf-oy)] left-[var(--wf-ox)] z-10 flex origin-top -translate-x-1/2 scale-[var(--wf-oz)] flex-col items-center"
    :style="{ '--wf-ox': pt.left + 'px', '--wf-oy': pt.top + 'px', '--wf-oz': pt.zoom }"
  >
    <!-- Straight stub for a leaf / centred `+`; a curved connector edge from the
         node to a fan-out `+` that sits off to the side. -->
    <span v-if="pt.line" class="border-border-strong h-5 border-l-2"></span>
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

// The append `+` for ONE node. A leaf (no children) gets the plain straight-down
// `+` below its centre. A node that ALREADY has children gets a `+` on the FREE
// side, so it never lands on the existing downward edge — and clicking it fans out
// another branch: children lean right → `+` on the LEFT, lean left → RIGHT, sit on
// both sides → CENTRED below (that gap is free). `line` = draw the little connector
// stub (only when the `+` is straight below).
const appendPointFor = (node: any) => {
  const base = screenBelow(node); // { left, top, zoom } — below centre
  const wf = workflowObj.currentSelectedWorkflow;
  const childIds = (wf.edges || [])
    .filter((e: any) => e.source === node.id)
    .map((e: any) => e.target);
  if (!childIds.length) return { ...base, line: true, cx: 0 }; // leaf → straight stub `+`

  const nodeW = findNode(node.id)?.dimensions?.width ?? 240;
  const nodeCx = (node.position?.x ?? 0) + nodeW / 2;
  const byId = new Map((wf.nodes || []).map((n: any) => [n.id, n]));
  const TH = 40; // flow-px: within this of the node centre counts as "centred"
  let left = 0;
  let right = 0;
  let center = 0;
  for (const cid of childIds) {
    const c: any = byId.get(cid);
    if (!c) continue;
    const cw = findNode(cid)?.dimensions?.width ?? 240;
    const ccx = (c.position?.x ?? 0) + cw / 2;
    if (ccx > nodeCx + TH) right++;
    else if (ccx < nodeCx - TH) left++;
    else center++;
  }
  // Pick the free side; a lone centred child (or a crowded node) defaults to right.
  let side: "left" | "right" | "center" = "right";
  if (right > 0 && left === 0) side = "left";
  else if (left > 0 && right === 0) side = "right";
  else if (left > 0 && right > 0 && center === 0) side = "center";
  if (side === "center") return { ...base, line: true, cx: 0 };
  const sign = side === "right" ? 1 : -1;
  const off = nodeW / 2 + 28;
  // `cx` is the node's LOCAL x relative to the `+` (the div is scaled by zoom, so
  // it's the unscaled offset) — the connector curve starts there. `svgW` sizes the
  // (centred) connector SVG so the curve isn't clipped.
  return {
    ...base,
    left: base.left + off * base.zoom * sign,
    line: false,
    cx: -off * sign,
    svgW: 2 * off,
  };
};

// Append `+` points: one under (or beside) EVERY step that can still chain onward
// (not a terminal/output node), so a fan-out branch can be added from any node, not
// just leaves. Excludes the trigger while the Action slot covers it, so there's
// never a bare `+` and a labelled Action card on the same node.
const appendPoints = computed(() => {
  if (readOnly.value) return [];
  const wf = workflowObj.currentSelectedWorkflow;
  const nodes = wf.nodes || [];
  return nodes
    .filter((n: any) => {
      if (nodeMeta(n.data?.node_type)?.ioType === "output") return false; // terminal
      // The trigger's first step is offered via the labelled Action slot instead.
      if (hasTrigger.value && stepCount.value === 0) return false;
      return true;
    })
    .map((n: any) => ({ id: n.id, ...appendPointFor(n) }));
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

// Whenever a run produces a result (the dock opens / re-runs), frame all nodes so
// the reduced canvas still shows the whole graph. Guarded on !readOnly so the Runs
// inspection canvas isn't reframed on every history load.
watch(
  () => !!workflowObj.testRun.result,
  (has) => {
    if (has && !readOnly.value) nextTick(() => fitView({ padding: 0.2 }));
  },
);

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
