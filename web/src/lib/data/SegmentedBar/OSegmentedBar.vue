<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { SEGMENT_SWATCH } from "./OSegmentedBar.types";
import type { SegmentedBarProps, SegmentedBarVariant } from "./OSegmentedBar.types";

const props = withDefaults(defineProps<SegmentedBarProps>(), {
  markers: () => [],
  size: "sm",
});

const sizeClasses: Record<NonNullable<SegmentedBarProps["size"]>, string> = {
  sm: "h-2",
  md: "h-2.5",
};

const clampPct = (n: number) => `${Math.min(100, Math.max(0, n))}%`;
const fill = (variant: SegmentedBarVariant | undefined) => SEGMENT_SWATCH[variant ?? "default"];
</script>

<template>
  <div
    class="bg-border-default relative flex w-full min-w-0 rounded-full"
    :class="sizeClasses[props.size]"
    :role="props.label ? 'img' : undefined"
    :aria-label="props.label"
    :aria-hidden="props.label ? undefined : 'true'"
  >
    <div class="flex h-full w-full overflow-hidden rounded-full">
      <div
        v-for="segment in props.segments"
        :key="segment.id"
        class="h-full shrink-0 transition-[width] duration-300"
        :class="fill(segment.variant)"
        :style="{ width: clampPct(segment.pct) }"
        :data-test="`o-segmented-bar-segment-${segment.id}`"
      />
    </div>
    <div
      v-for="marker in props.markers"
      :key="marker.id"
      class="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full"
      :class="fill(marker.variant)"
      :style="{ insetInlineStart: clampPct(marker.pct) }"
      :data-test="`o-segmented-bar-marker-${marker.id}`"
    />
  </div>
</template>
