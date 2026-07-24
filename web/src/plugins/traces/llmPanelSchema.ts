// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Build a **dashboard panel schema** (version 2) from an LLM Insights panel
 * definition, so the panel can render through the shared
 * `PanelSchemaRenderer` (the same engine dashboards use). This gives the LLM
 * Insights trends the same behaviour as dashboards — timezone conversion,
 * tooltips, axes, legends, units, lazy-loading and error states.
 *
 * The query is passed as a fully-rendered **custom SQL** string
 * (`customQuery: true`); the renderer fetches its own data. Column→axis
 * mapping is derived from the panel def's `query.timeField` / `seriesField`
 * / `valueField`, so the SQL output aliases (`ts`, `model`, `cost`, …) line
 * up with `fields.x/y/breakdown`.
 *
 * Only panel types present in `TYPE_MAP` are convertible.
 */

import type { LLMPanelDef } from "./config/llmInsightsPanels";

/** Our internal panel type → dashboard chart type id (see ChartSelection.vue). */
const TYPE_MAP: Record<string, string> = {
  "stacked-area": "area-stacked",
  "stacked-bar": "stacked",
  "horizontal-bar": "h-bar",
};

/** Panel types this builder can render through PanelSchemaRenderer today. */
export function isSchemaConvertible(panel: LLMPanelDef): boolean {
  return panel.type in TYPE_MAP;
}

interface AxisField {
  alias: string;
  column: string;
  color: string | null;
  label: string;
}

function axisField(name: string, label: string): AxisField {
  return { alias: name, column: name, color: null, label };
}

export function buildLLMPanelSchema(opts: {
  panel: LLMPanelDef;
  /** Fully rendered SQL (placeholders substituted, agent filter spliced). */
  sql: string;
  stream: string;
  streamType?: string;
}): any {
  const { panel, sql, stream, streamType = "traces" } = opts;
  const { timeField, seriesField, valueField, valueFormat, seriesLabel } = panel.query;

  // Single-series panels (no breakdown) use the non-stacked "area" variant.
  // An "area-stacked" panel with no breakdown renders its legend as "(empty)"
  // — getYAxisLabel forces breakdown-value series names for area-stacked, and
  // an absent breakdown value is "". With "area" + no breakdown the legend
  // falls back to the y-field label (e.g. "errors") instead.
  const chartType =
    panel.type === "stacked-area"
      ? seriesField
        ? "area-stacked"
        : "area"
      : panel.type === "stacked-bar"
        ? seriesField
          ? "stacked"
          : "bar"
        : (TYPE_MAP[panel.type] ?? "line");

  // Field roles differ by panel shape:
  //  - trends (stacked-area / stacked-bar): time on X, series field = BREAKDOWN.
  //  - bars (horizontal-bar): the series field (e.g. model) is the X category
  //    and there is no breakdown (a single fixed-color series of bars).
  const isHBar = panel.type === "horizontal-bar";
  const xFieldName = isHBar ? seriesField : timeField;
  const breakdownName = isHBar ? undefined : seriesField;

  return {
    version: 2,
    id: `llm-${panel.id}`,
    // Titles render in our own card header above the renderer, so keep the
    // panel's internal title empty to avoid a duplicated heading.
    title: "",
    description: "",
    type: chartType,
    config: {
      // Legend only when there's more than one series; single-series panels are
      // already labelled by their axis + title.
      show_legends: !!breakdownName || (panel.series?.length ?? 0) > 1,
      legends_position: "bottom",
      // "numbers" → compact K/M/B/T suffixes (3.5M); "milliseconds" → ms/s/m
      // (65.3 s); cost → currency-dollar ($). "short" is NOT a valid OO unit and
      // silently falls through to the raw value (3500000.00).
      unit:
        valueFormat === "cost"
          ? "currency-dollar"
          : valueFormat === "latency-ms"
            ? "milliseconds"
            : "numbers",
      unit_custom: "",
      decimals: 2,
      // Bucket gaps read as a continued line rather than a hole.
      connect_nulls: true,
      no_value_replacement: "",
      // Render a dot at each data point. LLM traffic is often sparse — a window
      // can have a single active bucket, and a line/area with no symbol can't
      // draw a lone point (it'd be invisible). Symbols make single-bucket
      // windows show up as a dot. (`show_symbol` → echarts `showSymbol`.)
      show_symbol: true,
      // Smooth connectors between points. Only affects line/area panels; bar
      // panels ignore it.
      line_interpolation: "smooth",
      // Slightly thicker line than the 1.5 default.
      line_thickness: 2.5,
      axis_border_show: true,
      wrap_table_cells: false,
      base_map: { type: "osm" },
      map_view: { zoom: 1, lat: 0, lng: 0 },
      mark_line: [],
      // Color: grouped-bar panels pin one color per value series (p50→p99) via
      // a palette; single-series panels (e.g. errors-over-time) pin one fixed
      // brand color; breakdown panels omit it so the palette gives each series
      // a distinct color.
      ...(panel.series?.length
        ? {
            color: {
              mode: "palette-classic",
              fixedColor: panel.series.map((s) => s.color),
              seriesBy: "last",
            },
          }
        : panel.color
          ? { color: { mode: "fixed", fixedColor: [panel.color], seriesBy: "last" } }
          : {}),
    },
    queryType: "sql",
    queries: [
      {
        query: sql,
        customQuery: true,
        vrlFunctionQuery: "",
        fields: {
          stream,
          stream_type: streamType,
          // Grouped bars get a non-empty x-axis name so the dashboard grid
          // reserves room below the plot for the bottom legend (the grid's
          // `bottom` keys off `fields.x[0].label` via `hasXAxisName`). Without
          // it, a grouped bar's legend overlaps the value-axis ticks — exactly
          // the difference vs. the dashboards page, which always has a name.
          x: xFieldName
            ? [axisField(xFieldName, isHBar ? (panel.series?.length ? xFieldName : "") : "Time")]
            : [],
          // Grouped-bar panels declare multiple value series (p50/p90/p95/p99)
          // → one Y field each. Otherwise a single Y field; with no breakdown
          // its label becomes the legend/series name, so honour the panel's
          // seriesLabel (e.g. "errors") when set.
          y: panel.series?.length
            ? panel.series.map((s) => axisField(s.field, s.label))
            : valueField
              ? [axisField(valueField, seriesLabel ?? valueField)]
              : [],
          z: [],
          breakdown: breakdownName ? [axisField(breakdownName, breakdownName)] : [],
          filter: {
            filterType: "group",
            logicalOperator: "AND",
            conditions: [],
          },
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
