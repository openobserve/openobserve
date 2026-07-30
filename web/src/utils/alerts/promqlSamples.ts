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
 * Prewritten PromQL samples for the alert form, derived from the metrics
 * page's variant catalogue (`metricDefaults.ts` "Rule set A") — the same rules
 * behind each metric card's ⚙ function dialog. Reusing the catalogue means the
 * samples are real, valid queries for the user's actual metric, not canned
 * strings.
 *
 * Alert-specific bindings on top of the catalogue:
 *
 * - **Window follows the alert period** via `computeRateWindow`, which is the
 *   same resolution dashboards apply to `$__rate_interval` — the inserted
 *   query and the panel a user debugs with cannot disagree about smoothing.
 * - **Single-expression variants only.** An alert condition thresholds ONE
 *   expression; multi-query variants (min/max, p50+p90+p99 fans) and chart-only
 *   shapes (heatmap) are excluded. From percentile fans we extract the
 *   highest percentile as its own sample — the p99 is the one people alert on.
 */

import { computeRateWindow, getMetricDefaults } from "@/utils/metrics/metricDefaults";

export interface PromqlSample {
  id: string;
  /** Short human label for the chip ("Rate (sum)", "p99"). */
  label: string;
  query: string;
}

/** Variants that are charts, not conditions. */
const NON_ALERTABLE_IDS = new Set(["heatmap"]);

/** Label names that are storage artifacts, never grouping dimensions. */
const SYSTEM_LABELS = new Set(["_timestamp", "value", "__name__", "__hash__"]);

interface SampleOptions {
  metricName: string;
  /** `stream.metrics_meta.metric_type`; unknown falls back to gauge rules. */
  metricType?: string;
  /** Label names from the stream schema, for topk/by() variants. */
  labels?: string[];
  /** Alert look-back period; binds the rate window. */
  periodMinutes?: number;
}

export function alertPromqlSamples(opts: SampleOptions): PromqlSample[] {
  const { metricName, metricType, labels, periodMinutes } = opts;
  if (!metricName) return [];

  const usableLabels = (labels ?? []).filter((l) => !SYSTEM_LABELS.has(l));
  const rateWindow = computeRateWindow((periodMinutes ?? 10) * 60);

  const defaults = getMetricDefaults(metricName, metricType, undefined, {
    rateWindow,
    labels: usableLabels.length ? usableLabels : undefined,
  });

  const samples: PromqlSample[] = [];
  for (const variant of defaults.variants ?? []) {
    if (NON_ALERTABLE_IDS.has(variant.id)) continue;
    const queries = variant.queries ?? [];

    if (queries.length === 1) {
      samples.push({
        id: variant.id,
        label: variant.label ?? variant.id,
        query: queries[0].expr,
      });
      continue;
    }

    // Multi-query percentile fans: take the highest percentile as one sample.
    // Detected by legend shape ("p50"/"p99") rather than variant id, so every
    // percentile-flavoured variant (percentiles / avg-quantiles / …) works.
    const percentileQueries = queries
      .map((q: any) => ({ q, m: /^p(\d+)$/.exec(q.legendTemplate ?? "") }))
      .filter((x: any) => x.m);
    if (percentileQueries.length) {
      const highest = percentileQueries.sort(
        (a: any, b: any) => Number(b.m![1]) - Number(a.m![1]),
      )[0];
      const label = `p${highest.m![1]}`;
      // A variant family can yield several percentile fans; keep the first.
      if (!samples.some((s) => s.id === label)) {
        samples.push({ id: label, label, query: highest.q.expr });
      }
    }
    // Other multi-query variants (min/max) are not a single condition — skip.
  }
  return samples;
}
