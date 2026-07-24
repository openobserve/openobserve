<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { ColorProps, ColorEmits, ColorSlots } from "./OColor.types";
import { computed, ref, useAttrs, useId, watch } from "vue";
import {
  PopoverRoot,
  PopoverPortal,
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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

// Forward tabindex to the real control; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex, ...rest } = $attrs;
  void tabindex;
  return rest;
});

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
  sm: "h-8 text-xs",
  md: "h-10 text-sm",
};

const swatchSize: Record<NonNullable<ColorProps["size"]>, string> = {
  sm: "size-5",
  md: "size-6",
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
  "flex items-stretch w-full rounded-default border transition-[color,background-color,border-color,box-shadow] duration-150",
  "ring-offset-1 ring-offset-surface-base",
  "bg-datepicker-bg",
  hasError.value
    ? "border-datepicker-error-border"
    : "border-datepicker-border hover:border-datepicker-hover-border",
  "focus-within:border-datepicker-focus-border",
  "focus-within:ring-2 focus-within:ring-datepicker-focus-ring",
  props.disabled
    ? "bg-datepicker-disabled-bg border-datepicker-disabled-border opacity-60"
    : "",
  heightClasses[props.size ?? "md"],
]);
</script>

<template>
  <div v-bind="wrapperAttrs" class="flex flex-col gap-1 w-full">
    <label
      v-if="$slots.label || label || $slots.tooltip"
      :for="inputId"
      class="text-xs font-medium text-datepicker-label leading-none flex items-center gap-1"
    >
      <slot name="label">{{ label }}</slot><span v-if="required" aria-hidden="true" class="select-none">*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="cursor-help text-datepicker-label"
      ><slot name="tooltip" /></OIcon>
    </label>

    <div :class="wrapperClasses">
      <!-- Swatch — opens the Reka color picker popover -->
      <PopoverRoot>
        <PopoverTrigger
          type="button"
          :disabled="disabled || readonly"
          :aria-label="label ? `${label} — pick color` : 'Pick color'"
          class="flex items-center ps-2 pe-1 shrink-0 outline-none ring-offset-1 ring-offset-surface-base focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring transition-[box-shadow] duration-150 rounded-s-default"
          :class="disabled || readonly ? 'cursor-not-allowed' : 'cursor-pointer'"
        >
          <span
            :class="[
              'rounded-default border border-datepicker-border',
              swatchSize[size ?? 'md'],
            ]"
            :style="{ background: swatchHex }"
            aria-hidden="true"
          />
        </PopoverTrigger>

        <PopoverPortal>
        <PopoverContent
          :side-offset="6"
          align="start"
          class="z-10001 rounded-default border shadow-md p-3 flex flex-col gap-3 bg-colorpicker-popup-bg border-colorpicker-popup-border w-55"
        >
          <!-- Saturation / Brightness area -->
          <!-- ColorAreaRoot passes gradient styles via scoped slot -->
          <ColorAreaRoot
            :model-value="pickerColor"
            color-space="hsb"
            x-channel="saturation"
            y-channel="brightness"
            class="w-full rounded-default overflow-hidden relative h-35"
            @update:model-value="handlePickerChange"
            v-slot="{ style: areaStyle }"
          >
            <ColorAreaArea class="w-full h-full" :style="areaStyle" />
            <ColorAreaThumb
              class="size-4 rounded-full border-2 border-colorpicker-thumb shadow outline-none ring-offset-1 ring-offset-surface-base focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring transition-[box-shadow] duration-150"
            />
          </ColorAreaRoot>

          <!-- Hue slider — ColorSliderTrack applies its own gradient internally -->
          <ColorSliderRoot
            :model-value="pickerColor"
            color-space="hsb"
            channel="hue"
            class="relative flex items-center w-full h-4 rounded-default"
            @update:model-value="handlePickerChange"
          >
            <ColorSliderTrack class="w-full h-3 rounded-default overflow-hidden" />
            <ColorSliderThumb
              class="size-4 rounded-full border-2 border-colorpicker-thumb shadow outline-none ring-offset-1 ring-offset-surface-base focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring transition-[box-shadow] duration-150"
            />
          </ColorSliderRoot>

          <!-- Hex input inside popup -->
          <input
            type="text"
            :value="swatchHex"
            maxlength="7"
            :placeholder="t('components.color.hexPlaceholder')"
            :disabled="disabled"
            class="w-full rounded-default border px-2 py-1 text-xs font-mono outline-none text-datepicker-text placeholder:text-datepicker-placeholder bg-datepicker-bg border-datepicker-border focus:border-datepicker-focus-border"
            @input="handleText"
          />
        </PopoverContent>
        </PopoverPortal>
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
        :tabindex="inputTabindex"
        maxlength="7"
        :class="[
          'flex-1 min-w-0 bg-transparent outline-none font-mono',
          'text-datepicker-text placeholder:text-datepicker-placeholder',
          'disabled:cursor-not-allowed',
          'ps-2',
          clearable ? 'pe-2' : 'pe-3',
        ]"
        @input="handleText"
        @blur="emit('blur', $event)"
        @focus="emit('focus', $event)"
      />

      <button
        v-if="clearable && modelValue"
        type="button"
        tabindex="-1"
        :aria-label="t('components.color.clear')"
        class="flex items-center pe-2 text-datepicker-icon hover:opacity-80 transition-colors"
        @click="handleClear"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          class="size-3.5"
          aria-hidden="true"
        >
          <path
            d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
          />
        </svg>
      </button>
    </div>

    <div v-if="effectiveError || helpText" class="flex items-center gap-2">
      <span
        v-if="effectiveError && effectiveError.trim()"
        class="text-xs text-datepicker-error-text leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span
        v-else-if="helpText"
        class="text-xs text-datepicker-label leading-none"
      >
        {{ helpText }}
      </span>
    </div>
  </div>
</template>
