// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
/**
 * O2Field — headless-first form-field wrapper replacing q-field.
 *
 * Three-layer token strategy
 * ─────────────────────────
 * Layer 1 – Primitive  : SCSS $o2-* variables (web/src/styles/_variables.scss)
 * Layer 2 – Semantic   : CSS --o2-* custom properties (same file, :root / .body--dark)
 * Layer 3 – Component  : CSS --o2-field-* custom properties (this file)
 *
 * State is exposed as data attributes (Shadcn / Radix UI convention):
 *   data-variant="outlined|borderless|filled"
 *   data-focused   — present when inner content has focus
 *   data-invalid   — present when validation fails or error prop is true
 *   data-disabled  — present when disabled
 *   data-readonly  — present when readonly
 *   data-loading   — present when loading
 */

import { computed, ref, useAttrs, useSlots } from "vue";

defineOptions({ inheritAttrs: false });

export interface O2FieldProps {
  label?: string;
  stackLabel?: boolean;
  hint?: string;
  error?: boolean;
  errorMessage?: string;
  hideBottomSpace?: boolean;
  noErrorIcon?: boolean;
  dense?: boolean;
  loading?: boolean;
  disable?: boolean;
  readonly?: boolean;
  variant?: "outlined" | "borderless" | "filled";
  rules?: Array<(val: unknown) => true | string>;
  lazyRules?: boolean | "ondemand";
  modelValue?: unknown;
}

const props = withDefaults(defineProps<O2FieldProps>(), {
  variant: "outlined",
});

const attrs = useAttrs();
const slots = useSlots();

const isDirty = ref(false);
const internalError = ref<string | null>(null);
const isFocused = ref(false);

// ─── Validation ───────────────────────────────────────────────────────────────

const runValidation = (value: unknown): boolean => {
  if (!props.rules?.length) {
    internalError.value = null;
    return true;
  }
  for (const rule of props.rules) {
    const result = rule(value);
    if (result !== true) {
      internalError.value = result;
      return false;
    }
  }
  internalError.value = null;
  return true;
};

const validate = (): boolean => {
  isDirty.value = true;
  return runValidation(props.modelValue);
};

const resetValidation = (): void => {
  isDirty.value = false;
  internalError.value = null;
};

defineExpose({ validate, resetValidation });

// ─── Computed state ───────────────────────────────────────────────────────────

const hasError = computed(
  () => !!(props.error || (isDirty.value && internalError.value)),
);

const errorText = computed<string>(() => {
  if (props.error) return props.errorMessage ?? "";
  if (isDirty.value) return internalError.value ?? "";
  return "";
});

const showBottom = computed(() => {
  if (props.hideBottomSpace)
    return hasError.value || !!props.hint || !!slots.hint;
  return true;
});

// ─── Attr splitting ───────────────────────────────────────────────────────────

const rootBindings = computed(() => {
  const {
    class: cls,
    style,
    "data-test": dt,
  } = attrs as Record<string, unknown>;
  return { class: cls, style, "data-test": dt };
});
</script>

<template>
  <div
    class="o2-field"
    :class="rootBindings.class"
    :style="rootBindings.style as string"
    :data-test="rootBindings['data-test'] as string"
    :data-variant="variant"
    :data-focused="isFocused || undefined"
    :data-invalid="hasError || undefined"
    :data-disabled="disable || undefined"
    :data-readonly="readonly || undefined"
    :data-loading="loading || undefined"
    @focusin="isFocused = true"
    @focusout="isFocused = false"
  >
    <label v-if="label" class="o2-field__label">{{ label }}</label>

    <div class="o2-field__control">
      <div
        v-if="$slots.prepend"
        class="o2-field__adornment o2-field__adornment--pre"
      >
        <slot name="prepend" />
      </div>

      <div class="o2-field__inner">
        <slot />
      </div>

      <span v-if="loading" class="o2-field__spinner"
aria-hidden="true" />

      <div
        v-if="$slots.append"
        class="o2-field__adornment o2-field__adornment--app"
      >
        <slot name="append" />
      </div>
    </div>

    <div v-if="showBottom" class="o2-field__bottom">
      <span v-if="hasError" class="o2-field__error-text"
role="alert">
        <svg
          v-if="!noErrorIcon"
          class="o2-field__error-icon"
          viewBox="0 0 12 12"
          width="10"
          height="10"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle
            cx="6"
            cy="6"
            r="5"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <path
            d="M6 3.5v3M6 8.2v.3"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
        {{ errorText }}
      </span>
      <span v-else-if="$slots.hint" class="o2-field__hint-text">
        <slot name="hint" />
      </span>
      <span v-else-if="hint" class="o2-field__hint-text">{{ hint }}</span>
    </div>
  </div>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2Field styles — global (non-scoped) BEM under .o2-field namespace.
// State is targeted via data attributes.
//
// ─── Layer 3: Component Tokens ───────────────────────────────────────────────

.o2-field {
  --o2-field-height: 1.75rem;
  --o2-field-font-size: 0.8125rem;
  --o2-field-font-family: inherit;
  --o2-field-pad-x: 0.5rem;
  --o2-field-pad-y: 0;
  --o2-field-radius: 0.25rem;
  --o2-field-gap: 0.25rem;

  --o2-field-bg: transparent;
  --o2-field-text: var(--o2-text-primary);
  --o2-field-border: var(--o2-border-input);
  --o2-field-border-focus: var(--o2-primary-color);
  --o2-field-border-error: var(--o2-status-error-text);
  --o2-field-shadow-focus: none;

  --o2-field-label-size: 0.6875rem;
  --o2-field-label-weight: 500;
  --o2-field-label-color: var(--o2-input-label-text-color);
  --o2-field-label-gap: 0.1875rem;

  --o2-field-adornment-color: var(--o2-text-muted);

  --o2-field-bottom-size: 0.6875rem;
  --o2-field-bottom-min-h: 1.125rem;
  --o2-field-bottom-gap: 0.1875rem;
  --o2-field-error-color: var(--o2-status-error-text);
  --o2-field-hint-color: var(--o2-text-muted);

  // ─── Structure ────────────────────────────────────────────────────────────
  display: inline-flex;
  flex-direction: column;
  position: relative;
  width: 100%;
  font-size: var(--o2-field-font-size);
  font-family: var(--o2-field-font-family);

  // ─── Label ────────────────────────────────────────────────────────────────
  &__label {
    display: block;
    font-size: var(--o2-field-label-size);
    font-weight: var(--o2-field-label-weight);
    color: var(--o2-field-label-color);
    margin-bottom: var(--o2-field-label-gap);
    line-height: 1;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  // ─── Control ──────────────────────────────────────────────────────────────
  &__control {
    display: flex;
    align-items: center;
    min-height: var(--o2-field-height);
    gap: var(--o2-field-gap);
    padding: var(--o2-field-pad-y) var(--o2-field-pad-x);
    border: 1px solid var(--o2-field-border);
    border-radius: var(--o2-field-radius);
    background: var(--o2-field-bg);
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
    overflow: hidden;
  }

  // ─── Inner ────────────────────────────────────────────────────────────────
  &__inner {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    color: var(--o2-field-text);
    font-size: var(--o2-field-font-size);
  }

  // ─── Adornments ───────────────────────────────────────────────────────────
  &__adornment {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--o2-field-adornment-color);

    .q-icon,
    svg,
    img {
      display: block;
      width: 1rem;
      height: 1rem;
      font-size: 1rem;
    }
  }

  // ─── Loading spinner ──────────────────────────────────────────────────────
  &__spinner {
    display: inline-block;
    flex-shrink: 0;
    width: 0.875rem;
    height: 0.875rem;
    border: 1.5px solid var(--o2-border);
    border-top-color: var(--o2-primary-color);
    border-radius: 50%;
    animation: o2-field-spin 0.7s linear infinite;
  }

  @keyframes o2-field-spin {
    to {
      transform: rotate(360deg);
    }
  }

  // ─── Bottom row ───────────────────────────────────────────────────────────
  &__bottom {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    min-height: var(--o2-field-bottom-min-h);
    padding-top: var(--o2-field-bottom-gap);
    font-size: var(--o2-field-bottom-size);
    line-height: 1.3;
  }

  &__error-text {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--o2-field-error-color);
  }

  &__error-icon {
    flex-shrink: 0;
    color: var(--o2-field-error-color);
  }

  &__hint-text {
    color: var(--o2-field-hint-color);
  }

  // ─── State: focused ───────────────────────────────────────────────────────
  &[data-focused] &__control {
    border-color: var(--o2-field-border-focus);
    box-shadow: var(--o2-field-shadow-focus);
  }

  // ─── State: invalid ───────────────────────────────────────────────────────
  &[data-invalid] &__control {
    border-color: var(--o2-field-border-error);
  }

  // ─── State: disabled ──────────────────────────────────────────────────────
  &[data-disabled] {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  // ─── State: readonly ──────────────────────────────────────────────────────
  &[data-readonly] &__control {
    cursor: default;
  }

  // ─── Variant: outlined (default) ──────────────────────────────────────────
  // Base styles already produce an outlined field.

  // ─── Variant: borderless ──────────────────────────────────────────────────
  &[data-variant="borderless"] &__control {
    border-color: var(--o2-border);
    background: transparent;
  }

  &[data-variant="borderless"][data-focused] &__control {
    border-color: var(--o2-field-border-focus);
  }

  &[data-variant="borderless"][data-invalid] &__control {
    border-color: var(--o2-field-border-error);
  }

  // ─── Variant: filled ──────────────────────────────────────────────────────
  &[data-variant="filled"] &__control {
    border-color: transparent;
    background: var(--o2-secondary-background);
  }

  &[data-variant="filled"][data-focused] &__control {
    background: var(--o2-secondary-background);
    border-color: var(--o2-field-border-focus);
  }

  &[data-variant="filled"][data-invalid] &__control {
    border-color: var(--o2-field-border-error);
  }
}
</style>
