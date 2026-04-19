// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
/**
 * O2Slider — styled native range slider replacing q-slider.
 *
 * Three-layer token strategy:
 *   Layer 1 – Primitive  : $o2-* SCSS vars  (_variables.scss)
 *   Layer 2 – Semantic   : --o2-* CSS props  (_variables.scss)
 *   Layer 3 – Component  : --o2-slider-* CSS props (this file)
 *
 * State is exposed as data attributes:
 *   data-disabled  — present when disabled
 *   data-dragging  — present while the user is dragging the thumb
 */

import { computed, ref, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

export interface O2SliderProps {
  modelValue?: number;
  min?: number;
  max?: number;
  step?: number;
  dense?: boolean;
  disable?: boolean;
  color?: string;
  label?: boolean;
  labelAlways?: boolean;
  markers?: boolean | number;
  snap?: boolean;
  reverse?: boolean;
  vertical?: boolean;
}

const props = withDefaults(defineProps<O2SliderProps>(), {
  modelValue: 0,
  min: 0,
  max: 100,
  step: 1,
  dense: false,
  disable: false,
  label: false,
  labelAlways: false,
  markers: false,
  snap: false,
  reverse: false,
  vertical: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: number];
  change: [value: number];
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

const isDragging = ref(false);

// ─── Computed ─────────────────────────────────────────────────────────────────

const safeValue = computed(() => {
  const v = props.modelValue ?? props.min;
  return Math.min(Math.max(v, props.min), props.max);
});

const fillPercent = computed(() => {
  const range = props.max - props.min;
  if (range === 0) return 0;
  const pct = ((safeValue.value - props.min) / range) * 100;
  return props.reverse ? 100 - pct : pct;
});

const trackStyle = computed(() => ({
  "--o2-slider-fill-pct": `${fillPercent.value}%`,
}));

const showLabel = computed(
  () => props.labelAlways || (props.label && isDragging.value),
);

const labelStyle = computed(() => ({
  left: `${fillPercent.value}%`,
  transform: "translateX(-50%)",
}));

// ─── Event handlers ───────────────────────────────────────────────────────────

const handleInput = (event: Event) => {
  const val = Number((event.target as HTMLInputElement).value);
  emit("update:modelValue", val);
};

const handleChange = (event: Event) => {
  const val = Number((event.target as HTMLInputElement).value);
  emit("change", val);
  isDragging.value = false;
};

const handleMousedown = () => {
  isDragging.value = true;
};
</script>

<template>
  <div
    class="o2-slider"
    :class="[
      { 'o2-slider--dense': dense, 'o2-slider--label-always': labelAlways },
      rootBindings.class,
    ]"
    :style="rootBindings.style as string"
    :data-test="rootBindings['data-test'] as string"
    :data-disabled="disable || undefined"
    :data-dragging="isDragging || undefined"
    :data-reverse="reverse || undefined"
    :data-vertical="vertical || undefined"
  >
    <div
      v-if="showLabel"
      class="o2-slider__label"
      :style="labelStyle"
      aria-hidden="true"
    >
      {{ safeValue }}
    </div>

    <div class="o2-slider__track-wrap" :style="trackStyle">
      <input
        type="range"
        class="o2-slider__native"
        :value="safeValue"
        :min="min"
        :max="max"
        :step="snap && step ? step : step"
        :disabled="disable"
        :aria-valuemin="min"
        :aria-valuemax="max"
        :aria-valuenow="safeValue"
        :aria-orientation="vertical ? 'vertical' : 'horizontal'"
        @input="handleInput"
        @change="handleChange"
        @mousedown="handleMousedown"
        @touchstart="handleMousedown"
      />
    </div>
  </div>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2Slider styles — global (non-scoped) BEM under .o2-slider namespace.
// State is targeted via data attributes.

.o2-slider {
  // ─── Layer 3: Component Tokens ─────────────────────────────────────────────
  --o2-slider-height: 1.75rem;
  --o2-slider-track-h: 0.25rem;
  --o2-slider-track-radius: 0.125rem;
  --o2-slider-track-bg: var(--o2-border);
  --o2-slider-fill-color: var(--o2-primary-color);
  --o2-slider-thumb-size: 0.75rem;
  --o2-slider-thumb-color: var(--o2-primary-color);
  --o2-slider-thumb-border: transparent;
  --o2-slider-font-size: 0.8125rem;

  --o2-slider-fill-pct: 0%;

  // ─── Structure ──────────────────────────────────────────────────────────────
  display: flex;
  flex-direction: column;
  position: relative;
  width: 100%;
  font-size: var(--o2-slider-font-size);

  // ─── Label tooltip ───────────────────────────────────────────────────────────
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

  // ─── Track wrapper ───────────────────────────────────────────────────────────
  &__track-wrap {
    display: flex;
    align-items: center;
    width: 100%;
    height: var(--o2-slider-height);
    position: relative;
  }

  // ─── Native range input ──────────────────────────────────────────────────────
  &__native {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: var(--o2-slider-track-h);
    border-radius: var(--o2-slider-track-radius);
    background: linear-gradient(
      to right,
      var(--o2-slider-fill-color) 0%,
      var(--o2-slider-fill-color) var(--o2-slider-fill-pct),
      var(--o2-slider-track-bg) var(--o2-slider-fill-pct),
      var(--o2-slider-track-bg) 100%
    );
    outline: none;
    border: none;
    cursor: pointer;
    transition: background 0s;

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: var(--o2-slider-thumb-size);
      height: var(--o2-slider-thumb-size);
      border-radius: 50%;
      background: var(--o2-slider-thumb-color);
      border: 1px solid var(--o2-slider-thumb-border);
      cursor: pointer;
      transition: transform 0.1s;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    &::-webkit-slider-thumb:hover {
      transform: scale(1.2);
    }

    &::-moz-range-thumb {
      width: var(--o2-slider-thumb-size);
      height: var(--o2-slider-thumb-size);
      border-radius: 50%;
      background: var(--o2-slider-thumb-color);
      border: 1px solid var(--o2-slider-thumb-border);
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    &::-moz-range-track {
      height: var(--o2-slider-track-h);
      border-radius: var(--o2-slider-track-radius);
      background: transparent;
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
  }

  // ─── Dense variant ────────────────────────────────────────────────────────────
  &--dense {
    --o2-slider-height: 1.25rem;
    --o2-slider-thumb-size: 0.625rem;
  }

  // ─── State: disabled ─────────────────────────────────────────────────────────
  &[data-disabled] {
    opacity: 0.5;
    cursor: not-allowed;

    .o2-slider__native {
      cursor: not-allowed;
    }
  }

  // ─── Reverse ─────────────────────────────────────────────────────────────────
  &[data-reverse] &__native {
    background: linear-gradient(
      to left,
      var(--o2-slider-fill-color) 0%,
      var(--o2-slider-fill-color) var(--o2-slider-fill-pct),
      var(--o2-slider-track-bg) var(--o2-slider-fill-pct),
      var(--o2-slider-track-bg) 100%
    );
    direction: rtl;
  }

  // ─── Label-always mode ────────────────────────────────────────────────────────
  &--label-always {
    padding-top: 1.25rem;
  }
}
</style>
