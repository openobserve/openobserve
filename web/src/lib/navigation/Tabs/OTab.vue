<script setup lang="ts">
import type { OTabProps, OTabSlots } from "./OTab.types";
import { computed, inject, onMounted, watch, type ComputedRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { TABS_CONTEXT_KEY } from "./OTabs.types";
import type { TabsContext } from "./OTabs.types";
import { TabsTrigger } from "reka-ui";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { iconRegistry } from "@/lib/core/Icon/OIcon.icons";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import useDragHandle from "@/composables/useDragHandle";
import { useLockedDisabled } from "@/composables/useFeatureLock";
import { useI18nTyped } from "@/types/i18n";

// Disable auto-attribute inheritance so the consumer's `data-test="..."` lands
// on the inner clickable TabsTrigger (Reka button) instead of the wrapper
// <span class="contents">. e2e tests can then locate and click the tab.
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<OTabProps>(), {
  disabled: false,
  disableDrag: false,
  locked: false,
  dirty: false,
  countTone: "default",
});

const slots = defineSlots<OTabSlots>();

const { t } = useI18nTyped();
const context = inject<ComputedRef<TabsContext>>(TABS_CONTEXT_KEY);
// Only a route tab reads the router, so a plain tab renders where none is installed.
const isRouteTab = props.to !== undefined;
const router = isRouteTab ? useRouter() : null;
const route = isRouteTab ? useRoute() : null;

const isDisabled = useLockedDisabled(() => props.disabled);
const isActive = computed<boolean>(() => context?.value.modelValue === props.name);
const isCompact = computed<boolean>(() => context?.value.size === "compact");
const isVertical = computed<boolean>(() => context?.value.isVertical ?? false);
const isReorderable = computed<boolean>(() => context?.value.reorderable ?? false);
/** Reorderable, and this tab hasn't opted out (e.g. while its label is edited). */
const isDraggable = computed<boolean>(() => isReorderable.value && !props.disableDrag);
// Only a grip press arms a drag; it stops mousedown because the trigger selects on press, which would navigate away.
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

// ── Route tab ──────────────────────────────────────────────────────────────
function syncWithRoute(): void {
  if (props.to === undefined || !route || !context?.value) return;
  if (route.name === props.name && context.value.modelValue !== props.name) {
    context.value.onTabClick(props.name);
  }
}
onMounted(syncWithRoute);
watch(() => route?.name, syncWithRoute);

function handleClick(): void {
  if (isDisabled.value || props.to === undefined) return;
  router?.push(props.to);
}

// ── Count ──────────────────────────────────────────────────────────────────
const hasCount = computed<boolean>(() => props.count !== undefined);
const countText = computed<string>(() => {
  if (props.count == null) return "";
  return props.count > 999 ? "999+" : String(props.count);
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
// One weight (500) in every state, so selecting or hovering never changes a tab's width (guideline H8).
const baseClasses = computed<string>(() =>
  [
    "o-tab",
    // Named group so the grip (and consumer affordances like a rename pencil)
    // can fade in on tab hover without colliding with consumer `group` usage.
    "group/otab",
    "relative items-center",
    isVertical.value ? "flex justify-start gap-2" : "inline-flex justify-center gap-1.5",
    // The rail's px-1 plus this px-2 puts a vertical tab's icon on the 12px page-edge grid line.
    // Reorderable tabs keep a fixed 0.75rem gutter for the grip, so hovering or editing never shifts the label.
    isReorderable.value
      ? "ps-3 pe-2"
      : isVertical.value
        ? "px-2"
        : slots.trailing
          ? "ps-2 pe-1"
          : "px-2",
    "text-compact font-medium whitespace-nowrap",
    isVertical.value ? "rounded-default" : "rounded-t-default",
    "outline-none transition-[color,background-color,border-color,text-decoration-color,fill,stroke] duration-(--duration-control) ease-(--ease-control)",
    "select-none",
    "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focus-ring-accent",
    // The horizontal strip scrolls on x, which clips y as well, so an outside outline would lose its bottom edge.
    isVertical.value ? "focus-visible:outline-offset-0" : "focus-visible:-outline-offset-2",
  ].join(" "),
);

const stateClasses = computed<string>(() => {
  // A locked page disables its active tab too; it still has to read as the current one.
  if (isDisabled.value && isActive.value) {
    return [
      "text-tabs-active-text cursor-not-allowed",
      isVertical.value
        ? "bg-tabs-active-bg ring-tabs-indicator ring-1 ring-inset"
        : "border-b-2 border-transparent",
    ].join(" ");
  }
  if (isDisabled.value) {
    return [
      "text-tabs-disabled-text cursor-not-allowed",
      isVertical.value ? "" : "border-b-2 border-transparent",
    ].join(" ");
  }
  if (isActive.value) {
    // Horizontal tabs: colored text only. The active underline is a single
    // shared bar in OTabs that slides between tabs, so each tab keeps a
    // transparent 2px border (layout parity with inactive) rather than drawing
    // its own colored one.
    return [
      "text-tabs-active-text cursor-pointer",
      isVertical.value
        ? "bg-tabs-active-bg ring-tabs-indicator ring-1 ring-inset"
        : "border-b-2 border-transparent",
    ].join(" ");
  }
  if (isVertical.value) {
    return "text-text-body cursor-pointer enabled:hover:text-tabs-hover-text enabled:hover:bg-tabs-rail-hover-bg";
  }
  return "text-tabs-inactive-text cursor-pointer enabled:hover:text-tabs-hover-text border-b-2 border-transparent";
});

// A muted glyph lets the rail's labels lead; the active tab's icon inherits its accent text.
const iconToneClass = computed<string>(() =>
  isVertical.value && !isActive.value && !isDisabled.value
    ? "text-text-secondary group-hover/otab:text-tabs-hover-text"
    : "",
);

const heightClasses = computed<string>(() => {
  if (isVertical.value) {
    return isCompact.value ? "min-h-control-sm py-1" : "min-h-control-md py-1.5";
  }
  return isCompact.value ? "h-control-md" : "h-tabs-height";
});

const countClasses = computed<string>(() =>
  [
    "o-tab__count inline-block shrink-0 rounded-full px-1.25 text-center text-2xs leading-4 font-medium tabular-nums",
    // Four characters wide: "999+" is the cap, so a growing count never pushes the next tab.
    "min-w-[calc(4ch+0.625rem)]",
    props.countTone === "error"
      ? "bg-badge-error-soft-bg text-badge-error-soft-text"
      : "bg-surface-subtle text-text-secondary",
    props.count == null ? "invisible" : "",
  ].join(" "),
);
</script>

<template>
  <!--
    Disabled buttons suppress hover events in browsers, so cursor-not-allowed set
    on the button itself never renders. The span wrapper intercepts hover and
    shows the cursor and tooltip even when the inner button is disabled.
  -->
  <span :class="isDisabled ? 'cursor-not-allowed' : 'contents'">
    <!--
      TabsTrigger handles: role="tab", aria-selected, tabindex (via RovingFocusItem),
      disabled, data-state, click/keyboard activation, and aria-controls linkage.
      aria-disabled is passed explicitly for screen-reader compatibility.
      `v-bind="$attrs"` forwards the consumer's data-test onto the inner Reka
      button, which is where data-state="active" also lives.
    -->
    <TabsTrigger
      :value="name"
      :disabled="isDisabled"
      :aria-disabled="isDisabled || undefined"
      :id="`tab-${name}`"
      :aria-controls="`tab-panel-${name}`"
      :class="[baseClasses, stateClasses, heightClasses, isDragging ? 'opacity-40' : '']"
      :draggable="(isDraggable && isDragArmed()) || undefined"
      :data-otab-name="name"
      v-bind="$attrs"
      @click="handleClick"
    >
      <!-- Insertion line: where the dragged tab will land (before/after this drop target). -->
      <span
        v-if="isDropTarget"
        aria-hidden="true"
        class="bg-tabs-indicator pointer-events-none absolute z-20 rounded-full"
        :class="dropIndicatorClass"
      />
      <!-- The grip arms a drag on press; it sits in the reorderable gutter, so it never shifts the label. -->
      <span
        v-if="isReorderable && !isDisabled"
        aria-hidden="true"
        data-otab-grip
        class="absolute inset-y-0 left-0 z-10 flex w-3 items-center justify-center transition-opacity duration-150"
        :class="
          isDraggable
            ? 'cursor-grab opacity-0 group-hover/otab:opacity-50 hover:!opacity-100 active:cursor-grabbing'
            : 'pointer-events-none opacity-0'
        "
        @mousedown.stop="isDraggable && armDrag()"
      >
        <OIcon name="drag-indicator" size="sm" />
      </span>
      <template v-if="label || icon">
        <slot name="icon">
          <img
            v-if="icon && isImgIcon"
            :src="imgSrc"
            class="o-tab__icon h-4 w-4 shrink-0 object-contain"
            aria-hidden="true"
            alt=""
          />
          <OIcon
            v-else-if="icon && isOIcon"
            :name="icon as any"
            size="sm"
            class="o-tab__icon shrink-0"
            :class="iconToneClass"
          />
          <span
            v-else-if="icon"
            class="o-tab__icon material-icons-outlined shrink-0 text-base leading-none"
            :class="iconToneClass"
            >{{ icon }}</span
          >
        </slot>
        <OTruncatedText
          v-if="label"
          class="o-tab__label"
          :class="context?.collapseLabels && !isActive ? 'max-md:hidden' : ''"
          :tooltip="tooltip ? false : undefined"
          >{{ label }}</OTruncatedText
        >
      </template>
      <slot v-else />
      <span v-if="hasCount" :class="countClasses" data-test="o-tab-count">{{ countText }}</span>
      <span
        v-if="dirty"
        class="bg-tabs-indicator size-1.5 shrink-0 rounded-full"
        data-test="o-tab-dirty"
        :aria-label="t('components.tabs.unsaved')"
        role="img"
      />
      <template v-if="locked">
        <OIcon
          name="lock"
          size="xs"
          class="lock-chip shrink-0"
          :class="isVertical ? 'ms-auto' : ''"
          data-test="o-tab-lock"
        />
        <span class="sr-only">{{ lockedLabel ?? tooltip ?? t("components.tabs.locked") }}</span>
      </template>
    </TabsTrigger>
    <!-- OTabs measures this with the trigger for the underline and the overflow arrows. -->
    <span
      v-if="slots.trailing"
      data-otab-trailing
      class="inline-flex shrink-0 items-center gap-0.5 border-b-2 border-transparent pe-1.5"
      :class="heightClasses"
    >
      <slot name="trailing" />
    </span>
    <OTooltip v-if="tooltip" :content="tooltip" />
  </span>
</template>
