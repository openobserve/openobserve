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
  Read-only mini preview of a workflow's graph — rendered inside the list row's
  "view" tooltip, mirroring the pipeline list's PipelineView. Reuses the shared
  WorkflowNode + FlowEdge; interaction is disabled (nodes are pointer-events:none)
  so no hover/delete/add affordances fire and nothing is clickable.
-->
<template>
  <div
    ref="containerRef"
    class="workflow-view-tooltip o2vf_node tw:w-150 tw:h-96 tw:overflow-hidden"
  >
    <VueFlow
      ref="vueFlowRef"
      v-model:nodes="lockedNodes"
      v-model:edges="edges"
      :min-zoom="0.1"
      @nodes-initialized="fit"
    >
      <Background :size="2" :gap="22" pattern-color="#BDBDBD" />
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
          :is-in-view="true"
        />
      </template>
      <template #node-input="{ id, data }">
        <WorkflowNode :id="id" :data="data" />
      </template>
      <template #node-output="{ id, data }">
        <WorkflowNode :id="id" :data="data" />
      </template>
      <template #node-default="{ id, data }">
        <WorkflowNode :id="id" :data="data" />
      </template>
    </VueFlow>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { VueFlow, MarkerType } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import WorkflowNode from "@/plugins/workflows/WorkflowNode.vue";
import FlowEdge from "@/components/flow/FlowEdge.vue";
import { nodeMeta } from "@/plugins/workflows/useWorkflowCanvas";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

const props = defineProps<{ workflow: any }>();

const vueFlowRef = ref<any>(null);
const containerRef = ref<HTMLElement | null>(null);

// VueFlow render template comes from node_type (trigger=input, condition/function
// =default, destination=output), same derivation as the editor's hydrate.
const lockedNodes = computed(() =>
  (props.workflow?.nodes || []).map((node: any) => ({
    ...node,
    type: nodeMeta(node.data?.node_type)?.ioType || node.io_type || "default",
  })),
);

const edges = computed(() =>
  (props.workflow?.edges || []).map((e: any) => ({
    ...e,
    type: "custom",
    markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
    style: { strokeWidth: 2 },
    animated: true,
  })),
);

// Fit the whole graph into the preview. The tooltip animates open, so the
// VueFlow pane grows to its final size AFTER nodes initialize — a one-shot fit
// lands against a transient size and clips the widest node (the trigger). A
// ResizeObserver re-fits on every container resize, so the final fit always runs
// at the real size. Generous padding keeps a margin around the graph.
const fit = () => nextTick(() => vueFlowRef.value?.fitView({ padding: 0.25 }));

let ro: ResizeObserver | null = null;
onMounted(() => {
  ro = new ResizeObserver(() => fit());
  if (containerRef.value) ro.observe(containerRef.value);
});
onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
});
</script>

<style>
/* Read-only: block all node interaction so hover-actions never appear. */
.workflow-view-tooltip .vue-flow__node {
  pointer-events: none;
}

/* Node card frame + per-type colours (mirrors WorkflowCanvas / PipelineEditor),
   scoped to the preview so they don't leak. */
.workflow-view-tooltip .vue-flow__node {
  padding: 8px 16px;
  /* width:auto lets the node size to its content (the label is nowrap) — same as
     the canvas. Without it VueFlow's default width clips wide labels like
     "Alert Trigger" and fitView under-measures the node. */
  width: auto;
  min-height: 44px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.9);
}
.workflow-view-tooltip .vue-flow__node-input {
  border: 1px solid #60a5fa;
  background: rgba(239, 246, 255, 0.8);
  color: var(--color-grey-800);
}
.workflow-view-tooltip .vue-flow__node-default {
  border: 1px solid #f59e0b;
  background: rgba(255, 251, 235, 0.8);
  color: var(--color-grey-800);
}
.workflow-view-tooltip .vue-flow__node-output {
  border: 1px solid rgba(74, 222, 128, 0.6);
  background: rgba(240, 253, 244, 1);
  color: var(--color-grey-800);
}

/* Handle dots — coloured ring + darker inner dot (matches the canvas). */
.workflow-view-tooltip .node_handle_custom {
  width: 16px !important;
  height: 16px !important;
  border: 3px solid rgba(255, 255, 255, 0.9);
  border-radius: 50% !important;
  background: var(--color-grey-500);
}
.workflow-view-tooltip .handle_input { background: #dbeafe !important; }
.workflow-view-tooltip .handle_output { background: #dcfce7 !important; }
.workflow-view-tooltip .handle_default { background: #fef3c7 !important; }

/* Dark mode mirrors the canvas. */
.dark .workflow-view-tooltip .vue-flow__node {
  background: rgba(30, 34, 45, 0.9) !important;
}
.dark .workflow-view-tooltip .vue-flow__node-input {
  background: rgba(30, 58, 138, 0.2) !important;
  border-color: rgba(96, 165, 250, 0.3) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}
.dark .workflow-view-tooltip .vue-flow__node-default {
  background: rgba(120, 53, 15, 0.2) !important;
  border-color: rgba(251, 146, 60, 0.3) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}
.dark .workflow-view-tooltip .vue-flow__node-output {
  background: rgba(20, 83, 45, 0.2) !important;
  border-color: rgba(74, 222, 128, 0.3) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}
</style>
