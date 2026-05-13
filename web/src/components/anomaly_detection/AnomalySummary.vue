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
  <div class="anomaly-summary">
    <div
      class="summary-content"
      ref="summaryContainer"
      @scroll="checkScrollState"
    >
      <p
        v-if="summaryText"
        class="summary-text"
        v-html="summaryText"
      />
      <p v-else class="summary-placeholder">
        Fill in the setup step to see a summary.
      </p>
    </div>

    <div v-show="showScrollToBottom" class="scroll-to-bottom-container">
      <OButton
        variant="ghost"
        size="icon-sm"
        class="scroll-to-bottom-btn"
        data-test="anomaly-summary-scroll-btn"
        @click="scrollToBottom"
      >
        <OIcon name="arrow-downward" size="sm" />
        <q-tooltip anchor="top middle" self="bottom middle">
          Scroll to bottom
        </q-tooltip>
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch, onMounted } from 'vue';
import { generateAnomalySummary } from '@/utils/alerts/anomalySummaryGenerator';
import OButton from '@/lib/core/Button/OButton.vue';
import OIcon from '@/lib/core/Icon/OIcon.vue';

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

<style scoped lang="scss">
.anomaly-summary {
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

  :deep(strong) {
    display: inline;
    font-weight: 700;
    font-size: 0.875rem;
  }

  :deep(.summary-clickable) {
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

  :deep(.plain-english-section) {
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
}

.summary-placeholder {
  margin: 0;
  font-style: italic;
  opacity: 0.6;
}

.scroll-to-bottom-container {
  position: absolute;
  bottom: 1.25rem;
  right: 1.25rem;
  z-index: 1000;
  pointer-events: none;
}

.scroll-to-bottom-btn {
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
}
</style>
