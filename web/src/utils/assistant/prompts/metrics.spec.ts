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
import {
  buildMetricSeriesPrompt,
  buildPanelPrompt,
  labelSet,
  type MetricSeriesInput,
  type PanelInput,
} from "./metrics";

describe("buildPanelPrompt", () => {
  const input = (over: Partial<PanelInput> = {}): PanelInput => ({
    org: "default",
    dashboardId: "d1",
    dashboardTitle: "Checkout",
    panelId: "p1",
    panelTitle: "5xx by service",
    panelType: "line",
    queries: [{ language: "SQL", stream: "default", text: "SELECT count(*) FROM default" }],
    variables: [{ name: "env", value: "prod" }],
    range: RANGE,
    timeZone: "UTC",
    ...over,
  });

  it("pins the wording: type and range in the text, everything the author wrote in the Panel block", () => {
    const build = buildPanelPrompt(input());
    expect(build.text).toBe(
      `Explain the dashboard panel in the attached Panel block (line). Time range ${RANGE_TEXT}. The block holds its title, its dashboard, 1 query and 1 applied variable. What does it show, what changed in this window, and what is the likely cause?`,
    );
    expect(build.chips[0].data).toEqual({
      title: "5xx by service",
      dashboard: "Checkout",
      type: "line",
      queries: input().queries,
      variables: input().variables,
    });
    expectPromptRules(build);
  });

  it("never sends the value of a variable named like a secret", () => {
    const build = buildPanelPrompt(input({ variables: [{ name: "api_token", value: "s3cr3t" }] }));
    expect(JSON.stringify(build.chips[0].data)).not.toContain("s3cr3t");
  });

  it("omits the variables when there are none", () => {
    expect(buildPanelPrompt(input({ variables: [] })).text).not.toContain("variable");
  });

  it("chips the panel as a serialised door chip and titles the thread by dashboard", () => {
    const build = buildPanelPrompt(input());
    expect(build.chips[0]).toMatchObject({
      kind: "panel",
      label: "Panel · 5xx by service",
      secondary: "Dashboard · Checkout",
      sent: "serialized",
      provenance: "door",
      ref: { type: "panel", id: "p1" },
    });
    expect(build.title).toBe("Dashboard · Checkout");
  });

  it("keeps a URL-set variable and every other planted string out of the text (S1)", () => {
    const build = buildPanelPrompt(
      input({
        panelTitle: INJECTION,
        dashboardTitle: INJECTION,
        panelType: INJECTION,
        queries: [{ language: INJECTION, stream: INJECTION, text: INJECTION }],
        variables: [{ name: INJECTION, value: INJECTION }],
      }),
    );
    expectNoInjection(build);
  });
});

describe("buildMetricSeriesPrompt", () => {
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
