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
        <ControlButton
          data-test="workflow-palette-collapse-btn"
          :title="workflowObj.showNodePalette ? t('pipeline.collapseNodes') : t('pipeline.openNodes')"
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
      </template>
    </Controls>
  </VueFlow>

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
    v-if="isCanvasEmpty && !readOnly"
    class="o2vf_node absolute top-32 left-1/2 -translate-x-1/2 z-10"
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
      class="vue-flow__node vue-flow__node-input relative! origin-top! w-max whitespace-nowrap scale-[var(--ghost-zoom,1)] cursor-pointer!"
      :style="{ '--ghost-zoom': viewport.zoom }"
      @click="openTriggerPicker($event)"
    >
      <FlowNodeCard
        icon="add"
        io-type="input"
        :has-input="false"
        :has-output="false"
      >
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
import { ref, computed } from "vue";
import { VueFlow, useVueFlow } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls, ControlButton } from "@vue-flow/controls";
import { useI18n } from "vue-i18n";
import WorkflowNode from "./WorkflowNode.vue";
import FlowEdge from "@/components/flow/FlowEdge.vue";
import FlowNodeCard from "@/components/flow/FlowNodeCard.vue";
import useWorkflowCanvas from "./useWorkflowCanvas";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

const { t } = useI18n();
const {
  workflowObj,
  onNodeChange,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onDrop,
  onDragOver,
  openTriggerPicker,
} = useWorkflowCanvas();

const { onNodesInitialized, setViewport, viewport, dimensions, findNode } =
  useVueFlow();

const vueFlowRef = ref<any>(null);
// Read-only inspection canvas (the Runs view) — disables node drag/connect and,
// via WorkflowNode, the hover add/delete + click-to-edit. Run overlays stay.
const readOnly = computed(() => workflowObj.readOnly);
const isCanvasEmpty = computed(
  () => workflowObj.currentSelectedWorkflow.nodes.length === 0,
);

// Center the trigger horizontally once nodes have measured dimensions — keep
// its Y (near the top) so the steps flow down. Runs once per editor mount.
let centered = false;
onNodesInitialized(() => {
  if (centered) return;
  const nodes = workflowObj.currentSelectedWorkflow.nodes;
  const trigger = nodes.find(
    (n: any) => n.data?.node_type === "workflow_trigger",
  );
  if (!trigger) return;
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

defineExpose({ vueFlowRef });
</script>

<!-- Node card + handle styling ported from PipelineEditor's `.o2vf_node` rules
     so workflow nodes match pipeline nodes. Unscoped: targets VueFlow's
     internal node wrapper. -->
