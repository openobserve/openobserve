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
    <div
      data-test="pipeline-flow-unsaved-changes-warning-text"
      v-show="pipelineObj.dirtyFlag"
      class="text-status-warning-text border-status-warning-text rounded-default mr-3 flex items-center border px-2"
    >
      <OIcon name="info" class="mr-1" size="sm" />
      Unsaved changes detected. Click "Save" to preserve your updates.
    </div>

    <!-- Edge deletion help notification -->
    <div
      v-if="showEdgeHelpNotification"
      class="edge-help-notification bg-surface-base text-text-body rounded-default border-border-default absolute top-5 left-1/2 z-1000 flex -translate-x-1/2 items-center border px-4 py-2.5 text-sm shadow-[0_4px_20px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)]"
    >
      <OIcon name="info" class="mr-1" size="sm" />
      Press Backspace/Delete to remove the edge
    </div>
  </div>

  <VueFlow
    @drop="onDrop"
    ref="vueFlowRef"
    v-model:nodes="pipelineObj.currentSelectedPipeline.nodes"
    v-model:edges="pipelineObj.currentSelectedPipeline.edges"
    :connect-on-click="false"
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
        :is-in-view="false"
      />
    </template>
    <!-- Drag-over highlight: same role as OFile's drop target, so it shares
           --color-file-drag-bg (theme-aware; the old raw blue had no dark step).
           Stays a binding because the fill is driven by isDragOver at runtime. -->
    <DropzoneBackground
      :style="{
        backgroundColor: isDragOver ? 'var(--color-file-drag-bg)' : 'transparent',
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
    <Controls :showInteractive="false" class="controls-grp" position="top-left">
      <!-- Node-rail toggle. `#top` puts it ABOVE zoom-in / zoom-out / fit-view
             (the default slot would append it below them). The glyph is a bare
             32x32 currentColor <svg>, exactly like Vue Flow's own control icons
             — an OIcon here rendered at a different weight and box, so it read
             as a foreign control in the stack. `.vue-flow__controls-button svg`
             does the sizing, so no width/height of our own. -->
      <template #top>
        <ControlButton
          data-test="pipeline-node-sidebar-collapse-btn"
          :title="
            pipelineObj.showNodePalette ? t('pipeline.collapseNodes') : t('pipeline.openNodes')
          "
          @click="pipelineObj.showNodePalette = !pipelineObj.showNodePalette"
        >
          <!-- » chevrons; mirrored in place to « once the rail is open. -->
          <svg viewBox="0 0 32 32">
            <path
              :transform="pipelineObj.showNodePalette ? 'translate(32,0) scale(-1,1)' : undefined"
              d="M2 5.5 5.5 2 19.5 16 5.5 30 2 26.5 12.5 16ZM14.5 5.5 18 2 32 16 18 30 14.5 26.5 25 16Z"
            />
          </svg>
        </ControlButton>
      </template>
    </Controls>
  </VueFlow>
  <!-- Empty-canvas start node. It is an OVERLAY, not a Vue Flow node: a real
         node would land in `currentSelectedPipeline.nodes` and show up in save,
         validation and the dirty flag. It borrows `vue-flow__node-input` so it
         is chrome-for-chrome the same card a Stream/Query source renders as —
         picking a source swaps the icon and label, and the frame never moves.
         Sits near the TOP, not the middle: the graph runs downwards, so the
         first node belongs where a source lives, leaving the canvas below it
         free for the steps that follow. -->

  <div v-if="isCanvasEmpty" class="absolute top-32 left-1/2 z-10 -translate-x-1/2">
    <!-- Scaled by the LIVE viewport zoom. Real nodes are drawn inside
           `.vue-flow__viewport`, which carries the canvas transform, so at the
           default 0.8 zoom this overlay — a sibling of that transform, not a
           child — rendered 1.25x larger than the node it stands in for.
           Matching the zoom keeps it the size of the node it becomes.

           `relative!` / `origin-top!` undo two things `.vue-flow__node` sets for
           nodes VUE FLOW positions: `position:absolute` (which took this card
           out of flow, collapsing the centring wrapper to zero width) and
           `transform-origin:0 0` (which scaled it toward the top-left). This
           card is positioned by us, so it needs neither. -->
    <div
      data-test="pipeline-flow-start-node"
      class="vue-flow__node vue-flow__node-input relative! w-max origin-top! scale-[var(--ghost-zoom,1)] cursor-pointer! whitespace-nowrap"
      :style="{ '--ghost-zoom': viewport.zoom }"
      @click="openSourcePicker($event)"
    >
      <FlowNodeCard icon="add" io-type="input" :has-input="false" :has-output="false">
        <template #body>{{ t("pipeline.chooseSource") }}</template>
      </FlowNodeCard>
    </div>
  </div>
  <!-- Add UI elements or buttons to interact with the methods -->
</template>

<script lang="ts">
import { ref, onMounted, watch, computed } from "vue";
import type { Ref } from "vue";
import { VueFlow, useVueFlow } from "@vue-flow/core";
import type { VueFlowStore } from "@vue-flow/core";
import { Controls, ControlButton } from "@vue-flow/controls";
// import vueFlowConfig from "./vueFlowConfig";
// Shared, token-driven canvas styling — the SAME file the workflow canvas
// imports, so the two canvases cannot drift. It owns the vue-flow node chrome
// and the input/default/output role colours (including their dark variants);
// PipelineEditor.vue used to carry a private copy of those rules, which is why
// the two editors' nodes rendered differently in dark mode.
import "@/components/flow/flow-canvas.css";
import CustomNode from "./CustomNode.vue";
import FlowEdge from "@/components/flow/FlowEdge.vue";
import FlowNodeCard from "@/components/flow/FlowNodeCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import DropzoneBackground from "./DropzoneBackground.vue";
import useDragAndDrop from "./useDnD";
import { useI18n } from "vue-i18n";

/* import the required styles */

import { useStore } from "vuex";

export default {
  components: {
    VueFlow,
    CustomNode,
    OIcon,
    DropzoneBackground,
    Controls,
    ControlButton,
    FlowEdge,
    FlowNodeCard,
  },
  setup() {
    const { t } = useI18n();
    const {
      onDragStart,
      onDragOver,
      onDrop,
      onDragLeave,
      onNodeChange,
      onNodesChange,
      onEdgesChange,
      onConnect,
      validateConnection,
      openSourcePicker,
      pipelineObj,
    } = useDragAndDrop();
    const store = useStore();

    // Mirror the hook's drag-over state (pipelineObj.isDragOver) into a local
    // ref so the dropzone highlight and "Drop here" hint react to dragging.
    const isDragOver = ref(pipelineObj.isDragOver);
    watch(
      () => pipelineObj.isDragOver,
      (value) => {
        isDragOver.value = value;
      },
    );
    const vueFlowRef: Ref<VueFlowStore | null> = ref(null);
    const isCanvasEmpty = computed(() => pipelineObj.currentSelectedPipeline.nodes.length === 0);
    const showEdgeHelpNotification = ref(false);
    let notificationTimeout: ReturnType<typeof setTimeout> | null = null;

    // `viewport` is the live canvas transform; the empty-canvas start node
    // reads its zoom so it renders at the same scale as real nodes.
    const { setViewport, viewport } = useVueFlow();

    // Handle edge click events
    const onEdgeClick = () => {
      // Clear any existing timeout
      if (notificationTimeout) {
        clearTimeout(notificationTimeout);
        notificationTimeout = null;
      }

      // Always show notification on edge click (even if already visible)
      showEdgeHelpNotification.value = true;

      // Auto-hide notification after 3.5 seconds
      notificationTimeout = setTimeout(() => {
        showEdgeHelpNotification.value = false;
        notificationTimeout = null;
      }, 3500);
    };

    watch(
      () => pipelineObj.currentSelectedPipeline,
      () => {
        if (pipelineObj.dirtyFlag) {
          pipelineObj.dirtyFlag = false;
        }
      },
    );
    onMounted(async () => {
      setTimeout(() => {
        if (vueFlowRef.value && pipelineObj.currentSelectedPipeline.nodes.length > 4) {
          vueFlowRef.value.fitView({ padding: 0.1 });
        } else if (vueFlowRef.value) {
          vueFlowRef.value.fitView({ padding: 1 });
        }
      }, 100);
    });

    function resetTransform() {
      setViewport({ x: 0, y: 0, zoom: 1 });
    }
    const zoomIn = () => {
      if (vueFlowRef.value) vueFlowRef.value.zoomIn();
    };

    const zoomOut = () => {
      if (vueFlowRef.value) vueFlowRef.value.zoomOut();
    };

    return {
      pipelineObj,
      onDragStart,
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
      openSourcePicker,
      viewport,
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
