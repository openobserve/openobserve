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
 * The Select handoff: explorer card -> existing metrics editor.
 *
 * Everything travels through the editor's existing deep-link path (the
 * `metrics_data` blob), so no PanelEditor UI change is required. The user must
 * land on the same chart they clicked — override included.
 */

import { promqlRenderer } from "@/components/promql/operations/queryModeller";
import type { PromqlBuilderQuery } from "@/components/promql/types";
import { toO2Unit } from "./metricDefaults";
import type { MetricCard } from "./metricFamily";

/** Chart types the PanelEditor understands. `"none"` is a card-only concept. */
type PanelChartType = "line" | "heatmap" | "table";

export interface HandoffVariant {
  queries: Array<{
    expr: string;
    legendTemplate?: string;
    /** Present when the query is expressible as PromQL-builder state. */
    builder?: PromqlBuilderQuery;
  }>;
  chartType?: string;
  unit?: string;
}

/**
 * PromQL metric names. OpenObserve stream names are laxer than this (they may
 * lead with a digit), which is why the preview queries use the `{__name__="x"}`
 * selector form — but the builder renders `x{}`, so a name that is not a legal
 * PromQL identifier cannot go through it.
 */
const PROM_METRIC_NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

/** Characters `buildSelector` escapes but the query modeller does not. */
// eslint-disable-next-line no-control-regex -- matching control chars is the intent
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/**
 * The builder state for every query in a variant, or `null` if the variant must
 * hand off in Custom mode.
 *
 * All-or-nothing: `customQuery` is per query, but a variant that landed half in
 * Builder and half in Custom would flip the editor's toggle as the user moved
 * between query tabs.
 */
function builderStatesFor(variant: HandoffVariant): PromqlBuilderQuery[] | null {
  const states: PromqlBuilderQuery[] = [];

  for (const query of variant.queries) {
    const builder = query.builder;
    if (!builder) return null;
    if (!PROM_METRIC_NAME_RE.test(builder.metric)) return null;
    // The modeller escapes `\` and `"` when it renders a label value, but not
    // the control characters `buildSelector` handles. A value carrying one would
    // render as an unparseable query, so such a filter stays in Custom mode.
    if (builder.labels.some((l) => CONTROL_CHAR_RE.test(l.value))) return null;
    states.push(builder);
  }

  return states;
}

/**
 * The legend to seed the editor's Legend field with.
 *
 * A card preview labels a single-series aggregate with its metric name, because
 * an aggregate carries no labels of its own and would otherwise show up in the
 * legend as `{}`. The editor is not the preview: the metric name is already the
 * selected stream and sits in the query in front of the user, so repeating it in
 * the Legend field is noise in a field they are likely to want to type in.
 *
 * Legends that genuinely distinguish one series from another — `min`/`max`,
 * `p50`/`p99`, `{le}` — are kept.
 */
function legendFor(template: string | undefined, stream: string): string {
  if (!template || template === stream) return "";
  return template;
}

/**
 * Maps a card's effective variant onto a panel-schema `data` object — the exact
 * shape `applyMetricsBlob` writes into `dashboardPanelData.data`.
 *
 * One editor query object per variant query descriptor: Min/Max hands off two
 * queries, a percentile set one per selected percentile.
 */
export function buildPanelDataForCard(
  card: MetricCard,
  variant: HandoffVariant,
  bucketUnit?: string | null,
): Record<string, any> {
  const chartType = toPanelChartType(variant.chartType ?? card.chartType);
  const unit = toO2Unit(variant.unit ?? card.unit);

  // Land the user in Builder mode, where the query is editable as labels and
  // operations, whenever the variant can be said in the builder's vocabulary.
  const builders = builderStatesFor(variant);

  const queries = variant.queries.map((query, i) => {
    // The stream the query actually reads — for a "Rate of count" variant that
    // is the family's `_count` sibling, not the card's own bucket stream.
    const stream = builders?.[i].metric ?? card.name;

    return {
      // In Builder mode the modeller is the sole writer of this string — it
      // rewrites `query` from the builder state on the first edit. Seeding it
      // with anything else (our `{__name__="x"}` preview form, say) would show
      // one query and then silently swap it for another on the first click. So
      // render it here exactly the way the builder itself will.
      query: builders ? promqlRenderer.renderQuery(builders[i]) : query.expr,
      customQuery: !builders,
      vrlFunctionQuery: "",
      fields: {
        stream,
        stream_type: "metrics",
        x: [],
        y: [],
        z: [],
        breakdown: [],
        promql_labels: builders?.[i].labels ?? [],
        promql_operations: builders?.[i].operations ?? [],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
      },
      config: {
        promql_legend: legendFor(query.legendTemplate, stream),
        query_label: "",
        step_value: null,
      },
    };
  });

  /**
   * Legends are for telling series apart, and one query can return many.
   *
   * Keying this on `queries.length` hid the legend on exactly the variants that
   * need it most: Top 5 is ONE query returning five series, and a summary's
   * quantiles are one query per `{quantile}`. The user got five unlabelled lines.
   * A legend template that carries a placeholder (`{le}`, `{instance}`, `{pod}`)
   * is the variant telling us it expects multiple series — that is the signal.
   */
  const multiSeriesLegend = variant.queries.some((query) =>
    /\{[^}]+\}/.test(query.legendTemplate ?? ""),
  );

  const config: Record<string, any> = {
    unit: unit.unit,
    unit_custom: unit.unitCustom,
    decimals: 2,
    show_legends: queries.length > 1 || multiSeriesLegend,
    legends_position: null,
  };

  if (chartType === "heatmap") {
    // config.unit alone cannot carry both the `le` bounds and the cell
    // intensity, so the bucket unit rides its own field.
    config.heatmap_mode = "prometheus_histogram";
    const bucket = toO2Unit(bucketUnit ?? card.unit);
    config.bucket_unit = bucket.unit;
    config.bucket_unit_custom = bucket.unitCustom;
  }

  if (chartType === "table") {
    // The default `single` mode shows only timestamp/value, which would hide the
    // labels that are the entire point of an info metric.
    config.promql_table_mode = "all";
  }

  return {
    type: chartType,
    queryType: "promql",
    // The dashboard Panel struct requires this — it is a bare `String`, with no
    // `#[serde(default)]` (config/src/meta/dashboards/v8/mod.rs:106), so a panel
    // POSTed without it fails to deserialize outright: "missing field
    // `description`". The drill-in never noticed, because it hands this object to
    // the panel editor, which fills its own defaults before any save. Convert-to-
    // dashboard POSTs it straight to the API, so the field has to be real here.
    description: "",
    queries,
    config,
  };
}

function toPanelChartType(cardChartType: string): PanelChartType {
  if (cardChartType === "heatmap") return "heatmap";
  if (cardChartType === "table") return "table";
  return "line";
}
