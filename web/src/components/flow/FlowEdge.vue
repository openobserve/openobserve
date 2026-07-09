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
  <BaseEdge
    :id="id"
    :style="{ ...style, cursor: 'pointer', strokeDasharray: 'none' }"
    :path="path[0]"
    :marker-end="markerEnd"
    type="smoothstep"
  />
</template>

<script setup>
import { BaseEdge, getBezierPath } from "@vue-flow/core";
import { computed } from "vue";

const props = defineProps({
  id: { type: String, required: true },
  sourceX: { type: Number, required: true },
  sourceY: { type: Number, required: true },
  targetX: { type: Number, required: true },
  targetY: { type: Number, required: true },
  sourcePosition: { type: String, required: true },
  targetPosition: { type: String, required: true },
  data: { type: Object, required: false },
  markerEnd: { type: String, required: false },
  style: { type: Object, required: false },
  // Accepted for pipeline call-site compatibility; not used for rendering.
  isInView: { type: Boolean, required: false, default: false },
});

const path = computed(() => getBezierPath(props));
</script>

<script>
export default { inheritAttrs: false };
</script>
