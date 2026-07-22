<template>
  <div class="pipeline-view-tooltip o2-scroll-container w-125 h-75 overflow-auto rounded-default">
    <VueFlow
      ref="vueFlowRef"
      v-model:nodes="lockedNodes"
      v-model:edges="edges"
      :options="{ readOnly: true }"
      :min-zoom="0.1"
      @nodes-initialized="onNodesReady"
    >
      <DropzoneBackground
        :style="{
          backgroundColor: 'var(--color-surface-panel)',
          transition: 'background-color 0.2s ease',
        }"
      >
      </DropzoneBackground>
      <template #edge-custom="customEdgeProps">
        <FlowEdge
          :id="customEdgeProps.id"
          :source-x="customEdgeProps.sourceX"
          :source-y="customEdgeProps.sourceY"
          :target-x="customEdgeProps.targetX"
          :target-y="customEdgeProps.targetY"
          :source-position="customEdgeProps.sourcePosition"
          :target-position="customEdgeProps.targetPosition"
          :data="customEdgeProps.data"
          :marker-end="customEdgeProps.markerEnd"
          :style="customEdgeProps.style"
          :is-in-view="true"
        />
      </template>
      <template #node-input="{ id, data }">
        <CustomNode :id="id" :data="data" io_type="input" />
      </template>
      <template #node-output="{ id, data }">
        <CustomNode :id="id" :data="data" io_type="output" />
      </template>
      <template #node-default="{ id, data }">
        <CustomNode :id="id" :data="data" io_type="default" />
      </template>
    </VueFlow>
  </div>
</template>

<script lang="ts">
import { getImageURL } from "@/utils/zincutils";
import DropzoneBackground from "@/plugins/pipelines/DropzoneBackground.vue";
import { defineComponent, computed, watch, type PropType } from "vue";
import { VueFlow, type Node, type Edge } from "@vue-flow/core";
import { ref, onMounted, nextTick } from "vue";
import CustomNode from "@/plugins/pipelines/CustomNode.vue";
import FlowEdge from "@/components/flow/FlowEdge.vue";
/* import the required styles */
import "@vue-flow/core/dist/style.css";
import "@vue-flow/controls/dist/style.css";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
const functionImage = getImageURL("images/pipeline/transform_function.png");
const streamImage = getImageURL("images/pipeline/input_stream.png");
const streamOutputImage = getImageURL("images/pipeline/output_stream.png");
const externalOutputImage = getImageURL("images/pipeline/output_remote.png");
const conditionImage = getImageURL("images/pipeline/transform_condition.png");
const queryImage = getImageURL("images/pipeline/input_query.png");

interface PipelineNode extends Node {
  io_type?: string;
}

type PipelineEdge = Edge;

interface Pipeline {
  name: string;
  description: string;
  source: { source_type: string };
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  org: string;
}

export default defineComponent({
  props: {
    pipeline: { type: Object as PropType<Pipeline>, required: true },
  },
  components: { VueFlow, CustomNode, DropzoneBackground, FlowEdge },
  setup(props) {
    const { pipelineObj } = useDragAndDrop();
    const vueFlowRef = ref<InstanceType<typeof VueFlow> | null>(null);
    // Computed properties for nodes and edges
    const lockedNodes = computed(() => {
      return props.pipeline.nodes.map((node: PipelineNode) => ({
        ...node,
        type: node.io_type,
      }));
    });

    const edges = computed(() => {
      return props.pipeline.edges || [];
    });

    const onNodesReady = () => {
      nextTick(() => {
        if (vueFlowRef.value) {
          vueFlowRef.value.fitView({ padding: 0.1 });
        }
      });
    };

    onMounted(async () => {
      pipelineObj.nodeTypes = [
        {
          label: "Source",
          icon: "input",
          isSectionHeader: true,
        },
        {
          label: "Stream",
          subtype: "stream",
          io_type: "input",
          icon: "img:" + streamImage,
          tooltip: "Source: Stream Node",
          isSectionHeader: false,
        },
        {
          label: "Query",
          subtype: "query",
          io_type: "input",
          icon: "img:" + queryImage,
          tooltip: "Source: Query Node",
          isSectionHeader: false,
        },
        {
          label: "Transform",
          icon: "processing",
          isSectionHeader: true,
        },
        {
          label: "Function",
          subtype: "function",
          io_type: "default",
          icon: "img:" + functionImage,
          tooltip: "Function Node",
          isSectionHeader: false,
        },
        {
          label: "Conditions",
          subtype: "condition",
          io_type: "default",
          icon: "img:" + conditionImage,
          tooltip: "Condition Node",
          isSectionHeader: false,
        },
        {
          label: "Destination",
          icon: "input",
          isSectionHeader: true,
        },
        {
          label: "Stream",
          subtype: "stream",
          io_type: "output",
          icon: "img:" + streamOutputImage,
          tooltip: "Destination: Stream Node",
          isSectionHeader: false,
        },
        {
          label: "Remote",
          subtype: "remote_stream",
          io_type: "output",
          icon: "img:" + externalOutputImage,
          tooltip: "Destination: External Destination Node",
          isSectionHeader: false,
        },
      ];
    });

    // Watch for pipeline prop changes to update error information
    watch(
      () => props.pipeline,
      (newPipeline) => {
        if (newPipeline) {
          pipelineObj.currentSelectedPipeline = newPipeline;
        }
      },
      { immediate: true },
    );

    // Return the computed properties
    return {
      lockedNodes,
      edges,
      vueFlowRef,
      pipelineObj,
      streamImage,
      onNodesReady,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:vue-flow): read-only tooltip preview recolors vue-flow node/handle DOM rendered by child components (CustomNode / vue-flow wrappers) — parent-context compound selectors and ::before pseudo-elements, not expressible as utilities on this template */
.pipeline-view-tooltip :deep(.vue-flow__node-input .btn-fixed-width) {
  background-color: var(--color-status-info-bg) !important;
  border-color: var(--color-status-info-text) !important;
  color: var(--color-text-body) !important;
  padding: 8px 12px !important;
}

.pipeline-view-tooltip :deep(.vue-flow__node-output .btn-fixed-width) {
  background-color: var(--color-status-success-bg) !important;
  border-color: var(--color-status-positive) !important;
  color: var(--color-text-body) !important;
  padding: 8px 12px !important;
}

.pipeline-view-tooltip :deep(.vue-flow__node-default .btn-fixed-width) {
  background-color: var(--color-status-warning-bg) !important;
  border-color: var(--color-status-warning-text) !important;
  color: var(--color-text-body) !important;
  padding: 8px 12px !important;
}

/* Handle colors — ::before pseudo-elements, must stay in CSS */
.pipeline-view-tooltip :deep(.handle_input) {
  background: var(--color-status-info-bg) !important;
}

.pipeline-view-tooltip :deep(.handle_input::before) {
  background: var(--color-status-info-text) !important;
}

.pipeline-view-tooltip :deep(.handle_output) {
  background: var(--color-status-success-bg) !important;
}

.pipeline-view-tooltip :deep(.handle_output::before) {
  background: var(--color-status-positive) !important;
}

.pipeline-view-tooltip :deep(.handle_default) {
  background: var(--color-status-warning-bg) !important;
}

.pipeline-view-tooltip :deep(.handle_default::before) {
  background: var(--color-status-warning-text) !important;
}

/* Hide action buttons in tooltip */
.pipeline-view-tooltip :deep(.node-action-buttons) {
  display: none !important;
}
</style>
