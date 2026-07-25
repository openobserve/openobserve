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
  VersionOverlayChart — two overlaid line series (A vs B) for version compare.
  Renders through the SAME `PanelSchemaRenderer` dashboards/LLM Insights use
  (see LLMSchemaPanel.vue), instead of a raw `echarts` instance, so the compare
  overlay inherits the shared renderer's theming, tooltip and legend for free.

  The two arms' points are already computed client-side by VersionCompareView
  (`toOverlayPoints`) — each arm's window has its own start time and possibly a
  different duration, and sparkline buckets carry no per-point timestamp, so
  the caller rebases both onto a shared axis (elapsed hours since rollout, or
  wall-clock when `mode === "sameWallClock"`) before they ever reach this
  component. That rebasing has no SQL/PromQL equivalent (dashboards have no
  "elapsed hours since two different start times" query), so there's no raw
  query for PanelSchemaRenderer to fire itself.
  DECISION: fall back to the renderer's pre-fetched-results injection path
  (`injectedPromqlData` on PanelSchemaRenderer / usePanelDataLoader) — despite
  the prop's name, that branch only cares that `data` holds one entry per
  query in the shape the query executor would have written; it does not
  branch on `queryType`. We hand it a `queryType: "sql"` panel (a breakdown
  line chart, x=ts/y=value/breakdown=series) with one synthetic row per point,
  the same technique MetricCardChart.vue uses for PromQL. This keeps a single
  standard renderer + real (value-type) axis; see `buildOverlaySchema` /
  `buildInjectedRows` below for the exact shape.

  `mode` controls the x-axis: "sinceRollout" plots elapsed hours since each
  version's rollout (so two windows that started at different wall-clock times
  overlay apples-to-apples); "sameWallClock" plots real time, for when A and B
  were literally concurrent.

  The schema/row builders are exported so specs can assert on the computed
  panel schema and injected rows without mounting a real chart / canvas.
-->
<template>
  <div class="h-full min-h-55 w-full" data-test="version-overlay-chart">
    <PanelSchemaRenderer
      :panel-schema="panelSchema"
      :selected-time-obj="selectedTimeObj"
      :variables-data="{}"
      :injected-promql-data="injectedData"
      :allow-annotations-add="false"
      :allow-annotations-a-p-i="false"
    />
  </div>
</template>

<script lang="ts">
export interface OverlayPoint {
  x: number;
  y: number;
}

export type OverlayMode = "sinceRollout" | "sameWallClock";

export interface BuildOverlaySchemaArgs {
  mode: OverlayMode;
  labelA: string;
  labelB: string;
  xAxisLabel: string;
}

/** Dashboard panel schema (version 2) for the two-series overlay. `queryType:
 *  "sql"` + a non-empty `query` string satisfies the renderer's
 *  `hasAtLeastOneQuery()` gate; `injectedPromqlData` then short-circuits the
 *  actual fetch (see file header). x is a value axis in "sinceRollout" mode
 *  (elapsed hours) and a time axis in "sameWallClock" mode. */
export function buildOverlaySchema(args: BuildOverlaySchemaArgs): any {
  const { mode, labelA, labelB, xAxisLabel } = args;
  return {
    version: 2,
    id: "version-overlay-chart",
    title: "",
    description: "",
    type: "line",
    config: {
      show_legends: true,
      legends_position: "bottom",
      unit: "custom",
      unit_custom: "",
      decimals: 2,
      connect_nulls: true,
      no_value_replacement: "",
      show_symbol: false,
      line_interpolation: "smooth",
      line_thickness: 2,
      axis_border_show: true,
      wrap_table_cells: false,
      base_map: { type: "osm" },
      map_view: { zoom: 1, lat: 0, lng: 0 },
      mark_line: [],
      color: {
        mode: "palette-classic",
        fixedColor: ["--color-accent", "--color-chart-series-6"],
        seriesBy: "last",
      },
    },
    queryType: "sql",
    queries: [
      {
        // Never executed — injectedPromqlData short-circuits the fetch. Kept
        // non-empty only so the renderer's "has at least one query" gate
        // doesn't short-circuit to the empty state instead.
        query: `-- injected: ${labelA} vs ${labelB}`,
        customQuery: true,
        vrlFunctionQuery: "",
        fields: {
          x: [{ alias: "x", column: "x", color: null, label: xAxisLabel }],
          y: [{ alias: "y", column: "y", color: null, label: "" }],
          z: [],
          breakdown: [{ alias: "series", column: "series", color: null, label: "" }],
          filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
          latitude: null,
          longitude: null,
          weight: null,
        },
        config: {
          promql_legend: "",
          layer_type: "scatter",
          weight_fixed: 1,
          limit: 0,
          min: 0,
          max: 100,
          time_shift: [],
        },
      },
    ],
  };
}

/** One injected row per data point, in the shape the SQL executor would have
 *  written to `state.data[0]` (a flat array of hit objects). */
export function buildInjectedRows(
  seriesA: OverlayPoint[],
  seriesB: OverlayPoint[],
  labelA: string,
  labelB: string,
): Array<{ x: number; y: number; series: string }> {
  return [
    ...seriesA.map((p) => ({ x: p.x, y: p.y, series: labelA })),
    ...seriesB.map((p) => ({ x: p.x, y: p.y, series: labelB })),
  ];
}
</script>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";

const props = defineProps<{
  seriesA: OverlayPoint[];
  seriesB: OverlayPoint[];
  mode: OverlayMode;
}>();

const { t } = useI18n();

const labelA = computed(() => t("aiObservability.overlayChart.seriesA"));
const labelB = computed(() => t("aiObservability.overlayChart.seriesB"));
const xAxisLabel = computed(() =>
  props.mode === "sinceRollout"
    ? t("aiObservability.overlayChart.xAxisSinceRollout")
    : t("aiObservability.overlayChart.xAxisWallClock"),
);

const panelSchema = computed(() =>
  buildOverlaySchema({
    mode: props.mode,
    labelA: labelA.value,
    labelB: labelB.value,
    xAxisLabel: xAxisLabel.value,
  }),
);

// PanelSchemaRenderer needs a Date-pair time range even though the injected
// data bypasses the fetch — an empty pair is enough since pin_x_axis_to_range
// isn't set here (the value/time axis auto-ranges to the injected rows).
const selectedTimeObj = { start_time: null, end_time: null };

const injectedData = computed(() => ({
  data: [buildInjectedRows(props.seriesA, props.seriesB, labelA.value, labelB.value)],
  metadata: { queries: [{ startTime: null, endTime: null }] },
  // 2D array [queryIndex][partitionIndex] — the SQL missing-value filler does
  // `resultMetaData[queryIndex]?.map(...)`, so each query's slot must be an
  // ARRAY (was `[{}]` → `{}.map` threw `resultMetaData?.map is not a function`).
  resultMetaData: [[]],
}));
</script>
