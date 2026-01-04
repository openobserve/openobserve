<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="alert-summary">
    <div class="summary-content" ref="summaryContainer" @scroll="checkIfShouldShowScrollButton">
      <p v-if="summaryText" class="summary-text" v-html="summaryText" @click="handleSummaryClick"></p>
      <p v-else class="summary-placeholder">{{ t('alerts.summary.configureAlert') }}</p>
    </div>

    <!-- Scroll to bottom button -->
    <div
      v-show="showScrollToBottom"
      class="scroll-to-bottom-container"
    >
      <q-btn
        round
        flat
        icon="arrow_downward"
        class="scroll-to-bottom-btn"
        @click="scrollToBottomSmooth"
        size="sm"
      >
        <q-tooltip anchor="top middle" self="bottom middle">
          Scroll to bottom
        </q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { generateAlertSummary } from '@/utils/alerts/alertSummaryGenerator';

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
  return generateAlertSummary(props.formData, props.destinations, t, props.wizardStep, props.previewQuery, props.generatedSqlQuery);
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

  // Show scroll to bottom button when user scrolls up significantly
  // Only show if there's enough content to scroll and user is not at bottom
  const hasScrollableContent = scrollHeight > clientHeight + 100; // At least 100px more content
  const isScrolledUp = scrollTop + clientHeight < scrollHeight - 100; // 100px from bottom

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

// Check scroll state when summary text changes
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

<style scoped lang="scss">
.alert-summary {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.summary-content {
  font-size: 0.8125rem;
  line-height: 2.2;
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.summary-text {
  margin: 0;
  white-space: pre-line;
  letter-spacing: 0.03em;

  // Styles for bold section labels (using :deep for v-html content with markdown **text**)
  :deep(strong) {
    display: inline;
    font-weight: 700;
    font-size: 0.875rem;
  }

  // Styles for clickable spans (using :deep for v-html content)
  :deep(.summary-clickable) {
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

    &:hover {
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

    &:active {
      transform: translateY(0) scale(0.98);
      background: color-mix(in srgb, var(--q-primary) 18%, transparent);
      box-shadow:
        0 0 0 0.0625rem color-mix(in srgb, var(--q-primary) 30%, transparent),
        inset 0 0.0625rem 0.125rem rgba(0, 0, 0, 0.1);
    }
  }

  // Styles for plain English section
  :deep(.plain-english-section) {
    margin-top: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--q-primary) 5%, transparent),
      color-mix(in srgb, var(--q-primary) 8%, transparent)
    );
    border-left: 0.1875rem solid var(--q-primary);
    font-size: 0.8125rem;
    line-height: 1.6;
    font-style: italic;
    opacity: 0.9;
  }
}

.summary-placeholder {
  margin: 0;
  font-style: italic;
  opacity: 0.6;
}

// Scroll to bottom button styling
.scroll-to-bottom-container {
  position: absolute;
  bottom: 20px;
  right: 20px;
  z-index: 1000;
  transition: all 0.3s ease;
  pointer-events: none;
}

.scroll-to-bottom-btn {
  transition: all 0.3s ease;
  pointer-events: auto;
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);

  body.body--light & {
    border: 2px solid var(--q-primary) !important;
    color: var(--q-primary) !important;
    background: rgba(255, 255, 255, 0.95) !important;
  }

  body.body--dark & {
    border: 2px solid var(--q-primary) !important;
    color: var(--q-primary) !important;
    background: rgba(30, 30, 30, 0.9) !important;
  }

  &:hover {
    transform: scale(1.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);

    body.body--light & {
      border: 2px solid var(--q-primary) !important;
      color: var(--q-primary) !important;
      background: rgba(255, 255, 255, 1) !important;
      opacity: 0.8;
    }

    body.body--dark & {
      border: 2px solid var(--q-primary) !important;
      color: var(--q-primary) !important;
      background: rgba(40, 40, 40, 0.95) !important;
      opacity: 0.8;
    }
  }

  &:active {
    transform: scale(1);
  }

  .q-icon {
    font-size: 18px;
    font-weight: bold;
  }
}

</style>
