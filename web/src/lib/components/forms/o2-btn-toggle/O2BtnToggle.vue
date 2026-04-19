// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
/**
 * O2BtnToggle — grouped button toggle replacing q-btn-toggle.
 *
 * Three-layer token strategy:
 *   Layer 1 – Primitive  : $o2-* SCSS vars  (_variables.scss)
 *   Layer 2 – Semantic   : --o2-* CSS props  (_variables.scss)
 *   Layer 3 – Component  : --o2-btn-toggle-* CSS props (this file)
 *
 * State is exposed as data attributes:
 *   data-variant="default|flat|outline"  — visual variant of the group
 *   data-disabled  — present when the whole group is disabled
 *   Each button:
 *     data-state="active|inactive"  — whether this option is selected
 *     data-disabled  — present on a disabled individual button
 */

import { computed, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

export interface O2BtnToggleOption {
  label?: string;
  value: unknown;
  icon?: string;
  disable?: boolean;
  slot?: string;
}

export interface O2BtnToggleProps {
  modelValue?: unknown;
  options: O2BtnToggleOption[];
  dense?: boolean;
  flat?: boolean;
  outline?: boolean;
  unelevated?: boolean;
  rounded?: boolean;
  spread?: boolean;
  clearable?: boolean;
  noCaps?: boolean;
  disable?: boolean;
  color?: string;
  textColor?: string;
  toggleColor?: string;
  toggleTextColor?: string;
}

const props = withDefaults(defineProps<O2BtnToggleProps>(), {
  options: () => [],
  dense: false,
  flat: false,
  outline: false,
  unelevated: false,
  rounded: false,
  spread: false,
  clearable: false,
  noCaps: false,
  disable: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: unknown];
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

const dataVariant = computed(() => {
  if (props.flat) return "flat";
  if (props.outline) return "outline";
  return "default";
});

// ─── Selection logic ──────────────────────────────────────────────────────────

const isSelected = (opt: O2BtnToggleOption): boolean => {
  return props.modelValue === opt.value;
};

const handleClick = (opt: O2BtnToggleOption) => {
  if (props.disable || opt.disable) return;

  if (props.clearable && isSelected(opt)) {
    emit("update:modelValue", null);
  } else {
    emit("update:modelValue", opt.value);
  }
};
</script>

<template>
  <div
    class="o2-btn-toggle"
    :class="[
      {
        'o2-btn-toggle--dense': dense,
        'o2-btn-toggle--spread': spread,
        'o2-btn-toggle--rounded': rounded,
        'o2-btn-toggle--no-caps': noCaps,
      },
      rootBindings.class,
    ]"
    :style="rootBindings.style as string"
    :data-test="rootBindings['data-test'] as string"
    :data-variant="dataVariant"
    :data-disabled="disable || undefined"
    role="group"
  >
    <button
      v-for="(opt, index) in options"
      :key="String(opt.value)"
      class="o2-btn-toggle__btn"
      :class="{
        'o2-btn-toggle__btn--first': index === 0,
        'o2-btn-toggle__btn--last': index === options.length - 1,
      }"
      type="button"
      :data-state="isSelected(opt) ? 'active' : 'inactive'"
      :data-disabled="disable || opt.disable || undefined"
      :disabled="disable || opt.disable"
      :aria-pressed="isSelected(opt)"
      @click="handleClick(opt)"
    >
      <slot
        v-if="opt.slot"
        :name="opt.slot"
        :opt="opt"
        :selected="isSelected(opt)"
      />

      <span v-else-if="opt.icon" class="o2-btn-toggle__icon"
aria-hidden="true">
        {{ opt.icon }}
      </span>

      <span v-if="opt.label" class="o2-btn-toggle__label">{{ opt.label }}</span>
    </button>
  </div>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2BtnToggle styles — global (non-scoped) BEM under .o2-btn-toggle namespace.
// State is targeted via data attributes.

.o2-btn-toggle {
  // ─── Layer 3: Component Tokens ─────────────────────────────────────────────
  --o2-btn-toggle-height: 1.75rem;
  --o2-btn-toggle-font-size: 0.8125rem;
  --o2-btn-toggle-pad-x: 0.75rem;
  --o2-btn-toggle-pad-y: 0;
  --o2-btn-toggle-radius: 0.25rem;
  --o2-btn-toggle-border: var(--o2-border-input);
  --o2-btn-toggle-bg: transparent;
  --o2-btn-toggle-text: var(--o2-text-primary);
  --o2-btn-toggle-active-bg: var(--o2-primary-btn-bg);
  --o2-btn-toggle-active-text: var(--o2-primary-btn-text);
  --o2-btn-toggle-hover-bg: var(--o2-hover-gray);

  // ─── Structure ──────────────────────────────────────────────────────────────
  display: inline-flex;
  flex-direction: row;
  align-items: stretch;

  // ─── Buttons ─────────────────────────────────────────────────────────────────
  &__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    height: var(--o2-btn-toggle-height);
    padding: var(--o2-btn-toggle-pad-y) var(--o2-btn-toggle-pad-x);
    font-size: var(--o2-btn-toggle-font-size);
    font-family: inherit;
    font-weight: 500;
    color: var(--o2-btn-toggle-text);
    background: var(--o2-btn-toggle-bg);
    border: 1px solid var(--o2-btn-toggle-border);
    border-radius: 0;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
    outline: none;
    user-select: none;
    margin-left: -1px;

    &:first-child {
      margin-left: 0;
    }

    &:hover:not([data-disabled]):not([data-state="active"]) {
      background: var(--o2-btn-toggle-hover-bg);
      z-index: 1;
    }

    &:focus-visible {
      z-index: 2;
      box-shadow: 0 0 0 2px var(--o2-primary-color);
    }

    // ─── Active (selected) ───────────────────────────────────────────────────
    &[data-state="active"] {
      background: var(--o2-btn-toggle-active-bg);
      color: var(--o2-btn-toggle-active-text);
      border-color: var(--o2-btn-toggle-active-bg);
      z-index: 1;
    }

    // ─── First / Last — outer rounded corners only ───────────────────────────
    &--first {
      border-top-left-radius: var(--o2-btn-toggle-radius);
      border-bottom-left-radius: var(--o2-btn-toggle-radius);
    }

    &--last {
      border-top-right-radius: var(--o2-btn-toggle-radius);
      border-bottom-right-radius: var(--o2-btn-toggle-radius);
    }

    // ─── State: disabled ────────────────────────────────────────────────────
    &[data-disabled],
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  &__icon {
    display: inline-flex;
    align-items: center;
    font-size: 1rem;
    line-height: 1;
  }

  &__label {
    line-height: 1;
  }

  // ─── Dense variant ────────────────────────────────────────────────────────────
  &--dense {
    --o2-btn-toggle-height: 1.375rem;
    --o2-btn-toggle-pad-x: 0.5rem;
    --o2-btn-toggle-font-size: 0.75rem;
  }

  // ─── Spread (equal-width buttons) ────────────────────────────────────────────
  &--spread {
    width: 100%;

    .o2-btn-toggle__btn {
      flex: 1;
    }
  }

  // ─── Rounded variant ──────────────────────────────────────────────────────────
  &--rounded {
    --o2-btn-toggle-radius: 0.875rem;

    .o2-btn-toggle__btn--first {
      padding-left: 1rem;
    }
    .o2-btn-toggle__btn--last {
      padding-right: 1rem;
    }
  }

  // ─── Variant: flat ────────────────────────────────────────────────────────────
  &[data-variant="flat"] .o2-btn-toggle__btn {
    border-color: transparent;

    &[data-state="active"] {
      border-color: transparent;
    }
  }

  // ─── No-caps ─────────────────────────────────────────────────────────────────
  &--no-caps .o2-btn-toggle__btn {
    text-transform: none;
  }

  // ─── State: disabled (whole group) ───────────────────────────────────────────
  &[data-disabled] {
    opacity: 0.5;
    pointer-events: none;
  }
}
</style>
