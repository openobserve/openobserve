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
    :default-viewport="{ zoom: 0.9 }"
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

    <Controls :show-interactive="false" class="controls-grp" position="top-left" />
  </VueFlow>

  <div
    v-if="isCanvasEmpty"
    data-test="workflow-flow-empty-text"
    class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] text-[1.3em] text-center pointer-events-none z-10"
  >
    {{ t("workflow.canvasEmpty") }}
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
import { Controls } from "@vue-flow/controls";
import { useI18n } from "vue-i18n";
import WorkflowNode from "./WorkflowNode.vue";
import FlowEdge from "@/components/flow/FlowEdge.vue";
import useWorkflowCanvas from "./useWorkflowCanvas";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";

const { t } = useI18n();
const { workflowObj, onNodeChange, onNodesChange, onEdgesChange, onConnect, onDrop, onDragOver } =
  useWorkflowCanvas();

const { onNodesInitialized, setViewport, viewport, dimensions, findNode } = useVueFlow();

const vueFlowRef = ref<any>(null);
// Read-only inspection canvas (the Runs view) — disables node drag/connect and,
// via WorkflowNode, the hover add/delete + click-to-edit. Run overlays stay.
const readOnly = computed(() => workflowObj.readOnly);
const isCanvasEmpty = computed(() => workflowObj.currentSelectedWorkflow.nodes.length === 0);

// Center the trigger horizontally once nodes have measured dimensions — keep
// its Y (near the top) so the steps flow down. Runs once per editor mount.
let centered = false;
onNodesInitialized(() => {
  if (centered) return;
  const nodes = workflowObj.currentSelectedWorkflow.nodes;
  const trigger = nodes.find((n: any) => n.data?.node_type === "workflow_trigger");
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
