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

  No sidebar / drag-drop wiring (FD2): nodes are added via the hover-`+`
  StepMenu (a later slice). This slice renders the VueFlow surface with the
  colour-coded WorkflowNode, WorkflowEdge, a dotted grid background, zoom
  controls and an empty-state hint.
-->
<template>
  <VueFlow
    ref="vueFlowRef"
    v-model:nodes="workflowObj.currentSelectedWorkflow.nodes"
    v-model:edges="workflowObj.currentSelectedWorkflow.edges"
    class="workflow-flow o2vf_node"
    :default-viewport="{ zoom: 0.9 }"
    :min-zoom="0.2"
    :max-zoom="4"
    @node-change="onNodeChange"
    @nodes-change="onNodesChange"
    @edges-change="onEdgesChange"
    @connect="onConnect"
  >
    <Background :size="2" :gap="22" pattern-color="#BDBDBD" />

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
      <WorkflowEdge
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

    <Controls :show-interactive="false" class="controls-grp" position="top-left" />
  </VueFlow>

  <div
    v-if="isCanvasEmpty"
    data-test="workflow-flow-empty-text"
    class="tw:absolute tw:top-1/2 tw:left-1/2 tw:-translate-x-1/2 tw:-translate-y-1/2 tw:text-[#888] tw:text-[1.3em] tw:text-center tw:pointer-events-none tw:z-10"
  >
    {{ t("workflow.canvasEmpty") }}
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { VueFlow, useVueFlow } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { useI18n } from "vue-i18n";
import WorkflowNode from "./WorkflowNode.vue";
import WorkflowEdge from "./WorkflowEdge.vue";
import useWorkflowCanvas from "./useWorkflowCanvas";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

const { t } = useI18n();
const { workflowObj, onNodeChange, onNodesChange, onEdgesChange, onConnect } =
  useWorkflowCanvas();

const { onNodesInitialized, setViewport, viewport, dimensions, findNode } =
  useVueFlow();

const vueFlowRef = ref<any>(null);
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
<style>
.o2vf_node .vue-flow__node {
  padding: 8px 16px;
  width: auto;
  min-height: 44px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  cursor: grab;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  transition: background 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
}
.o2vf_node .vue-flow__node:hover {
  box-shadow: 0 8px 24px rgba(20, 24, 33, 0.14);
}
.o2vf_node .vue-flow__node:active,
.o2vf_node .vue-flow__node.dragging {
  cursor: grabbing;
  transition: none !important;
}

/* trigger (input) — amber */
.o2vf_node .vue-flow__node-input {
  border: 1px solid #f59e0b;
  color: #1f2937;
  border-radius: 12px;
  background: rgba(255, 251, 235, 0.85);
  box-shadow: 0 4px 12px rgba(217, 119, 6, 0.1);
}
/* logic (default) — blue/indigo */
.o2vf_node .vue-flow__node-default {
  border: 1px solid #4f6bed;
  color: #1f2937;
  border-radius: 12px;
  background: rgba(238, 241, 254, 0.85);
  box-shadow: 0 4px 12px rgba(79, 107, 237, 0.1);
}
/* action (output) — green */
.o2vf_node .vue-flow__node-output {
  border: 1px solid #1f9d63;
  color: #1f2937;
  border-radius: 12px;
  background: rgba(230, 246, 238, 0.9);
  box-shadow: 0 2px 8px rgba(31, 157, 99, 0.1);
}

.o2vf_node .vue-flow__node.selected {
  box-shadow: 0 0 0 3px rgba(90, 97, 204, 0.22);
}

/* handles (ported from pipeline) */
.node_handle_custom {
  width: 14px !important;
  height: 14px !important;
  border: 3px solid rgba(255, 255, 255, 0.9);
  border-radius: 50% !important;
  background: #6b7280;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.handle_input { background: #dbeafe !important; }
.handle_default { background: #eef1fe !important; }
.handle_output { background: #dcfce7 !important; }

/* ── Dark mode ─────────────────────────────────────────────────────────────
   Mirrors PipelineEditor's `.dark .vue-flow__node-*` overrides, but keeps our
   category palette (trigger=amber, logic=blue, action=green). The `.dark` class
   sits on an app-level ancestor (same as pipeline), so these apply globally. */
.dark .o2vf_node .vue-flow__node {
  background: rgba(30, 34, 45, 0.9) !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}
.dark .o2vf_node .vue-flow__node:hover {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
/* trigger (input) — amber */
.dark .o2vf_node .vue-flow__node-input {
  background: rgba(120, 53, 15, 0.28) !important;
  border-color: rgba(245, 158, 11, 0.45) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}
/* logic (default) — blue/indigo */
.dark .o2vf_node .vue-flow__node-default {
  background: rgba(30, 41, 120, 0.3) !important;
  border-color: rgba(129, 140, 248, 0.45) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}
/* action (output) — green */
.dark .o2vf_node .vue-flow__node-output {
  background: rgba(20, 83, 45, 0.3) !important;
  border-color: rgba(52, 211, 153, 0.45) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}
/* handle ring blends with the dark canvas instead of a bright white ring */
.dark .node_handle_custom {
  border-color: rgba(30, 34, 45, 0.9);
}
</style>
