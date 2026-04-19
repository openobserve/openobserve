// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
/**
 * O2Radio — headless-first radio button replacing q-radio.
 *
 * Three-layer token strategy:
 *   Layer 1 – Primitive  : $o2-* SCSS vars  (_variables.scss)
 *   Layer 2 – Semantic   : --o2-* CSS props  (_variables.scss)
 *   Layer 3 – Component  : --o2-radio-* CSS props (this file)
 *
 * State is exposed as data attributes (Shadcn / Radix UI convention):
 *   data-state="selected|unselected"
 *   data-disabled  — present when disabled
 */

import { computed, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

export interface O2RadioProps {
  modelValue?: unknown;
  val: unknown;
  label?: string;
  leftLabel?: boolean;
  dense?: boolean;
  disable?: boolean;
  color?: string;
}

const props = withDefaults(defineProps<O2RadioProps>(), {
  dense: false,
  disable: false,
  leftLabel: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: unknown];
}>();

const attrs = useAttrs();

const rootBindings = computed(() => {
  const {
    class: cls,
    style,
    "data-test": dt,
  } = attrs as Record<string, unknown>;
  return { class: cls, style, "data-test": dt };
});

const isSelected = computed(() => props.modelValue === props.val);

const handleSelect = () => {
  if (props.disable) return;
  emit("update:modelValue", props.val);
};
</script>

<template>
  <label
    class="o2-radio"
    :class="[
      { 'o2-radio--dense': dense, 'o2-radio--left-label': leftLabel },
      rootBindings.class,
    ]"
    :style="rootBindings.style as string"
    :data-test="rootBindings['data-test'] as string"
    :data-state="isSelected ? 'selected' : 'unselected'"
    :data-disabled="disable || undefined"
    @click.prevent="handleSelect"
    @keydown.space.prevent="handleSelect"
    @keydown.enter.prevent="handleSelect"
  >
    <span
      v-if="(label || $slots.default) && leftLabel"
      class="o2-radio__label o2-radio__label--left"
    >
      {{ label }}<slot />
    </span>

    <span
      class="o2-radio__box"
      role="radio"
      :aria-checked="isSelected"
      :aria-disabled="disable ? 'true' : undefined"
      tabindex="0"
    >
      <span v-if="isSelected" class="o2-radio__dot" />
    </span>

    <span
      v-if="(label || $slots.default) && !leftLabel"
      class="o2-radio__label"
    >
      {{ label }}<slot />
    </span>
  </label>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2Radio styles — global (non-scoped) BEM under .o2-radio namespace.
// State is targeted via data attributes.

.o2-radio {
  // ─── Layer 3: Component Tokens ─────────────────────────────────────────────
  --o2-radio-size: 0.875rem;
  --o2-radio-dot-size: 0.4375rem;
  --o2-radio-border: var(--o2-border-input);
  --o2-radio-border-selected: var(--o2-primary-color);
  --o2-radio-dot-color: var(--o2-primary-color);
  --o2-radio-font-size: 0.8125rem;
  --o2-radio-gap: 0.375rem;
  --o2-radio-label-color: var(--o2-text-primary);

  // ─── Structure ──────────────────────────────────────────────────────────────
  display: inline-flex;
  align-items: center;
  gap: var(--o2-radio-gap);
  font-size: var(--o2-radio-font-size);
  cursor: pointer;
  user-select: none;
  line-height: 1;

  &--left-label {
    flex-direction: row; // label is first in DOM when leftLabel
  }

  // ─── Radio box ──────────────────────────────────────────────────────────────
  &__box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--o2-radio-size);
    height: var(--o2-radio-size);
    border: 1px solid var(--o2-radio-border);
    border-radius: 50%;
    background: transparent;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
    outline: none;

    &:focus-visible {
      box-shadow: 0 0 0 2px var(--o2-primary-color);
    }
  }

  // ─── State: selected ──────────────────────────────────────────────────────
  &[data-state="selected"] &__box {
    border-color: var(--o2-radio-border-selected);
  }

  // ─── Dot (selected indicator) ────────────────────────────────────────────
  &__dot {
    display: block;
    width: var(--o2-radio-dot-size);
    height: var(--o2-radio-dot-size);
    border-radius: 50%;
    background: var(--o2-radio-dot-color);
  }

  // ─── Label ──────────────────────────────────────────────────────────────────
  &__label {
    color: var(--o2-radio-label-color);
    line-height: 1.4;
  }

  // ─── Dense variant ───────────────────────────────────────────────────────────
  &--dense {
    --o2-radio-size: 0.75rem;
    --o2-radio-dot-size: 0.375rem;
    --o2-radio-gap: 0.25rem;
  }

  // ─── State: disabled ─────────────────────────────────────────────────────────
  &[data-disabled] {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
}
</style>
