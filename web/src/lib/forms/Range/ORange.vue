<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  RangeProps,
  RangeEmits,
  RangeSlots,
  RangeValue,
} from "./ORange.types";
import { computed, ref, useAttrs, useId } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

// Strip tabindex from the wrapper so it isn't an extra tab-stop before the thumbs.
const wrapperAttrs = computed(() => {
  const { tabindex, ...rest } = $attrs;
  return rest;
});

const props = withDefaults(defineProps<RangeProps>(), {
  min: 0,
  max: 100,
  step: 1,
  size: "md",
  disabled: false,
  showValue: false,
  vertical: false,
  reverse: false,
  labelAlways: false,
  markers: false,
});

const emit = defineEmits<RangeEmits>();

defineSlots<RangeSlots>();

const _fallbackId = useId();
const baseId = computed(() => props.id ?? _fallbackId);

const current = computed<RangeValue>(() => {
  const v = props.modelValue;
  if (v != null) {
    const minVal = Number(v.min);
    const maxVal = Number(v.max);
    if (!Number.isNaN(minVal) && !Number.isNaN(maxVal)) {
      return { min: minVal, max: maxVal };
    }
  }
  return { min: props.min, max: props.max };
});

const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
);
const hasError = computed(() => !!effectiveError.value);

const range = computed(() => props.max - props.min);
const hasRange = computed(() => range.value > 0);

// Raw drag positions for smooth visual rendering — decoupled from the
// snapped values that are emitted to the parent.
const dragVisualMin = ref<number | null>(null);
const dragVisualMax = ref<number | null>(null);

// During a drag use the raw (float) position so the thumb glides smoothly;
// at rest fall back to the parent-driven snapped value.
const renderMin = computed(() =>
  dragVisualMin.value !== null ? dragVisualMin.value : current.value.min,
);
const renderMax = computed(() =>
  dragVisualMax.value !== null ? dragVisualMax.value : current.value.max,
);

const minPercent = computed(() => {
  if (range.value <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, ((renderMin.value - props.min) / range.value) * 100),
  );
});

const maxPercent = computed(() => {
  if (range.value <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, ((renderMax.value - props.min) / range.value) * 100),
  );
});

const trackHeight: Record<NonNullable<RangeProps["size"]>, string> = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2",
};

const thumbSize: Record<NonNullable<RangeProps["size"]>, string> = {
  sm: "size-3",
  md: "size-4",
  lg: "size-5",
};

const thumbHalf: Record<NonNullable<RangeProps["size"]>, string> = {
  sm: "0.375rem",
  md: "0.5rem",
  lg: "0.625rem",
};

const labelSize: Record<NonNullable<RangeProps["size"]>, string> = {
  sm: "text-xs",
  md: "text-xs",
  lg: "text-sm",
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
  minOnTop.value ? "z-20" : "z-10",
);
const maxZClass = computed(() =>
  minOnTop.value ? "z-10" : "z-20",
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

// ── Vertical mode ──────────────────────────────────────────────────────────

const trackWidthV: Record<NonNullable<RangeProps["size"]>, string> = {
  sm: "w-1",
  md: "w-1.5",
  lg: "w-2",
};

const thumbSizePx: Record<NonNullable<RangeProps["size"]>, string> = {
  sm: "0.75rem",
  md: "1rem",
  lg: "1.25rem",
};

function valueToTop(value: number): number {
  if (range.value <= 0) return 0;
  const pct = (value - props.min) / range.value;
  return (props.reverse ? 1 - pct : pct) * 100;
}

const vertMinTop = computed(() => valueToTop(current.value.min));
const vertMaxTop = computed(() => valueToTop(current.value.max));
const vertFilledTop = computed(() =>
  Math.min(vertMinTop.value, vertMaxTop.value),
);
const vertFilledHeight = computed(() =>
  Math.abs(vertMaxTop.value - vertMinTop.value),
);

const displayMin = computed(() => {
  const fmt = props.formatValue ?? ((n: number) => String(n));
  return fmt(current.value.min);
});
const displayMax = computed(() => {
  const fmt = props.formatValue ?? ((n: number) => String(n));
  return fmt(current.value.max);
});

const vertMinOnTop = computed(() => vertMinTop.value < 50);
const vertMinZClass = computed(() =>
  vertMinOnTop.value ? "z-20" : "z-10",
);
const vertMaxZClass = computed(() =>
  vertMinOnTop.value ? "z-10" : "z-20",
);

const vertTrackRef = ref<HTMLElement | null>(null);
let dragging: "min" | "max" | null = null;

function vToValue(clientY: number): number {
  const el = vertTrackRef.value;
  if (!el) return props.min;
  const rect = el.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
  const raw = props.reverse
    ? props.max - pct * range.value
    : props.min + pct * range.value;
  const stepped =
    Math.round((raw - props.min) / props.step) * props.step + props.min;
  return clamp(stepped);
}

function onVertDown(e: PointerEvent) {
  if (props.disabled) return;
  const target = e.target as HTMLElement;
  e.preventDefault();
  if (target.dataset.thumb === "min") {
    dragging = "min";
  } else if (target.dataset.thumb === "max") {
    dragging = "max";
  } else {
    const v = vToValue(e.clientY);
    const distToMin = Math.abs(v - current.value.min);
    const distToMax = Math.abs(v - current.value.max);
    if (distToMin <= distToMax) {
      dragging = "min";
      emit("update:modelValue", {
        min: clamp(Math.min(v, current.value.max)),
        max: current.value.max,
      });
    } else {
      dragging = "max";
      emit("update:modelValue", {
        min: current.value.min,
        max: clamp(Math.max(v, current.value.min)),
      });
    }
  }
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onVertMove(e: PointerEvent) {
  if (!dragging || props.disabled) return;
  const v = vToValue(e.clientY);
  if (dragging === "min") {
    emit("update:modelValue", {
      min: clamp(Math.min(v, current.value.max)),
      max: current.value.max,
    });
  } else {
    emit("update:modelValue", {
      min: current.value.min,
      max: clamp(Math.max(v, current.value.min)),
    });
  }
}

function onVertUp(e: PointerEvent) {
  if (!dragging || props.disabled) {
    dragging = null;
    return;
  }
  const v = vToValue(e.clientY);
  const next: RangeValue =
    dragging === "min"
      ? { min: clamp(Math.min(v, current.value.max)), max: current.value.max }
      : { min: current.value.min, max: clamp(Math.max(v, current.value.min)) };
  emit("update:modelValue", next);
  emit("change", next);
  dragging = null;
}

function onVertCancel() {
  dragging = null;
}

// ── Horizontal mode pointer handling ─────────────────────────────────────
// All pointer interactions (track clicks AND native thumb drags) are handled
// here so we can decouple the smooth visual position from the snapped value
// that gets emitted to the parent.  Keyboard arrow-key events still reach
// handleMin / handleMax through the native inputs unchanged.

const hTrackRef = ref<HTMLElement | null>(null);
let hDragging: "min" | "max" | null = null;

/** Raw (un-snapped) value from a horizontal clientX position. */
function hToValue(clientX: number): number {
  const el = hTrackRef.value;
  if (!el) return props.min;
  const rect = el.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return clamp(props.min + pct * range.value);
}

/** Round a raw value to the nearest step for emitting. */
function snapToStep(v: number): number {
  const stepped =
    Math.round((v - props.min) / props.step) * props.step + props.min;
  return clamp(stepped);
}

function onHorizDown(e: PointerEvent) {
  if (props.disabled) return;
  // Prevent native range behaviour for pointer events so we control the drag.
  // Keyboard arrow-key events are unaffected by this.
  e.preventDefault();
  const raw = hToValue(e.clientX);
  const snapped = snapToStep(raw);
  const distToMin = Math.abs(raw - current.value.min);
  const distToMax = Math.abs(raw - current.value.max);
  if (distToMin <= distToMax) {
    hDragging = "min";
    dragVisualMin.value = Math.min(raw, current.value.max);
    emit("update:modelValue", {
      min: clamp(Math.min(snapped, current.value.max)),
      max: current.value.max,
    });
  } else {
    hDragging = "max";
    dragVisualMax.value = Math.max(raw, current.value.min);
    emit("update:modelValue", {
      min: current.value.min,
      max: clamp(Math.max(snapped, current.value.min)),
    });
  }
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onHorizMove(e: PointerEvent) {
  if (!hDragging || props.disabled) return;
  const raw = hToValue(e.clientX);
  const snapped = snapToStep(raw);
  if (hDragging === "min") {
    // Visual position clamps to max so the min thumb never passes max visually
    dragVisualMin.value = Math.min(raw, current.value.max);
    emit("update:modelValue", {
      min: clamp(Math.min(snapped, current.value.max)),
      max: current.value.max,
    });
  } else {
    dragVisualMax.value = Math.max(raw, current.value.min);
    emit("update:modelValue", {
      min: current.value.min,
      max: clamp(Math.max(snapped, current.value.min)),
    });
  }
}

function onHorizUp(e: PointerEvent) {
  // Always clear visual overrides so the thumb snaps to the final value
  dragVisualMin.value = null;
  dragVisualMax.value = null;
  if (!hDragging || props.disabled) {
    hDragging = null;
    return;
  }
  const snapped = snapToStep(hToValue(e.clientX));
  const next: RangeValue =
    hDragging === "min"
      ? { min: clamp(Math.min(snapped, current.value.max)), max: current.value.max }
      : { min: current.value.min, max: clamp(Math.max(snapped, current.value.min)) };
  emit("update:modelValue", next);
  emit("change", next);
  hDragging = null;
}

function onHorizCancel() {
  dragVisualMin.value = null;
  dragVisualMax.value = null;
  hDragging = null;
}
</script>

<template>
  <div
    v-bind="wrapperAttrs"
    :class="
      vertical
        ? 'flex flex-row h-full'
        : 'flex flex-col gap-1'
    "
  >
    <!-- ── Vertical mode ──────────────────────────────────────────────────── -->
    <template v-if="vertical">
      <!-- Value labels on left (labelAlways) -->
      <div
        v-if="labelAlways"
        class="relative h-full shrink-0"
        style="width: 1.5rem"
        aria-hidden="true"
      >
        <span
          class="absolute right-0.5 text-xs tabular-nums leading-none -translate-y-1/2 whitespace-nowrap text-slider-value"
          :style="{ top: vertMinTop + '%' }"
        >{{ displayMin }}</span>
        <span
          class="absolute right-0.5 text-xs tabular-nums leading-none -translate-y-1/2 whitespace-nowrap text-slider-value"
          :style="{ top: vertMaxTop + '%' }"
        >{{ displayMax }}</span>
      </div>

      <!-- Track column -->
      <div
        ref="vertTrackRef"
        class="relative h-full flex justify-center shrink-0"
        :class="disabled ? 'cursor-not-allowed opacity-60' : hasRange ? 'cursor-pointer' : 'cursor-default'"
        :style="{ width: thumbSizePx[resolvedSize] }"
        @pointerdown="onVertDown"
        @pointermove="onVertMove"
        @pointerup="onVertUp"
        @pointercancel="onVertCancel"
      >
        <!-- Background track strip -->
        <div
          class="absolute top-0 bottom-0 rounded-full"
          :class="[trackWidthV[resolvedSize], disabled ? 'bg-slider-disabled-track' : 'bg-slider-track']"
          aria-hidden="true"
        />
        <!-- Filled segment -->
        <div
          class="absolute rounded-full"
          :class="[trackWidthV[resolvedSize], disabled ? 'bg-slider-disabled-track-fill' : 'bg-slider-track-fill']"
          :style="{ top: vertFilledTop + '%', height: vertFilledHeight + '%' }"
          aria-hidden="true"
        />
        <!-- Marker ticks -->
        <template v-if="markers && markerLabels?.length">
          <div
            v-for="ml in markerLabels"
            :key="ml.value"
            class="absolute left-0 right-0 h-px opacity-50"
            :class="disabled ? 'bg-slider-disabled-track' : 'bg-slider-track'"
            :style="{ top: valueToTop(ml.value) + '%' }"
            aria-hidden="true"
          />
        </template>
        <!-- Min thumb -->
        <span
          data-thumb="min"
          :class="[
            'absolute rounded-full shadow-sm border-2 border-slider-thumb-border',
            'left-1/2 -translate-x-1/2 touch-none select-none',
            thumbSize[resolvedSize],
            vertMinZClass,
            disabled ? 'bg-slider-disabled-thumb cursor-not-allowed' : hasRange ? 'bg-slider-thumb cursor-grab' : 'bg-slider-thumb cursor-default',
          ]"
          :style="{ top: `calc(${vertMinTop}% - ${thumbHalf[resolvedSize]})` }"
          role="slider"
          :aria-valuenow="current.min"
          :aria-valuemin="min"
          :aria-valuemax="max"
          :aria-label="`${label ?? 'Range'} minimum`"
          tabindex="0"
        />
        <!-- Max thumb -->
        <span
          data-thumb="max"
          :class="[
            'absolute rounded-full shadow-sm border-2 border-slider-thumb-border',
            'left-1/2 -translate-x-1/2 touch-none select-none',
            thumbSize[resolvedSize],
            vertMaxZClass,
            disabled ? 'bg-slider-disabled-thumb cursor-not-allowed' : hasRange ? 'bg-slider-thumb cursor-grab' : 'bg-slider-thumb cursor-default',
          ]"
          :style="{ top: `calc(${vertMaxTop}% - ${thumbHalf[resolvedSize]})` }"
          role="slider"
          :aria-valuenow="current.max"
          :aria-valuemin="min"
          :aria-valuemax="max"
          :aria-label="`${label ?? 'Range'} maximum`"
          tabindex="0"
        />
      </div>

      <!-- Marker labels on right -->
      <div
        v-if="markerLabels?.length"
        class="relative h-full pl-1 shrink-0"
        style="width: 1.5rem"
        aria-hidden="true"
      >
        <span
          v-for="ml in markerLabels"
          :key="ml.value"
          class="absolute left-1 text-xs leading-none -translate-y-1/2 whitespace-nowrap text-slider-value"
          :style="{ top: valueToTop(ml.value) + '%' }"
        >{{ ml.label }}</span>
      </div>
    </template>

    <!-- ── Horizontal mode (default) ───────────────────────────────────── -->
    <template v-else>
    <div
      v-if="$slots.label || label || showValue || $slots.tooltip"
      class="flex items-center justify-between gap-2"
    >
      <label
        v-if="$slots.label || label || $slots.tooltip"
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
      ref="hTrackRef"
      :class="[
        'relative flex items-center w-full',
        disabled ? 'cursor-not-allowed opacity-60' : hasRange ? 'cursor-pointer' : 'cursor-default',
      ]"
      @pointerdown="onHorizDown"
      @pointermove="onHorizMove"
      @pointerup="onHorizUp"
      @pointercancel="onHorizCancel"
    >
      <!-- Background track -->
      <div
        :class="[
          'absolute left-0 right-0 rounded-full',
          trackHeight[resolvedSize],
          disabled ? 'bg-slider-disabled-track' : 'bg-slider-track',
        ]"
        aria-hidden="true"
      />
      <!-- Filled segment -->
      <div
        :class="[
          'absolute rounded-full',
          trackHeight[resolvedSize],
          disabled
            ? 'bg-slider-disabled-track-fill'
            : 'bg-slider-track-fill',
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
          'absolute left-0 right-0 w-full bg-transparent appearance-none m-0 pointer-events-none',
          minZClass,
          'outline-none focus-visible:ring-2 focus-visible:ring-slider-focus-ring rounded-full',
          trackHeight[resolvedSize],
          disabled ? 'cursor-not-allowed' : hasRange ? 'cursor-pointer' : 'cursor-default',
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
          'absolute left-0 right-0 w-full bg-transparent appearance-none m-0 pointer-events-none',
          maxZClass,
          'outline-none focus-visible:ring-2 focus-visible:ring-slider-focus-ring rounded-full',
          trackHeight[resolvedSize],
          disabled ? 'cursor-not-allowed' : hasRange ? 'cursor-pointer' : 'cursor-default',
        ]"
        @input="handleMax"
        @change="handleMax"
        @blur="emit('blur', $event)"
        @focus="emit('focus', $event)"
      />

      <!-- Visual thumbs -->
      <!-- left is clamped so the thumb never overflows the track container at
           either extreme: min 0px (left edge) and max calc(100% - thumbSize)
           (right edge). This prevents horizontal scroll in overflow:hidden or
           overflow-y:auto ancestor containers. -->
      <span
        :class="[
          'absolute rounded-full pointer-events-none shadow-sm border-2 border-slider-thumb-border z-30',
          thumbSize[resolvedSize],
          disabled ? 'bg-slider-disabled-thumb' : 'bg-slider-thumb',
        ]"
        :style="{ left: `clamp(0px, calc(${minPercent}% - ${thumbHalf[resolvedSize]}), calc(100% - ${thumbSizePx[resolvedSize]}))` }"
        aria-hidden="true"
      />
      <span
        :class="[
          'absolute rounded-full pointer-events-none shadow-sm border-2 border-slider-thumb-border z-30',
          thumbSize[resolvedSize],
          disabled ? 'bg-slider-disabled-thumb' : 'bg-slider-thumb',
        ]"
        :style="{ left: `clamp(0px, calc(${maxPercent}% - ${thumbHalf[resolvedSize]}), calc(100% - ${thumbSizePx[resolvedSize]}))` }"
        aria-hidden="true"
      />

      <!-- Spacer so the row has height -->
      <span
        :class="['invisible', thumbSize[resolvedSize]]"
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
    </template>
  </div>
</template>

<style>
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
