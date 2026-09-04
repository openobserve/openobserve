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
      tooltip: {},
      series: [{ type: "map", map: "world", data: [] }],
    };
    const initChart = async () => {
      if (chartRef.value) {
        chart = echarts.init(chartRef.value);
        echarts.registerMap("world", worldMap as any);

        // Default empty chart configuration to ensure map is visible

        chart.setOption(withChartFont(DEFAULT_MAP_OPTIONS), true);
      }
    };

    onMounted(async () => {
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      await initChart();
      window.addEventListener("resize", windowResizeEventCallback);
    });

    onUnmounted(() => {
      window.removeEventListener("resize", windowResizeEventCallback);
      if (chart) chart?.dispose();
    });

    watch(
      () => props.data.options,
      async (newOptions) => {
        if (chart) {
          await nextTick();
          if (newOptions && newOptions.series && newOptions.series.length > 0) {
            chart?.setOption(withChartFont(newOptions), true);
          } else {
            // If no data provided, set a default empty map

            chart?.setOption(withChartFont(DEFAULT_MAP_OPTIONS), true);
          }
        }
      },
      { deep: true },
    );
    return { chartRef };
  },
});
</script>
