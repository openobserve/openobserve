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
  fixed left rail of Source/Transform/Destination sections. Data + interaction
  come from props so each editor drives it with its own registry — ONE component,
  so the two palettes can never drift apart.

  The rail is HEADERLESS by design: the editors label it from the outside (the
  collapse toggle that opens it), so an in-rail title only repeated what the
  surrounding chrome already says. The former `title` prop went with it.

  Width is `w-44`, NOT the shared `w-rail` (--spacing-rail) the folder rails use.
  That token is sized for long user-supplied folder names; these labels are one
  word ("Stream", "Query"), so w-rail left the cards far wider than they have
  anything to fill. Cards are w-full, so this class is the ONE width knob for
  the rail and its cards — adjust here, not on the card.

    items       — node list: { label, icon, io_type, subtype, tooltip?, isSectionHeader }
                  icon: an OIcon name, or an "img:<url>" string for an image glyph.
    onDragStart — (event, item) => void   drag-to-add (both editors)
    onItemClick — (item) => void          click-to-add (workflows); omit for drag-only
    testPrefix  — data-test prefix, so each editor keeps its existing selectors
-->
<script lang="ts">
// Palette styling lives in its own token-driven stylesheet (see the note at the
// top of node-palette.css for why it cannot be scoped). Imported here rather
// than through an SFC style block, so this component carries none at all.
import "@/components/flow/node-palette.css";
import type { PropType } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

interface NodePaletteItem {
  subtype?: string;
  io_type?: string;
  isSectionHeader?: boolean;
  label?: string;
  tooltip?: string;
  icon?: string;
  [key: string]: unknown;
}

export default {
  props: {
    items: { type: Array as PropType<NodePaletteItem[]>, default: () => [] },
    testPrefix: { type: String, default: "flow-node-palette" },
    onDragStart: { type: Function, default: undefined },
    onItemClick: { type: Function, default: undefined },
  },
  components: { OButton, OTooltip, OIcon, OSeparator },
};
</script>

<template>
  <div
    class="np-sidebar w-44 shrink-0 h-full flex flex-col bg-surface-panel border-r border-border-default"
    :data-test="testPrefix"
  >
    <div class="np-body flex-1 min-h-0 overflow-y-auto px-1.5 py-2">
        <template v-for="(node, idx) in items" :key="`${node.subtype}-${node.io_type}-${idx}`">
        <!-- section label (Source / Transform / Destination). Same mb-3 outer
             gap as the node cards (matching the original NodeSidebar). -->
        <div v-if="node.isSectionHeader" class="rounded-default mb-3">
          <div class="np-section text-base font-medium">{{ node.label }}</div>
        </div>

        <!-- draggable / clickable node card -->
        <div v-else class="o2vf_node transition-all rounded-default mb-3 last:mb-0">
          <OButton
            variant="ghost"
            size="md"
            :class="[`o2vf_node_${node.io_type}`, onItemClick ? 'cursor-pointer' : '']"
            class="p-0 btn-fixed-width relative flex items-center w-full justify-start hover:translate-x-[0.1875rem] hover:bg-white/10 hover:backdrop-blur-[0.5rem] dark:hover:bg-white/8! dark:hover:backdrop-blur-[0.75rem]!"
            :data-test="`${testPrefix}-${node.subtype}-${node.io_type}-btn`"
            :draggable="!!onDragStart"
            @dragstart="onDragStart && onDragStart($event, node)"
            @click="onItemClick && onItemClick(node)"
          >
            <OTooltip side="right" :side-offset="10">
              <template #content>
                <div class="px-2.5 py-1.5">
                  <div class="font-medium text-2xs mb-0.5 capitalize">{{ node.label }}</div>
                  <div v-if="node.tooltip" class="text-3xs leading-[1.3] capitalize">{{ node.tooltip }}</div>
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
              <div class="node-label min-w-0 text-left overflow-hidden text-ellipsis whitespace-nowrap font-medium text-xs">{{ node.label }}</div>
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
</template>

