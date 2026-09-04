<template>
  <div class="pipeline-view-tooltip o2-scroll-container rounded-default h-75 w-125 overflow-auto">
    <VueFlow
      ref="vueFlowRef"
      v-model:nodes="lockedNodes"
      v-model:edges="edges"
      :options="{ readOnly: true }"
      :min-zoom="0.1"
      @nodes-initialized="onNodesReady"
    >
      <DropzoneBackground class="bg-surface-panel [transition:background-color_0.2s_ease]">
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
        <CustomNode :id="id" :data="data" io_type="input" read-only />
      </template>
      <template #node-output="{ id, data }">
        <CustomNode :id="id" :data="data" io_type="output" read-only />
      </template>
      <template #node-default="{ id, data }">
        <CustomNode :id="id" :data="data" io_type="default" read-only />
      </template>
    </VueFlow>
  </div>
</template>

<script lang="ts">
import { getImageURL } from "@/utils/zincutils";
import { useI18nTyped, type I18nText } from "@/types/i18n";
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
  description: I18nText;
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
    const { t } = useI18nTyped();
    const { pipelineObj } = useDragAndDrop(t);
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
          label: t("pipeline.sourceNode"),
          icon: "input",
          isSectionHeader: true,
        },
        {
          label: t("pipeline.streamNode"),
          subtype: "stream",
          io_type: "input",
          icon: "img:" + streamImage,
          tooltip: t("pipeline.sourceStreamTooltip"),
          isSectionHeader: false,
        },
        {
          label: t("pipeline.queryNode"),
          subtype: "query",
          io_type: "input",
          icon: "img:" + queryImage,
          tooltip: t("pipeline.sourceQueryTooltip"),
          isSectionHeader: false,
        },
        {
          label: t("pipeline.transformNode"),
          icon: "processing",
          isSectionHeader: true,
        },
        {
          label: t("pipeline.functionNode"),
          subtype: "function",
          io_type: "default",
          icon: "img:" + functionImage,
          tooltip: t("pipeline.functionTooltip"),
          isSectionHeader: false,
        },
        {
          label: t("pipeline.conditionsNode"),
          subtype: "condition",
          io_type: "default",
          icon: "img:" + conditionImage,
          tooltip: t("pipeline.conditionTooltip"),
          isSectionHeader: false,
        },
        {
          label: t("pipeline.destinationNode"),
          icon: "input",
          isSectionHeader: true,
        },
        {
          label: t("pipeline.streamNode"),
          subtype: "stream",
          io_type: "output",
          icon: "img:" + streamOutputImage,
          tooltip: t("pipeline.destinationStreamTooltip"),
          isSectionHeader: false,
        },
        {
          label: t("pipeline.remoteNode"),
          subtype: "remote_stream",
          io_type: "output",
          icon: "img:" + externalOutputImage,
          tooltip: t("pipeline.destinationExternalTooltip"),
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
  padding: 0.5rem 0.75rem !important;
}

.pipeline-view-tooltip :deep(.vue-flow__node-output .btn-fixed-width) {
  background-color: var(--color-status-success-bg) !important;
  border-color: var(--color-status-positive) !important;
  color: var(--color-text-body) !important;
  padding: 0.5rem 0.75rem !important;
}

.pipeline-view-tooltip :deep(.vue-flow__node-default .btn-fixed-width) {
  background-color: var(--color-status-warning-bg) !important;
  border-color: var(--color-status-warning-text) !important;
  color: var(--color-text-body) !important;
  padding: 0.5rem 0.75rem !important;
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
