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
  <div class="alert-summary card-container">
    <div class="summary-header">Alert Summary</div>
    <div class="summary-separator"></div>
    <div class="summary-content">
      <p v-if="summaryText" class="summary-text" v-html="summaryText" @click="handleSummaryClick"></p>
      <p v-else class="summary-placeholder">Configure your alert to see a summary</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { generateAlertSummary } from '@/utils/alerts/alertSummaryGenerator';

const store = useStore();

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
  }
});

const summaryText = computed(() => {
  return generateAlertSummary(props.formData, props.destinations);
});

const handleSummaryClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  const focusTarget = target.getAttribute('data-focus-target');

  if (focusTarget && props.focusManager) {
    props.focusManager.focusField(focusTarget);
  }
};
</script>

<style scoped lang="scss">
.alert-summary {
  padding: 16px;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.summary-header {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.summary-separator {
  height: 1px;
  background: linear-gradient(
    to right,
    transparent,
    color-mix(in srgb, currentColor 15%, transparent) 10%,
    color-mix(in srgb, currentColor 15%, transparent) 90%,
    transparent
  );
  margin-bottom: 16px;
  flex-shrink: 0;
}

.summary-content {
  font-size: 14px;
  line-height: 1.7; // Balanced line height - not too cramped, not too spacious
  flex: 1;
  overflow-y: auto;
}

.summary-text {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  letter-spacing: 0.03em; // Increased letter spacing

  // Styles for bold section labels (using :deep for v-html content with markdown **text**)
  :deep(strong) {
    display: inline;
    font-weight: 700;
    font-size: 14px;
  }

  // Styles for clickable spans (using :deep for v-html content)
  :deep(.summary-clickable) {
    cursor: pointer;
    color: var(--q-primary);
    font-weight: 600;
    padding: 4px 10px; // More generous padding
    margin: 0 3px; // More space between badges
    border-radius: 6px;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--q-primary) 8%, transparent),
      color-mix(in srgb, var(--q-primary) 12%, transparent)
    );
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    display: inline-block;
    position: relative;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--q-primary) 15%, transparent);
    line-height: 1.4; // Specific line height for badges
    vertical-align: baseline; // Better alignment with text
    white-space: nowrap; // Prevent badges from breaking across lines

    &:hover {
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--q-primary) 15%, transparent),
        color-mix(in srgb, var(--q-primary) 20%, transparent)
      );
      transform: translateY(-1px);
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--q-primary) 25%, transparent),
        0 2px 8px color-mix(in srgb, var(--q-primary) 15%, transparent);
    }

    &:active {
      transform: translateY(0) scale(0.98);
      background: color-mix(in srgb, var(--q-primary) 18%, transparent);
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--q-primary) 30%, transparent),
        inset 0 1px 2px rgba(0, 0, 0, 0.1);
    }
  }
}

.summary-placeholder {
  margin: 0;
  font-style: italic;
  opacity: 0.6;
}
</style>
