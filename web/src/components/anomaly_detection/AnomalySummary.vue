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
  <div class="tw:h-full tw:flex tw:flex-col tw:relative">
    <div
      class="tw:text-[0.8125rem] tw:leading-[2.2] tw:flex-1 tw:overflow-y-auto tw:p-4"
      ref="summaryContainer"
      @scroll="checkScrollState"
    >
      <p
        v-if="summaryText"
        class="tw:m-0 tw:whitespace-pre-line tw:tracking-[0.03em]"
        v-html="summaryText"
      />
      <p v-else class="tw:m-0 tw:italic tw:opacity-60">
        Fill in the setup step to see a summary.
      </p>
    </div>

    <div v-show="showScrollToBottom" class="tw:absolute tw:bottom-5 tw:right-5 tw:z-1000 tw:pointer-events-none">
      <OButton
        variant="ghost"
        size="icon-sm"
        class="tw:pointer-events-auto tw:backdrop-blur-sm tw:shadow-[0_2px_8px_rgba(0,0,0,0.2)] tw:!border-2 tw:!border-[var(--o2-primary-color)] tw:!text-[var(--o2-primary-color)] tw:!bg-white/95 tw:dark:!bg-[rgba(30,30,30,0.9)]"
        data-test="anomaly-summary-scroll-btn"
        @click="scrollToBottom"
      >
        <OIcon name="arrow-downward" size="sm" />
        <OTooltip content="Scroll to bottom" side="top" align="center" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch, onMounted } from 'vue';
import { generateAnomalySummary } from '@/utils/alerts/anomalySummaryGenerator';
import OButton from '@/lib/core/Button/OButton.vue';
import OIcon from '@/lib/core/Icon/OIcon.vue';
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue';

const props = defineProps<{
  config: any;
  destinations: any[];
  wizardStep: number;
}>();

const summaryContainer = ref<HTMLElement | null>(null);
const showScrollToBottom = ref(false);

const summaryText = computed(() =>
  generateAnomalySummary(props.config, props.destinations, undefined, props.wizardStep),
);

const checkScrollState = () => {
  if (!summaryContainer.value) return;
  const { scrollTop, scrollHeight, clientHeight } = summaryContainer.value;
  const hasMore = scrollHeight > clientHeight + 100;
  const scrolledUp = scrollTop + clientHeight < scrollHeight - 100;
  showScrollToBottom.value = hasMore && scrolledUp;
};

const scrollToBottom = async () => {
  await nextTick();
  if (summaryContainer.value) {
    summaryContainer.value.scrollTo({ top: summaryContainer.value.scrollHeight, behavior: 'smooth' });
    showScrollToBottom.value = false;
  }
};

watch(summaryText, async () => {
  await nextTick();
  checkScrollState();
});

onMounted(async () => {
  await nextTick();
  checkScrollState();
});
</script>
