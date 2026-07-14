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
  applyPromqlSeed,
  applySeedPanelShape,
  isAutoSeededSlot,
  promqlSeedFor,
} from "./promqlSeed";
import type { PromqlSeed } from "@/utils/metrics/metricPanelSeed";
import type { MetricStream } from "@/utils/metrics/metricFamily";

const seed = (over: Partial<PromqlSeed> = {}): PromqlSeed => ({
  query: "q",
  customQuery: false,
  promqlLabels: [],
  promqlOperations: [],
  stream: "m",
  legend: "",
  chartType: null,
  config: {},
  ...over,
});

const panel = (type: string, config: Record<string, any> = {}) => ({
  layout: { currentQueryIndex: 0 },
  data: { type, config, queries: [{}, {}] },
});

describe("applySeedPanelShape", () => {
  it("retracts the contracts of the chart type it is leaving", () => {
    // The bug: config was only ever MERGED, so a panel seeded as a histogram
    // heatmap and then re-seeded as a counter line kept `heatmap_mode` and
    // `bucket_unit` forever — a line panel carrying a Prometheus-histogram
    // de-accumulation contract.
    const p = panel("heatmap", {
      unit: "seconds",
      heatmap_mode: "prometheus_histogram",
      bucket_unit: "seconds",
      bucket_unit_custom: null,
      decimals: 2,
    });

    applySeedPanelShape(
      p,
      seed({ chartType: "line", config: { unit: "custom", unit_custom: "c/s" } }),
      0,
    );

    expect(p.data.type).toBe("line");
    expect(p.data.config.heatmap_mode).toBeUndefined();
    expect(p.data.config.bucket_unit).toBeUndefined();
    expect(p.data.config.bucket_unit_custom).toBeUndefined();
    // The new unit landed, and unrelated config is untouched.
    expect(p.data.config.unit).toBe("custom");
    expect(p.data.config.decimals).toBe(2);
  });

  it("sets the heatmap contract when it moves TO a heatmap", () => {
    const p = panel("bar", { unit: "short" });
    applySeedPanelShape(
      p,
      seed({
        chartType: "heatmap",
        config: {
          unit: "seconds",
          heatmap_mode: "prometheus_histogram",
          bucket_unit: "seconds",
        },
      }),
      0,
    );
    expect(p.data.type).toBe("heatmap");
    expect(p.data.config.heatmap_mode).toBe("prometheus_histogram");
  });

  it("lets a SECONDARY query slot seed its query but never redefine the panel", () => {
    // `data.type` and `data.config` describe the whole panel, not one query —
    // but the metrics page seeds every empty slot in a loop. A second slot on a
    // different metric was overwriting the shape the first had established.
    const p = panel("heatmap", {
      unit: "seconds",
      heatmap_mode: "prometheus_histogram",
    });

    applySeedPanelShape(
      p,
      seed({ chartType: "line", config: { unit: "custom", unit_custom: "c/s" } }),
      1, // a counter in the SECOND slot
    );

    expect(p.data.type).toBe("heatmap"); // slot 0 still owns the panel
    expect(p.data.config.unit).toBe("seconds");
    expect(p.data.config.heatmap_mode).toBe("prometheus_histogram");
  });

  it("keeps the user's chart type but still retracts a contract the new query cannot honour", () => {
    // `seed.chartType === null` ⇒ the user picked the type, so we leave the TYPE
    // alone. But the QUERY still changed, and a contract belonging to the old
    // query is now a lie about the new one: `heatmap_mode: prometheus_histogram`
    // left on a counter tells the converter to de-accumulate cumulative buckets
    // that do not exist, and it draws nonsense.
    //
    // This test used to assert the opposite — that the stale contract survives —
    // which is precisely the corruption it was meant to guard against.
    const p = panel("heatmap", {
      unit: "seconds",
      heatmap_mode: "prometheus_histogram",
      bucket_unit: "seconds",
    });

    applySeedPanelShape(
      p,
      seed({ chartType: null, config: { unit: "custom", unit_custom: "c/s" } }),
      0,
    );

    expect(p.data.type).toBe("heatmap"); // the type is theirs
    expect(p.data.config.heatmap_mode).toBeUndefined(); // the contract is not
    expect(p.data.config.bucket_unit).toBeUndefined();
    expect(p.data.config.unit).toBe("custom");
  });

  it("does NOT retract a contract the new seed re-asserts", () => {
    // Histogram -> histogram on a heatmap panel the user chose: the mode is still
    // correct and must survive.
    const p = panel("heatmap", {
      heatmap_mode: "prometheus_histogram",
      bucket_unit: "seconds",
    });

    applySeedPanelShape(
      p,
      seed({
        chartType: null,
        config: {
          unit: "custom",
          heatmap_mode: "prometheus_histogram",
          bucket_unit: "milliseconds",
        },
      }),
      0,
    );

    expect(p.data.config.heatmap_mode).toBe("prometheus_histogram");
    expect(p.data.config.bucket_unit).toBe("milliseconds");
  });
});

const metric = (
  name: string,
  type: string,
  unit = "",
  docs = 100,
): MetricStream => ({
  name,
  stream_type: "metrics",
  metrics_meta: {
    metric_type: type,
    metric_family_name: name,
    help: name,
    unit,
  },
  stats: { doc_num: docs },
});

const STREAMS: MetricStream[] = [
  metric("http_requests_total", "Counter"),
  metric("lat_seconds", "Histogram", "s", 0),
  metric("lat_seconds_bucket", "Counter"),
  metric("lat_seconds_sum", "Counter"),
  metric("lat_seconds_count", "Counter"),
];

/** A panel mid-way through a stream change: `fields.stream` is ALREADY the new one. */
const editorPanel = (type: string, query: string, newStream: string) => ({
  layout: { currentQueryIndex: 0 },
  data: {
    type,
    config: {},
    queries: [
      { query, customQuery: false, fields: { stream: newStream }, config: {} },
    ],
  },
  meta: { stream: { streamResultsType: "metrics", streamResults: STREAMS } },
});

describe("promqlSeedFor — which metric was the current query seeded for?", () => {
  it("uses the PREVIOUS stream, not the one already written by the dropdown", () => {
    // Caught in the browser, not by the unit tests. Every caller is a watcher on
    // `fields.stream`, so by the time we run it holds the NEW metric. Judging the
    // OLD query against a seed for the NEW metric never matches — we concluded the
    // user had hand-written it and refused to change the chart type, so picking a
    // histogram after a counter charted percentiles on a line instead of a heatmap.
    const panel = editorPanel(
      "line", // the counter seed set this
      // ...and this. `$__rate_interval` because a seed lands in a PANEL, which
      // resolves the window itself — see PANEL_RATE_WINDOW.
      "sum(rate(http_requests_total{}[$__rate_interval]))",
      "lat_seconds_bucket", // the user has just picked a histogram
    );

    const seed = promqlSeedFor(panel, "lat_seconds_bucket", {
      previousStream: "http_requests_total",
    });

    expect(seed.chartType).toBe("heatmap");
    expect(seed.query).toBe(
      "sum by (le) (rate(lat_seconds_bucket{}[$__rate_interval]))",
    );
    expect(seed.config.heatmap_mode).toBe("prometheus_histogram");
  });

  it("still keeps a chart type the user chose themselves", () => {
    // Same move, but the query in the slot is one the USER wrote. It matches no
    // seed of ours, so the panel's `line` is theirs and the histogram adapts to it.
    const panel = editorPanel(
      "line",
      'sum(rate(http_requests_total{code="500"}[1h]))',
      "lat_seconds_bucket",
    );

    const seed = promqlSeedFor(panel, "lat_seconds_bucket", {
      previousStream: "http_requests_total",
    });

    expect(seed.chartType).toBeNull();
    expect(seed.query).toContain("histogram_quantile(");
    expect(seed.config.heatmap_mode).toBeUndefined();
  });

  it("falls back to fields.stream when no previous stream is given", () => {
    // The toggle path (`useDefaultPanelFields`) seeds a slot whose query was just
    // cleared, so there is no previous metric to speak of and the fallback is safe.
    const panel = editorPanel("bar", "", "lat_seconds_bucket");
    expect(promqlSeedFor(panel, "lat_seconds_bucket").chartType).toBe("heatmap");
  });

  it("leaves a chart type the user picked alone even though the toggle emptied the slot", () => {
    // The panel editor's own order of events: pick Table, then pick the `metrics`
    // stream type. That switches the panel to PromQL, and the switch CLEARS the
    // query — so the seed meets a slot that is empty next to a type the user chose
    // by hand. It used to read the empty slot as "we wrote this, so the type is
    // ours too" and hand back `line`, silently turning the Table into a line chart
    // (and taking the whole Table config section with it).
    const panel = editorPanel("table", "", "lat_seconds_bucket");

    const seed = promqlSeedFor(panel, "lat_seconds_bucket");

    expect(seed.chartType).toBeNull();
    // The QUERY is still seeded — only the type is off limits.
    expect(seed.query).toBeTruthy();
    // A contract that only makes sense on a heatmap must not ride along onto a table.
    expect(seed.config.heatmap_mode).toBeUndefined();
  });
});

describe("isAutoSeededSlot — may the slot be re-seeded?", () => {
  const slotWith = (query: string, labels: any[] = [], type = "bar") => ({
    layout: { currentQueryIndex: 0 },
    data: {
      type,
      config: {},
      queries: [
        {
          query,
          customQuery: false,
          fields: {
            stream: "http_requests_total",
            promql_labels: labels,
            promql_operations: [],
          },
          config: {},
        },
      ],
    },
    meta: { stream: { streamResultsType: "metrics", streamResults: STREAMS } },
  });

  it("says yes for a slot the toggle has just emptied", () => {
    expect(isAutoSeededSlot(slotWith(""))).toBe(true);
  });

  it("says yes for a query we generated ourselves", () => {
    expect(
      isAutoSeededSlot(
        slotWith("sum(rate(http_requests_total{}[$__rate_interval]))"),
      ),
    ).toBe(true);
  });

  it("says no once the user has built something", () => {
    // Builder -> Custom -> Builder re-enters the seeding path; re-seeding here
    // wiped the label filters and operations they had just added.
    expect(
      isAutoSeededSlot(
        slotWith('rate(http_requests_total{code="500"}[5m])', [
          { label: "code", op: "=", value: "500" },
        ]),
      ),
    ).toBe(false);
  });

  it("says no for a label row that has been added but not filled in", () => {
    // It renders to nothing, so the query is still the bare selector — only the
    // rows themselves show that there is a chip on screen to protect.
    expect(
      isAutoSeededSlot(
        slotWith("http_requests_total{}", [{ label: "", op: "=", value: "" }]),
      ),
    ).toBe(false);
  });
});

describe("applyPromqlSeed and the Custom/Builder mode", () => {
  const editorPanelIn = (customQuery: boolean, query = "") => ({
    layout: { currentQueryIndex: 0 },
    data: {
      type: "bar",
      config: {},
      queries: [{ query, customQuery, fields: { stream: "http_requests_total" }, config: {} }],
    },
    meta: { stream: { streamResultsType: "metrics", streamResults: STREAMS } },
  });

  it("does not drag a Custom slot back into Builder mode", () => {
    // The editor makes the user CONFIRM a mode switch, because Builder rewrites
    // their query the moment they touch a chip. Re-seeding must not do it silently
    // behind their back.
    const panel = editorPanelIn(true);

    applyPromqlSeed(panel, "http_requests_total");

    expect(panel.data.queries[0].customQuery).toBe(true);
    expect(panel.data.queries[0].query).toContain("rate(");
  });

  it("still FORCES Custom when the seed cannot be expressed in the builder", () => {
    // The mean pair divides one vector by another; the builder cannot say it, so
    // the slot must become Custom or the query would not survive the first edit.
    // That direction is forced by correctness — the other is not.
    const panel = {
      layout: { currentQueryIndex: 0 },
      data: {
        type: "line",
        config: {},
        queries: [{ query: "", customQuery: false, fields: { stream: "lat_seconds_sum" }, config: {} }],
      },
      meta: { stream: { streamResultsType: "metrics", streamResults: STREAMS } },
    };

    applyPromqlSeed(panel, "lat_seconds_sum", { requireBuilder: false });

    expect(panel.data.queries[0].customQuery).toBe(true);
    expect(panel.data.queries[0].query).toContain(" / ");
  });
});
