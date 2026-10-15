// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import store from "@/test/unit/helpers/store";
import type { QualityTimelineBucket } from "@/services/online-evals.service";

vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  // `__esModule` is load-bearing: the chart reaches this through defineAsyncComponent.
  __esModule: true,
  default: { name: "ChartRenderer", props: ["data"], template: "<div />" },
}));

import QualityTrendChart from "./QualityTrendChart.vue";

const TIMELINE: QualityTimelineBucket[] = [
  {
    start: 0,
    end: 3_600_000_000,
    count: 29_997,
    unhealthy: 3,
    trueCount: null,
    average: 0.000324,
    p95: 0.00091,
  },
];

describe("QualityTrendChart", () => {
  it("formats the tooltip values and counts, and the threshold, like the rest of the page", async () => {
    const wrapper = mount(QualityTrendChart, {
      props: {
        timeline: TIMELINE,
        kind: "score",
        range: { min: 0, max: 0.001 },
        threshold: { value: 250_000_000, direction: "gte" },
      },
      global: { plugins: [store] },
    });
    await flushPromises();
    const options = wrapper.findComponent({ name: "ChartRenderer" }).props("data").options;
    const html = options.tooltip.formatter([
      { dataIndex: 0, marker: "", seriesName: "Avg", value: [1, 0.000324] },
    ]);
    expect(html).toContain("29,997 scores");
    expect(html).toContain("0.00032");
    expect(options.series.some((series: any) => String(series.name).includes("250,000,000"))).toBe(
      true,
    );
  });
});
