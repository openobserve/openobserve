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
// list can target each option by its value.
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);
const parentDataTestValue = computed(() => $attrs["data-test-value"] as string | undefined);

const props = withDefaults(defineProps<RadioProps>(), {
  size: "md",
  disabled: false,
  value: undefined,
  val: undefined,
  variant: "default",
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
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
};

const dotSize: Record<"xs" | "sm" | "md", string> = {
  xs: "size-1",
  sm: "size-1.5",
  md: "size-2",
};

const resolvedSize = computed(() => (props.size ?? "md") as "xs" | "sm" | "md");

const surfaceClasses = computed(() => [
  "inline-flex gap-2",
  props.variant === "card"
    ? [
        "w-full items-start rounded-surface border border-border-default bg-surface-base p-4",
        "transition-[color,background-color,border-color,box-shadow] duration-150",
        "hover:border-input-border-hover",
        "has-[[data-state=checked]]:border-input-border-focus",
        "has-[[data-state=checked]]:ring-2 has-[[data-state=checked]]:ring-accent/20",
      ]
    : "items-center",
  props.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
]);
</script>

<template>
  <label
    :class="surfaceClasses"
    :data-variant="props.variant === 'card' ? 'card' : undefined"
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
        'flex shrink-0 items-center justify-center rounded-full border-2',
        'transition-[color,background-color,border-color,box-shadow] duration-150',
        'ring-offset-surface-base ring-offset-1 outline-none',
        'focus-visible:ring-radio-focus-ring focus-visible:ring-2',
        circleSize[resolvedSize],
        'bg-radio-bg border-radio-border',
        'enabled:hover:border-radio-hover-border',
        'data-[state=checked]:border-radio-checked-border',
        'data-disabled:bg-radio-disabled-bg',
        'data-disabled:border-radio-disabled-border',
        'data-disabled:border-dashed',
        'data-disabled:cursor-not-allowed',
      ]"
    >
      <RadioGroupIndicator :class="['bg-radio-checked-dot rounded-full', dotSize[resolvedSize]]" />
    </RadioGroupItem>

    <span
      v-if="$slots.label || props.label"
      :class="[
        'o-input-label text-compact leading-tight select-none',
        props.variant === 'card' ? 'flex-1' : '',
        props.disabled
          ? 'text-input-label-text-disabled font-normal'
          : 'text-input-label-text font-medium',
      ]"
    >
      <slot name="label">{{ props.label }}</slot>
    </span>
  </label>
</template>
