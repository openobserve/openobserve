// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import {
  buildTracesRedPanel,
  buildTracesRedPanels,
  tracesBucketNotice,
  tracesPanelTitle,
  type TracesRedPanelInput,
} from "./tracesRedPanels";

const input = (over: Partial<TracesRedPanelInput> = {}): TracesRedPanelInput => ({
  streamName: "default",
  filter: "service_name = 'checkout'",
  filterText: "service_name = 'checkout'",
  view: "traces",
  interval: { sql: "1 minute", seconds: 60 },
  rateUnit: "traces/s",
  ...over,
});

const sqlOf = (panel: any): string => panel.queries[0].query;

describe("tracesRedPanels", () => {
  it("builds Rate from metrics.json with every placeholder swapped", () => {
    const panel = buildTracesRedPanel("rate", input());
    expect(panel.title).toBe("Rate · service_name = 'checkout'");
    expect(sqlOf(panel)).toBe(
      "SELECT histogram(_timestamp, '1 minute') AS time_bucket, approx_distinct(trace_id) / 60.0 AS max_rate FROM \"default\" WHERE service_name = 'checkout' GROUP BY time_bucket ORDER BY time_bucket ASC",
    );
    expect(sqlOf(panel)).not.toMatch(/\[|\$__interval/);
    expect(panel.queries[0].fields.stream).toBe("default");
    expect(panel.queries[0].fields.stream_type).toBe("traces");
    expect(panel.config.override_config[0].config[0].value.customUnit).toBe("traces/s");
  });

  it("counts spans in the Spans view", () => {
    const rate = buildTracesRedPanel("rate", input({ view: "spans", rateUnit: "spans/s" }));
    const errors = buildTracesRedPanel("errors", input({ view: "spans" }));
    expect(sqlOf(rate)).toContain("count(*) / 60.0 AS max_rate");
    expect(sqlOf(rate)).not.toContain("approx_distinct");
    expect(sqlOf(errors)).toContain("count(*) FILTER (WHERE span_status = 'ERROR') AS error_rate");
  });

  it("limits Errors to error spans and keeps an OR filter grouped", () => {
    const panel = buildTracesRedPanel("errors", input({ filter: "a = 1 OR b = 2" }));
    expect(panel.type).toBe("bar");
    expect(sqlOf(panel)).toContain("WHERE span_status = 'ERROR' AND (a = 1 OR b = 2) GROUP BY");
  });

  it("drops WHERE for an empty filter and titles by stream", () => {
    const panel = buildTracesRedPanel("rate", input({ filter: "", filterText: "  " }));
    expect(sqlOf(panel)).toContain('FROM "default" GROUP BY');
    expect(panel.title).toBe("Rate · default");
    expect(sqlOf(buildTracesRedPanel("errors", input({ filter: "" })))).toContain(
      "WHERE span_status = 'ERROR' GROUP BY",
    );
  });

  it("keeps the whitespace inside the user's filter", () => {
    for (const chart of ["rate", "errors", "duration"] as const) {
      const sql = sqlOf(buildTracesRedPanel(chart, input({ filter: "service_name = 'a  b'" })));
      expect(sql).toContain("service_name = 'a  b'");
    }
  });

  it("builds Duration as a p50/p95/p99 line in microseconds with the export bucket", () => {
    const panel = buildTracesRedPanel(
      "duration",
      input({ filter: "duration > 500000", interval: { sql: "15 second", seconds: 15 } }),
    );
    expect(panel.type).toBe("line");
    expect(panel.title).toBe("Duration · service_name = 'checkout'");
    expect(sqlOf(panel)).toBe(
      "SELECT histogram(_timestamp, '15 second') AS time_bucket, approx_percentile_cont(duration, 0.5) AS p50, approx_percentile_cont(duration, 0.95) AS p95, approx_percentile_cont(duration, 0.99) AS p99 FROM \"default\" WHERE duration > 500000 GROUP BY time_bucket ORDER BY time_bucket ASC",
    );
    expect(panel.queries[0].fields.y.map((y: any) => y.alias)).toEqual(["p50", "p95", "p99"]);
    expect(panel.config.unit).toBe("microseconds");
    expect(panel.config.override_config).toEqual([]);
    expect(panel.queries[0].fields.stream_type).toBe("traces");
  });

  it("returns Rate, Errors, Duration as fresh copies", () => {
    const panels = buildTracesRedPanels(input());
    expect(panels.map((p) => p.title.split(" · ")[0])).toEqual(["Rate", "Errors", "Duration"]);
    panels[0].queries[0].query = "changed";
    expect(sqlOf(buildTracesRedPanel("rate", input()))).not.toBe("changed");
  });

  it("cuts a long title to 60 characters", () => {
    const long = "service_name = 'a-really-long-service-name-that-goes-on-and-on'";
    const title = tracesPanelTitle("Errors", long, "default");
    expect(title.length).toBe(60);
    expect(title.startsWith("Errors · service_name")).toBe(true);
  });

  it("states the bucket in the largest whole unit", () => {
    expect(tracesBucketNotice(60)).toEqual({ unit: "minutes", count: 1 });
    expect(tracesBucketNotice(15)).toEqual({ unit: "seconds", count: 15 });
    expect(tracesBucketNotice(7200)).toEqual({ unit: "hours", count: 2 });
    expect(tracesBucketNotice(86400)).toEqual({ unit: "days", count: 1 });
  });
});
