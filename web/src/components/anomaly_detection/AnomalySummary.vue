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
  <div class="relative flex h-full flex-col">
    <div
      class="text-compact flex-1 overflow-y-auto p-4 leading-[2.2]"
      ref="summaryContainer"
      @scroll="checkScrollState"
    >
      <p
        v-if="summaryText"
        class="summary-text m-0 tracking-[0.03em] whitespace-pre-line"
        v-html="summaryText"
      />
      <p v-else class="m-0 italic opacity-60">
        {{ t("alerts.anomaly.fillInSetupStepToSeeSummary") }}
      </p>
    </div>

    <div v-show="showScrollToBottom" class="pointer-events-none absolute right-5 bottom-5 z-1000">
      <OButton
        variant="ghost"
        size="icon-sm"
        class="!border-accent !text-accent !bg-surface-overlay pointer-events-auto !border-2 shadow-[0_2px_8px_rgba(0,0,0,0.2)] backdrop-blur-sm"
        data-test="anomaly-summary-scroll-btn"
        @click="scrollToBottom"
      >
        <OIcon name="arrow-downward" size="sm" />
        <OTooltip :content="t('alerts.anomaly.scrollToBottom')" side="top" align="center" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch, onMounted } from "vue";
import { generateAnomalySummary } from "@/utils/alerts/anomalySummaryGenerator";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

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
    summaryContainer.value.scrollTo({
      top: summaryContainer.value.scrollHeight,
      behavior: "smooth",
    });
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

<style scoped>
/* keep(generated-content): styles v-html output from anomalySummaryGenerator (no scope id) */
.summary-text :deep(strong) {
  display: inline;
  font-weight: 700;
  font-size: var(--text-sm);
}

.summary-text :deep(.summary-clickable) {
  cursor: default;
  color: var(--color-theme-accent);
  font-weight: 600;
  padding: 0.125rem 0.375rem;
  margin: 0 0.125rem;
  border-radius: 0.25rem;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--color-theme-accent) 8%, transparent),
    color-mix(in srgb, var(--color-theme-accent) 12%, transparent)
  );
  display: inline;
  position: relative;
  box-shadow: 0 0 0 0.0625rem color-mix(in srgb, var(--color-theme-accent) 15%, transparent);
  line-height: 1.6;
  vertical-align: baseline;
  white-space: nowrap;
}

.summary-text :deep(.plain-english-section) {
  padding: 0.75rem 1rem;
  border-radius: 0.375rem;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--color-theme-accent) 5%, transparent),
    color-mix(in srgb, var(--color-theme-accent) 8%, transparent)
  );
  border-left: 0.1875rem solid var(--color-theme-accent);
  font-size: var(--text-sm);
  line-height: 1.7;
  font-style: italic;
  opacity: 0.95;
  font-weight: 500;
}
</style>
