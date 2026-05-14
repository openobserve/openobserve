<script setup lang="ts">
import type { TooltipProps, TooltipSlots } from "./OTooltip.types";

/**
 * OTooltipStub — test double for OTooltip.
 *
 * Renders the trigger (default slot) and the content slot inline,
 * without any floating positioning. Use in unit tests via:
 *
 *   stubs: { OTooltip: OTooltipStub }
 */
withDefaults(defineProps<TooltipProps>(), {
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
  <div data-test="o-tooltip-stub" style="display: contents">
    <slot />
    <slot name="content">
      <span v-if="content">{{ content }}</span>
    </slot>
  </div>
</template>
