// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
/**
 * O2Checkbox — headless-first checkbox replacing q-checkbox.
 *
 * Three-layer token strategy
 * ─────────────────────────
 * Layer 1 – Primitive  : SCSS $o2-* variables (web/src/styles/_variables.scss)
 * Layer 2 – Semantic   : CSS --o2-* custom properties (same file, :root / .body--dark)
 * Layer 3 – Component  : CSS --o2-checkbox-* custom properties (this file)
 *
 * State is exposed as data attributes (Shadcn / Radix UI convention):
 *   data-state="checked|unchecked|indeterminate"
 *   data-disabled   — present when disabled
 *
 * v-model behavior:
 *   Array modelValue  → toggle `val` in/out of the array
 *   Boolean           → toggle true/false
 *   trueValue/falseValue set → use those values instead of true/false
 */

import { computed, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

export interface O2CheckboxProps {
  modelValue?: boolean | unknown[] | null;
  val?: unknown;
  trueValue?: unknown;
  falseValue?: unknown;
  indeterminate?: boolean;
  label?: string;
  leftLabel?: boolean;
  dense?: boolean;
  disable?: boolean;
  color?: string;
  keepColor?: boolean;
}

const props = withDefaults(defineProps<O2CheckboxProps>(), {
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

const isIndeterminate = computed(() => {
  if (props.indeterminate) return true;
  if (!isArray.value && props.modelValue === null) return true;
  return false;
});

const dataState = computed(() => {
  if (isIndeterminate.value) return "indeterminate";
  return isChecked.value ? "checked" : "unchecked";
});

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

const ariaChecked = computed(() => {
  if (isIndeterminate.value) return "mixed";
  return isChecked.value ? "true" : "false";
});
</script>

<template>
  <label
    class="o2-checkbox"
    :class="[
      { 'o2-checkbox--left-label': leftLabel, 'o2-checkbox--dense': dense },
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
      class="o2-checkbox__label o2-checkbox__label--left"
    >
      {{ label }}
    </span>
    <slot v-if="leftLabel" />

    <span
      class="o2-checkbox__box"
      role="checkbox"
      :aria-checked="ariaChecked"
      :aria-disabled="disable ? 'true' : undefined"
      :tabindex="disable ? -1 : 0"
    >
      <svg
        v-if="isChecked && !isIndeterminate"
        class="o2-checkbox__checkmark"
        viewBox="0 0 10 8"
        width="10"
        height="8"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M1 3.5L3.8 6.5L9 1"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>

      <svg
        v-else-if="isIndeterminate"
        class="o2-checkbox__dash"
        viewBox="0 0 8 2"
        width="8"
        height="2"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M0 1h8"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    </span>

    <span v-if="label && !leftLabel" class="o2-checkbox__label">{{
      label
    }}</span>
    <slot v-if="!leftLabel" />
  </label>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2Checkbox styles — global (non-scoped) BEM under .o2-checkbox namespace.
// State is targeted via data attributes.
//
// ─── Layer 3: Component Tokens ───────────────────────────────────────────────

.o2-checkbox {
  --o2-checkbox-size: 0.875rem;
  --o2-checkbox-radius: 0.1875rem;
  --o2-checkbox-gap: 0.375rem;
  --o2-checkbox-font-size: 0.8125rem;

  --o2-checkbox-border: var(--o2-border-input);
  --o2-checkbox-bg: transparent;
  --o2-checkbox-checked-bg: var(--o2-primary-color);
  --o2-checkbox-checked-border: var(--o2-primary-color);
  --o2-checkbox-mark-color: #fff;
  --o2-checkbox-label-color: var(--o2-text-primary);
  --o2-checkbox-focus-ring: var(--o2-primary-color);

  // ─── Root ─────────────────────────────────────────────────────────────────
  display: inline-flex;
  align-items: center;
  gap: var(--o2-checkbox-gap);
  cursor: pointer;
  user-select: none;
  font-size: var(--o2-checkbox-font-size);
  line-height: 1;
  vertical-align: middle;

  &--left-label {
    flex-direction: row-reverse;
  }

  // ─── Box ──────────────────────────────────────────────────────────────────
  &__box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--o2-checkbox-size);
    height: var(--o2-checkbox-size);
    border: 1px solid var(--o2-checkbox-border);
    border-radius: var(--o2-checkbox-radius);
    background: var(--o2-checkbox-bg);
    transition:
      background 0.12s ease,
      border-color 0.12s ease;

    &:focus-visible {
      outline: 2px solid var(--o2-checkbox-focus-ring);
      outline-offset: 1px;
    }
  }

  // ─── Checkmark / dash ─────────────────────────────────────────────────────
  &__checkmark,
  &__dash {
    color: var(--o2-checkbox-mark-color);
    display: block;
    flex-shrink: 0;
  }

  // ─── Label ────────────────────────────────────────────────────────────────
  &__label {
    color: var(--o2-checkbox-label-color);
    line-height: 1.3;
  }

  // ─── State: checked / indeterminate ───────────────────────────────────────
  &[data-state="checked"] &__box,
  &[data-state="indeterminate"] &__box {
    background: var(--o2-checkbox-checked-bg);
    border-color: var(--o2-checkbox-checked-border);
  }

  // ─── Dense ────────────────────────────────────────────────────────────────
  &--dense {
    --o2-checkbox-size: 0.75rem;
    --o2-checkbox-gap: 0.25rem;
    --o2-checkbox-font-size: 0.75rem;
  }

  // ─── State: disabled ──────────────────────────────────────────────────────
  &[data-disabled] {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  // ─── Hover (not disabled, not checked) ────────────────────────────────────
  &:hover:not([data-disabled]):not([data-state="checked"]) &__box {
    border-color: var(--o2-primary-color);
  }
}
</style>
