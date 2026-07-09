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
  Shared node card for the flow canvases (Pipelines + Workflows). PRESENTATIONAL
  only — no composable/singleton coupling. It renders the card frame
  (icon | separator | label + optional body) and the input/output handles;
  everything interaction-specific (click, hover actions, hover-`+`, per-type
  body) is supplied by the wrapping module via native events + slots.

    icon / image  — glyph: an OIcon `icon` name, or an `image` URL (image wins)
    label         — node title
    ioType        — input | default | output (drives handle colour class)
    hasInput / hasOutput — whether to render the target / source handle
    inputPosition / outputPosition — handle sides (default top / bottom)

  Slots: #body (under the title), #actions (hover buttons), #footer (hover-`+`).
  Native @click / @mouseenter / @mouseleave fall through to the root element.

  Card background/border colour comes from the VueFlow node wrapper
  (`.vue-flow__node-<ioType>`) styled by each flow, and the handle look from the
  flow's `.node_handle_custom` / `.handle_*` rules — so this component only
  applies the agreed class names.
-->
<template>
  <div class="flow-node">
    <Handle
      v-if="hasInput"
      id="input"
      type="target"
      :position="inputPosition"
      :class="handleClass"
      :data-test="inputHandleTest"
    />

    <div class="flow-node__icon tw:flex tw:items-center">
      <!-- `icon` may be a glyph name or an "img:<url>" string; OIcon renders both
           (same as the pipeline node), so canvas icons match exactly. -->
      <OIcon :name="icon || 'help'" size="md" class="tw:my-2 tw:mr-2" />
    </div>

    <OSeparator vertical class="tw:mr-2" />

    <div class="flow-node__container">
      <!-- Simple title when `label` is set (Workflows). Modules with richer,
           per-type content (Pipelines) leave `label` empty and use #body. -->
      <div
        v-if="label"
        class="flow-node__title tw:text-[15px]! tw:font-bold! tw:leading-[1.4]!"
      >
        {{ label }}
      </div>
      <slot name="body" />
    </div>

    <Handle
      v-if="hasOutput"
      id="output"
      type="source"
      :position="outputPosition"
      :class="handleClass"
      :data-test="outputHandleTest"
    />

    <!-- hover actions (delete, etc.) supplied by the wrapper -->
    <slot name="actions" />
    <!-- hover-`+` / add-next affordance supplied by the wrapper -->
    <slot name="footer" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

const props = withDefaults(
  defineProps<{
    icon?: string;
    label?: string;
    ioType?: string;
    hasInput?: boolean;
    hasOutput?: boolean;
    inputPosition?: Position;
    outputPosition?: Position;
    inputHandleTest?: string;
    outputHandleTest?: string;
  }>(),
  {
    icon: "help",
    label: "",
    ioType: "default",
    hasInput: true,
    hasOutput: true,
    inputPosition: Position.Top,
    outputPosition: Position.Bottom,
    inputHandleTest: undefined,
    outputHandleTest: undefined,
  },
);

const handleClass = computed(
  () => `node_handle_custom handle_${props.ioType || "default"}`,
);
</script>

<style scoped>
.flow-node {
  display: flex;
  align-items: center;
  border: none;
  cursor: pointer;
  width: fit-content;
  /* mirrors the pipeline node's inner padding so the two match exactly */
  padding: 5px 0;
}
.flow-node__container {
  text-align: left;
  min-width: 0;
}
.flow-node__title {
  text-align: left;
  white-space: nowrap;
}
</style>
