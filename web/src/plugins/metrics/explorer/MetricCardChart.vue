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

<!--
  A card's preview chart.

  Runs the preview response through the same PromQL -> ECharts converter the
  dashboards use, so a card renders exactly what the drilled-in panel will. The
  card-specific styling (fixed series colour by card index, 9% area fill, no
  legend) is applied to the converted options rather than forked into a second
  renderer.
-->
<template>
  <div ref="chartPanelRef" class="w-full h-full">
    <ChartRenderer
      v-if="chartData.options"
      :data="chartData"
      :height="height"
      @error="onChartError"
      @updated:data-zoom="$emit('zoom', $event)"
      @domcontextmenu="$emit('contextmenu', $event)"
    />
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type PropType,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import * as echarts from "echarts/core";
import { toZonedTime } from "date-fns-tz";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import { convertPromQLData } from "@/utils/dashboard/convertPromQLData";

/**
 * Extra left inset (px) for the y-axis label strip on a metric card, added
 * OUTSIDE ECharts' `containLabel` reservation. containLabel sizes the strip from
 * a text-width estimate that under-measures the rendered width by a few pixels,
 * pushing the widest labels past the card's left edge; this inset absorbs that.
 */
const Y_AXIS_LABEL_LEFT_INSET = 8;

export default defineComponent({
  name: "MetricCardChart",
  components: { ChartRenderer },
  props: {
    /** One PromQL query_range response per query in the effective variant. */
    results: { type: Array as PropType<any[]>, required: true },
    queries: { type: Array as PropType<any[]>, required: true },
    chartType: { type: String, default: "line" },
    unit: { type: String, default: null },
    unitCustom: { type: String, default: null },
    bucketUnit: { type: String, default: null },
    bucketUnitCustom: { type: String, default: null },
    color: { type: String, required: true },
    height: { type: String, default: "100%" },
    /**
     * The window these results were queried for, in MICROSECONDS — the same unit
     * the grid holds it in. Without it the time axis is whatever ECharts infers
     * from the data, which is not the window the user picked. See `pinTimeAxis`.
     */
    timeRange: {
      type: Object as PropType<{ start_time: number; end_time: number }>,
      default: null,
    },
  },
  /**
   * `zoom` carries ECharts' `{start, end}` (epoch ms) from a drag-select on the
   * chart.
   *
   * Not emitted for the heatmap: its x-axis is categorical (one column per
   * bucket), so the converter withholds the toolbox there anyway.
   *
   * `contextmenu` carries ChartRenderer's `{x, y, value}` from a right-click on a
   * data point — the same event PanelSchemaRenderer turns into Create Alert.
   * ChartRenderer only fires it for line/bar series, so a heatmap card is
   * naturally excluded (a bucket count is not an alert threshold).
   */
  emits: ["error", "zoom", "contextmenu"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const chartPanelRef = ref(null);
    const chartData = ref<any>({ options: null });

    /**
     * Decimal places that keep the axis readable at the data's magnitude.
     *
     * The shared formatter applies no magnitude scaling to `numbers`/`custom`
     * units, so a rate of 0.004 c/s renders as a column of identical "0.00"
     * ticks at the default 2 decimals. Scaling the precision to the series keeps
     * the axis readable.
     */
    const adaptiveDecimals = () => {
      let max = 0;
      for (const response of props.results ?? []) {
        for (const series of response?.result ?? []) {
          for (const [, raw] of series?.values ?? []) {
            const v = Math.abs(parseFloat(raw));
            if (Number.isFinite(v) && v > max) max = v;
          }
        }
      }
      if (max === 0) return 2;
      if (max < 0.001) return 6;
      if (max < 0.01) return 5;
      if (max < 0.1) return 4;
      if (max < 1) return 3;
      return 2;
    };

    /**
     * A minimal panel schema. It is the same shape the drill-in hands to the
     * editor, which is what keeps "what you click is what you get" true.
     */
    const buildPanelSchema = () => ({
      id: "metrics-explorer-card",
      type: props.chartType,
      queryType: "promql",
      queries: props.queries.map((q: any) => ({
        query: q.expr,
        customQuery: true,
        fields: { stream_type: "metrics" },
        config: { promql_legend: q.legendTemplate ?? "" },
      })),
      config: {
        unit: props.unit,
        unit_custom: props.unitCustom,
        decimals: adaptiveDecimals(),
        show_legends: false,
        // Gridlines make a small chart readable — without them a sparkline is
        // just a shape. The heatmap is solid colour, so they'd only add noise
        // there; it opts out below.
        show_gridlines: props.chartType !== "heatmap",
        show_symbol: false,
        line_interpolation: "smooth",
        line_thickness: 1.5,
        color: { mode: "fixed", fixedColor: [props.color] },
        // Activates the classic-histogram transform (le-sort + de-accumulate).
        // Without it a cumulative-bucket heatmap renders as nonsense.
        ...(props.chartType === "heatmap"
          ? {
              heatmap_mode: "prometheus_histogram",
              bucket_unit: props.bucketUnit,
              bucket_unit_custom: props.bucketUnitCustom,
            }
          : {}),
      },
    });

    /**
     * Pins the time axis to the window the data was QUERIED for.
     *
     * `convertPromQLData` sets `xAxis.min`/`max` only while a panel is streaming;
     * a settled chart is left to ECharts, which scales the axis to the data it was
     * given. A card with very few points (a sparsely-scraped metric can return
     * ONE) makes ECharts invent a span of its own — widened out to about two days
     * — so the axis disagrees with the picker. State the known window instead.
     * This also keeps every card spanning the same window, so a spike at the same
     * x is the same moment.
     *
     * Not applied to the heatmap: its x-axis is categorical (one column per
     * bucket), so a time min/max means nothing there.
     */
    const pinTimeAxis = (options: any) => {
      const range = props.timeRange;
      if (!range?.start_time || !range?.end_time) return;
      if (props.chartType === "heatmap") return;

      const axis = options.xAxis;
      if (!axis || Array.isArray(axis) || axis.type !== "time") return;

      // µs to ms, then into the same coordinate space the converter puts the
      // series timestamps in — a zoned Date, or a zoneless ISO string for UTC.
      const toAxisValue = (microseconds: number) => {
        const ms = microseconds / 1000;
        return store.state.timezone !== "UTC"
          ? toZonedTime(ms, store.state.timezone)
          : new Date(ms).toISOString().slice(0, -1);
      };

      axis.min = toAxisValue(range.start_time);
      axis.max = toAxisValue(range.end_time);
    };

    /**
     * `render` awaits the converter, and the watcher below fires it on every
     * prop change — so two renders can be in flight at once, and without this
     * the SLOWER, staler one paints last. Only the newest may write.
     */
    let renderSeq = 0;

    const render = async () => {
      const seq = ++renderSeq;
      if (!props.results?.length) {
        chartData.value = { options: null };
        return;
      }
      try {
        const converted: any = await convertPromQLData(
          buildPanelSchema(),
          props.results,
          store,
          chartPanelRef,
          ref(null), // hoveredSeriesState — cards have no cross-panel hover
          [], // annotations
        );

        if (seq !== renderSeq) return;

        const options = converted?.options;
        if (options) {
          // The card clips its content (`overflow-hidden`, fixed height), and
          // ECharts renders its tooltip INSIDE the chart container by default —
          // so a tooltip near an edge was being sliced off at the card boundary.
          // Portal it to <body> so it can overflow the card, and confine it to
          // the viewport so it never runs off screen either.
          options.tooltip = {
            ...(options.tooltip ?? {}),
            appendToBody: true,
            confine: true,
          };

          pinTimeAxis(options);

          if (props.chartType !== "heatmap") {
            // ECharts `containLabel` reserves the y-axis label strip from its own
            // text-width ESTIMATE, which under-measures the actually-rendered
            // width by a few pixels. On these small cards that shortfall pushes
            // the widest labels ~3px past the left edge, clipping their first
            // character (measured: "700.00c/s" rendered at x=-2). A small extra
            // left inset absorbs the estimate error so labels never touch the
            // edge. Applied only to the metric cards, not the shared converter,
            // so dashboards keep their existing layout.
            const grid = Array.isArray(options.grid)
              ? options.grid[0]
              : options.grid;
            if (grid) {
              // `left` is added OUTSIDE the containLabel reservation, so this is
              // pure breathing room. 8 clears the measured ~3px overhang with
              // margin to spare, without visibly shrinking the plot.
              grid.left = Y_AXIS_LABEL_LEFT_INSET;
            }
          }

          if (props.chartType === "heatmap") {
            // Keep the colour bar — without it the cells are just colours with
            // no scale. Sized down and pinned under the axis so it doesn't
            // overlap the plot.
            if (options.visualMap) {
              options.visualMap = {
                ...options.visualMap,
                show: true,
                orient: "horizontal",
                left: "center",
                bottom: 0,
                itemWidth: 10,
                itemHeight: 90,
                precision: 2,
                textStyle: { fontSize: 9 },
              };
              // Room for the bar, below the x-axis labels.
              options.grid = { ...(options.grid ?? {}), bottom: 26 };
            }
            for (const series of options.series ?? []) {
              series.label = { ...(series.label ?? {}), show: false };
            }
            // Thin the bucket labels to what a card can actually render, but
            // ALWAYS keep the top row. A histogram's `+Inf` bucket is the one
            // that says "and everything slower than this", and ECharts'
            // `hideOverlap` would otherwise drop it.
            if (options.yAxis) {
              const rowCount = options.yAxis.data?.length ?? 0;
              const step = Math.max(1, Math.ceil(rowCount / 8));
              options.yAxis.axisLabel = {
                ...(options.yAxis.axisLabel ?? {}),
                fontSize: 9,
                width: 46,
                overflow: "truncate",
                hideOverlap: false,
                // Count DOWN from the top row, so `+Inf` is always labelled and
                // the spacing stays even.
                interval: (index: number) =>
                  (rowCount - 1 - index) % step === 0,
              };
            }
            if (options.xAxis) {
              options.xAxis.axisLabel = {
                ...(options.xAxis.axisLabel ?? {}),
                fontSize: 9,
                hideOverlap: true,
              };
            }
          }
        }
        chartData.value = converted ?? { options: null };
      } catch (error: any) {
        if (seq !== renderSeq) return;
        chartData.value = { options: null };
        emit("error", error?.message ?? t("metrics.metricCardChart.failedToRenderChart"));
      }
    };

    const onChartError = (error: any) => emit("error", error);

    /**
     * Keep the canvas in step with the card.
     *
     * ChartRenderer only re-lays-out on a WINDOW resize, but a card changes
     * width without one — opening a rail panel, or the column count changing on
     * a container resize. The canvas would keep its old size and the chart would
     * sit stretched or clipped inside it. So watch the card itself and resize
     * the ECharts instance ChartRenderer initialized on its own root.
     */
    let resizeObserver: ResizeObserver | null = null;

    onMounted(() => {
      if (!chartPanelRef.value || typeof ResizeObserver === "undefined") return;
      resizeObserver = new ResizeObserver(() => {
        const host = (
          chartPanelRef.value as unknown as HTMLElement
        )?.querySelector('[data-test="chart-renderer"]');
        if (host) echarts.getInstanceByDom(host as HTMLElement)?.resize();
      });
      resizeObserver.observe(chartPanelRef.value as unknown as HTMLElement);
    });

    onBeforeUnmount(() => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    });

    // Everything `render` reads.
    watch(
      () => [
        props.results,
        props.queries,
        props.chartType,
        props.color,
        props.unit,
        props.unitCustom,
        props.bucketUnit,
        props.bucketUnitCustom,
        props.timeRange,
      ],
      render,
      { immediate: true, deep: false },
    );

    return { chartPanelRef, chartData, onChartError };
  },
});
</script>
