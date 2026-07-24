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
  <!-- Single stable root so the IntersectionObserver has one element to
       watch across all display states. -->
  <div ref="rootEl" class="min-h-4">
    <div
      v-if="displayBuckets.length"
      class="flex flex-col gap-0.5"
      data-test="rum-error-trend-cell"
    >
      <div
        class="flex h-7 items-end gap-[0.0938rem]"
        role="img"
        :aria-label="ariaLabel"
        :title="ariaLabel"
      >
        <span
          v-for="(value, index) in displayBuckets"
          :key="index"
          class="trend-bar rounded-default w-1.5"
          :class="
            value > 0
              ? isUnhandled
                ? 'bg-severity-error-color opacity-55'
                : 'bg-severity-warning-color opacity-55'
              : 'bg-card-glass-border opacity-60'
          "
          :style="{ height: barHeight(value) }"
        />
      </div>
      <small class="italic" :class="annotationClass" data-test="rum-error-trend-cell-annotation">{{
        annotationLabel
      }}</small>
    </div>

    <!-- Pre-intersection and in-flight cells both show the skeleton — an
         em-dash would read as "no data" for rows not yet fetched. -->
    <div
      v-else-if="buckets === null || buckets === undefined"
      class="flex h-7 animate-pulse items-end gap-[0.0938rem]"
      data-test="rum-error-trend-cell-loading"
      :aria-label="t('rum.loadingMsg')"
    >
      <span
        v-for="index in 12"
        :key="index"
        class="trend-bar rounded-default bg-card-glass-border w-1.5 opacity-60"
        :style="{ height: `${20 + ((index * 11) % 60)}%` }"
      />
    </div>

    <span
      v-else
      class="text-text-muted"
      :title="t('rum.trendNoData')"
      data-test="rum-error-trend-cell-empty"
      >—</span
    >
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { computeTrendAnnotation, type IssueStatus } from "@/utils/rum/errorIssueUtils";

const props = defineProps<{
  /**
   * Zero-filled histogram buckets. null/undefined = not fetched yet
   * (skeleton), [] = fetched but empty/failed (em-dash).
   */
  buckets: number[] | null;
  status: IssueStatus;
  handling?: string;
}>();

const emit = defineEmits<{
  /** Fired once when the cell first scrolls into view — parent fetches. */
  visible: [];
}>();

const { t } = useI18n();

/** Cap the sparkline at this many bars regardless of window resolution. */
const MAX_BARS = 24;

const rootEl = ref<HTMLElement | null>(null);
const requested = ref(false);
let observer: IntersectionObserver | null = null;

const requestTrend = () => {
  if (requested.value) return;
  requested.value = true;
  emit("visible");
};

// True lazy loading: the table's virtualizer over-renders beyond the
// viewport, so mounting is NOT visibility — only request the trend when
// the cell actually scrolls into view. Disconnect after the first
// trigger; the composable's cache makes re-entering rows instant.
onMounted(() => {
  if (props.buckets != null) return;
  if (typeof IntersectionObserver === "undefined" || !rootEl.value) {
    requestTrend();
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        requestTrend();
        observer?.disconnect();
        observer = null;
      }
    },
    // Prefetch slightly ahead of the fold so scrolling feels instant.
    { rootMargin: "200px 0px" },
  );
  observer.observe(rootEl.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

const isUnhandled = computed(() => props.handling !== "handled");

// Long windows produce hundreds of buckets — merge adjacent ones so the
// sparkline stays readable inside a table cell.
const displayBuckets = computed<number[]>(() => {
  const buckets = props.buckets;
  if (!buckets || !buckets.length) return [];
  if (buckets.length <= MAX_BARS) return buckets;
  const chunk = Math.ceil(buckets.length / MAX_BARS);
  const merged: number[] = [];
  for (let i = 0; i < buckets.length; i += chunk) {
    merged.push(buckets.slice(i, i + chunk).reduce((sum, value) => sum + value, 0));
  }
  return merged;
});

const annotation = computed(() => computeTrendAnnotation(props.buckets, props.status));

// Static per-kind utility strings (not built by interpolation) so Tailwind's
// scanner sees every class it has to emit.
const ANNOTATION_CLASS: Record<string, string> = {
  spike: "text-severity-error-color not-italic font-semibold",
  drop: "text-status-success-text",
  new: "text-text-secondary",
  flat: "text-text-secondary",
};

const annotationClass = computed(() => ANNOTATION_CLASS[annotation.value.kind] ?? "");

const annotationLabel = computed(() => {
  const { kind, factor } = annotation.value;
  if (kind === "spike") return `▲ ${factor!.toFixed(1)}×`;
  if (kind === "drop") return `▼ ${factor!.toFixed(1)}×`;
  if (kind === "new") return t("rum.trendNew");
  return t("rum.trendFlat");
});

const maxValue = computed(() =>
  displayBuckets.value.reduce((max, value) => Math.max(max, value), 0),
);

const totalEvents = computed(() => displayBuckets.value.reduce((sum, value) => sum + value, 0));

const barHeight = (value: number) => {
  if (value <= 0 || maxValue.value <= 0) return "0.125rem";
  // Keep single-event buckets visible.
  return `${Math.max(15, (value / maxValue.value) * 100)}%`;
};

const ariaLabel = computed(() => t("rum.eventsCount", { count: totalEvents.value }));
</script>
