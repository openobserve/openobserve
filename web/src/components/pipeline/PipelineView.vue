<template>
    <div class="pipeline-view-tooltip container">
      <VueFlow 
      ref="vueFlowRef"
        v-model:nodes="lockedNodes"
        v-model:edges="pipelineObj.currentSelectedPipeline.edges"
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
  import { defineComponent, computed, onBeforeMount } from 'vue';
  import { VueFlow } from "@vue-flow/core";
  import { ref, onMounted, onActivated, watch } from "vue";
import { ControlButton, Controls } from '@vue-flow/controls'
import CustomNode from '@/plugins/pipelines/CustomNode.vue';
import CustomEdge from "@/plugins/pipelines/CustomEdge.vue";
/* import the required styles */
import "@vue-flow/core/dist/style.css";
import '@vue-flow/controls/dist/style.css'
import useDragAndDrop from '@/plugins/pipelines/useDnD';
const streamImage = getImageURL("images/pipeline/stream.svg");

const functionImage = getImageURL("images/pipeline/function.svg");
const streamOutputImage = getImageURL("images/pipeline/outputStream.svg");
const externalOutputImage = getImageURL("images/pipeline/externalOutput.svg");

const streamRouteImage = getImageURL("images/pipeline/route.svg");
const conditionImage = getImageURL("images/pipeline/condition.svg");
const queryImage = getImageURL("images/pipeline/query.svg");

  
  export default defineComponent({
    props: {
      pipeline: Object
    },
    components: { VueFlow, CustomNode, Controls,ControlButton,DropzoneBackground ,CustomEdge},
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
        pipelineObj.currentSelectedPipeline = props.pipeline;

        setTimeout(() => {
          if(vueFlowRef.value)
          vueFlowRef.value.fitView({ padding: 0.1});
        }, 100);

      })
  
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
  
  <style >
  .pipeline-view-tooltip {
    width: 500px; /* Adjust the width */
    height: 300px; /* Adjust the height */
    overflow: auto;
  }

 
.o2vf_node {
  width: auto;

  .vue-flow__node {
    padding: 8px 16px;
    width: auto;
    min-height: 44px;
    transition: all 0.3s ease;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    cursor: grab;
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(10px);
    
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    }
    
    &:active {
      cursor: grabbing;
    }
  }

  .o2vf_node_input,
  .vue-flow__node-input {
    border: 1px solid #60a5fa;
    border-left: 4px solid #3b82f6;
    color: #1f2937;
    border-radius: 12px;
    background: rgba(239, 246, 255, 0.8);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
    transition: all 0.3s ease;
    cursor: grab;
    min-height: 36px;
    padding: 8px 16px;
    
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(59, 130, 246, 0.2);
      border-color: #3b82f6;
      background: rgba(239, 246, 255, 0.95);
    }
    
    &:active {
      cursor: grabbing;
    }
  }

  .o2vf_node_output,
  .vue-flow__node-output {
    border: 1px solid #4ade80;
    border-left: 4px solid #22c55e;
    color: #1f2937;
    border-radius: 12px;
    background: rgba(240, 253, 244, 0.8);
    box-shadow: 0 4px 12px rgba(34, 197, 94, 0.1);
    transition: all 0.3s ease;
    cursor: grab;
    min-height: 36px;
    padding: 8px 16px;
    
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(34, 197, 94, 0.2);
      border-color: #22c55e;
      background: rgba(240, 253, 244, 0.95);
    }
    
    &:active {
      cursor: grabbing;
    }
  }

  .o2vf_node_default,
  .vue-flow__node-default {
    border: 1px solid #6b7280;
    border-left: 4px solid #374151;
    color: #1f2937;
    border-radius: 12px;
    background: rgba(249, 250, 251, 0.8);
    box-shadow: 0 4px 12px rgba(55, 65, 81, 0.1);
    transition: all 0.3s ease;
    cursor: grab;
    min-height: 36px;
    padding: 8px 16px;
    
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(55, 65, 81, 0.2);
      border-color: #374151;
      background: rgba(249, 250, 251, 0.95);
    }
    
    &:active {
      cursor: grabbing;
    }
  }
}


  </style>

  
  