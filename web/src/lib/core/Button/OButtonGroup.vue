<script setup lang="ts">
import type { ButtonGroupProps, ButtonGroupSlots } from "./OButtonGroup.types";

const props = withDefaults(defineProps<ButtonGroupProps>(), {
  orientation: "horizontal",
  align: "stretch",
  radius: "md",
  divided: true,
});

defineSlots<ButtonGroupSlots>();

const radiusClasses: Record<NonNullable<ButtonGroupProps["radius"]>, string> = {
  sm: "rounded-default",
  md: "rounded-default",
  lg: "rounded-default",
};

const alignClasses: Record<NonNullable<ButtonGroupProps["align"]>, string> = {
  stretch: "items-stretch",
  center: "items-center",
  start: "items-start",
  end: "items-end",
};
</script>

<template>
  <div
    :class="[
      'inline-flex overflow-hidden',
      radiusClasses[props.radius],
      alignClasses[props.align],
      props.orientation === 'vertical' ? 'flex-col' : 'flex-row',
      // Divider between sibling buttons (omitted when divided=false for a
      // seamless single pill).
      props.divided
        ? props.orientation === 'horizontal'
          ? 'divide-button-group-divider divide-x'
          : 'divide-button-group-divider divide-y'
        : '',
      // First child: keep only the start-side radius (RTL-safe logical properties)
      props.orientation === 'horizontal'
        ? '[&>*:first-child]:rounded-e-none [&>*:last-child]:rounded-s-none'
        : '[&>*:first-child]:rounded-b-none [&>*:last-child]:rounded-t-none',
      // Middle children: strip all radii
      '[&>*:not(:first-child):not(:last-child)]:rounded-none',
    ]"
    role="group"
  >
    <slot />
  </div>
</template>
