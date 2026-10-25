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
  <div class="h-full w-full p-1.25" data-test="dashboard-geomap-renderer">
    <div class="h-full w-full" ref="chartRef" id="chart-map"></div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, onUnmounted, nextTick } from "vue";

import L from "leaflet";
import "@/utils/dashboard/leaflet-echarts/index";

// import {tileLayer as LtileLayer } from 'leaflet';
import "leaflet/dist/leaflet.css";
import * as echarts from "echarts/core";
import {
  BarChart,
  LineChart,
  CustomChart,
  GaugeChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  SankeyChart,
  TreeChart,
  GraphChart,
} from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  ToolboxComponent,
  DatasetComponent,
  LegendComponent,
  PolarComponent,
  VisualMapComponent,
  DataZoomComponent,
} from "echarts/components";
import { LabelLayout, UniversalTransition } from "echarts/features";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import { withChartFont } from "@/utils/fonts";

echarts.use([
  TitleComponent,
  TooltipComponent,
  GridComponent,
  ToolboxComponent,
  DatasetComponent,
  LegendComponent,
  PolarComponent,
  VisualMapComponent,
  DataZoomComponent,
  BarChart,
  LineChart,
  CustomChart,
  GaugeChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  SankeyChart,
  TreeChart,
  GraphChart,
  LabelLayout,
  UniversalTransition,
  CanvasRenderer,
  SVGRenderer,
]);

export default defineComponent({
  name: "GeoMapRenderer",
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
    let tiledMap: any;
    let appliedView = "";

    const windowResizeEventCallback = async () => {
      await nextTick();
      await nextTick();
      chart?.resize();
    };

    // @ts-ignore getModel/getComponent are not in the ECharts typings
    const getLeaflet = () => chart?.getModel()?.getComponent("lmap")?.getLeaflet();

    const applyOptions = () => {
      if (!chart) return;
      const options = props.data.options;
      const lmapOptions = options?.lmap;
      const view = JSON.stringify([lmapOptions?.center, lmapOptions?.zoom]);
      if (!lmapOptions || !getLeaflet()) {
        chart.setOption(withChartFont(options || {}), true);
      } else if (view === appliedView) {
        // Leaving center/zoom out keeps the user's pan and zoom across refreshes.
        const { center: _center, zoom: _zoom, ...lmap } = lmapOptions;
        chart.setOption(withChartFont({ ...options, lmap }), {
          replaceMerge: ["series", "visualMap"],
        });
      } else {
        chart.setOption(withChartFont(options), { replaceMerge: ["series", "visualMap"] });
      }

      const lmap = getLeaflet();
      if (!lmap) return;
      if (lmap !== tiledMap) {
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(lmap);
        tiledMap = lmap;
        appliedView = "";
      }
      if (view !== appliedView && lmapOptions?.center) {
        lmap.setView([lmapOptions.center[1], lmapOptions.center[0]], lmapOptions.zoom);
      }
      appliedView = view;
    };

    onMounted(async () => {
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      if (chartRef.value) {
        chart = echarts.init(chartRef.value);
      }
      applyOptions();
      window.addEventListener("resize", windowResizeEventCallback);
    });
    onUnmounted(() => {
      window.removeEventListener("resize", windowResizeEventCallback);
      getLeaflet()?.off();
      if (chart) {
        chart?.dispose();
      }
    });

    watch(
      () => props.data.options,
      async () => {
        await nextTick();
        chart?.resize();
        applyOptions();
      },
      { deep: true },
    );
    return { chartRef };
  },
});
</script>
