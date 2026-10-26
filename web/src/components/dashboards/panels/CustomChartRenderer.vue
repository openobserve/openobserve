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
    class="h-full w-full"
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
import { useI18nTyped } from "@/types/i18n";

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
import { useTheme } from "@/composables/useTheme";
import { getColorPalette } from "@/utils/dashboard/colorPalette";

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

// Custom-chart option object. It is user-authored ECharts config that may carry
// callbacks and an `o2_events` map, so its shape is intentionally open.
type CustomChartData = Record<string, unknown> & {
  extras?: { panelId?: string | number };
  o2_events?: Record<string, (params: echarts.ECElementEvent, chart: echarts.EChartsType) => void>;
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

    const { t } = useI18nTyped();
    const chartRef: Ref<HTMLElement | null> = ref(null);
    let chart: echarts.EChartsType | null = null;
    let chartDark: boolean | null = null;
    const { isDark } = useTheme();

    const hoveredSeriesState = inject<HoveredSeriesState | null>("hoveredSeriesState", null);
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
      // The component can unmount while echarts-gl loads, nulling the ref.
      if (!chartRef.value) return;

      const dark = isDark.value;
      // ECharts fixes the theme at init, so a theme change needs a fresh instance.
      if (chart && chartDark !== dark) {
        chart.dispose();
        chart = null;
      }
      if (!chart) {
        chart = echarts.init(chartRef.value, dark ? "dark" : undefined, {
          renderer: "canvas",
        });
        chartDark = dark;
        if (chartRef.value.clientWidth === 0 || chartRef.value.clientHeight === 0) {
          reinitWhenSized();
        }
      } else {
        // Clear previous chart data to prevent overlay of old and new charts
        chart.clear();
      }

      try {
        const safeChartOptions = deepSanitize(props.data) as CustomChartData;
        const unset = (key: string) =>
          safeChartOptions[key] === null || safeChartOptions[key] === undefined;
        // ECharts' dark theme brings an opaque background and its own series palette; use the panel's instead.
        const themedOptions = dark
          ? {
              ...safeChartOptions,
              ...(unset("backgroundColor") && { backgroundColor: "transparent" }),
              ...(unset("color") && { color: getColorPalette() }),
            }
          : safeChartOptions;
        chart.setOption(withChartFont(themedOptions));

        const o2Events = props.data.o2_events;
        if (o2Events) {
          const boundChart = chart;
          // Add event listeners for custom interactions
          for (const event in o2Events) {
            if (typeof o2Events[event] !== "function") continue;
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

    // An instance created at zero size keeps zero-width canvases that resize() cannot repair.
    let zeroSizeReinitObserver: ResizeObserver | null = null;
    function reinitWhenSized() {
      if (!chartRef.value || zeroSizeReinitObserver) return;
      zeroSizeReinitObserver = new ResizeObserver(() => {
        const el = chartRef.value;
        if (el && (el.clientWidth === 0 || el.clientHeight === 0)) return;
        zeroSizeReinitObserver?.disconnect();
        zeroSizeReinitObserver = null;
        if (!el) return;
        chart?.dispose();
        chart = null;
        initChart();
      });
      zeroSizeReinitObserver.observe(chartRef.value);
    }

    const handleResize = async () => {
      await nextTick();
      chart?.resize();
    };

    const handleMouseOver = () => {
      if (hoveredSeriesState) hoveredSeriesState.panelId = props.data.extras?.panelId;
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
    watch(isDark, () => initChart());

    onUnmounted(() => {
      zeroSizeReinitObserver?.disconnect();
      zeroSizeReinitObserver = null;
      chart?.dispose();
      chart = null;
      window.removeEventListener("resize", handleResize);
    });

    return { chartRef, handleMouseOver, handleMouseLeave };
  },
});
</script>
