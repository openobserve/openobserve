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
  <div class="h-full w-full"
    data-test="chart-renderer"
    ref="chartRef"
    id="chart"
    @mouseover="handleMouseOver"
    @mouseleave="handleMouseLeave"
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
  type PropType,
  type Ref,
} from "vue";
import * as echarts from "echarts";
import { useI18n } from "vue-i18n";

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
import { withChartFont } from "@/utils/fonts";

// Register necessary components.
// echarts' subpath type decls (echarts/components, echarts/renderers) resolve to
// a separate copy of EChartsExtensionInstaller than the full "echarts" package,
// so these installers are structurally incompatible only at the type level —
// cast at this 3rd-party boundary to the exact param type of echarts.use.
echarts.use([
  TitleComponent,
  TooltipComponent,
  GridComponent,
  ToolboxComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
  SVGRenderer,
] as unknown as Parameters<typeof echarts.use>[0]);

// Custom-chart option object. It is user-authored ECharts config that may embed
// function-strings and an `o2_events` map, so its shape is intentionally open.
type CustomChartData = Record<string, unknown> & {
  extras?: { panelId?: string | number };
  o2_events?: Record<
    string,
    (params: echarts.ECElementEvent, chart: echarts.EChartsType) => void
  >;
};

// Injected cross-panel hover state (provided by the dashboard grid).
interface HoveredSeriesState {
  panelId: string | number | undefined;
}

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
    // The declared events are string-named, but existing runtime call sites emit
    // an error-payload object as the first arg (a long-standing shape this typing
    // conversion must preserve). Cast the payload to emit's event-name param type.
    type EmitEvent = Parameters<typeof emit>[0];

    const { t } = useI18n();
    const chartRef: Ref<HTMLElement | null> = ref(null);
    let chart: echarts.EChartsType | null = null;

    const hoveredSeriesState = inject<HoveredSeriesState | null>(
      "hoveredSeriesState",
      null,
    );
    const convertStringToFunction = (obj: unknown): unknown => {
      if (typeof obj === "string" && obj.startsWith("function")) {
        try {
          return new Function(`return ${obj}`)(); // Convert string to function
        } catch (error) {
          // Preserve original runtime read of error.message; catch binds unknown
          // under strict TS, so narrow the shape without changing the value read.
          const message = (error as { message?: string }).message;
          emit({
            message: t(
              "dashboard.customChartRenderer.errorExecutingCodeWithMessage",
              { message },
            ),
            code: "",
          } as unknown as EmitEvent);
        }
      }

      if (Array.isArray(obj)) {
        return obj.map((item) => convertStringToFunction(item)); // Recursively handle arrays
      }

      if (typeof obj === "object" && obj !== null) {
        const result: Record<string, unknown> = {};
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            result[key] = convertStringToFunction(
              (obj as Record<string, unknown>)[key],
            ); // Recursively handle object properties
          }
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
        chart = echarts.init(chartRef.value, undefined, {
          renderer: "canvas",
        });
      } else {
        // Clear previous chart data to prevent overlay of old and new charts
        chart.clear();
      }

      try {
        const convertedData = convertStringToFunction(
          props.data,
        ) as CustomChartData;
        const safeChartOptions = deepSanitize(convertedData) as CustomChartData;
        chart.setOption(withChartFont(safeChartOptions));

        const o2Events = convertedData.o2_events;
        if (o2Events) {
          const boundChart = chart;
          // Add event listeners for custom interactions
          for (const event in o2Events) {
            chart.off(event);
            chart.on(event, (params) =>
              o2Events[event](params as echarts.ECElementEvent, boundChart),
            );
          }
        }
      } catch (e) {
        emit({
          message: t("dashboard.customChartRenderer.errorExecutingCode"),
          code: "",
        } as unknown as EmitEvent);
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
