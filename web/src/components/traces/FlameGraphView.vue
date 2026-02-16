<!--
  FlameGraphView - Flame graph visualization using ECharts
  Displays spans as hierarchical blocks where width = duration
-->
<template>
  <div
    class="flame-graph-view tw:flex tw:flex-col tw:h-full tw:bg-white tw:w-full"
    style="min-height: 400px; height: 100%"
  >
    <!-- Controls Bar -->
    <div
      class="tw:px-6 tw:py-3 tw:border-b tw:border-[var(--o2-border)] tw:flex tw:items-center tw:justify-between tw:bg-[var(--o2-surface)]"
    >
      <div class="tw:flex tw:items-center tw:space-x-4">
        <div class="tw:text-xs tw:font-bold tw:text-[var(--o2-text-secondary)]">
          <span class="tw:text-[var(--o2-text-primary)]">{{ totalSpans }}</span>
          spans
          <span class="tw:mx-2">•</span>
          <span class="tw:text-[var(--o2-text-primary)]">{{ maxDepth }}</span>
          max depth
        </div>
      </div>
    </div>

    <!-- ECharts Container -->
    <div
      ref="chartContainerRef"
      class="tw:flex-1 tw:w-full"
      style="min-height: 300px; position: relative"
    ></div>

    <!-- Empty State -->
    <div
      v-if="!hasData"
      class="tw:absolute tw:inset-0 tw:flex tw:items-center tw:justify-center tw:bg-white"
      style="top: 60px"
    >
      <div class="tw:text-center tw:text-[var(--o2-text-secondary)]">
        <div class="tw:text-sm">No spans to display</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from "vue";
import * as echarts from "echarts";
import { type EnrichedSpan } from "@/types/traces/span.types";
import { formatDuration } from "@/composables/traces/useTraceProcessing";
import useTraces from "@/composables/useTraces";

// Props
interface Props {
  spans: EnrichedSpan[];
  selectedSpanId?: string | null;
  traceDuration: number;
}

const props = withDefaults(defineProps<Props>(), {
  selectedSpanId: null,
});

// Emits
const emit = defineEmits<{
  "span-selected": [spanId: string];
}>();

// Composables
const { searchObj } = useTraces();

// Refs
const chartContainerRef = ref<HTMLDivElement | null>(null);
let chartInstance: echarts.ECharts | null = null;

// State
const viewMode = ref<"time" | "percentage">("time");

// Constants
const BLOCK_PADDING = 2;
const MIN_BLOCK_WIDTH = 1;
const BLOCK_HEIGHT = 24; // 1rem (16px)

// Computed
const totalSpans = computed(() => props.spans.length);

const maxDepth = computed(() => {
  return Math.max(...props.spans.map((s) => s.depth), 0);
});

const hasData = computed(() => {
  return props.spans.length > 0 && props.traceDuration > 0;
});

// Build flame graph data for ECharts
const buildFlameGraphData = () => {
  const data: any[] = [];
  const traceDuration = props.traceDuration || 1;

  props.spans.forEach((span) => {
    const startPercent = (span.startOffsetMs / traceDuration) * 100;
    const durationPercent = (span.durationMs / traceDuration) * 100;

    // Only include if width is above minimum threshold
    if (durationPercent > 0.1) {
      data.push({
        value: [
          startPercent, // x position (percentage)
          span.depth, // y position (depth level)
          durationPercent, // width (percentage of trace)
          span.durationMs, // actual duration in ms
        ],
        itemStyle: {
          color: searchObj.meta.serviceColors[span.serviceName] || "#9CA3AF",
          borderColor: span.hasError ? "#EF4444" : "#ffffff",
          borderWidth: span.hasError ? 2 : 1,
        },
        emphasis: {
          itemStyle: {
            borderColor: "#2563EB",
            borderWidth: 3,
            shadowBlur: 10,
            shadowColor: "rgba(37, 99, 235, 0.5)",
          },
        },
        spanData: span,
      });
    }
  });

  return data;
};

// Initialize ECharts
const initChart = () => {
  if (!chartContainerRef.value) return;

  // Dispose existing instance if any
  if (chartInstance) {
    chartInstance.dispose();
  }

  chartInstance = echarts.init(chartContainerRef.value);

  const data = buildFlameGraphData();

  const option: echarts.EChartsOption = {
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(30, 41, 59, 0.95)",
      borderColor: "transparent",
      textStyle: {
        color: "#ffffff",
        fontSize: 12,
      },
      formatter: (params: any) => {
        const span = params.data.spanData as EnrichedSpan;
        const percentage = (
          (span.durationMs / props.traceDuration) *
          100
        ).toFixed(2);

        return `
          <div style="padding: 4px 0;">
            <div style="font-weight: bold; margin-bottom: 6px;">${span.operationName}</div>
            <div style="font-size: 11px; line-height: 1.6;">
              <div style="display: flex; justify-content: space-between; gap: 16px;">
                <span style="color: #cbd5e1;">Service:</span>
                <span>${span.serviceName}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 16px;">
                <span style="color: #cbd5e1;">Duration:</span>
                <span>${formatDuration(span.durationMs)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 16px;">
                <span style="color: #cbd5e1;">% of trace:</span>
                <span>${percentage}%</span>
              </div>
              ${span.hasError ? '<div style="color: #f87171; margin-top: 4px;">⚠ Has errors</div>' : ""}
            </div>
          </div>
        `;
      },
    },
    grid: {
      left: 10,
      right: 10,
      top: 10,
      bottom: 10,
      containLabel: false,
      height:
        maxDepth.value > 0
          ? maxDepth.value * (BLOCK_HEIGHT + BLOCK_PADDING) + BLOCK_HEIGHT
          : BLOCK_HEIGHT,
    },
    xAxis: {
      type: "value",
      min: 0,
      max: 100,
      show: false,
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      inverse: true,
      show: false,
    },
    series: [
      {
        type: "custom",
        renderItem: (params: any, api: any) => {
          const startX = api.value(0); // start percentage
          const depth = api.value(1); // depth level
          const width = api.value(2); // width percentage

          // Use coordinate system for x positioning (horizontal)
          const point1 = api.coord([startX, 0]);
          const point2 = api.coord([startX + width, 0]);

          const x = point1[0];
          // Calculate y position directly in pixels based on depth
          const y = depth * (BLOCK_HEIGHT + BLOCK_PADDING);
          const rectWidth = point2[0] - point1[0];

          return {
            type: "rect",
            shape: {
              x: x,
              y: y,
              width: Math.max(rectWidth, MIN_BLOCK_WIDTH),
              height: BLOCK_HEIGHT,
              r: 2,
            },
            style: api.style({
              fill: data[params.dataIndex].itemStyle.color,
              stroke: data[params.dataIndex].itemStyle.borderColor,
              lineWidth: data[params.dataIndex].itemStyle.borderWidth,
            }),
            emphasis: {
              style: {
                stroke: data[params.dataIndex].emphasis.itemStyle.borderColor,
                lineWidth:
                  data[params.dataIndex].emphasis.itemStyle.borderWidth,
                shadowBlur:
                  data[params.dataIndex].emphasis.itemStyle.shadowBlur,
                shadowColor:
                  data[params.dataIndex].emphasis.itemStyle.shadowColor,
              },
            },
            textContent:
              rectWidth > 40
                ? {
                    type: "text",
                    style: {
                      text: data[params.dataIndex].spanData.operationName,
                      fill: "#ffffff",
                      font: "11px Inter, sans-serif",
                      overflow: "truncate",
                      width: rectWidth - 8,
                    },
                  }
                : null,
            textConfig: {
              position: "inside",
              distance: 4,
            },
          };
        },
        data: data,
      },
    ],
  };

  chartInstance.setOption(option);

  // Handle click events
  chartInstance.on("click", (params: any) => {
    if (params.data && params.data.spanData) {
      emit("span-selected", params.data.spanData.span_id);
    }
  });
};

// Update chart when data changes
const updateChart = () => {
  if (!chartInstance || !hasData.value) return;

  const data = buildFlameGraphData();

  chartInstance.setOption(
    {
      yAxis: {
        max: maxDepth.value + 0.5,
      },
      series: [
        {
          data: data,
        },
      ],
    },
    { notMerge: false, lazyUpdate: false },
  );

  // Trigger resize to ensure proper dimensions
  nextTick(() => {
    chartInstance?.resize();
  });
};

// Handle window resize
const handleResize = () => {
  if (chartInstance) {
    chartInstance.resize();
  }
};

// Watchers
watch(
  [() => props.spans, () => props.traceDuration],
  () => {
    nextTick(() => {
      if (!chartInstance && hasData.value) {
        initChart();
      } else if (chartInstance) {
        updateChart();
      }
    });
  },
  { deep: true },
);

watch(
  () => props.selectedSpanId,
  (newSpanId) => {
    if (!chartInstance) return;

    // Highlight selected span
    const data = buildFlameGraphData();
    data.forEach((item) => {
      if (item.spanData.span_id === newSpanId) {
        item.itemStyle.borderColor = "#2563EB";
        item.itemStyle.borderWidth = 3;
      }
    });

    chartInstance.setOption({
      series: [{ data }],
    });
  },
);

// Lifecycle
onMounted(() => {
  nextTick(() => {
    if (!hasData.value) return;

    initChart();

    // Force resize in next tick to ensure proper dimensions
    nextTick(() => {
      handleResize();
    });
  });
});

onBeforeUnmount(() => {
  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
  }
});
</script>

<style scoped lang="scss">
.flame-graph-view {
  font-family:
    "Inter",
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}
</style>
