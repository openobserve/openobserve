<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  Row stepper for the experiment drawers. Sits in the drawer FOOTER: paging is
  something you reach for after reading the row, not before, and a footer keeps
  it in the same place whatever the body scrolled to. Icon-only — the position
  readout beside it already says what the arrows do.
-->
<template>
  <div class="flex items-center justify-center gap-3" :data-test="dataTest">
    <OButton
      size="icon"
      variant="outline"
      icon-left="chevron-left"
      :disabled="!hasPrevious"
      :aria-label="t('aiObservability.experiments.rowDetail.previousRow')"
      :data-test="`${dataTest}-previous`"
      @click="$emit('previous')"
    />
    <span class="text-text-secondary text-xs">
      {{ t("aiObservability.experiments.rowDetail.rowPosition", { index, total }) }}
    </span>
    <OButton
      size="icon"
      variant="outline"
      icon-left="chevron-right"
      :disabled="!hasNext"
      :aria-label="t('aiObservability.experiments.rowDetail.nextRow')"
      :data-test="`${dataTest}-next`"
      @click="$emit('next')"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";

defineProps<{
  /** 1-based position, for display. */
  index: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  dataTest: string;
}>();

defineEmits<{ previous: []; next: [] }>();

const { t } = useI18nTyped();
</script>
