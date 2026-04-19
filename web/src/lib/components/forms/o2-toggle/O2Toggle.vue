// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
/**
 * O2Toggle — headless-first toggle/switch replacing q-toggle.
 *
 * Three-layer token strategy
 * ─────────────────────────
 * Layer 1 – Primitive  : SCSS $o2-* variables (web/src/styles/_variables.scss)
 * Layer 2 – Semantic   : CSS --o2-* custom properties (same file, :root / .body--dark)
 * Layer 3 – Component  : CSS --o2-toggle-* custom properties (this file)
 *
 * State is exposed as data attributes (Shadcn / Radix UI convention):
 *   data-state="checked|unchecked"
 *   data-disabled  — present when disabled
 */

import { computed, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

export interface O2ToggleProps {
  modelValue?: boolean | unknown[] | null;
  val?: unknown;
  trueValue?: unknown;
  falseValue?: unknown;
  label?: string;
  leftLabel?: boolean;
  dense?: boolean;
  disable?: boolean;
  color?: string;
  keepColor?: boolean;
}

const props = withDefaults(defineProps<O2ToggleProps>(), {
  trueValue: true,
  falseValue: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: boolean | unknown[] | null];
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

// ─── Checked state ────────────────────────────────────────────────────────────

const isArray = computed(() => Array.isArray(props.modelValue));

const isChecked = computed(() => {
  if (isArray.value) {
    return (props.modelValue as unknown[]).includes(props.val);
  }
  return props.modelValue === props.trueValue;
});

const dataState = computed(() => (isChecked.value ? "checked" : "unchecked"));

// ─── Toggle handler ───────────────────────────────────────────────────────────

const toggle = () => {
  if (props.disable) return;

  if (isArray.value) {
    const arr = [...(props.modelValue as unknown[])];
    const idx = arr.indexOf(props.val);
    if (idx === -1) {
      arr.push(props.val);
    } else {
      arr.splice(idx, 1);
    }
    emit("update:modelValue", arr);
    return;
  }

  if (isChecked.value) {
    emit("update:modelValue", props.falseValue as boolean);
  } else {
    emit("update:modelValue", props.trueValue as boolean);
  }
};
</script>

<template>
  <label
    class="o2-toggle"
    :class="[
      { 'o2-toggle--left-label': leftLabel, 'o2-toggle--dense': dense },
      rootBindings.class,
    ]"
    :style="rootBindings.style as string"
    :data-test="rootBindings['data-test'] as string"
    :data-state="dataState"
    :data-disabled="disable || undefined"
    @click.prevent="toggle"
    @keydown.space.prevent="toggle"
    @keydown.enter.prevent="toggle"
  >
    <span
      v-if="label && leftLabel"
      class="o2-toggle__label o2-toggle__label--left"
    >
      {{ label }}
    </span>
    <slot v-if="leftLabel" />

    <span
      class="o2-toggle__track"
      role="switch"
      :aria-checked="isChecked ? 'true' : 'false'"
      :aria-disabled="disable ? 'true' : undefined"
      :tabindex="disable ? -1 : 0"
    >
      <span class="o2-toggle__thumb" />
    </span>

    <span v-if="label && !leftLabel" class="o2-toggle__label">{{ label }}</span>
    <slot v-if="!leftLabel" />
  </label>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2Toggle styles — global (non-scoped) BEM under .o2-toggle namespace.
// State is targeted via data attributes.
//
// ─── Layer 3: Component Tokens ───────────────────────────────────────────────

.o2-toggle {
  --o2-toggle-track-w: 1.75rem;
  --o2-toggle-track-h: 1rem;
  --o2-toggle-track-radius: 0.5rem;
  --o2-toggle-thumb-size: 0.75rem;
  --o2-toggle-thumb-travel: calc(
    var(--o2-toggle-track-w) - var(--o2-toggle-thumb-size) - 2px
  );
  --o2-toggle-gap: 0.375rem;
  --o2-toggle-font-size: 0.8125rem;

  --o2-toggle-track-off: var(--o2-toggle-track-off-bg);
  --o2-toggle-track-on: var(--o2-toggle-track-bg);
  --o2-toggle-thumb-color: #fff;
  --o2-toggle-label-color: var(--o2-text-primary);
  --o2-toggle-focus-ring: var(--o2-primary-color);

  // ─── Root ─────────────────────────────────────────────────────────────────
  display: inline-flex;
  align-items: center;
  gap: var(--o2-toggle-gap);
  cursor: pointer;
  user-select: none;
  font-size: var(--o2-toggle-font-size);
  line-height: 1;
  vertical-align: middle;

  &--left-label {
    flex-direction: row-reverse;
  }

  // ─── Track ────────────────────────────────────────────────────────────────
  &__track {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    width: var(--o2-toggle-track-w);
    height: var(--o2-toggle-track-h);
    border-radius: var(--o2-toggle-track-radius);
    background: var(--o2-toggle-track-off);
    transition: background 0.2s ease;

    &:focus-visible {
      outline: 2px solid var(--o2-toggle-focus-ring);
      outline-offset: 1px;
    }
  }

  // ─── Thumb ────────────────────────────────────────────────────────────────
  &__thumb {
    position: absolute;
    left: 1px;
    width: var(--o2-toggle-thumb-size);
    height: var(--o2-toggle-thumb-size);
    border-radius: 50%;
    background: var(--o2-toggle-thumb-color);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transform: translateX(0);
    transition: transform 0.2s ease;
  }

  // ─── Label ────────────────────────────────────────────────────────────────
  &__label {
    color: var(--o2-toggle-label-color);
    line-height: 1.3;
  }

  // ─── State: checked ───────────────────────────────────────────────────────
  &[data-state="checked"] &__track {
    background: var(--o2-toggle-track-on);
  }

  &[data-state="checked"] &__thumb {
    transform: translateX(var(--o2-toggle-thumb-travel));
  }

  // ─── Dense ────────────────────────────────────────────────────────────────
  &--dense {
    --o2-toggle-track-w: 1.5rem;
    --o2-toggle-track-h: 0.875rem;
    --o2-toggle-thumb-size: 0.625rem;
    --o2-toggle-gap: 0.25rem;
    --o2-toggle-font-size: 0.75rem;
  }

  // ─── State: disabled ──────────────────────────────────────────────────────
  &[data-disabled] {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  // ─── Hover (not disabled) ─────────────────────────────────────────────────
  &:hover:not([data-disabled]) &__track {
    filter: brightness(0.95);
  }
}
</style>
