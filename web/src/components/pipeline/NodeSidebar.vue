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
  <div class="nodes bg-surface-panel backdrop-blur-[12px] rounded-default border border-border-default shadow-[0_4px_16px_rgba(0,0,0,0.08)] py-3 px-2 m-[4px_2px] transition-all duration-300 ease-in-out hover:shadow-[0_6px_20px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
    <div v-for="node in node_types" :key="node.io_type" class="o2vf_node transition-all rounded-default mb-3 last:mb-0">
      <OButton
        variant="ghost"
        size="md"
        :class="`o2vf_node_${node.io_type}`"
        class="p-0 btn-fixed-width relative flex items-center w-full hover:translate-x-[3px] hover:bg-interactive-hover-bg hover:backdrop-blur-[8px] dark:hover:backdrop-blur-[12px]! justify-start"
        style="width: 170px"
        :data-test="`pipeline-node-sidebar-${node.subtype}-${node.io_type}-btn`"
        :draggable="true"
        @dragstart="onDragStart($event, node)"
        v-if="node.isSectionHeader == false"
      >
        <OTooltip side="right" :side-offset="10">
          <template #content>
            <div class="px-2.5 py-1.5">
              <div class="font-medium text-2xs mb-0.5 capitalize">{{ node.label }}</div>
              <div class="text-3xs leading-[1.3] capitalize">{{ node.tooltip }}</div>
            </div>
          </template>
        </OTooltip>
        <div class="node-content grid items-center w-full py-1 pr-1.5 gap-2" style="grid-template-columns: auto 1fr auto">
          <div class="node-icon-section flex items-center gap-2">
            <img
              v-if="typeof node.icon === 'string' && node.icon.startsWith('img:')"
              :src="node.icon.slice(4)"
              alt=""
              class="node-icon-img w-[1.3em] h-[1.3em] object-contain shrink-0"
            />
            <OIcon v-else size="md" :name="node.icon" />
            <OSeparator vertical class="node-separator h-4" />
          </div>
          <div class="node-label w-17.5 text-left overflow-hidden text-ellipsis whitespace-nowrap font-medium text-xs">{{ node.label }}</div>
          <div class="drag-dots grid gap-0.5 w-2 h-2" style="grid-template-columns: 1fr 1fr">
            <span class="dot w-0.5 h-0.5 rounded-full transition-all bg-icon-color"></span>
            <span class="dot w-0.5 h-0.5 rounded-full transition-all bg-icon-color"></span>
            <span class="dot w-0.5 h-0.5 rounded-full transition-all bg-icon-color"></span>
            <span class="dot w-0.5 h-0.5 rounded-full transition-all bg-icon-color"></span>
          </div>
        </div>
      </OButton>
      <div v-else>
        <div class="mb-1 text-base font-medium">
          <div>{{ node.label }}</div>
          <OSeparator />
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* keep(lib-override): o2vf_node_* are the shared vue-flow node-type classes — the same
   convention lives in PipelineEditor.vue (global) and is asserted by NodeSidebar.spec.ts,
   so the styling must ride these class names rather than colocated utilities.
   .drag-handle:hover .dot is a cross-file global: .drag-handle / .dot are rendered by
   other pipeline components (drag-handle has external consumers), so it must stay unscoped. */
.drag-handle:hover .dot {
  background: var(--color-icon-color);
  transform: scale(1.1);
}

.o2vf_node_input {
  border: 1px solid var(--color-status-info-text);
  color: var(--color-status-info-text);
  border-radius: 0.5rem;
  background: var(--color-status-info-bg);
  transition: all 0.3s ease;
}

.o2vf_node_input:hover {
  background: var(--color-status-info-bg);
  box-shadow: 0 0.25rem 0.75rem color-mix(in srgb, var(--color-status-info-text) 20%, transparent);
  border-color: var(--color-status-info-text);
}

.o2vf_node_output {
  border: 1px solid var(--color-status-positive);
  color: var(--color-status-success-text);
  border-radius: 0.5rem;
  background: var(--color-status-success-bg);
  box-shadow: 0 0.125rem 0.5rem color-mix(in srgb, var(--color-status-positive) 10%, transparent);
  transition: all 0.3s ease;
  padding: 0.5rem 1rem;
}

.o2vf_node_output:hover {
  background: var(--color-status-success-bg);
  box-shadow: 0 0.25rem 0.75rem color-mix(in srgb, var(--color-status-positive) 20%, transparent);
  border-color: var(--color-status-positive);
}

.o2vf_node_default {
  border: 1px solid var(--color-status-warning-text);
  color: var(--color-status-warning-text);
  border-radius: 0.5rem;
  background: var(--color-status-warning-bg);
  box-shadow: 0 0.125rem 0.5rem color-mix(in srgb, var(--color-status-warning-text) 10%, transparent);
  transition: all 0.3s ease;
}

.o2vf_node_default:hover {
  background: var(--color-status-warning-bg);
  box-shadow: 0 0.25rem 0.75rem color-mix(in srgb, var(--color-status-warning-text) 20%, transparent);
  border-color: var(--color-status-warning-text);
}
</style>
