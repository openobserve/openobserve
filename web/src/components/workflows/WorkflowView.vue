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
  <div ref="containerRef" class="workflow-view-tooltip o2vf_node w-150 h-96 overflow-hidden">
    <VueFlow
      ref="vueFlowRef"
      v-model:nodes="lockedNodes"
      v-model:edges="edges"
      :min-zoom="0.1"
      @nodes-initialized="fit"
    >
      <!-- Dot colour is token-driven via CSS (flow-canvas.css); the library
           applies `pattern-color` as an SVG attribute, where var() would not
           resolve. -->
      <Background :size="2" :gap="22" />
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
// Shared, token-driven node/handle styling — this preview container carries
// `o2vf_node`, so the same stylesheet applies here as on the live canvas.
import "@/components/flow/flow-canvas.css";
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

<style scoped>
/* keep(lib-override:vue-flow): read-only preview — block all node interaction so
   hover-actions never appear. `.vue-flow__node` is VueFlow's own DOM rendered by
   a child, hence :deep(); the container class is this component's own root. */
.workflow-view-tooltip :deep(.vue-flow__node) {
  pointer-events: none;
}
</style>
