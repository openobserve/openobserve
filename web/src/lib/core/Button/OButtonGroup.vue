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
      // Never clip overflow here: it hides a child's offset focus outline; z-1 lifts it over the neighbour.
      'inline-flex [&_:focus-visible]:z-1',
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
        ? '[&>*:first-child:not(:only-child)]:rounded-e-none [&>*:last-child:not(:only-child)]:rounded-s-none'
        : '[&>*:first-child:not(:only-child)]:rounded-b-none [&>*:last-child:not(:only-child)]:rounded-t-none',
      // Middle children: strip all radii
      '[&>*:not(:first-child):not(:last-child)]:rounded-none',
      // Bordered (outline) children would otherwise stack two 1px edges at every join.
      props.orientation === 'horizontal'
        ? '[&>*:not(:first-child)]:border-s-0'
        : '[&>*:not(:first-child)]:border-t-0',
      // A pending child's border is its fill, so its divider borrows the one-step-darker hover fill.
      props.divided
        ? props.orientation === 'horizontal'
          ? '[&>[data-o2-variant=pending]:not(:last-child)]:border-e-button-pending-hover-bg'
          : '[&>[data-o2-variant=pending]:not(:last-child)]:border-b-button-pending-hover-bg'
        : '',
    ]"
    role="group"
  >
    <slot />
  </div>
</template>
