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
  "Add next step" picker — a searchable dialog opened by the hover-`+` on a node
  (Zapier-style). Anchored to workflowObj.stepPicker.{source, handle}; choosing a
  step calls addNodeAfter(source, handle, type), which stages the node and opens
  its config drawer. Built on ODialog so it scales as more step types land.
-->
<template>
  <ODialog
    :open="true"
    size="md"
    :title="t('workflow.node.stepDialogTitle')"
    data-test="workflow-step-dialog"
    @update:open="(v) => !v && closeStepPicker()"
  >
    <OSearchInput
      v-model="search"
      :placeholder="t('workflow.node.stepSearchPlaceholder')"
      clearable
      class="tw:mb-3"
      data-test="workflow-step-search"
    />

    <div v-if="filtered.length" class="tw:flex tw:flex-col tw:gap-2">
      <button
        v-for="nt in filtered"
        :key="nt"
        type="button"
        class="wf-step-card tw:flex tw:items-start tw:gap-3 tw:p-3 tw:border tw:border-border-default tw:rounded-lg tw:bg-card-bg tw:text-left tw:cursor-pointer tw:transition-[border-color,background,box-shadow] tw:duration-[120ms]"
        :data-test="`workflow-step-${nt}`"
        @click="pick(nt)"
      >
        <div
          class="tw:inline-flex tw:items-center tw:justify-center tw:w-8 tw:h-8 tw:shrink-0 tw:rounded-lg"
          :class="iconTint(nt)"
        >
          <OIcon :name="meta(nt)?.icon || 'help'" size="md" />
        </div>
        <div class="tw:min-w-0">
          <div class="tw:text-sm tw:font-semibold tw:text-text-primary">
            {{ t(meta(nt)?.titleKey || nt) }}
          </div>
          <div class="tw:text-xs tw:text-text-secondary tw:leading-snug">
            {{ t(meta(nt)?.descKey || "") }}
          </div>
        </div>
      </button>
    </div>

    <div v-else class="tw:py-8 tw:text-center tw:text-sm tw:text-text-secondary">
      {{ t("workflow.node.stepNoMatch") }}
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import useWorkflowCanvas, {
  workflowObj,
  nodeMeta,
  ADDABLE_NODE_TYPES,
} from "@/plugins/workflows/useWorkflowCanvas";

const { t } = useI18n();
const { addNodeAfter, closeStepPicker } = useWorkflowCanvas();

const meta = (nt: string) => nodeMeta(nt);

// Tint the icon square to match the canvas node colours: steps (condition /
// function) = amber, action (destination) = green.
const iconTint = (nt: string) => {
  switch (nodeMeta(nt)?.category) {
    case "action":
      return "tw:bg-[#e6f6ee] tw:text-[#1f9d63]";
    default:
      return "tw:bg-[#fdf3e2] tw:text-[#e0891d]";
  }
};

const search = ref("");
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return ADDABLE_NODE_TYPES;
  return ADDABLE_NODE_TYPES.filter((nt) => {
    const m = nodeMeta(nt);
    if (!m) return false;
    return (
      t(m.titleKey).toLowerCase().includes(q) ||
      t(m.descKey).toLowerCase().includes(q)
    );
  });
});

const pick = (nt: string) => {
  const { source, handle } = workflowObj.stepPicker;
  closeStepPicker();
  // Stages the node + opens its config drawer.
  addNodeAfter(source, handle, nt);
};
</script>

<style scoped>
.wf-step-card:hover {
  border-color: var(--color-primary-600, #3f7994);
  background: color-mix(in srgb, var(--color-primary-600) 4%, var(--color-card-bg));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary-600) 12%, transparent);
}
</style>
