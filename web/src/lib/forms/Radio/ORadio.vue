<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// ORadio is designed to be used inside ORadioGroup (which provides a
// RadioGroupRoot context). For standalone usage, wrap a single ORadio
// inside an ORadioGroup:
//
//   <ORadioGroup v-model="picked">
//     <ORadio value="a" label="Option A" />
//     <ORadio value="b" label="Option B" />
//   </ORadioGroup>

import type { RadioProps, RadioSlots } from "./ORadio.types";
import { RADIO_VALUE_MAP_KEY } from "./ORadio.types";
import { RadioGroupItem, RadioGroupIndicator } from "reka-ui";
import { computed, inject, watchEffect } from "vue";

withDefaults(defineProps<RadioProps>(), {
  size: "md",
  disabled: false,
});

defineSlots<RadioSlots>();

const valueMap = inject(RADIO_VALUE_MAP_KEY, null);
const resolvedValue = computed(() => value ?? val);

watchEffect(() => {
  if (resolvedValue.value !== undefined) {
    valueMap?.set(String(resolvedValue.value), resolvedValue.value);
  }
});

const circleSize: Record<"xs" | "sm" | "md", string> = {
  xs: "tw:size-3",
  sm: "tw:size-3.5",
  md: "tw:size-4",
};

const dotSize: Record<"xs" | "sm" | "md", string> = {
  xs: "tw:size-1",
  sm: "tw:size-1.5",
  md: "tw:size-2",
};

const labelSize: Record<"xs" | "sm" | "md", string> = {
  xs: "tw:text-xs",
  sm: "tw:text-xs",
  md: "tw:text-sm",
};

const resolvedSize = computed(() => (size ?? "md") as "xs" | "sm" | "md");
</script>

<template>
  <label
    :class="[
      'tw:inline-flex tw:items-center tw:gap-2',
      disabled ? 'tw:cursor-not-allowed tw:opacity-60' : 'tw:cursor-pointer',
    ]"
    :for="id"
  >
    <!--
      RadioGroupItem is the ARIA-focusable radio button.
      We style it as the visual circle and use RadioGroupIndicator
      to render the inner dot when checked.
    -->
    <RadioGroupItem
      :id="id"
      :value="String(resolvedValue ?? '')"
      :disabled="disabled"
      :class="[
        'tw:shrink-0 tw:rounded-full tw:border tw:flex tw:items-center tw:justify-center',
        'tw:transition-colors tw:duration-150',
        'tw:outline-none',
        'tw:focus-visible:ring-2 tw:focus-visible:ring-radio-focus-ring',
        circleSize[resolvedSize],
        'tw:bg-radio-bg tw:border-radio-border',
        'tw:enabled:hover:border-radio-hover-border',
        'tw:data-[state=checked]:border-radio-checked-border',
        'tw:data-disabled:bg-radio-disabled-bg',
        'tw:data-disabled:border-radio-disabled-border',
      ]"
    >
      <RadioGroupIndicator
        :class="[
          'tw:rounded-full tw:bg-radio-checked-dot',
          dotSize[resolvedSize],
        ]"
      />
    </RadioGroupItem>

    <!-- Label -->
    <span
      v-if="$slots.label || label"
      :class="[
        labelSize[resolvedSize],
        'tw:select-none tw:leading-none',
        disabled ? 'tw:text-radio-label-disabled' : 'tw:text-radio-label',
      ]"
    >
      <slot name="label">{{ label }}</slot>
    </span>
  </label>
</template>
