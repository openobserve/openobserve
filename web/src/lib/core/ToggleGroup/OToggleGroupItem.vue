<script setup lang="ts">
import type {
  ToggleGroupItemProps,
  ToggleGroupItemSlots,
  ToggleGroupContext,
} from "./OToggleGroup.types";
import {
  ToggleGroupAnimatedKey,
  ToggleGroupMenuKey,
  TOGGLE_GROUP_CONTEXT_KEY,
} from "./OToggleGroup.types";
import { ToggleGroupItem } from "reka-ui";
import { computed, inject, useAttrs, type ComputedRef } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";

defineOptions({ inheritAttrs: false });

// Opt-in from the parent OToggleGroup: when set, the active item runs the sheen.
const animatedSelection = inject(ToggleGroupAnimatedKey, undefined);
const isAnimated = computed(() => Boolean(animatedSelection?.value));

const props = withDefaults(defineProps<ToggleGroupItemProps>(), {
  disabled: false,
  size: "md",
});

const slots = defineSlots<ToggleGroupItemSlots>();

// Set when the parent group has collapsed into a dropdown (phones): render as its trigger label or a menu row.
const menu = inject(ToggleGroupMenuKey, null);
const attrs = useAttrs();
const menuItemTestId = computed(() =>
  attrs["data-test"] ? `${attrs["data-test"]}-item` : `o-toggle-group-item-${String(props.value)}`,
);

// An item may be used standalone (no OToggleGroup parent), so the context is
// optional and every read below is guarded.
const context = inject<ComputedRef<ToggleGroupContext> | undefined>(TOGGLE_GROUP_CONTEXT_KEY);

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
    return before ? "top-0 left-1 right-1 h-0.5" : "bottom-0 left-1 right-1 h-0.5";
  }
  return before ? "left-0 top-1 bottom-1 w-0.5" : "right-0 top-1 bottom-1 w-0.5";
});

// < md the horizontal padding tightens by ~4px a side. A four-item filter strip
// overruns a 375px screen by ~11px at the desktop padding, and wrapping one item
// onto a second line costs far more than the padding does.
const sizeClasses: Record<NonNullable<ToggleGroupItemProps["size"]>, string> = {
  md: "h-9 px-3 text-sm max-md:px-2",
  sm: "h-7 px-2.5 text-xs max-md:px-1.5",
  xs: "h-5 px-1.5 text-xs max-md:px-1",
};

// Icon size mirrors the toggle size
const iconSize: Record<NonNullable<ToggleGroupItemProps["size"]>, "xs" | "sm" | "md"> = {
  md: "md",
  sm: "sm",
  xs: "xs",
};
</script>

<template>
  <template v-if="menu?.mode === 'trigger'">
    <template v-if="menu.isActive(props.value)">
      <slot v-if="slots['icon-left']" name="icon-left" />
      <OIcon v-else-if="props.iconLeft" :name="props.iconLeft" size="sm" />
      <slot />
    </template>
  </template>
  <ODropdownItem
    v-else-if="menu"
    :disabled="props.disabled"
    :data-test="menuItemTestId"
    @select="menu.select(props.value)"
  >
    <template v-if="slots['icon-left'] || props.iconLeft" #icon-left>
      <slot v-if="slots['icon-left']" name="icon-left" />
      <OIcon v-else-if="props.iconLeft" :name="props.iconLeft" size="sm" />
    </template>
    <slot />
    <template #icon-right>
      <OIcon v-if="menu.isActive(props.value)" name="check" size="sm" class="ms-auto" />
    </template>
  </ODropdownItem>
  <!--
    Disabled buttons suppress hover events when pointer-events-none is set.
    The span wrapper intercepts hover so cursor-not-allowed and the tooltip
    remain visible even when the inner item is disabled.
  -->
  <span v-else :class="props.disabled ? 'cursor-not-allowed' : 'contents'">
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
        'rounded-default',
        'transition-all duration-150',
        'cursor-pointer outline-none',
        // Hover (inactive only) — scoped to data-state=off so hovering the
        // active item never repaints over the sliding indicator / active fill.
        'data-[state=off]:hover:bg-toggle-item-hover-bg',
        // Active fill: normally painted per-item. When the group animates the
        // selection (opt-in), a single sliding indicator paints the fill instead,
        // so suppress the per-item background and just keep the active text colour.
        !isAnimated && 'data-[state=on]:bg-toggle-item-active-bg',
        'data-[state=on]:text-toggle-item-active-text',
        // Sit above the sliding indicator so the icon/label stay readable.
        isAnimated && 'relative z-10',
        // Focus ring
        'focus-visible:ring-toggle-focus-ring focus-visible:ring-2 focus-visible:ring-inset',
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
        class="bg-toggle-drop-indicator pointer-events-none absolute z-20 rounded-full"
        :class="dropIndicatorClass"
      />
      <!-- Drag handle — shown only in reorderable mode to signal the item can be
           dragged to reorder. Purely an affordance; the whole item is draggable. -->
      <OIcon
        v-if="isReorderable"
        name="drag-indicator"
        :size="iconSize[props.size]"
        class="-ms-0.5 shrink-0 opacity-40"
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
