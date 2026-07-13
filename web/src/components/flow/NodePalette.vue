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
  Shared node palette for the flow editors (Pipelines + Workflows). Docked as a
  fixed left column with a "Nodes" header and Source/Transform/Destination
  sections. Data + interaction come from props so each editor drives it with its
  own registry — ONE component, so the two palettes can never drift apart.

    items       — node list: { label, icon, io_type, subtype, tooltip?, isSectionHeader }
                  icon: an OIcon name, or an "img:<url>" string for an image glyph.
    onDragStart — (event, item) => void   drag-to-add (both editors)
    onItemClick — (item) => void          click-to-add (workflows); omit for drag-only
    title       — header label (defaults to "Nodes")
    testPrefix  — data-test prefix, so each editor keeps its existing selectors
-->
<script>
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
export default {
  props: {
    items: { type: Array, default: () => [] },
    title: { type: String, default: "" },
    testPrefix: { type: String, default: "flow-node-palette" },
    onDragStart: { type: Function, default: undefined },
    onItemClick: { type: Function, default: undefined },
  },
  components: { OButton, OTooltip, OIcon, OSeparator },
  setup() {
    const { t } = useI18n();
    return { t };
  },
};
</script>

<template>
  <div class="np-sidebar tw:shrink-0 tw:w-[200px] tw:pr-3" :data-test="testPrefix">
    <div
      class="np-header tw:mb-2 tw:mx-2 tw:text-base tw:font-semibold tw:px-1 tw:pb-2 tw:text-center tw:tracking-wide"
      :data-test="`${testPrefix}-title`"
    >
      {{ title || t("pipeline.nodes") }}
    </div>

    <div class="tw:flex tw:mt-2">
      <div class="np-body np-panel">
        <template v-for="(node, idx) in items" :key="`${node.subtype}-${node.io_type}-${idx}`">
        <!-- section label (Source / Transform / Destination). Same mb-3 outer
             gap as the node cards (matching the original NodeSidebar). -->
        <div v-if="node.isSectionHeader" class="tw:rounded-lg tw:mb-3">
          <div class="np-section tw:text-base tw:font-medium">{{ node.label }}</div>
        </div>

        <!-- draggable / clickable node card -->
        <div v-else class="o2vf_node tw:transition-all tw:rounded-lg tw:mb-3 tw:last:mb-0">
          <OButton
            variant="ghost"
            size="md"
            :class="[`o2vf_node_${node.io_type}`, onItemClick ? 'tw:cursor-pointer' : '']"
            class="tw:p-0 btn-fixed-width tw:relative tw:flex tw:items-center tw:w-full tw:hover:translate-x-[3px] tw:hover:bg-[rgba(255,255,255,0.1)] tw:hover:backdrop-blur-[8px] tw:dark:hover:bg-[rgba(255,255,255,0.08)]! tw:dark:hover:backdrop-blur-[12px]!"
            style="width: 170px; justify-content: flex-start"
            :data-test="`${testPrefix}-${node.subtype}-${node.io_type}-btn`"
            :draggable="!!onDragStart"
            @dragstart="onDragStart && onDragStart($event, node)"
            @click="onItemClick && onItemClick(node)"
          >
            <OTooltip side="right" :side-offset="10">
              <template #content>
                <div class="tw:px-2.5 tw:py-1.5">
                  <div class="tw:font-medium tw:text-[11px] tw:mb-0.5 tw:capitalize">{{ node.label }}</div>
                  <div v-if="node.tooltip" class="tw:text-[10px] tw:leading-[1.3] tw:capitalize">{{ node.tooltip }}</div>
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
                <span class="dot tw:w-0.5 tw:h-0.5 tw:rounded-full tw:transition-all"></span>
                <span class="dot tw:w-0.5 tw:h-0.5 tw:rounded-full tw:transition-all"></span>
                <span class="dot tw:w-0.5 tw:h-0.5 tw:rounded-full tw:transition-all"></span>
                <span class="dot tw:w-0.5 tw:h-0.5 tw:rounded-full tw:transition-all"></span>
              </div>
            </div>
          </OButton>
        </div>
      </template>
      </div>
    </div>
  </div>
</template>

<style>
/* ── Header: "Nodes" title with a purple underline spanning the column
      (matches the pipeline editor's purple accent bar) ───────────────────── */
.np-header {
  color: #1f2937;
  border-bottom: 2px solid #8b5cf6;
}
.body--dark .np-header {
  color: rgba(255, 255, 255, 0.95);
  border-bottom-color: #a855f7;
}

/* ── Frosted-glass panel wrapping the node cards (the original NodeSidebar
      look, shared by both palettes) ──────────────────────────────────────── */
.np-panel {
  background: rgba(226, 232, 240, 0.9);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  padding: 12px 8px;
  margin: 4px 2px;
  transition: all 0.3s ease-in-out;
}
.np-panel:hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
}
.body--dark .np-panel {
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
}
.body--dark .np-panel:hover {
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

/* Drag-affordance dots. Coloured via `.body--dark` (the app's theme class) — NOT
   Tailwind's `dark:` variant, which follows the OS `prefers-color-scheme` and so
   turned the dots white in the app's light mode. */
.dot {
  background: rgba(107, 114, 128, 0.6);
}
.body--dark .dot {
  background: rgba(255, 255, 255, 0.5);
}
.drag-handle:hover .dot {
  background: rgba(107, 114, 128, 0.8);
  transform: scale(1.1);
}

/* ── Node-role card colours (single source for both palettes) ────────────── */
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
  color: #181a1b;
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
