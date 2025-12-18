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
    <div class="summary-content">
      <p v-if="summaryText" class="summary-text" v-html="summaryText" @click="handleSummaryClick"></p>
      <p v-else class="summary-placeholder">{{ t('alerts.summary.configureAlert') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { generateAlertSummary } from '@/utils/alerts/alertSummaryGenerator';

const store = useStore();
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
</script>

<style scoped lang="scss">
.alert-summary {
  height: 100%;
  display: flex;
  flex-direction: column;
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
  white-space: pre-wrap;
  word-wrap: break-word;
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
    padding: 0.25rem 0.625rem;
    margin: 0 0.1875rem;
    border-radius: 0.375rem;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--q-primary) 8%, transparent),
      color-mix(in srgb, var(--q-primary) 12%, transparent)
    );
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    display: inline;
    position: relative;
    box-shadow: 0 0 0 0.0625rem color-mix(in srgb, var(--q-primary) 15%, transparent);
    line-height: 1.4;
    vertical-align: baseline;
    white-space: normal;
    word-break: break-word;

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
</style>
