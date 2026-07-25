// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("vue-i18n", async () => {
  const en: any = (await import("@/locales/languages/en-US.json")).default;
  return {
    useI18n: vi.fn(() => ({
      t: (key: string, params?: Record<string, unknown>) => {
        const msg = key.split(".").reduce((a: any, k) => (a == null ? a : a[k]), en);
        if (typeof msg !== "string") return key;
        if (!params) return msg;
        return Object.keys(params).reduce(
          (acc, k) => acc.replace(new RegExp(`{${k}}`, "g"), String(params[k])),
          msg,
        );
      },
    })),
  };
});

import VersionDeltaStrip from "./VersionDeltaStrip.vue";
import type { CompareResult, MetricResult } from "@/plugins/traces/versionCompare/compareResult";

const OTooltip = {
  props: ["content", "side"],
  template: '<span class="o-tooltip" :data-content="content"><slot /></span>',
};

const stubs = { OTooltip };

function metric(overrides: Partial<MetricResult>): MetricResult {
  return {
    key: "errorRate",
    a: 0.1,
    b: 0.1,
    deltaPct: 0,
    ci: null,
    verdict: "nochange",
    flagged: true,
    associative: true,
    ...overrides,
  };
}

function result(metrics: MetricResult[]): CompareResult {
  return { metrics, enoughSample: true, nA: 500, nB: 500 };
}

const mountStrip = (r: CompareResult) => mount(VersionDeltaStrip, { global: { stubs }, props: { result: r } });

describe("VersionDeltaStrip", () => {
  it("colors a clear regression (verdict=higher, up-worse metric) as crit", () => {
    const r = result([
      metric({ key: "errorRate", a: 0.2, b: 0.05, deltaPct: 300, verdict: "higher", flagged: true, ci: { delta: 0.15, lower: 0.1, upper: 0.2, straddlesZero: false } }),
    ]);
    const wrapper = mountStrip(r);
    const delta = wrapper.find('[data-test="version-delta-strip-delta-errorRate"]');
    expect(delta.classes()).toContain("text-error-600");
  });

  it("colors a clear improvement (verdict=lower, up-worse metric) as good", () => {
    const r = result([
      metric({ key: "p95", a: 100, b: 200, deltaPct: -50, verdict: "lower", flagged: true, ci: { delta: -50, lower: -60, upper: -40, straddlesZero: false } }),
    ]);
    const wrapper = mountStrip(r);
    const delta = wrapper.find('[data-test="version-delta-strip-delta-p95"]');
    expect(delta.classes()).toContain("text-success-600");
  });

  it("colors a straddle-zero / nochange verdict as neutral", () => {
    const r = result([
      metric({ key: "cost", a: 0.05, b: 0.051, deltaPct: -2, verdict: "nochange", flagged: true, ci: { delta: -0.001, lower: -0.01, upper: 0.008, straddlesZero: true } }),
    ]);
    const wrapper = mountStrip(r);
    const delta = wrapper.find('[data-test="version-delta-strip-delta-cost"]');
    expect(delta.classes()).toContain("text-text-secondary");
    expect(delta.classes()).not.toContain("text-error-600");
    expect(delta.classes()).not.toContain("text-success-600");
  });

  it("colors an insufficient-sample verdict as neutral and shows the indicative label", () => {
    const r = result([
      metric({ key: "p50", a: 90, b: 95, deltaPct: -5, verdict: "insufficient", flagged: true, ci: { delta: -5, lower: -20, upper: 10, straddlesZero: true } }),
    ]);
    const wrapper = mountStrip(r);
    const delta = wrapper.find('[data-test="version-delta-strip-delta-p50"]');
    expect(delta.classes()).toContain("text-text-secondary");
    expect(wrapper.find('[data-test="version-delta-strip-indicative-p50"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="version-delta-strip-indicative-p50"]').text()).toBe("indicative");
  });

  it("renders P99 (non-flagged) with value + delta but no verdict color, even with a higher verdict", () => {
    const r = result([
      metric({ key: "p99", a: 500, b: 300, deltaPct: 66.7, verdict: "higher", flagged: false, ci: null }),
    ]);
    const wrapper = mountStrip(r);
    const delta = wrapper.find('[data-test="version-delta-strip-delta-p99"]');
    expect(delta.exists()).toBe(true);
    expect(delta.classes()).not.toContain("text-error-600");
    expect(delta.classes()).not.toContain("text-success-600");
    expect(delta.classes()).toContain("text-text-secondary");
    expect(wrapper.find('[data-test="version-delta-strip-values-p99"]').text()).toContain("500");
  });

  it("uses associative wording in the tooltip when associative=true", () => {
    const r = result([
      metric({ key: "errorRate", a: 0.2, b: 0.05, deltaPct: 300, verdict: "higher", flagged: true, associative: true, ci: { delta: 0.15, lower: 0.1, upper: 0.2, straddlesZero: false } }),
    ]);
    const wrapper = mountStrip(r);
    const tooltip = wrapper.find('[data-test="version-delta-strip-delta-errorRate"] .o-tooltip');
    expect(tooltip.attributes("data-content")).toContain("associative");
  });

  it("uses causal wording (regressed/improved) in the tooltip when associative=false", () => {
    const r = result([
      metric({ key: "errorRate", a: 0.2, b: 0.05, deltaPct: 300, verdict: "higher", flagged: true, associative: false, ci: { delta: 0.15, lower: 0.1, upper: 0.2, straddlesZero: false } }),
    ]);
    const wrapper = mountStrip(r);
    const tooltip = wrapper.find('[data-test="version-delta-strip-delta-errorRate"] .o-tooltip');
    expect(tooltip.attributes("data-content")).toContain("regressed");
  });

  it("renders one cell per metric in result.metrics", () => {
    const r = result([
      metric({ key: "volume", a: 10, b: 12, deltaPct: -16.7, verdict: "nochange", flagged: false, ci: null }),
      metric({ key: "errorRate" }),
    ]);
    const wrapper = mountStrip(r);
    expect(wrapper.find('[data-test="version-delta-strip-cell-volume"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="version-delta-strip-cell-errorRate"]').exists()).toBe(true);
  });
});
