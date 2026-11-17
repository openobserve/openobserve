// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";

vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  // `__esModule` is load-bearing: the chart reaches this through defineAsyncComponent.
  __esModule: true,
  default: { name: "ChartRenderer", props: ["data"], template: "<div />" },
}));

import SecuritySeverityChart from "./SecuritySeverityChart.vue";

describe("SecuritySeverityChart", () => {
  it("labels day ticks with the month, not a bare day number", async () => {
    const wrapper = mount(SecuritySeverityChart, {
      props: {
        buckets: [{ ts: 1_794_000_000_000, counts: { high: 2 } }],
        series: [{ key: "high", label: "High", token: "--color-severity-high" }],
      },
      global: { plugins: [store] },
    });
    await flushPromises();
    const options = wrapper.findComponent({ name: "ChartRenderer" }).props("data").options;
    expect(options.xAxis.axisLabel.formatter.day).toBe("{MMM} {d}");
    expect(options.xAxis.axisLabel.formatter.hour).toBe("{HH}:{mm}");
  });
});
