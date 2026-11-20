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
    class="bg-card-glass-bg flex h-full min-w-0 flex-col px-2.5 py-1.5"
    data-test="rum-errors-over-time-chart"
  >
    <div class="flex flex-wrap items-center gap-2">
      <h4>{{ t("rum.errorsOverTime") }}</h4>
      <span
        v-if="actionable.length"
        class="ms-auto flex flex-wrap items-center gap-1"
        data-test="svcver-marker-actions"
      >
        <template v-for="marker in actionable" :key="marker.deployKey || marker.version">
          <OButton
            v-if="marker.unavailable"
            variant="ghost"
            size="chip"
            data-test="svcver-marker-unavailable-retry"
            @click="emit('retry')"
            >{{ t("serviceVersions.rum.markers.unavailable") }}</OButton
          >
          <OButton
            v-else
            variant="ghost"
            size="chip"
            data-test="svcver-marker-compare-previous"
            :data-deploy-key="marker.deployKey"
            @click="emit('compare', marker)"
            ><span class="font-mono">{{ marker.version }}</span>
            {{ t("serviceVersions.rum.markers.compareWithPrevious") }}</OButton
          >
        </template>
      </span>
    </div>

    <div
      v-if="loading"
      class="flex flex-1 items-end gap-1 p-2"
      data-test="rum-errors-over-time-chart-loading"
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
      class="flex flex-1 items-center justify-center"
      data-test="rum-errors-over-time-chart-empty"
    >
      <p class="text-text-muted">
        {{ t("rum.noErrorsInWindow") }}
      </p>
    </div>

    <template v-else>
      <div class="min-h-0 flex-1">
        <ChartRenderer :data="{ options: chartOptions }" @click="onChartClick" />
      </div>
      <small
        v-if="spikeCaption"
        class="text-severity-error-color text-right font-semibold"
        data-test="rum-errors-over-time-chart-spike-caption"
        >{{ spikeCaption }}</small
      >
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { format } from "date-fns";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { StackedBucket } from "@/utils/rum/errorIssueQueries";
import type { RumChartMarker } from "@/enterprise/components/ServiceVersions/deployMarkers";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = defineProps<{
  buckets: StackedBucket[];
  markers: RumChartMarker[];
  /** Post-deploy spike ratio (>= 1.5) or null — drives the caption. */
  spikeFactor: number | null;
  /** Type filter from the page — dims the other series via the legend. */
  focus?: "all" | "unhandled" | "handled";
  loading?: boolean;
}>();

const emit = defineEmits<{ compare: [marker: RumChartMarker]; retry: [] }>();
const { t } = useI18nTyped();
const store = useStore();
const latest = computed(() =>
  props.markers.reduce<RumChartMarker | null>(
    (newest, marker) => (!newest || marker.at > newest.at ? marker : newest),
    null,
  ),
);
const placed = computed(() =>
  props.markers
    .map((marker) => ({
      marker,
      index: props.buckets.findIndex((bucket) => bucket.ts >= marker.at),
    }))
    .filter(({ index }) => index >= 0),
);
// A first-seen marker without a deploy key has nothing to compare against.
const actionable = computed(() =>
  placed.value
    .map(({ marker }) => marker)
    .filter((marker) => marker.unavailable || marker.deployKey),
);
function onChartClick(event: { componentType?: string; data?: { deployKey?: string } }) {
  if (event.componentType !== "markLine" || !event.data?.deployKey) return;
  const marker = props.markers.find((row) => row.deployKey === event.data?.deployKey);
  if (marker) emit("compare", marker);
}

const hasData = computed(() =>
  props.buckets.some((bucket) => bucket.handled + bucket.unhandled > 0),
);

/** Window span and bucket resolution decide the x-axis label format. */
const labelFormat = computed(() => {
  if (props.buckets.length < 2) return "HH:mm";
  const span = props.buckets[props.buckets.length - 1].ts - props.buckets[0].ts;
  if (span >= 86400_000_000) return "MM-dd HH:mm";
  // Sub-minute buckets would repeat identical HH:mm labels.
  const bucketSpan = props.buckets[1].ts - props.buckets[0].ts;
  return bucketSpan < 60_000_000 ? "HH:mm:ss" : "HH:mm";
});

const resolveToken = (token: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.body).getPropertyValue(token).trim();
  return value || fallback;
};

const chartOptions = computed(() => {
  // Read the theme so token colors are re-resolved when it flips —
  // getComputedStyle alone is not reactive.
  void store.state.theme;
  const errorColor = resolveToken("--color-severity-error-color", "#ea1a17");
  const warningColor = resolveToken("--color-severity-warning-color", "#b16300");
  const labels = props.buckets.map((bucket) =>
    format(new Date(Math.floor(bucket.ts / 1000)), labelFormat.value),
  );

  const unhandledSeries: Record<string, any> = {
    name: t("rum.unhandled"),
    type: "bar",
    stack: "errors",
    color: errorColor,
    emphasis: { focus: "series" },
    data: props.buckets.map((bucket) => bucket.unhandled),
  };
  if (placed.value.length) {
    unhandledSeries.markLine = {
      symbol: "none",
      animation: false,
      silent: false,
      lineStyle: { type: "dashed" },
      label: { position: "insideEndTop" },
      data: placed.value.map(({ marker, index }) => ({
        ...marker,
        name: marker.version,
        xAxis: index,
        label: { position: "insideEndTop", ...marker.label },
      })),
    };
  }

  return {
    grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: {
      show: true,
      top: 0,
      right: 0,
      icon: "rect",
      itemWidth: 10,
      itemHeight: 10,
      selected: {
        [t("rum.unhandled")]: props.focus !== "handled",
        [t("rum.handled")]: props.focus !== "unhandled",
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisTick: { show: false },
      axisLabel: { hideOverlap: true },
    },
    yAxis: {
      type: "value",
      splitNumber: 3,
      minInterval: 1,
    },
    series: [
      {
        name: t("rum.handled"),
        type: "bar",
        stack: "errors",
        color: warningColor,
        emphasis: { focus: "series" },
        data: props.buckets.map((bucket) => bucket.handled),
      },
      unhandledSeries,
    ],
  };
});

const spikeCaption = computed(() => {
  if (!latest.value || props.spikeFactor === null) return "";
  return t("rum.spikeAfterDeploy", {
    factor: props.spikeFactor.toFixed(1),
    version: latest.value.version,
  });
});
</script>
