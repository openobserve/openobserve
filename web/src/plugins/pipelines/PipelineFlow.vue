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

<!-- src/components/PipelineFlow.vue -->
<template>
  <div data-test="pipeline-flow-container" class="flex items-center justify-between">
     <div data-test="pipeline-flow-unsaved-changes-warning-text" v-show="pipelineObj.dirtyFlag" class="text-status-warning-text border border-status-warning-text rounded-default flex items-center px-2 mr-3">
      <OIcon name="info" class="mr-1 " size="sm" />
     Unsaved changes detected. Click "Save" to preserve your updates.
   </div>

   <!-- Edge deletion help notification -->
   <div v-if="showEdgeHelpNotification" class="edge-help-notification absolute top-5 left-1/2 -translate-x-1/2 z-[1000] bg-surface-base text-text-body py-2.5 px-4 rounded-default text-sm shadow-[0_4px_20px_rgba(0,0,0,0.15)] border border-border-default flex items-center dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
     <OIcon name="info" class="mr-1" size="sm" />
     Press Backspace/Delete to remove the edge
   </div>

 </div>

    <VueFlow
    @drop="onDrop"
    ref="vueFlowRef"
      v-model:nodes="pipelineObj.currentSelectedPipeline.nodes"
      v-model:edges="pipelineObj.currentSelectedPipeline.edges"
      @node-change="onNodeChange"
      @nodes-change="onNodesChange"
      @edges-change="onEdgesChange"
      @edge-click="onEdgeClick"
      @connect="onConnect"
      @dragover="onDragOver"
      :default-viewport="{ zoom: 0.8 }"
      :min-zoom="0.2"
      :max-zoom="4"
      @dragleave="onDragLeave"
      class="basic-flow"

    >

    <!-- <template #edge-button="buttonEdgeProps">
      <EdgeWithButton
        :id="buttonEdgeProps.id"
        :source-x="buttonEdgeProps.sourceX"
        :source-y="buttonEdgeProps.sourceY"
        :target-x="buttonEdgeProps.targetX"
        :target-y="buttonEdgeProps.targetY"
        :source-position="buttonEdgeProps.sourcePosition"
        :target-position="buttonEdgeProps.targetPosition"
        :marker-end="buttonEdgeProps.markerEnd"
        :style="buttonEdgeProps.style"
      />
    </template> -->
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
        :is-in-view = false
      />
    </template>
      <!-- Drag-over highlight: same role as OFile's drop target, so it shares
           --color-file-drag-bg (theme-aware; the old raw blue had no dark step).
           Stays a binding because the fill is driven by isDragOver at runtime. -->
      <DropzoneBackground
        :style="{
          backgroundColor: isDragOver
            ? 'var(--color-file-drag-bg)'
            : 'transparent',
          transition: 'background-color 0.2s ease',
        }"
      >
        <p v-if="isDragOver">Drop here</p>
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
      <Controls
      :showInteractive=false

      class="controls-grp"
        position="top-left">
    </Controls>
    </VueFlow>
    <div v-if="isCanvasEmpty" data-test="pipeline-flow-empty-text" class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-text-muted text-[1.5em] text-center pointer-events-none z-10">
      {{ t('pipeline.dragDropNodesHere') }}
    </div>
    <!-- Add UI elements or buttons to interact with the methods -->
</template>

<script>
import { ref, onMounted, onActivated, watch, computed, nextTick } from "vue";
import { VueFlow, useVueFlow } from "@vue-flow/core";
import { ControlButton, Controls } from '@vue-flow/controls'
// import vueFlowConfig from "./vueFlowConfig";
import CustomNode from "./CustomNode.vue";
import CustomEdge from "./CustomEdge.vue";
import DropzoneBackground from "./DropzoneBackground.vue";
import useDragAndDrop from "./useDnD";
import EdgeWithButton from "./EdgeWithButton.vue";
import { useI18n } from "vue-i18n";

/* import the required styles */

import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
const { onInit } = useVueFlow();

export default {
  components: { VueFlow, CustomNode, DropzoneBackground, Controls,ControlButton,EdgeWithButton,CustomEdge
   },
  setup() {
    const { t } = useI18n();
    const {
      onDragOver,
      onDrop,
      onDragLeave,
      isDragOver,
      onNodeChange,
      onNodesChange,
      onEdgesChange,
      onConnect,
      validateConnection,
      pipelineObj,
    } = useDragAndDrop();
    const store = useStore();

    const vueFlowRef = ref(null);
    const isCanvasEmpty = computed(() => pipelineObj.currentSelectedPipeline.nodes.length === 0);
    const showEdgeHelpNotification = ref(false);
    let notificationTimeout = null;

    const { setViewport, getSelectedEdges, addSelectedEdges, removeSelectedEdges, removeEdges } = useVueFlow()

    // Handle edge click events
    const onEdgeClick = (event) => {

      // Clear any existing timeout
      if (notificationTimeout) {
        clearTimeout(notificationTimeout)
        notificationTimeout = null
      }

      // Always show notification on edge click (even if already visible)
      showEdgeHelpNotification.value = true

      // Auto-hide notification after 3.5 seconds
      notificationTimeout = setTimeout(() => {
        showEdgeHelpNotification.value = false
        notificationTimeout = null
      }, 3500)
    }




    watch(() => pipelineObj.currentSelectedPipeline, (newVal, oldVal) => {
          if(pipelineObj.dirtyFlag){
            pipelineObj.dirtyFlag = false;
          }
        });
    onMounted(async () => {
        setTimeout(() => {
          if (vueFlowRef.value && pipelineObj.currentSelectedPipeline.nodes.length > 4) {
            vueFlowRef.value.fitView({ padding: 0.1});
          }
          else if(vueFlowRef.value){
            vueFlowRef.value.fitView({ padding: 1});
          }
        }, 100);
      });


function resetTransform() {
  setViewport({ x: 0, y: 0, zoom: 1 })
}
    const zoomIn = () => {
      vueFlowRef.value.zoomIn();
    };

    const zoomOut = () => {
      vueFlowRef.value.zoomOut();
    };

    return {
      pipelineObj,
      onDragOver,
      onDrop,
      onDragLeave,
      isDragOver,
      onNodeChange,
      onNodesChange,
      onEdgesChange,
      onConnect,
      validateConnection,
      onEdgeClick,
      showEdgeHelpNotification,
      zoomIn,
      zoomOut,
      vueFlowRef,
      resetTransform,
      isCanvasEmpty,
      store,
      setViewport,
      t,
    };
  },
};
</script>

<style scoped>
/* keep(keyframes): entry animation for the edge-deletion help toast; the animation reference must live in this scoped block (not a Tailwind utility) so Vue's scoped keyframe-name hashing resolves it */
.edge-help-notification {
  animation: pipeline-flow-slide-down 0.3s ease-out;
}

@keyframes pipeline-flow-slide-down {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-0.625rem);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
</style>
