<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <!-- One stable root so the IntersectionObserver has a single element to watch
       across all states. The volume is requested only when the row scrolls into
       view — extraction can return up to 1,000 patterns and fetching all of them
       up front would be 1,000 searches. The bars show the TRUE time distribution
       from the tantivy histogram, so the sparkline matches the search histogram. -->
  <div ref="rootEl" class="flex h-6 items-start gap-1">
    <template v-if="displayBuckets.length">
      <div
        class="relative flex h-6 items-end gap-px"
        :class="colorClass"
        role="img"
        :aria-label="ariaLabel"
        :title="ariaLabel"
        data-test="pattern-volume-cell"
      >
        <!-- Peak marker: a dashed rule level with the tallest bar. Bars are
             scaled to their own max, so without a labelled reference the
             heights only convey shape, not magnitude — two sparklines can look
             identical while differing by orders of magnitude. -->
        <span
          class="border-border-default absolute inset-x-0 top-0 border-t border-dashed opacity-60"
          aria-hidden="true"
        />
        <span
          v-for="(value, index) in displayBuckets"
          :key="index"
          class="rounded-default w-1 shrink-0 bg-current"
          :class="[barHeightClass(value), value > 0 ? 'opacity-70' : 'opacity-25']"
        />
      </div>
      <span
        class="text-2xs text-text-secondary shrink-0 leading-none tabular-nums"
        :title="peakTitle"
        data-test="pattern-volume-peak"
        >{{ peakLabel }}</span
      >
    </template>
    <div
      v-else-if="loading"
      class="text-text-muted flex h-6 animate-pulse items-end gap-px"
      data-test="pattern-volume-cell-loading"
    >
      <span
        v-for="i in 12"
        :key="i"
        class="rounded-default w-1 shrink-0 bg-current opacity-30"
        :class="skeletonHeight(i)"
      />
    </div>
    <span v-else class="text-text-muted text-xs" data-test="pattern-volume-cell-empty">—</span>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { compactCount, formatBucketDuration } from "./patternUtils";
import {
  PATTERN_VOLUME_CACHE,
  type PatternVolumeCache,
  type PatternVolumeEntry,
} from "./usePatternVolume";

const props = defineProps<{
  /** The pattern whose volume to chart (its template drives the match_all query). */
  pattern: any;
  /** Severity text-color utility (e.g. "text-severity-error-color"). */
  colorClass?: string;
}>();

const emit = defineEmits<{
  /**
   * This pattern's resolved volume: the window-wide total (so the row shows a
   * real magnitude instead of the extraction sample's count) and the per-bucket
   * counts (so the trend badge reads TRUE volume over time).
   *
   * Emits null when the cache is invalidated, so the row drops the stale
   * figures rather than showing the previous query window's numbers.
   */
  (e: "volume", volume: { total: number; buckets: number[] } | null): void;
}>();

const { t } = useI18n();
const cache = inject<PatternVolumeCache | null>(PATTERN_VOLUME_CACHE, null);

const rootEl = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

// Remembered across cache invalidations. Rows are keyed by pattern id, so a
// re-run reuses this component instance rather than remounting it — without
// this the (already disconnected) observer would never fire again and the cell
// would sit on its skeleton forever.
const hasBeenVisible = ref(false);

const entry = computed<PatternVolumeEntry | undefined>(() => cache?.get(props.pattern));

// Report the volume upward as it lands, and clear it when the cache is dropped
// so the row never shows figures from a window that's no longer displayed.
watch(
  () => entry.value,
  (current) => {
    emit(
      "volume",
      current && current.total !== null && current.buckets
        ? { total: current.total, buckets: current.buckets }
        : null,
    );
  },
  { immediate: true, deep: true },
);

// Re-request whenever this cell's cache entry disappears (new query window,
// stream, or filter) while the row is on screen. `request` no-ops if an entry
// already exists, so this can't loop.
watch(
  [entry, hasBeenVisible],
  ([current, visible]) => {
    if (visible && !current) cache?.request(props.pattern);
  },
  { immediate: true },
);

// The virtualizer over-renders beyond the viewport, so mount is NOT visibility —
// only request once the cell actually scrolls into view.
onMounted(() => {
  if (typeof IntersectionObserver === "undefined" || !rootEl.value) {
    hasBeenVisible.value = true;
    return;
  }
  observer = new IntersectionObserver(
    (observed) => {
      if (observed.some((o) => o.isIntersecting)) {
        // Flipping the flag drives the watcher above, which owns requesting —
        // one path in and out, so invalidation and first paint behave the same.
        hasBeenVisible.value = true;
        observer?.disconnect();
        observer = null;
      }
    },
    { rootMargin: "200px 0px" },
  );
  observer.observe(rootEl.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

/**
 * Most bars the cell can draw before they'd overflow: at w-1 (4px) plus a 1px
 * gap, 27 bars span 134px, leaving room for the peak label inside the 11rem
 * column. Beyond this, buckets are merged in equal chunks so the sparkline
 * still fits.
 */
const MAX_BARS = 27;

const HEIGHT_CLASSES = ["h-0.5", "h-1", "h-1.5", "h-2", "h-2.5", "h-3", "h-4", "h-5", "h-6"];

const loading = computed(() => !entry.value || entry.value.loading);

const displayBuckets = computed<number[]>(() => {
  const b = entry.value?.buckets;
  if (!b || !b.length) return [];
  if (b.length <= MAX_BARS) return b;
  const chunk = Math.ceil(b.length / MAX_BARS);
  const merged: number[] = [];
  for (let i = 0; i < b.length; i += chunk) {
    merged.push(b.slice(i, i + chunk).reduce((sum, v) => sum + v, 0));
  }
  return merged;
});

const maxValue = computed(() => displayBuckets.value.reduce((max, v) => Math.max(max, v), 0));

/**
 * Time one drawn bar covers. When more buckets arrive than the cell can draw
 * they're merged in equal chunks, so a bar spans that many query buckets — the
 * tooltip has to report the merged span, not the raw query interval.
 */
const barSeconds = computed<number | null>(() => {
  const secs = entry.value?.intervalSecs;
  const raw = entry.value?.buckets?.length ?? 0;
  if (!secs || !raw) return null;
  const chunk = raw > MAX_BARS ? Math.ceil(raw / MAX_BARS) : 1;
  return secs * chunk;
});

const totalEvents = computed(() => displayBuckets.value.reduce((sum, v) => sum + v, 0));

const barHeightClass = (value: number): string => {
  if (maxValue.value <= 0 || value <= 0) return HEIGHT_CLASSES[0];
  const ratio = value / maxValue.value;
  const index = Math.min(
    HEIGHT_CLASSES.length - 1,
    Math.max(1, Math.round(ratio * (HEIGHT_CLASSES.length - 1))),
  );
  return HEIGHT_CLASSES[index];
};

const skeletonHeight = (i: number): string =>
  HEIGHT_CLASSES[1 + ((i * 3) % (HEIGHT_CLASSES.length - 1))];

const ariaLabel = computed(() => t("logs.patternList.volumeEvents", { count: totalEvents.value }));

// The busiest bucket, labelling the dashed rule. Compact so it stays legible at
// text-2xs; the exact figure is on hover.
const peakLabel = computed(() => compactCount(maxValue.value));
// Name the span a single bar covers — "31,430 events" is uninterpretable
// without knowing whether a bar is a minute or a day, and the width is derived
// from the query window so it changes with the selected range.
const peakTitle = computed(() => {
  const secs = barSeconds.value;
  const count = maxValue.value.toLocaleString();
  if (!secs) return t("logs.patternList.volumeEvents", { count });
  return t("logs.patternList.volumePeak", {
    duration: formatBucketDuration(secs, t as any),
    count,
  });
});
</script>
