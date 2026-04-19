// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
/**
 * O2Range — dual-handle range slider replacing q-range.
 *
 * Three-layer token strategy:
 *   Layer 1 – Primitive  : $o2-* SCSS vars  (_variables.scss)
 *   Layer 2 – Semantic   : --o2-* CSS props  (_variables.scss)
 *   Layer 3 – Component  : --o2-range-* CSS props (this file)
 *
 * State is exposed as data attributes:
 *   data-disabled  — present when disabled
 */

import { computed, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

export interface O2RangeProps {
  modelValue?: { min: number; max: number };
  min?: number;
  max?: number;
  step?: number;
  dense?: boolean;
  disable?: boolean;
  color?: string;
  label?: boolean;
  markers?: boolean;
  snap?: boolean;
}

const props = withDefaults(defineProps<O2RangeProps>(), {
  modelValue: () => ({ min: 0, max: 100 }),
  min: 0,
  max: 100,
  step: 1,
  dense: false,
  disable: false,
  label: false,
  markers: false,
  snap: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: { min: number; max: number }];
  change: [value: { min: number; max: number }];
}>();

const attrs = useAttrs();

const rootBindings = computed(() => {
  const {
    class: cls,
    style,
    "data-test": dt,
  } = attrs as Record<string, unknown>;
  return { class: cls, style, "data-test": dt };
});

// ─── Computed values ──────────────────────────────────────────────────────────

const safeMin = computed(() => {
  const v = props.modelValue?.min ?? props.min;
  return Math.min(Math.max(v, props.min), props.max);
});

const safeMax = computed(() => {
  const v = props.modelValue?.max ?? props.max;
  return Math.min(Math.max(v, props.min), props.max);
});

const range = computed(() => props.max - props.min);

const minPct = computed(() =>
  range.value === 0 ? 0 : ((safeMin.value - props.min) / range.value) * 100,
);
const maxPct = computed(() =>
  range.value === 0 ? 100 : ((safeMax.value - props.min) / range.value) * 100,
);

const fillStyle = computed(() => ({
  left: `${minPct.value}%`,
  width: `${maxPct.value - minPct.value}%`,
}));

const minLabelStyle = computed(() => ({
  left: `${minPct.value}%`,
  transform: "translateX(-50%)",
}));

const maxLabelStyle = computed(() => ({
  left: `${maxPct.value}%`,
  transform: "translateX(-50%)",
}));

// ─── Event handlers ───────────────────────────────────────────────────────────

const handleMinInput = (event: Event) => {
  const newMin = Number((event.target as HTMLInputElement).value);
  const clamped = Math.min(newMin, safeMax.value);
  emit("update:modelValue", { min: clamped, max: safeMax.value });
};

const handleMaxInput = (event: Event) => {
  const newMax = Number((event.target as HTMLInputElement).value);
  const clamped = Math.max(newMax, safeMin.value);
  emit("update:modelValue", { min: safeMin.value, max: clamped });
};

const handleChange = () => {
  emit("change", { min: safeMin.value, max: safeMax.value });
};
</script>

<template>
  <div
    class="o2-range"
    :class="[
      { 'o2-range--dense': dense, 'o2-range--label': label },
      rootBindings.class,
    ]"
    :style="rootBindings.style as string"
    :data-test="rootBindings['data-test'] as string"
    :data-disabled="disable || undefined"
  >
    <template v-if="label">
      <div
        class="o2-range__label o2-range__label--min"
        :style="minLabelStyle"
        aria-hidden="true"
      >
        {{ safeMin }}
      </div>
      <div
        class="o2-range__label o2-range__label--max"
        :style="maxLabelStyle"
        aria-hidden="true"
      >
        {{ safeMax }}
      </div>
    </template>

    <div class="o2-range__track-container">
      <div class="o2-range__track" />
      <div class="o2-range__track-fill" :style="fillStyle" />

      <input
        type="range"
        class="o2-range__input o2-range__input--min"
        :value="safeMin"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disable"
        :aria-label="`Minimum: ${safeMin}`"
        :aria-valuemin="min"
        :aria-valuemax="safeMax"
        :aria-valuenow="safeMin"
        @input="handleMinInput"
        @change="handleChange"
      />

      <input
        type="range"
        class="o2-range__input o2-range__input--max"
        :value="safeMax"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disable"
        :aria-label="`Maximum: ${safeMax}`"
        :aria-valuemin="safeMin"
        :aria-valuemax="max"
        :aria-valuenow="safeMax"
        @input="handleMaxInput"
        @change="handleChange"
      />
    </div>
  </div>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2Range styles — global (non-scoped) BEM under .o2-range namespace.
// State is targeted via data attributes.

.o2-range {
  // ─── Layer 3: Component Tokens ─────────────────────────────────────────────
  --o2-range-height: 1.75rem;
  --o2-range-track-h: 0.25rem;
  --o2-range-track-radius: 0.125rem;
  --o2-range-track-bg: var(--o2-border);
  --o2-range-fill-color: var(--o2-primary-color);
  --o2-range-thumb-size: 0.75rem;
  --o2-range-thumb-color: var(--o2-primary-color);
  --o2-range-font-size: 0.8125rem;

  // ─── Structure ──────────────────────────────────────────────────────────────
  display: flex;
  flex-direction: column;
  position: relative;
  width: 100%;
  font-size: var(--o2-range-font-size);

  // ─── Label tooltips ──────────────────────────────────────────────────────────
  &__label {
    position: absolute;
    top: 0;
    display: inline-block;
    padding: 0.125rem 0.375rem;
    background: var(--o2-primary-color);
    color: var(--o2-primary-btn-text);
    font-size: 0.6875rem;
    border-radius: 0.1875rem;
    white-space: nowrap;
    pointer-events: none;
    z-index: 1;
  }

  &--label {
    padding-top: 1.25rem;
  }

  // ─── Track container ─────────────────────────────────────────────────────────
  &__track-container {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    height: var(--o2-range-height);
  }

  &__track {
    position: absolute;
    left: 0;
    right: 0;
    height: var(--o2-range-track-h);
    border-radius: var(--o2-range-track-radius);
    background: var(--o2-range-track-bg);
    pointer-events: none;
  }

  &__track-fill {
    position: absolute;
    height: var(--o2-range-track-h);
    border-radius: var(--o2-range-track-radius);
    background: var(--o2-range-fill-color);
    pointer-events: none;
    z-index: 1;
  }

  // ─── Range inputs ────────────────────────────────────────────────────────────
  &__input {
    position: absolute;
    left: 0;
    width: 100%;
    height: var(--o2-range-track-h);
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    outline: none;
    border: none;
    cursor: pointer;
    pointer-events: none;

    &::-webkit-slider-thumb {
      pointer-events: all;
    }
    &::-moz-range-thumb {
      pointer-events: all;
    }

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: var(--o2-range-thumb-size);
      height: var(--o2-range-thumb-size);
      border-radius: 50%;
      background: var(--o2-range-thumb-color);
      border: 1px solid transparent;
      cursor: pointer;
      position: relative;
      z-index: 2;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      transition: transform 0.1s;
    }

    &::-webkit-slider-thumb:hover {
      transform: scale(1.2);
    }

    &::-moz-range-thumb {
      width: var(--o2-range-thumb-size);
      height: var(--o2-range-thumb-size);
      border-radius: 50%;
      background: var(--o2-range-thumb-color);
      border: 1px solid transparent;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    &::-moz-range-track {
      background: transparent;
      height: var(--o2-range-track-h);
    }

    &:focus-visible {
      &::-webkit-slider-thumb {
        box-shadow:
          0 0 0 2px var(--o2-primary-color),
          0 1px 3px rgba(0, 0, 0, 0.2);
      }

      &::-moz-range-thumb {
        box-shadow: 0 0 0 2px var(--o2-primary-color);
      }
    }

    &--max {
      z-index: 3;
    }
    &--min {
      z-index: 2;
    }
  }

  // ─── Dense variant ────────────────────────────────────────────────────────────
  &--dense {
    --o2-range-height: 1.25rem;
    --o2-range-thumb-size: 0.625rem;
  }

  // ─── State: disabled ─────────────────────────────────────────────────────────
  &[data-disabled] {
    opacity: 0.5;
    cursor: not-allowed;

    .o2-range__input {
      cursor: not-allowed;
    }
  }
}
</style>
