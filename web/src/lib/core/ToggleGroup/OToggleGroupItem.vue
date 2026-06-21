<script setup lang="ts">
import type {
  ToggleGroupItemProps,
  ToggleGroupItemSlots,
} from "./OToggleGroup.types";
import { ToggleGroupItem } from "reka-ui";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<ToggleGroupItemProps>(), {
  disabled: false,
  size: "md",
});

const slots = defineSlots<ToggleGroupItemSlots>();

const sizeClasses: Record<NonNullable<ToggleGroupItemProps["size"]>, string> = {
  md: "tw:h-9 tw:px-3 tw:text-sm",
  sm: "tw:h-7 tw:px-2.5 tw:text-xs",
  xs: "tw:h-5 tw:px-1.5 tw:text-xs",
};

// Icon size mirrors the toggle size — md = sm icon (16px), sm/xs = xs icon (12px)
const iconSize: Record<NonNullable<ToggleGroupItemProps["size"]>, "xs" | "sm"> =
  {
    md: "md",
    sm: "sm",
    xs: "xs",
  };
</script>

<template>
  <!--
    Disabled buttons suppress hover events when pointer-events-none is set.
    The span wrapper intercepts hover so cursor-not-allowed and the tooltip
    remain visible even when the inner item is disabled.
  -->
  <span :class="props.disabled ? 'tw:cursor-not-allowed' : 'tw:contents'">
    <ToggleGroupItem
      v-bind="$attrs"
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
        // Disabled — cursor is on the wrapper span; pointer-events-none prevents hover/active styles
        'tw:data-disabled:text-toggle-item-disabled tw:data-disabled:opacity-60',
        'tw:data-disabled:pointer-events-none',
      ]"
    >
      <!-- Slot takes precedence; falls back to `icon-left` prop -->
      <slot v-if="slots['icon-left']" name="icon-left" />
      <OIcon v-else-if="props.iconLeft" :name="props.iconLeft" :size="iconSize[props.size]" />
      <slot />
      <slot v-if="slots['icon-right']" name="icon-right" />
      <OIcon v-else-if="props.iconRight" :name="props.iconRight" :size="iconSize[props.size]" />
    </ToggleGroupItem>
    <OTooltip v-if="props.tooltip" :content="props.tooltip" />
  </span>
</template>
