<script setup lang="ts">
import type {
  TruncatedTextLines,
  TruncatedTextProps,
  TruncatedTextSlots,
} from "./OTruncatedText.types";
import { computed } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = withDefaults(defineProps<TruncatedTextProps>(), {
  as: "span",
  lines: 1,
  tooltip: undefined,
});

defineSlots<TruncatedTextSlots>();

// Literal class names: Tailwind only generates classes it can read in the source.
const clampClass: Record<TruncatedTextLines, string> = {
  1: "truncate",
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  5: "line-clamp-5",
  6: "line-clamp-6",
};

// No typography of its own: size and colour stay with the call site's classes.
const classes = computed(() => ["min-w-0", clampClass[props.lines]]);
const tooltipContent = computed(() => (props.tooltip === false ? undefined : props.tooltip));
</script>

<template>
  <component
    :is="as"
    :class="classes"
    data-test="o-truncated-text"
    :data-o-tooltip-off="tooltip === false ? '' : undefined"
  >
    <!-- First child on purpose: with no element before it, the tooltip attaches to this root. -->
    <OTooltip v-if="tooltip !== false" overflow-only :content="tooltipContent" />
    <slot />
  </component>
</template>
