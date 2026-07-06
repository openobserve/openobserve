<template>
  <div
    :data-test="dataTest"
    class="flex flex-col items-center justify-center flex-1 min-h-[320px] py-12 px-6 text-center"
  >
    <div
      class="w-[100px] h-[100px] rounded-full border border-dashed border-[rgba(66,133,244,0.25)] flex items-center justify-center mb-7"
      :class="isDark ? 'border-[rgba(66,133,244,0.3)]' : ''"
    >
      <div
        class="w-[68px] h-[68px] rounded-full flex items-center justify-center border-[1.5px] border-solid"
        :class="isDark
          ? 'bg-[rgba(66,133,244,0.18)] border-[rgba(66,133,244,0.35)]'
          : 'bg-[rgba(66,133,244,0.09)] border-[rgba(66,133,244,0.22)]'"
      >
        <OIcon :name="icon" size="lg" class="text-[var(--q-primary)] opacity-[0.85]" />
      </div>
    </div>

    <div class="text-[1.2rem] font-bold tracking-[-0.2px] text-[var(--color-text-primary,#111827)] mb-[10px]">{{ title }}</div>

    <div class="text-[0.88rem] leading-[1.65] text-[var(--color-text-secondary,#6b7280)] max-w-[500px] mb-6">{{ description }}</div>

    <div v-if="chips && chips.length" data-test="eval-empty-state-chips" class="flex items-center gap-2 flex-wrap justify-center mb-8">
      <span
        v-for="(chip, idx) in chips"
        :key="idx"
        data-test="eval-empty-state-chip"
        class="inline-flex items-center gap-[5px] text-xs font-medium text-(--color-text-secondary,#6b7280) rounded-[20px] py-1 px-3 border border-solid"
        :class="isDark
          ? 'bg-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.1)]'
          : 'bg-[color-mix(in_srgb,var(--color-text-secondary)_8%,transparent)] border-(--color-dialog-header-border,var(--o2-border))'"
      >
        <OIcon v-if="chip.icon" :name="chip.icon" size="xs" />
        {{ chip.label }}
      </span>
    </div>

    <!-- Actions row is rendered only when there's something to show
         (either a primary CTA or a secondary slot). Pure informational
         empty states (e.g. "no data in window") pass neither. -->
    <div v-if="ctaLabel || $slots.secondary" class="flex items-center gap-3">
      <OButton
        v-if="ctaLabel"
        :data-test="ctaDataTest"
        variant="primary"
        size="md"
        class="h-10 px-6 text-[0.92rem] font-semibold"
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
