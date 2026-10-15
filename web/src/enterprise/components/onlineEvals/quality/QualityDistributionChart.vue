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
  <div class="relative h-full min-h-0 w-full" data-test="quality-distribution-chart">
    <!-- ChartRenderer, not PanelSchemaRenderer: only it forwards the bar click that filters the scores. -->
    <ChartRenderer :data="{ options }" @click="onBarClick" />
    <!-- The bars as buttons for keyboard users: hidden until one takes focus, then a row over the chart's foot. -->
    <div
      role="group"
      :aria-label="t('onlineEvals.quality.detail.filterByBar')"
      class="focus-within:bg-surface-base sr-only focus-within:not-sr-only focus-within:absolute focus-within:inset-x-0 focus-within:bottom-0 focus-within:flex focus-within:flex-wrap focus-within:gap-1 focus-within:p-1"
      data-test="quality-distribution-keys"
    >
      <OButton
        v-for="(bucket, index) in buckets"
        :key="String(bucket.key)"
        variant="outline"
        size="chip"
        :active="!!filter && bucketSelected(filter, bucket)"
        :aria-pressed="String(!!filter && bucketSelected(filter, bucket))"
        :data-test="`quality-distribution-key-${index}`"
        @click="(event: MouseEvent) => emit('select', bucket, event.shiftKey)"
      >
        {{
          t(
            "onlineEvals.quality.detail.barButton",
            { label: labels[index], count: formatCount(bucket.count) },
            bucket.count,
          )
        }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import type { QualityDistributionBucket } from "@/services/online-evals.service";
import OButton from "@/lib/core/Button/OButton.vue";
import {
  bucketLabel,
  bucketSelected,
  formatCount,
  type QualityChartFilter,
} from "../utils/qualityFormat";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = defineProps<{
  buckets: QualityDistributionBucket[];
  filter: QualityChartFilter | null;
}>();

const emit = defineEmits<{
  (e: "select", bucket: QualityDistributionBucket, shift: boolean): void;
}>();

const { t } = useI18nTyped();
const store = useStore();

const classified = computed(() => props.buckets.some((bucket) => bucket.unhealthy != null));
const labels = computed(() =>
  props.buckets.map((bucket, index, all) =>
    bucketLabel(bucket, { first: index === 0, last: index === all.length - 1 }),
  ),
);

const options = computed(() => {
  // Read the theme so token colors re-resolve when it flips.
  void store.state.theme;
  const text = chartColor("--color-text-secondary");
  const grid = chartColor("--color-border-subtle");
  const point = (value: number, bucket: QualityDistributionBucket) => ({
    value,
    itemStyle: { opacity: bucketSelected(props.filter, bucket) ? 1 : 0.3 },
  });
  const countLabel = {
    show: true,
    position: "top",
    color: text,
    fontSize: 10,
    formatter: (p: any) => {
      const count = props.buckets[p.dataIndex]?.count;
      return count ? formatCount(count) : "";
    },
  };
  const series = classified.value
    ? [
        {
          name: t("onlineEvals.quality.detail.legendHealthy"),
          type: "bar",
          stack: "scores",
          color: chartColor("--color-service-health-healthy"),
          data: props.buckets.map((b) => point(b.count - (b.unhealthy ?? 0), b)),
        },
        {
          name: t("onlineEvals.quality.detail.legendUnhealthy"),
          type: "bar",
          stack: "scores",
          color: chartColor("--color-service-health-critical"),
          label: countLabel,
          data: props.buckets.map((b) => point(b.unhealthy ?? 0, b)),
        },
      ]
    : [
        {
          name: t("onlineEvals.quality.detail.legendScores"),
          type: "bar",
          color: chartColor("--color-chart-series-1"),
          label: countLabel,
          data: props.buckets.map((b) => point(b.count, b)),
        },
      ];
  return {
    grid: { left: 8, right: 8, top: 20, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: any[]) => {
        const index = params?.[0]?.dataIndex;
        const bucket = props.buckets[index];
        if (!bucket) return "";
        const detail = classified.value
          ? t("onlineEvals.quality.detail.chartTooltip", {
              count: formatCount(bucket.count),
              unhealthy: formatCount(bucket.unhealthy ?? 0),
            })
          : t("onlineEvals.quality.detail.chartTooltipCount", { count: formatCount(bucket.count) });
        return `${escapeHtml(labels.value[index])}<br/>${escapeHtml(detail)}`;
      },
    },
    xAxis: {
      type: "category",
      data: labels.value,
      axisLabel: { color: text, fontSize: 10 },
      axisLine: { lineStyle: { color: grid } },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: text, fontSize: 10 },
      splitLine: { lineStyle: { color: grid } },
    },
    series,
  };
});

function onBarClick(params: any) {
  const bucket = props.buckets[params?.dataIndex];
  if (bucket) emit("select", bucket, !!params?.event?.event?.shiftKey);
}
</script>
