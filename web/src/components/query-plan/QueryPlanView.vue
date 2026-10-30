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
  <QueryPlanLayout data-test="query-plan-view">
    <template #summary>
      <PlanSummaryPanel :model="model" :summary="summary" @analyze="emit('analyze')" />
    </template>
    <template #canvas="{ leftInset }">
      <ProfileCanvas
        ref="canvasRef"
        :model="model"
        :layout="layout"
        scope="sum"
        :selected-id="selectedId"
        :left-inset="leftInset"
        :plumbing="fold.plumbing"
        :notice="notice"
        @select="pick"
        @fold="act"
        @notice-action="onNoticeAction"
      />
    </template>
    <template #detail>
      <PlanDetailPanel
        :model="model"
        :op-id="selectedId"
        :can-focus="focusable"
        :focused="!!fold.focusId && fold.focusId === selectedId"
        @select="pick"
        @focus="focusOn"
      />
    </template>
  </QueryPlanLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { summarizePlan, type ProfileModel } from "@/utils/queryProfile";
import PlanDetailPanel from "./PlanDetailPanel.vue";
import PlanSummaryPanel from "./PlanSummaryPanel.vue";
import ProfileCanvas from "./ProfileCanvas.vue";
import QueryPlanLayout, { revealDetail } from "./QueryPlanLayout.vue";
import { useProfileFold } from "./useProfileFold";

const props = defineProps<{
  model: ProfileModel;
}>();

const emit = defineEmits<{ analyze: [] }>();

const { t } = useI18nTyped();

const selectedId = ref<string | null>(null);
const canvasRef = ref<InstanceType<typeof ProfileCanvas> | null>(null);

const summary = computed(() => summarizePlan(props.model));
const { fold, layout, notice, focusable, act, reveal, onNoticeAction } = useProfileFold(
  t,
  () => props.model,
  selectedId,
);

function pick(id: string) {
  reveal(id);
  selectedId.value = id;
  revealDetail();
}

function focusOn(opId: string | null) {
  canvasRef.value?.fitNext();
  act({ type: "focus", opId });
}

watch(
  () => props.model,
  (m) => {
    selectedId.value = summary.value.scans[0]?.opId ?? m.rootId;
  },
  { immediate: true },
);
</script>
