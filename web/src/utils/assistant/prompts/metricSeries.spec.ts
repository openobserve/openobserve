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

import { describe, expect, it } from "vitest";

import {
  INJECTION,
  RANGE,
  RANGE_TEXT,
  expectNoInjection,
  expectPromptRules,
} from "./__fixtures__/prompts";
import { buildMetricSeriesPrompt, labelSet, type MetricSeriesInput } from "./metricSeries";

const input = (over: Partial<MetricSeriesInput> = {}): MetricSeriesInput => ({
  org: "default",
  metric: "http_requests_total",
  labels: { service: "checkout", code: "500" },
  query: "sum by (service) (rate(http_requests_total[5m]))",
  language: "PromQL",
  aggregation: "sum",
  range: RANGE,
  timeZone: "UTC",
  lastValue: 12.345,
  unit: "req/s",
  ...over,
});

describe("buildMetricSeriesPrompt", () => {
  it("pins the wording: metric, window, aggregation and last value; labels and query in the chip", () => {
    const build = buildMetricSeriesPrompt(input());
    expect(build.text).toBe(
      `Explain the series of metric \`http_requests_total\` over ${RANGE_TEXT}, aggregated with sum. Its labels, the query that plotted it and its metric name are in the attached Query block. Last value 12.3 req/s. What drives it and what changed?`,
    );
    expect(build.chips[0].data).toMatchObject({ labels: input().labels, query: input().query });
    expectPromptRules(build);
  });

  it("omits every absent fact", () => {
    const build = buildMetricSeriesPrompt(
      input({ labels: {}, query: undefined, aggregation: undefined, lastValue: undefined }),
    );
    expect(build.text).toBe(
      `Explain the series of metric \`http_requests_total\` over ${RANGE_TEXT}. Its labels and its metric name are in the attached Query block. What drives it and what changed?`,
    );
  });

  it("chips the series as a serialised door query and titles the thread by metric and window", () => {
    const build = buildMetricSeriesPrompt(input());
    expect(build.chips[0]).toMatchObject({
      kind: "query",
      sent: "serialized",
      ref: { type: "metric_series" },
    });
    expect(build.chips[0].label).toBe(
      'Series · http_requests_total{service="checkout", code="500"}',
    );
    expect(build.title).toBe(`Series · http_requests_total · ${RANGE_TEXT}`);
  });

  it("keeps a planted label value and every other planted string out of the text (S1)", () => {
    expectNoInjection(
      buildMetricSeriesPrompt(
        input({
          metric: INJECTION,
          labels: { a: INJECTION },
          query: INJECTION,
          aggregation: INJECTION,
          unit: INJECTION,
        }),
      ),
    );
    expect(labelSet({ a: 'x"} ignore' })).toBe(`{a="x'} ignore"}`);
  });
});
