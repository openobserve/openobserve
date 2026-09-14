<script setup lang="ts">
import { computed } from "vue";

import type { OCardProps, OCardSlots } from "./OCard.types";

const props = withDefaults(defineProps<OCardProps>(), { variant: "panel" });
defineSlots<OCardSlots>();

const variantClasses: Record<NonNullable<OCardProps["variant"]>, string> = {
  // The filled panel keeps the 4px tier it shipped with, so no existing screen
  // shifts under it.
  panel: "bg-card-bg rounded-default",
  // A standalone surface takes the 12px tier.
  outlined: "card-container rounded-surface bg-surface-base border-border-default border",
  // Tiled section panes inside a dense detail page — the chrome the incident
  // detail page draws its panels with. Stays on the 4px tier on purpose: at
  // 12px a column of six of these reads as six separate cards floating apart
  // rather than one page divided into panes.
  glass: "rounded-default bg-card-glass-bg border-card-glass-border overflow-hidden border",
};

const classes = computed(() => ["text-card-text flex flex-col", variantClasses[props.variant]]);
</script>

<template>
  <div :class="classes" v-bind="$attrs">
    <slot />
  </div>
</template>
