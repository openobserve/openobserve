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
    class="grid h-full min-h-0 max-lg:flex max-lg:flex-col max-lg:overflow-y-auto"
    :class="
      detailOpen
        ? 'grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_27.5rem]'
        : 'grid-cols-[minmax(0,1fr)]'
    "
  >
    <div class="relative flex min-h-0 min-w-0 flex-col max-lg:shrink-0">
      <aside
        v-show="summaryOpen"
        ref="panelEl"
        class="bg-surface-base border-border-default rounded-surface absolute start-3 top-3 z-20 max-h-[calc(100%-1.5rem)] w-75 overflow-y-auto border p-3 shadow-md max-lg:static max-lg:max-h-none max-lg:w-auto max-lg:rounded-none max-lg:border-0 max-lg:border-b max-lg:px-4 max-lg:shadow-none"
        data-test="query-plan-summary-panel"
      >
        <div v-if="isDesktop" class="absolute end-1.5 top-1.5">
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="left-panel-close"
            :aria-label="t('search.queryProfile.hideSummary')"
            :title="t('search.queryProfile.hideSummary')"
            data-test="query-plan-hide-summary"
            @click="panels.summary = false"
          />
        </div>
        <slot name="summary" />
      </aside>
      <div v-if="!summaryOpen" class="bg-surface-base rounded-default absolute start-3 top-3 z-20">
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="left-panel-open"
          :aria-label="t('search.queryProfile.showSummary')"
          :title="t('search.queryProfile.showSummary')"
          data-test="query-plan-show-summary"
          @click="panels.summary = true"
        />
      </div>
      <div
        v-if="!detailOpen"
        class="bg-surface-base rounded-default absolute end-3 top-3 z-20 -scale-x-100"
      >
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="left-panel-open"
          :aria-label="t('search.queryProfile.showDetails')"
          :title="t('search.queryProfile.showDetails')"
          data-test="query-plan-show-detail"
          @click="panels.detail = true"
        />
      </div>
      <div class="min-h-0 flex-1 max-lg:h-[78vh] max-lg:flex-none">
        <slot name="canvas" :left-inset="leftInset" />
      </div>
    </div>
    <aside
      v-show="detailOpen"
      class="bg-surface-base border-border-default relative min-h-0 overflow-y-auto border-s max-lg:shrink-0 max-lg:overflow-visible max-lg:border-s-0 max-lg:border-t"
      data-test="query-plan-detail-panel"
    >
      <div v-if="isDesktop" class="absolute end-1.5 top-1.5 z-10 -scale-x-100">
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="left-panel-close"
          :aria-label="t('search.queryProfile.hideDetails')"
          :title="t('search.queryProfile.hideDetails')"
          data-test="query-plan-hide-detail"
          @click="panels.detail = false"
        />
      </div>
      <slot name="detail" />
    </aside>
  </div>
</template>

<script lang="ts">
import { reactive } from "vue";

// shared by the Plan and Analyze views so a hidden panel stays hidden when switching modes
const panels = reactive({ summary: true, detail: true });
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { useI18nTyped } from "@/types/i18n";

const MOBILE_INSET = 16;
const PANEL_GAP = 24;
// the canvas keeps clear of the show-summary button that replaces the hidden panel
const COLLAPSED_INSET = 56;

const props = defineProps<{ selectedId: string | null }>();

const { t } = useI18nTyped();
const { isDesktop } = useBreakpoint();

const panelEl = ref<HTMLElement | null>(null);
const panelWidth = ref(0);

const summaryOpen = computed(() => !isDesktop.value || panels.summary);
const detailOpen = computed(() => !isDesktop.value || panels.detail);
const leftInset = computed(() => {
  if (!isDesktop.value) return MOBILE_INSET;
  return panels.summary ? panelWidth.value + PANEL_GAP : COLLAPSED_INSET;
});

function measure() {
  if (panelEl.value?.offsetWidth) panelWidth.value = panelEl.value.offsetWidth;
}

watch(summaryOpen, (open) => open && nextTick(measure));

// picking an operator is a request to read about it, so a hidden detail panel comes back
watch(
  () => props.selectedId,
  (id, prev) => {
    if (id && prev !== undefined && id !== prev) panels.detail = true;
  },
);

onMounted(measure);
</script>
