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
  <div data-test="patterns-patternskeleton-container">
    <!-- Step indicator -->
    <div
      class="tw:flex tw:items-center tw:justify-center tw:gap-[0.5rem] tw:mb-[1rem] tw:text-sm tw:text-[var(--o2-text-secondary)]"
      data-test="patterns-patternskeleton-step"
    >
      <q-icon name="hourglass_empty" size="1rem" class="tw:animate-spin" />
      <span>{{ stepText }}</span>
    </div>

    <!-- Skeleton cards -->
    <div
      v-for="i in 8"
      :key="i"
      class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-[0.75rem] tw:mb-[0.5rem]"
      :data-test="`patterns-patternskeleton-card-${i}`"
    >
      <!-- Template skeleton -->
      <q-skeleton type="text" class="tw:mb-[0.5rem]" style="width: 80%; height: 1rem" />
      <q-skeleton type="text" class="tw:mb-[0.75rem]" style="width: 45%; height: 0.75rem" />

      <!-- Frequency bar skeleton -->
      <q-skeleton type="rect" class="tw:mb-[0.5rem]" style="width: 100%; height: 0.375rem" />

      <!-- Stats + buttons skeleton -->
      <div class="tw:flex tw:items-center tw:gap-[0.5rem]">
        <q-skeleton type="text" style="width: 6rem; height: 0.875rem" />
        <div class="tw:flex-1" />
        <q-skeleton type="rect" style="width: 4rem; height: 1.75rem" />
        <q-skeleton type="rect" style="width: 4rem; height: 1.75rem" />
        <q-skeleton type="rect" style="width: 4rem; height: 1.75rem" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const steps = [
  t("search.patternLoadingSampling"),
  t("search.patternLoadingExtracting"),
  t("search.patternLoadingClustering"),
];

const stepText = ref(steps[0]);

let stepInterval: ReturnType<typeof setInterval> | null = null;

const startStepRotation = () => {
  let current = 0;
  stepText.value = steps[0];
  stepInterval = setInterval(() => {
    current = (current + 1) % steps.length;
    stepText.value = steps[current];
  }, 3000);
};

const stopStepRotation = () => {
  if (stepInterval) {
    clearInterval(stepInterval);
    stepInterval = null;
  }
};

watch(
  () => true,
  () => {
    startStepRotation();
  },
  { immediate: true },
);

onUnmounted(stopStepRotation);
</script>
