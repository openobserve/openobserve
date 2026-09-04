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
 * The variant/builder equivalence check.
 *
 * Every variant carries its query twice: once as the `expr` string the card
 * previews with, and once as `builder` state for the panel editor's PromQL
 * builder. The editor's modeller is the sole writer of the query string in
 * Builder mode — it regenerates it from the builder state on the user's first
 * edit — so if the two ever disagree, the user watches the query they selected
 * silently mutate into a different one.
 *
 * The two strings are deliberately NOT identical: `expr` uses the
 * `{__name__="x"}` selector form (OpenObserve stream names may lead with a
 * digit, which is not a legal PromQL identifier) while the builder renders
 * `x{}`. So this normalises the one into the other and demands they match.
 */

import { describe, it, expect } from "vitest";
import { promqlRenderer } from "@/components/promql/operations/queryModeller";
import { CARD_KIND, getMetricDefaults } from "./metricDefaults";

/** `{__name__="x",job="api"}` -> `x{job="api"}`, and `{__name__="x"}` -> `x{}`. */
function toBuilderSelectorForm(expr: string): string {
  return expr.replace(
    /\{__name__="((?:[^"\\]|\\.)*)"(,)?/g,
    (_m, name: string, comma?: string) => `${name}{${comma ? "" : ""}`,
  );
}

/** Every (metric, type, ctx) shape the explorer can produce a card for. */
const FIXTURES: Array<{
  what: string;
  name: string;
  type: string;
  ctx?: Record<string, any>;
}> = [
  { what: "gauge", name: "node_memory_bytes", type: "Gauge" },
  { what: "counter", name: "http_requests_total", type: "Counter" },
  {
    what: "counter with a topk label",
    name: "http_requests_total",
    type: "Counter",
    ctx: { labels: ["instance", "job"] },
  },
  {
    what: "classic histogram buckets",
    name: "http_duration_seconds_bucket",
    type: "Counter",
    ctx: {
      familyType: "histogram",
      streamNames: new Set(["http_duration_seconds_bucket", "http_duration_seconds_count"]),
    },
  },
  {
    what: "mean pair",
    name: "http_duration_seconds_sum",
    type: "Counter",
    ctx: {
      familyType: "histogram",
      streamNames: new Set(["http_duration_seconds_sum", "http_duration_seconds_count"]),
    },
  },
  {
    what: "exponential-histogram fallback",
    name: "exp_seconds_bucket",
    type: "Counter",
    ctx: {
      familyType: "exponentialhistogram",
      streamNames: new Set(["exp_seconds_bucket", "exp_seconds_count"]),
    },
  },
  { what: "summary", name: "rpc_latency_seconds", type: "Summary" },
  { what: "timestamp", name: "process_start_time_seconds", type: "Gauge" },
  { what: "info", name: "kube_pod_info", type: "Info" },
  {
    what: "gauge-histogram gsum",
    name: "cache_size_bytes_gsum",
    type: "GaugeHistogram",
    ctx: { familyType: "gaugehistogram" },
  },
];

/** A filter set that exercises ordering, all four operators and escaping. */
const FILTERS = [
  { label: "job", value: "api", operator: "=" },
  { label: "instance", value: 'a"b\\c', operator: "!=" },
  { label: "pod", value: "web-.*", operator: "=~" },
  { label: "zone", value: "us-.*", operator: "!~" },
];

describe("every variant's builder state renders back to its preview query", () => {
  for (const filters of [undefined, FILTERS]) {
    const withFilters = filters ? "with label filters" : "unfiltered";

    for (const fixture of FIXTURES) {
      it(`${fixture.what}, ${withFilters}`, () => {
        const defaults = getMetricDefaults(fixture.name, fixture.type, undefined, {
          ...(fixture.ctx ?? {}),
          filters,
          rateWindow: "4m",
        });

        let checked = 0;
        for (const variant of defaults.variants) {
          for (const query of variant.queries as any[]) {
            if (!query.builder) continue;
            expect(promqlRenderer.renderQuery(query.builder)).toBe(
              toBuilderSelectorForm(query.expr),
            );
            checked += 1;
          }
        }

        // A fixture whose builders all silently went missing would pass the loop
        // above vacuously.
        expect(checked).toBeGreaterThan(0);
      });
    }
  }
});

describe("which queries carry builder state", () => {
  const histogram = (name: string) =>
    getMetricDefaults(name, "Counter", undefined, {
      familyType: "histogram",
      streamNames: new Set([
        "http_duration_seconds_bucket",
        "http_duration_seconds_sum",
        "http_duration_seconds_count",
      ]),
    });

  it("omits it from the mean pair, which the builder cannot express", () => {
    // `sum(rate(x_sum[w])) / sum(rate(x_count[w]))` divides one vector by
    // another; the builder's binary ops take a scalar operand only. Handing off
    // a builder state here would render `sum(rate(x_sum{}[w]))` — the numerator
    // alone, silently wrong.
    const defaults = histogram("http_duration_seconds_sum");
    const mean = defaults.variants.find((v: any) => v.id === "mean") as any;
    expect(defaults.cardKind).toBe(CARD_KIND.MEAN_PAIR);
    expect(mean.queries[0].builder).toBeUndefined();
  });

  it("still carries it on the mean pair's other variant", () => {
    const countRate = histogram("http_duration_seconds_sum").variants.find(
      (v: any) => v.id === "count-rate",
    ) as any;
    expect(countRate.queries[0].builder).toBeDefined();
  });

  it("points a count-rate variant at the sibling count stream", () => {
    // The card is `_bucket`, but this variant reads `_count`. The builder's
    // metric IS the editor's selected stream, so getting this wrong would land
    // the user on a stream whose query does not mention it.
    const countRate = histogram("http_duration_seconds_bucket").variants.find(
      (v: any) => v.id === "count-rate",
    ) as any;
    expect(countRate.queries[0].builder.metric).toBe("http_duration_seconds_count");
  });

  it("drops it when the NaN guard has rewritten the selector", () => {
    // The guarded re-query is `avg((x and x > -Inf))`, which has no builder
    // equivalent. A builder state here would quietly drop the guard.
    const guarded = getMetricDefaults("node_memory_bytes", "Gauge", undefined, {
      applyNanGuard: true,
    });
    for (const variant of guarded.variants as any[]) {
      for (const query of variant.queries) {
        expect(query.builder).toBeUndefined();
      }
    }
  });

  it("keeps it on the same metric when the guard is off", () => {
    const plain = getMetricDefaults("node_memory_bytes", "Gauge", undefined, {});
    expect((plain.variants[0] as any).queries[0].builder).toBeDefined();
  });
});
