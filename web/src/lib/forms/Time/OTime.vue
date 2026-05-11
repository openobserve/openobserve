<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { TimeProps, TimeEmits, TimeSlots } from "./OTime.types";
import { computed, ref, useId } from "vue";

const props = withDefaults(defineProps<TimeProps>(), {
  size: "md",
  disabled: false,
  readonly: false,
  clearable: false,
  withSeconds: false,
});

const emit = defineEmits<TimeEmits>();

defineSlots<TimeSlots>();

const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);
const inputRef = ref<HTMLInputElement | null>(null);

const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
);
const hasError = computed(() => !!effectiveError.value);

const stepValue = computed(() => {
  if (props.step !== undefined) return props.step;
  return props.withSeconds ? 1 : 60;
});

const heightClasses: Record<NonNullable<TimeProps["size"]>, string> = {
  sm: "tw:h-8 tw:text-xs",
  md: "tw:h-10 tw:text-sm",
};

const wrapperClasses = computed(() => [
  "tw:flex tw:items-stretch tw:w-full tw:rounded-md tw:border tw:transition-colors tw:duration-150",
  "tw:bg-datepicker-bg",
  hasError.value
    ? "tw:border-datepicker-error-border"
    : "tw:border-datepicker-border tw:hover:border-datepicker-hover-border",
  "tw:focus-within:border-datepicker-focus-border",
  "tw:focus-within:ring-2 tw:focus-within:ring-datepicker-focus-ring",
  props.disabled
    ? "tw:bg-datepicker-disabled-bg tw:border-datepicker-disabled-border tw:opacity-60"
    : "",
]);

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  emit("update:modelValue", target.value);
}

function handleChange(event: Event) {
  const target = event.target as HTMLInputElement;
  emit("change", target.value);
}

function handleClear() {
  emit("update:modelValue", "");
  emit("clear");
  inputRef.value?.focus();
}
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-1 tw:w-full">
    <label
      v-if="$slots.label || label"
      :for="inputId"
      class="tw:text-xs tw:font-medium tw:text-datepicker-label tw:leading-none"
    >
      <slot name="label">{{ label }}</slot>
    </label>

    <div :class="wrapperClasses">
      <span
        class="tw:flex tw:items-center tw:ps-3 tw:text-datepicker-icon tw:shrink-0 tw:select-none"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          class="tw:size-4"
          aria-hidden="true"
        >
          <path
            d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 12a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11Z"
          />
          <path
            d="M8 4a.5.5 0 0 1 .5.5V8H11a.5.5 0 0 1 0 1H7.5V4.5A.5.5 0 0 1 8 4Z"
          />
        </svg>
      </span>

      <input
        :id="inputId"
        ref="inputRef"
        type="time"
        :value="modelValue ?? ''"
        :name="name"
        :min="min"
        :max="max"
        :step="stepValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :aria-invalid="hasError || undefined"
        :class="[
          'tw:flex-1 tw:min-w-0 tw:bg-transparent tw:outline-none',
          'tw:text-datepicker-text tw:placeholder:text-datepicker-placeholder',
          'tw:disabled:cursor-not-allowed',
          heightClasses[size ?? 'md'],
          'tw:ps-2',
          clearable ? 'tw:pe-2' : 'tw:pe-3',
        ]"
        @input="handleInput"
        @change="handleChange"
        @blur="emit('blur', $event)"
        @focus="emit('focus', $event)"
      />

      <button
        v-if="clearable && modelValue"
        type="button"
        tabindex="-1"
        aria-label="Clear"
        class="tw:flex tw:items-center tw:pe-2 tw:text-datepicker-icon tw:hover:opacity-80 tw:transition-colors"
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
    </div>

    <div v-if="effectiveError || helpText" class="tw:flex tw:items-center tw:gap-2">
      <span
        v-if="effectiveError && effectiveError.trim()"
        class="tw:text-xs tw:text-datepicker-error-text tw:leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span
        v-else-if="helpText"
        class="tw:text-xs tw:text-datepicker-label tw:leading-none"
      >
        {{ helpText }}
      </span>
    </div>
  </div>
</template>
