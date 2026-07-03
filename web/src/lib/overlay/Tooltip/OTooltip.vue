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
import { ref, computed, onMounted, onUnmounted, useSlots } from "vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";

const props = withDefaults(defineProps<TooltipProps>(), {
  side: "top",
  align: "center",
  sideOffset: 4,
  alignOffset: 0,
  delay: 700,
  maxWidth: "320px",
  disabled: false,
});

defineSlots<TooltipSlots>();

const slots = useSlots();
const hasDefaultSlot = computed(() => !!slots.default);

// ΓöÇΓöÇΓöÇ Child mode (placed inside a parent like q-tooltip) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// When no default slot is provided, OTooltip acts like q-tooltip: it finds its
// parent element via a hidden DOM anchor span and attaches hover listeners to it.
const childAnchorRef = ref<HTMLSpanElement | null>(null);
const parentEl = ref<Element | null>(null);
const childOpen = ref(false);
let cleanupFn: (() => void) | null = null;
// Pending open timer for the hover delay (child mode). Wrapper mode gets its
// delay for free from reka's `delay-duration`; child mode wires its own hover
// listeners, so it has to honour `props.delay` here too.
let childShowTimer: ReturnType<typeof setTimeout> | null = null;

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
        childOpen.value = false;
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
    'drop-shadow(0 0 1px rgba(0,0,0,0.15))',
    'drop-shadow(0 4px 12px rgba(0,0,0,0.14))',
  ].join(' '),
}));

const contentClasses = computed(() => [
  "z-[10100] px-2.5 py-1.5",
  "bg-[var(--color-surface-overlay)] rounded-md",
  "text-xs text-[var(--color-text-primary)] font-medium leading-relaxed",
  "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
  "data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
  "data-[side=top]:slide-in-from-bottom-1",
  "data-[side=bottom]:slide-in-from-top-1",
  "data-[side=left]:slide-in-from-right-1",
  "data-[side=right]:slide-in-from-left-1",
  props.contentClass,
]);
</script>

<template>
  <!-- ΓöÇΓöÇ Wrapper mode: default slot provides the trigger ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ -->
  <TooltipProvider v-if="hasDefaultSlot">
    <TooltipRoot
      :delay-duration="delay"
      v-bind="open !== undefined ? { open: disabled ? false : open } : {}"
      :disabled="disabled"
    >
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          data-test="o-tooltip-content"
          :side="side"
          :align="align"
          :side-offset="effectiveSideOffset"
          :align-offset="alignOffset"
          :style="contentStyle"
          :class="contentClasses"
        >
          <span class="tw:inline-flex tw:items-center tw:gap-1.5">
            <slot name="content">{{ content }}</slot>
            <OShortcut
              v-if="shortcut || shortcutId"
              :keys="shortcut"
              :id="shortcutId"
            />
          </span>
          <TooltipArrow
            :width="10"
            :height="5"
            :class="'fill-[var(--color-surface-overlay)]'"
          />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>

  <!-- ΓöÇΓöÇ Child mode: no default slot, attaches to parent element like q-tooltip -->
  <template v-else>
    <TooltipProvider>
      <TooltipRoot
        :delay-duration="0"
        :open="disabled ? false : childOpen"
        @update:open="childOpen = $event"
      >
        <!-- Hidden trigger span; reference overrides positioning anchor to parentEl -->
        <TooltipTrigger
          as="span"
          :reference="parentEl ?? undefined"
          style="display:none"
          aria-hidden="true"
        />
        <TooltipPortal>
          <TooltipContent
            data-test="o-tooltip-content"
            :side="side"
            :align="align"
            :side-offset="effectiveSideOffset"
            :align-offset="alignOffset"
            :style="contentStyle"
            :class="contentClasses"
          >
            <span class="tw:inline-flex tw:items-center tw:gap-1.5">
              <slot name="content">{{ content }}</slot>
              <OShortcut
              v-if="shortcut || shortcutId"
              :keys="shortcut"
              :id="shortcutId"
            />
            </span>
            <TooltipArrow
              :width="10"
              :height="5"
              :class="'fill-[var(--color-surface-overlay)]'"
            />
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </TooltipProvider>
    <!-- Anchor placeholder: inserted at the real DOM position to resolve parentElement -->
    <span ref="childAnchorRef" style="display:none" aria-hidden="true" />
  </template>
</template>
