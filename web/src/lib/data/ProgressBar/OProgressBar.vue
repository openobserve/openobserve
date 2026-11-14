<script setup lang="ts">
import type { ProgressBarProps, ProgressBarTone } from "./OProgressBar.types";
import { computed, useAttrs } from "vue";

const props = withDefaults(defineProps<ProgressBarProps>(), {
  start: 0,
  tone: "accent",
  label: undefined,
});

const TONE_CLASSES: Record<ProgressBarTone, string> = {
  accent: "bg-progress-bar-default",
  ok: "bg-progress-bar-success",
  warn: "bg-progress-bar-warning",
  err: "bg-progress-bar-danger",
};

const clamp = (n: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
};

const indeterminate = computed(() => props.value === null);
const startPct = computed(() => clamp(props.start));
// A start past the value is a caller bug; an empty fill beats a negative width.
const spanPct = computed(() => Math.max(0, clamp(props.value ?? 0) - startPct.value));

// Utilities win by stylesheet order, so the default w-full stands down when the caller names a width.
const attrs = useAttrs();
const hasWidthOverride = computed(() =>
  /(^|\s)(w-|size-|min-w-|max-w-)/.test(String(attrs.class ?? "")),
);

const fillStyle = computed(() =>
  indeterminate.value
    ? undefined
    : { marginInlineStart: `${startPct.value}%`, width: `${spanPct.value}%` },
);
</script>

<template>
  <div
    :class="[
      'bg-progress-bar-track relative h-1 overflow-hidden rounded-full',
      hasWidthOverride ? '' : 'w-full',
    ]"
    role="progressbar"
    :aria-label="label"
    :aria-valuenow="indeterminate ? undefined : Math.round(spanPct)"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div
      :class="[
        'h-full rounded-full',
        TONE_CLASSES[tone],
        indeterminate
          ? 'o2-motion-keep w-1/3 [animation:o2-indeterminate_calc(1.3s*var(--motion-slowdown))_ease-in-out_infinite]'
          : 'transition-[width] duration-300 ease-out',
      ]"
      :style="fillStyle"
    />
  </div>
</template>
