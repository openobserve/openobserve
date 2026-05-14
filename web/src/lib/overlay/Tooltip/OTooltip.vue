<script setup lang="ts">
import type { TooltipProps, TooltipSlots } from "./OTooltip.types";
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipArrow,
} from "reka-ui";

const props = withDefaults(defineProps<TooltipProps>(), {
  side: "top",
  align: "center",
  sideOffset: 4,
  alignOffset: 0,
  delay: 700,
  maxWidth: "320px",
  disabled: false,
  arrow: false,
});

defineSlots<TooltipSlots>();
</script>

<template>
  <TooltipRoot
    :delay-duration="delay"
    :open="disabled ? false : open"
    :disabled="disabled"
  >
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>

    <TooltipPortal>
      <TooltipContent
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        :align-offset="alignOffset"
        :style="{ maxWidth }"
        :class="[
          // Layout + stacking (above Quasar header/drawer: 2000/3000)
          'tw:z-[7000] tw:px-2.5 tw:py-1.5',
          // Surface — uses design tokens for automatic dark mode support
          'tw:bg-[var(--color-tooltip-bg)] tw:border tw:border-[var(--color-tooltip-border)] tw:rounded-md tw:shadow-sm',
          // Typography
          'tw:text-xs tw:text-[var(--color-tooltip-text)] tw:leading-relaxed',
          // Animation — uses Reka data attributes
          'tw:data-[state=delayed-open]:animate-in tw:data-[state=delayed-open]:fade-in-0 tw:data-[state=delayed-open]:zoom-in-95',
          'tw:data-[state=instant-open]:animate-in tw:data-[state=instant-open]:fade-in-0',
          'tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:zoom-out-95',
          // Side-based slide-in direction
          'tw:data-[side=top]:slide-in-from-bottom-1',
          'tw:data-[side=bottom]:slide-in-from-top-1',
          'tw:data-[side=left]:slide-in-from-right-1',
          'tw:data-[side=right]:slide-in-from-left-1',
          contentClass,
        ]"
      >
        <slot name="content">{{ content }}</slot>
        <TooltipArrow
          v-if="arrow"
          :class="'tw:fill-[var(--color-tooltip-arrow)]'"
        />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
