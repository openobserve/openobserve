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

  Renders the preview response through the SAME component a dashboard panel uses
  (PanelSchemaRenderer), so a card draws exactly what the drilled-in panel will.
  The results are already fetched — the metrics explorer's preview queue owns the
  fetch lifecycle (concurrency-capped, viewport-gated, cancellable, cached) — so
  they are handed to the panel via `injectedPromqlData` instead of letting it
  fire its own query. The card-specific look (fixed colour, no legend, pinned
  axis) is expressed as panel config the shared converter already understands.
-->
<template>
  <div ref="chartPanelRef" class="w-full h-full" :style="{ height }">
    <PanelSchemaRenderer
      :panel-schema="panelSchema"
      :selected-time-obj="selectedTimeObj"
      :variables-data="variablesData"
      :injected-promql-data="injectedPromqlData"
      :allow-alert-creation="allowAlertCreation"
      :allow-annotations-add="false"
      :allow-annotations-a-p-i="false"
      @error="onPanelError"
      @updated:data-zoom="$emit('zoom', $event)"
    />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from "vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";

export default defineComponent({
  name: "MetricCardChart",
  components: { PanelSchemaRenderer },
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
     * the grid holds it in. Handed to the panel as the time range AND (via the
     * `pin_x_axis_to_range` config) the range the x-axis is pinned to, so a
     * sparsely-scraped metric with a single point does not auto-range into a
     * ~two-day axis.
     */
    timeRange: {
      type: Object as PropType<{ start_time: number; end_time: number }>,
      default: null,
    },
    /**
     * Opt in to the panel's right-click → Create Alert menu. On for a real
     * explorer card; off for a function-config preview tile, which is not a
     * place to author an alert.
     */
    allowAlertCreation: { type: Boolean, default: false },
  },
  /**
   * `zoom` carries the panel's `updated:data-zoom` payload (a drag-select on the
   * chart). `error` carries a conversion/render failure message so the card can
   * show its error tile — the query itself already succeeded (these are already
   * fetched results), so this is a render-time failure only.
   */
  emits: ["error", "zoom"],
  setup(props, { emit }) {
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
     * The panel schema. The same shape the drill-in hands the editor, which is
     * what keeps "what you click is what you get" true. `type` is fixed from the
     * card's resolved variant (metadata-driven, never inferred from the data).
     */
    const panelSchema = computed(() => ({
      id: "metrics-explorer-card",
      title: "",
      type: props.chartType,
      queryType: "promql",
      queries: (props.queries ?? []).map((q: any) => ({
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
        // just a shape. The heatmap is solid colour, so they'd only add noise.
        show_gridlines: props.chartType !== "heatmap",
        show_symbol: false,
        connect_nulls: true,
        line_interpolation: "smooth",
        line_thickness: 1.5,
        color: { mode: "fixed", fixedColor: [props.color] },
        // Injected data is never "loading", so the converter would auto-range
        // the x-axis; pin it to the queried window instead. See `timeRange`.
        pin_x_axis_to_range: true,
        // Activates the classic-histogram transform (le-sort + de-accumulate)
        // and the card-sized heatmap look (small colour bar, thinned bucket
        // labels, no top gap). Without them a cumulative-bucket heatmap renders
        // as nonsense on a full-size layout that swamps a card.
        ...(props.chartType === "heatmap"
          ? {
              heatmap_mode: "prometheus_histogram",
              compact_preview: true,
              bucket_unit: props.bucketUnit,
              bucket_unit_custom: props.bucketUnitCustom,
            }
          : {}),
      },
    }));

    /** The queried window as the Date pair PanelSchemaRenderer expects. */
    const selectedTimeObj = computed(() => {
      const range = props.timeRange;
      if (!range?.start_time || !range?.end_time) {
        return { start_time: null, end_time: null };
      }
      return {
        start_time: new Date(range.start_time / 1000),
        end_time: new Date(range.end_time / 1000),
      };
    });

    /**
     * The already-fetched results, handed to the panel so it renders WITHOUT
     * firing its own query. `metadata` carries the queried window (µs) so the
     * converter's `pin_x_axis_to_range` has a range to pin to.
     */
    const injectedPromqlData = computed(() => {
      if (!props.results?.length) return undefined;
      const range = props.timeRange;
      return {
        data: props.results,
        metadata: {
          queries: [
            {
              startTime: range?.start_time,
              endTime: range?.end_time,
            },
          ],
        },
      };
    });

    /**
     * Stable empty variables object. The card substitutes no variables, and the
     * injected-data path skips the variable wait anyway — but the prop is
     * required, so keep one identity to avoid churning the panel's watcher.
     */
    const variablesData = {};

    /**
     * The panel emits an error object `{ message }`; forward only the message,
     * and only when there is one (it also fires with an empty message to RESET
     * the parent's error, which the card handles by clearing on new results).
     */
    const onPanelError = (error: any) => {
      const message = error?.message ?? error;
      if (message) emit("error", String(message));
    };

    return {
      panelSchema,
      selectedTimeObj,
      injectedPromqlData,
      variablesData,
      onPanelError,
    };
  },
});
</script>
