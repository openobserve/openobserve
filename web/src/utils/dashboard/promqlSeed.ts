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
 * Writes the metrics rule set's default into a panel query slot.
 *
 * The thin, stateful half of `utils/metrics/metricPanelSeed.ts` — that module
 * decides *what* to seed and is pure; this one knows the panel-state shape.
 */

import {
  buildPromqlSeed,
  CHART_TYPE_CONTRACT_KEYS,
  isAutoSeededQuery,
  isUntouchedPanelType,
  seedOwnsChartType,
  type PromqlSeed,
  type SeedOptions,
} from "@/utils/metrics/metricPanelSeed";

/**
 * The metrics stream list the editor already loaded for its stream dropdown —
 * the same `getStreams()` payload the explorer reads, so it carries
 * `metrics_meta` (type / help / unit) and `stats`. No extra fetch.
 */
export function metricsStreamsOf(dashboardPanelData: any): any[] {
  const meta = dashboardPanelData?.meta?.stream;
  if (meta?.streamResultsType !== "metrics") return [];
  return Array.isArray(meta.streamResults) ? meta.streamResults : [];
}

export interface SeedContext extends SeedOptions {
  /**
   * The metric the slot's CURRENT query was seeded for.
   *
   * Callers are stream-change watchers, so by the time they run `fields.stream`
   * already holds the NEW metric — comparing the old query against a seed for
   * the new one never matches, and we would wrongly conclude the user had
   * hand-written it. Pass the previous stream explicitly; it defaults to
   * `fields.stream` only for callers that seed a slot whose query is empty.
   */
  previousStream?: string;
}

/** Resolve the seed for the panel's current state without writing anything. */
export function promqlSeedFor(
  dashboardPanelData: any,
  metricName: string,
  overrides: SeedContext = {},
): PromqlSeed {
  const { previousStream, ...seedOverrides } = overrides;

  const idx = dashboardPanelData.layout.currentQueryIndex;
  const slot = dashboardPanelData.data.queries?.[idx];
  const type = dashboardPanelData.data.type;
  const streams = metricsStreamsOf(dashboardPanelData);
  const previousMetric = previousStream ?? slot?.fields?.stream;

  // Builder mode (customQuery false) can only carry builder-expressible queries.
  const requireBuilder = !slot?.customQuery;

  return buildPromqlSeed(metricName, streams, {
    chartType: type,
    // We may set the chart type only when the panel has not been shaped by the
    // user: either it is still on the new-panel default, or the query AND the
    // type still agree with what we would produce at that type — meaning we
    // authored both.
    allowChartTypeChange:
      isUntouchedPanelType(type) ||
      seedOwnsChartType(slot?.query, previousMetric, streams, {
        chartType: type,
        requireBuilder,
      }),
    requireBuilder,
    ...seedOverrides,
  });
}

/**
 * Whether the current query slot still holds only what a seed put there — and
 * may therefore be re-seeded. Seeding initializes an untouched slot; it must
 * never overwrite builder state the user authored.
 *
 * The slot-level counterpart of `isAutoSeededQuery`, which the stream watchers
 * ask of the query text alone. In Builder mode the query is rendered FROM the
 * labels and operations, so the text covers most of it — except a label row that
 * has been added but not yet filled in, which renders to nothing yet is still a
 * chip on screen that must not vanish.
 */
export function isAutoSeededSlot(dashboardPanelData: any, overrides: SeedContext = {}): boolean {
  const idx = dashboardPanelData.layout.currentQueryIndex;
  const slot = dashboardPanelData.data.queries?.[idx];
  if (!slot) return true;

  const labels = slot.fields?.promql_labels ?? [];
  if (labels.some((label: any) => !label?.label)) return false;

  const { previousStream, ...seedOverrides } = overrides;

  return isAutoSeededQuery(
    slot.query,
    previousStream ?? slot.fields?.stream,
    metricsStreamsOf(dashboardPanelData),
    {
      chartType: dashboardPanelData.data.type,
      requireBuilder: !slot.customQuery,
      ...seedOverrides,
    },
  );
}

/**
 * Write the seed into the current query slot.
 *
 * Does NOT touch `fields.stream` — the seed is guaranteed to read the stream that
 * is already selected (see `metricPanelSeed`), and writing it would re-fire the
 * stream watcher that usually calls us.
 */
export function applyPromqlSeed(
  dashboardPanelData: any,
  metricName: string,
  overrides: SeedContext = {},
): PromqlSeed | null {
  const idx = dashboardPanelData.layout.currentQueryIndex;
  const slot = dashboardPanelData.data.queries?.[idx];
  if (!slot) return null;

  const seed = promqlSeedFor(dashboardPanelData, metricName, overrides);

  slot.query = seed.query;
  // Only ever moves TOWARDS Custom, never back.
  //
  // A slot the user put in Custom mode stays there: switching them back to Builder
  // silently rewrites their query the moment they touch a chip, and the editor
  // normally makes them confirm that. `seed.customQuery` is true when the seed
  // cannot be expressed in the builder (a mean pair, a digit-leading name), and in
  // that case the slot MUST become Custom or the query would not survive; that
  // direction is forced by correctness, the other is not.
  if (seed.customQuery) slot.customQuery = true;
  if (slot.fields) {
    slot.fields.promql_labels = seed.promqlLabels;
    slot.fields.promql_operations = seed.promqlOperations;
  }
  slot.config = { ...(slot.config ?? {}), promql_legend: seed.legend };

  applySeedPanelShape(dashboardPanelData, seed, idx);

  return seed;
}

/**
 * Write the PANEL-level part of a seed: the chart type, the unit, and the
 * chart-type contracts.
 *
 * Only from the FIRST query slot: `data.type` and `data.config` describe the
 * whole panel, not one query, and the metrics page seeds every empty slot in a
 * loop — a later slot on a different metric must not overwrite the panel shape
 * the first established.
 *
 * When the type changes, the contracts belonging to the type being LEFT are
 * retracted (merging alone only adds keys, so a heatmap -> line panel would
 * otherwise keep `heatmap_mode` / `bucket_unit` forever).
 */
export function applySeedPanelShape(
  dashboardPanelData: any,
  seed: PromqlSeed,
  queryIndex: number,
): void {
  if (queryIndex !== 0) return;

  const config: Record<string, any> = {
    ...(dashboardPanelData.data.config ?? {}),
  };

  if (seed.chartType) {
    dashboardPanelData.data.type = seed.chartType;
    // We own the panel's shape, so drop the contracts of the type we are leaving.
    for (const key of CHART_TYPE_CONTRACT_KEYS) delete config[key];
  } else {
    // We do NOT own the chart type (the user picked it) — but the QUERY still
    // changed, and a contract that belonged to the old query is now a lie about
    // the new one. `heatmap_mode: prometheus_histogram` left on a counter tells
    // the converter to de-accumulate cumulative buckets that are not there; the
    // chart it draws is nonsense. Anything the new seed does not re-assert is
    // retracted.
    for (const key of CHART_TYPE_CONTRACT_KEYS) {
      if (!(key in seed.config)) delete config[key];
    }
  }

  Object.assign(config, seed.config);
  dashboardPanelData.data.config = config;
}
