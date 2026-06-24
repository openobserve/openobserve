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

<script>
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
export default {
  props: {
    nodeTypes: Array,
    hasInputType: Boolean,
  },
  components: { OButton, OTooltip, OIcon },
  setup(props) {
    const { onDragStart, pipelineObj } = useDragAndDrop();
    return { node_types: props.nodeTypes, onDragStart, pipelineObj };
  },
};
</script>

<template>
  <div class="nodes tw:bg-[rgba(226,232,240,0.9)] tw:backdrop-blur-[12px] tw:rounded-[12px] tw:border tw:border-[rgba(226,232,240,0.8)] tw:shadow-[0_4px_16px_rgba(0,0,0,0.08)] tw:py-3 tw:px-2 tw:m-[4px_2px] tw:transition-all tw:duration-300 tw:ease-in-out tw:hover:shadow-[0_6px_20px_rgba(0,0,0,0.12)]">
    <div v-for="node in node_types" :key="node.io_type" class="o2vf_node tw:transition-all tw:rounded-lg tw:mb-3 tw:last:mb-0">
      <OButton
        variant="ghost"
        size="md"
        :class="`o2vf_node_${node.io_type}`"
        class="tw:p-0 btn-fixed-width tw:relative tw:flex tw:items-center tw:w-full tw:hover:translate-x-[3px] tw:hover:bg-[rgba(255,255,255,0.1)] tw:hover:backdrop-blur-[8px] tw:dark:hover:bg-[rgba(255,255,255,0.08)]! tw:dark:hover:backdrop-blur-[12px]!"
        style="width: 170px; justify-content: flex-start"
        :data-test="`pipeline-node-sidebar-${node.subtype}-${node.io_type}-btn`"
        :draggable="true"
        @dragstart="onDragStart($event, node)"
        v-if="node.isSectionHeader == false"
      >
        <OTooltip side="right" :side-offset="10">
          <template #content>
            <div class="tw:px-2.5 tw:py-1.5">
              <div class="tw:font-medium tw:text-[11px] tw:mb-0.5 tw:capitalize">{{ node.label }}</div>
              <div class="tw:text-[10px] tw:leading-[1.3] tw:capitalize">{{ node.tooltip }}</div>
            </div>
          </template>
        </OTooltip>
        <div class="node-content tw:grid tw:items-center tw:w-full tw:py-1 tw:pr-1.5 tw:gap-2" style="grid-template-columns: auto 1fr auto">
          <div class="node-icon-section tw:flex tw:items-center tw:gap-2">
            <img
              v-if="typeof node.icon === 'string' && node.icon.startsWith('img:')"
              :src="node.icon.slice(4)"
              alt=""
              class="node-icon-img tw:w-[1.3em] tw:h-[1.3em] tw:object-contain tw:shrink-0"
            />
            <OIcon v-else size="md" :name="node.icon" />
            <OSeparator vertical class="node-separator tw:h-4" />
          </div>
          <div class="node-label tw:w-[70px] tw:text-left tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-medium tw:text-[12px]">{{ node.label }}</div>
          <div class="drag-dots tw:grid tw:gap-0.5 tw:w-2 tw:h-2" style="grid-template-columns: 1fr 1fr">
            <span class="dot tw:w-0.5 tw:h-0.5 tw:rounded-full tw:transition-all tw:bg-[rgba(107,114,128,0.6)] tw:dark:bg-[rgba(255,255,255,0.5)]!"></span>
            <span class="dot tw:w-0.5 tw:h-0.5 tw:rounded-full tw:transition-all tw:bg-[rgba(107,114,128,0.6)] tw:dark:bg-[rgba(255,255,255,0.5)]!"></span>
            <span class="dot tw:w-0.5 tw:h-0.5 tw:rounded-full tw:transition-all tw:bg-[rgba(107,114,128,0.6)] tw:dark:bg-[rgba(255,255,255,0.5)]!"></span>
            <span class="dot tw:w-0.5 tw:h-0.5 tw:rounded-full tw:transition-all tw:bg-[rgba(107,114,128,0.6)] tw:dark:bg-[rgba(255,255,255,0.5)]!"></span>
          </div>
        </div>
      </OButton>
      <div v-else>
        <div class="tw:mb-1 tw:text-base tw:font-medium">
          <div>{{ node.label }}</div>
          <OSeparator />
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.body--dark .nodes {
  background: rgba(15, 23, 42, 0.95) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4) !important;
}

.body--dark .nodes:hover {
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
}

.drag-handle:hover .dot {
  background: rgba(107, 114, 128, 0.8);
  transform: scale(1.1);
}

.o2vf_node_input {
  border: 1px solid rgba(96, 165, 250, 0.4);
  color: #1e40af;
  border-radius: 8px;
  background: rgba(239, 246, 255, 0.9);
  transition: all 0.3s ease;
}

.o2vf_node_input:hover {
  background: rgba(239, 246, 255, 1);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
  border-color: rgba(96, 165, 250, 0.6);
}

.o2vf_node_output {
  border: 1px solid rgba(74, 222, 128, 0.4);
  color: var(--o2-primary-background);
  border-radius: 8px;
  background: rgba(240, 253, 244, 0.9);
  box-shadow: 0 2px 8px rgba(34, 197, 94, 0.1);
  transition: all 0.3s ease;
  padding: 8px 16px;
}

.o2vf_node_output:hover {
  background: rgba(240, 253, 244, 1);
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.2);
  border-color: rgba(74, 222, 128, 0.6);
}

.o2vf_node_default {
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #92400e;
  border-radius: 8px;
  background: rgba(255, 251, 235, 0.9);
  box-shadow: 0 2px 8px rgba(217, 119, 6, 0.1);
  transition: all 0.3s ease;
}

.o2vf_node_default:hover {
  background: rgba(255, 251, 235, 1);
  box-shadow: 0 4px 12px rgba(217, 119, 6, 0.2);
  border-color: rgba(245, 158, 11, 0.6);
}

.body--dark .o2vf_node_default {
  background: rgba(120, 53, 15, 0.2) !important;
  border: 1px solid rgba(251, 146, 60, 0.3) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.body--dark .o2vf_node_default:hover {
  background: rgba(120, 53, 15, 0.3) !important;
  border-color: rgba(251, 146, 60, 0.5) !important;
  box-shadow: 0 6px 16px rgba(245, 158, 11, 0.2) !important;
}

.body--dark .o2vf_node_input {
  background: rgba(30, 58, 138, 0.2) !important;
  border: 1px solid rgba(96, 165, 250, 0.3) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.body--dark .o2vf_node_input:hover {
  background: rgba(30, 58, 138, 0.3) !important;
  border-color: rgba(96, 165, 250, 0.5) !important;
  box-shadow: 0 6px 16px rgba(59, 130, 246, 0.2) !important;
}

.body--dark .o2vf_node_output {
  background: rgba(20, 83, 45, 0.2) !important;
  border: 1px solid rgba(74, 222, 128, 0.3) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.body--dark .o2vf_node_output:hover {
  background: rgba(20, 83, 45, 0.3) !important;
  border-color: rgba(74, 222, 128, 0.5) !important;
  box-shadow: 0 6px 16px rgba(34, 197, 94, 0.2) !important;
}

.body--dark .drag-handle:hover .dot {
  background: rgba(255, 255, 255, 0.7) !important;
}
</style>
