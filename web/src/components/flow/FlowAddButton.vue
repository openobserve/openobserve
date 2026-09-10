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
  The single "add a step here" affordance for the flow canvases — a small round
  `+` chip. Used in three consistent places (Workflows): between the empty-canvas
  Trigger/Action scaffold slots, below a leaf node (append), and at an edge
  midpoint (insert between). Purely presentational; the caller positions it and
  handles the native @click. `nodrag`/`nopan` keep a click on it from panning or
  dragging the canvas underneath.
-->
<template>
  <button
    type="button"
    :data-test="dataTest"
    class="nodrag nopan bg-surface-base border-border-strong text-text-secondary hover:border-accent hover:text-text-body flex size-5 items-center justify-center rounded-full border shadow-sm transition-colors"
  >
    <OIcon name="add" size="xs" />
  </button>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineProps<{ dataTest?: string }>();
</script>
