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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueryRef } from "@/composables/assistant/pure";

import { fakeEvidence } from "../__tests__/fakeEvidence";
import AssistantChartCard from "./AssistantChartCard.vue";
import type { ChartSeries } from "./chartSeries";

vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  __esModule: true,
  default: {
    name: "ChartRendererStub",
    props: ["data", "label"],
    template: '<div data-test="chart-stub" :data-series="data.options.series?.length" />',
  },
}));

const chart: ChartSeries = {
  xUnit: "us",
  series: [
    {
      name: 'p95{service="checkout"}',
      points: [
        [1_000_000, 310],
        [2_000_000, 1240],
      ],
    },
    {
      name: 'p95{service="inventory"}',
      points: [
        [1_000_000, 400],
        [2_000_000, 412],
      ],
    },
  ],
};

const query: QueryRef = {
  language: "promql",
  text: "histogram_quantile(0.95, sum by (le, service) (rate(http_bucket[5m])))",
  org: "default",
  from: Date.UTC(2026, 10, 9, 13, 5),
  to: Date.UTC(2026, 10, 9, 14, 5),
};

function mountCard(props: Record<string, unknown> = {}, live = true) {
  const evidence = fakeEvidence();
  const wrapper = mount(AssistantChartCard, {
    props: { chart, query, sid: live ? evidence.sid : null, turnId: "t1", ...props },
    global: { provide: live ? evidence.provide : {} },
    attachTo: document.body,
  });
  return { wrapper, ...evidence };
}

describe("AssistantChartCard", () => {
  afterEach(() => (document.body.innerHTML = ""));

  it("draws the series from the answer and lists each with its newest value, the lead marked", async () => {
    const { wrapper } = mountCard();
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-chart-title"]').text()).toBe("p95");
    expect(wrapper.get('[data-test="assistant-chart-meta"]').text()).toContain("2 series");
    const items = wrapper.findAll('[data-test="assistant-chart-legend-item"]');
    expect(items.map((item) => item.text())).toEqual([
      'p95{service="checkout"}1,240',
      'p95{service="inventory"}412',
    ]);
    expect(items[0].attributes("data-lead")).toBe("");
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(wrapper.get('[data-test="chart-stub"]').attributes("data-series")).toBe("2");
  });

  it("shows the PromQL in the foot and opens it in Metrics loaded, never run", async () => {
    const { wrapper, host } = mountCard();
    expect(wrapper.get('[data-test="assistant-chart-foot"]').text()).toContain("PromQL");
    await wrapper.get('[data-test="assistant-chart-open"]').trigger("click");
    expect(wrapper.get('[data-test="assistant-chart-open"]').text()).toBe("Open in Metrics");
    expect(host.dispatch).toHaveBeenCalledWith(expect.any(String), {
      kind: "open_in_explorer",
      query,
      explorer: "metrics",
    });
    expect(host.dispatch).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: "run_query" }),
    );
  });

  it("copies the query through the applier", async () => {
    const { wrapper, host } = mountCard();
    await wrapper.get('[data-test="assistant-chart-copy"]').trigger("click");
    expect(host.dispatch).toHaveBeenCalledWith(expect.any(String), {
      kind: "copy",
      text: query.text,
      what: "query",
    });
  });

  it("offers Show chart on a reloaded turn, which kept no series", () => {
    const { wrapper } = mountCard({ chart: null });
    expect(wrapper.find('[data-test="assistant-chart-card"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="assistant-chart-show"]').text()).toBe("Show chart");
  });

  it("drops the actions on a readonly page but keeps the chart", () => {
    const { wrapper } = mountCard({ readonly: true }, false);
    expect(wrapper.find('[data-test="assistant-chart-card"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="assistant-chart-open"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="assistant-chart-more"]').exists()).toBe(false);
  });
});
