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
  md: "h-9 px-3 text-sm",
  sm: "h-7 px-2.5 text-xs",
  xs: "h-5 px-1.5 text-xs",
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
  <span :class="props.disabled ? 'cursor-not-allowed' : 'contents'">
    <ToggleGroupItem
      v-bind="$attrs"
      :value="props.value"
      :disabled="props.disabled"
      :class="[
        // Layout
        'inline-flex items-center justify-center gap-2',
        sizeClasses[props.size],
        // Base state - inactive (transparent on track)
        'bg-toggle-item-bg text-toggle-item-text font-medium whitespace-nowrap',
        'rounded-md',
        'transition-all duration-150',
        'outline-none cursor-pointer',
        // Hover (inactive only)
        'hover:bg-toggle-item-hover-bg',
        // Active / pressed state (data-state=on) — white chip with shadow
        'data-[state=on]:bg-toggle-item-active-bg',
        'data-[state=on]:text-toggle-item-active-text',
        'data-[state=on]:shadow-sm',
        // Focus ring
        'focus-visible:ring-2 focus-visible:ring-toggle-focus-ring focus-visible:ring-inset',
        // Disabled — cursor is on the wrapper span; pointer-events-none prevents hover/active styles
        'data-disabled:text-toggle-item-disabled data-disabled:opacity-60',
        'data-disabled:pointer-events-none',
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
