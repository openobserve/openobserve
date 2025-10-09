<template>
    <div class="pipeline-view-tooltip container">
      <VueFlow 
      ref="vueFlowRef"
        v-model:nodes="lockedNodes"
        v-model:edges="edges"
        :options="{ readOnly: true }"
        :default-viewport="{ zoom: 0 }"

       >
       <DropzoneBackground
        :style="{
          backgroundColor:  '#e7f3ff',
          transition: 'background-color 0.2s ease',
        }"
      >

      </DropzoneBackground>
      <template #edge-custom="customEdgeProps">
      <CustomEdge
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
        :is-in-view = true
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
  
  <script>
  import { getImageURL } from "@/utils/zincutils";
import DropzoneBackground from "@/plugins/pipelines/DropzoneBackground.vue";
  import { defineComponent, computed, watch } from 'vue';
  import { ControlButton, Controls } from '@vue-flow/controls'
  import { VueFlow } from "@vue-flow/core";
  import { ref, onMounted } from "vue";
import CustomNode from '@/plugins/pipelines/CustomNode.vue';
import CustomEdge from "@/plugins/pipelines/CustomEdge.vue";
/* import the required styles */
import "@vue-flow/core/dist/style.css";
import '@vue-flow/controls/dist/style.css';
import useDragAndDrop from '@/plugins/pipelines/useDnD';
const functionImage = getImageURL("images/pipeline/transform_function.png");
const streamImage = getImageURL("images/pipeline/input_stream.png");
const streamOutputImage = getImageURL("images/pipeline/output_stream.png");
const externalOutputImage = getImageURL("images/pipeline/output_remote.png");
const conditionImage = getImageURL("images/pipeline/transform_condition.png");
const queryImage = getImageURL("images/pipeline/input_query.png");

  
  export default defineComponent({
    props: {
      pipeline: Object
    },
    components: { VueFlow, CustomNode, DropzoneBackground, CustomEdge, ControlButton, Controls },
    setup(props) {
      const {
      pipelineObj,
    } = useDragAndDrop();
      const vueFlowRef = ref(null);
      // Computed properties for nodes and edges
      const lockedNodes = computed(() => {
        return props.pipeline.nodes.map(node => ({
          ...node,
          type: node.io_type
        }));
      });

      const edges = computed(() => {
        return props.pipeline.edges || [];
      });
  

      onMounted(async () => {
      if (vueFlowRef.value) {
        vueFlowRef.value.fitView({ padding: 0.1});
      }

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

        setTimeout(() => {
          if(vueFlowRef.value)
          vueFlowRef.value.fitView({ padding: 0.1});
        }, 100);

      })

      // Watch for pipeline prop changes to update error information
      watch(() => props.pipeline, (newPipeline) => {
        if (newPipeline) {
          pipelineObj.currentSelectedPipeline = newPipeline;
        }
      }, { immediate: true });

      // Return the computed properties
      return {
        lockedNodes,
        edges,
        vueFlowRef,
        pipelineObj,
        streamImage,
      };

    }
  });
  </script>
  
  <style lang="scss">
  /* Simple tooltip styling - let CustomNode handle everything else */
  .pipeline-view-tooltip {
    width: 500px;
    height: 300px; 
    overflow: auto;
    
    /* Node background colors */
    .vue-flow__node-input .btn-fixed-width {
      background-color: rgba(219, 234, 254, 0.8) !important;
      border-color: #3b82f6 !important;
      color: #000000 !important;
      padding: 8px 12px !important;
    }

    .vue-flow__node-output .btn-fixed-width {
      background-color: rgba(220, 252, 231, 0.8) !important;
      border-color: #22c55e !important;
      color: #000000 !important;
      padding: 8px 12px !important;
    }

    .vue-flow__node-default .btn-fixed-width {
      background-color: rgba(255, 237, 168, 0.8) !important;
      border-color: #f59e0b !important;
      color: #000000 !important;
      padding: 8px 12px !important;
    }
    
    /* Handle colors for tooltip context */
    .handle_input {
      background: #dbeafe !important;
      
      &::before {
        background: #3b82f6 !important;
      }
    }

    .handle_output {
      background: #dcfce7 !important;
      
      &::before {
        background: #22c55e !important;
      }
    }

    .handle_default {
      background: #fef3c7 !important;
      
      &::before {
        background: #f59e0b !important;
      }
    }
    
    /* Hide action buttons in tooltip */
    .node-action-buttons {
      display: none !important;
    }
  }

  </style>

  
  