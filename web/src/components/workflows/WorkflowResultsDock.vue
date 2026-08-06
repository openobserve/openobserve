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
  Execution-results DOCK (T4). Hosts the canvas (default slot) with the shared
  WorkflowResultsPanel docked BELOW it (canvas on top, panel on the bottom, split
  by a draggable vertical OSplitter) so the graph stays visible while inspecting a
  run — unlike the old overlay drawer. The dock height is remembered and the panel
  can be collapsed to just its header strip. It only appears once a Test run has
  produced a result; otherwise the canvas fills the whole area.
-->
<template>
  <!-- No run yet → canvas fills the area (dock hidden). -->
  <div v-if="!hasResult" class="h-full min-h-0 w-full">
    <slot />
  </div>

  <!-- Docked (canvas top / panel bottom). -->
  <OSplitter
    v-else-if="!collapsed"
    horizontal
    unit="%"
    :model-value="canvasPct"
    :limits="[30, 85]"
    separator-class="h-1! bg-border-default hover:bg-accent transition-colors"
    class="h-full min-h-0 w-full"
    @update:model-value="onResize"
  >
    <template #before>
      <div class="h-full w-full"><slot /></div>
    </template>
    <template #after>
      <div class="flex h-full min-h-0 flex-col">
        <WorkflowResultsDockHeader
          :collapsed="collapsed"
          @toggle-collapse="toggleCollapse"
          @close="closeResults"
        />
        <div class="bg-surface-base min-h-0 flex-1"><WorkflowResultsPanel /></div>
      </div>
    </template>
  </OSplitter>

  <!-- Collapsed → canvas fills, panel reduced to its header strip at the bottom. -->
  <div v-else class="flex h-full min-h-0 w-full flex-col">
    <div class="min-h-0 min-w-0 flex-1"><slot /></div>
    <WorkflowResultsDockHeader :collapsed="collapsed" @toggle-collapse="toggleCollapse" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import WorkflowResultsPanel from "./WorkflowResultsPanel.vue";
import WorkflowResultsDockHeader from "./WorkflowResultsDockHeader.vue";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";

// Persist the canvas share (so a resize survives reloads).
const LS_HEIGHT = "workflows:resultsDockHeight"; // canvas height %

const readNum = (key: string, fallback: number): number => {
  const raw = Number(localStorage.getItem(key));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

const collapsed = ref(false);
const canvasPct = ref(readNum(LS_HEIGHT, 55));

const hasResult = computed(() => !!workflowObj.testRun.result);

// A fresh Test run (or Replay) produces a new result — always OPEN the dock
// expanded so the user sees the step results, even if it was collapsed before.
watch(
  () => workflowObj.testRun.result,
  (result) => {
    if (result) collapsed.value = false;
  },
);

// Clicking a node's ✓/✗ badge re-assigns resultDrawer to a fresh object. Watch the
// object REFERENCE (not `.show`, which is often already true) so every badge click
// fires — and expand the dock if it's collapsed, so the click reveals the result.
watch(
  () => workflowObj.testRun.resultDrawer,
  (rd) => {
    if (rd?.show) collapsed.value = false;
  },
);

const toggleCollapse = () => {
  collapsed.value = !collapsed.value;
};
// Clear the test result (hides the dock via hasResult) and dismiss the per-node
// selection — also clears the ✓/✗ badges + active highlight on the canvas. Reset
// collapse so the next run opens expanded.
const closeResults = () => {
  workflowObj.testRun.result = null;
  workflowObj.testRun.resultDrawer = { show: false, nodeId: "" };
  collapsed.value = false;
};
const onResize = (v: number) => {
  canvasPct.value = v;
  localStorage.setItem(LS_HEIGHT, String(v));
};
</script>
