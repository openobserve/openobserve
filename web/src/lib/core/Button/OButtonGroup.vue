<script setup lang="ts">
import type { ButtonGroupProps, ButtonGroupSlots } from "./OButtonGroup.types";

const props = withDefaults(defineProps<ButtonGroupProps>(), {
  orientation: "horizontal",
  align: "stretch",
  radius: "md",
});

defineSlots<ButtonGroupSlots>();

const radiusClasses: Record<NonNullable<ButtonGroupProps["radius"]>, string> = {
  sm: "tw:rounded",
  md: "tw:rounded-md",
  lg: "tw:rounded-lg",
};

const alignClasses: Record<NonNullable<ButtonGroupProps["align"]>, string> = {
  stretch: "tw:items-stretch",
  center: "tw:items-center",
  start: "tw:items-start",
  end: "tw:items-end",
};
</script>

<template>
  <div
    :class="[
      'tw:inline-flex tw:overflow-hidden',
      radiusClasses[props.radius],
      alignClasses[props.align],
      props.orientation === 'vertical' ? 'tw:flex-col' : 'tw:flex-row',
      // Divider between sibling buttons
      props.orientation === 'horizontal'
        ? 'tw:divide-x tw:divide-button-group-divider'
        : 'tw:divide-y tw:divide-button-group-divider',
      // First child: keep only the start-side radius (RTL-safe logical properties)
      props.orientation === 'horizontal'
        ? 'tw:[&>*:first-child]:rounded-e-none tw:[&>*:last-child]:rounded-s-none'
        : 'tw:[&>*:first-child]:rounded-b-none tw:[&>*:last-child]:rounded-t-none',
      // Middle children: strip all radii
      'tw:[&>*:not(:first-child):not(:last-child)]:rounded-none',
    ]"
    role="group"
  >
    <slot />
  </div>
</template>
