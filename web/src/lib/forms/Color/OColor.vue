<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { ColorProps, ColorEmits, ColorSlots } from "./OColor.types";
import { computed, ref, watch, useId } from "vue";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  ColorAreaRoot,
  ColorAreaArea,
  ColorAreaThumb,
  ColorSliderRoot,
  ColorSliderTrack,
  ColorSliderThumb,
  parseColor,
  colorToHex,
} from "reka-ui";
import type { Color } from "reka-ui";

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

// Canonical hex value for the swatch preview and Reka color bridge
const swatchHex = computed(() => {
  const v = (props.modelValue ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  return "#000000";
});

// Internal Reka color — kept in sync with modelValue
const pickerColor = ref<string>(swatchHex.value);

watch(
  () => props.modelValue,
  (v) => {
    const hex = (v ?? "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex) && hex !== pickerColor.value) {
      pickerColor.value = hex;
    }
  },
);

function toHex(value: string | Color): string {
  if (typeof value === "string") {
    // already a string — convert to #RRGGBB
    try {
      return colorToHex(parseColor(value));
    } catch {
      return swatchHex.value;
    }
  }
  try {
    return colorToHex(value);
  } catch {
    return swatchHex.value;
  }
}

function handlePickerChange(value: string | Color) {
  const hex = toHex(value);
  pickerColor.value = hex;
  emit("update:modelValue", hex);
  emit("change", hex);
}

function handleText(event: Event) {
  const val = (event.target as HTMLInputElement).value;
  emit("update:modelValue", val);
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    pickerColor.value = val;
    emit("change", val);
  }
}

function handleClear() {
  emit("update:modelValue", "");
  emit("clear");
  textInputRef.value?.focus();
}

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
      <!-- Swatch — opens the Reka color picker popover -->
      <PopoverRoot>
        <PopoverTrigger
          type="button"
          :disabled="disabled || readonly"
          :aria-label="label ? `${label} — pick color` : 'Pick color'"
          class="tw:flex tw:items-center tw:ps-2 tw:pe-1 tw:shrink-0 tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring tw:rounded-s-md"
          :class="disabled || readonly ? 'tw:cursor-not-allowed' : 'tw:cursor-pointer'"
        >
          <span
            :class="[
              'tw:rounded tw:border tw:border-datepicker-border tw:shadow-sm',
              swatchSize[size ?? 'md'],
            ]"
            :style="{ background: swatchHex }"
            aria-hidden="true"
          />
        </PopoverTrigger>

        <PopoverContent
          :side-offset="6"
          align="start"
          class="tw:z-50 tw:rounded-lg tw:border tw:shadow-md tw:p-3 tw:flex tw:flex-col tw:gap-3 tw:bg-colorpicker-popup-bg tw:border-colorpicker-popup-border"
          style="width: 220px"
        >
          <!-- Saturation / Brightness area -->
          <!-- ColorAreaRoot passes gradient styles via scoped slot -->
          <ColorAreaRoot
            :model-value="pickerColor"
            color-space="hsb"
            x-channel="saturation"
            y-channel="brightness"
            class="tw:w-full tw:rounded tw:overflow-hidden tw:relative"
            style="height: 140px"
            @update:model-value="handlePickerChange"
            v-slot="{ style: areaStyle }"
          >
            <ColorAreaArea class="tw:w-full tw:h-full" :style="areaStyle" />
            <ColorAreaThumb
              class="tw:size-4 tw:rounded-full tw:border-2 tw:border-colorpicker-thumb tw:shadow tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring"
            />
          </ColorAreaRoot>

          <!-- Hue slider — ColorSliderTrack applies its own gradient internally -->
          <ColorSliderRoot
            :model-value="pickerColor"
            color-space="hsb"
            channel="hue"
            class="tw:relative tw:flex tw:items-center tw:w-full tw:h-4 tw:rounded"
            @update:model-value="handlePickerChange"
          >
            <ColorSliderTrack class="tw:w-full tw:h-3 tw:rounded tw:overflow-hidden" />
            <ColorSliderThumb
              class="tw:size-4 tw:rounded-full tw:border-2 tw:border-colorpicker-thumb tw:shadow tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring"
            />
          </ColorSliderRoot>

          <!-- Hex input inside popup -->
          <input
            type="text"
            :value="swatchHex"
            maxlength="7"
            placeholder="#000000"
            :disabled="disabled"
            class="tw:w-full tw:rounded tw:border tw:px-2 tw:py-1 tw:text-xs tw:font-mono tw:outline-none tw:text-datepicker-text tw:placeholder:text-datepicker-placeholder tw:bg-datepicker-bg tw:border-datepicker-border tw:focus:border-datepicker-focus-border"
            @input="handleText"
          />
        </PopoverContent>
      </PopoverRoot>

      <!-- Hex text input (always visible) -->
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
