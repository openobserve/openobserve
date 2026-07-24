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
  buildPromqlSeed,
  DEFAULT_NEW_PANEL_TYPE,
  isAutoSeededQuery,
  isUntouchedPanelType,
  seedOwnsChartType,
} from "./metricPanelSeed";
import type { MetricStream } from "./metricFamily";

const meta = (
  name: string,
  type: string,
  extra: Record<string, any> = {},
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

const HIST: MetricStream[] = [
  meta("lat_seconds", "Histogram", { unit: "s" }, 0),
  meta("lat_seconds_bucket", "Counter"),
  meta("lat_seconds_sum", "Counter"),
  meta("lat_seconds_count", "Counter"),
];

const COUNTER = [meta("http_requests_total", "Counter")];

describe("a fresh panel gets the rule set's default", () => {
  it("charts a counter as sum(rate), not a raw cumulative selector", () => {
    // The whole point: `http_requests_total{}` is an ever-climbing line nobody
    // wants to look at.
    const seed = buildPromqlSeed("http_requests_total", COUNTER, {
      chartType: "bar",
      allowChartTypeChange: true,
      requireBuilder: true,
    });

    // `$__rate_interval`, not a literal window: this lands in a PANEL, which
    // resolves the variable against its own range and width (the dashboards
    // already define it, every PromQL query goes through the substitution, and
    // the builder's own rate() defaults to the same token). A baked `[4m]` froze
    // the window at whatever the range was when the metric was picked — a rate
    // over 4 minutes still sampled every 30 on a 7-day view.
    expect(seed.query).toBe("sum(rate(http_requests_total{}[$__rate_interval]))");
    expect(seed.customQuery).toBe(false);
    expect(seed.promqlOperations).toEqual([
      { id: "rate", params: ["$__rate_interval"] },
      { id: "sum", params: [[]] },
    ]);
    expect(seed.chartType).toBe("line");
    expect(seed.config.unit).toBe("custom");
    expect(seed.config.unit_custom).toBe("c/s");
  });

  it("charts a histogram as a heatmap, with the de-accumulation contract", () => {
    // Without heatmap_mode the editor would plot raw cumulative buckets in
    // insertion order — the transform is opt-in precisely so generic heatmaps
    // stay safe.
    const seed = buildPromqlSeed("lat_seconds_bucket", HIST, {
      chartType: "bar",
      allowChartTypeChange: true,
      requireBuilder: true,
    });

    expect(seed.chartType).toBe("heatmap");
    expect(seed.query).toBe("sum by (le) (rate(lat_seconds_bucket{}[$__rate_interval]))");
    expect(seed.config.heatmap_mode).toBe("prometheus_histogram");
    expect(seed.config.bucket_unit).toBe("seconds");
  });
});

describe("a panel whose chart type the user already chose", () => {
  it("keeps their type and picks a variant that suits it", () => {
    // A histogram's default is a heatmap, but on a line panel that renders ~20
    // cumulative bucket series as spaghetti. Percentiles read well as lines.
    const seed = buildPromqlSeed("lat_seconds_bucket", HIST, {
      chartType: "line",
      allowChartTypeChange: false,
      requireBuilder: true,
    });

    expect(seed.chartType).toBeNull(); // never override an explicit choice
    expect(seed.query).toContain("histogram_quantile(");
    // The heatmap contract must NOT be written onto a line panel.
    expect(seed.config.heatmap_mode).toBeUndefined();
  });

  it("still seeds the unit, which is type-independent", () => {
    const seed = buildPromqlSeed("http_requests_total", COUNTER, {
      chartType: "line",
      allowChartTypeChange: false,
      requireBuilder: true,
    });
    expect(seed.chartType).toBeNull();
    expect(seed.config.unit_custom).toBe("c/s");
  });
});

describe("guards — the seed must not fight the editor", () => {
  it("never moves the stream selection", () => {
    // A histogram's "Rate of count" variant reads the family's `_count` sibling.
    // Seeding it would rewrite `fields.stream` — the panel's stream dropdown —
    // re-firing the very stream watcher that asked for the seed, on a stream the
    // user never picked. So a variant that reads a different stream is ineligible.
    const seed = buildPromqlSeed("lat_seconds_bucket", HIST, {
      chartType: "bar",
      allowChartTypeChange: true,
      requireBuilder: true,
    });
    expect(seed.stream).toBe("lat_seconds_bucket");
  });

  it("falls back to the bare selector for a mean pair in Builder mode", () => {
    // `sum(rate(X_sum[W])) / sum(rate(X_count[W]))` divides one vector by
    // another, which the builder cannot express — and its other variant reads
    // the `_count` sibling, which would move the stream. Nothing eligible.
    const seed = buildPromqlSeed("lat_seconds_sum", HIST, {
      chartType: "bar",
      allowChartTypeChange: true,
      requireBuilder: true,
    });
    expect(seed.query).toBe("lat_seconds_sum{}");
    expect(seed.customQuery).toBe(false);
    expect(seed.promqlOperations).toEqual([]);
  });

  it("seeds the mean pair in Custom mode, where it CAN be expressed", () => {
    const seed = buildPromqlSeed("lat_seconds_sum", HIST, {
      chartType: "line",
      allowChartTypeChange: false,
      requireBuilder: false,
    });
    expect(seed.query).toContain(" / ");
    expect(seed.customQuery).toBe(true);
    expect(seed.stream).toBe("lat_seconds_sum");
  });

  it("falls back to the bare selector for a name PromQL cannot spell", () => {
    // A stream may lead with a digit; the builder renders `5xx_total{}`, which
    // does not parse. In Builder mode that query would not survive the user's
    // first edit, so do not seed it.
    const seed = buildPromqlSeed("5xx_total", [meta("5xx_total", "Counter")], {
      chartType: "bar",
      allowChartTypeChange: true,
      requireBuilder: true,
    });
    expect(seed.query).toBe("5xx_total{}");
    expect(seed.promqlOperations).toEqual([]);
  });

  it("falls back to the bare selector for an unknown stream", () => {
    expect(buildPromqlSeed("nope", COUNTER, {}).query).toBe("nope{}");
  });

  it("falls back to the bare selector for an unsupported card kind", () => {
    // A histogram-family base with no bucket sibling: nothing honest to chart.
    const seed = buildPromqlSeed("h", [meta("h", "Histogram", {}, 0)], {});
    expect(seed.query).toBe("h{}");
  });
});

describe("re-seeding only overwrites what we generated", () => {
  const opts = { chartType: "line", requireBuilder: true };

  it("treats an empty query as auto-seeded", () => {
    expect(isAutoSeededQuery("", "http_requests_total", COUNTER, opts)).toBe(true);
  });

  it("treats the legacy bare selector as auto-seeded", () => {
    expect(isAutoSeededQuery("http_requests_total{}", "http_requests_total", COUNTER, opts)).toBe(
      true,
    );
  });

  it("treats our own previous seed as auto-seeded", () => {
    const previous = buildPromqlSeed("http_requests_total", COUNTER, opts).query;
    expect(isAutoSeededQuery(previous, "http_requests_total", COUNTER, opts)).toBe(true);
  });

  it("NEVER overwrites a query the user wrote", () => {
    expect(
      isAutoSeededQuery(
        'sum(rate(http_requests_total{code="500"}[1h]))',
        "http_requests_total",
        COUNTER,
        opts,
      ),
    ).toBe(false);
  });
});

describe("isUntouchedPanelType", () => {
  it("only a brand-new panel may have its chart type chosen for it", () => {
    // A new panel starts as `bar`; anything else is a choice the user made.
    expect(isUntouchedPanelType("bar")).toBe(true);
    expect(isUntouchedPanelType("line")).toBe(false);
    expect(isUntouchedPanelType("heatmap")).toBe(false);
    expect(isUntouchedPanelType(undefined)).toBe(false);
  });
});

describe("regressions found in review", () => {
  const opts = { chartType: "line", requireBuilder: true };

  it("recognises a seed made on a FRESH panel, not just one made at the current type", () => {
    // The bug: a histogram seeded on a new panel gets the heatmap variant (the
    // panel was free to pick its own type). Reconstructing it later at the
    // panel's CURRENT type picks the percentiles variant instead, the strings
    // differ, and we mistake our own query for a hand-written one — declining to
    // re-seed, so the builder carried the histogram's `by (le)` grouping onto
    // whatever metric was selected next.
    const fresh = buildPromqlSeed("lat_seconds_bucket", HIST, {
      chartType: "bar",
      allowChartTypeChange: true,
      requireBuilder: true,
    });
    expect(fresh.query).toContain("sum by (le)"); // the heatmap variant

    // The user then picks `line` themselves. The query is still OURS.
    expect(isAutoSeededQuery(fresh.query, "lat_seconds_bucket", HIST, opts)).toBe(true);
  });

  it("still refuses to overwrite a query the user wrote", () => {
    expect(
      isAutoSeededQuery(
        'sum by (le) (rate(lat_seconds_bucket{code="500"}[1h]))',
        "lat_seconds_bucket",
        HIST,
        opts,
      ),
    ).toBe(false);
  });

  describe("seedOwnsChartType — may we change the panel's chart type?", () => {
    it("NO on an empty or bare slot — neither seed ever set a type, so the type is the user's", () => {
      // `opts.chartType` is `line`: a type somebody chose. We only ever set a type
      // alongside a real variant query, so an empty slot (or the bare fallback) next
      // to a chosen type is evidence of the USER, not of us. Saying "yes" here is
      // what turned an explicitly-chosen Table into a line chart the moment the panel
      // was switched from SQL to PromQL — that switch clears the query.
      expect(seedOwnsChartType("", "http_requests_total", COUNTER, opts)).toBe(false);
      expect(seedOwnsChartType("http_requests_total{}", "http_requests_total", COUNTER, opts)).toBe(
        false,
      );
    });

    it("yes on an empty slot when the panel type is still the new-panel default", () => {
      // The fresh-panel case that the empty-slot "yes" above used to cover. It is a
      // question about the TYPE, and `promqlSeedFor` asks it with isUntouchedPanelType.
      expect(isUntouchedPanelType(DEFAULT_NEW_PANEL_TYPE)).toBe(true);
      expect(isUntouchedPanelType("table")).toBe(false);
    });

    it("yes when the query and the chart type still agree — we authored both", () => {
      const seeded = buildPromqlSeed("http_requests_total", COUNTER, opts).query;
      expect(seedOwnsChartType(seeded, "http_requests_total", COUNTER, opts)).toBe(true);
    });

    it("NO once the user has picked a chart type of their own", () => {
      // Seeded as a heatmap on a fresh panel, then the user switched to `line`.
      // The query no longer matches the variant `line` implies, so the type is
      // theirs and we must not override it — even though the QUERY is still ours
      // (isAutoSeededQuery above says so). The two questions are separate.
      const asHeatmap = buildPromqlSeed("lat_seconds_bucket", HIST, {
        chartType: "bar",
        allowChartTypeChange: true,
        requireBuilder: true,
      }).query;
      expect(seedOwnsChartType(asHeatmap, "lat_seconds_bucket", HIST, opts)).toBe(false);
      expect(isAutoSeededQuery(asHeatmap, "lat_seconds_bucket", HIST, opts)).toBe(true);
    });

    it("NO for a hand-written query", () => {
      expect(
        seedOwnsChartType(
          'sum(rate(http_requests_total{code="500"}[1h]))',
          "http_requests_total",
          COUNTER,
          opts,
        ),
      ).toBe(false);
    });
  });
});
