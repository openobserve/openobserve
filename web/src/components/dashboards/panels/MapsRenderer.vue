<!-- Copyright 2026 OpenObserve Inc.
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
     http:www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div class="h-full w-full p-1.25">
    <div class="h-full w-full" ref="chartRef" id="chart-map"></div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, onUnmounted, nextTick } from "vue";
import * as echarts from "echarts/core";
import { MapChart } from "echarts/charts";
import worldMap from "@/assets/dashboard/maps/map.json";
import { withChartFont } from "@/utils/fonts";
import { chartColor } from "@/utils/chartTheme";
import useTheme from "@/composables/useTheme";

echarts.use([MapChart]);

export default defineComponent({
  name: "MapsRenderer",
  props: {
    data: {
      required: true,
      type: Object,
      default: () => ({ options: {} }),
    },
  },
  setup(props: any) {
    const chartRef: any = ref(null);
    let chart: any;

    const windowResizeEventCallback = async () => {
      await nextTick();
      if (chart) {
        chart.resize();
      }
    };

    const DEFAULT_MAP_OPTIONS = {
      backgroundColor: "transparent",
      tooltip: {},
      series: [{ type: "map", map: "world", data: [] }],
    };

    const currentOptions = () => {
      const options = props.data.options;
      return options && options.series && options.series.length > 0 ? options : DEFAULT_MAP_OPTIONS;
    };

    const { isDark } = useTheme();

    const initChart = () => {
      if (!chartRef.value) return;
      chart = echarts.init(chartRef.value, isDark.value ? "dark" : "light");
      echarts.registerMap("world", worldMap as any);
      chart.setOption(withChartFont(currentOptions()), true);
    };

    // Tooltip colours were resolved by the converter under the previous theme.
    const withThemedTooltip = (options: any) =>
      options.tooltip
        ? {
            ...options,
            tooltip: {
              ...options.tooltip,
              backgroundColor: chartColor("--color-tooltip-bg"),
              borderColor: chartColor("--color-tooltip-border"),
              textStyle: {
                ...options.tooltip.textStyle,
                color: chartColor("--color-tooltip-text"),
              },
            },
          }
        : options;

    watch(isDark, () => {
      if (!chart) return;
      chart.dispose();
      chart = echarts.init(chartRef.value, isDark.value ? "dark" : "light");
      chart.setOption(withChartFont(withThemedTooltip(currentOptions())), true);
    });

    onMounted(async () => {
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      initChart();
      window.addEventListener("resize", windowResizeEventCallback);
    });

    onUnmounted(() => {
      window.removeEventListener("resize", windowResizeEventCallback);
      if (chart) chart?.dispose();
    });

    watch(
      () => props.data.options,
      async () => {
        if (chart) {
          await nextTick();
          chart?.setOption(withChartFont(currentOptions()), true);
        }
      },
      { deep: true },
    );
    return { chartRef };
  },
});
</script>
