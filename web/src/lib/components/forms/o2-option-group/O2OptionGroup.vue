<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * O2OptionGroup — replaces q-option-group.
 *
 * Three-layer token strategy
 * ─────────────────────────
 * Layer 1 – Primitive  : SCSS $o2-* variables (_variables.scss)
 * Layer 2 – Semantic   : CSS --o2-* custom properties (_variables.scss)
 * Layer 3 – Component  : CSS --o2-option-group-* (this file)
 *
 * State is exposed as data attributes:
 *   data-type="radio|checkbox|toggle"
 *   data-disabled  — present when the whole group is disabled
 *   Each item:
 *     data-state="checked|unchecked"  — selection state
 *     data-disabled  — present when this option is disabled
 */

import { computed, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

export interface O2OptionGroupOption {
  label: string;
  value: unknown;
  disable?: boolean;
  color?: string;
}

export interface O2OptionGroupProps {
  modelValue?: unknown;
  options: O2OptionGroupOption[];
  type?: "radio" | "checkbox" | "toggle";
  dense?: boolean;
  disable?: boolean;
  leftLabel?: boolean;
  color?: string;
  inline?: boolean;
}

const props = withDefaults(defineProps<O2OptionGroupProps>(), {
  type: "radio",
  dense: true,
  inline: false,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isChecked = (optionValue: unknown): boolean => {
  if (props.type === "radio") {
    return props.modelValue === optionValue;
  }
  if (Array.isArray(props.modelValue)) {
    return props.modelValue.includes(optionValue);
  }
  return false;
};

const handleChange = (optionValue: unknown, checked: boolean) => {
  if (props.disable) return;

  if (props.type === "radio") {
    emit("update:modelValue", optionValue);
    return;
  }

  const current: unknown[] = Array.isArray(props.modelValue)
    ? [...props.modelValue]
    : [];
  if (checked) {
    if (!current.includes(optionValue)) current.push(optionValue);
  } else {
    const idx = current.indexOf(optionValue);
    if (idx !== -1) current.splice(idx, 1);
  }
  emit("update:modelValue", current);
};
</script>

<template>
  <div
    class="o2-option-group"
    :class="[
      { 'o2-option-group--inline': inline, 'o2-option-group--dense': dense },
      rootBindings.class,
    ]"
    :style="rootBindings.style as string"
    :data-test="rootBindings['data-test'] as string"
    :data-type="type"
    :data-disabled="disable || undefined"
    role="group"
  >
    <label
      v-for="(option, index) in options"
      :key="index"
      class="o2-option-group__item"
      :class="{ 'o2-option-group__item--left-label': leftLabel }"
      :data-state="isChecked(option.value) ? 'checked' : 'unchecked'"
      :data-disabled="option.disable || disable || undefined"
      :data-test="`o2-option-group-item-${index}`"
    >
      <span
        v-if="leftLabel"
        class="o2-option-group__label o2-option-group__label--left"
      >
        {{ option.label }}
      </span>

      <!-- Toggle type -->
      <template v-if="type === 'toggle'">
        <span
          class="o2-option-group__toggle-track"
          role="switch"
          :aria-checked="isChecked(option.value)"
          :aria-label="option.label"
          :aria-disabled="option.disable || disable ? 'true' : undefined"
          tabindex="0"
          @click="
            !option.disable &&
            !disable &&
            handleChange(option.value, !isChecked(option.value))
          "
          @keydown.space.prevent="
            !option.disable &&
            !disable &&
            handleChange(option.value, !isChecked(option.value))
          "
          @keydown.enter.prevent="
            !option.disable &&
            !disable &&
            handleChange(option.value, !isChecked(option.value))
          "
        >
          <span class="o2-option-group__toggle-thumb" />
        </span>
      </template>

      <!-- Radio / Checkbox type -->
      <template v-else>
        <span class="o2-option-group__control-wrap">
          <input
            :type="type === 'radio' ? 'radio' : 'checkbox'"
            class="o2-option-group__native"
            :checked="isChecked(option.value)"
            :disabled="option.disable || disable"
            :aria-label="option.label"
            @change="
              (e) =>
                handleChange(
                  option.value,
                  (e.target as HTMLInputElement).checked,
                )
            "
          />
          <span class="o2-option-group__indicator" :aria-hidden="true">
            <svg
              v-if="type === 'checkbox' && isChecked(option.value)"
              viewBox="0 0 10 8"
              width="10"
              height="8"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M1 4l3 3 5-6"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span
              v-if="type === 'radio' && isChecked(option.value)"
              class="o2-option-group__radio-dot"
            />
          </span>
        </span>
      </template>

      <span v-if="!leftLabel" class="o2-option-group__label">
        {{ option.label }}
      </span>
    </label>
  </div>
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2OptionGroup styles — global (non-scoped), BEM under .o2-option-group.
// State is targeted via data attributes.

.o2-option-group {
  // ─── Layer 3: Component Tokens ──────────────────────────────────────────────
  --o2-option-group-gap: 0.5rem;
  --o2-option-group-item-gap: 0.375rem;
  --o2-option-group-font-size: 0.8125rem;
  --o2-option-group-control-size: 0.875rem;
  --o2-option-group-radius: 0.1875rem;

  --o2-option-group-text: var(--o2-text-primary);
  --o2-option-group-text-muted: var(--o2-text-muted);
  --o2-option-group-border: var(--o2-border-input);
  --o2-option-group-checked-bg: var(--o2-primary-btn-bg);
  --o2-option-group-checked-border: var(--o2-primary-color);
  --o2-option-group-checked-text: #fff;

  --o2-option-group-toggle-w: 2rem;
  --o2-option-group-toggle-h: 1rem;
  --o2-option-group-toggle-off-bg: var(--o2-muted-background);
  --o2-option-group-toggle-on-bg: var(--o2-primary-btn-bg);
  --o2-option-group-toggle-thumb-size: 0.75rem;

  // ─── Structure ─────────────────────────────────────────────────────────────
  display: flex;
  flex-direction: column;
  gap: var(--o2-option-group-gap);
  font-size: var(--o2-option-group-font-size);

  &--inline {
    flex-direction: row;
    flex-wrap: wrap;
  }

  // ─── State: disabled (whole group) ─────────────────────────────────────────
  &[data-disabled] {
    opacity: 0.5;
    pointer-events: none;
  }

  // ─── Item ──────────────────────────────────────────────────────────────────
  &__item {
    display: inline-flex;
    align-items: center;
    gap: var(--o2-option-group-item-gap);
    cursor: pointer;
    color: var(--o2-option-group-text);
    user-select: none;
    line-height: 1;

    &--left-label {
      flex-direction: row-reverse;
    }

    // ─── Item: disabled ─────────────────────────────────────────────────────
    &[data-disabled] {
      opacity: 0.45;
      cursor: not-allowed;
      pointer-events: none;
    }
  }

  // ─── Label ─────────────────────────────────────────────────────────────────
  &__label {
    line-height: 1.4;

    &--left {
      order: -1;
    }
  }

  // ─── Native input (visually hidden) ────────────────────────────────────────
  &__control-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--o2-option-group-control-size);
    height: var(--o2-option-group-control-size);
    flex-shrink: 0;
  }

  &__native {
    position: absolute;
    opacity: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    cursor: pointer;
    z-index: 1;

    &:disabled {
      cursor: not-allowed;
    }
  }

  // ─── Visual indicator ──────────────────────────────────────────────────────
  &__indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--o2-option-group-control-size);
    height: var(--o2-option-group-control-size);
    border: 1px solid var(--o2-option-group-border);
    border-radius: var(--o2-option-group-radius);
    background: transparent;
    color: var(--o2-option-group-checked-text);
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
    pointer-events: none;
  }

  // Item checked state → indicator filled
  &__item[data-state="checked"] &__indicator {
    background: var(--o2-option-group-checked-bg);
    border-color: var(--o2-option-group-checked-border);
  }

  // Radio: circular indicator
  &[data-type="radio"] &__indicator {
    border-radius: 50%;
  }

  &__radio-dot {
    display: block;
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
    background: currentColor;
  }

  // ─── Toggle ────────────────────────────────────────────────────────────────
  &__toggle-track {
    display: inline-flex;
    align-items: center;
    width: var(--o2-option-group-toggle-w);
    height: var(--o2-option-group-toggle-h);
    border-radius: 999px;
    background: var(--o2-option-group-toggle-off-bg);
    padding: 0.125rem;
    cursor: pointer;
    transition: background 0.15s ease;
    flex-shrink: 0;
    outline: none;

    &:focus-visible {
      box-shadow: 0 0 0 2px var(--o2-primary-color);
    }
  }

  // Toggle track when item is checked
  &__item[data-state="checked"] &__toggle-track {
    background: var(--o2-option-group-toggle-on-bg);
    justify-content: flex-end;
  }

  &__toggle-thumb {
    display: block;
    width: var(--o2-option-group-toggle-thumb-size);
    height: var(--o2-option-group-toggle-thumb-size);
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: transform 0.15s ease;
    pointer-events: none;
  }

  // ─── Dense modifier ────────────────────────────────────────────────────────
  &--dense {
    --o2-option-group-gap: 0.25rem;
    --o2-option-group-font-size: 0.75rem;
    --o2-option-group-control-size: 0.8125rem;
  }
}
</style>
