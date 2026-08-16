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
    @pane-click="closeEdgeMenu"
    @connect="onConnect"
    @drop="onDrop"
    @dragover="onDragOver"
  >
    <!-- Dot colour is token-driven via CSS (flow-canvas.css); the
         library applies `pattern-color` as an SVG attribute, where var() would
         not resolve. -->
    <Background :size="2" :gap="22" />

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

  <!-- Edge action menu — opens AT THE CLICK POINT on the clicked edge (no travel to
       a top hint bar). Insert splices a step onto the edge (A→B becomes A→new→B,
       rewired); Delete removes the connection (Backspace/Delete still works too).
       Positioned via a CSS var (like the ghost start node's zoom) so no hardcoded
       px. Never shown on the read-only Runs canvas. -->
  <div
    v-if="edgeMenu.show && !readOnly"
    ref="edgeMenuRef"
    data-test="workflow-edge-menu"
    class="bg-surface-base border-border-default rounded-default fixed top-[var(--edge-menu-y,0)] left-[var(--edge-menu-x,0)] z-1000 flex min-w-[10rem] flex-col overflow-hidden border py-1 text-sm shadow-lg dark:shadow-lg"
    :style="{ '--edge-menu-x': edgeMenu.x + 'px', '--edge-menu-y': edgeMenu.y + 'px' }"
  >
    <OButton
      variant="ghost"
      size="sm"
      class="w-full justify-start!"
      data-test="workflows-edge-insert"
      icon-left="add-circle-outline"
      @click="onInsertStep"
    >
      {{ t("workflow.canvas.insertStep") }}
    </OButton>
    <OButton
      variant="ghost-destructive"
      size="sm"
      class="w-full justify-start!"
      data-test="workflows-edge-delete"
      icon-left="delete"
      @click="onDeleteEdge"
    >
      {{ t("workflow.canvas.deleteEdge") }}
    </OButton>
  </div>

  <!-- Empty-canvas start node (replaces the old "add a trigger" hint text). An
       OVERLAY, not a Vue Flow node: a real node would land in
       `currentSelectedWorkflow.nodes` and show up in save, validation and the
       dirty flag. It borrows `vue-flow__node-input` so it is chrome-for-chrome
       the same card a trigger renders as — picking one swaps the icon and
       label, and the frame never moves. Read-only Runs canvases show nothing.

       The wrapper carries `o2vf_node` because every shared node rule is scoped
       under it, and on THIS canvas that class sits on the VueFlow element the
       placeholder is a sibling of — without it the card gets no chrome at all
       (the pipeline canvas has it on the container, so it inherits it there). -->
  <div
    v-if="needsTrigger && !readOnly"
    class="o2vf_node absolute top-32 left-1/2 z-10 -translate-x-1/2"
  >
    <!-- Scaled by the LIVE viewport zoom: real nodes are drawn inside
         `.vue-flow__viewport`, which carries the canvas transform, so an
         unscaled overlay renders larger than the node it stands in for.

         `relative!` / `origin-top!` undo two things `.vue-flow__node` sets for
         nodes VUE FLOW positions: `position:absolute` (which took this card out
         of flow, collapsing the centring wrapper to zero width) and
         `transform-origin:0 0` (which scaled it toward the top-left). -->
    <div
      data-test="workflow-flow-start-node"
      class="vue-flow__node vue-flow__node-input relative! w-max origin-top! scale-[var(--ghost-zoom,1)] cursor-pointer! whitespace-nowrap"
      :style="{ '--ghost-zoom': viewport.zoom }"
      @click="openTriggerPicker($event)"
    >
      <FlowNodeCard icon="add" io-type="input" :has-input="false" :has-output="false">
        <template #body>{{ t("workflow.chooseTrigger") }}</template>
      </FlowNodeCard>
    </div>
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
import FlowEdge from "@/components/flow/FlowEdge.vue";
import FlowNodeCard from "@/components/flow/FlowNodeCard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import useWorkflowCanvas, {
  workflowHistory,
  pushWorkflowHistory,
  undoWorkflow,
  redoWorkflow,
  tidyWorkflowLayout,
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

// Edges have no inline buttons; clicking one opens a small action menu AT THE
// CLICK POINT with Insert + Delete (no travel to a top hint bar). `edge` is the
// clicked edge; x/y are viewport coords for the fixed-positioned menu. Skipped on
// the read-only Runs canvas, where edges can't be edited.
const edgeMenuRef = ref<HTMLElement | null>(null);
const edgeMenu = ref<{ show: boolean; x: number; y: number; edge: any }>({
  show: false,
  x: 0,
  y: 0,
  edge: null,
});
const onEdgeClick = (payload: any) => {
  if (readOnly.value) return;
  const edge = payload?.edge ?? payload ?? null;
  if (!edge) return;
  const evt = payload?.event as MouseEvent | undefined;
  // Nudge a few px off the cursor so the menu doesn't open under the pointer.
  edgeMenu.value = {
    show: true,
    x: (evt?.clientX ?? 0) + 4,
    y: (evt?.clientY ?? 0) + 4,
    edge,
  };
};
const closeEdgeMenu = () => {
  edgeMenu.value = { ...edgeMenu.value, show: false, edge: null };
};

// Insert a step onto the clicked edge (T7) — opens the step picker in "insert"
// mode at the menu position; picking a type splices A→new→B (addNodeOnEdge).
const onInsertStep = () => {
  const edge = edgeMenu.value.edge;
  if (!edge) return;
  openInsertPicker(edge, { clientX: edgeMenu.value.x, clientY: edgeMenu.value.y } as MouseEvent);
  closeEdgeMenu();
};
// Delete the clicked connection (single undo step).
const onDeleteEdge = () => {
  const edge = edgeMenu.value.edge;
  if (!edge) return;
  pushWorkflowHistory();
  removeEdges([edge.id]);
  closeEdgeMenu();
};
// Dismiss the menu on any click outside it (canvas pane-click already closes it;
// this covers clicks on nodes / toolbar / elsewhere).
const onDocMouseDown = (e: MouseEvent) => {
  if (!edgeMenu.value.show) return;
  if (edgeMenuRef.value && edgeMenuRef.value.contains(e.target as Node)) return;
  closeEdgeMenu();
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
  // Escape closes the edge menu regardless of focus.
  if (event.key === "Escape" && edgeMenu.value.show) {
    closeEdgeMenu();
    return;
  }
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
  closeEdgeMenu();
};

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("mousedown", onDocMouseDown);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("mousedown", onDocMouseDown);
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

// Center the trigger horizontally once nodes have measured dimensions — keep
// its Y (near the top) so the steps flow down. Runs once per editor mount.
// EXCEPTION: if a Test result is already present, the canvas has just remounted
// into the reduced area above the results dock — frame ALL nodes instead so the
// user still sees the whole graph.
let centered = false;
onNodesInitialized(() => {
  if (centered) return;
  const nodes = workflowObj.currentSelectedWorkflow.nodes;
  const trigger = nodes.find((n: any) => n.data?.node_type === "workflow_trigger");
  if (!trigger) return;
  if (workflowObj.testRun.result) {
    fitView({ padding: 0.2 });
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

defineExpose({ vueFlowRef });
</script>

<!-- Node card + handle styling ported from PipelineEditor's `.o2vf_node` rules
     so workflow nodes match pipeline nodes. Unscoped: targets VueFlow's
     internal node wrapper. -->
