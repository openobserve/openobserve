<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  RangeProps,
  RangeEmits,
  RangeSlots,
  RangeValue,
} from "./ORange.types";
import { computed, useAttrs, useId } from "vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

const props = withDefaults(defineProps<RangeProps>(), {
  min: 0,
  max: 100,
  step: 1,
  size: "md",
  disabled: false,
  showValue: false,
});

const emit = defineEmits<RangeEmits>();

defineSlots<RangeSlots>();

const _fallbackId = useId();
const baseId = computed(() => props.id ?? _fallbackId);

const current = computed<RangeValue>(() => {
  const v = props.modelValue;
  if (
    v &&
    typeof v.min === "number" &&
    typeof v.max === "number" &&
    !Number.isNaN(v.min) &&
    !Number.isNaN(v.max)
  ) {
    return { min: v.min, max: v.max };
  }
  return { min: props.min, max: props.max };
});

const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
);
const hasError = computed(() => !!effectiveError.value);

const range = computed(() => props.max - props.min);

const minPercent = computed(() => {
  if (range.value <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, ((current.value.min - props.min) / range.value) * 100),
  );
});

const maxPercent = computed(() => {
  if (range.value <= 0) return 100;
  return Math.max(
    0,
    Math.min(100, ((current.value.max - props.min) / range.value) * 100),
  );
});

const trackHeight: Record<NonNullable<RangeProps["size"]>, string> = {
  sm: "tw:h-1",
  md: "tw:h-1.5",
  lg: "tw:h-2",
};

const thumbSize: Record<NonNullable<RangeProps["size"]>, string> = {
  sm: "tw:size-3",
  md: "tw:size-4",
  lg: "tw:size-5",
};

const thumbHalf: Record<NonNullable<RangeProps["size"]>, string> = {
  sm: "0.375rem",
  md: "0.5rem",
  lg: "0.625rem",
};

const labelSize: Record<NonNullable<RangeProps["size"]>, string> = {
  sm: "tw:text-xs",
  md: "tw:text-xs",
  lg: "tw:text-sm",
};

const resolvedSize = computed(() => props.size ?? "md");

/**
 * Dynamic z-index for the two thumbs.
 *
 * When both values converge (e.g. both at `props.max`), the thumb on top is
 * the only one the user can grab. With max permanently on top and
 * `handleMax` clamping via `Math.max(v, currentMin)`, the user can never
 * drag min back down. Fix: when min has crossed past the midpoint of the
 * range, lift it above max so it's reachable for a "drag back" gesture.
 *
 * Tracking the last-interacted thumb is also valid; the position-based
 * heuristic is simpler and handles the most common stuck case (both at the
 * right edge of the track).
 */
const minOnTop = computed(() => minPercent.value > 50);
const minZClass = computed(() =>
  minOnTop.value ? "tw:z-20" : "tw:z-10",
);
const maxZClass = computed(() =>
  minOnTop.value ? "tw:z-10" : "tw:z-20",
);

function clamp(v: number) {
  return Math.max(props.min, Math.min(props.max, v));
}

function emitUpdate(next: RangeValue, event: Event) {
  emit("update:modelValue", next);
  if (event.type === "change") emit("change", next);
}

function handleMin(event: Event) {
  const target = event.target as HTMLInputElement;
  const v = Number(target.value);
  if (Number.isNaN(v)) return;
  const nextMin = clamp(Math.min(v, current.value.max));
  emitUpdate({ min: nextMin, max: current.value.max }, event);
}

function handleMax(event: Event) {
  const target = event.target as HTMLInputElement;
  const v = Number(target.value);
  if (Number.isNaN(v)) return;
  const nextMax = clamp(Math.max(v, current.value.min));
  emitUpdate({ min: current.value.min, max: nextMax }, event);
}

const displayValue = computed(() => {
  const fmt = props.formatValue ?? ((n: number) => String(n));
  return `${fmt(current.value.min)} – ${fmt(current.value.max)}`;
});
</script>

<template>
  <div v-bind="$attrs" class="tw:flex tw:flex-col tw:gap-1 tw:w-full">
    <div
      v-if="$slots.label || label || showValue || $slots.tooltip"
      class="tw:flex tw:items-center tw:justify-between tw:gap-2"
    >
      <label
        v-if="$slots.label || label || $slots.tooltip"
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
      <!-- Background track -->
      <div
        :class="[
          'tw:absolute tw:left-0 tw:right-0 tw:rounded-full',
          trackHeight[resolvedSize],
          disabled ? 'tw:bg-slider-disabled-track' : 'tw:bg-slider-track',
        ]"
        aria-hidden="true"
      />
      <!-- Filled segment -->
      <div
        :class="[
          'tw:absolute tw:rounded-full',
          trackHeight[resolvedSize],
          disabled
            ? 'tw:bg-slider-disabled-track-fill'
            : 'tw:bg-slider-track-fill',
        ]"
        :style="{
          left: minPercent + '%',
          width: maxPercent - minPercent + '%',
        }"
        aria-hidden="true"
      />

      <input
        :id="`${baseId}-min`"
        type="range"
        :name="name ? `${name}-min` : undefined"
        :min="min"
        :max="max"
        :step="step"
        :value="current.min"
        :disabled="disabled"
        :aria-label="`${label ?? 'Range'} minimum`"
        :aria-invalid="hasError || undefined"
        :class="[
          'o2-range-input',
          'tw:absolute tw:left-0 tw:right-0 tw:w-full tw:bg-transparent tw:appearance-none',
          minZClass,
          'tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-slider-focus-ring tw:rounded-full',
          trackHeight[resolvedSize],
          disabled ? 'tw:cursor-not-allowed' : 'tw:cursor-pointer',
        ]"
        @input="handleMin"
        @change="handleMin"
        @blur="emit('blur', $event)"
        @focus="emit('focus', $event)"
      />
      <input
        :id="`${baseId}-max`"
        type="range"
        :name="name ? `${name}-max` : undefined"
        :min="min"
        :max="max"
        :step="step"
        :value="current.max"
        :disabled="disabled"
        :aria-label="`${label ?? 'Range'} maximum`"
        :aria-invalid="hasError || undefined"
        :class="[
          'o2-range-input',
          'tw:absolute tw:left-0 tw:right-0 tw:w-full tw:bg-transparent tw:appearance-none',
          maxZClass,
          'tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-slider-focus-ring tw:rounded-full',
          trackHeight[resolvedSize],
          disabled ? 'tw:cursor-not-allowed' : 'tw:cursor-pointer',
        ]"
        @input="handleMax"
        @change="handleMax"
        @blur="emit('blur', $event)"
        @focus="emit('focus', $event)"
      />

      <!-- Visual thumbs -->
      <span
        :class="[
          'tw:absolute tw:rounded-full tw:pointer-events-none tw:shadow-sm tw:border-2 tw:border-slider-thumb-border tw:z-30',
          thumbSize[resolvedSize],
          disabled ? 'tw:bg-slider-disabled-thumb' : 'tw:bg-slider-thumb',
        ]"
        :style="{ left: `calc(${minPercent}% - ${thumbHalf[resolvedSize]})` }"
        aria-hidden="true"
      />
      <span
        :class="[
          'tw:absolute tw:rounded-full tw:pointer-events-none tw:shadow-sm tw:border-2 tw:border-slider-thumb-border tw:z-30',
          thumbSize[resolvedSize],
          disabled ? 'tw:bg-slider-disabled-thumb' : 'tw:bg-slider-thumb',
        ]"
        :style="{ left: `calc(${maxPercent}% - ${thumbHalf[resolvedSize]})` }"
        aria-hidden="true"
      />

      <!-- Spacer so the row has height -->
      <span
        :class="['tw:invisible', thumbSize[resolvedSize]]"
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
.o2-range-input {
  margin: 0;
  pointer-events: none;
}
.o2-range-input::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 1rem;
  height: 1rem;
  background: transparent;
  border: none;
  pointer-events: auto;
  cursor: pointer;
}
.o2-range-input::-moz-range-thumb {
  appearance: none;
  width: 1rem;
  height: 1rem;
  background: transparent;
  border: none;
  pointer-events: auto;
  cursor: pointer;
}
.o2-range-input::-webkit-slider-runnable-track {
  background: transparent;
}
.o2-range-input::-moz-range-track {
  background: transparent;
}
</style>
