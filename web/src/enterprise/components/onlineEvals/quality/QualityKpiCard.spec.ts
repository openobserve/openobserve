// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import en from "@/locales/languages/en-US.json";
import type { KpiCard } from "../composables/useQualityData";
import QualityKpiCard from "./QualityKpiCard.vue";

function mountCard(kpi: KpiCard, clickable = false) {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: { en },
  });

  return mount(QualityKpiCard, {
    props: { kpi, delta: null, clickable },
    global: {
      plugins: [i18n],
      stubs: { KpiSparkline: true },
    },
  });
}

describe("QualityKpiCard", () => {
  it("shows a compact target-scope breakdown for score results", () => {
    const wrapper = mountCard({
      id: "scoreResults",
      value: 1255,
      prevValue: 1000,
      sparkline: [],
      healthyDirection: "neutral",
      format: "count",
      scopeCounts: { span: 1200, trace: 50, session: 5 },
    });

    expect(wrapper.text()).toContain("Score Results");
    expect(wrapper.find('[data-test="quality-kpi-scope-span"]').text()).toBe("Span1.2k");
    expect(wrapper.find('[data-test="quality-kpi-scope-trace"]').text()).toBe("Trace50");
    expect(wrapper.find('[data-test="quality-kpi-scope-session"]').text()).toBe("Session5");
  });

  it("uses operational scorer copy without a scope breakdown", () => {
    const wrapper = mountCard({
      id: "scorerSuccess",
      value: 98.4,
      prevValue: 97,
      sparkline: [],
      healthyDirection: "up",
      format: "percent",
    });

    expect(wrapper.text()).toContain("Scorer Success");
    expect(wrapper.find('[data-test="quality-kpi-scope-breakdown"]').exists()).toBe(false);
  });

  it("activates a clickable KPI with pointer and keyboard input", async () => {
    const wrapper = mountCard(
      {
        id: "scorerFailures",
        value: 2,
        prevValue: 0,
        sparkline: [],
        healthyDirection: "down",
        format: "count",
      },
      true,
    );

    expect(wrapper.attributes("role")).toBe("button");
    expect(wrapper.attributes("tabindex")).toBe("0");

    await wrapper.trigger("click");
    await wrapper.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("activate")).toHaveLength(2);
  });
});
