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
  <div
    data-test="chart-renderer"
    ref="chartRef"
    id="chart1"
    @mouseenter="() => (hoveredSeriesState.panelId = data?.extras?.panelId)"
    @mouseleave="hoveredSeriesState.panelId = -1"
    style="height: 100%; width: 100%"
  ></div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  watch,
  onUnmounted,
  nextTick,
  onActivated,
  inject,
} from "vue";
import * as echarts from "echarts";
import { useStore } from "vuex";

export default defineComponent({
  name: "ChartRenderer",
  emits: ["updated:chart", "click", "updated:dataZoom"],
  props: {
    data: {
      required: true,
      type: Object,
      default: () => ({ options: {} }),
    },
  },
  setup(props: any, { emit }) {
    const chartRef: any = ref(null);
    let chart: any;
    const store = useStore();
    const windowResizeEventCallback = async () => {
      await nextTick();
      await nextTick();
      chart?.resize();
    };

    // currently hovered series state
    const hoveredSeriesState: any = inject("hoveredSeriesState");

    const mouseHoverEffectFn = (params: any) => {
      // if chart type is pie then set seriesName and seriesIndex from data and dataIndex
      // seriesName and seriesIndex will used in the same function
      if (params?.componentSubType === "pie") {
        params.seriesName = params?.data?.name;
        params.seriesIndex = params?.dataIndex;
      }

      // set current hovered series name in state
      hoveredSeriesState?.value?.setHoveredSeriesName(params?.seriesName);

      // scroll legend upto current series index
      const legendOption = chart?.getOption()?.legend[0];

      if (legendOption) {
        legendOption.scrollDataIndex = params?.seriesIndex || 0;
        chart?.setOption({ legend: [legendOption] });
      }
    };

    const mouseOutEffectFn = () => {
      // reset current hovered series name in state
      hoveredSeriesState?.value?.setHoveredSeriesName("");
    };

    const legendSelectChangedFn = (params: any) => {
      // check if all series are selected (all will be false)
      if (
        Object.values(params.selected).every((value: any) => value === false)
      ) {
        // set all series to true
        Object.keys(params.selected).forEach((name: any) => {
          params.selected[name] = true;
        });

        // select only selected series
      } else {
        // set all false except selected series
        Object.keys(params.selected).forEach((name: any) => {
          params.selected[name] = params.name === name ? true : false;
        });
      }

      // get legend
      const legendOption = chart?.getOption()?.legend[0];

      // set options with selected object
      if (legendOption) {
        legendOption.selected = params?.selected || 0;
        chart?.setOption({ legend: [legendOption] });
      }
    };

    // dispatch tooltip action for all charts
    watch(
      () => [
        hoveredSeriesState?.value.seriesIndex,
        hoveredSeriesState?.value?.dataIndex,
      ],
      () => {
        if (
          props?.data?.extras?.panelId &&
          props?.data?.extras?.panelId != hoveredSeriesState?.value?.panelId &&
          hoveredSeriesState?.value?.panelId != -1
        ) {
          chart?.dispatchAction({
            type: "showTip",
            seriesIndex: hoveredSeriesState?.value?.seriesIndex,
            dataIndex: hoveredSeriesState?.value?.dataIndex,
          });
        }
      }
    );

    watch(
      () => hoveredSeriesState?.value?.hoveredSeriesName,
      () => {
        chart?.dispatchAction({
          type: "highlight",
          seriesName: hoveredSeriesState?.value?.hoveredSeriesName,
        });
      }
    );

    watch(
      () => store.state.theme,
      (newTheme) => {
        const theme = newTheme === "dark" ? "dark" : "light";
        chart?.dispose();
        chart = echarts.init(chartRef.value, theme);
        const options = props.data.options || {};

        // change color and background color of tooltip
        options.tooltip &&
          options.tooltip.textStyle &&
          (options.tooltip.textStyle.color =
            theme === "dark" ? "#fff" : "#000");
        options.tooltip &&
          (options.tooltip.backgroundColor =
            theme === "dark" ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)");
        options.animation = false;
        chart?.setOption(options, true);
        chart?.setOption({ animation: true });
        chart?.on("mouseover", mouseHoverEffectFn);
        chart?.on("mouseout", mouseOutEffectFn);
        chart?.on("globalout", () => {
          mouseHoverEffectFn({});
          hoveredSeriesState?.value?.setIndex(-1, -1, -1);
          hoveredSeriesState?.value?.setHoveredSeriesName("");
        });
        chart?.on("legendselectchanged", legendSelectChangedFn);

        // we need that toolbox datazoom button initally selected
        chart?.dispatchAction({
          type: "takeGlobalCursor",
          key: "dataZoomSelect",
          dataZoomSelectActive: true,
        });
      }
    );

    const fn = throttle((params) => {
      // console.log(params);
      // for timeseries hover
      // setIndex(params.batch[0].dataIndex, params.batch[0].seriesIndex);
      // setPanelId(props?.data?.extras?.panelId);
    }, 100);

    onMounted(async () => {
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      const theme = store.state.theme === "dark" ? "dark" : "light";
      if (chartRef.value) {
        chart = echarts.init(chartRef.value, theme);
      }
      chart?.setOption(props?.data?.options || {}, true);
      chart?.on("mouseover", mouseHoverEffectFn);
      chart?.on("mouseout", mouseOutEffectFn);
      chart?.on("globalout", () => {
        mouseHoverEffectFn({});
        hoveredSeriesState?.value?.setIndex(-1, -1, -1);
        hoveredSeriesState?.value?.setHoveredSeriesName("");
      });

      chart?.on("legendselectchanged", legendSelectChangedFn);
      // chart?.on("click", (e: any) => {
      //   console.log(e, "click");
      // });
      // chart?.on("dblclick", (e: any) => {
      //   console.log(e, "dblclick");
      // });
      // chart?.on("mousedown", (e: any) => {
      //   console.log(e, "mousedown");
      // });
      // chart?.on("mousemove", (e: any) => {
      //   console.log(e, "mousemove");
      // });
      // chart?.on("mouseup", (e: any) => {
      //   console.log(e, "mousedown");
      // });
      // chart?.on("mouseover", (e: any) => {
      //   console.log(e, "mouseover");
      // });
      // chart?.on("mouseout", (e: any) => {
      //   console.log(e, "mouseout");
      // });
      // chart?.on("downplay", (params: any) => {
      //   fn(params);
      // });
      chart?.on("downplay", (params: any) => {
        // downplay event will only called by currently hovered panel else it will go into infinite loop
        if (props.data.extras?.panelId == hoveredSeriesState?.value?.panelId) {
          hoveredSeriesState?.value?.setIndex(
            params?.batch?.[0]?.dataIndex,
            params?.batch?.[0]?.seriesIndex,
            props?.data?.extras?.panelId || -1
          );
        }
      });
      emit("updated:chart", {
        start: chart?.getOption()?.dataZoom[0]?.startValue || 0,
        end: chart?.getOption()?.dataZoom[0]?.endValue || 0,
      });

      //on dataZoom emit an event of start x and end x
      chart?.on("dataZoom", function (params: any) {
        //if batch then emit dataZoom event
        if (params?.batch) {
          emit("updated:dataZoom", {
            start: params?.batch[0]?.startValue || 0,
            end: params?.batch[0]?.endValue || 0,
          });
        }
        //else if daatazoom then emit dataZoom event
        else if (chart?.getOption()?.dataZoom) {
          emit("updated:chart", {
            start: chart?.getOption()?.dataZoom[0]?.startValue || 0,
            end: chart?.getOption()?.dataZoom[0]?.endValue || 0,
          });
        }
      });
      chart?.on("click", function (params: any) {
        emit("click", params);
      });
      window.addEventListener("resize", windowResizeEventCallback);

      // we need that toolbox datazoom button initally selected
      chart?.dispatchAction({
        type: "takeGlobalCursor",
        key: "dataZoomSelect",
        dataZoomSelectActive: true,
      });
    });
    onUnmounted(() => {
      window.removeEventListener("resize", windowResizeEventCallback);
    });

    //need to resize chart on activated
    onActivated(() => {
      windowResizeEventCallback();

      // we need that toolbox datazoom button initally selected
      chart?.dispatchAction({
        type: "takeGlobalCursor",
        key: "dataZoomSelect",
        dataZoomSelectActive: true,
      });
    });

    watch(
      () => props.data.options,
      async () => {
        await nextTick();
        chart?.resize();
        chart?.setOption(props?.data?.options || {}, true);
        // we need that toolbox datazoom button initally selected
        // for that we required to dispatch an event
        // while dispatching an event we need to pass a datazoomselectactive as true
        // this action is available in the echarts docs in list of brush actions
        chart?.dispatchAction({
          type: "takeGlobalCursor",
          key: "dataZoomSelect",
          dataZoomSelectActive: true,
        });
        windowResizeEventCallback();
      },
      { deep: true }
    );
    return { chartRef, hoveredSeriesState };
  },
});
</script>
