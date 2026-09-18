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
  Shared flow-canvas edge (Pipelines + Workflows). A smooth curved connector
  with an arrowhead. Deletion is handled by the canvas via keyboard
  (Backspace/Delete) using VueFlow events, so the edge itself is purely visual.
-->
<template>
  <BaseEdge :id="id" :style="edgeStyle" :path="path[0]" :marker-end="markerEnd" type="smoothstep" />

  <!-- Mid-edge "insert step here" `+` — opt-in (Workflows pass `insertable`), so
       the shared pipeline canvas is unchanged. Rendered into the EdgeLabelRenderer
       layer so it lives inside the viewport transform: `path[1]`/`path[2]` are the
       edge's midpoint in flow coords, and translate(-50%,-50%) centres the chip on
       it. Positioned via a CSS var (dynamic px, the sanctioned pattern here) so no
       literal px lands in a class. -->
  <EdgeLabelRenderer v-if="insertable">
    <div
      class="pointer-events-auto absolute top-0 left-0 [transform:var(--wf-edge-mid,none)]"
      :style="{ '--wf-edge-mid': `translate(-50%, -50%) translate(${path[1]}px, ${path[2]}px)` }"
      @mouseenter="emit('insert-enter')"
      @mouseleave="emit('insert-leave')"
    >
      <FlowAddButton data-test="workflow-edge-add" @click.stop="emit('insert', $event)" />
    </div>
  </EdgeLabelRenderer>

  <!-- Branch-arm label — opt-in (Workflows pass `label`), positioned off the same
       midpoint CSS var as the insert chip. -->
  <EdgeLabelRenderer v-if="label">
    <div
      data-test="workflow-edge-label"
      :title="label"
      class="bg-surface-panel border-border-default text-text-secondary rounded-default text-2xs absolute top-0 left-0 max-w-40 [transform:var(--wf-edge-mid,none)] truncate border px-1.5 py-0.5"
      :style="{ '--wf-edge-mid': `translate(-50%, -160%) translate(${path[1]}px, ${path[2]}px)` }"
    >
      {{ label }}
    </div>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position } from "@vue-flow/core";
import { computed, type PropType } from "vue";
import type { I18nText } from "@/types/i18n";
import FlowAddButton from "./FlowAddButton.vue";

const props = defineProps({
  id: { type: String, required: true },
  sourceX: { type: Number, required: true },
  sourceY: { type: Number, required: true },
  targetX: { type: Number, required: true },
  targetY: { type: Number, required: true },
  sourcePosition: { type: String as PropType<Position>, required: true },
  targetPosition: { type: String as PropType<Position>, required: true },
  data: { type: Object, required: false },
  markerEnd: { type: String, required: false },
  style: { type: Object, required: false },
  // Accepted for pipeline call-site compatibility; not used for rendering.
  isInView: { type: Boolean, required: false, default: false },
  // Workflows opt in to the mid-edge insert `+`; pipelines leave it off.
  insertable: { type: Boolean, required: false, default: false },
  // Same opt-in shape: only Workflows label an edge (the Branch arm it routes).
  label: { type: String as PropType<I18nText | "">, required: false, default: "" },
  // Opt-in visible selection (Workflows pass VueFlow's selected flag through).
  selected: { type: Boolean, required: false, default: false },
});

// Clicking the mid-edge `+` asks the canvas to splice a step onto THIS edge. The
// insert-enter/insert-leave pair lets the canvas keep the chip alive while the cursor
// moves from the node onto it (Option C reveals the chip on node hover).
const emit = defineEmits<{
  (e: "insert", event: MouseEvent): void;
  (e: "insert-enter"): void;
  (e: "insert-leave"): void;
}>();

const path = computed(() => getBezierPath(props));

// The resting stroke arrives as an INLINE style, so the library's `.selected`
// stylesheet rule can never win over it — selection must be painted here too.
const edgeStyle = computed(() => ({
  ...props.style,
  ...(props.selected ? { stroke: "var(--color-indigo-500)", strokeWidth: 3 } : {}),
  cursor: "pointer",
  strokeDasharray: "none",
}));
</script>

<script lang="ts">
export default { inheritAttrs: false };
</script>
