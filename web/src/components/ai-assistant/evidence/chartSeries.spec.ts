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

import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw } from "@/types/i18n";

import {
  chartOf,
  chartOption,
  latestValues,
  leadSeries,
  metricOf,
  promqlMetric,
  seriesLabel,
  valueText,
  type ChartSeries,
} from "./chartSeries";

const chart: ChartSeries = {
  xUnit: "us",
  series: [
    {
      name: 'latency{service="inventory"}',
      points: [
        [1_000_000, 400],
        [2_000_000, 412],
      ],
    },
    {
      name: 'latency{service="checkout"}',
      points: [
        [1_000_000, 310],
        [2_000_000, 1240],
      ],
    },
  ],
};

const answer = (blocks: ChatMessage["contentBlocks"]): ChatMessage => ({
  role: "assistant",
  content: raw(""),
  contentBlocks: blocks,
});

describe("chartSeries", () => {
  it("finds the last step that drew a chart, else the footer's", () => {
    const step = { type: "tool_call" as const, tool: "PrometheusRangeQuery", call_id: "c2" };
    expect(chartOf(answer([{ ...step, chartSeries: chart }]))?.step?.call_id).toBe("c2");
    const footerOnly = chartOf(answer([step, { type: "footer", footer: { chartSeries: chart } }]));
    expect(footerOnly).toEqual({ chart, step: null });
    expect(chartOf(answer([step]))).toBeNull();
  });

  it("leads with the highest newest value and lists every newest value", () => {
    expect(leadSeries(chart)).toBe(1);
    expect(latestValues(chart).map((entry) => entry.value)).toEqual([412, 1240]);
  });

  it("titles a chart by the metric every series shares", () => {
    expect(metricOf(chart)).toBe("latency");
    expect(
      metricOf({
        ...chart,
        series: [
          {
            name: "value",
            points: [
              [1, 1],
              [2, 2],
            ],
          },
        ],
      }),
    ).toBeNull();
    expect(
      metricOf({ ...chart, series: [...chart.series, { name: "other", points: [[1, 1]] }] }),
    ).toBeNull();
  });

  it("formats legend values as whole or two-place numbers, a dash for none", () => {
    expect(valueText(1240)).toBe("1,240");
    expect(valueText(0.12345)).toBe("0.12");
    expect(valueText(null)).toBe("—");
  });

  it("builds a static option in milliseconds that colours only the lead series", () => {
    const option = chartOption(chart, { lead: "blue", rest: "grey", axis: "a", grid: "g" }, (ms) =>
      String(ms),
    ) as { series: { color: string; data: number[][] }[] };
    expect(option.series.map((line) => line.color)).toEqual(["grey", "blue"]);
    expect(option.series[1].data[0]).toEqual([1000, 310]);
  });
});

describe("chart names a reader can read", () => {
  it("names a series by its one label's value, or by its labels", () => {
    expect(seriesLabel('{service="cart"}')).toBe("cart");
    expect(seriesLabel('latency{service="cart",pod="p-1"}')).toBe("service=cart, pod=p-1");
    expect(seriesLabel("value")).toBe("value");
  });

  it("titles a label-only chart with the metric its PromQL reads", () => {
    expect(promqlMetric("avg by (service) (ta_conversation_p95_latency_ms)")).toBe(
      "ta_conversation_p95_latency_ms",
    );
    expect(promqlMetric('rate(http_requests_total{job="api"}[5m])')).toBe("http_requests_total");
    expect(promqlMetric("a_total / b_total")).toBeNull();
  });
});
