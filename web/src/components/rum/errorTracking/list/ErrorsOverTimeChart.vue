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
    <h4>{{ t("rum.errorsOverTime") }}</h4>

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
        <ChartRenderer :data="{ options: chartOptions }" />
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
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { format } from "date-fns";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { StackedBucket } from "@/utils/rum/errorIssueQueries";
import type { DeployInfo } from "@/utils/rum/errorIssueUtils";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = defineProps<{
  buckets: StackedBucket[];
  deploy: DeployInfo | null;
  /** Post-deploy spike ratio (>= 1.5) or null — drives the caption. */
  spikeFactor: number | null;
  /** Type filter from the page — dims the other series via the legend. */
  focus?: "all" | "unhandled" | "handled";
  loading?: boolean;
}>();

const { t } = useI18n();
const store = useStore();

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

const deployIndex = computed(() => {
  if (!props.deploy) return -1;
  return props.buckets.findIndex((bucket) => bucket.ts >= props.deploy!.firstSeen);
});

const chartOptions = computed(() => {
  // Read the theme so token colors are re-resolved when it flips —
  // getComputedStyle alone is not reactive.
  void store.state.theme;
  const errorColor = resolveToken("--color-severity-error-color", "#EF5350");
  const warningColor = resolveToken("--color-severity-warning-color", "#FB8C00");
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
  if (deployIndex.value >= 0 && props.deploy) {
    unhandledSeries.markLine = {
      symbol: "none",
      animation: false,
      lineStyle: { type: "dashed" },
      label: {
        formatter: t("rum.deployMarker", { version: props.deploy.version }),
        position: "insideEndTop",
      },
      data: [{ xAxis: deployIndex.value }],
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
  if (!props.deploy || props.spikeFactor === null) return "";
  return t("rum.spikeAfterDeploy", {
    factor: props.spikeFactor.toFixed(1),
    version: props.deploy.version,
  });
});
</script>
