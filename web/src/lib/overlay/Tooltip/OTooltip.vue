<script setup lang="ts">
import type { TooltipProps, TooltipSlots } from "./OTooltip.types";
import {
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipArrow,
} from "reka-ui";
import { ref, computed, onMounted, onUnmounted, useAttrs, useSlots } from "vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";

// Both modes render a fragment (provider + portalled content, or the child-mode
// anchor pair), so Vue has no single root to fall attributes onto: anything a
// call site passed — class, style, aria-* — was silently DROPPED with an
// "Extraneous non-props attributes" warning. Take them over explicitly and put
// them on the bubble, which is what a caller styling or labelling a tooltip
// means.
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<TooltipProps>(), {
  side: "top",
  align: "center",
  sideOffset: 4,
  alignOffset: 0,
  delay: 700,
  maxWidth: "320px",
  disabled: false,
  hoverable: false,
  // MUST stay explicitly undefined. Vue casts an absent Boolean prop to `false`,
  // so without this `open` is false rather than undefined — the `open !== undefined`
  // guard below then passes, TooltipRoot receives `open: false`, and reka switches
  // into CONTROLLED mode locked shut. Wrapper mode never emits update:open, so the
  // tooltip could never open: hovering left the trigger at data-state="closed"
  // forever. Child mode was unaffected because it drives `open` itself.
  open: undefined,
});

defineSlots<TooltipSlots>();

const slots = useSlots();
const hasDefaultSlot = computed(() => !!slots.default);

const attrs = useAttrs();

// `data-test` stays owned by the component: e2e selects the bubble by
// `o-tooltip-content` in many places, so a call-site value must not replace it.
// Everything else (class, style, aria-*, id) is forwarded to the content.
const forwardedAttrs = computed(() => {
  const { "data-test": _componentOwned, ...rest } = attrs;
  return rest;
});

// ─── Child mode (placed inside a parent element as its tooltip) ───────────────
// When no default slot is provided, OTooltip attaches to its parent: it finds
// its parent element via a hidden DOM anchor span and attaches hover listeners to it.
const childAnchorRef = ref<HTMLSpanElement | null>(null);
const parentEl = ref<Element | null>(null);
const childOpen = ref(false);
let cleanupFn: (() => void) | null = null;
// Pending open timer for the hover delay (child mode). Wrapper mode gets its
// delay for free from reka's `delay-duration`; child mode wires its own hover
// listeners, so it has to honour `props.delay` here too.
let childShowTimer: ReturnType<typeof setTimeout> | null = null;
// Grace-period close timer used only when `hoverable` is set. On leaving the
// trigger we wait briefly before closing so the pointer can travel onto the
// bubble; entering the bubble cancels this timer and keeps the tooltip open.
let childHideTimer: ReturnType<typeof setTimeout> | null = null;
const HOVERABLE_GRACE_MS = 120;

// Called from the content bubble's hover handlers (child mode). Entering the
// bubble cancels a pending close; leaving it closes the tooltip.
const onContentEnter = () => {
  if (!props.hoverable) return;
  if (childHideTimer) {
    clearTimeout(childHideTimer);
    childHideTimer = null;
  }
};
const onContentLeave = () => {
  if (!props.hoverable) return;
  childOpen.value = false;
};

onMounted(() => {
  if (!hasDefaultSlot.value && childAnchorRef.value) {
    // Prefer the nearest previous visible sibling — the actual trigger element (e.g. the
    // ToggleGroupItem button). Walking up instead when the parent is display:contents would
    // land on the group container, causing all items in the group to share one hover target.
    let sibling: Element | null = childAnchorRef.value.previousElementSibling;
    while (sibling && (sibling as HTMLElement).style.display === "none") {
      sibling = sibling.previousElementSibling;
    }

    let candidate: Element | null = sibling;
    if (!candidate) {
      // Fallback: walk up past display:contents ancestors — they have no layout box
      // and getBoundingClientRect() returns all-zeros, sending the tooltip to (0,0).
      candidate = childAnchorRef.value.parentElement;
      while (candidate && window.getComputedStyle(candidate).display === "contents") {
        candidate = candidate.parentElement;
      }
    }
    parentEl.value = candidate;
    if (parentEl.value) {
      // Open after `props.delay` ms of hover (matching wrapper mode); leaving
      // before then cancels the pending open so a quick pass-over shows nothing.
      const show = () => {
        if (props.disabled) return;
        if (childShowTimer) clearTimeout(childShowTimer);
        if (props.delay > 0) {
          childShowTimer = setTimeout(() => {
            childOpen.value = true;
            childShowTimer = null;
          }, props.delay);
        } else {
          childOpen.value = true;
        }
      };
      const hide = () => {
        if (childShowTimer) {
          clearTimeout(childShowTimer);
          childShowTimer = null;
        }
        if (props.hoverable) {
          // Delay the close so the pointer can reach the bubble; onContentEnter
          // cancels this timer if it lands there in time.
          if (childHideTimer) clearTimeout(childHideTimer);
          childHideTimer = setTimeout(() => {
            childOpen.value = false;
            childHideTimer = null;
          }, HOVERABLE_GRACE_MS);
        } else {
          childOpen.value = false;
        }
      };
      parentEl.value.addEventListener("mouseenter", show);
      parentEl.value.addEventListener("mouseleave", hide);
      cleanupFn = () => {
        parentEl.value?.removeEventListener("mouseenter", show);
        parentEl.value?.removeEventListener("mouseleave", hide);
      };
    }
  }
});

onUnmounted(() => {
  if (childShowTimer) clearTimeout(childShowTimer);
  if (childHideTimer) clearTimeout(childHideTimer);
  cleanupFn?.();
});

const effectiveSideOffset = computed(() => props.sideOffset);

// filter:drop-shadow composites the bubble + SVG arrow as one silhouette so
// the shadow wraps the full speech-bubble shape with no seam at the arrow base.
// Layer 1: zero-offset soft halo — uniform separation from any background.
// Layer 2: directional depth shadow for elevation.
const contentStyle = computed(() => ({
  maxWidth: props.maxWidth,
  filter: [
    "drop-shadow(0 0 1px rgba(0,0,0,0.15))",
    "drop-shadow(0 4px 12px rgba(0,0,0,0.14))",
  ].join(" "),
}));

const contentClasses = computed(() => [
  "z-10100 px-2.5 py-1.5",
  "bg-surface-overlay rounded-default",
  "text-xs text-text-body font-medium leading-relaxed",
  // Force long unbreakable tokens (file paths, hashes, URLs) to wrap inside the
  // max-width box instead of overflowing onto the content behind the tooltip.
  // overflow-wrap is inherited, so nested content (e.g. pre-wrap divs) wraps too.
  "break-words",
  "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
  "data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
  "data-[side=top]:slide-in-from-bottom-1",
  "data-[side=bottom]:slide-in-from-top-1",
  "data-[side=left]:slide-in-from-right-1",
  "data-[side=right]:slide-in-from-left-1",
  // Hoverable tooltips let the pointer land on the bubble and select its text.
  props.hoverable ? "pointer-events-auto select-text cursor-text" : "",
  props.contentClass,
]);
</script>

<template>
  <!-- ΓöÇΓöÇ Wrapper mode: default slot provides the trigger ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ -->
  <TooltipProvider v-if="hasDefaultSlot">
    <TooltipRoot
      :delay-duration="delay"
      :disable-hoverable-content="!hoverable"
      v-bind="open !== undefined ? { open: disabled ? false : open } : {}"
      :disabled="disabled"
    >
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          v-bind="forwardedAttrs"
          data-test="o-tooltip-content"
          :side="side"
          :align="align"
          :side-offset="effectiveSideOffset"
          :align-offset="alignOffset"
          :style="contentStyle"
          :class="contentClasses"
        >
          <span :class="shortcut || shortcutId ? 'inline-flex items-center gap-1.5' : ''">
            <slot name="content">{{ content }}</slot>
            <OShortcut v-if="shortcut || shortcutId" :keys="shortcut" :id="shortcutId" />
          </span>
          <TooltipArrow :width="10" :height="5" :class="'fill-surface-overlay'" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>

  <!-- ── Child mode: no default slot, attaches to parent element as its tooltip -->
  <template v-else>
    <TooltipProvider>
      <TooltipRoot
        :delay-duration="0"
        :open="disabled ? false : childOpen"
        @update:open="childOpen = $event"
      >
        <!-- Hidden trigger span; reference overrides positioning anchor to parentEl -->
        <!-- NOTE: `style="display:none"` here is a FUNCTIONAL CONTRACT, not
             decoration — do NOT convert it to `class="hidden"`. The anchor
             resolution in onMounted() skips hidden siblings by testing
             `.style.display === "none"`, which only sees an INLINE style. With a
             class, that loop stops on this span and anchors every child-mode
             tooltip to a zero-size hidden element, so it never opens on hover. -->
        <TooltipTrigger
          as="span"
          :reference="parentEl ?? undefined"
          style="display: none"
          aria-hidden="true"
        />
        <TooltipPortal>
          <TooltipContent
            v-bind="forwardedAttrs"
            data-test="o-tooltip-content"
            :side="side"
            :align="align"
            :side-offset="effectiveSideOffset"
            :align-offset="alignOffset"
            :style="contentStyle"
            :class="contentClasses"
            @mouseenter="onContentEnter"
            @mouseleave="onContentLeave"
          >
            <span :class="shortcut || shortcutId ? 'inline-flex items-center gap-1.5' : ''">
              <slot name="content">{{ content }}</slot>
              <OShortcut v-if="shortcut || shortcutId" :keys="shortcut" :id="shortcutId" />
            </span>
            <TooltipArrow :width="10" :height="5" :class="'fill-surface-overlay'" />
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </TooltipProvider>
    <!-- Anchor placeholder: inserted at the real DOM position to resolve parentElement.
         `style="display:none"` is required, not decorative — see the note above. -->
    <span ref="childAnchorRef" style="display: none" aria-hidden="true" />
  </template>
</template>
