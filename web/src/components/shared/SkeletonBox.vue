<template>
  <div
    class="skeleton-box relative overflow-hidden inline-block [background:linear-gradient(90deg,var(--color-skeleton-base)_0%,var(--color-skeleton-highlight)_50%,var(--color-skeleton-base)_100%)] [background-size:200%_100%] [animation:o2-skel-shimmer_1.5s_ease-in-out_infinite]"
    :class="shapeClass"
    :style="{
      width: width,
      height: height,
      borderRadius: customRadius,
    }"
    aria-hidden="true"
  ></div>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface Props {
  // Size props
  width?: string;
  height?: string;

  // Variant presets
  variant?: "text" | "title" | "button" | "avatar" | "image" | "custom";

  // Shape props
  rounded?: boolean;
  circle?: boolean;
  customRadius?: string;

  // Text-specific props (when variant is 'text')
  lines?: number;
}

const props = withDefaults(defineProps<Props>(), {
  width: "100px",
  height: "16px",
  variant: "custom",
  rounded: false,
  circle: false,
  lines: 1,
});

// Corner radius resolves from a single source: an explicit circle/rounded prop
// wins, otherwise the variant preset maps onto the sanctioned radius scale.
const shapeClass = computed(() => {
  if (props.circle) return "rounded-full aspect-square";
  if (props.rounded) return "rounded-surface";
  switch (props.variant) {
    case "text":
      return "rounded-default";
    case "title":
      return "rounded-default";
    case "button":
      return "rounded-default";
    case "avatar":
      return "rounded-full";
    case "image":
      return "rounded-surface";
    default:
      return "rounded-default";
  }
});
</script>
