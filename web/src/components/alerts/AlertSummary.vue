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
  <div data-test="alerts-alert-summary" class="tw:h-full tw:flex tw:flex-col tw:relative">
    <div data-test="alerts-alert-summary-content" class="tw:text-[0.8125rem] tw:leading-[2.2] tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:p-4 tw:flex tw:flex-col" ref="summaryContainer" @scroll="checkIfShouldShowScrollButton">
      <p v-if="summaryText" data-test="alerts-alert-summary-text" class="summary-text tw:m-0 tw:whitespace-pre-line tw:tracking-[0.03em]" v-html="DOMPurify.sanitize(summaryText)" @click="handleSummaryClick"></p>
      <div v-else data-test="alerts-alert-summary-empty-state" class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:min-h-[120px] tw:gap-2 tw:p-4">
        <OIcon name="article" size="lg" class="tw:opacity-20" />
        <span class="tw:text-[0.8125rem] tw:font-medium tw:text-center tw:opacity-50">{{ t('alerts.summary.configureAlert') || 'Configure your alert to see a summary' }}</span>
      </div>
    </div>

    <!-- Scroll to bottom button -->
    <div
      v-show="showScrollToBottom"
      class="tw:absolute tw:bottom-5 tw:right-5 tw:z-[1000] tw:transition-all tw:duration-300 tw:pointer-events-none"
    >
      <OButton
        round
        variant="ghost"
        size="icon-circle-sm"
        class="scroll-to-bottom-btn tw:transition-all tw:duration-300 tw:ease-[ease] tw:pointer-events-auto tw:backdrop-blur-sm tw:shadow-[0_2px_8px_rgba(0,0,0,0.2)] tw:border-2! tw:border-[var(--q-primary)]! tw:text-[var(--q-primary)]! tw:bg-[rgba(255,255,255,0.95)]! tw:dark:bg-[rgba(30,30,30,0.9)]! tw:hover:scale-110 tw:hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)] tw:hover:bg-white! tw:hover:opacity-80 tw:dark:hover:bg-[rgba(40,40,40,0.95)]! tw:dark:hover:opacity-80 tw:active:scale-100"
        @click="scrollToBottomSmooth"
      >
        <OIcon name="arrow-downward" size="sm" />
        <OTooltip content="Scroll to bottom" side="top" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import OButton from '@/lib/core/Button/OButton.vue';
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue';
import DOMPurify from 'dompurify';
import { generateAlertSummary } from '@/utils/alerts/alertSummaryGenerator';
import OIcon from "@/lib/core/Icon/OIcon.vue";

const { t } = useI18n();

const props = defineProps({
  formData: {
    type: Object,
    required: true
  },
  destinations: {
    type: Array,
    default: () => []
  },
  focusManager: {
    type: Object,
    required: false
  },
  wizardStep: {
    type: Number,
    required: false,
    default: 1
  },
  previewQuery: {
    type: String,
    default: ''
  },
  generatedSqlQuery: {
    type: String,
    default: ''
  }
});

const summaryContainer = ref<HTMLElement | null>(null);
const showScrollToBottom = ref(false);

const summaryText = computed(() => {
  return generateAlertSummary(props.formData, props.destinations, t, undefined, props.previewQuery, props.generatedSqlQuery);
});

const handleSummaryClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  const focusTarget = target.getAttribute('data-focus-target');

  if (focusTarget && props.focusManager) {
    props.focusManager.focusField(focusTarget);
  }
};

const checkIfShouldShowScrollButton = () => {
  if (!summaryContainer.value) return;

  const { scrollTop, scrollHeight, clientHeight } = summaryContainer.value;

  // Show scroll to bottom button when there's scrollable content and user is not at bottom
  const hasScrollableContent = scrollHeight > clientHeight + 10;
  const isScrolledUp = scrollTop + clientHeight < scrollHeight - 10;

  showScrollToBottom.value = hasScrollableContent && isScrolledUp;
};

const scrollToBottomSmooth = async () => {
  await nextTick();
  if (summaryContainer.value) {
    summaryContainer.value.scrollTo({
      top: summaryContainer.value.scrollHeight,
      behavior: 'smooth'
    });
    // Hide the button immediately when user clicks it
    showScrollToBottom.value = false;
  }
};

watch(summaryText, async () => {
  await nextTick();
  checkIfShouldShowScrollButton();
});

// Check scroll state on mount
onMounted(async () => {
  await nextTick();
  checkIfShouldShowScrollButton();
});
</script>

<style>
/* Styles for bold section labels (using :deep for v-html content with markdown **text**) */
.summary-text :deep(strong) {
  display: inline;
  font-weight: 700;
  font-size: 0.875rem;
}

/* Styles for clickable spans (using :deep for v-html content) */
.summary-text :deep(.summary-clickable) {
  cursor: pointer;
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
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: inline;
  position: relative;
  box-shadow: 0 0 0 0.0625rem color-mix(in srgb, var(--q-primary) 15%, transparent);
  line-height: 1.6;
  vertical-align: baseline;
  white-space: nowrap;
}

.summary-text :deep(.summary-clickable):hover {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--q-primary) 15%, transparent),
    color-mix(in srgb, var(--q-primary) 20%, transparent)
  );
  transform: translateY(-0.0625rem);
  box-shadow:
    0 0 0 0.0625rem color-mix(in srgb, var(--q-primary) 25%, transparent),
    0 0.125rem 0.5rem color-mix(in srgb, var(--q-primary) 15%, transparent);
}

.summary-text :deep(.summary-clickable):active {
  transform: translateY(0) scale(0.98);
  background: color-mix(in srgb, var(--q-primary) 18%, transparent);
  box-shadow:
    0 0 0 0.0625rem color-mix(in srgb, var(--q-primary) 30%, transparent),
    inset 0 0.0625rem 0.125rem rgba(0, 0, 0, 0.1);
}

/* Styles for plain English section */
.summary-text :deep(.plain-english-section) {
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
