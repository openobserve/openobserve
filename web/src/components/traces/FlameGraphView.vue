<!--
  FlameGraphView - Flame graph visualization using ECharts
  Displays spans as hierarchical blocks where width = duration
-->
<template>
  <div
    class="flame-graph-view tw:flex tw:flex-col tw:h-full tw:bg-white tw:w-full tw:bg-[var(--o2-card-bg)]!"
    style="min-height: 400px; height: 100%"
  >
    <!-- Upper area: controls + ruler + chart -->
    <div class="tw:flex tw:flex-col tw:flex-1" style="min-height: 0">
      <!-- Controls Bar -->
      <div
        class="tw:px-6 tw:py-3 tw:border-b tw:border-[var(--o2-border)] tw:flex tw:items-center tw:justify-between tw:bg-[var(--o2-card-bg)]!"
      >
        <div class="tw:flex tw:items-center tw:space-x-4">
          <div
            class="tw:text-xs tw:font-bold tw:text-[var(--o2-text-secondary)]"
          >
            <span class="tw:text-[var(--o2-text-primary)]">{{ totalSpans }}</span>
            spans
            <span class="tw:mx-2">•</span>
            <span class="tw:text-[var(--o2-text-primary)]">{{ maxDepth }}</span>
            depth
          </div>
        </div>
      </div>

      <!-- Ruler + chart: outer flex column, mousemove for cursor badge on ruler -->
      <div
        data-test="flame-graph-view-chart-wrapper"
        class="tw:flex tw:flex-col tw:flex-1"
        style="min-height: 0"
        @mousemove="handleChartMouseMove"
        @mouseleave="cursorVisible = false"
      >
        <!-- Timeline Ruler — stays fixed above the scrollable chart -->
        <div
          class="tw:relative tw:bg-[var(--o2-card-bg)] tw:select-none tw:flex-shrink-0"
          style="height: 1.5rem"
        >
          <!-- Static tick labels -->
          <span
            v-for="(tick, index) in timelineTicks"
            :key="'lbl-' + index"
            class="tw:absolute tw:text-[10px] tw:text-[var(--o2-text-secondary)] tw:leading-none tw:whitespace-nowrap"
            style="top: 50%; padding-left: 3px"
            :style="{ left: tick.left, transform: tick.transform }"
            >{{ tick.label }}</span
          >

          <!-- Static tick marks — skip first and last -->
          <template
            v-for="(tick, index) in timelineTicks"
            :key="'tic-' + index"
          >
            <div
              v-if="index > 0 && index < timelineTicks.length - 1"
              class="tw:absolute tw:w-px"
              style="bottom: 0; height: 100%; background: #aaa"
              :style="{ left: tick.left, transform: 'translateX(-50%)' }"
            ></div>
          </template>

          <!-- Cursor time badge with downward arrow -->
          <div
            v-if="cursorVisible"
            class="tw:absolute tw:pointer-events-none tw:flex tw:flex-col tw:items-center"
            style="top: 2px; z-index: 20; transform: translateX(-50%)"
            :style="{ left: cursorX + 'px' }"
          >
            <div
              class="tw:text-[10px] tw:text-white tw:px-[6px] tw:py-[2px] tw:rounded tw:whitespace-nowrap tw:font-medium"
              style="background: rgba(30, 30, 30, 0.9); line-height: 1.4"
            >
              {{ cursorTimeLabel }}
            </div>
            <div
              style="
                width: 0;
                height: 0;
                border-left: 4px solid transparent;
                border-right: 4px solid transparent;
                border-top: 5px solid rgba(30, 30, 30, 0.9);
                margin-top: 0;
              "
            ></div>
          </div>
        </div>

        <!-- Scrollable chart area: grows to fit all rows, scrolls vertically -->
        <div
          ref="chartScrollRef"
          class="tw:flex-1 tw:overflow-y-auto tw:relative"
          style="min-height: 0"
        >
          <div
            :style="{
              height: chartContentHeight + 'px',
              minHeight: '100%',
              position: 'relative',
            }"
          >
            <ChartRenderer
              v-if="hasData"
              :data="chartData"
              style="height: 100%; width: 100%"
              @click="handleChartClick"
            />

            <!-- Vertical cursor line -->
            <div
              v-if="cursorVisible"
              class="tw:absolute tw:top-0 tw:bottom-0 tw:pointer-events-none"
              style="
                width: 1px;
                background: rgba(80, 80, 80, 0.6);
                z-index: 10;
              "
              :style="{ left: cursorX + 'px' }"
            ></div>
          </div>
        </div>
      </div>

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

    <!-- Resize handle -->
    <div
      v-if="sidebarVisible"
      class="tw:h-1 tw:cursor-row-resize tw:bg-[var(--o2-border)] hover:tw:bg-[var(--o2-primary-color)] tw:flex-shrink-0 tw:transition-colors"
      style="min-height: 4px"
      data-test="flame-graph-resizer"
      @mousedown="startResize"
    ></div>

    <!-- Bottom panel: Trace Details Sidebar -->
    <div
      v-if="sidebarVisible"
      data-test="trace-details-flame-graph-sidebar"
      class="tw:border-t tw:border-t-solid tw:border-t-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)]! tw:flex-shrink-0 tw:overflow-hidden"
      :style="{ height: bottomPanelHeight + 'px' }"
    >
      <TraceDetailsSidebar
        :span="selectedSpan"
        :base-trace-position="baseTracePosition"
        :search-query="searchQuery"
        :stream-name="streamName"
        :service-streams-enabled="serviceStreamsEnabled"
        :parent-mode="parentMode"
        :active-tab="sidebarActiveTab"
        @view-logs="$emit('view-logs')"
        @close="closeSidebar"
        @select-span="handleSelectSpan"
        @open-trace="$emit('open-trace')"
        @add-filter="(payload: any) => $emit('add-filter', payload)"
        @apply-filter-immediately="(payload: any) => $emit('apply-filter-immediately', payload)"
        @update:active-tab="sidebarActiveTab = $event as string"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineAsyncComponent, nextTick, watch } from "vue";
import useResizer from "@/composables/useResizer";
import { type EnrichedSpan } from "@/ts/interfaces/traces/span.types";
import { formatDuration } from "@/composables/traces/useTraceProcessing";
import useTraces from "@/composables/useTraces";
import { escapeHtml } from "@/utils/html";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const TraceDetailsSidebar = defineAsyncComponent(
  () => import("@/plugins/traces/TraceDetailsSidebar.vue")
);

// Props
interface Props {
  spans: EnrichedSpan[];
  selectedSpanId?: string | null;
  traceDuration: number;
  spanMap: Record<string, any>;
  streamName: string;
  searchQuery: string;
  parentMode: string;
  serviceStreamsEnabled: boolean;
  baseTracePosition: any;
}

const props = withDefaults(defineProps<Props>(), {
  selectedSpanId: null,
  streamName: "",
  searchQuery: "",
  parentMode: "standalone",
  serviceStreamsEnabled: false,
  spanMap: () => ({}),
  baseTracePosition: () => ({}),
});

// Emits
const emit = defineEmits<{
  "view-logs": [];
  close: [];
  "select-span": [spanId: string];
  "add-filter": [payload: { field: string; value: string; operator: "=" | "!=" }];
  "apply-filter-immediately": [
    payload: { field: string; value: string; operator: "=" | "!=" },
  ];
  "open-trace": [];
}>();

// Composables
const { searchObj } = useTraces();

// State
const cursorVisible = ref(false);
const cursorX = ref(0);
const cursorTimeLabel = ref("");
const sidebarVisible = ref(false);
const sidebarActiveTab = ref("attributes");
const {
  value: bottomPanelHeight,
  onMouseDown: startResize,
} = useResizer({
  direction: "vertical",
  initialValue: 360,
  minValue: 200,
  maxValue: window.innerHeight * 0.7,
  unit: "px",
  throttleMs: 50,
  invert: true,
});
const chartScrollRef = ref<HTMLElement | null>(null);

// Constants
const BLOCK_PADDING = 2;
const MIN_BLOCK_WIDTH = 1;
const BLOCK_HEIGHT = 24;

const GRID_LEFT = 10;
const GRID_RIGHT = 10;

// Computed
const totalSpans = computed(() => props.spans.length);

const maxDepth = computed(() => {
  return Math.max(...props.spans.map((s) => s.depth), 0);
});

const hasData = computed(() => {
  return props.spans.length > 0 && props.traceDuration > 0;
});

const timelineTicks = computed(() => {
  const duration = props.traceDuration || 0;
  const totalPad = GRID_LEFT + GRID_RIGHT;
  return [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    label: formatDuration(duration * fraction),
    left: `calc(${GRID_LEFT}px + ${fraction} * (100% - ${totalPad}px))`,
    transform:
      fraction === 1
        ? "translateX(-100%) translateY(-50%)"
        : "translateY(-50%)",
  }));
});

// Selected span lookup from spanMap
const selectedSpan = computed(() => {
  if (!props.selectedSpanId) return null;
  return props.spanMap[props.selectedSpanId] ?? null;
});

// Assigns a collision-free visual row to each span using a tree-aware DFS.
//
// Children are always placed starting one row below their parent's *visual* row
// (not their tree depth). This ensures that when parallel siblings are bumped to
// different rows due to time overlap, their subtrees remain contiguous and do not
// interleave with each other.
const computeVisualRows = (
  spans: EnrichedSpan[],
): { rowMap: Map<string, number>; maxRow: number } => {
  // Build parent→children map from parent_span_id
  const spanIds = new Set(spans.map((s) => s.span_id));
  const childrenMap = new Map<string, EnrichedSpan[]>();
  const roots: EnrichedSpan[] = [];

  for (const span of spans) {
    if (span.parent_span_id && spanIds.has(span.parent_span_id)) {
      if (!childrenMap.has(span.parent_span_id))
        childrenMap.set(span.parent_span_id, []);
      childrenMap.get(span.parent_span_id)!.push(span);
    } else {
      roots.push(span);
    }
  }

  const rowOccupancy: Array<Array<{ start: number; end: number }>> = [];
  const rowMap = new Map<string, number>();
  let maxRow = 0;

  // Recursively place a span at the first non-overlapping row >= minRow,
  // then place its children starting at chosenRow + 1.
  const place = (span: EnrichedSpan, minRow: number): void => {
    const spanStart = span.startOffsetMs;
    const spanEnd = span.startOffsetMs + span.durationMs;
    let candidate = minRow;

    while (true) {
      const occupants = rowOccupancy[candidate];
      if (!occupants) break;
      const overlaps = occupants.some(
        (o) => spanStart < o.end && o.start < spanEnd,
      );
      if (!overlaps) break;
      candidate++;
    }

    rowMap.set(span.span_id, candidate);
    if (!rowOccupancy[candidate]) rowOccupancy[candidate] = [];
    rowOccupancy[candidate].push({ start: spanStart, end: spanEnd });
    if (candidate > maxRow) maxRow = candidate;

    // Children always start directly below this span's visual row.
    const children = (childrenMap.get(span.span_id) ?? []).sort(
      (a, b) => a.startOffsetMs - b.startOffsetMs,
    );
    for (const child of children) {
      place(child, candidate + 1);
    }
  };

  // Process roots sorted by depth then start time; use tree depth as the
  // initial minRow so the conventional flame graph indentation is preserved.
  roots
    .sort((a, b) => a.depth - b.depth || a.startOffsetMs - b.startOffsetMs)
    .forEach((root) => place(root, root.depth));

  return { rowMap, maxRow };
};

// O(n log n) layout — only re-runs when spans change, not on selection changes
const visualLayout = computed(() => computeVisualRows(props.spans));

// Build flame graph series data, incorporating selected span highlighting
const flameGraphDataAndDepth = computed(() => {
  const data: any[] = [];
  const traceDuration = props.traceDuration || 1;

  const { rowMap, maxRow } = visualLayout.value;

  props.spans.forEach((span) => {
    const startPercent = (span.startOffsetMs / traceDuration) * 100;
    let durationPercent = (span.durationMs / traceDuration) * 100;

    // Spans with durationPercent less than 0.1% are invisble in chart
    // Added min 0.1% durationPercent
    if (durationPercent < 0.1) durationPercent = 0.1;

    const visualRow = rowMap.get(span.span_id) ?? span.depth;
    const isSelected = span.span_id === props.selectedSpanId;
    data.push({
      value: [
        startPercent, // x position (percentage)
        visualRow, // y position (collision-free visual row)
        durationPercent, // width (percentage of trace)
        span.durationMs, // actual duration in ms
      ],
      itemStyle: {
        color: searchObj.meta.serviceColors[span.serviceName] || "#9CA3AF",
        borderColor: isSelected
          ? "#2563EB"
          : span.hasError
            ? "#EF4444"
            : "#ffffff",
        borderWidth: isSelected ? 3 : span.hasError ? 2 : 1,
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
  });

  return { data, maxRow };
});

const chartOptions = computed(() => {
  const { data, maxRow } = flameGraphDataAndDepth.value;

  return {
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
            <div style="font-weight: bold; margin-bottom: 6px;">${escapeHtml(span.operationName)}</div>
            <div style="font-size: 11px; line-height: 1.6;">
              <div style="display: flex; justify-content: space-between; gap: 16px;">
                <span style="color: #cbd5e1;">Service:</span>
                <span>${escapeHtml(span.serviceName)}</span>
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
        maxRow > 0
          ? maxRow * (BLOCK_HEIGHT + BLOCK_PADDING) + BLOCK_HEIGHT
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

          const point1 = api.coord([startX, 0]);
          const point2 = api.coord([startX + width, 0]);

          const x = point1[0];
          const y = depth * (BLOCK_HEIGHT + BLOCK_PADDING);
          const rectWidth = point2[0] - point1[0];

          return {
            type: "rect",
            shape: {
              x,
              y,
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
        data,
      },
    ],
  };
});

const chartData = computed(() => ({
  options: chartOptions.value,
  notMerge: false,
  lazyUpdate: true,
}));

// Height of the chart canvas — enough to show all rows without clipping
const chartContentHeight = computed(() => {
  const { maxRow } = flameGraphDataAndDepth.value;
  const gridH =
    maxRow > 0
      ? maxRow * (BLOCK_HEIGHT + BLOCK_PADDING) + BLOCK_HEIGHT
      : BLOCK_HEIGHT;
  return gridH + 20; // 20 = grid.top(10) + grid.bottom(10)
});

// Cursor line handler
const handleChartMouseMove = (event: any) => {
  if (!hasData.value) return;

  const rect = event.currentTarget.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const gridWidth = rect.width - GRID_LEFT - GRID_RIGHT;
  const fraction = Math.max(
    0,
    Math.min(1, (offsetX - GRID_LEFT) / gridWidth),
  );

  cursorX.value = offsetX;
  cursorTimeLabel.value = formatDuration(fraction * props.traceDuration);
  cursorVisible.value = true;
};

// Scroll the chart to make a span visible
const scrollToSpan = (spanId: string) => {
  const row = visualLayout.value.rowMap.get(spanId);
  if (row === undefined || !chartScrollRef.value) return;
  const yPos = row * (BLOCK_HEIGHT + BLOCK_PADDING);
  chartScrollRef.value.scrollTop = yPos;
};

// Handle click events from ChartRenderer
const handleChartClick = (params: any) => {
  if (params.data?.spanData) {
    emit("select-span", params.data.spanData.span_id);
    sidebarVisible.value = true;
    nextTick(() => scrollToSpan(params.data.spanData.span_id));
  }
};

// Close the bottom sidebar
const closeSidebar = () => {
  sidebarVisible.value = false;
  emit("close");
};

// Handle span selection from within the sidebar (e.g., clicking a link)
const handleSelectSpan = (spanId: string) => {
  nextTick(() => scrollToSpan(spanId));
  emit("select-span", spanId);
};

// Watch for external selectedSpanId clear (e.g., closeSidebar in parent)
watch(
  () => props.selectedSpanId,
  (newVal) => {
    if (!newVal) {
      sidebarVisible.value = false;
    }
  },
);

// Resizer is now handled by useResizer composable

</script>

<style scoped lang="scss">
</style>
