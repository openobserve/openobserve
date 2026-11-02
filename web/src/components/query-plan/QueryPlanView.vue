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
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { summarizePlan, type ProfileModel } from "@/utils/queryProfile";
import PlanDetailPanel from "./PlanDetailPanel.vue";
import PlanSummaryPanel from "./PlanSummaryPanel.vue";
import ProfileCanvas from "./ProfileCanvas.vue";
import QueryPlanLayout from "./QueryPlanLayout.vue";
import { useProfileFold } from "./useProfileFold";

const props = defineProps<{
  model: ProfileModel;
}>();

const emit = defineEmits<{ analyze: [] }>();

const { t } = useI18nTyped();

const summary = computed(() => summarizePlan(props.model));
const {
  selectedId,
  canvasRef,
  fold,
  layout,
  notice,
  focusable,
  act,
  onNoticeAction,
  pick,
  focusOn,
} = useProfileFold(
  t,
  () => props.model,
  (m) => summarizePlan(m).scans[0]?.opId ?? m.rootId,
);
</script>
