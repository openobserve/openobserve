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
import { computed, inject, useAttrs, watchEffect } from "vue";

defineOptions({ inheritAttrs: false });

// Forward the consumer's `data-test` from <ORadio data-test="…"> onto the
// inner RadioGroupItem (the ARIA-focusable radio button). This lets e2e
// tests target the actual interactive element via [data-test="…"] without
// relying on element-tag/class selectors. Mirrors OInput / OFile patterns.
// Also forward `data-test-value` so consumers that render N radios from a
// list can target each option by its value (audit pattern shared with OSelect).
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);
const parentDataTestValue = computed(() => $attrs["data-test-value"] as string | undefined);

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
      props.disabled ? 'tw:cursor-not-allowed' : 'tw:cursor-pointer',
    ]"
    :for="props.id"
  >
    <!--
      RadioGroupItem is the ARIA-focusable radio button.
      We style it as the visual circle and use RadioGroupIndicator
      to render the inner dot when checked.
    -->
    <!--
      Three visually distinct states:
        OFF      → primary outline + white bg + no dot
        ON       → primary outline + white bg + primary dot
        DISABLED → grey outline + grey bg + 50% opacity + dashed border
    -->
    <RadioGroupItem
      :id="props.id"
      :value="String(resolvedValue ?? '')"
      :disabled="props.disabled"
      :data-test="parentDataTest"
      :data-test-value="parentDataTestValue"
      :class="[
        'tw:shrink-0 tw:rounded-full tw:border-2 tw:flex tw:items-center tw:justify-center',
        'tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150',
        'tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base',
        'tw:focus-visible:ring-2 tw:focus-visible:ring-radio-focus-ring',
        circleSize[resolvedSize],
        'tw:bg-radio-bg tw:border-radio-border',
        'tw:enabled:hover:border-radio-hover-border',
        'tw:data-[state=checked]:border-radio-checked-border',
        'tw:data-disabled:bg-radio-disabled-bg',
        'tw:data-disabled:border-radio-disabled-border',
        'tw:data-disabled:border-dashed',
        'tw:data-disabled:cursor-not-allowed',
      ]"
    >
      <RadioGroupIndicator
        :class="[
          'tw:rounded-full tw:bg-radio-checked-dot',
          dotSize[resolvedSize],
        ]"
      />
    </RadioGroupItem>

    <span
      v-if="$slots.label || props.label"
      :class="[
        'o-input-label tw:text-sm tw:font-semibold tw:select-none tw:leading-tight',
        props.disabled && 'o-input-label--disabled',
      ]"
    >
      <slot name="label">{{ props.label }}</slot>
    </span>
  </label>
</template>
