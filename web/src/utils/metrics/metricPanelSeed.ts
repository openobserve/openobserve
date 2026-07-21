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
 * The explorer's rule set, applied to a *panel editor* query slot.
 *
 * The explorer knows the right default function, unit and chart type for every
 * metric; this hands the same answer to the panel editor, so a metric charts
 * sensibly wherever you pick it.
 *
 * Pure: takes the streams list it is given and returns a description of what to
 * write. The call sites do the writing, because two of them must also update the
 * PromQL builder's own local state (see `requireBuilder`).
 */

import { buildMetricCardFor, type MetricStream } from "./metricFamily";
import {
  getMetricDefaults,
  PANEL_RATE_WINDOW,
  resolveVariant,
} from "./metricDefaults";
import { buildPanelDataForCard } from "./metricsHandoff";

export interface PromqlSeed {
  /** The query text to write into the slot. */
  query: string;
  /** False ⇒ Builder mode, and `promqlOperations` MUST be written with it. */
  customQuery: boolean;
  promqlLabels: any[];
  promqlOperations: any[];
  /** The stream the query actually reads — not always the one that was picked. */
  stream: string;
  legend: string;
  /** `null` ⇒ leave the panel's chart type alone. */
  chartType: string | null;
  /** Panel-level config to merge (unit, and the heatmap/table contracts). */
  config: Record<string, any>;
}

export interface SeedOptions {
  /** The panel's current chart type, so a variant can be chosen that suits it. */
  chartType?: string;
  /**
   * May we change the panel's chart type? Only true for a panel the user has not
   * shaped yet — see `isUntouchedPanelType`.
   */
  allowChartTypeChange?: boolean;
  /**
   * Builder mode: only variants the PromQL builder can actually express are
   * eligible. A Custom-form query seeded into a Builder panel is rewritten to a
   * bare `metric{}` the moment the user touches the builder, because the modeller
   * is the sole writer of the query string there.
   */
  requireBuilder?: boolean;
  /**
   * Defaults to `$__rate_interval` — this seed only ever lands in a PANEL, and a
   * panel resolves the variable against its own range and width. A literal here
   * would freeze the window at whatever the range happened to be when the metric
   * was picked.
   */
  rateWindow?: string;
}

/**
 * A new panel starts as `bar`. That is the only honest signal we have for "the
 * user has not chosen a chart type yet" — once they pick one, we never override
 * it, we pick a variant that suits it instead.
 */
export const DEFAULT_NEW_PANEL_TYPE = "bar";

export const isUntouchedPanelType = (type: string | undefined): boolean =>
  type === DEFAULT_NEW_PANEL_TYPE;

/** The bare `metric{}` selector — the fallback seed. */
const bareSeed = (metricName: string): PromqlSeed => ({
  query: `${metricName}{}`,
  customQuery: false,
  promqlLabels: [],
  promqlOperations: [],
  stream: metricName,
  legend: "",
  chartType: null,
  config: {},
});

/**
 * The default query/unit/chart-type for a metric, ready to write into a query
 * slot. Falls back to the bare `metric{}` selector whenever the rule set has
 * nothing better to offer — an unknown stream, an unsupported card kind, or (in
 * builder mode) a metric whose only sensible query the builder cannot express.
 */
export function buildPromqlSeed(
  metricName: string,
  streams: MetricStream[] | undefined | null,
  opts: SeedOptions = {},
): PromqlSeed {
  if (!metricName) return bareSeed("");

  const list = Array.isArray(streams) ? streams : [];
  // Not `buildMetricCards(list).find(...)`: a stream change asks this question
  // about ONE metric several times over (see `isAutoSeededQuery`, which
  // reconstructs the seed at both chart-type settings), and running the rule set
  // across every metric in the org each time is thousands of `getMetricDefaults`
  // calls to reach a single card.
  const card = buildMetricCardFor(list, metricName);
  if (!card || card.unsupported) return bareSeed(metricName);

  const stream = list.find((s) => s?.name === metricName);
  const defaults = getMetricDefaults(
    card.name,
    stream?.metrics_meta?.metric_type,
    card.declaredUnit,
    {
      streamNames: new Set(list.map((s) => s?.name).filter(Boolean) as string[]),
      familyType: card.familyType,
      labels: card.labels,
      rateWindow: opts.rateWindow ?? PANEL_RATE_WINDOW,
    },
  );

  const variants: any[] = defaults.variants ?? [];
  if (!variants.length) return bareSeed(metricName);

  const chartTypeOf = (v: any) => v.chartType ?? defaults.chartType;

  /**
   * A variant must READ THE STREAM THE USER PICKED. Some do not — a histogram's
   * "Rate of count" reads the family's `_count` sibling — and seeding one of
   * those would rewrite `fields.stream`, which is the panel's stream dropdown:
   * the change would re-fire the stream watcher that called us, on a stream the
   * user never chose. Seeding must never move the selection.
   */
  const readsPickedStream = (v: any) => {
    const builder = v.queries?.[0]?.builder;
    return !builder || builder.metric === metricName;
  };

  /**
   * In Builder mode only variants the builder can express are eligible — a
   * Custom-form query in a Builder panel is rewritten to a bare `metric{}` the
   * moment the user touches anything.
   */
  const expressible = (v: any) =>
    !opts.requireBuilder || !!v.queries?.[0]?.builder;

  // Free to change the chart type ⇒ the rule set's default variant wins.
  // Otherwise honour the type the user already chose and pick the best variant
  // that renders as that type — a histogram on a line panel becomes percentiles
  // rather than 20 cumulative bucket lines.
  const eligible = variants.filter((v) => expressible(v) && readsPickedStream(v));
  if (!eligible.length) return bareSeed(metricName);

  const variant = opts.allowChartTypeChange
    ? eligible[0]
    : (eligible.find((v) => chartTypeOf(v) === opts.chartType) ?? eligible[0]);

  const resolved: any = resolveVariant(defaults, variant.id);
  if (!resolved?.queries?.length) return bareSeed(metricName);

  const data = buildPanelDataForCard(card, resolved, defaults.bucketUnit);
  const q = data.queries[0];

  // Belt to the braces above: never move the stream selection.
  if (q.fields.stream !== metricName) return bareSeed(metricName);

  // The handoff drops to Custom mode for names PromQL cannot spell (a stream may
  // lead with a digit). In Builder mode that query would not survive the user's
  // first edit, so fall back to the bare selector instead.
  if (opts.requireBuilder && q.customQuery) return bareSeed(metricName);

  // Chart-type-dependent config (the histogram heatmap contract, the info-table
  // mode) is only valid if the panel is actually going to BE that type.
  const willBeThatType = opts.allowChartTypeChange || data.type === opts.chartType;

  const config: Record<string, any> = {
    unit: data.config.unit,
    unit_custom: data.config.unit_custom,
  };
  if (willBeThatType) {
    if (data.config.heatmap_mode) {
      config.heatmap_mode = data.config.heatmap_mode;
      config.bucket_unit = data.config.bucket_unit;
      config.bucket_unit_custom = data.config.bucket_unit_custom;
    }
    if (data.config.promql_table_mode) {
      config.promql_table_mode = data.config.promql_table_mode;
    }
  }

  return {
    query: q.query,
    customQuery: q.customQuery,
    promqlLabels: q.fields.promql_labels ?? [],
    promqlOperations: q.fields.promql_operations ?? [],
    stream: q.fields.stream,
    legend: q.config.promql_legend ?? "",
    chartType: opts.allowChartTypeChange ? data.type : null,
    config,
  };
}

/** The query this module would have produced for `metric` under `opts`. */
const seedQueryFor = (
  metric: string,
  streams: MetricStream[] | undefined | null,
  opts: SeedOptions,
) => buildPromqlSeed(metric, streams, opts).query.trim();

/**
 * Whether a query slot still holds something WE generated, and may therefore be
 * overwritten when the stream changes.
 *
 * Deliberately PERMISSIVE — it answers "did we author this query?", and a seed
 * could have been produced either on a fresh panel (free to choose its own chart
 * type) or on one whose type the user had already picked, which yield different
 * variants. Checking only one of those made us mistake our OWN query for a
 * hand-written one and decline to re-seed; the builder then carried the previous
 * metric's operations onto the newly selected one (a histogram's `by (le)`
 * grouping ending up on a counter). Anything the user actually typed still fails
 * both checks and is left alone.
 */
export function isAutoSeededQuery(
  query: string | undefined | null,
  previousMetric: string | undefined | null,
  streams: MetricStream[] | undefined | null,
  opts: SeedOptions = {},
): boolean {
  const text = (query ?? "").trim();
  if (!text) return true;
  if (!previousMetric) return false;
  if (text === `${previousMetric}{}`) return true;

  return (
    text ===
      seedQueryFor(previousMetric, streams, {
        ...opts,
        allowChartTypeChange: false,
      }) ||
    text ===
      seedQueryFor(previousMetric, streams, {
        ...opts,
        allowChartTypeChange: true,
      })
  );
}

/**
 * Whether the seed OWNS the panel's chart type — i.e. may change it.
 *
 * Stricter than `isAutoSeededQuery`, and deliberately a separate question. It
 * holds only when the query AND the current chart type still agree with what we
 * would produce *at that type*, which means we authored both and may revise
 * both. The moment the user picks a chart type of their own, the query we seeded
 * no longer matches the variant that type implies, this returns false, and their
 * choice is never overridden.
 */
export function seedOwnsChartType(
  query: string | undefined | null,
  metric: string | undefined | null,
  streams: MetricStream[] | undefined | null,
  opts: SeedOptions = {},
): boolean {
  const text = (query ?? "").trim();

  // Having authored the QUERY is not having authored the TYPE, and it is the
  // type being asked about here. The two seeds that leave a slot empty or
  // holding a bare `metric{}` selector are precisely the ones that set no chart
  // type at all (`bareSeed` carries `chartType: null`), so a non-default type
  // sitting next to one cannot have come from us — it can only have been picked
  // by the user, and answering `true` here overruled them: switching a panel
  // from SQL to PromQL CLEARS the query, so a panel the user had explicitly made
  // a Table met the next seed with an empty slot and came back a line chart.
  //
  // A panel nobody has shaped yet is still ours to type, but that is a question
  // about the TYPE (`isUntouchedPanelType`), which the caller asks separately —
  // not something an empty slot can answer.
  if (!text || !metric) return false;
  if (text === `${metric}{}`) return false;

  return (
    text ===
    seedQueryFor(metric, streams, { ...opts, allowChartTypeChange: false })
  );
}

/**
 * Panel config keys that only make sense for a particular chart type: the
 * histogram heatmap contract and the info-table mode. When the seed changes the
 * chart type it must RETRACT the ones belonging to the type it is leaving —
 * merging alone left a line panel carrying `heatmap_mode: prometheus_histogram`.
 */
export const CHART_TYPE_CONTRACT_KEYS = [
  "heatmap_mode",
  "bucket_unit",
  "bucket_unit_custom",
  "promql_table_mode",
] as const;
