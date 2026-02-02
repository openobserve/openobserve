<!-- Copyright 2023 OpenObserve Inc.

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
    class="chart-container"
    @mouseover="
      () => {
        // if hoveredSeriesState is not null then set panelId
        if (hoveredSeriesState)
          hoveredSeriesState.panelId = data?.extras?.panelId;
      }
    "
    @mouseleave="
      () => {
        // if hoveredSeriesState is not null then set -1
        if (hoveredSeriesState) hoveredSeriesState.setIndex(-1, -1, -1, null);
      }
    "
    @contextmenu="handleNativeContextMenu"
    style="height: 100%; width: 100%"
  ></div>
</template>

<script lang="ts">
// Find the index of the nearest value in a sorted array
// used in timeseries hovering across all charts to find nearest dataindex
function findNearestIndex(sortedArray: any, target: any) {
  let left = 0;
  let right = sortedArray.length - 1;
  let nearestIndex = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);

    if (sortedArray[mid][0] === target) {
      return mid; // Found the target at index mid
    }

    if (
      nearestIndex === -1 ||
      Math.abs(sortedArray[mid][0] - target) <
        Math.abs(sortedArray[nearestIndex][0] - target)
    ) {
      nearestIndex = mid; // Update nearestIndex if current element is closer to the target
    }

    if (sortedArray[mid][0] < target) {
      left = mid + 1; // Target is in the right half
    } else {
      right = mid - 1; // Target is in the left half
    }
  }

  return nearestIndex; // Return the index of the nearest value
}

import { throttle } from "lodash-es";
import {
  defineComponent,
  ref,
  onMounted,
  watch,
  onUnmounted,
  nextTick,
  onActivated,
  onDeactivated,
  inject,
} from "vue";
import { useStore } from "vuex";
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
  MarkLineComponent,
  MarkAreaComponent,
} from "echarts/components";
import { LabelLayout, UniversalTransition } from "echarts/features";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import type {
  BarSeriesOption,
  LineSeriesOption,
  CustomSeriesOption,
  GaugeSeriesOption,
  PieSeriesOption,
  ScatterSeriesOption,
  HeatmapSeriesOption,
  SankeySeriesOption,
  TreeSeriesOption,
} from "echarts/charts";
import type { ComposeOption } from "echarts/core";
import type {
  TitleComponentOption,
  TooltipComponentOption,
  GridComponentOption,
  ToolboxComponentOption,
  DatasetComponentOption,
  LegendComponentOption,
  PolarComponentOption,
  VisualMapComponentOption,
  DataZoomComponentOption,
  MarkLineComponentOption,
  MarkAreaComponentOption,
} from "echarts/components";

type ECOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | CustomSeriesOption
  | GaugeSeriesOption
  | PieSeriesOption
  | ScatterSeriesOption
  | HeatmapSeriesOption
  | SankeySeriesOption
  | TreeSeriesOption
  | TitleComponentOption
  | TooltipComponentOption
  | GridComponentOption
  | ToolboxComponentOption
  | DatasetComponentOption
  | LegendComponentOption
  | PolarComponentOption
  | VisualMapComponentOption
  | DataZoomComponentOption
  | MarkLineComponentOption
  | MarkAreaComponentOption
>;

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
  MarkLineComponent,
  MarkAreaComponent,
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
  name: "ChartRenderer",
  emits: [
    "updated:chart",
    "click",
    "updated:dataZoom",
    "error",
    "mouseover",
    "mousemove",
    "mouseout",
    "contextmenu",
    "domcontextmenu",
  ],
  props: {
    data: {
      required: true,
      type: Object,
      default: () => ({ options: {} }),
    },
    renderType: {
      type: String,
      default: "canvas",
    },
    height: {
      type: String,
      default: "100%",
    },
  },
  setup(props: any, { emit }) {
    const chartRef: any = ref(null);
    let chart: any;
    const store = useStore();

    const cleanupChart = () => {
      // Remove all event listeners from chart
      chart?.off("mousemove");
      chart?.off("mouseout");
      chart?.off("globalout");
      chart?.off("legendselectchanged");
      chart?.off("highlight");
      chart?.off("dataZoom");
      chart?.off("click");
      chart?.off("mouseover");
      chart?.off("contextmenu");

      //dispose
      if (chart) {
        chart.dispose();
      }

      chart = null;
    };

    const windowResizeEventCallback = async () => {
      try {
        await nextTick();
        await nextTick();
        chart?.resize();
      } catch (e) {
        console.error("Error during resizing", e);
      }
    };

    // currently hovered series state
    const hoveredSeriesState: any = inject("hoveredSeriesState", null);

    const DEBOUNCE_TIMEOUT = 350;

    // Create a stable throttled function that persists between renders
    const throttledSetHoveredSeriesName = throttle((name: string) => {
      hoveredSeriesState?.value?.setHoveredSeriesName(name);
    }, DEBOUNCE_TIMEOUT);

    // Create a stable throttled function that persists between renders
    const throttledSetHoveredSeriesIndex = throttle(
      (arg1, arg2, arg3, arg4) => {
        hoveredSeriesState?.value?.setIndex(arg1, arg2, arg3, arg4);
      },
      DEBOUNCE_TIMEOUT,
    );

    const mouseHoverEffectFn = (params: any) => {
      // if chart type is pie then set seriesName and seriesIndex from data and dataIndex
      // seriesName and seriesIndex will used in the same function
      if (params?.componentSubType === "pie") {
        params.seriesName = params?.data?.name;
        params.seriesIndex = params?.dataIndex;
      }

      // if sankey chart then do not set seriesName and seriesIndex
      if (params?.componentSubType === "sankey") {
        params.seriesName = "";
        params.seriesIndex = -1;
      }

      // Use the throttled function to update the state
      throttledSetHoveredSeriesName(params?.seriesName ?? "");

      // Below logic is to scroll legend upto current series index
      // which creates wrong legend highlight issue in tooltip
      // so commented out
      // scroll legend upto current series index
      // const legendOption = chart?.getOption()?.legend[0];
      // if (legendOption) {
      // legendOption.scrollDataIndex = params?.seriesIndex || 0;
      // chart?.setOption({ legend: [legendOption] });
      // chart?.dispatchAction({
      //   type: "legendScroll",
      //   scrollDataIndex: params?.seriesIndex || 0,
      //   legendId: params?.seriesId,
      // });
      // }
    };

    const mouseOutEffectFn = () => {
      // reset current hovered series name in state
      throttledSetHoveredSeriesName("");
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

      if (legendOption) {
        // set selected array
        legendOption.selected = params.selected;

        // set options with selected object
        chart?.setOption({ legend: [legendOption] }, { lazyUpdate: true });
      }
    };

    // restore chart and select datazoom button
    const restoreChart = () => {
      chart?.dispatchAction({
        type: "restore",
      });
      // we need that toolbox datazoom button initially selected
      chart?.dispatchAction({
        type: "takeGlobalCursor",
        key: "dataZoomSelect",
        dataZoomSelectActive: true,
      });
    };

    // Handle ECharts contextmenu event when clicking on data points
    const handleContextMenu = (params: any) => {
      // Get chart type from the first series
      const chartType = chart?.getOption()?.series?.[0]?.type;

      // Only handle contextmenu for bar and line charts
      if (!chartType || !["bar", "line"].includes(chartType)) {
        return;
      }

      // Prevent default context menu
      const event = params.event?.event;
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      // Extract data point value
      let dataPointValue = null;

      // For bar and line charts, get the value from the data
      if (params.value !== undefined && params.value !== null) {
        // For array format [x, y], take y value
        if (Array.isArray(params.value)) {
          dataPointValue =
            params.value[1] !== undefined ? params.value[1] : params.value[0];
        } else {
          dataPointValue = params.value;
        }
      } else if (params.data !== undefined && params.data !== null) {
        // Alternative data format
        if (Array.isArray(params.data)) {
          dataPointValue =
            params.data[1] !== undefined ? params.data[1] : params.data[0];
        } else if (
          typeof params.data === "object" &&
          params.data.value !== undefined
        ) {
          dataPointValue = params.data.value;
        } else {
          dataPointValue = params.data;
        }
      }

      // Only emit if we have a valid data point value
      if (
        dataPointValue !== null &&
        dataPointValue !== undefined &&
        !isNaN(Number(dataPointValue))
      ) {
        emit("contextmenu", {
          x: event?.clientX || 0,
          y: event?.clientY || 0,
          value: Number(dataPointValue),
          seriesName: params.seriesName,
          dataIndex: params.dataIndex,
          seriesIndex: params.seriesIndex,
        });

        emit("domcontextmenu", {
          x: event.clientX,
          y: event.clientY,
          value: Number(dataPointValue),
        });
      }
    };

    // Handle native DOM contextmenu event for alert creation
    // This handles right-clicks anywhere on the chart (including empty space)
    const handleNativeContextMenu = async (event: MouseEvent) => {
      // Get chart type from the first series
      await nextTick();
      const chartType = chart?.getOption()?.series?.[0]?.type;

      // Only handle contextmenu for bar and line charts
      if (!chartType || !["bar", "line"].includes(chartType)) {
        return;
      }

      // Prevent default browser context menu
      event.preventDefault();
      event.stopPropagation();

      try {
        // Get the chart container's bounding rect to calculate relative position
        const chartContainer = chartRef.value;
        if (!chartContainer || !chart) {
          return;
        }

        const rect = chartContainer.getBoundingClientRect();
        const pixelPoint = [
          event.clientX - rect.left,
          event.clientY - rect.top,
        ];

        // Convert pixel coordinates to data values using the chart's coordinate system
        const pointInGrid = chart.convertFromPixel(
          { gridIndex: 0 },
          pixelPoint,
        );

        if (
          pointInGrid &&
          Array.isArray(pointInGrid) &&
          pointInGrid.length >= 2
        ) {
          const yAxisValue = pointInGrid[1]; // Y-axis value at cursor position

          // Emit domcontextmenu event for alert creation
          if (
            yAxisValue !== null &&
            yAxisValue !== undefined &&
            !isNaN(Number(yAxisValue))
          ) {
            emit("domcontextmenu", {
              x: event.clientX,
              y: event.clientY,
              value: Number(yAxisValue),
            });
          }
        }
      } catch (error) {
        console.warn("Could not convert pixel to data point:", error);
      }
    };

    const chartInitialSetUp = () => {
      chart?.on("mousemove", (params: any) => {
        emit("mousemove", params);
        mouseHoverEffectFn(params);
      });
      chart?.on("mouseout", (params: any) => {
        emit("mouseout", params);
        mouseOutEffectFn();
      });

      chart?.on("globalout", () => {
        mouseOutEffectFn();
        // flush any pending throttled calls to ensure immediate reset
        throttledSetHoveredSeriesIndex.flush();
        throttledSetHoveredSeriesName.flush();
      });

      chart?.on("legendselectchanged", legendSelectChangedFn);
      chart?.on("contextmenu", handleContextMenu);
      chart?.on("highlight", (params: any) => {
        // reset hovered series name on downplay
        // hoveredSeriesState?.value?.setHoveredSeriesName("");

        // downplay event will only called by currently hovered panel else it will go into infinite loop
        // and chart must be timeseries chart
        if (
          props.data.extras?.panelId == hoveredSeriesState?.value?.panelId &&
          props?.data?.extras?.isTimeSeries === true
        ) {
          const seriesIndex = params?.batch?.[0]?.seriesIndex;
          const dataIndex = Math.max(params?.batch?.[0]?.dataIndex, 0);

          // set current hovered series name in state
          if (chart?.getOption()?.series[seriesIndex]?.data[dataIndex]) {
            throttledSetHoveredSeriesIndex(
              dataIndex,
              seriesIndex,
              props?.data?.extras?.panelId || -1,
              chart?.getOption()?.series[seriesIndex]?.data[dataIndex][0],
            );
          }
        }
      });

      //on dataZoom emit an event of start x and end x
      chart?.on("dataZoom", function (params: any) {
        //if batch then emit dataZoom event
        if (params?.batch) {
          emit("updated:dataZoom", {
            start: params?.batch[0]?.startValue || 0,
            end: params?.batch[0]?.endValue || 0,
            start1: params?.batch[1]?.startValue || 0,
            end1: params?.batch[1]?.endValue || 0,
          });
          restoreChart();
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

      chart?.on("mouseover", function (params: any) {
        emit("mouseover", params);
      });

      window.removeEventListener("resize", windowResizeEventCallback);
      window.addEventListener("resize", windowResizeEventCallback);

      // we need that toolbox datazoom button initially selected
      chart?.dispatchAction({
        type: "takeGlobalCursor",
        key: "dataZoomSelect",
        dataZoomSelectActive: true,
      });
    };

    // dispatch tooltip action for all charts
    watch(
      () => [
        hoveredSeriesState?.value?.seriesIndex,
        hoveredSeriesState?.value?.dataIndex,
        hoveredSeriesState?.value?.panelId,
      ],
      () => {
        // if hovered series is not same as currently hovered series
        // and hovered series is not -1
        // and chart is time series
        if (
          isChartVisible &&
          props?.data?.extras?.panelId &&
          props?.data?.extras?.panelId != hoveredSeriesState?.value?.panelId &&
          hoveredSeriesState?.value?.panelId != -1 &&
          props?.data?.extras?.isTimeSeries === true
        ) {
          // need to check index should not be greater than series length
          const hoveredSeriesIndex =
            chart?.getOption()?.series.length >
            hoveredSeriesState?.value?.seriesIndex
              ? hoveredSeriesState?.value?.seriesIndex
              : 0;
          let hoveredSeriesDataIndex = hoveredSeriesState?.value?.dataIndex;

          // if hovered series dataindex is not there
          // or check hovered time is not at the same index in the current chart (ie if at same index then not need to find nearest index)
          if (
            !chart?.getOption()?.series[hoveredSeriesIndex]?.data[
              hoveredSeriesDataIndex
            ] ||
            chart?.getOption()?.series[hoveredSeriesIndex]?.data[
              hoveredSeriesDataIndex
            ][0] != hoveredSeriesState.value?.hoveredTime
          ) {
            hoveredSeriesDataIndex = findNearestIndex(
              chart?.getOption()?.series[hoveredSeriesIndex]?.data ?? [],
              hoveredSeriesState?.value?.hoveredTime,
            );
          }

          chart?.dispatchAction({
            type: "showTip",
            seriesIndex: hoveredSeriesIndex,
            dataIndex: hoveredSeriesDataIndex,
          });
        }

        // if state is -1 then restore chart
        if (
          hoveredSeriesState.value?.dataIndex == -1 &&
          hoveredSeriesState.value?.seriesIndex == -1 &&
          hoveredSeriesState.value?.panelId == -1 &&
          hoveredSeriesState.value?.hoveredTime == null
        ) {
          restoreChart();
        }
      },
    );

    watch(
      () => hoveredSeriesState?.value?.hoveredSeriesName,
      () => {
        chart?.dispatchAction({
          type: "highlight",
          seriesName: hoveredSeriesState?.value?.hoveredSeriesName,
        });
      },
    );

    watch(
      () => store.state.theme,
      (newTheme) => {
        const theme = newTheme === "dark" ? "dark" : "light";
        cleanupChart();
        chart = echarts.init(chartRef.value, theme, {
          renderer: props.renderType,
        });
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
        try {
          // Use notMerge flag from data prop if available, otherwise default to true
          const notMerge =
            props.data?.notMerge !== undefined ? props.data.notMerge : true;
          const lazyUpdate =
            props.data?.lazyUpdate !== undefined ? props.data.lazyUpdate : true;
          chart?.setOption(options, { lazyUpdate, notMerge });
          chart?.setOption({ animation: true }, { lazyUpdate: true });
        } catch (e: any) {
          emit("error", {
            message: e,
            code: "",
          });
        }

        chartInitialSetUp();
      },
    );

    onMounted(async () => {
      try {
        await nextTick();
        await nextTick();
        await nextTick();
        await nextTick();
        await nextTick();
        await nextTick();
        await nextTick();
        const theme = store.state.theme === "dark" ? "dark" : "light";
        if (chartRef.value) {
          cleanupChart();
          chart = echarts.init(chartRef.value, theme, {
            renderer: props.renderType,
          });
        }
        chart?.setOption(props?.data?.options || {}, {
          lazyUpdate: true,
          notMerge: true,
        });
        chartInitialSetUp();
      } catch (e: any) {
        emit("error", {
          message: e,
          code: "",
        });
      }
    });
    onUnmounted(() => {
      // Clean up event listeners
      window.removeEventListener("resize", windowResizeEventCallback);

      // Cancel throttled functions
      throttledSetHoveredSeriesName.cancel();
      throttledSetHoveredSeriesIndex.cancel();

      // Clean up chart instance
      chart?.dispose();
      chart = null;

      // Clean up intersection observer
      if (chartRef.value && isChartVisibleObserver) {
        isChartVisibleObserver.unobserve(chartRef.value);
        isChartVisibleObserver.disconnect();
        isChartVisibleObserver = null;
      }

      // Clear chart reference
      if (chartRef.value) {
        chartRef.value = null;
      }
    });

    // observer for chart visibility
    let isChartVisibleObserver: any;

    // flag for chart visibility
    let isChartVisible: any = false;

    onMounted(() => {
      // chart visibility observer
      isChartVisibleObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // chart is visible
            isChartVisible = true;
          } else {
            // chart is not visible
            isChartVisible = false;
          }
        });
      });

      if (chartRef.value) {
        // observe chart
        isChartVisibleObserver.observe(chartRef.value);
      }
    });

    onUnmounted(() => {
      if (chartRef.value) {
        // unobserve chart
        isChartVisibleObserver?.unobserve(chartRef.value);
        isChartVisibleObserver?.disconnect();
      }

      cleanupChart();
    });

    //need to resize chart on activated
    onActivated(async () => {
      try {
        await nextTick();
        await nextTick();
        await nextTick();
        await nextTick();
        await nextTick();
        await nextTick();
        await nextTick();
        const theme = store.state.theme === "dark" ? "dark" : "light";
        if (chartRef.value) {
          cleanupChart();
          chart = echarts.init(chartRef.value, theme, {
            renderer: props.renderType,
          });
        }
        chart?.setOption(props?.data?.options || {}, {
          lazyUpdate: true,
          notMerge: true,
        });
        chartInitialSetUp();
        windowResizeEventCallback();

        // we need that toolbox datazoom button initially selected
        chart?.dispatchAction({
          type: "takeGlobalCursor",
          key: "dataZoomSelect",
          dataZoomSelectActive: true,
        });
      } catch (e: any) {
        emit("error", {
          message: e,
          code: "",
        });
      }
    });

    // Clean up on deactivate
    onDeactivated(() => {
      cleanupChart();
    });

    watch(
      () => props.height,
      async () => {
        try {
          await nextTick();
          chart?.resize();
        } catch (e) {
          console.error("Error while resizing", e);
        }
      },
    );

    watch(
      () => props.data.options,
      async () => {
        try {
          await nextTick();
          chart?.resize();
          try {
            chart?.setOption(props?.data?.options || {}, {
              lazyUpdate: true,
              notMerge: true,
            });
          } catch (error) {
            console.error("Error during setOption", error);
          }

          // we need that toolbox datazoom button initially selected
          // for that we required to dispatch an event
          // while dispatching an event we need to pass a datazoomselectactive as true
          // this action is available in the echarts docs in list of brush actions
          chart?.dispatchAction({
            type: "takeGlobalCursor",
            key: "dataZoomSelect",
            dataZoomSelectActive: true,
          });
          windowResizeEventCallback();
        } catch (e: any) {
          emit("error", {
            message: e,
            code: "",
          });
        }
      },
      { deep: true },
    );
    return { chartRef, hoveredSeriesState, handleNativeContextMenu };
  },
});
</script>

<style>
/**
 * Print mode styles for ECharts
 *
 * These styles must be unscoped (global) to override ECharts' inline styles.
 * ECharts sets fixed pixel dimensions via inline styles (e.g., width: 740px),
 * which causes charts to overflow their containers in print mode when GridStack
 * scales panels down to fit the page.
 *
 * The !important declarations override inline styles, forcing both the chart
 * wrapper div and canvas elements to scale to 100% of their container size.
 * This ensures charts fit properly when printing, regardless of their original
 * render dimensions.
 */
@media print {
  /* Clip the ECharts wrapper to prevent chart overflow but don't scale */
  .chart-container > div[style*="position: relative"] {
    overflow: hidden !important;
    max-width: 100% !important;
    max-height: 100% !important;
  }

  /* Prevent canvas from exceeding container size without scaling */
  .chart-container canvas,
  .chart-container svg {
    max-width: 100% !important;
    max-height: 100% !important;
    object-fit: contain !important;
  }
}
</style>
