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
import { buildPanelDataForCard } from "./metricsHandoff";
import { buildMetricCards, type MetricStream } from "./metricFamily";
import { getMetricDefaults, resolveVariant } from "./metricDefaults";

const W = "4m";

/**
 * Walks the same path the explorer does on Select: build the card from the
 * stream list, resolve its effective variant, hand it to the editor.
 */
function handoff(
  streams: MetricStream[],
  metricName: string,
  variantId?: string,
  options?: Record<string, any>,
) {
  const cards = buildMetricCards(streams);
  const card = cards.find((c) => c.name === metricName)!;
  const stream = streams.find((s) => s.name === metricName)!;

  const defaults = getMetricDefaults(card.name, stream.metrics_meta?.metric_type, undefined, {
    streamNames: new Set(streams.map((s) => s.name)),
    familyType: card.familyType,
    rateWindow: W,
    labels: card.labels,
  });
  const resolved = resolveVariant(defaults, variantId ?? defaults.variants[0].id, options)!;
  return buildPanelDataForCard(card, resolved, defaults.bucketUnit);
}

const meta = (
  name: string,
  type: string,
  extra: Partial<MetricStream["metrics_meta"]> = {},
  docs = 100,
): MetricStream => ({
  name,
  stream_type: "metrics",
  metrics_meta: {
    metric_type: type,
    metric_family_name: name,
    help: name,
    unit: "",
    ...extra,
  },
  stats: { doc_num: docs },
});

describe("Select handoff", () => {
  it("hands a counter off as a single-query line panel", () => {
    const data = handoff([meta("http_requests_total", "Counter")], "http_requests_total");

    expect(data.type).toBe("line");
    expect(data.queryType).toBe("promql");
    expect(data.queries).toHaveLength(1);
    expect(data.queries[0].query).toBe("sum(rate(http_requests_total{}[4m]))");
    // Builder mode, so the query is editable as labels + operations.
    expect(data.queries[0].customQuery).toBe(false);
    expect(data.queries[0].fields.stream).toBe("http_requests_total");
    expect(data.queries[0].fields.stream_type).toBe("metrics");
    expect(data.config.unit).toBe("custom");
    expect(data.config.unit_custom).toBe("c/s");
  });

  it("leaves the Legend field empty rather than echoing the metric name", () => {
    // The card preview labels a single-series aggregate with its metric name
    // (an aggregate has no labels of its own, so its legend would read `{}`).
    // The editor already shows that name as the selected stream and in the
    // query, so repeating it in the Legend field is noise in a field the user
    // is likely to want to type in.
    const data = handoff([meta("http_requests_total", "Counter")], "http_requests_total");
    expect(data.queries[0].config.promql_legend).toBe("");
  });

  it("keeps a legend that actually distinguishes series", () => {
    // Dropping these would leave the percentile set as three unlabelled lines.
    const streams = [
      meta("lat_seconds", "Histogram", { unit: "s" }, 0),
      meta("lat_seconds_bucket", "Counter"),
      meta("lat_seconds_count", "Counter"),
    ];
    const data = handoff(streams, "lat_seconds_bucket", "percentiles");
    expect(data.queries.map((q: any) => q.config.promql_legend)).toEqual(["p50", "p90", "p99"]);
  });

  it("empties the count-rate legend, which names the count stream it reads", () => {
    const streams = [
      meta("lat_seconds", "Histogram", { unit: "s" }, 0),
      meta("lat_seconds_bucket", "Counter"),
      meta("lat_seconds_count", "Counter"),
    ];
    const data = handoff(streams, "lat_seconds_bucket", "count-rate");
    expect(data.queries[0].fields.stream).toBe("lat_seconds_count");
    expect(data.queries[0].config.promql_legend).toBe("");
  });

  it("hands Min/Max off as TWO queries with independent legends", () => {
    const data = handoff([meta("queue_depth", "Gauge")], "queue_depth", "minmax");

    expect(data.queries).toHaveLength(2);
    expect(data.queries.map((q: any) => q.query)).toEqual([
      "min(queue_depth{})",
      "max(queue_depth{})",
    ]);
    expect(data.queries.map((q: any) => q.config.promql_legend)).toEqual(["min", "max"]);
    expect(data.config.show_legends).toBe(true);
  });

  it("hands a non-default percentile SUBSET off as one query each", () => {
    const streams = [
      meta("lat_seconds", "Histogram", { unit: "s" }, 0),
      meta("lat_seconds_bucket", "Counter"),
      meta("lat_seconds_count", "Counter"),
    ];
    const data = handoff(streams, "lat_seconds_bucket", "percentiles", {
      percentiles: [50, 99],
    });

    expect(data.type).toBe("line");
    expect(data.queries).toHaveLength(2);
    expect(data.queries.map((q: any) => q.config.promql_legend)).toEqual(["p50", "p99"]);
    expect(data.queries[1].query).toBe(
      "histogram_quantile(0.99, sum by (le) (rate(lat_seconds_bucket{}[4m])))",
    );
  });

  it("sets the heatmap contract on a histogram handoff", () => {
    const streams = [
      meta("lat_seconds", "Histogram", { unit: "s" }, 0),
      meta("lat_seconds_bucket", "Counter"),
      meta("lat_seconds_count", "Counter"),
    ];
    const data = handoff(streams, "lat_seconds_bucket");

    expect(data.type).toBe("heatmap");
    // Without this the editor would plot raw cumulative buckets in insertion
    // order — the transform is opt-in precisely so generic heatmaps are safe.
    expect(data.config.heatmap_mode).toBe("prometheus_histogram");
    // A histogram heatmap carries TWO units, and they are not the same one.
    //
    // The `le` axis is in the OBSERVATION unit...
    expect(data.config.bucket_unit).toBe("seconds");
    // ...while the CELLS are `rate(X_bucket)` — observations per second. This
    // assertion used to read `seconds`, directly under a comment saying it meant
    // cell intensity: every cell of a latency heatmap was formatted as a duration
    // ("0.42 s") when it is a rate ("0.42 c/s").
    expect(data.config.unit).toBe("custom");
    expect(data.config.unit_custom).toBe("c/s");
    expect(data.queries[0].config.promql_legend).toBe("{le}");
  });

  it("opens an info metric on the count the card charted", () => {
    // What you click is what you get: the card charts `count(...)` — how many
    // series the info metric carries — so Select opens that, in Builder mode.
    const data = handoff([meta("target_info", "Info")], "target_info");

    expect(data.type).toBe("line");
    expect(data.queries[0].query).toBe("count(target_info{})");
    expect(data.queries[0].customQuery).toBe(false);
    expect(data.queries[0].fields.promql_operations).toEqual([{ id: "count", params: [[]] }]);
  });

  it("opens the label TABLE when that variant is the one in effect", () => {
    // Chosen from the ⚙ dialog. The default `single` mode shows only
    // timestamp/value, hiding the labels that are the whole point of an info
    // metric — so the table contract rides along with it.
    const streams = [meta("target_info", "Info")];
    const card = buildMetricCards(streams).find((c) => c.name === "target_info")!;
    const defaults = getMetricDefaults("target_info", "Info", undefined, {
      streamNames: new Set(streams.map((s) => s.name)),
      familyType: card.familyType,
    });
    const resolved = resolveVariant(defaults, "series");

    const data = buildPanelDataForCard(card, resolved as any, defaults.bucketUnit);

    expect(data.type).toBe("table");
    expect(data.config.promql_table_mode).toBe("all");
    expect(data.queries[0].query).toBe("target_info{}");
  });

  it("hands a mean pair off as one query reading both operands", () => {
    const streams = [
      meta("rpc_seconds", "Summary", { unit: "s" }, 0),
      meta("rpc_seconds_sum", "Counter"),
      meta("rpc_seconds_count", "Counter"),
    ];
    const data = handoff(streams, "rpc_seconds_sum");

    // The builder cannot divide one vector by another, so this one variant
    // falls back to Custom mode — and keeps the `{__name__=}` selector form.
    expect(data.queries[0].customQuery).toBe(true);
    expect(data.queries[0].query).toBe(
      'sum(rate({__name__="rpc_seconds_sum"}[4m])) / sum(rate({__name__="rpc_seconds_count"}[4m]))',
    );
    // The /s cancels in the ratio, so the panel is in seconds, not seconds/s.
    expect(data.config.unit).toBe("seconds");
    expect(data.config.heatmap_mode).toBeUndefined();
  });

  it("still hands off a bucket line for an unsupported GaugeHistogram", () => {
    const streams = [
      meta("gh_seconds", "GaugeHistogram", {}, 0),
      meta("gh_seconds_bucket", "Counter"),
    ];
    const data = handoff(streams, "gh_seconds_bucket");

    // The card shows a placeholder, but Select must still open something
    // explorable. Gauge-histogram buckets are snapshots, so no rate().
    expect(data.type).toBe("line");
    expect(data.queries[0].query).toBe("sum by (le) (gh_seconds_bucket{})");
    expect(data.config.heatmap_mode).toBeUndefined();
  });

  it("carries a variant's unit override into the panel", () => {
    const streams = [
      meta("lat_seconds", "Histogram", { unit: "s" }, 0),
      meta("lat_seconds_bucket", "Counter"),
      meta("lat_seconds_count", "Counter"),
    ];
    // "Rate of count" switches heatmap -> line and seconds -> count/s.
    const data = handoff(streams, "lat_seconds_bucket", "count-rate");

    expect(data.type).toBe("line");
    expect(data.config.unit).toBe("custom");
    expect(data.config.unit_custom).toBe("c/s");
    expect(data.config.heatmap_mode).toBeUndefined();
  });
});

describe("Select lands in Builder mode", () => {
  const HIST = [
    meta("lat_seconds", "Histogram", { unit: "s" }, 0),
    meta("lat_seconds_bucket", "Counter"),
    meta("lat_seconds_count", "Counter"),
  ];

  it("populates the builder slots the editor reads", () => {
    // Builder mode renders the query FROM these two fields. Leaving them empty
    // (as a Custom-mode handoff does) would show an operation-less builder, and
    // the user's first edit would overwrite the query with a bare `metric{}`.
    const data = handoff([meta("http_requests_total", "Counter")], "http_requests_total");

    expect(data.queries[0].fields.promql_operations).toEqual([
      { id: "rate", params: ["4m"] },
      { id: "sum", params: [[]] },
    ]);
    expect(data.queries[0].fields.promql_labels).toEqual([]);
  });

  it("carries label filters through as builder label rows", () => {
    const cards = buildMetricCards([meta("http_requests_total", "Counter")]);
    const card = cards[0];
    const defaults = getMetricDefaults(card.name, "Counter", undefined, {
      rateWindow: W,
      filters: [
        { label: "job", value: "api", operator: "=" },
        { label: "pod", value: "web-.*", operator: "=~" },
      ],
    });
    const data = buildPanelDataForCard(
      card,
      resolveVariant(defaults, defaults.variants[0].id)!,
      defaults.bucketUnit,
    );

    expect(data.queries[0].customQuery).toBe(false);
    expect(data.queries[0].fields.promql_labels).toEqual([
      { label: "job", op: "=", value: "api" },
      { label: "pod", op: "=~", value: "web-.*" },
    ]);
    expect(data.queries[0].query).toBe(
      'sum(rate(http_requests_total{job="api",pod=~"web-.*"}[4m]))',
    );
  });

  it("selects the stream a count-rate variant actually reads", () => {
    // The card is `_bucket` but this variant queries `_count`. In Builder mode
    // `fields.stream` IS the metric the builder renders, so a stale `_bucket`
    // here would rewrite the query to the wrong stream on the first edit.
    const data = handoff(HIST, "lat_seconds_bucket", "count-rate");

    expect(data.queries[0].customQuery).toBe(false);
    expect(data.queries[0].fields.stream).toBe("lat_seconds_count");
    expect(data.queries[0].query).toBe("sum(rate(lat_seconds_count{}[4m]))");
  });

  it("gives every query of a multi-query variant its own builder state", () => {
    const data = handoff(HIST, "lat_seconds_bucket", "percentiles", {
      percentiles: [50, 99],
    });

    expect(data.queries.map((q: any) => q.customQuery)).toEqual([false, false]);
    for (const [i, p] of [0.5, 0.99].entries()) {
      expect(data.queries[i].fields.promql_operations).toEqual([
        { id: "rate", params: ["4m"] },
        { id: "sum", params: [["le"]] },
        { id: "histogram_quantile", params: [p] },
      ]);
    }
  });

  it("falls back to Custom for a metric name PromQL cannot spell", () => {
    // OpenObserve stream names may lead with a digit; PromQL identifiers may
    // not. The builder renders `5xx_total{}`, which does not parse — so this
    // one has to stay in Custom mode, on the `{__name__=}` selector form.
    const data = handoff([meta("5xx_total", "Counter")], "5xx_total");

    expect(data.queries[0].customQuery).toBe(true);
    expect(data.queries[0].query).toBe('sum(rate({__name__="5xx_total"}[4m]))');
  });
});

describe("legends follow the SERIES a query returns, not the query count", () => {
  it("shows the legend for Top 5 — one query, five series", () => {
    // Keyed on `queries.length > 1`, the legend was hidden on exactly the variants
    // that need it most: five unlabelled lines and no way to tell them apart.
    const streams = [meta("http_requests_total", "Counter")];
    const card = buildMetricCards(streams).find((c) => c.name === "http_requests_total")!;
    const defaults = getMetricDefaults("http_requests_total", "Counter", undefined, {
      streamNames: new Set(["http_requests_total"]),
      familyType: card.familyType,
      labels: ["instance", "code"],
      rateWindow: "4m",
    });
    const resolved = resolveVariant(defaults, "topk");

    const data = buildPanelDataForCard(card, resolved as any, defaults.bucketUnit);

    expect(data.queries).toHaveLength(1);
    expect(data.queries[0].config.promql_legend).toContain("{");
    expect(data.config.show_legends).toBe(true);
  });

  it("still hides the legend for a single-series aggregate", () => {
    const data = handoff([meta("http_requests_total", "Counter")], "http_requests_total");
    expect(data.queries).toHaveLength(1);
    expect(data.config.show_legends).toBe(false);
  });

  /**
   * Convert-to-dashboard POSTs this object STRAIGHT to the API — it never passes
   * through the panel editor, which is what fills defaults on the drill-in path.
   * So every field the Rust `Panel` struct requires has to be present here or the
   * save fails outright on deserialize.
   *
   * The required set, from config/src/meta/dashboards/v8/mod.rs:101-119 — bare
   * (non-Option) fields with no `#[serde(default)]`. `id` and `title` are stamped
   * per-panel by the convert path, so they are not this builder's job.
   */
  describe("the object satisfies the dashboard Panel contract", () => {
    it("carries `description` — a bare String on the Rust side, so omitting it 500s", () => {
      const data = handoff([meta("http_requests_total", "Counter")], "http_requests_total");

      // v8/mod.rs:106 — `pub description: String` with NO serde default. Its
      // absence was the "missing field `description`" failure on Convert.
      expect(data.description).toBe("");
    });

    it("carries every other required Panel/Query/PanelFields field", () => {
      const data = handoff([meta("http_requests_total", "Counter")], "http_requests_total");

      // Panel (v8:101) — `config` and `queries` are required alongside description.
      expect(data.type).toBeTruthy();
      expect(data.config).toBeDefined();
      expect(Array.isArray(data.queries)).toBe(true);
      // PanelConfig.show_legends (v8:338) is a bare bool.
      expect(typeof data.config.show_legends).toBe("boolean");

      for (const query of data.queries) {
        // Query (v8:122) — query/vrl_function_query are Option, but
        // custom_query/fields/config are not.
        expect(typeof query.customQuery).toBe("boolean");
        expect(query.fields).toBeDefined();
        expect(query.config).toBeDefined();
        // PanelFields (v8:161) — stream/stream_type/x/y are all bare.
        expect(query.fields.stream).toBeTruthy();
        expect(query.fields.stream_type).toBe("metrics");
        expect(Array.isArray(query.fields.x)).toBe(true);
        expect(Array.isArray(query.fields.y)).toBe(true);
      }
    });
  });
});
