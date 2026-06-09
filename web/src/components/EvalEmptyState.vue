<template>
  <div
    :data-test="dataTest"
    class="ev-empty"
    :class="{ 'ev-empty--dark': isDark }"
  >
    <div class="ev-empty__icon-outer">
      <div
        class="ev-empty__icon-inner"
        :class="{ 'ev-empty__icon-inner--dark': isDark }"
      >
        <OIcon :name="icon" size="lg" class="ev-empty__icon" />
      </div>
    </div>

    <div class="ev-empty__title">{{ title }}</div>

    <div class="ev-empty__desc">{{ description }}</div>

    <div v-if="chips && chips.length" class="ev-empty__chips">
      <span
        v-for="(chip, idx) in chips"
        :key="idx"
        class="ev-empty__chip"
        :class="{ 'ev-empty__chip--dark': isDark }"
      >
        <OIcon v-if="chip.icon" :name="chip.icon" size="xs" />
        {{ chip.label }}
      </span>
    </div>

    <!-- Actions row is rendered only when there's something to show
         (either a primary CTA or a secondary slot). Pure informational
         empty states (e.g. "no data in window") pass neither. -->
    <div v-if="ctaLabel || $slots.secondary" class="ev-empty__actions">
      <OButton
        v-if="ctaLabel"
        :data-test="ctaDataTest"
        variant="primary"
        size="md"
        class="ev-empty__btn"
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

<style lang="scss" scoped>
.ev-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 320px;
  padding: 48px 24px;
  text-align: center;

  &__icon-outer {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    border: 1px dashed rgba(66, 133, 244, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 28px;

    .ev-empty--dark & { border-color: rgba(66, 133, 244, 0.3); }
  }

  &__icon-inner {
    width: 68px;
    height: 68px;
    border-radius: 50%;
    background: rgba(66, 133, 244, 0.09);
    border: 1.5px solid rgba(66, 133, 244, 0.22);
    display: flex;
    align-items: center;
    justify-content: center;

    &--dark {
      background: rgba(66, 133, 244, 0.18);
      border-color: rgba(66, 133, 244, 0.35);
    }
  }

  &__icon {
    color: var(--q-primary);
    opacity: 0.85;
  }

  &__title {
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: -0.2px;
    color: var(--color-text-primary, #111827);
    margin-bottom: 10px;
  }

  &__desc {
    font-size: 0.88rem;
    line-height: 1.65;
    color: var(--color-text-secondary, #6b7280);
    max-width: 500px;
    margin-bottom: 24px;
  }

  &__chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: 32px;
  }

  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary, #6b7280);
    background: color-mix(in srgb, var(--color-text-secondary) 8%, transparent);
    border: 1px solid var(--color-dialog-header-border, var(--o2-border));
    border-radius: 20px;
    padding: 4px 12px;

    &--dark {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.1);
    }
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__btn {
    height: 40px;
    padding: 0 24px;
    font-size: 0.92rem;
    font-weight: 600;
  }
}
</style>
