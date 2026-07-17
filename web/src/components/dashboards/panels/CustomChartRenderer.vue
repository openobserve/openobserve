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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div
    data-test="chart-renderer"
    ref="chartRef"
    id="chart"
    @mouseover="handleMouseOver"
    @mouseleave="handleMouseLeave"
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
  inject,
} from "vue";
import type { PropType } from "vue";
// Side-effect import registers all built-in charts/components/renderers.
import "echarts";
import { use, init } from "echarts/core";
import type { EChartsType } from "echarts/core";

// Import all components and renderers once for generic usage
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  ToolboxComponent,
  LegendComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";

import DOMPurify from "dompurify";

// Shared hovered-series reactive state provided by dashboard renderers.
interface HoveredSeriesState {
  panelId: number | string | undefined;
}

// Chart option object supplied by the parent; may carry an extras.panelId.
interface CustomChartData {
  extras?: { panelId?: number | string };
  [key: string]: unknown;
}

// Custom-chart option after string->function conversion; o2_events are
// user-supplied handlers keyed by echarts event name.
type O2EventHandler = (params: unknown, chart: EChartsType) => void;
interface CustomChartOption {
  o2_events?: Record<string, O2EventHandler>;
  [key: string]: unknown;
}

function isCustomChartOption(value: unknown): value is CustomChartOption {
  return typeof value === "object" && value !== null;
}

// Register necessary components
use([
  TitleComponent,
  TooltipComponent,
  GridComponent,
  ToolboxComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
  SVGRenderer,
]);

export default defineComponent({
  name: "CustomChartRenderer",
  emits: ["error", "mousemove", "mouseout", "click"],
  props: {
    data: {
      required: true,
      type: Object as PropType<CustomChartData>,
      default: () => ({}),
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
  setup(props, { emit }) {
    const chartRef = ref<HTMLElement | null>(null);
    let chart: EChartsType | null = null;

    const hoveredSeriesState = inject<HoveredSeriesState | null>(
      "hoveredSeriesState",
      null,
    );
    const convertStringToFunction = (obj: unknown): unknown => {
      if (typeof obj === "string" && obj.startsWith("function")) {
        try {
          return new Function(`return ${obj}`)(); // Convert string to function
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          emit({
            message: `Error while executing the code: ${message}`,
            code: "",
          });
        }
      }

      if (Array.isArray(obj)) {
        return obj.map((item) => convertStringToFunction(item)); // Recursively handle arrays
      }

      if (typeof obj === "object" && obj !== null) {
        const result: Record<string, unknown> = {};
        // Own enumerable keys only — same set as for-in + hasOwnProperty guard.
        for (const [key, value] of Object.entries(obj)) {
          result[key] = convertStringToFunction(value); // Recursively handle object properties
        }
        return result;
      }

      return obj; // If it's not a function string or an object, return it as is
    };
    function deepSanitize(obj: unknown): unknown {
      if (typeof obj === "string") {
        return DOMPurify.sanitize(obj);
      } else if (Array.isArray(obj)) {
        return obj.map(deepSanitize);
      } else if (typeof obj === "object" && obj !== null) {
        return Object.fromEntries(
          Object.entries(obj).map(([key, value]) => [key, deepSanitize(value)]),
        );
      }
      return obj;
    }

    const initChart = async () => {
      if (!chartRef.value) return;

      await import("echarts-gl");

      // Initialize chart if it doesn't exist, otherwise reuse existing instance
      if (!chart) {
        chart = init(chartRef.value, undefined, {
          renderer: "canvas",
        });
      } else {
        // Clear previous chart data to prevent overlay of old and new charts
        chart.clear();
      }

      try {
        const convertedData = convertStringToFunction(props.data);
        const safeChartOptions = deepSanitize(convertedData);
        if (isCustomChartOption(safeChartOptions)) {
          chart.setOption(safeChartOptions);
        }

        const options = isCustomChartOption(convertedData) ? convertedData : {};
        const o2Events = options.o2_events;
        if (o2Events) {
          const activeChart = chart;
          // Add event listeners for custom interactions
          for (const event in o2Events) {
            chart.off(event);
            chart.on(event, (params) =>
              o2Events[event](params, activeChart),
            );
          }
        }
      } catch (e) {
        emit({
          message: "Error while executing the code",
          code: "",
        });
      }
    };

    const handleResize = async () => {
      await nextTick();
      chart?.resize();
    };

    const handleMouseOver = () => {
      if (hoveredSeriesState)
        hoveredSeriesState.panelId = props.data.extras?.panelId;
    };

    const handleMouseLeave = () => {
      // if (hoveredSeriesState) hoveredSeriesState.setIndex(-1, -1, -1, null);
    };

    onMounted(() => {
      initChart();

      // Watch for window resize
      window.addEventListener("resize", handleResize);
    });
    watch(
      () => props.data,
      async () => {
        await initChart(); // Re-initialize chart when option change
      },
      { deep: true },
    );

    onUnmounted(() => {
      chart?.dispose();
      window.removeEventListener("resize", handleResize);
    });

    return { chartRef, handleMouseOver, handleMouseLeave };
  },
});
</script>
