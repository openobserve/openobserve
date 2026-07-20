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
  <div class="np-sidebar shrink-0 w-50 pr-3" :data-test="testPrefix">
    <div
      class="np-header mb-2 mx-2 text-base font-semibold px-1 pb-2 text-center tracking-wide"
      :data-test="`${testPrefix}-title`"
    >
      {{ title || t("pipeline.nodes") }}
    </div>

    <div class="flex mt-2">
      <div class="np-body np-panel">
        <template v-for="(node, idx) in items" :key="`${node.subtype}-${node.io_type}-${idx}`">
        <!-- section label (Source / Transform / Destination). Same mb-3 outer
             gap as the node cards (matching the original NodeSidebar). -->
        <div v-if="node.isSectionHeader" class="rounded-lg mb-3">
          <div class="np-section text-base font-medium">{{ node.label }}</div>
        </div>

        <!-- draggable / clickable node card -->
        <div v-else class="o2vf_node transition-all rounded-lg mb-3 last:mb-0">
          <OButton
            variant="ghost"
            size="md"
            :class="[`o2vf_node_${node.io_type}`, onItemClick ? 'cursor-pointer' : '']"
            class="p-0 btn-fixed-width relative flex items-center w-[10.625rem] justify-start hover:translate-x-[0.1875rem] hover:bg-white/10 hover:backdrop-blur-[0.5rem] dark:hover:bg-white/8! dark:hover:backdrop-blur-[0.75rem]!"
            :data-test="`${testPrefix}-${node.subtype}-${node.io_type}-btn`"
            :draggable="!!onDragStart"
            @dragstart="onDragStart && onDragStart($event, node)"
            @click="onItemClick && onItemClick(node)"
          >
            <OTooltip side="right" :side-offset="10">
              <template #content>
                <div class="px-2.5 py-1.5">
                  <div class="font-medium text-[0.6875rem] mb-0.5 capitalize">{{ node.label }}</div>
                  <div v-if="node.tooltip" class="text-[0.625rem] leading-[1.3] capitalize">{{ node.tooltip }}</div>
                </div>
              </template>
            </OTooltip>
            <div class="node-content grid grid-cols-[auto_1fr_auto] items-center w-full py-1 pr-1.5 gap-2">
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
              <div class="node-label w-[4.375rem] text-left overflow-hidden text-ellipsis whitespace-nowrap font-medium text-xs">{{ node.label }}</div>
              <div class="drag-dots grid grid-cols-2 gap-0.5 w-2 h-2">
                <span class="dot w-0.5 h-0.5 rounded-full transition-all"></span>
                <span class="dot w-0.5 h-0.5 rounded-full transition-all"></span>
                <span class="dot w-0.5 h-0.5 rounded-full transition-all"></span>
                <span class="dot w-0.5 h-0.5 rounded-full transition-all"></span>
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
/* Palette styling lives in its own token-driven stylesheet (see the note at the
   top of node-palette.css for why it cannot be scoped). Kept out of the SFC so
   this component carries no style block of its own — same arrangement as
   flow-canvas.css for the canvas. */
@import "@/components/flow/node-palette.css";
</style>
