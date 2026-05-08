<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SwitchProps, SwitchEmits, SwitchSlots } from "./OSwitch.types";
import { SwitchRoot, SwitchThumb } from "reka-ui";
import { computed } from "vue";

const props = withDefaults(defineProps<SwitchProps>(), {
  size: "md",
  disabled: false,
  labelPosition: "right",
});

const emit = defineEmits<SwitchEmits>();

defineSlots<SwitchSlots>();

// ── Checked state with optional custom values ──────────────────────────────
const isChecked = computed((): boolean => {
  if (props.checkedValue !== undefined) {
    return props.modelValue === props.checkedValue;
  }
  return Boolean(props.modelValue);
});

function handleUpdate(value: boolean) {
  let emitValue;
  if (props.checkedValue !== undefined || props.uncheckedValue !== undefined) {
    emitValue = value
      ? (props.checkedValue ?? true)
      : (props.uncheckedValue ?? false);
  } else {
    emitValue = value;
  }
  emit("update:modelValue", emitValue);
  emit("change", emitValue);
}

// ── Track sizes ────────────────────────────────────────────────────────────
type TrackSize = { track: string; thumb: string; thumbTranslate: string };

const trackSizes: Record<NonNullable<SwitchProps["size"]>, TrackSize> = {
  sm: {
    track: "tw:w-7 tw:h-4",
    thumb: "tw:size-3",
    thumbTranslate: "tw:data-[state=checked]:translate-x-3",
  },
  md: {
    track: "tw:w-9 tw:h-5",
    thumb: "tw:size-4",
    thumbTranslate: "tw:data-[state=checked]:translate-x-4",
  },
  lg: {
    track: "tw:w-11 tw:h-6",
    thumb: "tw:size-5",
    thumbTranslate: "tw:data-[state=checked]:translate-x-5",
  },
};

const labelSize: Record<NonNullable<SwitchProps["size"]>, string> = {
  sm: "tw:text-xs",
  md: "tw:text-sm",
  lg: "tw:text-base",
};

const currentSizes = computed(() => trackSizes[props.size ?? "md"]);
</script>

<template>
  <div
    :class="[
      'tw:inline-flex tw:items-center tw:gap-2',
      labelPosition === 'left' ? 'tw:flex-row-reverse' : 'tw:flex-row',
      disabled ? 'tw:cursor-not-allowed tw:opacity-60' : 'tw:cursor-pointer',
    ]"
  >
    <SwitchRoot
      :id="id"
      :name="name"
      type="button"
      :checked="isChecked"
      :disabled="disabled"
      :class="[
        // Layout
        'tw:relative tw:inline-flex tw:shrink-0 tw:rounded-full',
        'tw:p-0.5 tw:items-center',
        // Sizing
        currentSizes.track,
        // Track colors
        'tw:bg-switch-track-off',
        'tw:data-[state=checked]:bg-switch-track-on',
        // Disabled
        'tw:data-disabled:bg-switch-disabled-track-off',
        'tw:data-[state=checked]:data-disabled:bg-switch-disabled-track-on',
        // Focus
        'tw:outline-none',
        'tw:focus-visible:ring-2 tw:focus-visible:ring-switch-focus-ring',
        // Transition
        'tw:transition-colors tw:duration-200',
      ]"
      @update:checked="handleUpdate"
    >
      <SwitchThumb
        :class="[
          // Base
          'tw:block tw:rounded-full tw:bg-switch-thumb tw:shadow-sm',
          // Sizing
          currentSizes.thumb,
          // Disabled thumb
          'tw:data-disabled:bg-switch-disabled-thumb',
          // Animate between positions
          'tw:transition-transform tw:duration-200',
          'tw:translate-x-0',
          currentSizes.thumbTranslate,
        ]"
      />
    </SwitchRoot>

    <span
      v-if="$slots.label || label"
      :class="[
        labelSize[size ?? 'md'],
        'tw:select-none tw:leading-none',
        disabled ? 'tw:text-switch-label-disabled' : 'tw:text-switch-label',
      ]"
      @click="!disabled && handleUpdate(!isChecked)"
    >
      <slot name="label">{{ label }}</slot>
    </span>
  </div>
</template>
