<script setup lang="ts">
import type {
  ToggleGroupItemProps,
  ToggleGroupItemSlots,
  ToggleGroupContext,
} from "./OToggleGroup.types";
import { TOGGLE_GROUP_CONTEXT_KEY } from "./OToggleGroup.types";
import { ToggleGroupItem } from "reka-ui";
import { computed, inject, type ComputedRef } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<ToggleGroupItemProps>(), {
  disabled: false,
  size: "md",
});

const slots = defineSlots<ToggleGroupItemSlots>();

const context = inject<ComputedRef<ToggleGroupContext>>(
  TOGGLE_GROUP_CONTEXT_KEY,
  undefined,
);

/**
 * Values round-trip through the DOM `dataset` as strings, so drag comparisons
 * are done on the stringified value.
 */
const dragKey = computed<string>(() => String(props.value));

// Disabled items are never draggable — they can't be interacted with at all.
const isReorderable = computed<boolean>(
  () => (context?.value.reorderable ?? false) && !props.disabled,
);
/** This item is the one being dragged → dim it. */
const isDragging = computed<boolean>(
  () => isReorderable.value && context?.value.draggingValue === dragKey.value,
);
/** Pointer is hovering this item as a drop target → show an insertion line. */
const isDropTarget = computed<boolean>(
  () =>
    isReorderable.value &&
    context?.value.dropTargetValue != null &&
    context.value.dropTargetValue === dragKey.value,
);
/** Position class for the insertion line (which edge, and orientation). */
const dropIndicatorClass = computed<string>(() => {
  const before = context?.value.dropBefore ?? true;
  if (context?.value.isVertical) {
    return before
      ? "top-0 left-1 right-1 h-0.5"
      : "bottom-0 left-1 right-1 h-0.5";
  }
  return before ? "left-0 top-1 bottom-1 w-0.5" : "right-0 top-1 bottom-1 w-0.5";
});

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
        // Reorderable — `relative` anchors the absolute insertion line below
        isReorderable ? 'relative cursor-grab active:cursor-grabbing' : '',
        isDragging ? 'opacity-40' : '',
      ]"
      :draggable="isReorderable || undefined"
      :data-otoggle-value="dragKey"
    >
      <!-- Insertion line — shows where the dragged item will land (before/after
           this drop-target item) so the drop position is visible during drag. -->
      <span
        v-if="isDropTarget"
        aria-hidden="true"
        class="absolute rounded-full bg-primary-600 pointer-events-none z-20"
        :class="dropIndicatorClass"
      />
      <!-- Drag handle — shown only in reorderable mode to signal the item can be
           dragged to reorder. Purely an affordance; the whole item is draggable. -->
      <OIcon
        v-if="isReorderable"
        name="drag-indicator"
        :size="iconSize[props.size]"
        class="shrink-0 opacity-40 -ml-0.5"
        aria-hidden="true"
      />
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
