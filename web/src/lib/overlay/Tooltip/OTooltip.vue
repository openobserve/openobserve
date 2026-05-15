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

// ─── Child mode (placed inside a parent like q-tooltip) ──────────────────────
// When no default slot is provided, OTooltip acts like q-tooltip: it finds its
// parent element via a hidden DOM anchor span and attaches hover listeners to it.
const childAnchorRef = ref<HTMLSpanElement | null>(null);
const parentEl = ref<Element | null>(null);
const childOpen = ref(false);
let cleanupFn: (() => void) | null = null;

onMounted(() => {
  if (!hasDefaultSlot.value && childAnchorRef.value) {
    parentEl.value = childAnchorRef.value.parentElement;
    if (parentEl.value) {
      const show = () => { if (!props.disabled) childOpen.value = true; };
      const hide = () => { childOpen.value = false; };
      parentEl.value.addEventListener("mouseenter", show);
      parentEl.value.addEventListener("mouseleave", hide);
      cleanupFn = () => {
        parentEl.value?.removeEventListener("mouseenter", show);
        parentEl.value?.removeEventListener("mouseleave", hide);
      };
    }
  }
});

onUnmounted(() => cleanupFn?.());

const effectiveSideOffset = computed(() => props.sideOffset);

// Using filter:drop-shadow instead of CSS border so the bubble and the arrow SVG
// child are composited together first — the drop-shadow then traces the combined
// speech-bubble silhouette with no seam at the arrow base.
const contentStyle = computed(() => ({
  maxWidth: props.maxWidth,
  filter: [
    'drop-shadow(1px 0 0 var(--color-tooltip-border))',
    'drop-shadow(-1px 0 0 var(--color-tooltip-border))',
    'drop-shadow(0 1px 0 var(--color-tooltip-border))',
    'drop-shadow(0 -1px 0 var(--color-tooltip-border))',
    'drop-shadow(0 2px 6px rgba(0,0,0,0.10))',
  ].join(' '),
}));

const contentClasses = computed(() => [
  "tw:z-[7000] tw:px-2.5 tw:py-1.5",
  "tw:bg-[var(--color-tooltip-bg)] tw:rounded-md",
  "tw:text-xs tw:text-[var(--color-tooltip-text)] tw:leading-relaxed",
  "tw:data-[state=delayed-open]:animate-in tw:data-[state=delayed-open]:fade-in-0 tw:data-[state=delayed-open]:zoom-in-95",
  "tw:data-[state=instant-open]:animate-in tw:data-[state=instant-open]:fade-in-0",
  "tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:zoom-out-95",
  "tw:data-[side=top]:slide-in-from-bottom-1",
  "tw:data-[side=bottom]:slide-in-from-top-1",
  "tw:data-[side=left]:slide-in-from-right-1",
  "tw:data-[side=right]:slide-in-from-left-1",
  props.contentClass,
]);
</script>

<template>
  <!-- ── Wrapper mode: default slot provides the trigger ───────────────────── -->
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
          :side="side"
          :align="align"
          :side-offset="effectiveSideOffset"
          :align-offset="alignOffset"
          :style="contentStyle"
          :class="contentClasses"
        >
          <slot name="content">{{ content }}</slot>
          <TooltipArrow
            :width="10"
            :height="5"
            :class="'tw:fill-[var(--color-tooltip-arrow)]'"
          />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>

  <!-- ── Child mode: no default slot, attaches to parent element like q-tooltip -->
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
            :side="side"
            :align="align"
            :side-offset="effectiveSideOffset"
            :align-offset="alignOffset"
            :style="contentStyle"
            :class="contentClasses"
          >
            <slot name="content">{{ content }}</slot>
            <TooltipArrow
              :width="10"
              :height="5"
              :class="'tw:fill-[var(--color-tooltip-arrow)]'"
            />
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </TooltipProvider>
    <!-- Anchor placeholder: inserted at the real DOM position to resolve parentElement -->
    <span ref="childAnchorRef" style="display:none" aria-hidden="true" />
  </template>
</template>
