<script setup lang="ts">
import type { SkeletonProps } from "./OSkeleton.types";
import { computed, useAttrs } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useDelayedFlag } from "@/composables/shared/useDelayedFlag";

const { t } = useI18nTyped();

const props = withDefaults(defineProps<SkeletonProps>(), {
  shape: "line",
  preset: undefined,
  rows: 5,
  count: 4,
  delay: 150,
});

const attrs = useAttrs();

const SHIMMER =
  "from-skeleton-base via-skeleton-highlight to-skeleton-base bg-linear-to-r bg-size-[200%_100%] [animation:o2-skel-shimmer_1.5s_ease-in-out_infinite]";

const ROW_WIDTHS = ["w-2/5", "w-1/3", "w-1/2"];
const BAR_HEIGHTS = [
  "h-1/2",
  "h-2/3",
  "h-2/5",
  "h-3/4",
  "h-1/2",
  "h-1/3",
  "h-3/5",
  "h-2/5",
  "h-4/5",
  "h-1/2",
];

const delayed = useDelayedFlag(() => props.delay > 0, props.delay);
const shown = computed(() => props.delay <= 0 || delayed.value);

const callerClass = computed(() => {
  const c = attrs.class as unknown;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.filter((x) => typeof x === "string").join(" ");
  if (c && typeof c === "object")
    return Object.entries(c)
      .filter(([, on]) => on)
      .map(([k]) => k)
      .join(" ");
  return "";
});

// Utilities win by stylesheet order, not class order, so a default size stands down when the caller sets that axis.
const setsWidth = computed(() =>
  /(?:^|\s)-?(?:w-|size-|flex-1|flex-auto|grow|basis-)/.test(callerClass.value),
);
const setsHeight = computed(() => /(?:^|\s)-?(?:h-|size-)/.test(callerClass.value));

const shapeClasses = computed<string[]>(() => {
  switch (props.shape) {
    case "circle":
      return ["rounded-full aspect-square", SHIMMER, setsWidth.value ? "" : "size-4"];
    case "block":
      return ["rounded-chip", SHIMMER, setsWidth.value ? "" : "w-full"];
    default:
      return [
        "rounded-chip",
        SHIMMER,
        setsWidth.value ? "" : "w-full",
        setsHeight.value ? "" : "h-3",
      ];
  }
});

const presetClasses = computed<string[]>(() => {
  switch (props.preset) {
    case "statStrip":
      return ["flex gap-2", setsWidth.value ? "" : "w-full"];
    case "chart":
      return [
        "flex items-end gap-2",
        setsWidth.value ? "" : "w-full",
        setsHeight.value ? "" : "h-20",
      ];
    default:
      return ["flex flex-col", setsWidth.value ? "" : "w-full"];
  }
});
</script>

<template>
  <div
    v-if="preset"
    :class="[presetClasses, shown ? '' : 'invisible']"
    role="status"
    :aria-label="t('components.skeleton.loading')"
    aria-live="polite"
    aria-busy="true"
    :data-preset="preset"
  >
    <template v-if="preset === 'tableRows'">
      <div
        v-for="r in rows"
        :key="r"
        class="border-table-row-divider flex h-9 items-center gap-4 border-b px-3"
        aria-hidden="true"
      >
        <span :class="['rounded-chip h-3', SHIMMER, ROW_WIDTHS[(r - 1) % ROW_WIDTHS.length]]" />
        <span :class="['rounded-chip h-3 w-1/6', SHIMMER]" />
        <span :class="['rounded-chip ms-auto h-3 w-12', SHIMMER]" />
      </div>
    </template>
    <template v-else-if="preset === 'statStrip'">
      <div
        v-for="n in count"
        :key="n"
        class="rounded-default bg-surface-base border-border-default flex min-w-0 flex-1 flex-col gap-2 border px-2.5 py-2"
        aria-hidden="true"
      >
        <span :class="['rounded-chip h-6 w-12', SHIMMER]" />
        <span :class="['rounded-chip h-3 w-16 max-w-full', SHIMMER]" />
      </div>
    </template>
    <template v-else>
      <span
        v-for="(bar, i) in BAR_HEIGHTS"
        :key="i"
        :class="['rounded-chip flex-1', SHIMMER, bar]"
        aria-hidden="true"
      />
    </template>
  </div>
  <span
    v-else
    :class="['block', shapeClasses, shown ? '' : 'invisible']"
    role="status"
    :aria-label="t('components.skeleton.loading')"
    aria-live="polite"
    aria-busy="true"
  />
</template>
