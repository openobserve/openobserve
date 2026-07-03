<template>
  <div
    :data-test="dataTest"
    class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:flex-1 tw:min-h-[320px] tw:py-12 tw:px-6 tw:text-center"
  >
    <div
      class="tw:w-[100px] tw:h-[100px] tw:rounded-full tw:border tw:border-dashed tw:border-[rgba(66,133,244,0.25)] tw:flex tw:items-center tw:justify-center tw:mb-7"
      :class="isDark ? 'tw:border-[rgba(66,133,244,0.3)]' : ''"
    >
      <div
        class="tw:w-[68px] tw:h-[68px] tw:rounded-full tw:flex tw:items-center tw:justify-center tw:border-[1.5px] tw:border-solid"
        :class="isDark
          ? 'tw:bg-[rgba(66,133,244,0.18)] tw:border-[rgba(66,133,244,0.35)]'
          : 'tw:bg-[rgba(66,133,244,0.09)] tw:border-[rgba(66,133,244,0.22)]'"
      >
        <OIcon :name="icon" size="lg" class="tw:text-[var(--q-primary)] tw:opacity-[0.85]" />
      </div>
    </div>

    <div class="tw:text-[1.2rem] tw:font-bold tw:tracking-[-0.2px] tw:text-[var(--color-text-primary,#111827)] tw:mb-[10px]">{{ title }}</div>

    <div class="tw:text-[0.88rem] tw:leading-[1.65] tw:text-[var(--color-text-secondary,#6b7280)] tw:max-w-[500px] tw:mb-6">{{ description }}</div>

    <div v-if="chips && chips.length" data-test="eval-empty-state-chips" class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap tw:justify-center tw:mb-8">
      <span
        v-for="(chip, idx) in chips"
        :key="idx"
        data-test="eval-empty-state-chip"
        class="tw:inline-flex tw:items-center tw:gap-[5px] tw:text-xs tw:font-medium tw:text-(--color-text-secondary,#6b7280) tw:rounded-[20px] tw:py-1 tw:px-3 tw:border tw:border-solid"
        :class="isDark
          ? 'tw:bg-[rgba(255,255,255,0.06)] tw:border-[rgba(255,255,255,0.1)]'
          : 'tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_8%,transparent)] tw:border-(--color-dialog-header-border,var(--o2-border))'"
      >
        <OIcon v-if="chip.icon" :name="chip.icon" size="xs" />
        {{ chip.label }}
      </span>
    </div>

    <!-- Actions row is rendered only when there's something to show
         (either a primary CTA or a secondary slot). Pure informational
         empty states (e.g. "no data in window") pass neither. -->
    <div v-if="ctaLabel || $slots.secondary" class="tw:flex tw:items-center tw:gap-3">
      <OButton
        v-if="ctaLabel"
        :data-test="ctaDataTest"
        variant="primary"
        size="md"
        class="tw:h-10 tw:px-6 tw:text-[0.92rem] tw:font-semibold"
        @click="$emit('create')"
      >
        {{ ctaLabel }}
      </OButton>
      <slot name="secondary" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

interface EmptyStateChip {
  icon?: string;
  label: string;
}

defineProps<{
  dataTest: string;
  icon: string;
  title: string;
  description: string;
  chips?: EmptyStateChip[];
  /** Omit to render an informational empty state with no CTA. */
  ctaLabel?: string;
  ctaDataTest?: string;
}>();

defineEmits<{ (e: "create"): void }>();

const store = useStore();
const isDark = computed(() => store.state.theme === "dark");
</script>
