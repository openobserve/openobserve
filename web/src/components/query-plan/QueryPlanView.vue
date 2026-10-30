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
  <QueryPlanLayout :selected-id="selectedId" data-test="query-plan-view">
    <template #summary>
      <PlanSummaryPanel :model="model" :summary="summary" @analyze="emit('analyze')" />
    </template>
    <template #canvas="{ leftInset }">
      <ProfileCanvas
        :model="model"
        :layout="layout"
        scope="sum"
        :selected-id="selectedId"
        :left-inset="leftInset"
        @select="selectedId = $event"
      />
    </template>
    <template #detail>
      <PlanDetailPanel :model="model" :op-id="selectedId" @select="selectedId = $event" />
    </template>
  </QueryPlanLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  buildProfileModel,
  layoutProfile,
  summarizePlan,
  type QueryProfile,
} from "@/utils/queryProfile";
import PlanDetailPanel from "./PlanDetailPanel.vue";
import PlanSummaryPanel from "./PlanSummaryPanel.vue";
import ProfileCanvas from "./ProfileCanvas.vue";
import QueryPlanLayout from "./QueryPlanLayout.vue";

const props = defineProps<{
  profile: QueryProfile;
}>();

const emit = defineEmits<{ analyze: [] }>();

const selectedId = ref<string | null>(null);

const model = computed(() => buildProfileModel(props.profile, [], { planOnly: true }));
const layout = computed(() => layoutProfile(model.value));
const summary = computed(() => summarizePlan(model.value));

watch(
  model,
  (m) => {
    selectedId.value = summary.value.scans[0]?.opId ?? m.rootId;
  },
  { immediate: true },
);
</script>
