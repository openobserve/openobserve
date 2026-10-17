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
    class="fill-none transition-[stroke,opacity]"
    :class="[SEVERITY_STROKE[severity], data?.dimmed ? 'opacity-15' : '']"
    :stroke-width="strokeWidth"
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
  <EdgeLabelRenderer v-if="data?.sourceLabel">
    <!-- Vue Flow gives edge coordinates in px, so the label cap derived from them is px too. -->
    <div
      class="pointer-events-auto absolute top-0 left-0 z-10 max-w-[calc(var(--fleet-edge-half)-0.75rem)] [transform:var(--fleet-edge-at)] truncate text-xs font-medium whitespace-nowrap tabular-nums"
      :class="[SEVERITY_TEXT[severity], data.dimmed ? 'opacity-30' : '']"
      :style="{
        '--fleet-edge-at': `translate(0.75rem, -150%) translate(${sourceX}px, ${sourceY}px)`,
        '--fleet-edge-half': `${Math.max(0, (targetX - sourceX) / 2)}px`,
      }"
      :title="data.sourceLabel"
      :data-test="`fleet-flow-edge-${id}-source-label`"
      @click="clickEdge"
    >
      {{ data.sourceLabel }}
    </div>
  </EdgeLabelRenderer>
  <EdgeLabelRenderer v-if="data?.targetLabel">
    <div
      class="pointer-events-auto absolute top-0 left-0 z-10 max-w-[calc(var(--fleet-edge-half)-0.75rem)] [transform:var(--fleet-edge-at)] truncate text-xs font-medium whitespace-nowrap tabular-nums"
      :class="[SEVERITY_TEXT[severity], data.dimmed ? 'opacity-30' : '']"
      :style="{
        '--fleet-edge-at': `translate(calc(-100% - 0.75rem), -150%) translate(${targetX}px, ${targetY}px)`,
        '--fleet-edge-half': `${Math.max(0, (targetX - sourceX) / 2)}px`,
      }"
      :title="data.targetLabel"
      :data-test="`fleet-flow-edge-${id}-target-label`"
      @click="clickEdge"
    >
      {{ data.targetLabel }}
    </div>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { EdgeLabelRenderer, getBezierPath, type Position } from "@vue-flow/core";
import type { FleetFlowEdgeData } from "./flowTypes";
import { SEVERITY_STROKE, SEVERITY_TEXT } from "./flowIssues";

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

const severity = computed(() => props.data?.severity ?? "healthy");
const strokeWidth = computed(() => {
  const base = severity.value === "healthy" || severity.value === "restricted" ? 1.5 : 3;
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
