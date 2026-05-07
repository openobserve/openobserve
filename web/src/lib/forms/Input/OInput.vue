<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { InputProps, InputEmits, InputSlots } from "./OInput.types";
import { computed, ref, useId } from "vue";

const props = withDefaults(defineProps<InputProps>(), {
  type: "text",
  size: "md",
  disabled: false,
  readonly: false,
  clearable: false,
  autofocus: false,
  rows: 3,
});

const emit = defineEmits<InputEmits>();

defineSlots<InputSlots>();

// useId() must be called at setup top-level — not inside computed — otherwise
// each re-evaluation produces a new id, breaking the <label :for> association.
const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);
const inputRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);

// ── Validation ─────────────────────────────────────────────────────────────
const ruleError = ref<string | null>(null);
const touched = ref(false);

function runRules(val: string | number | undefined): void {
  if (!props.rules?.length) return;
  for (const rule of props.rules) {
    const result = rule(val);
    if (result !== true) {
      ruleError.value = result;
      return;
    }
  }
  ruleError.value = null;
}

function handleBlur(event: FocusEvent) {
  if (!touched.value) {
    touched.value = true;
    runRules(props.modelValue);
  }
  emit("blur", event);
}

// ── Error state ────────────────────────────────────────────────────────────
// External errorMessage / error prop always wins; internal rule error is secondary.
const effectiveError = computed(
  () =>
    props.errorMessage ||
    (props.error ? " " : null) ||
    ruleError.value ||
    null,
);
const hasError = computed(() => !!effectiveError.value);

const isTextarea = computed(() => props.type === "textarea");

// ── Width ──────────────────────────────────────────────────────────────────
const fieldWidthClass = computed(() => {
  switch (props.width) {
    case "xs":
      return "tw:w-[var(--spacing-field-width-xs)]";
    case "sm":
      return "tw:w-[var(--spacing-field-width-sm)]";
    case "md":
      return "tw:w-[var(--spacing-field-width-md)]";
    case "lg":
      return "tw:w-[var(--spacing-field-width-lg)]";
    default:
      return "tw:w-full";
  }
});

const charCount = computed(() => {
  if (!props.maxlength) return 0;
  const val = props.modelValue;
  return val !== undefined && val !== null ? String(val).length : 0;
});

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  const val = target.value;
  if (touched.value) runRules(val);
  emit("update:modelValue", val);
}

function handleClear() {
  if (touched.value) runRules("");
  emit("update:modelValue", "");
  emit("clear");
  inputRef.value?.focus();
}

// ── Styles ─────────────────────────────────────────────────────────────────
const heightClasses: Record<NonNullable<InputProps["size"]>, string> = {
  sm: "tw:h-8 tw:text-sm",
  md: "tw:h-10 tw:text-sm",
};

const wrapperClasses = computed(() => [
  "tw:flex tw:items-stretch tw:w-full tw:rounded-md tw:border tw:transition-colors tw:duration-150",
  "tw:bg-input-bg",
  hasError.value
    ? "tw:border-input-border-error"
    : "tw:border-input-border tw:hover:border-input-border-hover",
  "tw:focus-within:border-input-border-focus",
  "tw:focus-within:ring-2 tw:focus-within:ring-input-focus-ring",
  props.disabled
    ? "tw:bg-input-disabled-bg tw:border-input-disabled-border tw:opacity-60"
    : "",
  props.readonly ? "tw:border-input-border tw:bg-input-bg" : "",
]);
</script>

<template>
  <div :class="['tw:flex tw:flex-col tw:gap-1', fieldWidthClass]">
    <!-- Label -->
    <label
      v-if="label"
      :for="inputId"
      class="tw:text-xs tw:font-medium tw:text-input-label tw:leading-none"
    >
      {{ label }}
    </label>

    <!-- Input row -->
    <div :class="wrapperClasses">
      <!-- Prefix slot (inside border) -->
      <span
        v-if="$slots.prefix || prefix"
        class="tw:flex tw:items-center tw:ps-3 tw:text-input-addon-text tw:text-sm tw:shrink-0 tw:select-none"
      >
        <slot name="prefix">{{ prefix }}</slot>
      </span>

      <!-- Textarea -->
      <textarea
        v-if="isTextarea"
        :id="inputId"
        ref="inputRef"
        :value="String(modelValue ?? '')"
        :name="name"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :autofocus="autofocus"
        :maxlength="maxlength"
        :rows="rows"
        :autocomplete="autocomplete"
        :class="[
          'tw:flex-1 tw:min-w-0 tw:bg-transparent tw:outline-none',
          'tw:text-input-text tw:placeholder:text-input-placeholder',
          'tw:disabled:cursor-not-allowed',
          'tw:py-2',
          $slots.prefix || prefix ? 'tw:ps-2' : 'tw:ps-3',
          $slots.suffix || suffix || clearable ? 'tw:pe-2' : 'tw:pe-3',
          'tw:text-sm tw:resize-y',
        ]"
        @input="handleInput"
        @blur="handleBlur"
        @focus="emit('focus', $event)"
        @keydown="emit('keydown', $event)"
        @keyup="emit('keyup', $event)"
        @keypress="emit('keypress', $event)"
      />

      <!-- Text/number/etc input -->
      <input
        v-else
        :id="inputId"
        ref="inputRef"
        :value="String(modelValue ?? '')"
        :type="type"
        :name="name"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :autofocus="autofocus"
        :maxlength="maxlength"
        :autocomplete="autocomplete"
        :class="[
          'tw:flex-1 tw:min-w-0 tw:bg-transparent tw:outline-none',
          'tw:text-input-text tw:placeholder:text-input-placeholder',
          'tw:disabled:cursor-not-allowed',
          heightClasses[size ?? 'md'],
          $slots.prefix || prefix ? 'tw:ps-2' : 'tw:ps-3',
          $slots.suffix || suffix || clearable ? 'tw:pe-2' : 'tw:pe-3',
        ]"
        @input="handleInput"
        @blur="handleBlur"
        @focus="emit('focus', $event)"
        @keydown="emit('keydown', $event)"
        @keyup="emit('keyup', $event)"
        @keypress="emit('keypress', $event)"
      />

      <!-- Clear button -->
      <button
        v-if="
          clearable &&
          modelValue !== '' &&
          modelValue !== undefined &&
          modelValue !== null
        "
        type="button"
        tabindex="-1"
        aria-label="Clear"
        class="tw:flex tw:items-center tw:pe-2 tw:text-input-clear-btn tw:hover:text-input-clear-btn-hover tw:transition-colors"
        @click="handleClear"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          class="tw:size-3.5"
          aria-hidden="true"
        >
          <path
            d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
          />
        </svg>
      </button>

      <!-- Suffix slot (inside border) -->
      <span
        v-if="$slots.suffix || suffix"
        class="tw:flex tw:items-center tw:pe-3 tw:text-input-addon-text tw:text-sm tw:shrink-0 tw:select-none"
      >
        <slot name="suffix">{{ suffix }}</slot>
      </span>
    </div>

    <!-- Bottom row: hint / error / counter -->
    <div
      v-if="effectiveError || hint || maxlength"
      class="tw:flex tw:items-center tw:justify-between tw:gap-2"
    >
      <span
        v-if="effectiveError && effectiveError.trim()"
        class="tw:text-xs tw:text-input-error-text tw:leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span
        v-else-if="hint"
        class="tw:text-xs tw:text-input-hint tw:leading-none"
      >
        {{ hint }}
      </span>
      <span v-else class="tw:flex-1" />

      <span
        v-if="maxlength"
        :class="[
          'tw:text-xs tw:leading-none tw:tabular-nums tw:shrink-0',
          charCount > maxlength
            ? 'tw:text-input-error-text'
            : 'tw:text-input-hint',
        ]"
      >
        {{ charCount }}/{{ maxlength }}
      </span>
    </div>

    <!-- Append slot (outside border) -->
    <slot name="append" />
  </div>
</template>
