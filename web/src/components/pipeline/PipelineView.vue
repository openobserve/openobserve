<template>
    <div class="pipeline-view container">
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
  import { VueFlow, useVueFlow } from "@vue-flow/core";
  import { ref, onMounted, onActivated, watch } from "vue";
import { ControlButton, Controls } from '@vue-flow/controls'
import CustomNode from '@/plugins/pipelines/CustomNode.vue';
/* import the required styles */
import "@vue-flow/core/dist/style.css";
/* import the default theme (optional) */
import "@vue-flow/core/dist/theme-default.css";
import '@vue-flow/controls/dist/style.css'
import useDragAndDrop from '@/plugins/pipelines/useDnD';
const streamImage = getImageURL("images/pipeline/stream.svg");

const functionImage = getImageURL("images/pipeline/function.svg");
const streamOutputImage = getImageURL("images/pipeline/outputStream.svg");
const streamRouteImage = getImageURL("images/pipeline/route.svg");
const conditionImage = getImageURL("images/pipeline/condition.svg");
const queryImage = getImageURL("images/pipeline/query.svg");
  
  export default defineComponent({
    props: {
      pipeline: Object
    },
    components: { VueFlow, CustomNode, Controls,ControlButton,DropzoneBackground },
    setup(props) {
      const {
      pipelineObj,
    } = useDragAndDrop();
      const vueFlowRef = ref(null);
        console.log(props,"props in vue")
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

      onMounted(() => {
        vueFlowRef.value.fitView({ padding: 1});
        console.log(pipelineObj,"pipeline")
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
];
        pipelineObj.currentSelectedPipeline = props.pipeline;

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
  
  <style scoped>
  .pipeline-view {
    width: 300px; /* Adjust the width */
    height: 200px; /* Adjust the height */
    overflow: auto;
  }


  </style>

  
  