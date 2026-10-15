// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import store from "@/test/unit/helpers/store";
import type { QualityDistributionBucket } from "@/services/online-evals.service";

vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  default: { name: "ChartRenderer", template: "<div data-test='chart-stub' />" },
}));

import QualityDistributionChart from "./QualityDistributionChart.vue";

const BUCKETS: QualityDistributionBucket[] = [
  { key: 0, lower: 0, upper: 0.5, count: 3, unhealthy: 1 },
  { key: 1, lower: 0.5, upper: 1, count: 1200, unhealthy: 0 },
];

const mountChart = (filter: { kind: "bucket"; from: number; to: number } | null = null) =>
  mount(QualityDistributionChart, {
    props: { buckets: BUCKETS, filter },
    global: { plugins: [store] },
  });

describe("QualityDistributionChart", () => {
  it("offers every bar as a keyboard button that filters like a click, shift widening the range", async () => {
    const wrapper = mountChart();
    const keys = wrapper.findAll('[data-test^="quality-distribution-key-"]');
    expect(keys.map((key) => key.text())).toEqual(["< 0.5 · 3", "≥ 0.5 · 1,200"]);
    expect(wrapper.find('[data-test="quality-distribution-keys"]').attributes("role")).toBe(
      "group",
    );
    await keys[1].trigger("click", { shiftKey: true });
    expect(wrapper.emitted("select")).toEqual([[BUCKETS[1], true]]);
  });

  it("marks the filtered bar as pressed", () => {
    const keys = mountChart({ kind: "bucket", from: 1, to: 1 }).findAll(
      '[data-test^="quality-distribution-key-"]',
    );
    expect(keys.map((key) => key.attributes("aria-pressed"))).toEqual(["false", "true"]);
  });
});
