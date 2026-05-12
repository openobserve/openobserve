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

const props = withDefaults(defineProps<RadioProps>(), {
  size: "md",
  disabled: false,
  value: undefined,
  val: undefined,
});

defineSlots<RadioSlots>();

const valueMap = inject(RADIO_VALUE_MAP_KEY, null);
const resolvedValue = computed(() => props.value ?? props.val);

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

const resolvedSize = computed(() => (props.size ?? "md") as "xs" | "sm" | "md");
</script>

<template>
  <label
    :class="[
      'tw:inline-flex tw:items-center tw:gap-2',
      props.disabled ? 'tw:cursor-not-allowed tw:opacity-60' : 'tw:cursor-pointer',
    ]"
    :for="props.id"
  >
    <!--
      RadioGroupItem is the ARIA-focusable radio button.
      We style it as the visual circle and use RadioGroupIndicator
      to render the inner dot when checked.
    -->
    <RadioGroupItem
      :id="props.id"
      :value="String(resolvedValue ?? '')"
      :disabled="props.disabled"
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
      v-if="$slots.label || props.label"
      :class="[
        labelSize[resolvedSize],
        'tw:select-none tw:leading-none',
        props.disabled ? 'tw:text-radio-label-disabled' : 'tw:text-radio-label',
      ]"
    >
      <slot name="label">{{ props.label }}</slot>
    </span>
  </label>
</template>
