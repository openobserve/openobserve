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
  <div data-test="alerts-alert-summary" class="h-full flex flex-col relative">
    <div data-test="alerts-alert-summary-content" class="text-[0.8125rem] leading-[2.2] flex-1 min-h-0 overflow-y-auto p-4 flex flex-col" ref="summaryContainer" @scroll="checkIfShouldShowScrollButton">
      <p v-if="summaryText" data-test="alerts-alert-summary-text" class="summary-text m-0 whitespace-pre-line tracking-[0.03em]" v-html="DOMPurify.sanitize(summaryText)" @click="handleSummaryClick"></p>
      <div v-else data-test="alerts-alert-summary-empty-state" class="flex flex-col items-center justify-center h-full min-h-[120px] gap-2 p-4">
        <OIcon name="article" size="lg" class="opacity-20" />
        <span class="text-[0.8125rem] font-medium text-center opacity-50">{{ t('alerts.summary.configureAlert') || 'Configure your alert to see a summary' }}</span>
      </div>
    </div>

    <!-- Scroll to bottom button -->
    <div
      v-show="showScrollToBottom"
      class="absolute bottom-5 right-5 z-[1000] transition-all duration-300 pointer-events-none"
    >
      <OButton
        round
        variant="ghost"
        size="icon-circle-sm"
        class="scroll-to-bottom-btn transition-all duration-300 ease-[ease] pointer-events-auto backdrop-blur-sm shadow-[0_2px_8px_rgba(0,0,0,0.2)] border-2! border-[var(--q-primary)]! text-[var(--q-primary)]! bg-[rgba(255,255,255,0.95)]! dark:bg-[rgba(30,30,30,0.9)]! hover:scale-110 hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)] hover:bg-white! hover:opacity-80 dark:hover:bg-[rgba(40,40,40,0.95)]! dark:hover:opacity-80 active:scale-100"
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
/* Styles for bold section labels (v-html content with markdown **text**) */
.summary-text strong {
  display: inline;
  font-weight: 700;
  font-size: 0.875rem;
}

/* Styles for clickable spans (v-html content) */
.summary-text .summary-clickable {
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

.summary-text .summary-clickable:hover {
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

.summary-text .summary-clickable:active {
  transform: translateY(0) scale(0.98);
  background: color-mix(in srgb, var(--q-primary) 18%, transparent);
  box-shadow:
    0 0 0 0.0625rem color-mix(in srgb, var(--q-primary) 30%, transparent),
    inset 0 0.0625rem 0.125rem rgba(0, 0, 0, 0.1);
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
