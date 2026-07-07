<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SliderProps, SliderEmits, SliderSlots } from "./OSlider.types";
import { computed, useAttrs, useId } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

// Forward tabindex to the slider input; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex, ...rest } = $attrs;
  return rest;
});

const props = withDefaults(defineProps<SliderProps>(), {
  min: 0,
  max: 100,
  step: 1,
  size: "md",
  disabled: false,
  showValue: false,
});

const emit = defineEmits<SliderEmits>();

defineSlots<SliderSlots>();

const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);

const currentValue = computed(() => {
  const v = props.modelValue;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  return props.min;
});

const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
);
const hasError = computed(() => !!effectiveError.value);

const fillPercent = computed(() => {
  const range = props.max - props.min;
  if (range <= 0) return 0;
  const pct = ((currentValue.value - props.min) / range) * 100;
  return Math.max(0, Math.min(100, pct));
});

const trackHeight: Record<NonNullable<SliderProps["size"]>, string> = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2",
};

const thumbSize: Record<NonNullable<SliderProps["size"]>, string> = {
  sm: "size-3",
  md: "size-4",
  lg: "size-5",
};

const thumbHalf: Record<NonNullable<SliderProps["size"]>, string> = {
  sm: "0.375rem",
  md: "0.5rem",
  lg: "0.625rem",
};

const labelSize: Record<NonNullable<SliderProps["size"]>, string> = {
  sm: "text-xs",
  md: "text-xs",
  lg: "text-sm",
};

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const v = Number(target.value);
  if (!Number.isNaN(v)) {
    emit("update:modelValue", v);
  }
}

function handleChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const v = Number(target.value);
  if (!Number.isNaN(v)) {
    emit("change", v);
  }
}

const displayValue = computed(() => {
  if (props.formatValue) return props.formatValue(currentValue.value);
  return String(currentValue.value);
});

const resolvedSize = computed(() => props.size ?? "md");
</script>

<template>
  <div v-bind="wrapperAttrs" class="flex flex-col gap-1 w-full">
    <div
      v-if="$slots.label || label || showValue || $slots.tooltip"
      class="flex items-center justify-between gap-2"
    >
      <label
        v-if="$slots.label || label || $slots.tooltip"
        :for="inputId"
        :class="[
          labelSize[resolvedSize],
          'font-medium text-slider-label leading-none flex items-center gap-1',
        ]"
      >
        <slot name="label">{{ label }}</slot><span v-if="required" aria-hidden="true" class="select-none">*</span>
        <OIcon
          v-if="$slots.tooltip"
          name="info-outline"
          size="sm"
          :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
          class="cursor-help text-slider-label"
        ><slot name="tooltip" /></OIcon>
      </label>
      <span
        v-if="showValue"
        :class="[
          labelSize[resolvedSize],
          'tabular-nums text-slider-value leading-none',
        ]"
      >
        {{ displayValue }}
      </span>
    </div>

    <div
      :class="[
        'relative flex items-center w-full',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      ]"
    >
      <div
        :class="[
          'absolute left-0 right-0 rounded-full',
          trackHeight[resolvedSize],
          disabled ? 'bg-slider-disabled-track' : 'bg-slider-track',
        ]"
        aria-hidden="true"
      />
      <div
        :class="[
          'absolute left-0 rounded-full',
          trackHeight[resolvedSize],
          disabled
            ? 'bg-slider-disabled-track-fill'
            : 'bg-slider-track-fill',
        ]"
        :style="{ width: fillPercent + '%' }"
        aria-hidden="true"
      />

      <input
        :id="inputId"
        type="range"
        :name="name"
        :min="min"
        :max="max"
        :step="step"
        :value="currentValue"
        :disabled="disabled"
        :tabindex="inputTabindex"
        :aria-invalid="hasError || undefined"
        :class="[
          'o2-slider-input',
          'relative z-10 w-full bg-transparent appearance-none m-0',
          'outline-none ring-offset-1 ring-offset-surface-base focus-visible:ring-2 focus-visible:ring-slider-focus-ring rounded-full transition-[box-shadow] duration-150',
          trackHeight[resolvedSize],
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        ]"
        @input="handleInput"
        @change="handleChange"
        @blur="emit('blur', $event)"
        @focus="emit('focus', $event)"
      />

      <span
        :class="[
          'absolute rounded-full pointer-events-none shadow-sm border-2 border-slider-thumb-border',
          thumbSize[resolvedSize],
          disabled ? 'bg-slider-disabled-thumb' : 'bg-slider-thumb',
        ]"
        :style="{
          left: `calc(${fillPercent}% - ${thumbHalf[resolvedSize]})`,
        }"
        aria-hidden="true"
      />
    </div>

    <div
      v-if="effectiveError || helpText"
      class="flex items-center justify-between gap-2"
    >
      <span
        v-if="effectiveError && effectiveError.trim()"
        class="text-xs text-slider-error-text leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span
        v-else-if="helpText"
        class="text-xs text-slider-value leading-none"
      >
        {{ helpText }}
      </span>
    </div>
  </div>
</template>

<style>
.o2-slider-input::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 0;
  height: 0;
  background: transparent;
  border: none;
}
.o2-slider-input::-moz-range-thumb {
  appearance: none;
  width: 0;
  height: 0;
  background: transparent;
  border: none;
}
.o2-slider-input::-webkit-slider-runnable-track {
  background: transparent;
}
.o2-slider-input::-moz-range-track {
  background: transparent;
}
</style>
