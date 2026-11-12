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
    :d="path"
    class="stroke-text-secondary fill-none"
    stroke-width="1.5"
    stroke-dasharray="5 4"
  />
  <path
    v-if="data?.arrow"
    :d="`M ${targetX} ${targetY} L ${targetX - 8} ${targetY - 4.5} L ${targetX - 8} ${targetY + 4.5} Z`"
    class="fill-text-secondary"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { getBezierPath, getStraightPath, type Position } from "@vue-flow/core";

const props = defineProps<{
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  data?: { arrow?: boolean };
}>();

const path = computed(() => {
  const sameRow = Math.abs(props.sourceY - props.targetY) < 1;
  const tx = props.data?.arrow ? props.targetX - 8 : props.targetX;
  return sameRow
    ? getStraightPath({ ...props, targetX: tx })[0]
    : getBezierPath({ ...props, targetX: tx })[0];
});
</script>

<script lang="ts">
export default { inheritAttrs: false };
</script>
