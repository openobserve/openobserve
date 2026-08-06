import { describe, it, expect } from "vitest";
import { alertPromqlSamples } from "@/utils/alerts/promqlSamples";

// The generator reuses the metrics page's variant catalogue (metricDefaults
// "Rule set A"), filtered to expressions that make sense as a single alert
// condition. These tests pin that filter and the alert-specific bindings.

describe("alertPromqlSamples", () => {
  it("produces rate samples for a counter, window bound to the alert period", () => {
    const samples = alertPromqlSamples({
      metricName: "http_requests_total",
      metricType: "counter",
      periodMinutes: 10,
    });
    const rateSum = samples.find((s) => s.id === "rate-sum");
    expect(rateSum).toBeTruthy();
    // computeRateWindow(600s) resolves to the 1m floor — the SAME window a
    // dashboard panel would use for this range, so the inserted query and the
    // panel a user debugs with cannot disagree. The selector uses the
    // catalogue's `{__name__="…"}` form, which survives metric names a bare
    // PromQL identifier cannot express.
    expect(rateSum!.query).toBe('sum(rate({__name__="http_requests_total"}[1m]))');
  });

  it("every sample is a single expression (multi-query variants are excluded)", () => {
    const samples = alertPromqlSamples({
      metricName: "node_memory_usage",
      metricType: "gauge",
    });
    // gauge catalogue includes min/max (two queries) — not alertable as one
    // condition.
    expect(samples.find((s) => s.id === "minmax")).toBeUndefined();
    for (const s of samples) {
      expect(s.query).toBeTruthy();
      expect(s.query.includes("\n")).toBe(false);
    }
  });

  it("gauge metrics get avg and sum samples", () => {
    const samples = alertPromqlSamples({
      metricName: "node_memory_usage",
      metricType: "gauge",
    });
    expect(samples.find((s) => s.id === "avg")?.query).toBe('avg({__name__="node_memory_usage"})');
    expect(samples.find((s) => s.id === "sum")?.query).toBe('sum({__name__="node_memory_usage"})');
  });

  it("histograms surface a single highest-percentile sample, not the multi-query variant", () => {
    const samples = alertPromqlSamples({
      metricName: "http_duration_seconds_bucket",
      metricType: "histogram",
    });
    // The catalogue's percentiles variant carries p50/p90/p99 as separate
    // queries; an alert condition needs exactly one. We extract the highest.
    const pct = samples.find((s) => s.id.startsWith("p"));
    expect(pct).toBeTruthy();
    expect(pct!.query).toContain("histogram_quantile(0.99");
    // and no sample carries a heatmap or multi-expression payload
    expect(samples.find((s) => s.id === "heatmap")).toBeUndefined();
    expect(samples.find((s) => s.id === "percentiles")).toBeUndefined();
  });

  it("includes topk only when labels are available", () => {
    const without = alertPromqlSamples({
      metricName: "http_requests_total",
      metricType: "counter",
    });
    expect(without.find((s) => s.id === "topk")).toBeUndefined();

    const with_ = alertPromqlSamples({
      metricName: "http_requests_total",
      metricType: "counter",
      labels: ["service", "pod"],
    });
    const topk = with_.find((s) => s.id === "topk");
    expect(topk).toBeTruthy();
    expect(topk!.query).toMatch(/^topk\(5, sum by \(\w+\) \(rate\(/);
  });

  it("unknown metric type falls back to gauge-style samples instead of nothing", () => {
    const samples = alertPromqlSamples({ metricName: "mystery_metric" });
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.find((s) => s.id === "avg")).toBeTruthy();
  });

  it("system fields are stripped from candidate labels", () => {
    const samples = alertPromqlSamples({
      metricName: "http_requests_total",
      metricType: "counter",
      labels: ["_timestamp", "value", "__name__", "__hash__"],
    });
    // nothing usable remains -> no topk
    expect(samples.find((s) => s.id === "topk")).toBeUndefined();
  });

  it("each sample carries a human label for the chip", () => {
    const samples = alertPromqlSamples({
      metricName: "http_requests_total",
      metricType: "counter",
    });
    for (const s of samples) {
      expect(s.label).toBeTruthy();
      expect(s.label.length).toBeLessThan(40);
    }
  });

  it("returns an empty list without a metric name", () => {
    expect(alertPromqlSamples({ metricName: "" })).toEqual([]);
  });
});
