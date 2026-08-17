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
  <section
    class="rounded-default border-border-default bg-card-glass-bg flex flex-col border p-3"
    data-test="rum-error-occurrences-chart"
  >
    <div class="flex items-baseline justify-between gap-2">
      <h4>{{ t("rum.errorDetail.occurrencesTitle") }}</h4>
      <small v-if="peakCaption" data-test="rum-error-occurrences-peak">{{ peakCaption }}</small>
    </div>

    <div
      v-if="loading"
      class="flex h-32 items-end gap-1 pt-2"
      data-test="rum-error-occurrences-loading"
    >
      <OSkeleton
        v-for="index in 24"
        :key="index"
        variant="button"
        class="flex-1"
        :style="{ height: `${20 + ((index * 13) % 70)}%` }"
      />
    </div>

    <div
      v-else-if="!hasData"
      class="flex h-32 items-center justify-center"
      data-test="rum-error-occurrences-empty"
    >
      <p class="text-text-muted">{{ t("rum.noErrorsInWindow") }}</p>
    </div>

    <div v-else class="h-32" data-test="rum-error-occurrences-canvas">
      <ChartRenderer :data="{ options: chartOptions }" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { format } from "date-fns";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { addCommasToNumber } from "@/utils/formatters";
import type { OccurrenceBucket } from "@/composables/rum/useErrorDetail";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = defineProps<{
  buckets: OccurrenceBucket[];
  loading?: boolean;
  /** µs timestamp of the event being viewed — marked on the series. */
  currentTimestamp?: number;
}>();

const { t } = useI18nTyped();
const store = useStore();

const hasData = computed(() => props.buckets.some((bucket) => bucket.events > 0));

/** Window span and bucket resolution decide the x-axis label format. */
const labelFormat = computed(() => {
  if (props.buckets.length < 2) return "HH:mm";
  const span = props.buckets[props.buckets.length - 1].ts - props.buckets[0].ts;
  if (span >= 86400_000_000) return "MM-dd HH:mm";
  const bucketSpan = props.buckets[1].ts - props.buckets[0].ts;
  return bucketSpan < 60_000_000 ? "HH:mm:ss" : "HH:mm";
});

const resolveToken = (token: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.body).getPropertyValue(token).trim();
  return value || fallback;
};

/** Bucket holding the event the page was opened on, so the user can see where
 *  in the issue's life this particular occurrence sits. */
const currentIndex = computed(() => {
  if (!props.currentTimestamp || props.buckets.length < 2) return -1;
  const span = props.buckets[1].ts - props.buckets[0].ts;
  return props.buckets.findIndex(
    (bucket) => props.currentTimestamp! >= bucket.ts && props.currentTimestamp! < bucket.ts + span,
  );
});

const chartOptions = computed(() => {
  // Read the theme so token colors re-resolve when it flips —
  // getComputedStyle alone is not reactive.
  void store.state.theme;
  const errorColor = resolveToken("--color-severity-error-color", "#EF5350");
  const labels = props.buckets.map((bucket) =>
    format(new Date(Math.floor(bucket.ts / 1000)), labelFormat.value),
  );

  const series: Record<string, any> = {
    name: t("rum.errorDetail.occurrences"),
    type: "bar",
    color: errorColor,
    data: props.buckets.map((bucket) => bucket.events),
  };
  if (currentIndex.value >= 0) {
    series.markLine = {
      symbol: "none",
      animation: false,
      lineStyle: { type: "dashed" },
      label: { formatter: t("rum.errorDetail.thisEvent"), position: "insideEndTop" },
      data: [{ xAxis: currentIndex.value }],
    };
  }

  return {
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "category",
      data: labels,
      axisTick: { show: false },
      axisLabel: { hideOverlap: true },
    },
    yAxis: { type: "value", splitNumber: 3, minInterval: 1 },
    series: [series],
  };
});

const peakCaption = computed(() => {
  if (props.loading || !hasData.value) return "";
  const peak = Math.max(...props.buckets.map((bucket) => bucket.events));
  return t("rum.errorDetail.peakPerBucket", { count: addCommasToNumber(peak) });
});
</script>
