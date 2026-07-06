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
  <div class="h-full flex flex-col relative">
    <div
      class="text-[0.8125rem] leading-[2.2] flex-1 overflow-y-auto p-4"
      ref="summaryContainer"
      @scroll="checkScrollState"
    >
      <p
        v-if="summaryText"
        class="summary-text m-0 whitespace-pre-line tracking-[0.03em]"
        v-html="summaryText"
      />
      <p v-else class="m-0 italic opacity-60">
        Fill in the setup step to see a summary.
      </p>
    </div>

    <div v-show="showScrollToBottom" class="absolute bottom-5 right-5 z-1000 pointer-events-none">
      <OButton
        variant="ghost"
        size="icon-sm"
        class="pointer-events-auto backdrop-blur-sm shadow-[0_2px_8px_rgba(0,0,0,0.2)] !border-2 !border-[var(--o2-primary-color)] !text-[var(--o2-primary-color)] !bg-white/95 dark:!bg-[rgba(30,30,30,0.9)]"
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

<style>
/* Styles for bold section labels (v-html content with markdown **text**) */
.summary-text strong {
  display: inline;
  font-weight: 700;
  font-size: 0.875rem;
}

/* Styles for clickable spans (v-html content) */
.summary-text .summary-clickable {
  cursor: default;
  color: var(--q-primary);
  font-weight: 600;
  padding: 0.125rem 0.375rem;
  margin: 0 0.125rem;
  border-radius: 0.25rem;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--q-primary) 8%, transparent),
    color-mix(in srgb, var(--q-primary) 12%, transparent)
  );
  display: inline;
  position: relative;
  box-shadow: 0 0 0 0.0625rem color-mix(in srgb, var(--q-primary) 15%, transparent);
  line-height: 1.6;
  vertical-align: baseline;
  white-space: nowrap;
}

/* Styles for plain English section */
.summary-text .plain-english-section {
  padding: 0.75rem 1rem;
  border-radius: 0.375rem;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--q-primary) 5%, transparent),
    color-mix(in srgb, var(--q-primary) 8%, transparent)
  );
  border-left: 0.1875rem solid var(--q-primary);
  font-size: 0.875rem;
  line-height: 1.7;
  font-style: italic;
  opacity: 0.95;
  font-weight: 500;
}
</style>
