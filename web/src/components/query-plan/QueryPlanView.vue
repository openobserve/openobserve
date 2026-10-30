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
  <div
    class="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_22rem] max-lg:flex max-lg:flex-col max-lg:overflow-y-auto xl:grid-cols-[minmax(0,1fr)_27.5rem]"
    data-test="query-plan-view"
  >
    <div class="relative flex min-h-0 min-w-0 flex-col max-lg:shrink-0">
      <aside
        ref="panelEl"
        class="bg-surface-base border-border-default rounded-surface absolute start-3 top-3 z-20 max-h-[calc(100%-1.5rem)] w-75 overflow-y-auto border p-3 shadow-md max-lg:static max-lg:max-h-none max-lg:w-auto max-lg:rounded-none max-lg:border-0 max-lg:border-b max-lg:px-4 max-lg:shadow-none"
      >
        <PlanSummaryPanel :model="model" :summary="summary" @analyze="emit('analyze')" />
      </aside>
      <div class="min-h-0 flex-1 max-lg:h-[78vh] max-lg:flex-none">
        <ProfileCanvas
          :model="model"
          :layout="layout"
          scope="sum"
          :selected-id="selectedId"
          :left-inset="leftInset"
          @select="selectedId = $event"
        />
      </div>
    </div>
    <aside
      class="bg-surface-base border-border-default min-h-0 overflow-y-auto border-s max-lg:shrink-0 max-lg:overflow-visible max-lg:border-s-0 max-lg:border-t"
    >
      <PlanDetailPanel :model="model" :op-id="selectedId" @select="selectedId = $event" />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import useBreakpoint from "@/composables/useBreakpoint";
import {
  buildProfileModel,
  layoutProfile,
  summarizePlan,
  type QueryProfile,
} from "@/utils/queryProfile";
import PlanDetailPanel from "./PlanDetailPanel.vue";
import PlanSummaryPanel from "./PlanSummaryPanel.vue";
import ProfileCanvas from "./ProfileCanvas.vue";

const MOBILE_INSET = 16;
const PANEL_GAP = 24;

const props = defineProps<{
  profile: QueryProfile;
}>();

const emit = defineEmits<{ analyze: [] }>();

const { isDesktop } = useBreakpoint();

const panelEl = ref<HTMLElement | null>(null);
const panelWidth = ref(0);
const selectedId = ref<string | null>(null);

const model = computed(() => buildProfileModel(props.profile, [], { planOnly: true }));
const layout = computed(() => layoutProfile(model.value));
const summary = computed(() => summarizePlan(model.value));
const leftInset = computed(() => (!isDesktop.value ? MOBILE_INSET : panelWidth.value + PANEL_GAP));

watch(
  model,
  (m) => {
    selectedId.value = summary.value.scans[0]?.opId ?? m.rootId;
  },
  { immediate: true },
);

onMounted(() => {
  panelWidth.value = panelEl.value?.offsetWidth ?? 0;
});
</script>
