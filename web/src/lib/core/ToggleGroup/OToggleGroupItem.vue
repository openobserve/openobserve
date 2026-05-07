<script setup lang="ts">
import type {
  ToggleGroupItemProps,
  ToggleGroupItemSlots,
} from "./OToggleGroup.types";
import { ToggleGroupItem } from "reka-ui";

const props = withDefaults(defineProps<ToggleGroupItemProps>(), {
  disabled: false,
  size: "md",
});

defineSlots<ToggleGroupItemSlots>();

const sizeClasses: Record<NonNullable<ToggleGroupItemProps["size"]>, string> = {
  md: "tw:h-9 tw:px-3 tw:text-sm",
  sm: "tw:h-7 tw:px-2.5 tw:text-xs",
  xs: "tw:h-3 tw:px-1.5 tw:text-xs",
};
</script>

<template>
  <ToggleGroupItem
    :value="props.value"
    :disabled="props.disabled"
    :class="[
      // Layout
      'tw:inline-flex tw:items-center tw:justify-center tw:gap-2',
      sizeClasses[props.size],
      // Base state - inactive (transparent on track)
      'tw:bg-toggle-item-bg tw:text-toggle-item-text tw:font-medium tw:whitespace-nowrap',
      'tw:rounded-md',
      'tw:transition-all tw:duration-150',
      'tw:outline-none tw:cursor-pointer',
      // Hover (inactive only)
      'tw:hover:bg-toggle-item-hover-bg',
      // Active / pressed state (data-state=on) — white chip with shadow
      'tw:data-[state=on]:bg-toggle-item-active-bg',
      'tw:data-[state=on]:text-toggle-item-active-text',
      'tw:data-[state=on]:shadow-sm',
      // Focus ring
      'tw:focus-visible:ring-2 tw:focus-visible:ring-toggle-focus-ring tw:focus-visible:ring-inset',
      // Disabled
      'tw:data-[disabled]:text-toggle-item-disabled',
      'tw:data-[disabled]:cursor-not-allowed tw:data-[disabled]:pointer-events-none',
    ]"
  >
    <slot name="icon-left" />
    <slot />
    <slot name="icon-right" />
  </ToggleGroupItem>
</template>
