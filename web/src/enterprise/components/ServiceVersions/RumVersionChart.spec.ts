// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import en from "@/locales/languages/en-US.json";
import type { CompareResponse, RumSeriesSection } from "@/services/service_versions";
import Chart from "./RumVersionChart.vue";
import golden from "@/test/unit/fixtures/serviceVersions/stage7.json";
function translate(key: string, params: Record<string, unknown> = {}) {
  const text = key.split(".").reduce<unknown>((node, part) => (node as never)?.[part], en);
  return String(text ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
}
vi.mock("@/types/i18n", async (original) => ({
  ...(await original<object>()),
  useI18nTyped: () => ({ t: translate }),
}));
vi.mock("../AIObservability/VersionOverlayChart.vue", () => ({
  default: {
    name: "VersionOverlayChart",
    props: ["seriesA", "seriesB", "marker", "formatY", "versionA", "versionB", "mode"],
    template: '<div data-test="overlay-stub" />',
  },
}));
// The E2 mockup state: a watch whose live read is below its floor, whatever the capture concluded.
const e2 = () => {
  const result = structuredClone(golden.compare_e2_web) as unknown as CompareResponse;
  Object.assign(result.live_verdict!, { verdict: "insufficient", reason_code: "below_min_count" });
  Object.assign(result.stored_verdict!, { verdict: "watch", reason_code: "not_significant_yet" });
  return result;
};
const series = () => structuredClone(e2().rum_series) as RumSeriesSection;
function mountChart(
  result: CompareResponse,
  metric: "lcp_p75" | "inp_p75" | "cls_p75" = "inp_p75",
) {
  return mount(Chart, {
    props: { result, metric },
    global: {
      stubs: {
        OButton: {
          emits: ["click"],
          template: "<button @click=\"$emit('click')\"><slot/></button>",
        },
      },
    },
  });
}
describe("RUM before/after chart", () => {
  it("reads the producer's series for both arms in µs-to-ms points, with the mockup's title and hint", () => {
    const result = e2();
    const section = result.rum_series!;
    expect(section.status).toBe("ok");
    const wrapper = mountChart(result);
    expect(wrapper.find('[data-test="svcver-rum-chart-title"]').text()).toBe("INP p75");
    expect(wrapper.find('[data-test="svcver-rum-chart-hint"]').text()).toBe(
      "click a tile to switch the metric",
    );
    expect(wrapper.find('[data-test="svcver-rum-chart-legend"]').text()).toContain("before 0.0.1");
    expect(wrapper.find('[data-test="svcver-rum-chart-legend"]').text()).toContain("after 0.0.2");
    const chart = wrapper.findComponent({ name: "VersionOverlayChart" });
    const expected = (arm: "a" | "b") =>
      section[arm]!.inp_p75.points.filter((point) => point.value != null).map((point) => ({
        x: point.t / 1000,
        y: point.value,
      }));
    expect(chart.props("seriesA")).toEqual(expected("a"));
    expect(chart.props("seriesB")).toEqual(expected("b"));
    expect(chart.props("seriesA").length).toBeGreaterThan(0);
    expect(chart.props("seriesB").length).toBeGreaterThan(0);
  });
  it("marks the deploy at A's start with the chart metric's change", () => {
    const result = e2();
    const chart = mountChart(result).findComponent({ name: "VersionOverlayChart" });
    expect(chart.props("marker")).toEqual({
      x: result.arms.a.start_time / 1000,
      label: "0.0.2 · INP +19.4%",
      color: "var(--color-status-warning-text)",
      dot: true,
    });
    expect(chart.props("formatY")(168)).toBe("168 ms");
  });
  it("switches to the clicked vital with its own units", () => {
    const result = e2();
    const chart = mountChart(result, "lcp_p75").findComponent({ name: "VersionOverlayChart" });
    expect(chart.props("formatY")(1.52)).toBe("1.52 s");
    expect(chart.props("seriesA")).toEqual(
      result
        .rum_series!.a!.lcp_p75.points.filter((point) => point.value != null)
        .map((point) => ({ x: point.t / 1000, y: point.value })),
    );
    expect(chart.props("marker").label).toBe("0.0.2 · LCP −17.0%");
    expect(chart.props("marker").color).toBe("var(--color-status-success-text)");
  });
  it("shows an arm below the sample floor as its reason, never as zeros", () => {
    const result = e2();
    const before = result.rum_series!.b!.inp_p75;
    before.status = "insufficient";
    before.reason = "below_min_count";
    before.n = 312;
    before.value = null;
    before.points = before.points.map((point) => ({ ...point, value: null }));
    const wrapper = mountChart(result);
    const chart = wrapper.findComponent({ name: "VersionOverlayChart" });
    expect(chart.props("seriesB")).toEqual([]);
    expect(chart.props("seriesA").every((point: { y: number }) => point.y > 0)).toBe(true);
    expect(wrapper.find('[data-test="svcver-rum-chart-reason-b"]').text()).toBe(
      `0.0.1 has 312 of ${before.floor} samples, too few to plot`,
    );
    expect(wrapper.find('[data-test="svcver-rum-chart-reason-a"]').exists()).toBe(false);
  });
  it("names an arm with no samples and draws no chart when neither arm has any", () => {
    const result = e2();
    const section = result.rum_series!;
    section.status = "insufficient";
    section.reason = "no_data";
    for (const arm of [section.a!, section.b!]) {
      arm.inp_p75 = {
        ...arm.inp_p75,
        status: "insufficient",
        reason: "no_data",
        n: 0,
        value: null,
      };
      arm.inp_p75.points = arm.inp_p75.points.map((point) => ({ ...point, value: null, n: 0 }));
    }
    const wrapper = mountChart(result);
    expect(wrapper.findComponent({ name: "VersionOverlayChart" }).exists()).toBe(false);
    expect(wrapper.find('[data-test="svcver-rum-chart-reason-both"]').text()).toBe(
      "No samples in either window",
    );
  });
  it("offers a retry when the series read failed or timed out", async () => {
    for (const status of ["error", "timeout"] as const) {
      const result = e2();
      result.rum_series = {
        ...series(),
        status,
        reason: status,
        a: null,
        b: null,
        interval_secs: null,
      };
      const wrapper = mountChart(result);
      expect(wrapper.findComponent({ name: "VersionOverlayChart" }).exists()).toBe(false);
      await wrapper.find('[data-test="svcver-rum-chart-retry"]').trigger("click");
      expect(wrapper.emitted("retry")).toHaveLength(1);
    }
  });
  it("names each build in the legend and series as the tiles legend does", () => {
    const result = e2();
    result.arms.a = { ...result.arms.a, version: "2.4.0", image: "9c1e4b7" };
    result.arms.b = { ...result.arms.b, version: "2.4.0", image: "3f9c2ab" };
    const chart = mountChart(result);
    const legend = chart.get('[data-test="svcver-rum-chart-legend"]').text();
    expect(legend).toContain("before 2.4.0 · img 3f9c2ab");
    expect(legend).toContain("after 2.4.0 · img 9c1e4b7");
    const overlay = chart.findComponent({ name: "VersionOverlayChart" });
    expect(overlay.props("versionB")).toBe("2.4.0 · img 3f9c2ab");
    expect(overlay.props("versionA")).toBe("2.4.0 · img 9c1e4b7");
  });
  it("draws no deploy line when both arms share one concurrent window", () => {
    const result = e2();
    result.mode = "concurrent";
    const chart = mountChart(result).findComponent({ name: "VersionOverlayChart" });
    expect(chart.props("marker")).toBeUndefined();
  });
});
