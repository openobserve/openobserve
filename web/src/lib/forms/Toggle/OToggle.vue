<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { ToggleProps, ToggleEmits, ToggleSlots } from "./OToggle.types";
import { SwitchRoot, SwitchThumb } from "reka-ui";
import { computed } from "vue";

const props = withDefaults(defineProps<ToggleProps>(), {
  size: "md",
  disabled: false,
  labelPlacement: "end",
});

const emit = defineEmits<ToggleEmits>();

defineSlots<ToggleSlots>();

function handleUpdate(value: boolean) {
  emit("update:modelValue", value);
  emit("change", value);
}

// ── Track sizes ────────────────────────────────────────────────────────────
type TrackSize = { track: string; thumb: string; thumbTranslate: string };

const trackSizes: Record<NonNullable<ToggleProps["size"]>, TrackSize> = {
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

const labelSize: Record<NonNullable<ToggleProps["size"]>, string> = {
  sm: "tw:text-xs",
  md: "tw:text-sm",
  lg: "tw:text-base",
};

const currentSizes = computed(() => trackSizes[props.size ?? "md"]);
const thumbIcon = computed(() => {
  if (props.modelValue) {
    return props.checkedIcon ?? props.icon;
  }
  return props.uncheckedIcon ?? props.icon;
});
</script>

<template>
  <label
    :class="[
      'tw:inline-flex tw:items-center tw:gap-2',
      labelPlacement === 'start'
        ? 'tw:flex-row-reverse'
        : 'tw:flex-row',
      disabled ? 'tw:cursor-not-allowed tw:opacity-60' : 'tw:cursor-pointer',
    ]"
    :for="id"
  >
    <SwitchRoot
      :id="id"
      :name="name"
      :checked="modelValue ?? false"
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
      >
        <span
          v-if="thumbIcon"
          class="tw:text-[0.5rem] tw:leading-none tw:text-switch-label"
          aria-hidden="true"
        >
          {{ thumbIcon }}
        </span>
      </SwitchThumb>
    </SwitchRoot>

    <span
      v-if="$slots.label || label"
      :class="[
        labelSize[size ?? 'md'],
        'tw:select-none tw:leading-none',
        disabled ? 'tw:text-switch-label-disabled' : 'tw:text-switch-label',
      ]"
    >
      <slot name="label">{{ label }}</slot>
    </span>
  </label>
</template>
