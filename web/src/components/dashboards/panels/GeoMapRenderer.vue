<!-- Copyright 2023 Zinc Labs Inc.

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
  <div style="padding: 5px; height: 100%; width: 100%">
    <div ref="chartRef" id="chart-map" style="height: 100%; width: 100%"></div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  watch,
  onUnmounted,
  nextTick,
  onBeforeMount,
} from "vue";
import { useStore } from "vuex";

import L from "leaflet";
import "@/utils/dashboard/leaflet-echarts/index";

// import {tileLayer as LtileLayer } from 'leaflet';
import "leaflet/dist/leaflet.css";
import * as echarts from "echarts/core";

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
    let lmap: any;
    let lmapComponent: any;
    const lmapOptions = { ...props.data.options?.lmap } || {};

    const store = useStore();
    const windowResizeEventCallback = async () => {
      await nextTick();
      await nextTick();
      chart?.resize();
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
      const options = {
        ...props.data.options,
        lmap: lmapOptions,
      };
      chart?.setOption(options || {}, true);
      window.addEventListener("resize", windowResizeEventCallback);

      // Get Leaflet extension component
      // getModel and getComponent do not seem to be exported in echarts typescript
      // add the following two comments to circumvent this
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      lmapComponent = chart?.getModel()?.getComponent("lmap");

      // Get the instance of Leaflet
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      lmap = lmapComponent?.getLeaflet();

      if (lmap) {
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(lmap);
      }
      if (props.data.options?.lmap?.center) {
        lmap.setView(
          [
            props.data.options?.lmap?.center[1],
            props.data.options?.lmap?.center[0],
          ],
          props.data.options?.lmap?.zoom
        );
      }
      // L.geoJson(mapData).addTo(lmap);
    });
    onUnmounted(() => {
      window.removeEventListener("resize", windowResizeEventCallback);
      if (lmap) {
        lmap.off();
      }
      if (chart) {
        chart?.dispose();
      }
    });

    watch(
      () => props.data.options,
      async (newOptions) => {
        await nextTick();
        chart?.resize();
        const options = {
          ...props.data.options,
          lmap: lmapOptions,
        };
        chart?.setOption(options || {}, true);
        // Get Leaflet extension component
        // getModel and getComponent do not seem to be exported in echarts typescript
        // add the following two comments to circumvent this
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        lmapComponent = chart?.getModel().getComponent("lmap");

        // Get the instance of Leaflet
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        lmap = lmapComponent?.getLeaflet();

        if (lmap) {
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          }).addTo(lmap);
        }
        if (props.data.options?.lmap?.center) {
          lmap?.setView(
            [
              props.data.options?.lmap?.center[1],
              props.data.options?.lmap?.center[0],
            ],
            props.data.options?.lmap?.zoom
          );
        }
      },
      { deep: true }
    );
    return { chartRef };
  },
});
</script>
