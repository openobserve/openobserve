<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * O2File — replaces q-file.
 *
 * Three-layer token strategy
 * ─────────────────────────
 * Layer 1 – Primitive  : SCSS $o2-* variables (_variables.scss)
 * Layer 2 – Semantic   : CSS --o2-* custom properties (_variables.scss)
 * Layer 3 – Component  : CSS --o2-file-* (this file)
 *
 * State is exposed as data attributes:
 *   data-variant="outlined|borderless|filled"
 *   data-invalid   — present when error prop is true
 *   data-disabled  — present when disabled
 *   data-has-value — present when a file is selected
 */

import { computed, ref, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

export interface O2FileProps {
  modelValue?: File | File[] | null;
  multiple?: boolean;
  accept?: string;
  label?: string;
  hint?: string;
  error?: boolean;
  errorMessage?: string;
  hideBottomSpace?: boolean;
  dense?: boolean;
  disable?: boolean;
  clearable?: boolean;
  counter?: boolean;
  maxFiles?: number;
  variant?: "outlined" | "borderless" | "filled";
  maxFileSize?: number;
  maxTotalSize?: number;
}

const props = withDefaults(defineProps<O2FileProps>(), {
  dense: true,
  variant: "outlined",
  clearable: false,
  counter: false,
  multiple: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: File | File[] | null];
  change: [value: File | File[] | null];
}>();

const attrs = useAttrs();
const fileInputRef = ref<HTMLInputElement | null>(null);

// ─── Computed state ───────────────────────────────────────────────────────────

const hasValue = computed(() => {
  if (props.modelValue === null || props.modelValue === undefined) return false;
  if (Array.isArray(props.modelValue)) return props.modelValue.length > 0;
  return true;
});

const fileCount = computed(() => {
  if (!hasValue.value) return 0;
  if (Array.isArray(props.modelValue)) return props.modelValue.length;
  return 1;
});

const displayValue = computed(() => {
  if (!hasValue.value) return "";
  if (Array.isArray(props.modelValue)) {
    if (props.modelValue.length === 0) return "";
    if (props.modelValue.length === 1) return props.modelValue[0].name;
    return `${props.modelValue.length} files`;
  }
  return (props.modelValue as File).name;
});

const hasError = computed(() => !!props.error);
const errorText = computed(() =>
  props.error ? (props.errorMessage ?? "") : "",
);

const showBottom = computed(() => {
  if (props.hideBottomSpace) return hasError.value || !!props.hint;
  return true;
});

const rootBindings = computed(() => {
  const {
    class: cls,
    style,
    "data-test": dt,
  } = attrs as Record<string, unknown>;
  return { class: cls, style, "data-test": dt };
});

// ─── Event handlers ───────────────────────────────────────────────────────────

const openPicker = () => {
  if (props.disable) return;
  fileInputRef.value?.click();
};

const handleFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;

  let value: File | File[];
  if (props.multiple) {
    value = Array.from(files);
    if (props.maxFiles && value.length > props.maxFiles) {
      value = value.slice(0, props.maxFiles);
    }
  } else {
    value = files[0];
  }

  emit("update:modelValue", value);
  emit("change", value);
  input.value = "";
};

const clearFiles = () => {
  emit("update:modelValue", props.multiple ? [] : null);
  emit("change", props.multiple ? [] : null);
};

defineExpose({ openPicker, clearFiles });
</script>

<template>
  <div
    class="o2-file"
    :class="[{ 'o2-file--dense': dense }, rootBindings.class]"
    :style="rootBindings.style as string"
    :data-test="(rootBindings['data-test'] as string) ?? undefined"
    :data-variant="variant"
    :data-invalid="hasError || undefined"
    :data-disabled="disable || undefined"
    :data-has-value="hasValue || undefined"
  >
    <label v-if="label" class="o2-file__label">{{ label }}</label>

    <div
      class="o2-file__control"
      role="button"
      tabindex="0"
      :aria-disabled="disable ? 'true' : undefined"
      @click="openPicker"
      @keydown.enter.prevent="openPicker"
      @keydown.space.prevent="openPicker"
    >
      <div
        v-if="$slots.prepend"
        class="o2-file__adornment o2-file__adornment--pre"
      >
        <slot name="prepend" />
      </div>

      <span class="o2-file__icon" aria-hidden="true">
        <svg
          viewBox="0 0 14 14"
          width="14"
          height="14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12.5 6.5L6.5 12.5C5.12 13.88 2.88 13.88 1.5 12.5C0.12 11.12 0.12 8.88 1.5 7.5L8 1C8.97-.003 10.53-.003 11.5 1C12.47 2 12.47 3.56 11.5 4.5L5.5 10.5C4.95 11.05 4.05 11.05 3.5 10.5C2.95 9.95 2.95 9.05 3.5 8.5L9 3"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>

      <span class="o2-file__value" :data-placeholder="!hasValue || undefined">
        {{ hasValue ? displayValue : label ? "" : "Choose file…" }}
      </span>

      <span
        v-if="counter && hasValue"
        class="o2-file__counter"
        aria-live="polite"
      >
        {{ fileCount }}
      </span>

      <button
        v-if="clearable && hasValue && !disable"
        class="o2-file__clear"
        type="button"
        tabindex="-1"
        aria-label="Clear file selection"
        @click.stop="clearFiles"
      >
        <svg
          viewBox="0 0 10 10"
          width="10"
          height="10"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M1 1l8 8M9 1L1 9"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </button>

      <div
        v-if="$slots.append"
        class="o2-file__adornment o2-file__adornment--app"
      >
        <slot name="append" />
      </div>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      :multiple="multiple"
      :accept="accept"
      :disabled="disable"
      hidden
      aria-hidden="true"
      tabindex="-1"
      @change="handleFileChange"
    />

    <div v-if="showBottom" class="o2-file__bottom">
      <span v-if="hasError" class="o2-file__error"
role="alert">
        <svg
          class="o2-file__error-icon"
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
      <span v-else-if="hint" class="o2-file__hint">{{ hint }}</span>
    </div>
  </div>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2File styles — global (non-scoped), BEM under .o2-file.
// State is targeted via data attributes.

.o2-file {
  // ─── Layer 3: Component Tokens ──────────────────────────────────────────────
  --o2-file-height: 1.75rem;
  --o2-file-font-size: 0.8125rem;
  --o2-file-font-family: inherit;
  --o2-file-pad-x: 0.5rem;
  --o2-file-pad-y: 0;
  --o2-file-radius: 0.25rem;
  --o2-file-gap: 0.25rem;

  --o2-file-bg: transparent;
  --o2-file-text: var(--o2-text-primary);
  --o2-file-placeholder: var(--o2-text-muted);
  --o2-file-border: var(--o2-border-input);
  --o2-file-border-error: var(--o2-status-error-text, #e53e3e);
  --o2-file-icon-color: var(--o2-text-muted);
  --o2-file-adornment-color: var(--o2-text-muted);

  --o2-file-label-size: 0.6875rem;
  --o2-file-label-weight: 500;
  --o2-file-label-color: var(--o2-text-muted);
  --o2-file-label-gap: 0.1875rem;

  --o2-file-bottom-size: 0.6875rem;
  --o2-file-bottom-min-h: 1.125rem;
  --o2-file-bottom-gap: 0.1875rem;
  --o2-file-error-color: var(--o2-status-error-text, #e53e3e);
  --o2-file-hint-color: var(--o2-text-muted);

  // ─── Structure ─────────────────────────────────────────────────────────────
  display: inline-flex;
  flex-direction: column;
  position: relative;
  width: 100%;
  font-size: var(--o2-file-font-size);
  font-family: var(--o2-file-font-family);

  // ─── Label ─────────────────────────────────────────────────────────────────
  &__label {
    display: block;
    font-size: var(--o2-file-label-size);
    font-weight: var(--o2-file-label-weight);
    color: var(--o2-file-label-color);
    margin-bottom: var(--o2-file-label-gap);
    line-height: 1;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  // ─── Control ─────────────────────────────────────────────────────────────
  &__control {
    display: flex;
    align-items: center;
    min-height: var(--o2-file-height);
    gap: var(--o2-file-gap);
    padding: var(--o2-file-pad-y) var(--o2-file-pad-x);
    border: 1px solid var(--o2-file-border);
    border-radius: var(--o2-file-radius);
    background: var(--o2-file-bg);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
    overflow: hidden;
    outline: none;

    &:focus-visible {
      border-color: var(--o2-primary-color);
      box-shadow: 0 0 0 2px
        color-mix(in srgb, var(--o2-primary-color) 20%, transparent);
    }
  }

  &__icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--o2-file-icon-color);
  }

  &__value {
    flex: 1;
    min-width: 0;
    color: var(--o2-file-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.5;

    &[data-placeholder] {
      color: var(--o2-file-placeholder);
    }
  }

  &__counter {
    flex-shrink: 0;
    font-size: 0.6875rem;
    color: var(--o2-file-hint-color);
    font-variant-numeric: tabular-nums;
  }

  &__clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    padding: 0;
    flex-shrink: 0;
    border: none;
    border-radius: 0.125rem;
    background: transparent;
    color: var(--o2-file-adornment-color);
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.12s;

    &:hover {
      opacity: 1;
    }
  }

  &__adornment {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--o2-file-adornment-color);

    .q-icon,
    svg,
    img {
      display: block;
      width: 1rem;
      height: 1rem;
      font-size: 1rem;
    }
  }

  // ─── Bottom row ────────────────────────────────────────────────────────────
  &__bottom {
    display: flex;
    align-items: flex-start;
    min-height: var(--o2-file-bottom-min-h);
    padding-top: var(--o2-file-bottom-gap);
    font-size: var(--o2-file-bottom-size);
    line-height: 1.3;
  }

  &__error {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--o2-file-error-color);
  }

  &__error-icon {
    flex-shrink: 0;
    color: var(--o2-file-error-color);
  }

  &__hint {
    color: var(--o2-file-hint-color);
  }

  // ─── State: invalid ────────────────────────────────────────────────────────
  &[data-invalid] &__control {
    border-color: var(--o2-file-border-error);
  }

  // ─── State: disabled ───────────────────────────────────────────────────────
  &[data-disabled] {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  // ─── Dense modifier ────────────────────────────────────────────────────────
  &--dense {
    --o2-file-height: 1.5rem;
    --o2-file-font-size: 0.75rem;
  }

  // ─── Variant: borderless ───────────────────────────────────────────────────
  &[data-variant="borderless"] &__control {
    border-color: transparent;
    background: transparent;

    &:focus-visible {
      border-color: var(--o2-primary-color);
    }
  }

  // ─── Variant: filled ───────────────────────────────────────────────────────
  &[data-variant="filled"] &__control {
    border-color: transparent;
    background: var(--o2-secondary-background);

    &:focus-visible {
      background: var(--o2-secondary-background);
      border-color: var(--o2-primary-color);
    }
  }

  &[data-variant="filled"][data-invalid] &__control {
    border-color: var(--o2-file-border-error);
  }
}
</style>
