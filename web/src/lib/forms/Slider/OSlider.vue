<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SliderProps, SliderEmits, SliderSlots } from "./OSlider.types";
import { computed, useAttrs, useId } from "vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

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
  sm: "tw:h-1",
  md: "tw:h-1.5",
  lg: "tw:h-2",
};

const thumbSize: Record<NonNullable<SliderProps["size"]>, string> = {
  sm: "tw:size-3",
  md: "tw:size-4",
  lg: "tw:size-5",
};

const thumbHalf: Record<NonNullable<SliderProps["size"]>, string> = {
  sm: "0.375rem",
  md: "0.5rem",
  lg: "0.625rem",
};

const labelSize: Record<NonNullable<SliderProps["size"]>, string> = {
  sm: "tw:text-xs",
  md: "tw:text-xs",
  lg: "tw:text-sm",
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
  <div v-bind="$attrs" class="tw:flex tw:flex-col tw:gap-1 tw:w-full">
    <div
      v-if="$slots.label || label || showValue || $slots.tooltip"
      class="tw:flex tw:items-center tw:justify-between tw:gap-2"
    >
      <label
        v-if="$slots.label || label || $slots.tooltip"
        :for="inputId"
        :class="[
          labelSize[resolvedSize],
          'tw:font-medium tw:text-slider-label tw:leading-none tw:flex tw:items-center tw:gap-1',
        ]"
      >
        <slot name="label">{{ label }}</slot>
        <q-icon
          v-if="$slots.tooltip"
          name="info"
          size="16px"
          :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
          class="tw:cursor-help tw:text-slider-label"
        ><slot name="tooltip" /></q-icon>
      </label>
      <span
        v-if="showValue"
        :class="[
          labelSize[resolvedSize],
          'tw:tabular-nums tw:text-slider-value tw:leading-none',
        ]"
      >
        {{ displayValue }}
      </span>
    </div>

    <div
      :class="[
        'tw:relative tw:flex tw:items-center tw:w-full',
        disabled ? 'tw:cursor-not-allowed tw:opacity-60' : 'tw:cursor-pointer',
      ]"
    >
      <div
        :class="[
          'tw:absolute tw:left-0 tw:right-0 tw:rounded-full',
          trackHeight[resolvedSize],
          disabled ? 'tw:bg-slider-disabled-track' : 'tw:bg-slider-track',
        ]"
        aria-hidden="true"
      />
      <div
        :class="[
          'tw:absolute tw:left-0 tw:rounded-full',
          trackHeight[resolvedSize],
          disabled
            ? 'tw:bg-slider-disabled-track-fill'
            : 'tw:bg-slider-track-fill',
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
        :aria-invalid="hasError || undefined"
        :class="[
          'o2-slider-input',
          'tw:relative tw:z-10 tw:w-full tw:bg-transparent tw:appearance-none',
          'tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:focus-visible:ring-2 tw:focus-visible:ring-slider-focus-ring tw:rounded-full tw:transition-[box-shadow] tw:duration-150',
          trackHeight[resolvedSize],
          disabled ? 'tw:cursor-not-allowed' : 'tw:cursor-pointer',
        ]"
        @input="handleInput"
        @change="handleChange"
        @blur="emit('blur', $event)"
        @focus="emit('focus', $event)"
      />

      <span
        :class="[
          'tw:absolute tw:rounded-full tw:pointer-events-none tw:shadow-sm tw:border-2 tw:border-slider-thumb-border',
          thumbSize[resolvedSize],
          disabled ? 'tw:bg-slider-disabled-thumb' : 'tw:bg-slider-thumb',
        ]"
        :style="{
          left: `calc(${fillPercent}% - ${thumbHalf[resolvedSize]})`,
        }"
        aria-hidden="true"
      />
    </div>

    <div
      v-if="effectiveError || helpText"
      class="tw:flex tw:items-center tw:justify-between tw:gap-2"
    >
      <span
        v-if="effectiveError && effectiveError.trim()"
        class="tw:text-xs tw:text-slider-error-text tw:leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span
        v-else-if="helpText"
        class="tw:text-xs tw:text-slider-value tw:leading-none"
      >
        {{ helpText }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.o2-slider-input {
  margin: 0;
}
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
