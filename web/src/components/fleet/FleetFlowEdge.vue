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

<template>
  <path
    :d="path[0]"
    class="fill-none transition-[stroke-width,opacity]"
    :class="[
      data?.branch ? 'stroke-status-error-text' : SIGNAL_STROKE[data?.signal ?? 'logs'],
      data?.dimmed ? 'opacity-15' : data?.noData ? 'opacity-40' : '',
    ]"
    :stroke-width="strokeWidth"
    :stroke-dasharray="data?.branch ? '6 4' : undefined"
    stroke-linecap="round"
    :data-test="`fleet-flow-edge-${id}`"
  />
  <!-- Wide transparent twin: an easy click and hover target for a thin line. -->
  <path
    ref="hitEl"
    :d="path[0]"
    class="cursor-pointer fill-none stroke-transparent"
    stroke-width="14"
    :data-test="`fleet-flow-edge-${id}-hit`"
  >
    <title v-if="data?.summary">{{ data.summary }}</title>
  </path>
  <EdgeLabelRenderer v-if="data?.label">
    <!-- Vue Flow gives edge coordinates in px, so the label offset derived from them is px too. -->
    <div
      class="text-status-error-text pointer-events-auto absolute top-0 left-0 z-10 [transform:var(--fleet-edge-at)] text-xs font-medium whitespace-nowrap tabular-nums"
      :class="data.dimmed ? 'opacity-30' : ''"
      :style="{
        '--fleet-edge-at': `translate(0.25rem, -50%) translate(${targetX}px, ${targetY}px)`,
      }"
      :data-test="`fleet-flow-edge-${id}-label`"
      @click="clickEdge"
    >
      {{ data.label }}
    </div>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { EdgeLabelRenderer, getBezierPath, type Position } from "@vue-flow/core";
import type { FleetFlowEdgeData } from "./flowTypes";
import { SIGNAL_STROKE } from "./flowIssues";

const props = defineProps<{
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  data?: FleetFlowEdgeData;
}>();

const hitEl = ref<SVGPathElement | null>(null);

const strokeWidth = computed(() => {
  const base = props.data?.width ?? 1.5;
  return props.data?.highlighted ? base + 1.5 : base;
});

const path = computed(() =>
  getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  }),
);

// Labels render outside the edge's SVG group, where Vue Flow listens for edge clicks.
function clickEdge(event: MouseEvent) {
  hitEl.value?.dispatchEvent(
    new MouseEvent("click", { bubbles: true, clientX: event.clientX, clientY: event.clientY }),
  );
}
</script>

<script lang="ts">
export default { inheritAttrs: false };
</script>
