<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { ColorProps, ColorEmits, ColorSlots } from "./OColor.types";
import { computed, ref, useId } from "vue";

const props = withDefaults(defineProps<ColorProps>(), {
  size: "md",
  disabled: false,
  readonly: false,
  clearable: false,
});

const emit = defineEmits<ColorEmits>();

defineSlots<ColorSlots>();

const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);
const colorPickerId = computed(() => `${inputId.value}-picker`);
const textInputRef = ref<HTMLInputElement | null>(null);

const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
);
const hasError = computed(() => !!effectiveError.value);

const heightClasses: Record<NonNullable<ColorProps["size"]>, string> = {
  sm: "tw:h-8 tw:text-xs",
  md: "tw:h-10 tw:text-sm",
};

const swatchSize: Record<NonNullable<ColorProps["size"]>, string> = {
  sm: "tw:size-5",
  md: "tw:size-6",
};

const swatchValue = computed(() => {
  const v = (props.modelValue ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  return "#000000";
});

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
  heightClasses[props.size ?? "md"],
]);

function handleColorPicker(event: Event) {
  const target = event.target as HTMLInputElement;
  emit("update:modelValue", target.value);
  emit("change", target.value);
}

function handleText(event: Event) {
  const target = event.target as HTMLInputElement;
  emit("update:modelValue", target.value);
}

function handleClear() {
  emit("update:modelValue", "");
  emit("clear");
  textInputRef.value?.focus();
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
      <!--
        Swatch — a <label> wrapping the hidden color input. The browser
        dispatches a click to the input when the label is activated, which
        opens the native picker anchored at the input's location. We nest
        the input inside the label and position it absolutely at the
        bottom-left of the swatch so the picker pops up directly below the
        field. Position-relative on the label is the anchor.
      -->
      <label
        :for="colorPickerId"
        :aria-label="label ? `${label} swatch` : 'Pick color'"
        class="tw:flex tw:items-center tw:ps-2 tw:pe-1 tw:shrink-0 tw:relative"
        :class="disabled ? 'tw:cursor-not-allowed' : 'tw:cursor-pointer'"
      >
        <span
          :class="[
            'tw:rounded tw:border tw:border-datepicker-border tw:shadow-sm',
            swatchSize[size ?? 'md'],
          ]"
          :style="{ background: swatchValue }"
          aria-hidden="true"
        />
        <input
          :id="colorPickerId"
          type="color"
          :value="swatchValue"
          :disabled="disabled"
          class="o2-color-picker-input"
          tabindex="-1"
          aria-hidden="true"
          @input="handleColorPicker"
          @change="handleColorPicker"
        />
      </label>

      <!-- Hex text input (always editable unless `readonly` is explicit) -->
      <input
        :id="inputId"
        ref="textInputRef"
        type="text"
        :value="modelValue ?? ''"
        :name="name"
        :placeholder="placeholder ?? '#000000'"
        :readonly="readonly"
        :disabled="disabled"
        :aria-invalid="hasError || undefined"
        maxlength="7"
        :class="[
          'tw:flex-1 tw:min-w-0 tw:bg-transparent tw:outline-none tw:font-mono',
          'tw:text-datepicker-text tw:placeholder:text-datepicker-placeholder',
          'tw:disabled:cursor-not-allowed',
          'tw:ps-2',
          clearable ? 'tw:pe-2' : 'tw:pe-3',
        ]"
        @input="handleText"
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

<style scoped>
/*
 Visually hide the native color input but keep it positioned at the
 bottom-left of its parent swatch <label> so the browser anchors the OS
 picker right below the swatch. Avoid `display:none` / `visibility:hidden`
 — both block the picker. `sr-only` (off-screen positioning) makes the
 picker open near 0,0 of the page, which is the bug we just fixed.
*/
.o2-color-picker-input {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  border: 0;
  padding: 0;
  margin: 0;
}
</style>
