<script setup lang="ts">
import type { OTabProps, OTabSlots } from "./OTab.types";
import { computed, inject, type ComputedRef } from "vue";
import { TABS_CONTEXT_KEY } from "./OTabs.types";
import type { TabsContext } from "./OTabs.types";
import { TabsTrigger } from "reka-ui";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { iconRegistry } from "@/lib/core/Icon/OIcon.icons";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useDragHandle from "@/composables/useDragHandle";

// Disable auto-attribute inheritance so the consumer's `data-test="..."` lands
// on the inner clickable TabsTrigger (Reka button) instead of the wrapper
// <span class="contents">. e2e tests can then locate and click the tab.
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<OTabProps>(), {
  disable: false,
  disableDrag: false,
});

defineSlots<OTabSlots>();

const context = inject<ComputedRef<TabsContext>>(TABS_CONTEXT_KEY);

const isActive = computed<boolean>(() => context?.value.modelValue === props.name);
const isDense = computed<boolean>(() => context?.value.dense ?? false);
const isVertical = computed<boolean>(() => context?.value.isVertical ?? false);
const isReorderable = computed<boolean>(() => context?.value.reorderable ?? false);
/** Reorderable, and this tab hasn't opted out (e.g. while its label is edited). */
const isDraggable = computed<boolean>(() => isReorderable.value && !props.disableDrag);
// Drag starts only from the grip: mousedown on the grip arms the tab's
// `draggable` attribute for the duration of that press (useDragHandle disarms
// on mouseup/dragend), so grabbing the tab body just clicks/selects — text on
// the label stays selectable-feeling and accidental drags can't happen.
const { arm: armDrag, isArmed: isDragArmed } = useDragHandle();
/** This tab is the one being dragged → dim it. */
const isDragging = computed<boolean>(
  () => isReorderable.value && context?.value.draggingName === props.name,
);
/** Pointer is hovering this tab as a drop target → show an insertion line. */
const isDropTarget = computed<boolean>(
  () =>
    isReorderable.value &&
    context?.value.dropTargetName != null &&
    context.value.dropTargetName === props.name,
);
/** Position class for the insertion line (which edge, and orientation). */
const dropIndicatorClass = computed<string>(() => {
  const before = context?.value.dropBefore ?? true;
  if (isVertical.value) {
    return before ? "top-0 left-1 right-1 h-0.5" : "bottom-0 left-1 right-1 h-0.5";
  }
  return before ? "left-0 top-1 bottom-1 w-0.5" : "right-0 top-1 bottom-1 w-0.5";
});

/** True when the icon prop uses the `img:` prefix (renders as <img>) */
const isImgIcon = computed<boolean>(() => Boolean(props.icon?.startsWith("img:")));
/** The resolved src URL (stripped of `img:` prefix) */
const imgSrc = computed<string>(() => (props.icon?.startsWith("img:") ? props.icon.slice(4) : ""));
/** True when the icon name is registered in the OIcon SVG registry (kebab-case) */
const isOIcon = computed<boolean>(() =>
  Boolean(props.icon && (props.icon as keyof typeof iconRegistry) in iconRegistry),
);

// ── Classes ────────────────────────────────────────────────────────────────
const baseClasses = computed<string>(() =>
  [
    "o-tab",
    // Named group so the grip (and consumer affordances like a rename pencil)
    // can fade in on tab hover without colliding with consumer `group` usage.
    "group/otab",
    "relative items-center gap-1.5",
    isVertical.value ? "flex justify-start" : "inline-flex justify-center",
    // Horizontal inset. A vertical (side-rail) tab is a selectable PILL, so the
    // rail container insets it (px-1.5) to give the pill breathing room from the
    // rail edges. With that 6px container inset + the tab's own 2px active border
    // + this pl-1, the label lands on the page-edge grid line (12px) while the
    // pill never touches the rail edge. Rails add the px-1.5; tabs don't hand-roll
    // their own padding override.
    // Reorderable tabs widen the left inset to a 0.75rem gutter that hosts the
    // hover-revealed drag grip. The gutter is tied to `reorderable` (not
    // per-press state), so a tab is pixel-identical at rest, on hover, and
    // while its label is being edited — the grip only ever changes opacity.
    isReorderable.value ? "pl-3 pr-2" : isVertical.value ? "pl-1 pr-2" : "px-2",
    "font-normal text-sm whitespace-nowrap",
    isVertical.value ? "rounded-default" : "rounded-t-default",
    "outline-none transition-[color,background-color,border-color,text-decoration-color,fill,stroke,box-shadow] duration-150",
    "select-none",
    "ring-offset-1 ring-offset-surface-base",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tabs-indicator",
  ].join(" "),
);

const stateClasses = computed<string>(() => {
  if (props.disable) {
    return [
      "text-tabs-disabled-text cursor-not-allowed opacity-60",
      // Keep the transparent left border so disabled items don't shift width.
      isVertical.value ? "border-l-2 border-transparent" : "",
    ].join(" ");
  }
  if (isActive.value) {
    // Horizontal tabs: colored text only. The active underline is a single
    // shared bar in OTabs that slides between tabs, so each tab keeps a
    // transparent 2px border (layout parity with inactive) rather than drawing
    // its own colored one.
    // Vertical tabs (side rail): tint bg + primary text + a colored left accent
    // border that reads as the active rail marker.
    return [
      "text-tabs-active-text cursor-pointer",
      isVertical.value
        ? "bg-tabs-active-bg border-l-2 border-tabs-indicator"
        : "border-b-2 border-transparent",
    ].join(" ");
  }
  return [
    "text-tabs-inactive-text cursor-pointer",
    isVertical.value
      ? "enabled:hover:text-tabs-hover-text enabled:hover:bg-tabs-hover-bg"
      : "enabled:hover:text-tabs-hover-text",
    // Transparent border (left for vertical, bottom for horizontal) keeps inactive
    // items the same size as the active one — no layout shift on activation.
    isVertical.value ? "border-l-2 border-transparent" : "border-b-2 border-transparent",
  ].join(" ");
});

const heightClasses = computed<string>(() => {
  if (isVertical.value) {
    return isDense.value ? "py-1.5" : "py-2";
  }
  return isDense.value ? "h-8" : "h-10";
});
</script>

<template>
  <!--
    Disabled buttons suppress hover events in browsers, so cursor-not-allowed set
    on the button itself never renders. The span wrapper intercepts hover and
    shows the cursor and tooltip even when the inner button is disabled.
  -->
  <span :class="disable ? 'cursor-not-allowed' : 'contents'">
    <!--
      TabsTrigger handles: role="tab", aria-selected, tabindex (via RovingFocusItem),
      disabled, data-state, click/keyboard activation, and aria-controls linkage.
      aria-disabled is passed explicitly for screen-reader compatibility.
      data-test is forwarded so Playwright can reliably target the clickable button —
      `v-bind="$attrs"` forwards the consumer's data-test onto the inner Reka
      button, which is where data-state="active" also lives so the
      `[data-test="X"][data-state="active"]` composite selectors work.
    -->
    <TabsTrigger
      :value="name"
      :disabled="disable"
      :aria-disabled="disable || undefined"
      :id="`tab-${name}`"
      :aria-controls="`tab-panel-${name}`"
      :class="[baseClasses, stateClasses, heightClasses, isDragging ? 'opacity-40' : '']"
      :draggable="(isDraggable && isDragArmed()) || undefined"
      :data-otab-name="name"
      v-bind="$attrs"
    >
      <!-- Insertion line — shows where the dragged tab will land (before/after
           this drop-target tab) so the drop position is visible during drag.
           Together with the grab cursor and the FLIP slide it carries the whole
           reorder affordance — reorderable tabs stay clean text (no grip icon),
           matching Sheets/Grafana tab strips. -->
      <span
        v-if="isDropTarget"
        aria-hidden="true"
        class="bg-tabs-indicator pointer-events-none absolute z-20 rounded-full"
        :class="dropIndicatorClass"
      />
      <!-- Drag grip — lives inside the reorderable tab's 1rem left gutter
           (absolute, so it never participates in layout) and fades in on tab
           hover, Gmail-style: at rest the gutter reads as ordinary padding.
           Dragging is armed only by pressing the grip; while the tab opts out
           (disableDrag, e.g. label editing) the grip stays mounted but inert so
           nothing shifts. Decorative for AT — drag has no keyboard path. -->
      <span
        v-if="isReorderable && !disable"
        aria-hidden="true"
        data-otab-grip
        class="absolute inset-y-0 left-0 z-10 flex w-3 items-center justify-center transition-opacity duration-150"
        :class="
          isDraggable
            ? 'cursor-grab opacity-0 group-hover/otab:opacity-50 hover:!opacity-100 active:cursor-grabbing'
            : 'pointer-events-none opacity-0'
        "
        @mousedown="isDraggable && armDrag()"
      >
        <OIcon name="drag-indicator" size="sm" />
      </span>
      <!--
        If label or icon props are provided, render them (prop-driven mode).
        If neither is set, fall back to the default slot (custom content mode:
        badges, close icons, folder rows, etc.).
      -->
      <template v-if="label || icon">
        <slot name="icon">
          <!-- img: prefix → render as <img> -->
          <img
            v-if="icon && isImgIcon"
            :src="imgSrc"
            class="o-tab__icon h-4 w-4 shrink-0 object-contain"
            aria-hidden="true"
            alt=""
          />
          <!-- OIcon registry name (kebab-case SVG icon) -->
          <OIcon
            v-else-if="icon && isOIcon"
            :name="icon as any"
            size="sm"
            class="o-tab__icon shrink-0"
          />
          <!-- Fallback: Material icon font glyph (legacy underscore names) -->
          <span
            v-else-if="icon"
            class="o-tab__icon material-icons-outlined shrink-0 text-base leading-none"
            >{{ icon }}</span
          >
        </slot>
        <span
          v-if="label"
          class="o-tab__label truncate"
          :class="context?.collapseLabels && !isActive ? 'max-md:hidden' : ''"
          >{{ label }}</span
        >
      </template>
      <slot v-else />
    </TabsTrigger>
    <OTooltip v-if="tooltip" :content="tooltip" />
  </span>
</template>
