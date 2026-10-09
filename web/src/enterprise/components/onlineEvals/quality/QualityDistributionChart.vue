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
  <div class="h-full min-h-0 w-full" data-test="quality-distribution-chart">
    <!-- ChartRenderer, not PanelSchemaRenderer: only it forwards the bar click that filters the scores. -->
    <ChartRenderer :data="{ options }" @click="onBarClick" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import type { QualityDistributionBucket } from "@/services/online-evals.service";
import { bucketLabel, bucketSelected, type QualityChartFilter } from "../utils/qualityFormat";

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
    formatter: (p: any) => props.buckets[p.dataIndex]?.count || "",
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
        const bucket = props.buckets[params?.[0]?.dataIndex];
        if (!bucket) return "";
        const detail = classified.value
          ? t("onlineEvals.quality.detail.chartTooltip", {
              count: bucket.count,
              unhealthy: bucket.unhealthy ?? 0,
            })
          : t("onlineEvals.quality.detail.chartTooltipCount", { count: bucket.count });
        return `${escapeHtml(bucketLabel(bucket))}<br/>${escapeHtml(detail)}`;
      },
    },
    xAxis: {
      type: "category",
      data: props.buckets.map(bucketLabel),
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
