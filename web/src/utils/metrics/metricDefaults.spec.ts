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

import { describe, it, expect } from "vitest";
import {
  CARD_KIND,
  baseNameOf,
  buildSelector,
  computeRateWindow,
  computeStepSeconds,
  formatPromDuration,
  getMetricDefaults,
  inferUnit,
  resolveCardKind,
  resolveVariant,
  toO2Unit,
} from "./metricDefaults";

/** The rate window every truth-table expectation below is written against. */
const W = "4m";

/** Shorthand: the default (index 0) query for a metric, with no filters. */
const defaultQuery = (name: string, type?: string, ctx?: Record<string, any>) =>
  getMetricDefaults(name, type, undefined, { rateWindow: W, ...ctx }).defaultQuery;

const unitOf = (name: string, type?: string, ctx?: Record<string, any>) =>
  getMetricDefaults(name, type, undefined, { rateWindow: W, ...ctx }).unit;

const streamNames = (...names: string[]) => new Set(names);

describe("buildSelector", () => {
  it("always emits the __name__ form, never a bare identifier", () => {
    expect(buildSelector("http_requests_total")).toBe('{__name__="http_requests_total"}');
  });

  it("handles metric names that are not valid PromQL identifiers", () => {
    // OpenObserve stream-name normalization strips only [^a-zA-Z0-9_:], so a
    // name may begin with a digit. As a bare identifier this would not parse.
    expect(buildSelector("5xx_errors_total")).toBe('{__name__="5xx_errors_total"}');
  });

  it("orders matchers deterministically so the cache key is stable", () => {
    const a = buildSelector("m", [
      { label: "pod", value: "p1" },
      { label: "job", value: "api" },
    ]);
    const b = buildSelector("m", [
      { label: "job", value: "api" },
      { label: "pod", value: "p1" },
    ]);
    expect(a).toBe(b);
    expect(a).toBe('{__name__="m",job="api",pod="p1"}');
  });

  it("escapes string literals in filter values", () => {
    expect(buildSelector("m", [{ label: "path", value: 'a"b\\c' }])).toBe(
      '{__name__="m",path="a\\"b\\\\c"}',
    );
    expect(buildSelector("m", [{ label: "l", value: "a\nb" }])).toBe('{__name__="m",l="a\\nb"}');
  });

  it("keeps an explicitly empty value", () => {
    expect(buildSelector("m", [{ label: "l", value: "" }])).toBe('{__name__="m",l=""}');
  });

  it("rejects invalid label names rather than silently dropping them", () => {
    // A dropped matcher would render unfiltered data with no indication.
    expect(() => buildSelector("m", [{ label: "bad-label", value: "x" }])).toThrow(
      /invalid label name/,
    );
    expect(() => buildSelector("m", [{ label: "1abc", value: "x" }])).toThrow(/invalid label name/);
  });

  it("supports the non-equality matcher operators", () => {
    expect(buildSelector("m", [{ label: "job", value: "api.*", operator: "=~" }])).toBe(
      '{__name__="m",job=~"api.*"}',
    );
    expect(() => buildSelector("m", [{ label: "job", value: "x", operator: ">" }])).toThrow(
      /invalid operator/,
    );
  });
});

describe("rate window (PRD 6.4)", () => {
  it("floors at 4 x the scrape interval", () => {
    // Below the floor, rate() often sees fewer than the 2 samples it needs.
    // A 15m range over 300 points gives a 15s step; step + scrape is well under
    // the floor either way, so the floor is what comes out.
    expect(computeRateWindow(15 * 60, undefined, 15)).toBe("1m"); // 4 x 15s
    expect(computeRateWindow(15 * 60, undefined, 60)).toBe("4m"); // 4 x 60s
  });

  it("takes the scrape interval from its caller, never an assumption", () => {
    // The org declares it, and the panel substitution resolves `$__rate_interval`
    // against that same value. A card that assumed its own charted a metric with
    // different smoothing from the panel it drills into.
    expect(computeRateWindow(15 * 60)).toBe("1m"); // the 15s default, as the panel falls back to
  });

  it("grows as step + scrape interval for long ranges", () => {
    // 300 points over ~12.5 days => a 1h step => the step dominates the floor.
    const range = 3600 * 300;
    expect(computeStepSeconds(range)).toBe(3600);
    expect(computeRateWindow(range, undefined, 60)).toBe("1h1m");
    expect(computeRateWindow(range, undefined, 15)).toBe("1h15s");
  });

  it("never produces a step below 15s", () => {
    expect(computeStepSeconds(60, 300)).toBe(15);
  });

  it("serializes PromQL durations", () => {
    expect(formatPromDuration(240)).toBe("4m");
    expect(formatPromDuration(3660)).toBe("1h1m");
    expect(formatPromDuration(90)).toBe("1m30s");
    expect(formatPromDuration(86400)).toBe("1d");
  });
});

describe("type resolution (PRD 6.1)", () => {
  it("dispatches family suffixes on the name, not the coerced type", () => {
    // The backend coerces _bucket/_sum/_count sub-streams to `counter` when
    // real metadata is missing. Routing X_sum by that would produce
    // sum(rate(X_sum)) instead of the mean pair.
    expect(
      resolveCardKind("foo_seconds_sum", "counter", {
        streamNames: streamNames("foo_seconds_count"),
      }),
    ).toBe(CARD_KIND.MEAN_PAIR);
    expect(resolveCardKind("foo_bucket", "counter")).toBe(CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS);
  });

  it("compares the declared type case-insensitively", () => {
    // The backend serializes MetricType in PascalCase: "Counter", "GaugeHistogram".
    expect(resolveCardKind("foo", "Counter")).toBe(CARD_KIND.COUNTER_RATE);
    expect(resolveCardKind("foo", "Summary")).toBe(CARD_KIND.SUMMARY_QUANTILES);
    expect(resolveCardKind("foo_bucket", "GaugeHistogram")).toBe(CARD_KIND.OTHER);
    expect(resolveCardKind("foo_bucket", "ExponentialHistogram")).toBe(
      CARD_KIND.EXP_HISTOGRAM_FALLBACK,
    );
  });

  it("treats an orphan _sum as a counter", () => {
    expect(resolveCardKind("foo_seconds_sum", "", { streamNames: streamNames() })).toBe(
      CARD_KIND.COUNTER_RATE,
    );
    // No ctx at all -> no sibling knowledge -> counter fallback.
    expect(resolveCardKind("foo_seconds_sum", "")).toBe(CARD_KIND.COUNTER_RATE);
  });

  it("lets a genuinely declared gauge win on _count / _total", () => {
    // The fallback coercion only ever produces `counter`, so a declared `gauge`
    // here is real ingested metadata.
    expect(resolveCardKind("foo_count", "gauge")).toBe(CARD_KIND.GAUGE);
    expect(resolveCardKind("foo_total", "gauge")).toBe(CARD_KIND.GAUGE);
    expect(resolveCardKind("foo_count", "counter")).toBe(CARD_KIND.COUNTER_RATE);
    expect(resolveCardKind("foo_total", "")).toBe(CARD_KIND.COUNTER_RATE);
  });

  it("resolves the histogram subtype from the family when the member is coerced", () => {
    expect(
      resolveCardKind("foo_bucket", "counter", {
        familyType: "exponentialhistogram",
      }),
    ).toBe(CARD_KIND.EXP_HISTOGRAM_FALLBACK);
    expect(resolveCardKind("foo_bucket", "counter", { familyType: "gaugehistogram" })).toBe(
      CARD_KIND.OTHER,
    );
    expect(resolveCardKind("foo_bucket", "counter", { familyType: "histogram" })).toBe(
      CARD_KIND.CLASSIC_HISTOGRAM_BUCKETS,
    );
  });

  it("maps the remaining family suffixes", () => {
    expect(resolveCardKind("foo_created", "counter")).toBe(CARD_KIND.TIMESTAMP);
    expect(resolveCardKind("foo_info", "")).toBe(CARD_KIND.INFO);
    expect(resolveCardKind("foo_gsum", "gaugehistogram")).toBe(CARD_KIND.OTHER);
    expect(resolveCardKind("foo_gcount", "gaugehistogram")).toBe(CARD_KIND.OTHER);
  });

  it("falls back to gauge for every other bare-name type", () => {
    for (const t of ["gauge", "info", "stateset", "unknown", "", undefined]) {
      expect(resolveCardKind("foo", t as any)).toBe(CARD_KIND.GAUGE);
    }
  });

  it("derives the family base name", () => {
    expect(baseNameOf("foo_seconds_bucket")).toBe("foo_seconds");
    expect(baseNameOf("foo_seconds_count")).toBe("foo_seconds");
    expect(baseNameOf("foo_total")).toBe("foo");
    expect(baseNameOf("foo")).toBe("foo");
    // `bucket` is only a suffix when something precedes it.
    expect(baseNameOf("bucket")).toBe("bucket");
    expect(baseNameOf("foo_count_")).toBe("foo_count_");
    expect(baseNameOf("foo_seconds_bucket_")).toBe("foo_seconds_bucket_");
  });
});

describe("PRD 6.2 truth table", () => {
  it("foo_bytes -> avg, bytes", () => {
    expect(defaultQuery("foo_bytes")).toBe('avg({__name__="foo_bytes"})');
    expect(unitOf("foo_bytes")).toBe("bytes");
  });

  it("foo_seconds -> avg, seconds", () => {
    expect(defaultQuery("foo_seconds")).toBe('avg({__name__="foo_seconds"})');
    expect(unitOf("foo_seconds")).toBe("seconds");
  });

  it("foo_total -> sum(rate), count/sec", () => {
    expect(defaultQuery("foo_total")).toBe('sum(rate({__name__="foo_total"}[4m]))');
    expect(unitOf("foo_total")).toBe("count-per-sec");
  });

  it("foo_seconds_count -> sum(rate), count/sec (no lookback)", () => {
    expect(defaultQuery("foo_seconds_count")).toBe('sum(rate({__name__="foo_seconds_count"}[4m]))');
    // _count counts events, not seconds: it must NOT rate to s/s.
    expect(unitOf("foo_seconds_count")).toBe("count-per-sec");
  });

  it("foo_seconds_total -> sum(rate), unitless (s/s)", () => {
    expect(defaultQuery("foo_seconds_total")).toBe('sum(rate({__name__="foo_seconds_total"}[4m]))');
    expect(unitOf("foo_seconds_total")).toBe("none");
  });

  it("foo_bytes_total -> sum(rate), bytes/sec", () => {
    expect(unitOf("foo_bytes_total")).toBe("bytes-per-sec");
    expect(toO2Unit("bytes-per-sec")).toEqual({ unit: "bps", unitCustom: null });
  });

  it("foo_seconds_sum (with count sibling) -> mean pair, seconds", () => {
    const ctx = { streamNames: streamNames("foo_seconds_count") };
    expect(defaultQuery("foo_seconds_sum", "", ctx)).toBe(
      'sum(rate({__name__="foo_seconds_sum"}[4m])) / sum(rate({__name__="foo_seconds_count"}[4m]))',
    );
    // The /s cancels in the ratio, so a mean pair is NOT rated.
    expect(unitOf("foo_seconds_sum", "", ctx)).toBe("seconds");
  });

  it("orphan foo_seconds_sum -> counter treatment, unitless", () => {
    // A `_sum` with no `_count` sibling cannot form a mean pair, so it falls
    // back to plain counter treatment and the s/s ratio has no unit to print.
    const ctx = { streamNames: streamNames() };
    expect(defaultQuery("foo_seconds_sum", "", ctx)).toBe(
      'sum(rate({__name__="foo_seconds_sum"}[4m]))',
    );
    expect(unitOf("foo_seconds_sum", "", ctx)).toBe("none");
  });

  it("foo_bucket -> heatmap, short", () => {
    const d = getMetricDefaults("foo_bucket", "histogram", undefined, {
      rateWindow: W,
    });
    expect(d.defaultQuery).toBe('sum by (le) (rate({__name__="foo_bucket"}[4m]))');
    expect(d.chartType).toBe("heatmap");
    expect(d.unit).toBe("short");
    expect(d.legendTemplate).toBe("{le}");
  });

  it("foo_seconds_bucket -> heatmap with seconds bucket bounds + percentiles", () => {
    const d = getMetricDefaults("foo_seconds_bucket", "histogram", undefined, {
      rateWindow: W,
    });
    expect(d.unit).toBe("seconds");
    // A heatmap carries two units: the le axis is the observation unit,
    // while cell intensity is count/s.
    expect(d.bucketUnit).toBe("seconds");

    const pct = d.variants.find((v: any) => v.id === "percentiles");
    expect(pct.queries.map((q: any) => q.expr)).toEqual([
      'histogram_quantile(0.5, sum by (le) (rate({__name__="foo_seconds_bucket"}[4m])))',
      'histogram_quantile(0.9, sum by (le) (rate({__name__="foo_seconds_bucket"}[4m])))',
      'histogram_quantile(0.99, sum by (le) (rate({__name__="foo_seconds_bucket"}[4m])))',
    ]);
    expect(pct.queries.map((q: any) => q.legendTemplate)).toEqual(["p50", "p90", "p99"]);
  });
});

describe("unit inference (PRD 7.1 / 7.2)", () => {
  it("takes the nearest-to-end matching segment", () => {
    expect(inferUnit("node_memory_bytes", {})).toBe("bytes");
    expect(inferUnit("request_duration_seconds", {})).toBe("seconds");
    expect(inferUnit("some_random_metric", {})).toBe("short");
  });

  it("looks back past _total / _sum / _bucket but never past _count", () => {
    expect(inferUnit("foo_bytes_total", { rated: true })).toBe("bytes-per-sec");
    expect(inferUnit("foo_seconds_bucket", {})).toBe("seconds");
    expect(inferUnit("foo_seconds_sum", {})).toBe("seconds");
    expect(inferUnit("foo_seconds_count", { rated: true })).toBe("count-per-sec");
  });

  it("labels sub-second rate units honestly instead of rescaling", () => {
    // Rating an ms-counter yields ms-per-second, numerically 1000x off from s/s.
    expect(inferUnit("foo_milliseconds_total", { rated: true })).toBe("ms-per-sec");
    expect(toO2Unit("ms-per-sec")).toEqual({ unit: "custom", unitCustom: "ms/s" });
    expect(inferUnit("foo_ns_total", { rated: true })).toBe("ns-per-sec");
  });

  it("covers the OpenObserve extended segments", () => {
    expect(inferUnit("cpu_temp_celsius", {})).toBe("celsius");
    expect(inferUnit("mem_used_ratio", {})).toBe("percent-1");
    expect(inferUnit("disk_used_percent", {})).toBe("percent");
    expect(inferUnit("iface_rx_bits", { rated: true })).toBe("bits-per-sec");
    expect(inferUnit("http_requests", { rated: true })).toBe("count-per-sec");
  });

  it("prefers a declared unit over name inference (PRD 7.0)", () => {
    // `By` is the OTLP/UCUM spelling of bytes.
    expect(getMetricDefaults("foo_widgets", "gauge", "By").unit).toBe("bytes");
    expect(getMetricDefaults("foo_widgets", "gauge", "s").unit).toBe("seconds");
    // Rated: the declared observation unit goes through the rated mapping.
    expect(getMetricDefaults("foo_widgets_total", "counter", "By").unit).toBe("bytes-per-sec");
    // Unrecognized declared unit falls through to name inference.
    expect(getMetricDefaults("foo_bytes", "gauge", "zorkmids").unit).toBe("bytes");
  });

  it("never lets a _count member inherit the family observation unit", () => {
    // A family declaring `seconds` must still yield count/s on X_count.
    expect(getMetricDefaults("foo_seconds_count", "counter", "s").unit).toBe("count-per-sec");
  });

  it("always treats _created as seconds-since-epoch", () => {
    const d = getMetricDefaults("foo_created", "counter", "By", { rateWindow: W });
    expect(d.cardKind).toBe(CARD_KIND.TIMESTAMP);
    expect(d.unit).toBe("seconds");
    // Never rated.
    expect(d.defaultQuery).toBe('avg({__name__="foo_created"})');
  });
});

describe("variants (PRD 6.3)", () => {
  it("offers the counter variant list, with top-k only when a label exists", () => {
    const withLabels = getMetricDefaults("foo_total", "counter", undefined, {
      rateWindow: W,
      labels: ["instance", "job", "le"],
    });
    expect(withLabels.variants.map((v: any) => v.id)).toEqual([
      "rate-sum",
      "rate-avg",
      "increase",
      "topk",
    ]);
    expect(withLabels.variants[3].queries[0].expr).toBe(
      'topk(5, sum by (instance) (rate({__name__="foo_total"}[4m])))',
    );

    // No eligible label -> the variant is omitted entirely.
    const noLabels = getMetricDefaults("foo_total", "counter", undefined, {
      rateWindow: W,
      labels: ["le", "__name__"],
    });
    expect(noLabels.variants.map((v: any) => v.id)).not.toContain("topk");
  });

  it("picks the first non-internal label alphabetically when instance is absent", () => {
    const d = getMetricDefaults("foo_total", "counter", undefined, {
      rateWindow: W,
      labels: ["zone", "cluster", "quantile"],
    });
    expect(d.variants.find((v: any) => v.id === "topk").queries[0].expr).toContain(
      "sum by (cluster)",
    );
  });

  it("gives Min/Max two queries with independent legends", () => {
    const d = getMetricDefaults("foo_bytes", "gauge", undefined, { rateWindow: W });
    const minmax = d.variants.find((v: any) => v.id === "minmax");
    // Queries also carry `builder` state for the Select handoff; that is the
    // subject of metricDefaults.builder.spec.ts, so pick out the two fields
    // this test is actually about.
    expect(minmax.queries.map((q: any) => [q.expr, q.legendTemplate])).toEqual([
      ['min({__name__="foo_bytes"})', "min"],
      ['max({__name__="foo_bytes"})', "max"],
    ]);
  });

  it("restricts an ExponentialHistogram card to the count line only", () => {
    // The flattened buckets are currently corrupt (XOR bounds, non-cumulative
    // counts, no +Inf), so the heatmap and percentile paths must stay closed.
    const d = getMetricDefaults("foo_bucket", "exponentialhistogram", undefined, {
      rateWindow: W,
    });
    expect(d.cardKind).toBe(CARD_KIND.EXP_HISTOGRAM_FALLBACK);
    expect(d.variants.map((v: any) => v.id)).toEqual(["count-rate"]);
    expect(d.defaultQuery).toBe('sum(rate({__name__="foo_count"}[4m]))');
    expect(d.chartType).toBe("line");
    expect(d.unit).toBe("count-per-sec");
  });

  it("marks a GaugeHistogram bucket unsupported but still hands off a bucket line", () => {
    const d = getMetricDefaults("foo_bucket", "gaugehistogram", undefined, {
      rateWindow: W,
    });
    expect(d.cardKind).toBe(CARD_KIND.OTHER);
    expect(d.unsupported).toBe(true);
    expect(d.previewable).toBe(false);
    expect(d.chartType).toBe("none");
    expect(d.defaultQuery).toBe("");
    expect(d.configurable).toBe(false);
    // Select still works: buckets are snapshots, so no rate().
    expect(d.variants[0].queries[0].expr).toBe('sum by (le) ({__name__="foo_bucket"})');
  });

  it("gives _gsum / _gcount plain gauge treatment with no rate", () => {
    const gsum = getMetricDefaults("foo_gsum", "gaugehistogram", undefined, {
      rateWindow: W,
    });
    expect(gsum.cardKind).toBe(CARD_KIND.OTHER);
    expect(gsum.unsupported).toBe(false);
    expect(gsum.defaultQuery).toBe('avg({__name__="foo_gsum"})');
    expect(gsum.configurable).toBe(false);
  });

  it("groups summary quantiles rather than mixing them into one line", () => {
    const d = getMetricDefaults("foo", "summary", undefined, { rateWindow: W });
    expect(d.cardKind).toBe(CARD_KIND.SUMMARY_QUANTILES);
    expect(d.defaultQuery).toBe('avg by (quantile) ({__name__="foo"})');
    expect(d.legendTemplate).toBe("{quantile}");
    // Averaging pre-computed quantiles is not statistically mergeable, so the
    // pXX vocabulary is deliberately withheld from this variant.
    expect(d.variants[0].label).toBe("Avg of reported quantiles");
    expect(JSON.stringify(d.variants[0])).not.toMatch(/p50|p90|p99/);
    // The raw variant must distinguish targets, not just quantiles.
    expect(d.variants[1].queries[0].legendTemplate).toBe("{instance} {quantile}");
  });

  it("has no configurable variants for a _created card", () => {
    expect(getMetricDefaults("foo_created", "counter").configurable).toBe(false);
  });

  it("charts an info metric as a count of its series", () => {
    // An info metric's payload is its LABELS; the value is always 1. So the
    // chart worth drawing is how many of them there are — the container count,
    // the node count — and its shape over time. This card used to have no
    // preview at all, which rendered as a permanent grey box for every `*_info`
    // metric in a Kubernetes org.
    const d = getMetricDefaults("target_info", "info", undefined, { rateWindow: W });
    expect(d.cardKind).toBe(CARD_KIND.INFO);
    expect(d.previewable).toBe(true);
    expect(d.chartType).toBe("line");
    expect(d.variants[0].queries[0].expr).toBe('count({__name__="target_info"})');
    expect(d.variants[0].queries[0].legendTemplate).toBe("count");
  });

  it("still offers the label table as a second, non-previewable variant", () => {
    // A card renders through ECharts, which does not draw a table — so the table
    // is reachable from the ⚙ dialog and opens properly in the editor.
    const d = getMetricDefaults("target_info", "info", undefined, { rateWindow: W });
    expect(d.configurable).toBe(true);
    expect(d.variants[1].chartType).toBe("table");
    expect(d.variants[1].previewable).toBe(false);
    expect(d.variants[1].queries[0].expr).toBe('{__name__="target_info"}');
  });

  it("buckets card kinds for the type filter", () => {
    const bucketOf = (n: string, t?: string, ctx?: any) =>
      getMetricDefaults(n, t, undefined, ctx).typeFilterBucket;
    expect(bucketOf("a_total", "counter")).toBe("counter");
    expect(bucketOf("a", "gauge")).toBe("gauge");
    expect(bucketOf("a_bucket", "histogram")).toBe("histogram");
    expect(bucketOf("a_bucket", "exponentialhistogram")).toBe("histogram");
    expect(bucketOf("a_sum", "", { streamNames: streamNames("a_count") })).toBe("summary");
    expect(bucketOf("a", "summary")).toBe("summary");
    expect(bucketOf("a_info", "info")).toBe("other");
    expect(bucketOf("a_created", "counter")).toBe("other");
    expect(bucketOf("a_bucket", "gaugehistogram")).toBe("other");
  });
});

describe("resolveVariant", () => {
  const histogram = () =>
    getMetricDefaults("foo_seconds_bucket", "histogram", undefined, {
      rateWindow: W,
    });

  it("falls back to the default when a persisted variant id no longer exists", () => {
    const r = resolveVariant(histogram(), "variant-from-a-past-life");
    expect(r?.variant.id).toBe("heatmap");
  });

  it("applies a percentile subset selection", () => {
    const r = resolveVariant(histogram(), "percentiles", { percentiles: [99] });
    expect(r?.queries.map((q: any) => q.legendTemplate)).toEqual(["p99"]);
  });

  it("never lets a stale override collapse the percentile set to empty", () => {
    const r = resolveVariant(histogram(), "percentiles", { percentiles: [] });
    expect(r?.queries.length).toBe(3);
  });

  it("carries the variant's chart-type and unit overrides", () => {
    // The histogram "rate of count" variant switches heatmap -> line, unit -> count/s.
    const r = resolveVariant(histogram(), "count-rate");
    expect(r?.chartType).toBe("line");
    expect(r?.unit).toBe("count-per-sec");
    expect(r?.queries[0].expr).toBe('sum(rate({__name__="foo_seconds_count"}[4m]))');
  });
});

describe("filters fold into every generated query", () => {
  const filters = [{ label: "job", value: "api" }];

  it("folds into the counter selector", () => {
    expect(defaultQuery("foo_total", "counter", { filters })).toBe(
      'sum(rate({__name__="foo_total",job="api"}[4m]))',
    );
  });

  it("folds into BOTH operands of a mean pair", () => {
    // A mean pair reads X_sum and X_count; a filter must reach both, or the
    // ratio silently mixes filtered and unfiltered data.
    expect(
      defaultQuery("foo_seconds_sum", "", {
        filters,
        streamNames: streamNames("foo_seconds_count"),
      }),
    ).toBe(
      'sum(rate({__name__="foo_seconds_sum",job="api"}[4m])) / sum(rate({__name__="foo_seconds_count",job="api"}[4m]))',
    );
  });

  it("folds into the exponential-histogram count fallback", () => {
    expect(defaultQuery("foo_bucket", "exponentialhistogram", { filters })).toBe(
      'sum(rate({__name__="foo_count",job="api"}[4m]))',
    );
  });
});

describe("extreme-value guard (all-NaN retry)", () => {
  const guarded = (name: string, type: string) =>
    getMetricDefaults(name, type, undefined, {
      rateWindow: W,
      applyNanGuard: true,
    });

  it("wraps a gauge selector so NaN samples are dropped", () => {
    // One NaN sample poisons the whole of avg(), returning all-NaN for a metric
    // that genuinely has data. `x and x > -Inf` drops the NaN samples, since any
    // comparison with NaN is false — every real float passes `> -Inf`.
    const d = guarded("tiny_ratio", "gauge");
    expect(d.supportsNanGuard).toBe(true);
    expect(d.defaultQuery).toBe(
      'avg(({__name__="tiny_ratio"} and {__name__="tiny_ratio"} > -Inf))',
    );
  });

  it("NEVER guards a counter — rate() needs a selector, not an expression", () => {
    // `rate((a and a > -Inf)[4m])` is not valid PromQL.
    const d = guarded("req_total", "counter");
    expect(d.supportsNanGuard).toBe(false);
    expect(d.defaultQuery).toBe('sum(rate({__name__="req_total"}[4m]))');
    expect(d.defaultQuery).not.toContain("-Inf");
  });

  it("never guards the other rate-based kinds either", () => {
    const histogram = guarded("lat_seconds_bucket", "histogram");
    expect(histogram.supportsNanGuard).toBe(false);
    expect(histogram.defaultQuery).not.toContain("-Inf");

    const meanPair = getMetricDefaults("lat_seconds_sum", "", undefined, {
      rateWindow: W,
      applyNanGuard: true,
      streamNames: streamNames("lat_seconds_count"),
    });
    expect(meanPair.supportsNanGuard).toBe(false);
    expect(meanPair.defaultQuery).not.toContain("-Inf");
  });

  it("guards summary quantiles, which aggregate without rate()", () => {
    const d = guarded("rpc_latency", "summary");
    expect(d.supportsNanGuard).toBe(true);
    expect(d.defaultQuery).toContain("> -Inf");
  });

  it("leaves the query untouched when the guard is not requested", () => {
    const d = getMetricDefaults("tiny_ratio", "gauge", undefined, {
      rateWindow: W,
    });
    expect(d.defaultQuery).toBe('avg({__name__="tiny_ratio"})');
  });
});

describe("percentile checkbox sets are honoured", () => {
  const gauge = () => getMetricDefaults("queue_depth", "gauge", undefined, { rateWindow: W });

  it("builds a query for EVERY percentile the dialog offers", () => {
    // The dialog renders a checkbox per `availablePercentiles`. Any offered
    // percentile without a matching query is a control that silently does
    // nothing — the subset filter empties and falls back to all of them.
    const variant = gauge().variants.find((v: any) => v.id === "percentiles");
    const offered = variant.availablePercentiles;
    const built = variant.queries.map((q: any) => Number(/^p(\d+)$/.exec(q.legendTemplate)![1]));
    expect(built.sort((a, b) => a - b)).toEqual([...offered].sort((a, b) => a - b));
  });

  it("resolves p75 to a real p75 query, not a silent fallback", () => {
    const r = resolveVariant(gauge(), "percentiles", { percentiles: [75] });
    expect(r?.queries).toHaveLength(1);
    expect(r?.queries[0].legendTemplate).toBe("p75");
    expect(r?.queries[0].expr).toBe('quantile(0.75, {__name__="queue_depth"})');
  });

  it("resolves a mixed subset exactly", () => {
    const r = resolveVariant(gauge(), "percentiles", { percentiles: [50, 95] });
    expect(r?.queries.map((q: any) => q.legendTemplate)).toEqual(["p50", "p95"]);
  });

  it("defaults to p50/p90/p99 out of the five offered", () => {
    const r = resolveVariant(gauge(), "percentiles");
    expect(r?.queries.map((q: any) => q.legendTemplate)).toEqual(["p50", "p90", "p99"]);
  });
});

describe("the card footer names the function actually in effect", () => {
  const counter = () =>
    getMetricDefaults("http_requests_total", "counter", undefined, {
      rateWindow: W,
    });

  it("reports the default function with no override", () => {
    expect(resolveVariant(counter(), undefined)?.footerLabel).toBe("sum(rate)");
  });

  it("reports the OVERRIDDEN function, not the card-kind default", () => {
    // The footer is the one thing a user checks to confirm a ⚙ change landed.
    // Deriving it from the card kind left it reading "sum(rate)" forever, so
    // switching to avg(rate) looked like it had done nothing.
    expect(resolveVariant(counter(), "rate-avg")?.footerLabel).toBe("avg(rate)");
    expect(resolveVariant(counter(), "increase")?.footerLabel).toBe("sum(increase)");
  });

  it("gives every variant of every card kind a footer label", () => {
    const kinds = [
      ["http_requests_total", "counter"],
      ["queue_depth", "gauge"],
      ["lat_seconds_bucket", "histogram"],
      ["rpc_latency", "summary"],
    ] as const;

    for (const [name, type] of kinds) {
      const defaults = getMetricDefaults(name, type, undefined, {
        rateWindow: W,
      });
      for (const variant of defaults.variants) {
        const resolved = resolveVariant(defaults, variant.id);
        expect(typeof resolved?.footerLabel).toBe("string");
      }
    }
  });
});

describe("units the chart actually needs (found in review)", () => {
  it("a histogram heatmap's CELLS are count/s, not the observation unit", () => {
    // `rate(X_bucket)` is observations per second whatever the observation is.
    // The cells used to inherit `seconds` from `lat_seconds_bucket`, so a latency
    // heatmap formatted every cell as a duration — wrong by a whole dimension, on
    // the colour scale and every tooltip.
    const d = getMetricDefaults("lat_seconds_bucket", "counter", "s", {
      streamNames: new Set(["lat_seconds_bucket", "lat_seconds_count"]),
      familyType: "histogram",
      rateWindow: W,
    });
    const heatmap = d.variants.find((v: any) => v.id === "heatmap");

    expect(heatmap.unit).toBe("count-per-sec");
    // ...and the `le` bounds keep the observation unit, on their own field.
    expect(d.bucketUnit).toBe("seconds");
  });

  it("honours a DECLARED unit the metric name cannot express", () => {
    // An OTLP `Cel` gauge, or a byte counter with no unit segment in its name.
    // Name inference alone cannot know either; the declared unit is the only
    // source, which is why dropping it silently degraded these to numbers/count.
    expect(getMetricDefaults("cpu_temperature", "gauge", "Cel", { rateWindow: W }).unit).toBe(
      "celsius",
    );

    expect(
      getMetricDefaults("network_ingress_total", "counter", "By", { rateWindow: W }).unit,
    ).toBe("bytes-per-sec");
  });
});
