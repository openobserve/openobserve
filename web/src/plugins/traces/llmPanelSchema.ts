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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { toSeriesOverrideEntry } from "@/utils/dashboard/seriesOverrides";

import type { LLMPanelDef } from "./config/llmInsightsPanels";

/** Our internal panel type → dashboard chart type id (see ChartSelection.vue). */
const TYPE_MAP: Record<string, string> = {
  "stacked-area": "area-stacked",
  "stacked-bar": "stacked",
  // One unstacked line per series (breakdown value).
  line: "line",
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
  label: I18nText;
}

// Most axis labels are column aliases / percentile tokens (`p50`, `p95`) — identifiers,
// not prose, hence `raw()`. Callers that pass real UI text (the "Time" axis name, the
// `seriesLabelKey` legend name) translate it first and hand the result in already
// resolved; `raw()` is a no-op brand at runtime, so it is safe for both.
function axisField(name: string, label: string): AxisField {
  return { alias: name, column: name, color: null, label: raw(label) };
}

export function buildLLMPanelSchema(opts: {
  panel: LLMPanelDef;
  /** Fully rendered SQL (placeholders substituted, agent filter spliced). */
  sql: string;
  stream: string;
  streamType?: string;
  /**
   * Translator, threaded in from the calling component. The axis/series labels
   * below are user-facing, and the panel defs are module-scope config, so the
   * text has to be resolved here (at build time) to follow the locale.
   */
  t: TranslateFn;
}): any {
  const { panel, sql, stream, streamType = "traces", t } = opts;
  const { timeField, seriesField, valueField, valueFormat, seriesLabelKey, measures } = panel.query;
  // Several measures (input / output tokens) are series of their own, as a breakdown is.
  const multiSeries = !!seriesField || (measures?.length ?? 0) > 1;
  const seriesLabel = seriesLabelKey ? t(seriesLabelKey) : undefined;

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
        ? multiSeries
          ? "stacked"
          : "bar"
        : (TYPE_MAP[panel.type] ?? "line");

  // Horizontal bars use the series field as the X category, with no breakdown.
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
      show_legends: !!breakdownName || multiSeries,
      legends_position: "bottom",
      // Many models: the top N by window total, the rest folded or dropped.
      ...(breakdownName && panel.query.topSeries
        ? {
            top_results: panel.query.topSeries.n,
            top_results_others: panel.query.topSeries.others,
          }
        : {}),
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
      // A line through an empty bucket would claim a latency for hours with no calls.
      connect_nulls: false,
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
      ...(panel.color
        ? { color: { mode: "fixed", fixedColor: [panel.color], seriesBy: "last" } }
        : {}),
      // Measures of a stacked panel share one stack group so they add up to the bucket's total.
      ...(panel.type === "stacked-bar" && measures && measures.length > 1
        ? {
            override_config: measures.map((m) =>
              toSeriesOverrideEntry({
                matchBy: "name",
                value: t(m.labelKey),
                color: m.color,
                style: { stackGroup: "total" },
              }),
            ),
          }
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
          x: xFieldName
            ? [axisField(xFieldName, isHBar ? "" : t("traces.lLMInsightsDashboard.timeAxis"))]
            : [],
          // With no breakdown the Y label becomes the series name, so use the translated seriesLabelKey.
          y: measures?.length
            ? measures.map((m) => axisField(m.field, t(m.labelKey)))
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
