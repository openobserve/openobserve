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
  Floating node palette — lives INSIDE the canvas at bottom-left (not a pipeline
  side column). Lists the addable step types; clicking one appends it after the
  chain's end node (stages it + opens the config drawer). Collapses to a single
  icon button via the header's minimize control.
-->
<template>
  <!-- collapsed → icon button -->
  <button
    v-if="collapsed"
    type="button"
    class="wf-palette-fab"
    :title="t('workflow.node.paletteTitle')"
    data-test="workflow-palette-open"
    @click="collapsed = false"
  >
    <OIcon name="widgets" size="md" />
  </button>

  <!-- expanded → panel -->
  <div v-else class="wf-palette" data-test="workflow-palette">
    <div class="wf-palette-head">
      <div class="wf-palette-title">
        <OIcon name="widgets" size="sm" class="tw:opacity-70" />
        {{ t("workflow.node.paletteTitle") }}
      </div>
      <button
        type="button"
        class="wf-palette-collapse"
        :title="t('workflow.node.paletteCollapse')"
        data-test="workflow-palette-collapse"
        @click="collapsed = true"
      >
        <OIcon name="remove" size="sm" />
      </button>
    </div>

    <div class="wf-palette-body">
      <button
        v-for="nt in addable"
        :key="nt"
        type="button"
        class="wf-palette-card"
        :class="cardClass(nt)"
        draggable="true"
        :data-test="`workflow-palette-${nt}`"
        @click="pick(nt)"
        @dragstart="onDragStart($event, nt)"
      >
        <OIcon
          :name="meta(nt)?.icon || 'help'"
          size="sm"
          class="tw:shrink-0"
          :class="glyphClass(nt)"
        />
        <div class="tw:text-[13px] tw:font-semibold tw:text-text-primary tw:leading-tight tw:truncate">
          {{ t(meta(nt)?.titleKey || nt) }}
        </div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import useWorkflowCanvas, {
  nodeMeta,
  ADDABLE_NODE_TYPES,
} from "./useWorkflowCanvas";

const { t } = useI18n();
const { addNodeToEnd, onDragStart } = useWorkflowCanvas();

const collapsed = ref(false);
const addable = ADDABLE_NODE_TYPES;
const meta = (nt: string) => nodeMeta(nt);

// Card tint + icon colour match the canvas node colours: steps (condition /
// function) = amber, action (destination) = green.
const cardClass = (nt: string) =>
  nodeMeta(nt)?.category === "action"
    ? "wf-palette-card--action"
    : "wf-palette-card--step";
const glyphClass = (nt: string) =>
  nodeMeta(nt)?.category === "action" ? "tw:text-[#1f9d63]" : "tw:text-[#e0891d]";

const pick = (nt: string) => addNodeToEnd(nt);
</script>

<style scoped>
/* Collapsed floating action button. */
.wf-palette-fab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid var(--o2-border-color, #e3e6ea);
  background: var(--o2-surface, #fff);
  color: var(--o2-text-secondary, #6b7280);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: color 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
}
.wf-palette-fab:hover {
  color: #5a61cc;
  border-color: #5a61cc;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}

/* Expanded panel. Width matches the pipeline node sidebar (w-50 = 200px). */
.wf-palette {
  width: 200px;
  border-radius: 12px;
  border: 1px solid var(--o2-border-color, #e3e6ea);
  background: var(--o2-surface, #fff);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  overflow: hidden;
}
.wf-palette-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--o2-border-color, #e3e6ea);
}
.wf-palette-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--o2-text-primary, #1f2733);
}
.wf-palette-collapse {
  display: inline-flex;
  padding: 2px;
  border-radius: 6px;
  color: var(--o2-text-secondary, #6b7280);
  cursor: pointer;
}
.wf-palette-collapse:hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.wf-palette-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  max-height: 44vh;
  overflow-y: auto;
}
.wf-palette-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--o2-border-color, #e3e6ea);
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}

/* Steps (condition / function) — amber; matches the canvas node colours. */
.wf-palette-card--step {
  border-color: #f59e0b;
  background: rgba(255, 251, 235, 0.8);
}
.wf-palette-card--step:hover {
  background: rgba(255, 251, 235, 0.95);
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.15);
}
.dark .wf-palette-card--step {
  border-color: rgba(251, 146, 60, 0.3);
  background: rgba(120, 53, 15, 0.2);
}

/* Action (destination) — green. */
.wf-palette-card--action {
  border-color: rgba(74, 222, 128, 0.6);
  background: rgba(240, 253, 244, 1);
}
.wf-palette-card--action:hover {
  box-shadow: 0 2px 8px rgba(34, 197, 94, 0.15);
}
.dark .wf-palette-card--action {
  border-color: rgba(74, 222, 128, 0.3);
  background: rgba(20, 83, 45, 0.2);
}
</style>
